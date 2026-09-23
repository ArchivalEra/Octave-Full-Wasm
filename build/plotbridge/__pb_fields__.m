## Octave-Full-Wasm — plot 桥"单个面板的状态字段"**唯一声明处**（own code, repo license）
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## ── 为什么要有这张表 ────────────────────────────────────────────────────────
## 2026-09-23 的胶水层审计查出：同一份"面板字段集合"在**四个地方各写一遍**（必须逐字同步）：
##
##   `__pstate__.m`          初始化 14 个字段 + 缺字段回填（7 行 isfield 守卫）
##   `__pb_panel_fields__`   把面板字段摘出来（15 个字段）
##   `__pb_apply_panel__`    把面板字段放回去（15 个字段，顺序必须一一对应）
##   `__pb_clear_series__`   "新轴"要重置的那 12 个字段
##
## 加一个字段要改四处，**漏一处是静默的状态泄漏**（例如只在 clear 里漏了它，上一张图的
## 设置就串到下一张）。现在：加字段 = 改下表的**一行**。
##
## （2026-09-23 审计候选 1 把第五处 —— spec JSON 发射器 `__pb_emit__.m` —— 整个删掉了：
##  那条出口的读者只有 PoC 页 `octplot.html`，而"无 GL 设备要能看到图"这件事改由
##  `print -dsvg`/`__svg_render__` 承担，于是表里原来那一列 `spec_key` 也随之消失。）
##
## ── 表的结构 ────────────────────────────────────────────────────────────────
##   names     — 字段名（cell of char）
##   defaults  — 该字段"新轴/新面板"时的值（cell，与 names 等长）
##   cleared   — `__pb_clear_series__`（新轴）是否重置它
##
## ── ⚠️ 不在表里的字段（图/全局级，**别加进来**）──────────────────────────────
##   n         — `/tmp/pbN.dat` 的计数器。它**必须跨面板、跨 figure 单调递增**，
##               否则恢复图后写出的数据文件会互相覆盖（审计专门点了这条）。
##   panels    — 子图 cell（活动面板由本表这些扁平字段镜像）
##   active    — 镜像中的面板下标
##   figs/fig_n— `figure(n)` 的切换记账
##   这几个由 `__pstate__.m` 单独初始化与回填，别混进这张表 —— 混进来就等于给
##   "每面板一份"的语义塞进了"全局一份"的东西。

function f = __pb_fields__ ()

  f = struct ();
  f.names = {"hold", "title", "xlabel", "ylabel", "xlim", "ylim", "grid", "legloc", ...
             "logx", "logy", "axis", "legend", "series", "panel_pos", "panel_tag"};
  f.defaults = {false, "", "", "", [], [], false, "", ...
                false, false, "", {}, {}, [], ""};
  f.cleared = [false, true, true, true, true, true, true, true, ...
               true, true, true, true, true, false, false];
  f.cleared = logical (f.cleared);

endfunction


%!test
## 表自身必须自洽（长度一致、名字唯一）—— 这张表是其余三处的单一真源，它错了全错
%! f = __pb_fields__ ();
%! n = numel (f.names);
%! assert (n, 15);
%! assert (numel (f.defaults), n);
%! assert (numel (f.cleared), n);
%! assert (numel (unique (f.names)), n);
## 每个 default 的类型/形状要跟字段语义对得上（防"复制粘贴时串行"）
%! for k = 1:n
%!   v = f.defaults{k};
%!   switch (f.names{k})
%!     case {"xlim", "ylim", "panel_pos"}, assert (isempty (v));
%!     case {"legend", "series"},          assert (iscell (v) && isempty (v));
%!     case {"hold", "grid", "logx", "logy"}, assert (islogical (v) && ! v);
%!     otherwise,                          assert (ischar (v) && isempty (v));
%!   endswitch
%! endfor
## 一组回归：**摘出→放回**必须逐字段往返（这是 stamp/restore 的全部契约）
%! f = __pb_fields__ ();
%! s = struct ();
%! for k = 1:numel (f.names), s.(f.names{k}) = f.defaults{k}; endfor
%! s.title = "往返";  s.xlim = [0 5];  s.series = {{}};  s.hold = true;
%! s.panel_pos = [0.1 0.2 0.3 0.4];  s.panel_tag = "t1";  s.grid = true;
%! p = __pb_panel_fields__ (s);
%! s2 = struct ();
%! for k = 1:numel (f.names), s2.(f.names{k}) = f.defaults{k}; endfor
%! s2 = __pb_apply_panel__ (s2, p);
%! for k = 1:numel (f.names)
%!   nm = f.names{k};
%!   assert (isequal (s.(nm), s2.(nm)), sprintf ("字段 %s 往返不一致", nm));
%! endfor
## clear（新轴）只重置表里 cleared 的那些，hold / panel_pos / panel_tag 必须活下来
%! s = struct ();
%! for k = 1:numel (f.names), s.(f.names{k}) = f.defaults{k}; endfor
%! s.hold = true;  s.grid = true;  s.title = "x";  s.panel_pos = [0 0 1 1];  s.panel_tag = "p";
%! s = __pb_clear_series__ (s);
%! assert (s.hold, true);            # hold 不受新轴影响
%! assert (s.panel_pos, [0 0 1 1]);  # 面板记账不属于"轴内容"
%! assert (s.panel_tag, "p");
%! assert (s.grid, false);           # 轴内容被重置
%! assert (s.title, "");
