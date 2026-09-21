## Surface/grid appender for the plot bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Shared by mesh/surfc/surf.  Projects an (X,Y,Z) grid to 2D and emits one
## closed polygon per grid cell, sorted back-to-front (painter's algorithm) so
## nearer cells are drawn over farther ones.
##
## MODE: "mesh"  — draw the cell outline only (no fill)
##       "surf"  — draw the outline plus a translucent fill
##
## The polygons are ordinary series, so neither renderer needs 3D support.

function s = __pb_surface__ (s, x, y, z, mode, spec)

  if (nargin < 6), spec = ""; endif

  [nr, nc] = size (z);
  if (nr < 2 || nc < 2)
    error ("%s: Z must be at least 2x2", mode);
  endif

  ## expand axis vectors to grids when needed
  if (isvector (x) && isvector (y) && numel (x) == nc && numel (y) == nr)
    [Xg, Yg] = meshgrid (x(:).', y(:));
  elseif (isequal (size (x), size (z)) && isequal (size (y), size (z)))
    Xg = x; Yg = y;
  else
    ## fall back to indices
    [Xg, Yg] = meshgrid (1:nc, 1:nr);
  endif

  ## project every grid node once
  [px, py] = __pb_project3__ (Xg, Yg, z, [], []);

  ## depth proxy: distance along the view direction.  Cells whose centre is
  ## farther from the viewer are drawn first.
  az = -37.5 * pi / 180; el = 30 * pi / 180;
  depth = sin (az) * Xg + cos (az) * Yg;   # monotone in view depth

  ## build cells
  nn = (nr - 1) * (nc - 1);
  cellpoly = cell (1, nn);
  celldepth = zeros (1, nn);
  k = 0;
  for i = 1:nr-1
    for j = 1:nc-1
      k += 1;
      cellpoly{k} = [px(i,j), py(i,j); px(i,j+1), py(i,j+1); ...
                     px(i+1,j+1), py(i+1,j+1); px(i+1,j), py(i+1,j); ...
                     px(i,j), py(i,j)];
      celldepth(k) = mean ([depth(i,j), depth(i,j+1), depth(i+1,j+1), depth(i+1,j)]);
    endfor
  endfor

  ## painter's algorithm: farthest first
  [~, ord] = sort (celldepth, "descend");

  for kk = 1:nn
    poly = cellpoly{ord(kk)};
    s = __pb_add__ (s, poly(:, 1), poly(:, 2), spec, mode);
  endfor

endfunction
