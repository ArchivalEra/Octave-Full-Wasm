## __pb_axes_arg__ — 这个值是不是"指向某个图形对象的句柄"？（纯类型判定）
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## 为什么单独立一个（2026-09-23，HANDOFF §8 待办 7）：核心的 `xlim`/`ylim`/`title`/
## `xlabel`/`ylabel` 都允许 `f(hax, …)` 这种"首参指目标 axes"的形态。桥只有"当前面板"
## 一份状态，所以只能接受"就是当前 axes"的那一种；**"是不是句柄"与"是不是当前 axes"
## 必须分开判** —— 否则这一层就得依赖 toolkit（`gca()`），也就没法在宿主上被测到。
##
## 只用类型谓词。`ishghandle` 不需要任何 toolkit 就能回答（`ishghandle(0)` 恒真：0 是
## root 对象），所以下面几个 `%!test` 在宿主与浏览器里都跑得动。
##
## ⚠️ 判定的"是句柄"要**明确报错**而不是静默当数据处理 —— 见 `__pb_strip_axes__.m`：
##    以前 `xlim(hax, [0 1])` 把句柄存成了 xlim，图照画、没人看得出错。

function tf = __pb_axes_arg__ (v)

  tf = isnumeric (v) && isscalar (v) && ishghandle (v);

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
## 句柄：0 是 root 对象（不需要 toolkit，所以这条在宿主上也成立）。
## 真 figure/axes 句柄的形状由浏览器套件 `accept-plotv2` 的"参数契约"节钉住。
%! assert (__pb_axes_arg__ (0), true);
