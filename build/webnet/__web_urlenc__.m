## Percent-encode one string for application/x-www-form-urlencoded.
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Note the loop variable is `i`, not `s`: the argument is the string and
## reusing its name for the index shadows it (CLIBS.md 批次 7b 坑 6).

function out = __web_urlenc__ (s)

  s = char (s);
  n = numel (s);
  out = "";
  keep = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~";
  for i = 1:n
    c = s(i);
    if (c == " ")
      out = [out "+"];
    elseif (! isempty (strfind (keep, c)))
      out = [out c];
    else
      out = [out sprintf("%%%02X", double(c))];
    endif
  endfor

endfunction
