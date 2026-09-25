## Octave-Full-Wasm — 网页版 `pause`：真让出主线程（G2，2026-09-25）
##
## 为什么遮蔽内建：内建 `pause` 在 wasm 里是**阻塞**等待（页面整个卡住、定时器停摆）；
## 本 shim 走 `__web_pause_ms__`（webpause.oct → 主模块 web_pause_ms → JSPI 挂起 import），
## 在 `eval_async` 的 promising 栈上把整个 wasm 栈**挂起**——页面定时器/动画照常跑，
## Promise 落地后从同一条栈继续。JSPI 不可用时的行为见 `__octaveJspiRequire` 的门
## （没有挂起能力时这里会给出清晰报错，而不是静默阻塞）。
##
## 语义（与内建对齐的部分）：
##   pause(n)   让出 n 秒（可为小数，如 pause(0.2)）
##   pause()    0ms 让出 —— 网页没有终端可等键，**不是**"等输入"（如实记）
##   pause("on"/"off")  无状态可关，忽略；pause("query") 返回 "on"
##
## ⚠️ 依赖 `__web_pause_ms__.oct`（开机资产装载，见 bridge/index.html 的 CORE_DLDFCN）。

function varargout = pause (varargin)
  ## D9 门槛（批次 3）：没有 JSPI 挂起能力时退回**内建阻塞 pause**（= G2 之前的旧语义：
  ## 页面在等待期间卡住，但脚本语义正确），而不是静默 no-op —— 否则依赖 pause 节奏的
  ## 循环（playblocking/movie）会变成 busy-loop 把页面冻死。
  if (! __web_suspend_ok__ ())
    if (nargin > 0 && isnumeric (varargin{1}))
      builtin ('pause', varargin{1});
    endif
    return;
  endif

  if (nargin == 0)
    __web_pause_ms__ (0);
    return;
  endif

  a = varargin{1};
  if (ischar (a))
    if (nargout > 0 && strcmpi (a, "query"))
      varargout{1} = "on";    # 网页版没有"关掉 pause"的状态
    endif
    return;
  endif

  ms = round (double (a) * 1000);
  if (isnan (ms) || ms < 0)
    ms = 0;
  endif
  __web_pause_ms__ (ms);
endfunction
