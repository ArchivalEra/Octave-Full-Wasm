## __pb_axes_arg__ — 这个值是不是"首参指目标图形对象"的那种形状？（纯类型判定）
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## 为什么单独立一个（2026-09-23，HANDOFF §8 待办 7）：核心的 `xlim`/`ylim`/`title`/
## `xlabel`/`ylabel`/`plot`/`bar`/`legend`/`scatter` 都允许 `f(hax, …)` 这种"首参指目标
## axes"的形态。桥只有"当前面板"一份状态，所以只能接受"就是当前 axes"的那一种；
## **"是不是句柄"与"是不是当前 axes"必须分开判** —— 否则这一层就得依赖 toolkit（`gca()`），
## 也就没法在宿主上被测到。
##
## ⚠️ 判定规则**逐条对齐核心**（`plot/util/__plt_get_axis_arg__.m`，2026-09-24 核对原文）：
##
##     isscalar(x) && ishghandle(x) && x != 0 && ! isfigure(x)
##
## · `x != 0`：**0 是 root 对象**，不是 axes —— 核心靠这一条把 `plot(0)`（画一个点）
##   留在"数据"那条路上。桥以前漏了它，于是 `plot(0)`/`xlim(0)` 会被当成"句柄优先"。
## · `! isfigure(x)`：figure 句柄同样不算"目标 axes"（核心原文如此）。
## · 核心后面还有一条 `tag != "legend"` 与"`parent` 属性对"形态 —— 桥不做多面板，
##   不复制这些支路（见 §5.24 的政策：能对齐就对齐，对不齐就明确报错）。
##
## 只用类型谓词。`ishghandle(0)` 不需要任何 toolkit 就能回答，所以本文件的 `%!test`
## 在宿主与浏览器里都跑得动（真 figure/axes 句柄的形状由浏览器套件 `accept-plotv2` 钉住）。
##
## ⚠️ 判定为"是句柄"要**明确报错**而不是静默当数据处理 —— 见 `__pb_strip_axes__.m`：
##    以前 `xlim(hax, [0 1])` 把句柄存成了 xlim，图照画、没人看得出错。

function tf = __pb_axes_arg__ (v)

  tf = (isscalar (v) && ishghandle (v) && v != 0 && ! isfigure (v));

endfunction


%!test
## 数据与选项：一律**不是**句柄（这些形状必须原样当数据/选项用，不许被"剥首参"吃掉）
%! assert (__pb_axes_arg__ (5), false);
%! assert (__pb_axes_arg__ ([0 1]), false);
%! assert (__pb_axes_arg__ (1:10), false);
%! assert (__pb_axes_arg__ ("auto"), false);
%! assert (__pb_axes_arg__ (""), false);
%! assert (__pb_axes_arg__ ([]), false);
%! assert (__pb_axes_arg__ (struct ("a", 1)), false);
%! assert (__pb_axes_arg__ ({1}), false);
%! assert (__pb_axes_arg__ (true), false);
## ★ 0 = root 对象，**不是** axes：核心 `__plt_get_axis_arg__` 明写 `!= 0`。
##   漏掉它，`plot(0)`（合法：画一个点）就会被当"句柄优先"而报错。
%! assert (__pb_axes_arg__ (0), false);

%!test
## figure 句柄也不算（核心同样排除）——句柄本身存在即可测，不需要 toolkit
%! h = figure ("visible", "off");
%! assert (__pb_axes_arg__ (h), false);
%! close (h);

%!test
## 真 axes 句柄才算（宿主上 gca 有 toolkit 就能建出来）
%! h = figure ("visible", "off");
%! a = gca ();
%! assert (__pb_axes_arg__ (a), true);
%! close (h);
