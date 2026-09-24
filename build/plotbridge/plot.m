## Headless plot() for the wasm bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## plot(Y) | plot(Y,SPEC) | plot(X,Y) | plot(X,Y,SPEC) | plot(X1,Y1,S1,X2,Y2,S2,…)
##
## Records series into the bridge state; rendering happens in JS (gnuplot-wasm)
## and/or in __svg_render__.m for print -dsvg.

function h = plot (varargin)

  ## ── __PB_CORE_FORWARD__（由 build/plotbridge/insert-core-forward.py 插入，勿手改）──────
  ## 核心调用期间（`__pb_core__` 的深度 > 0）**本名字必须解析回核心实现** —— 这是旧
  ## "把桥目录整条从 path 上摘掉"那套语义的逐点等价复现。核心实现内部会按名字调被桥
  ## 挡住的函数（`__pie__`/`__contour__` 调 `axis(h,…)`、`__plt__`/`__errplot__` 调
  ## `legend(gca(),…)`），所以每个挡住核心名字的 shim 都得有这一段。见 `__pb_core__.m`。
  if (__pb_in_core__ ())
    if (nargout > 0)
      h = __pb_core__ ("plot", varargin{:});
    else
      __pb_core__ ("plot", varargin{:});
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

  ## 首参可能是**目标 axes 句柄**（核心允许 `plot(hax, …)`；`voronoi` 的单输出形态就是
  ## `plot(hax, …)`，见 §5.29 R4）：桥只接受"就是当前 axes"的那一个，别的**明确报错**
  ## ——以前这个形态会掉进 `__pb_parse_series__`，把句柄当数据，于是报
  ## `X and Y sizes do not match`（一句看不出根因的错，见 §7）。
  ## ⚠️ 镜像那一步仍用**原样的 varargin**：核心 `plot` 自己认这个形态，且认得比桥宽
  ##（`parent` 属性对、legend 的 tag 都认）——剥掉再交给它没必要。
  args = __pb_strip_axes__ ("plot", varargin);

  ser = __pb_parse_series__ (args);
  for k = 1:numel (ser)
    t = ser{k};
    s = __pb_add__ (s, t{1}, t{2}, t{3}, "lines");
  endfor

  __pstate__ (s);
  h = [];

  h = __pb_mirror__ ("plot", varargin{:});
endfunction
