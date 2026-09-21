## URL-encode a name/value cell array (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## The core urlread lets libcurl do this; with no libcurl we do it here.
## Encoding follows application/x-www-form-urlencoded: unreserved characters
## pass through, space becomes '+', everything else becomes %XX.

function q = __web_query__ (param)

  parts = {};
  for k = 1:2:numel (param)
    ## NOTE: bind first — inside [...] a spaced `f (x)` is parsed as indexing,
    ## not a call (CLIBS.md 批次 6 坑 1), and this is exactly that shape.
    a = __web_urlenc__ (param{k});
    b = __web_urlenc__ (param{k+1});
    parts{end+1} = [a "=" b];
  endfor
  q = strjoin (parts, "&");

endfunction
