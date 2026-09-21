## Figure switching for the plot bridge — save the current figure.
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## figure(n) must not destroy figure m's contents — switching back to m has to
## bring its plot back.  Same trick as panels: the *current* figure lives in
## the top-level fields, and __pb__.figs{n} holds the saved ones.
##
##   __pb__.fig_n   active figure number (1 when never set)
##   __pb__.figs    cell indexed by figure number, each = full figure record
##
## A figure record is the panel bookkeeping plus the flat fields, so a figure
## is just "a figure's worth of panels".

function s = __pb_save_fig__ (s)

  if (! isfield (s, "fig_n") || isempty (s.fig_n)), s.fig_n = 1; endif
  if (! isfield (s, "figs") || isempty (s.figs)), s.figs = {}; endif

  rec = struct ();
  rec.panels = s.panels;
  rec.active = s.active;
  rec.flat = __pb_panel_fields__ (s);

  ## grow the cell so fig_n is a valid index
  while (numel (s.figs) < s.fig_n)
    s.figs{end+1} = [];
  endwhile
  s.figs{s.fig_n} = rec;

endfunction
