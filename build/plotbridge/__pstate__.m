## Plot-bridge state holder (own code, repo license).
## Global struct __pb__ + emit spec file on every update.

function s = __pstate__ (varargin)

  global __pb__;
  if (isempty (__pb__))
    ## 面板字段（14 个）与它们的默认值由 __pb_fields__.m 声明 —— 这里不再手写一遍
    f = __pb_fields__ ();
    __pb__ = struct ();
    for k = 1:numel (f.names)
      __pb__.(f.names{k}) = f.defaults{k};
    endfor
    ## ⚠️ 下面这些是**图/全局级**记账，不属于"单个面板的字段"，所以不在那张表里
    ##    （`n` 必须跨面板/跨图单调，否则 /tmp/pbN.dat 会互相覆盖 —— 见 __pb_fields__.m）
    __pb__.n = 0;
    __pb__.panels = {};
    __pb__.active = 0;
    __pb__.figs = {};
    __pb__.fig_n = 1;
  endif
  if (nargin > 0)
    s2 = varargin{1};
    ## 老 shim 手工搭出来的 state 可能缺字段：按表补齐（以前是 7 行手写 isfield）
    f = __pb_fields__ ();
    for k = 1:numel (f.names)
      if (! isfield (s2, f.names{k}))
        s2.(f.names{k}) = f.defaults{k};
      endif
    endfor
    if (! isfield (s2, "panels")), s2.panels = {}; endif
    if (! isfield (s2, "active")), s2.active = 0; endif
    if (! isfield (s2, "figs")), s2.figs = {}; endif
    if (! isfield (s2, "fig_n")), s2.fig_n = 1; endif
    if (! isfield (s2, "n")), s2.n = 0; endif
    __pb__ = s2;
    ## 让页面知道"图变了"。**这里刻意不渲染** —— 无 GL 设备上渲一张 SVG 实测要
    ## 30 ms（直线）到 440 ms（surf(peaks(40))），每个绘图命令都渲一次纯属浪费；
    ## 页面按 250 ms 采样，发现修订号变了再请 `__pb_publish__` 渲**最新那一张**。
    ## 这是仓库里其它宿主桥同一条路子（采样，而不是逐次推送）。
    ## 有真渲染器时连这个文件都不写（toolkit 自己会出 PNG）。
    if (! __pb_real_renderer__ ())
      fid = fopen ("/tmp/pb_rev.txt", "w");
      if (fid >= 0)
        fprintf (fid, "%.3f", time ());   # 时间戳当修订号：无状态、每次都变
        fclose (fid);
      endif
    endif
  endif
  s = __pb__;

endfunction
