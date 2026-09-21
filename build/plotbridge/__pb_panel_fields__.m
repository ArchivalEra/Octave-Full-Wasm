## Panel bookkeeping for the plot bridge — extract one panel's fields.
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## The subset of bridge state that belongs to a single panel.  Everything a
## drawing primitive can set lives here, so stashing/restoring a panel is a
## field copy rather than a per-shim migration.

function p = __pb_panel_fields__ (s)

  p = struct ();
  p.hold = s.hold;
  p.title = s.title; p.xlabel = s.xlabel; p.ylabel = s.ylabel;
  p.xlim = s.xlim; p.ylim = s.ylim;
  p.grid = s.grid; p.legloc = s.legloc;
  p.logx = s.logx; p.logy = s.logy;
  if (isfield (s, "axis")), p.axis = s.axis; else, p.axis = ""; endif
  p.legend = s.legend;
  p.series = s.series;
  if (isfield (s, "panel_pos")), p.panel_pos = s.panel_pos; else, p.panel_pos = []; endif
  if (isfield (s, "panel_tag")), p.panel_tag = s.panel_tag; else, p.panel_tag = ""; endif

endfunction
