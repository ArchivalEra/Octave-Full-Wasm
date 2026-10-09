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

  ## ── __PB_CORE_FORWARD__（由 build/plotbridge/insert-core-forward.py 插入，勿手改）──────
  ## 核心调用期间（`__pb_core__` 的深度 > 0）**本名字必须解析回核心实现** —— 这是旧
  ## "把桥目录整条从 path 上摘掉"那套语义的逐点等价复现。核心实现内部会按名字调被桥
  ## 挡住的函数（`__pie__`/`__contour__` 调 `axis(h,…)`、`__plt__`/`__errplot__` 调
  ## `legend(gca(),…)`），所以每个挡住核心名字的 shim 都得有这一段。见 `__pb_core__.m`。
  if (__pb_in_core__ ())
    if (nargout > 0)
      h = __pb_core__ ("area", varargin{:});
    else
      __pb_core__ ("area", varargin{:});
    endif
    return;
  endif
  ## 下面只为"输出个数与核心实现对齐"（核心声明几个输出，桥就得声明几个 ——
  ## Octave 的**输出个数检查发生在函数体之前**，声明少了上面那段转发根本进不来，实测）。
  h = [];


  ## 剥掉"首参是目标 axes 句柄"那一层（核心内部会这么调：`hist` 走
  ## `bar (hax, x, freq, "hist", …)`）。镜像那一步仍用**原样**实参（核心自己认得句柄形态）。
  ## ⚠️ 见 `__pb_strip_axes__.m`：桥只跟踪**当前 axes**；首参是别的 axes ⇒ 明确报错（不静默曲解）。
  orig = varargin;
  varargin = __pb_strip_axes__ ("area", varargin);

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

  h = __pb_mirror__ ("area", orig{:});
endfunction
