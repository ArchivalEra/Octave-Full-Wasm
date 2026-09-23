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

function [x_out, h] = stairs (varargin)

  ## ── __PB_CORE_FORWARD__（由 build/plotbridge/insert-core-forward.py 插入，勿手改）──────
  ## 核心调用期间（`__pb_core__` 的深度 > 0）**本名字必须解析回核心实现** —— 这是旧
  ## "把桥目录整条从 path 上摘掉"那套语义的逐点等价复现。核心实现内部会按名字调被桥
  ## 挡住的函数（`__pie__`/`__contour__` 调 `axis(h,…)`、`__plt__`/`__errplot__` 调
  ## `legend(gca(),…)`），所以每个挡住核心名字的 shim 都得有这一段。见 `__pb_core__.m`。
  if (__pb_in_core__ ())
    if (nargout > 0)
      [x_out, h] = __pb_core__ ("stairs", varargin{:});
    else
      __pb_core__ ("stairs", varargin{:});
    endif
    return;
  endif
  ## 下面只为"输出个数与核心实现对齐"（核心声明几个输出，桥就得声明几个 ——
  ## Octave 的**输出个数检查发生在函数体之前**，声明少了上面那段转发根本进不来，实测）。
  x_out = [];
  h = [];


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

  h = __pb_mirror__ ("stairs", varargin{:});
endfunction
