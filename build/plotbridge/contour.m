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

function [c_out, h] = contour (varargin)

  ## ── __PB_CORE_FORWARD__（由 build/plotbridge/insert-core-forward.py 插入，勿手改）──────
  ## 核心调用期间（`__pb_core__` 的深度 > 0）**本名字必须解析回核心实现** —— 这是旧
  ## "把桥目录整条从 path 上摘掉"那套语义的逐点等价复现。核心实现内部会按名字调被桥
  ## 挡住的函数（`__pie__`/`__contour__` 调 `axis(h,…)`、`__plt__`/`__errplot__` 调
  ## `legend(gca(),…)`），所以每个挡住核心名字的 shim 都得有这一段。见 `__pb_core__.m`。
  if (__pb_in_core__ ())
    if (nargout > 0)
      [c_out, h] = __pb_core__ ("contour", varargin{:});
    else
      __pb_core__ ("contour", varargin{:});
    endif
    return;
  endif
  ## 下面只为"输出个数与核心实现对齐"（核心声明几个输出，桥就得声明几个 ——
  ## Octave 的**输出个数检查发生在函数体之前**，声明少了上面那段转发根本进不来，实测）。
  c_out = [];
  h = [];


  s = __pstate__ ();
  if (! s.hold)
    s = __pb_clear_series__ (s);
  endif

  args = varargin;

  ## 属性对从桥自己的解析里剥掉：核心接受 `contour(X,Y,Z,'parent',gca())` 与
  ## `'linewidth',2`（宿主实测），而以前这两个形态会掉进下面的 switch ⇒ 报
  ## "expected (Z), (Z,N), …"（**桥比核心严**，属"静默不许"那一类）。见 __pb_strip_props__.m。
  args = __pb_strip_props__ ("contour", args);

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
  ## from the shared palette (__pb_palette__.m); a SPEC string is applied to
  ## every level curve.
  k = 0;   # series counter, for a stable colour cycle
  for li = 1:numel (levels)
    lev = levels(li);
    k += 1;
    ## one colour per level curve, so nested levels stay distinguishable
    if (isempty (spec))
      lspec = __pb_palette__ (k);   # k 从 1 起，与 __pb_add__ 同一套取色语义
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

  h = __pb_mirror__ ("contour", varargin{:});
endfunction
