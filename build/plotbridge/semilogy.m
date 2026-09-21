## semilogy for the plot bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Same argument forms as plot(); the only difference is the y axis scaling.

function h = semilogy (varargin)
  s = __pstate__ ();
  if (! s.hold)
    s = __pb_clear_series__ (s);
  endif
  s.logy = true;
  ser = __pb_parse_series__ (varargin);
  for k = 1:numel (ser)
    t = ser{k};
    s = __pb_add__ (s, t{1}, t{2}, t{3}, "lines");
  endfor
  __pstate__ (s);
  h = [];
endfunction
