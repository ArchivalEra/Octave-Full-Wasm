## Panel bookkeeping for the plot bridge — append a fresh active panel.
## SPDX-License-Identifier: AGPL-3.0-or-later

function s = __pb_new_panel__ (s, pos, tag)

  if (! isfield (s, "panels")), s.panels = {}; endif
  if (! isfield (s, "active")), s.active = 0; endif

  ## start from a clean slate, then stamp the position
  s = __pb_clear_series__ (s);
  s.hold = false;
  s.panel_pos = pos;
  s.panel_tag = tag;

  s.panels{end+1} = __pb_panel_fields__ (s);
  s.active = numel (s.panels);

endfunction
