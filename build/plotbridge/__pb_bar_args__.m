## __pb_bar_args__ — bar/barh 的参数拆分（与核心 `__bar__.m:52-62` 同一规则）
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## 核心的规则（逐字抄自 `scripts/plot/draw/private/__bar__.m`）：
##   `bar(x, w)` 里 **w 是宽度**，判定条件是 `isscalar(w) && ! isscalar(x)`；
##   其余情况第二个数值参数就是 Y。`bar(2, 3)`（两个都是标量）核心按 (x,y) 数据处理。
##
## ★ 为什么桥要对宽度**明确报错**（2026-09-23，HANDOFF §8 待办 7）：桥画不出宽度，而它
##   以前把那个标量当成 **X 数据** —— `bar(1:5, 0.5)` 会画出 5 根位置由 `0.5` 决定、
##   数量还不对的柱子。观感上"有个图"，但与用户要的东西无关。宁可报错。
##
## 见 `__pb_axes_arg__.m`（同一批"不许静默曲解"的契约）。

function [x, y, extra] = __pb_bar_args__ (fname, args)

  if (numel (args) < 1)
    print_usage (fname);
  endif

  x = []; y = args{1}; extra = args(2:end);

  if (numel (args) >= 2 && isnumeric (args{2}))
    if (isscalar (args{2}) && ! isscalar (args{1}))
      error ("%s: the bar width argument is not supported by the plot bridge (%s (x, w)); drop it or use the core toolkit",
             fname, fname);
    endif
    x = args{1}; y = args{2}; extra = args(3:end);
  endif

  if (! isnumeric (y) || isempty (y))
    error ("%s: Y must be numeric", fname);
  endif

endfunction


%!test
## 单参：f(Y)
%! [x, y, e] = __pb_bar_args__ ("bar", {1:3});
%! assert (isempty (x), true);
%! assert (y, 1:3);
%! assert (numel (e), 0);

%!test
## 双参都是数据：f(X, Y)
%! [x, y] = __pb_bar_args__ ("bar", {[1 2 3], [4 5 6]});
%! assert (x, [1 2 3]);
%! assert (y, [4 5 6]);

%!test
## 两个都是标量：核心按 (x,y) 数据处理（不是宽度）—— 桥必须与核心一致
%! [x, y] = __pb_bar_args__ ("bar", {2, 3});
%! assert (x, 2);
%! assert (y, 3);

%!test
## 单参 + 样式串：串进 extra，不参与拆分
%! [x, y, e] = __pb_bar_args__ ("bar", {1:3, "stacked"});
%! assert (isempty (x), true);
%! assert (y, 1:3);
%! assert (e{1}, "stacked");

%!test
## 双参 + 样式串
%! [x, y, e] = __pb_bar_args__ ("bar", {[1 2], [3 4], "grouped"});
%! assert (x, [1 2]);
%! assert (y, [3 4]);
%! assert (e{1}, "grouped");

%!error <width argument is not supported> __pb_bar_args__ ("bar", {1:5, 0.5})
%!error <width argument is not supported> __pb_bar_args__ ("barh", {1:5, 0.5})
%!error <Y must be numeric> __pb_bar_args__ ("bar", {"nope"})
