## webread for the wasm bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## The core webread.m calls __restful_service__, which needs libcurl.  Here we
## shadow webread itself and go straight to the synchronous fetch bridge.
##
##   RESPONSE = webread (URL)
##   RESPONSE = webread (URL, NAME1, VALUE1, ...)
##   RESPONSE = webread (URL, ..., OPTIONS)
##
## Content-Type decides the decoding, as in the core version: JSON becomes a
## struct/cell, text stays a char row, anything else is returned as bytes.
## OPTIONS (a weboptions object) is accepted; only HeaderFields are applied.

function response = webread (url, varargin)

  if (nargin == 0)
    print_usage ();
  endif
  if (! (ischar (url) && isrow (url)))
    error ("webread: URL must be a string");
  endif

  args = varargin;
  opts = [];
  if (! isempty (args) && isa (args{end}, "weboptions"))
    opts = args{end};
    args(end) = [];
  endif

  ## remaining arguments are name/value pairs
  if (mod (numel (args), 2) != 0)
    error ("webread: KEYS/VALUES must occur in pairs");
  endif
  if (! isempty (args) && ! iscellstr (args))
    error ("webread: KEYS and VALUES must be strings");
  endif

  if (! isempty (args))
    q = __web_query__ (args);
    if (isempty (strfind (url, "?")))
      url = [url "?" q];
    else
      url = [url "&" q];
    endif
  endif

  ok = __web_fetch_sync__ (url, "get", "");
  if (! ok)
    message = __web_read_text__ ("/tmp/webnet_error");
    error ("webread: %s", message);
  endif

  response = __web_decode__ (url);

endfunction
