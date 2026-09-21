// Synchronous HTTP fetch bridge for octave-wasm (own code, repo license).
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Core Octave's urlread/urlwrite need libcurl; this build has none, so they
// error out with "support for URL transfers was disabled".  The browser *does*
// have HTTP, so the only real question is whether Octave can get the bytes
// back synchronously.
//
// It can, without Asyncify: XMLHttpRequest has a synchronous mode, and
// emscripten_run_script() lets this side module drive it inline.  Octave's own
// call stack is synchronous, so the whole thing stays inside one call — no
// event loop, no coroutine, no Asyncify.
//
// EM_ASM would be the idiomatic way and is NOT usable here: emscripten rejects
// it in side modules ("EM_ASM is not supported in side modules") because the JS
// body would have to be spliced into the main module's glue at link time.
// emscripten_run_script() is an ordinary exported library function, so it works
// from a side module; the JS travels as a string and reads its inputs from
// MEMFS (one const char* cannot carry a URL plus method plus body).
//
// What that costs (recorded in HANDOFF §7 as a known deviation):
//   * Chrome logs "Synchronous XMLHttpRequest on the main thread is
//     deprecated" — noisy but functional.
//   * The page blocks for the duration of the request.  For teaching-sized
//     API calls that is the same behaviour desktop Octave has.
//   * CORS applies exactly as it would to fetch(): the server must allow the
//     origin.  Same-origin URLs always work.
//
// The fetched body is written into the wasm filesystem rather than returned by
// value, so binary payloads (images, .mat files) survive intact and the .m side
// can choose how to read them.  Three things are produced:
//
//   /tmp/webnet_last      the response body (empty on failure)
//   /tmp/webnet_status    the HTTP status code (-1 when the request threw)
//   /tmp/webnet_error     a human-readable message ("" on success)
//
// Usage from Octave:  ok = __web_fetch_sync__ (url)
//                     ok = __web_fetch_sync__ (url, "get"|"post", body)
//                     ok = __web_fetch_sync__ (url, method, body, headers_cell)

#include <octave/oct.h>
#include <octave/ov-struct.h>
#include <string>
#include <vector>

#include <emscripten.h>
#include <cstdio>
#include <cstdlib>

