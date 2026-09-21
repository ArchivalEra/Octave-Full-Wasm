## surf for the plot bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## surf(Z) | surf(X,Y,Z) | surf(...,SPEC)
##
## Filled surface: like mesh, but each cell is a translucent polygon.  The
## projection and depth ordering live in __pb_surface__.

function h = surf (varargin)

  s = __pstate__ ();
  if (! s.hold)
    s = __pb_clear_series__ (s);
  endif

  [x, y, z, spec] = __pb_surf_args__ (varargin);
  s = __pb_surface__ (s, x, y, z, "surf", spec);
  __pstate__ (s);
  h = [];

endfunction
