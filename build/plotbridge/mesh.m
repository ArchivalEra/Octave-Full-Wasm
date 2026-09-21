## mesh for the plot bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## mesh(Z) | mesh(X,Y,Z) | mesh(...,SPEC)
##
## Wireframe surface: each grid cell becomes one projected quad outline.  See
## __pb_surface__ for the projection and painter's-algorithm ordering.

function h = mesh (varargin)

  s = __pstate__ ();
  if (! s.hold)
    s = __pb_clear_series__ (s);
  endif

  [x, y, z, spec] = __pb_surf_args__ (varargin);
  s = __pb_surface__ (s, x, y, z, "mesh", spec);
  __pstate__ (s);
  h = [];

endfunction
