## area for the plot bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## area(Y) | area(X,Y) — filled area under the curve, stacked for matrices.
##
## Like stairs, this expands into plain polylines so the existing renderers
## work untouched: the polygon is walked forward along the data and back along
## the baseline.  Multi-column Y stacks (each column sits on the previous
## one), matching the core area.m behaviour.
##
## Style "area" is a filled polygon — the SVG writer draws it as a closed
## polyline with a translucent fill; gnuplot gets `with filledcurves`.

function h = area (varargin)

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
    if (isvector (y))
      x = (1:numel (y)).';
    else
      x = (1:rows (y)).';
    endif
  endif
  x = x(:);

  if (isvector (y))
    y = y(:);
  endif

  ## Stack the columns (cumulative sum across columns), like core area.m.
  ys = cumsum (y, 2);
  base = zeros (rows (ys), 1);

  for k = 1:columns (ys)
    col = ys(:, k);
    ## forward along the top, back along the baseline → closed polygon
    xp = [x; flipud(x)];
    yp = [col; flipud(base)];
    s = __pb_add__ (s, xp, yp, "", "area");
    base = col;
  endfor

  __pstate__ (s);
  h = [];

endfunction
