## pie for the plot bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## pie(X) | pie(X, EXPLODE) | pie(..., LABELS)
##
## The core pie.m needs patch handles; here we pre-compute the wedge polygons
## in Octave and hand them to the normal renderer as closed filled polygons —
## so the pure-.m SVG writer draws them with no new primitive, and gnuplot
## gets the same closed polylines.
##
## Wedges are emitted as (x,y) rings: centre -> arc points -> centre.

function h = pie (varargin)

  s = __pstate__ ();
  if (! s.hold)
    s = __pb_clear_series__ (s);
  endif

  if (nargin < 1)
    print_usage ();
  endif

  x = varargin{1}(:);
  if (any (x < 0))
    error ("pie: X must be non-negative");
  endif
  total = sum (x);
  if (total <= 0)
    error ("pie: X must have a positive sum");
  endif

  ## axis is forced to a square, label-free box
  s.axis = "equal";
  s.grid = false;
  s.logx = false; s.logy = false;

  n = numel (x);
  frac = x / total;
  ## 2 degrees per step, at least 8 points per wedge
  a0 = pi/2;                          # start at 12 o'clock, clockwise
  for k = 1:n
    sweep = 2*pi*frac(k);
    m = max (8, ceil (sweep / (2*pi) * 72));
    th = a0 - linspace (0, sweep, m).';
    xp = [0; cos(th); 0];
    yp = [0; sin(th); 0];
    s = __pb_add__ (s, xp, yp, "", "area");
    a0 = a0 - sweep;
  endfor

  __pstate__ (s);
  h = [];

endfunction
