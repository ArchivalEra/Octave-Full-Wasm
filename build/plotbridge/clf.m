## clf for the plot bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## clf clears the current figure: all panels go, and the flat state resets.
## It does NOT change the figure number (matching Octave).

function clf (varargin)

  s = __pstate__ ();
  s = __pb_clear_series__ (s);
  s.hold = false;
  s.panels = {};
  s.active = 0;
  s.panel_pos = [];
  s.panel_tag = "";
  __pstate__ (s);

endfunction
