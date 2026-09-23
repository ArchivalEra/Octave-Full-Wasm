## bar for the plot bridge (own code, repo license).
## bar(Y) | bar(X,Y).  Pair with core hist for histograms:
##   [nn, xx] = hist (data, nbins); bar (xx, nn)
function h = bar (varargin)

  ## ── __PB_CORE_FORWARD__（由 build/plotbridge/insert-core-forward.py 插入，勿手改）──────
  ## 核心调用期间（`__pb_core__` 的深度 > 0）**本名字必须解析回核心实现** —— 这是旧
  ## "把桥目录整条从 path 上摘掉"那套语义的逐点等价复现。核心实现内部会按名字调被桥
  ## 挡住的函数（`__pie__`/`__contour__` 调 `axis(h,…)`、`__plt__`/`__errplot__` 调
  ## `legend(gca(),…)`），所以每个挡住核心名字的 shim 都得有这一段。见 `__pb_core__.m`。
  if (__pb_in_core__ ())
    if (nargout > 0)
      h = __pb_core__ ("bar", varargin{:});
    else
      __pb_core__ ("bar", varargin{:});
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
  ## 拆分下沉到纯 helper（宿主 `%!test` 覆盖，见 __pb_bar_args__.m）：
  ## `bar(Y)` / `bar(X,Y)` 照旧，而 `bar(Y, W)`（核心把第二个标量当**宽度**）**明确报错**
  ## —— 以前桥把 W 当成 X 数据静默画错。
  [x, y] = __pb_bar_args__ ("bar", varargin);
  s = __pb_add__ (s, x, y, "", "boxes");
  __pstate__ (s);
  h = [];
  h = __pb_mirror__ ("bar", varargin{:});
endfunction
