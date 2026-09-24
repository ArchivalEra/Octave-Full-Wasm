## __pb_legend_args__ — legend 的（标签, Location）拆分
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## 核心的 legend 接受三类东西：标签字符串、`"Location", loc` 属性对、以及**首参句柄**
## （`legend(h, "a", "b")`）。桥的图例只有"一串标签 + 一个位置"这点状态，所以：
##
##   · 字符参数        → 标签（除 "Location"，它吃掉后面那个字符串）；
##   · 数值/句柄参数   → **明确报错**。★ 以前它们被**当成标签**存下来 ——
##     `legend(h, "a")` 会在图例里多出一条内容是数字的条目，而核心那层语义（"把图例
##     挂到这个对象上"）一个字都没实现。这是"静默做错"的典型。
##   · 其它类型        → 明确报错（属性/值对桥不支持；静默忽略等于给一个没生效的图例）。
##
## 见 `__pb_axes_arg__.m`（同一批"不许静默曲解"的契约）。

function [labels, loc] = __pb_legend_args__ (args)

  labels = {};
  loc = "";
  i = 1;

  while (i <= numel (args))
    a = args{i};
    if (ischar (a) && strcmpi (a, "location"))
      if (i + 1 > numel (args) || ! ischar (args{i + 1}))
        error ("legend: 'Location' must be followed by a location string");
      endif
      loc = args{i + 1};
      i += 2;
    elseif (ischar (a))
      labels{end + 1} = a;
      i += 1;
    elseif (isnumeric (a) || islogical (a))
      error ("legend: numeric or handle arguments are not supported by the plot bridge (the core handle form legend (h, ...) is not implemented)");
    else
      error ("legend: the plot bridge only accepts label strings and 'Location' (got %s)",
             class (a));
    endif
  endwhile

endfunction


%!test
## 纯标签
%! [l, loc] = __pb_legend_args__ ({"a", "b"});
%! assert (numel (l), 2);
%! assert (l{1}, "a");
%! assert (l{2}, "b");
%! assert (loc, "");

%!test
## 标签 + Location（位置字符串不落进标签）
%! [l, loc] = __pb_legend_args__ ({"sin", "cos", "Location", "NorthWest"});
%! assert (numel (l), 2);
%! assert (l{2}, "cos");
%! assert (loc, "NorthWest");

%!test
## 小写 location 也认（核心 strcmpi）
%! [l, loc] = __pb_legend_args__ ({"a", "location", "south"});
%! assert (numel (l), 1);
%! assert (loc, "south");

%!test
## 空参数：一个标签都没有（不该报错）
%! [l, loc] = __pb_legend_args__ ({});
%! assert (numel (l), 0);

%!error <numeric or handle arguments are not supported> __pb_legend_args__ ({0, "a"})
%!error <numeric or handle arguments are not supported> __pb_legend_args__ ({5, "a"})
## ⚠️ 这里用 `{1}`（以 `{` 开头的元素）而不是 `struct ("x", 1)`：Octave 的 cell 字面量里
##    「函数名 + 空格 + (…）」会掉进命令语法 —— `{struct ("a", 1)}` 实测是**两个**元素。
##    本仓记过两次（`__svg_panel_boxes__.m:24`、HISTORY §5.22 踩坑记）。
%!error <only accepts label strings> __pb_legend_args__ ({"a", {1}})
%!error <must be followed by a location string> __pb_legend_args__ ({"a", "Location"})
%!error <must be followed by a location string> __pb_legend_args__ ({"a", "Location", 12})
