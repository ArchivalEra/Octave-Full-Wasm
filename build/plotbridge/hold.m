## hold on/off for the plot bridge (own code, repo license).
function hold (varargin)

  ## ── __PB_CORE_FORWARD__（由 build/plotbridge/insert-core-forward.py 插入，勿手改）──────
  ## 核心调用期间（`__pb_core__` 的深度 > 0）**本名字必须解析回核心实现** —— 这是旧
  ## "把桥目录整条从 path 上摘掉"那套语义的逐点等价复现。核心实现内部会按名字调被桥
  ## 挡住的函数（`__pie__`/`__contour__` 调 `axis(h,…)`、`__plt__`/`__errplot__` 调
  ## `legend(gca(),…)`），所以每个挡住核心名字的 shim 都得有这一段。见 `__pb_core__.m`。
  if (__pb_in_core__ ())
    __pb_core__ ("hold", varargin{:});
    return;
  endif

  ## 首参可能是**目标 axes 句柄**（核心的 `hold(hax, …)` 在真实脚本里是常规写法）：桥只
  ## 接受"当前 axes"那一个，别的明确报错。见 `__pb_strip_axes__.m`。
  args = __pb_strip_axes__ ("hold", varargin);

  s = __pstate__ ();
  if (numel (args) == 0)
    s.hold = ! s.hold;
  elseif (strcmpi (args{1}, "on"))
    s.hold = true;
  elseif (strcmpi (args{1}, "off"))
    s.hold = false;
  else
    error ("hold: expected 'on' or 'off'.");
  endif
  __pstate__ (s);
  __pb_mirror__ ("hold", varargin{:});
endfunction
