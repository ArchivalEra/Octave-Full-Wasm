## Argument splitter for mesh/surf (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Accepts the shapes Octave's surface functions take:
##   f (Z)            → x, y default to grid indices
##   f (Z, SPEC)      → spec is a style string
##   f (X, Y, Z)      → full grid
##   f (X, Y, Z, SPEC)
## plus trailing property/value pairs, which are ignored (**已记录的降级**：曲面照画，
## 桥自己没有属性系统 —— 这与"把数据当别的东西"不同，所以保留）。
##
## ★ `f (Z, C)` 是**明确报错**的一条（2026-09-23，HANDOFF §8 待办 7）：核心把第二个数值
##   参数当**颜色矩阵**（`surf(Z,C)` 是官方形态），而桥以前**静默丢掉**它 —— 形状对、
##   配色与用户给的数据无关。宁可报错，也不给一个"看着对"的图。
##
## 见 `__pb_axes_arg__.m`（同一批"不许静默曲解"的契约）。

function [x, y, z, spec] = __pb_surf_args__ (fname, args)

  x = []; y = []; z = []; spec = "";

  ## drop trailing property/value pairs
  while (numel (args) >= 2 && ischar (args{end - 1}) && ischar (args{end}))
    args(end - 1:end) = [];
  endwhile

  if (numel (args) == 0)
    error ("%s: not enough input arguments", fname);
  endif

  ## trailing spec
  if (ischar (args{end}))
    spec = args{end};
    args(end) = [];
  endif

  switch (numel (args))
    case 1
      z = args{1};
    case 2
      if (isnumeric (args{2}))
        error (["%s: the colour-matrix form %s (Z, C) is not supported by the " ...
                "plot bridge; pass Z only, or use the core toolkit"], fname, fname);
      endif
      z = args{1};
    case 3
      x = args{1}; y = args{2}; z = args{3};
    otherwise
      error ("%s: expected (Z), (X,Y,Z), optionally followed by a style", fname);
  endswitch

  if (! isnumeric (z) || isempty (z))
    error ("%s: Z must be a numeric matrix", fname);
  endif
  if (isvector (z) && ! isempty (x))
    error ("%s: Z must be a matrix", fname);
  endif

endfunction


%!test
## 单参 f(Z)
%! [x, y, z, s] = __pb_surf_args__ ("surf", {[1 2 3; 4 5 6]});
%! assert (isempty (x) && isempty (y), true);
%! assert (z, [1 2 3; 4 5 6]);
%! assert (s, "");

%!test
## f(Z, SPEC)：串是样式，不是数据
%! [x, y, z, s] = __pb_surf_args__ ("surf", {[1 2; 3 4], "facecolor"});
%! assert (z, [1 2; 3 4]);
%! assert (s, "facecolor");

%!test
## 全网格 f(X,Y,Z) 与 f(X,Y,Z,SPEC)
%! [x, y, z, s] = __pb_surf_args__ ("mesh", {1:2, 3:5, [1 2 3; 4 5 6]});
%! assert (x, 1:2);
%! assert (y, 3:5);
%! assert (z, [1 2 3; 4 5 6]);
%! assert (s, "");
%! [x, y, z, s] = __pb_surf_args__ ("mesh", {1:2, 3:5, [1 2 3; 4 5 6], "r"});
%! assert (s, "r");

%!test
## 尾随属性/值对丢掉（已记录的降级：桥没有属性系统）
%! [~, ~, z, s] = __pb_surf_args__ ("surf", {[1 2; 3 4], "EdgeColor", "none"});
%! assert (z, [1 2; 3 4]);
%! assert (s, "");

## ⚠️ 上面一律用**字面矩阵**而不是 `{peaks (5)}` 这种写法：Octave 的 cell 字面量里
##    「函数名 + 空格 + (…）」会掉进**命令语法**（`{peaks (5)}` 实测是**两个**元素：
##    `peaks` 与 `5` —— 而 `peaks` 无参调用返回 49×49！）。这条坑本仓已经记过两次
##    （`__svg_panel_boxes__.m:24`、HISTORY §5.22 踩坑记），写测试时别再踩。
%!error <colour-matrix form> __pb_surf_args__ ("surf", {[1 2; 3 4], [5 6; 7 8]})
%!error <colour-matrix form> __pb_surf_args__ ("mesh", {[1 2; 3 4], [1 1; 1 1]})
## 注意两条会先被别的分支吃掉、落不到本断言上的写法：
##   `{"nope"}`      → 它就是个字符串，走"尾随样式串"那条路 ⇒ 报 "expected (Z), (X,Y,Z)"
##   `{"nope","r"}`  → 两个字符串，走"尾随属性/值对"那条路 ⇒ 报 "not enough input arguments"
## 所以这里用一个非数值、非字符串的 Z（logical 在 Octave 里 `isnumeric` 为假）。
%!error <Z must be a numeric matrix> __pb_surf_args__ ("surf", {true})
%!error <not enough input arguments> __pb_surf_args__ ("surf", {})
