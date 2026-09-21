## websave for the wasm bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
##   FILENAME = websave (FILENAME, URL)
##   FILENAME = websave (FILENAME, URL, NAME1, VALUE1, ...)
##   FILENAME = websave (FILENAME, URL, ..., OPTIONS)
##
## Note the argument order: unlike urlwrite, websave takes the destination
## first — that trips people up, and the core version says so in its docstring
## too.  Only HeaderFields from OPTIONS are honoured (they become extra query
## parameters here, which is what the core version effectively does for GET).

function filename = websave (filename, url, varargin)

  if (nargin < 2)
    print_usage ();
  endif
  if (! (ischar (url) && isrow (url)))
    error ("websave: URL must be a string");
  endif
  if (! (ischar (filename) && isrow (filename)))
    error ("websave: FILENAME must be a string");
  endif

  args = varargin;
  if (! isempty (args) && isa (args{end}, "weboptions"))
    args(end) = [];
  endif
  if (mod (numel (args), 2) != 0)
    error ("websave: KEYS/VALUES must occur in pairs");
  endif

  if (! isempty (args))
    q = __web_query__ (args);
    if (isempty (strfind (url, "?")))
      url = [url "?" q];
    else
      url = [url "&" q];
    endif
  endif

  [~, ok, message] = urlwrite (url, filename);
  if (! ok)
    error ("websave: %s", message);
  endif

endfunction
