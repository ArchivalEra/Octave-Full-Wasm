## urlread for the wasm bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Shadows the core builtin (functions on the path take precedence over
## builtins — see CLIBS.md 批次 9), which needs libcurl and therefore errors
## out in this build.
##
## The transfer itself is done by __web_fetch_sync__ (build/webnet.cc), which
## drives XMLHttpRequest in synchronous mode from inside the wasm module — so
## the call really is synchronous from Octave's point of view, with no Asyncify.
##
##   S = urlread (URL)
##   [S, SUCCESS] = urlread (URL)
##   [S, SUCCESS, MSG] = urlread (URL)
##   ... = urlread (URL, METHOD, PARAM)        METHOD is "get" or "post"
##
## PARAM is a cell array of name/value pairs, as in the core version.

function [s, success, message] = urlread (url, method, param)

  if (nargin < 1)
    print_usage ();
  endif
  if (! (ischar (url) && isrow (url)))
    error ("urlread: URL must be a string");
  endif

  body = "";
  verb = "get";
  if (nargin >= 2)
    if (! (ischar (method) && isrow (method)))
      error ("urlread: METHOD must be a string");
    endif
    verb = lower (method);
    if (! any (strcmp (verb, {"get", "post"})))
      error ('urlread: METHOD must be "get" or "post"');
    endif
  endif

  if (nargin >= 3)
    if (! iscellstr (param))
      error ("urlread: parameters (PARAM) for get and post requests must be given as a cell array of strings");
    endif
    if (mod (numel (param), 2) != 0)
      error ("urlread: number of elements in PARAM must be even");
    endif
    body = __web_query__ (param);
    if (strcmp (verb, "get"))
      ## a GET carries the parameters in the query string
      if (isempty (strfind (url, "?")))
        url = [url "?" body];
      else
        url = [url "&" body];
      endif
      body = "";
    endif
  endif

  ok = __web_fetch_sync__ (url, verb, body);

  ## Read the body back as bytes, then keep it as a char row (what urlread
  ## returns) — the bytes survive intact so binary payloads are not mangled.
  s = __web_read_last__ ();

  message = "";
  if (! ok)
    message = __web_read_text__ ("/tmp/webnet_error");
    if (isempty (message))
      message = "urlread: 请求失败";
    endif
  endif
  success = ok;

  if (nargout < 2 && ! ok)
    error ("urlread: %s", message);
  endif

endfunction
