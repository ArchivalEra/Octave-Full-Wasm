## urlwrite for the wasm bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Shadows the core builtin (libcurl).  Same synchronous XMLHttpRequest path as
## urlread; the difference is that the body is written to a named file.
##
##   urlwrite (URL, FILENAME)
##   urlwrite (URL, FILENAME, METHOD, PARAM)
##   [FILE, SUCCESS, MSG] = urlwrite (...)

function [file, success, message] = urlwrite (url, filename, method, param)

  if (nargin < 2)
    print_usage ();
  endif
  if (! (ischar (url) && isrow (url)))
    error ("urlwrite: URL must be a string");
  endif
  if (! (ischar (filename) && isrow (filename)))
    error ("urlwrite: FILENAME must be a string");
  endif

  body = "";
  verb = "get";
  if (nargin >= 3)
    verb = lower (method);
    if (! any (strcmp (verb, {"get", "post"})))
      error ('urlwrite: METHOD must be "get" or "post"');
    endif
  endif
  if (nargin >= 4)
    body = __web_query__ (param);
    if (strcmp (verb, "get"))
      if (isempty (strfind (url, "?")))
        url = [url "?" body];
      else
        url = [url "&" body];
      endif
      body = "";
    endif
  endif

  ok = __web_fetch_sync__ (url, verb, body);

  ## Copy the fetched bytes to the requested path verbatim (binary-safe).
  if (ok)
    fin = fopen ("/tmp/webnet_last", "rb");
    if (fin < 0)
      ok = false;
      message = "urlwrite: 读不回响应体";
    else
      ## NOTE: fwrite's precision must be a plain type name ("uint8"), not the
      ## fread-style "*uint8" — the starred form is not accepted and fails with
      ## "invalid PRECISION specified".
      raw = fread (fin, Inf, "*uint8");
      fclose (fin);
      fout = fopen (filename, "wb");
      if (fout < 0)
        error ("urlwrite: cannot open '%s' for writing", filename);
      endif
      fwrite (fout, raw, "uint8");
      fclose (fout);
      message = "";
    endif
  else
    message = __web_read_text__ ("/tmp/webnet_error");
    if (isempty (message))
      message = "urlwrite: 请求失败";
    endif
  endif

  success = ok;
  file = filename;

  if (nargout < 2 && ! ok)
    error ("urlwrite: %s", message);
  endif

endfunction
