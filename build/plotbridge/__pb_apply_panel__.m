## Panel bookkeeping for the plot bridge — restore one panel's fields.
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Counterpart to __pb_panel_fields__: copies a saved panel record back onto
## the flat (active) state.

function s = __pb_apply_panel__ (s, p)

  s.hold = p.hold;
  s.title = p.title; s.xlabel = p.xlabel; s.ylabel = p.ylabel;
  s.xlim = p.xlim; s.ylim = p.ylim;
  s.grid = p.grid; s.legloc = p.legloc;
  s.logx = p.logx; s.logy = p.logy;
  s.axis = p.axis;
  s.legend = p.legend;
  s.series = p.series;
  s.panel_pos = p.panel_pos;
  s.panel_tag = p.panel_tag;

endfunction
