## contour for the plot bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## contour(Z) | contour(Z,N) | contour(Z,V) | contour(X,Y,Z,...) | contour(...,SPEC)
##
## The core contour.m needs a real axes and patch objects.  Here the level
## curves are traced in Octave and emitted as projected polylines.
##
## Tracing is per grid cell (marching squares without the lookup table):
## for each cell we find the edge crossings for the level and connect them.
## That is enough for a teaching plot and needs no extra toolbox.

function h = contour (varargin)

  s = __pstate__ ();
  if (! s.hold)
    s = __pb_clear_series__ (s);
  endif

  args = varargin;

  ## trailing spec string
  spec = "";
  if (numel (args) > 0 && ischar (args{end}) && ! strncmp (args{end}, "-", 1))
    spec = args{end};
    args(end) = [];
  endif

  ## split (X, Y, Z, N|V) from (Z, N|V)
  switch (numel (args))
    case 1
      z = args{1}; x = []; y = []; lv = [];
    case 2
      z = args{1}; x = []; y = []; lv = args{2};
    case 3
      x = args{1}; y = args{2}; z = args{3}; lv = [];
    case 4
      x = args{1}; y = args{2}; z = args{3}; lv = args{4};
    otherwise
      error ("contour: expected (Z), (Z,N), (Z,V), (X,Y,Z) or (X,Y,Z,N|V)");
  endswitch

  if (! ismatrix (z) || min (size (z)) < 2)
    error ("contour: Z must be at least a 2x2 matrix");
  endif

  [nr, nc] = size (z);

  if (isvector (x) && isvector (y) && numel (x) == nc && numel (y) == nr)
    [Xg, Yg] = meshgrid (x(:).', y(:));
  elseif (isequal (size (x), size (z)) && isequal (size (y), size (z)))
    Xg = x; Yg = y;
  else
    [Xg, Yg] = meshgrid (1:nc, 1:nr);
  endif

  ## levels: explicit vector, count, or a default of 8
  lo = min (z(:)); hi = max (z(:));
  if (isempty (lv))
    levels = linspace (lo, hi, 10)(2:9);
  elseif (isscalar (lv))
    levels = linspace (lo, hi, lv + 2)(2:end-1);
  else
    levels = lv(:).';
  endif

  ## NOTE: __pb_linespec__ is a private subfunction of __pb_add__.m, so it
  ## cannot be called here (see CLIBS.md 批次 7a 坑 4).  Contour colours come
  ## from the shared cycle; a SPEC string is applied to every level curve.
  k = 0;   # series counter, for a stable colour cycle
  for li = 1:numel (levels)
    lev = levels(li);
    k += 1;
    ## one colour per level curve, so nested levels stay distinguishable
    if (isempty (spec))
      lspec = __pb_cycle_color__ (k);
    else
      lspec = spec;
    endif
    for i = 1:nr-1
      for j = 1:nc-1
        ## cell corner values
        v = [z(i,j), z(i,j+1), z(i+1,j+1), z(i+1,j)];
        px = [Xg(i,j), Xg(i,j+1), Xg(i+1,j+1), Xg(i+1,j)];
        py = [Yg(i,j), Yg(i,j+1), Yg(i+1,j+1), Yg(i+1,j)];

        if (all (v < lev) || all (v > lev)), continue; endif

        ## collect edge crossings (corner k ↔ corner k+1, wrapping)
        xs = []; ys = [];
        for e = 1:4
          e2 = rem (e, 4) + 1;
          v1 = v(e); v2 = v(e2);
          if ((v1 < lev && v2 >= lev) || (v1 >= lev && v2 < lev))
            t = (lev - v1) / (v2 - v1);
            xs(end+1) = px(e) + t * (px(e2) - px(e));
            ys(end+1) = py(e) + t * (py(e2) - py(e));
          endif
        endfor

        if (numel (xs) < 2), continue; endif

        ## project the (usually 2-point) segment pair
        [PX, PY] = __pb_project3__ (xs(:), ys(:), lev * ones (numel (xs), 1), [], []);
        s = __pb_add__ (s, PX, PY, lspec, "lines");
      endfor
    endfor
  endfor

  __pstate__ (s);
  h = [];

endfunction
