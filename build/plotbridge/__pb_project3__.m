## 3D → 2D projection for the plot bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## The bridge's renderers (gnuplot SVG + the pure-.m SVG writer) are 2D: they
## draw polylines and polygons from (x,y) pairs.  Rather than teach both of
## them `splot`, 3D data is projected here, in Octave, into 2D polylines.
##
## Two consequences worth stating:
##   * `print -dsvg` works for 3D for free — it never learns 3D exists.
##   * hidden-line removal is approximated by painter's algorithm (sort
##     polygons by depth), which is what a teaching plot needs; it is not a
##     z-buffer, so interpenetrating surfaces can still look wrong.
##
## Projection: a fixed isometric-ish view (azimuth -37.5°, elevation 30°,
## Octave's default view).  Axes are drawn as a 3D box so the reader can tell
## the axes apart.

function [X, Y] = __pb_project3__ (x, y, z, az, el)

  if (nargin < 4 || isempty (az)), az = -37.5; endif
  if (nargin < 5 || isempty (el)), el = 30; endif

  a = az * pi / 180;
  e = el * pi / 180;

  ## view direction
  ca = cos (a); sa = sin (a);
  ce = cos (e); se = sin (e);

  ## rotate about z by -a, then tilt by e; drop the depth component
  xr =  ca * x + sa * y;
  yr = -sa * x + ca * y;
  X = xr;
  Y = ce * yr + se * z;

endfunction
