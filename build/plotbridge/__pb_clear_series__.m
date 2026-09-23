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

  ## "新轴"要重置哪些字段也由表声明（cleared 那一列）；hold / panel_pos / panel_tag
  ## 不在其中 —— 它们不是"轴内容"（见 __pb_fields__.m 的表说明与断言）
  f = __pb_fields__ ();
  for k = 1:numel (f.names)
    if (f.cleared(k))
      s.(f.names{k}) = f.defaults{k};
    endif
  endfor

endfunction
