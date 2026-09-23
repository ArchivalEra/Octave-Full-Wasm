## grid on/off for the plot bridge (own code, repo license).
function grid (varargin)

  ## ── __PB_CORE_FORWARD__（由 build/plotbridge/insert-core-forward.py 插入，勿手改）──────
  ## 核心调用期间（`__pb_core__` 的深度 > 0）**本名字必须解析回核心实现** —— 这是旧
  ## "把桥目录整条从 path 上摘掉"那套语义的逐点等价复现。核心实现内部会按名字调被桥
  ## 挡住的函数（`__pie__`/`__contour__` 调 `axis(h,…)`、`__plt__`/`__errplot__` 调
  ## `legend(gca(),…)`），所以每个挡住核心名字的 shim 都得有这一段。见 `__pb_core__.m`。
  if (__pb_in_core__ ())
    __pb_core__ ("grid", varargin{:});
    return;
  endif

  s = __pstate__ ();
  if (nargin == 0)
    s.grid = ! s.grid;
  elseif (strcmpi (varargin{1}, "on"))
    s.grid = true;
  elseif (strcmpi (varargin{1}, "off"))
    s.grid = false;
  else
    error ("grid: expected 'on' or 'off'.");
  endif
  __pstate__ (s);
  __pb_mirror__ ("grid", varargin{:});
endfunction
