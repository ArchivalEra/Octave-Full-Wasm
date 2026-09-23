## barh for the plot bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## barh(Y) | barh(X,Y) — horizontal bars.  Octave's core barh needs real
## graphics handles (barh.m calls newplot/gca), which this build has none of,
## so we record the series ourselves like bar.m does.
##
## Rendering: gnuplot's SVG terminal can draw horizontal boxes with
## `with boxxyerrorbars`; the JS side emits that for style "hboxes".

function h = barh (varargin)

  ## ── __PB_CORE_FORWARD__（由 build/plotbridge/insert-core-forward.py 插入，勿手改）──────
  ## 核心调用期间（`__pb_core__` 的深度 > 0）**本名字必须解析回核心实现** —— 这是旧
  ## "把桥目录整条从 path 上摘掉"那套语义的逐点等价复现。核心实现内部会按名字调被桥
  ## 挡住的函数（`__pie__`/`__contour__` 调 `axis(h,…)`、`__plt__`/`__errplot__` 调
  ## `legend(gca(),…)`），所以每个挡住核心名字的 shim 都得有这一段。见 `__pb_core__.m`。
  if (__pb_in_core__ ())
    if (nargout > 0)
      h = __pb_core__ ("barh", varargin{:});
    else
      __pb_core__ ("barh", varargin{:});
    endif
    return;
  endif
  ## 下面只为"输出个数与核心实现对齐"（核心声明几个输出，桥就得声明几个 ——
  ## Octave 的**输出个数检查发生在函数体之前**，声明少了上面那段转发根本进不来，实测）。
  h = [];


  s = __pstate__ ();
  if (! s.hold)
    s = __pb_clear_series__ (s);
  endif

  ## 与 bar.m 共用同一个拆分 helper（`barh(Y, W)` 的宽度参数同样**明确报错**）。
  [x, y] = __pb_bar_args__ ("barh", varargin);

  ## barh swaps the roles: the category runs along y and the length along x.
  ## Store as (category, length) so both vectors are the same length, and let
  ## the renderer draw the box sideways.
  if (isempty (x))
    x = (1:numel (y)).';
  endif
  cat = x(:);
  val = y(:);
  if (numel (cat) != numel (val))
    error ("barh: X and Y must have the same number of elements");
  endif

  s = __pb_add__ (s, cat, val, "", "hboxes");
  __pstate__ (s);
  h = [];

  h = __pb_mirror__ ("barh", varargin{:});
endfunction
