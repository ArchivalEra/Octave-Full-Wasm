## Figure switching for the plot bridge — load (or create) figure N.
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Counterpart to __pb_save_fig__.  A figure that was never saved starts
## empty, which is what `figure(3)` on a fresh session should give.

function s = __pb_load_fig__ (s, n)

  if (! isfield (s, "figs") || isempty (s.figs) || n > numel (s.figs) ...
      || isempty (s.figs{n}))
    ## brand-new figure: empty state
    s.panels = {};
    s.active = 0;
    s = __pb_clear_series__ (s);
    s.hold = false;
    s.panel_pos = [];
    s.panel_tag = "";
    s.fig_n = n;
    return;
  endif

  rec = s.figs{n};
  s.panels = rec.panels;
  s.active = rec.active;
  s = __pb_apply_panel__ (s, rec.flat);
  s.fig_n = n;

endfunction
