## __pb_integerhandle_off__ — 属性对里有没有 `"integerhandle","off"`
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## 为什么要单独一个 helper：这一对参数决定了 `__go_figure__` 的第一个实参必须是 **NaN**
## （"让 Octave 自己分配句柄"）而不是一个具体整数 —— 传整数会被 Octave 当成
## "在这个号上建图"，而带 `integerhandle=off` 时那个号并不存在，于是报
## `graphics_handle::free: invalid object N` / `invalid graphics object`。
## 实测（2026-09-24，8768）：`__go_figure__(5,"integerhandle","off")` 坏、
## `__go_figure__(NaN,"integerhandle","off")` 好（返回 -1.345，`ishghandle`=1）。
##
## 谁在用这一对：**waitbar / dialog / uisetfont** 都带（核心 `figure.m` 在"没给图号"时
## 传的本来就是 NaN）—— 桥以前一律传自己的面板号，于是这族函数全部死在
## `get: invalid handle (= 2)`（一句看不出根因的错，小口子 3 的靶子）。
##
## 判据写成纯函数是为了**宿主可测**（不需要 toolkit）。值可能是 char，也可能是单元素
## cellstr（Octave 的属性值两种都收）。

function tf = __pb_integerhandle_off__ (props)

  tf = false;

  if (! iscell (props) || isempty (props))
    return;              ## 非 cell（或空）⇒ 没有这一对；也免了 `x{1}` 在数值数组上直接报错
  endif

  for k = 1:2:(numel (props) - 1)
    if (! (ischar (props{k}) && strcmpi (props{k}, "integerhandle")))
      continue;
    endif
    v = props{k + 1};
    if (ischar (v) && strcmpi (v, "off"))
      tf = true;
      return;
    endif
    if (iscellstr (v) && numel (v) == 1 && strcmpi (v{1}, "off"))
      tf = true;
      return;
    endif
  endfor

endfunction


%!test
## 带这一对（waitbar/dialog/uisetfont 的形态）
%! assert (__pb_integerhandle_off__ ({"units", "pixels", "integerhandle", "off", "tag", "waitbar"}));
%! assert (__pb_integerhandle_off__ ({"integerhandle", "off"}));
%! ## 大小写与单元素 cellstr 都收
%! assert (__pb_integerhandle_off__ ({"IntegerHandle", "Off"}));
%! assert (__pb_integerhandle_off__ ({"integerhandle", {"off"}}));

%!test
## 不带、或值是 on、或根本不是这一对：都不是"非整数句柄"
%! assert (! __pb_integerhandle_off__ ({}));
%! assert (! __pb_integerhandle_off__ ({"units", "pixels", "tag", "waitbar"}));
%! assert (! __pb_integerhandle_off__ ({"integerhandle", "on"}));
%! assert (! __pb_integerhandle_off__ ({"name", "integerhandle"}));   ## 是**值**不是名
%! assert (! __pb_integerhandle_off__ ({"integerhandle"}));          ## 孤零零一个（不成对）
%! assert (! __pb_integerhandle_off__ ([1 2 3]));                    ## 非 cell
