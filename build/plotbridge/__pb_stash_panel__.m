## Panel bookkeeping for the plot bridge — stash the active panel.
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Design note — why the active panel is *not* stored separately:
## every existing shim (plot.m, bar.m, title.m, …) reads the state with
## __pstate__() and writes the whole struct back.  Rather than teach all of
## them about panels, the *active* panel lives in the top-level fields and
## __pb__.panels holds the inactive ones; switching stashes the outgoing
## panel and restores the incoming one.
##
## Octave note: subfunctions are private to their file, so each of these
## helpers needs its own file whose name matches the function.

function s = __pb_stash_panel__ (s)

  if (! isfield (s, "panels") || isempty (s.panels)), return; endif
  if (! isfield (s, "active") || s.active < 1), return; endif

  s.panels{s.active} = __pb_panel_fields__ (s);

endfunction
