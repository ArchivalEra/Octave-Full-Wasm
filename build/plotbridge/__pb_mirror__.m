## plot 桥 → 真图形对象 的**镜像层**（own code, repo license）。
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## ── 为什么需要它 ────────────────────────────────────────────────────────────
## 本目录的 .m 是"plot 桥"：它把用户的 plot/surf/bar/... **只记进自己的状态**
## （`__pstate__` 里的 series/panels），**一个真图形对象都不建** —— 那是 v1 时代的
## 设定：本构建当时没有任何 toolkit，画面由 JS/SVG 侧渲染，所以"真对象"没有用。
##
## P5 把真渲染器接上之后，这个设定的后果立刻暴露：`plot(...); drawnow`
## 渲出来的是一张**白图**，因为真 figure 里根本没有 line 对象可画。
## 实测（2026-09-23，8765）：
##     plot(1:10,(1:10).^2);  findall(gcf,"type","axes") = 0, "line" = 0
##     surf(peaks(13));       findall(gcf,"type","axes") = 0, "surface" = 0
##     line([0 1],[0 1]);     真对象正常（不经桥）
##     title("t");            1 个真 axes（title 走 gca，gca 会建 axes）
##  ⇒ 渲染管线本身是好的，缺的只是"桥不建对象"。
##
## ── 做法：再调一次**同名核心函数** ──────────────────────────────────────────
## 不是"桥自己用 `__go_line__` 拼对象"：核心 plot 的实现细节很多（newplot 的清理、
## box、颜色循环、矩阵按列展开、hold 语义……），手抄一遍必然走样；而且 `__plt__`
## 是 `plot/draw/private/` 的**私有**函数，桥在别的目录里根本调不到
##（私有函数只对 `private/` 的父目录里的文件可见）。
##
## ⚠️ **核心调用期间，被桥挡住的那些名字必须都解析回核心实现**，不能只换顶层那一个：
##    核心实现**内部还会按名字调别的被挡函数**。实测（2026-09-23）：
##    `pie`/`contour` 走"只换顶层"的方案必炸在
##        error: axis: limits must be a 2- or 4-element vector
##        called from axis … __pie__ at line 158
##    因为核心 `__pie__` 里写的是 `axis (h, [-1.5 1.5 -1.5 1.5], "square", "off")`
##    ——**首参是句柄**，而桥的 `axis.m` 只认"当前 axes"那两种形式。
##    同类还有 `__plt__.m:154` / `__errplot__.m:279` 的 `legend (gca (), …)`。
##
## ── 两种实现它的方式（本文件只做第二种）────────────────────────────────────
##   ① 旧：**每次调用**把桥目录从 path 上摘掉 → feval 同名核心函数 → 恢复 path。
##      语义正确，但一次 `path()` 重扫整条路径实测 ~0.13 s ⇒ **每图多 ~0.26 s**，
##      是桥 `figure; clf; surf(peaks(40))` 剩下那 ~480 ms 的大头。
##   ② 现（2026-09-23 起）：**一次性**取核心句柄，之后永不再动 path；核心调用期间用
##      深度计数让每个被挡 shim 把调用**转发**回核心（= ①的语义，逐点等价）。
##      实现与两个必须知道的坑（DEPTH 要在错误路径复位；**输出个数检查发生在函数体之前**，
##      所以 shim 声明的输出个数必须 ≥ 核心实现的）全在 **`__pb_core__.m`** 的文件头，
##      各 shim 的那段前导由 `build/plotbridge/insert-core-forward.py` 插入。
##
## ── ⚠️ 只在"真渲染器在线"时才镜像 ─────────────────────────────────────────
## 默认的 `web` toolkit（T2）**不渲染**，它只提供图形对象句柄语义。在那种模式下
## 镜像只会凭空多出一堆真 line/surface 对象、改掉 `findall`/`get`/`numel(allchild)`
## 的语义 —— T2 那批验收（`test/browser/accept-t2-graphics.mjs`）正是按老语义写的。
## 所以 `__pb_real_renderer__` 用一个白名单卡住：只有真会渲染的 toolkit 才镜像。
##
## 用法（在桥的 .m 里）：
##     h = __pb_mirror__ ("plot", varargin{:});   ## 有返回值的绘图函数
##     __pb_mirror__ ("hold", varargin{:});       ## 纯状态函数

function h = __pb_mirror__ (fname, varargin)

  h = [];

  if (! __pb_real_renderer__ ())
    return;
  endif

  ## ⚠️ 有返回值的绘图函数写成 `h = __pb_mirror__(...)`，纯状态函数（hold/clf/…）
  ##    写成 `__pb_mirror__(...)`。这个区分必须传下去：Octave 里
  ##    `h = feval("hold", "on")` 会报 **"hold: function called with too many
  ##    outputs"**（实测踩到），因为 hold 一个返回值都没有。
  if (nargout > 0)
    h = __pb_core__ (fname, varargin{:});
  else
    __pb_core__ (fname, varargin{:});
  endif

endfunction