DEFUN_DLD (__web_fetch_sync__, args, nargout,
           "__web_fetch_sync__ (URL[, METHOD[, BODY]])\n\
Synchronously fetch URL with XMLHttpRequest and store the body in\n\
/tmp/webnet_last.  Returns true when the request completed with a 2xx\n\
status.  Internal use; urlread/urlwrite/webread/websave wrap it.")
{
  if (args.length () < 1)
    print_usage ();

  std::string url = args(0).xstring_value ("__web_fetch_sync__: URL must be a string");
  std::string method = "GET";
  std::string body;

  if (args.length () >= 2)
    {
      std::string m = args(1).xstring_value ("__web_fetch_sync__: METHOD must be a string");
      if (m == "post" || m == "POST")
        method = "POST";
      else if (m == "get" || m == "GET")
        method = "GET";
      else
        error ("__web_fetch_sync__: METHOD must be \"get\" or \"post\"");
    }

  if (args.length () >= 3 && ! args(2).isempty ())
    {
      if (! args(2).is_string ())
        error ("__web_fetch_sync__: BODY must be a string");
      body = args(2).string_value ();
    }

  // Ask the JS side to do the request and leave the result in MEMFS.
  //
  // NOTE: EM_ASM cannot be used here — emscripten refuses it inside a side
  // module ("EM_ASM is not supported in side modules"), because the JS body
  // would have to be injected into the main module's glue at link time.
  // emscripten_run_script() is an ordinary library call exported by the main
  // module, so the same work is expressed as a string of JS.
  //
  // Strings are passed by writing them into MEMFS first and having the script
  // read them back: run_script takes one const char*, and escaping arbitrary
  // URLs into a JS literal is a quoting minefield.
  {
    FILE *fu = std::fopen ("/tmp/webnet_req_url", "w");
    if (fu) { std::fputs (url.c_str (), fu); std::fclose (fu); }
    FILE *fm = std::fopen ("/tmp/webnet_req_method", "w");
    if (fm) { std::fputs (method.c_str (), fm); std::fclose (fm); }
    FILE *fb = std::fopen ("/tmp/webnet_req_body", "w");
    if (fb) { std::fputs (body.c_str (), fb); std::fclose (fb); }
  }

  emscripten_run_script (R"JS(
(function () {
  function read(p) {
    try { return new TextDecoder().decode(Module.FS.readFile(p)); } catch (e) { return ''; }
  }
  function put(p, t) { try { Module.FS.writeFile(p, t, { encoding: 'utf8' }); } catch (e) {} }
  function putBytes(p, u8) { try { Module.FS.writeFile(p, u8); } catch (e) {} }

  var url = read('/tmp/webnet_req_url');
  var method = read('/tmp/webnet_req_method') || 'GET';
  var body = read('/tmp/webnet_req_body');

  var xhr = new XMLHttpRequest();
  try {
    xhr.open(method, url, false);
  } catch (e) {
    put('/tmp/webnet_status', '-1');
    put('/tmp/webnet_error', '无法发起请求: ' + e.message);
    putBytes('/tmp/webnet_last', new Uint8Array(0));
    return;
  }
  // Synchronous XHR forbids responseType ('The response type cannot be changed
  // for synchronous requests').  Read it as text instead, with the charset
  // forced to ISO-8859-1 so every byte 0x00-0xFF maps to one char and the
  // payload survives a binary round-trip.  (Without the override, UTF-8
  // decoding would mangle non-ASCII bytes.)
  try { xhr.overrideMimeType('text/plain; charset=x-user-defined'); } catch (e) {}
  try {
    if (method === 'POST') {
      xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
      xhr.send(body);
    } else {
      xhr.send();
    }
  } catch (e) {
    put('/tmp/webnet_status', '-1');
    put('/tmp/webnet_error', '请求抛出异常: ' + e.message + '（跨域时通常是 CORS 被拒）');
    putBytes('/tmp/webnet_last', new Uint8Array(0));
    return;
  }

  put('/tmp/webnet_status', String(xhr.status));
  try {
    var ct = xhr.getResponseHeader('Content-Type');
    put('/tmp/webnet_ctype', ct ? ct : '');
  } catch (e2) { put('/tmp/webnet_ctype', ''); }

  // x-user-defined: charCodeAt(i) & 0xFF recovers the original byte
  var text = '';
  try { text = xhr.responseText || ''; } catch (e3) { text = ''; }
  var u8 = new Uint8Array(text.length);
  for (var i = 0; i < text.length; i++) u8[i] = text.charCodeAt(i) & 0xFF;
  putBytes('/tmp/webnet_last', u8);

  if (xhr.status >= 200 && xhr.status < 300) {
    put('/tmp/webnet_error', '');
  } else if (xhr.status === 0) {
    put('/tmp/webnet_error', '请求被阻断（CORS 或网络不可达；跨域需要服务端允许本页来源）');
  } else {
    put('/tmp/webnet_error', 'HTTP ' + xhr.status);
  }
})();
)JS");


  // Read the status straight out of MEMFS — plain stdio works, because the JS
  // above wrote through the same FS this C++ sees.
  long status = -1;
  if (FILE *f = std::fopen ("/tmp/webnet_status", "r"))
    {
      char buf[64] = {0};
      if (std::fgets (buf, sizeof (buf), f))
        status = std::strtol (buf, nullptr, 10);
      std::fclose (f);
    }

  bool ok = (status >= 200 && status < 300);

  if (nargout > 0)
    return ovl (ok);

  return octave_value_list ();
}
