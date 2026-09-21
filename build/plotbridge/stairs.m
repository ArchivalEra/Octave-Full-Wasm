## stairs for the plot bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## stairs(Y) | stairs(X,Y) — step plot.  The core stairs.m builds real
## staircase patch objects (needs handles); here we expand the data into the
## explicit staircase polyline and hand it to the normal line renderer, so
## both backends (gnuplot SVG and the pure-.m SVG writer) draw it unchanged.
##
## `with steps` in gnuplot would be equivalent, but expanding in Octave keeps
## print -dsvg working too — the SVG writer only knows polylines.

function h = stairs (varargin)

  s = __pstate__ ();
  if (! s.hold)
    s = __pb_clear_series__ (s);
  endif

  if (numel (varargin) >= 2 && isnumeric (varargin{2}))
    x = varargin{1}; y = varargin{2};
  else
    x = []; y = varargin{1};
  endif

  if (isempty (x))
    x = (1:numel (y)).';
  endif
  x = x(:); y = y(:);

  ## (x1,y1) -> (x2,y1) -> (x2,y2) -> (x3,y2) -> ...
  n = numel (x);
  xs = zeros (2*n - 1, 1);
  ys = zeros (2*n - 1, 1);
  xs(1) = x(1); ys(1) = y(1);
  for k = 2:n
    xs(2*k - 2) = x(k); ys(2*k - 2) = y(k - 1);
    xs(2*k - 1) = x(k); ys(2*k - 1) = y(k);
  endfor

  s = __pb_add__ (s, xs, ys, "", "lines");
  __pstate__ (s);
  h = [];

endfunction
