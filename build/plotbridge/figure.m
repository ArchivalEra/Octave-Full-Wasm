## figure(n) for the plot bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## figure ()      → new figure, next number
## figure (n)     → switch to (creating if needed) figure n, contents intact
## figure (h)     → handle form, accepted for h==1
## figure ("Name", ...) → property pairs accepted and ignored
##
## Unlike v1 (which just cleared everything), each figure keeps its own
## panels, so `figure(1); plot(...); figure(2); plot(...); figure(1)` brings
## the first plot back.  See __pb_figure__.m.
##
## ── T2/A1（2026-09-22）：**同时创建真的图形对象** ─────────────────────────────
## 在这之前，这个文件只维护"当前图号"这个数字（面板状态在 __pstate__ 里），
## **不创建任何图形对象** —— 因为那时本构建没有任何 graphics toolkit，
## `figure` 走核心路径必报 "no graphics toolkits are available!"。
## 代价是 `gcf/gca/get/set/ishandle/close` 这些**句柄语义全废**：
## `figure(1)` 返回 1，但 `ishandle(1)` 是 0、`get(1,'type')` 报 invalid handle
## （实测记录见 test/browser/probe-t2-graphics.mjs）。
##
## T2 挂上 `web` toolkit 之后核心路径能走了，所以这里补一句"把真对象也建出来"：
##   · 建得出来 → 返回**真句柄**，gcf/gca/get/set/title 全部可用；
##   · 建不出来（例如将来又变成没有 toolkit 的构建）→ **退回老的纯编号行为**，
##     面板渲染不受影响。用 try/catch 兜住，保证 plot 桥既有能力不退化。
## 面板状态（__pb_save_fig__/__pb_load_fig__）**保持原样** —— 渲染仍归 plot 桥管，
## 真对象这边只负责句柄语义。这正是 T2 说的"半真化"。

function h = figure (varargin)

  ## ── __PB_CORE_FORWARD__（由 build/plotbridge/insert-core-forward.py 插入，勿手改）──────
  ## 核心调用期间（`__pb_core__` 的深度 > 0）**本名字必须解析回核心实现** —— 这是旧
  ## "把桥目录整条从 path 上摘掉"那套语义的逐点等价复现。核心实现内部会按名字调被桥
  ## 挡住的函数（`__pie__`/`__contour__` 调 `axis(h,…)`、`__plt__`/`__errplot__` 调
  ## `legend(gca(),…)`），所以每个挡住核心名字的 shim 都得有这一段。见 `__pb_core__.m`。
  if (__pb_in_core__ ())
    if (nargout > 0)
      h = __pb_core__ ("figure", varargin{:});
    else
      __pb_core__ ("figure", varargin{:});
    endif
    return;
  endif
  ## 下面只为"输出个数与核心实现对齐"（核心声明几个输出，桥就得声明几个 ——
  ## Octave 的**输出个数检查发生在函数体之前**，声明少了上面那段转发根本进不来，实测）。
  h = [];


  s = __pstate__ ();

  ## 把参数分成两半：
  ##   · 第一个「正整数标量」= 图号，**要吃掉**（核心 figure.m 也是这么干的）；
  ##   · 其余按"属性名/属性值"成对收进 props，原样透传给 __go_figure__。
  ## ⚠️ 这里踩过一次坑：第一版直接把**原始 varargin** 透传，于是 `figure(1)` 变成
  ##    `__go_figure__(1, 1)` —— 多出来的那个 1 被当成属性名 → 抛异常 → 被 catch 吞掉
  ##    → 退回纯编号模式，表现为 `figure(1)` 又变回"有号没对象"。
  ##    （`figure()` 无参时不带多余实参，所以它一直是好的 —— 这正是当时
  ##     "无参能建、带号不能建"的怪现象的来源。）
  n = [];
  props = {};
  k = 1;
  while (k <= numel (varargin))
    a = varargin{k};
    if (isempty (n) && isnumeric (a) && isscalar (a) && a > 0 && a == fix (a))
      n = a;
      k++;
      continue;
    endif
    if (ischar (a) && k < numel (varargin))
      ## 属性对：整对保留（Name/Position/Visible/... 都是真 figure 属性）
      props{end+1} = a;
      props{end+1} = varargin{k+1};
      k += 2;
      continue;
    endif
    props{end+1} = a;
    k++;
  endwhile

  ## stash the outgoing figure before switching
  s = __pb_save_fig__ (s);

  if (isempty (n))
    n = s.fig_n + 1;
  endif

  s = __pb_load_fig__ (s, n);
  __pstate__ (s);

  h = n;

  ## ---- T2：把真的 figure 对象也建出来（拿不到 toolkit 就退回纯编号）---------
  ## ★ 2026-09-24（小口子 3）：**带 `integerhandle=off` 的图**以前一律建不出来。
  ##   这一对参数要求 `__go_figure__` 的第一个实参是 **NaN**（"让 Octave 自己分配"）——
  ##   宿主核心的 `figure.m` 在"没给图号"时传的就是 NaN。桥以前一律传自己的面板号 n，
  ##   于是 `__go_figure__(5,"integerhandle","off")` 报 `invalid graphics object`，
  ##   结果 **waitbar / dialog / uisetfont** 全部死在 `get: invalid handle (= 2)`
  ##   （一句看不出根因的错）。实测：`__go_figure__(NaN,"integerhandle","off")` 正常
  ##   （返回 -1.345、`ishghandle`=1、整套 waitbar 属性都吃得下）。
  ##   ⚠️ 只有这一对触发的形态改走 NaN；**其余形态逐字不变**（面板号 == 真句柄这条
  ##   假设仍然成立，`figure(1)/figure(2)` 的句柄语义一个字节都没动）。
  figh = n;
  if (__pb_integerhandle_off__ (props))
    figh = NaN;
  endif
  try
    ## `__go_figure__` 要"图号或 NaN + 属性对"；整数句柄模式下返回的句柄就是 n。
    h = __go_figure__ (figh, props{:});
    ## 顺手把它设成当前 figure —— 核心 figure.m 也这么做，
    ## gcf()/gca()/__pb_mirror_text__ 都靠这个属性。
    set (0, "currentfigure", h);
  catch
    h = n;
  end_try_catch

endfunction
