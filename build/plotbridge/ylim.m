## ylim for the plot bridge (own code, repo license).
function lim_out = ylim (varargin)

  ## ── __PB_CORE_FORWARD__（由 build/plotbridge/insert-core-forward.py 插入，勿手改）──────
  ## 核心调用期间（`__pb_core__` 的深度 > 0）**本名字必须解析回核心实现** —— 这是旧
  ## "把桥目录整条从 path 上摘掉"那套语义的逐点等价复现。核心实现内部会按名字调被桥
  ## 挡住的函数（`__pie__`/`__contour__` 调 `axis(h,…)`、`__plt__`/`__errplot__` 调
  ## `legend(gca(),…)`），所以每个挡住核心名字的 shim 都得有这一段。见 `__pb_core__.m`。
  if (__pb_in_core__ ())
    if (nargout > 0)
      lim_out = __pb_core__ ("ylim", varargin{:});
    else
      __pb_core__ ("ylim", varargin{:});
    endif
    return;
  endif
  ## 下面只为"输出个数与核心实现对齐"（核心声明几个输出，桥就得声明几个 ——
  ## Octave 的**输出个数检查发生在函数体之前**，声明少了上面那段转发根本进不来，实测）。
  lim_out = [];

  ## 首参可能是**目标 axes 句柄**（核心允许 `ylim(hax, …)`）—— 与 xlim 同一条契约，
  ## 见 `__pb_strip_axes__.m`。
  args = __pb_strip_axes__ ("ylim", varargin);

  s = __pstate__ ();
  if (numel (args) == 0)
    ## 核心的 `ylim()` 是"回报当前限值"；桥没有可回报的值 ⇒ 什么都不做（以前会清空状态）。
    return;
  endif
  a = args{1};
  if (ischar (a))
    if (strcmpi (a, "auto"))
      s.ylim = [];
    elseif (strcmpi (a, "manual"))
      ## no-op（与核心一致：只改 mode）
    else
      error ('ylim: unrecognized argument "%s"', a);
    endif
  elseif (isnumeric (a) && numel (a) == 2)
    s.ylim = a(:).';
  else
    ## 报错文本与核心一致（core 的 `__axis_limits__.m`）
    error ("ylim: LIMITS must be a 2-element vector");
  endif
  __pstate__ (s);
  __pb_mirror__ ("ylim", varargin{:});
endfunction
