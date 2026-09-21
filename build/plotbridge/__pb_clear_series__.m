## Shared "fresh axes" reset for the plot bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Every drawing primitive starts with the same handful of lines:
##
##   if (! s.hold)
##     s.series = {}; s.title = ""; ... s.logy = false;
##   endif
##
## That block was copy-pasted into eight shims; new v2 fields would have to be
## added to all of them (and a missed one is a silent state leak between
## figures).  Keep it here instead.

function s = __pb_clear_series__ (s)

  s.series = {};
  s.title = ""; s.xlabel = ""; s.ylabel = "";
  s.xlim = []; s.ylim = []; s.grid = false;
  s.legend = {}; s.legloc = "";
  s.logx = false; s.logy = false;
  s.axis = "";

endfunction
