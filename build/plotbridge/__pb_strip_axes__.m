## __pb_strip_axes__ — 剥掉"首参是目标 axes 句柄"那一层（核心允许 `f(hax, …)`）
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## 为什么需要它（2026-09-23，HANDOFF §8 待办 7）：核心的 `xlim`/`ylim`/`title`/`xlabel`/
## `ylabel` 都接受 `f(hax, …)`。桥只有**当前面板**一份状态，因此：
##
##   · 首参不是句柄        → 原样返回（走原来的数据/选项路径）；
##   · 首参就是 `gca()`    → 剥掉它，其余照旧（与核心等价）；
##   · 首参是别的句柄      → **明确报错**（桥管不到别的 axes）；
##   · 一个句柄都没有（没有 toolkit）→ 也报错，而不是把它当数据存下来。
##
## ★ 这一层是"静默做错"的直接受害者：以前 `xlim(hax, [0 1])` 会把**句柄**当成限值存进
##   桥状态（`s.xlim = varargin{1}(:).'`），图照画、没人看得出哪里不对。宁可报错。

function args = __pb_strip_axes__ (fname, args)

  if (numel (args) < 1 || ! __pb_axes_arg__ (args{1}))
    return;
  endif

  h = args{1};
  cur = [];
  try
    cur = gca ();          ## 没有任何 toolkit 时这里会报错 ⇒ 当作"不是当前 axes"
  catch
    cur = [];
  end_try_catch

  if (isempty (cur) || h != cur)
    error ("%s: the plot bridge only tracks the current axes; leading handle %g is not gca()",
           fname, h);
  endif

  args(1) = [];

endfunction


%!test
## 首参不是句柄：原样返回（一个都不动，顺序也不动）
%! r = __pb_strip_axes__ ("xlim", {[0 1]});
%! assert (numel (r), 1);
%! assert (r{1}, [0 1]);
%! r = __pb_strip_axes__ ("xlim", {"auto"});
%! assert (r{1}, "auto");
%! r = __pb_strip_axes__ ("xlim", {});
%! assert (numel (r), 0);

%!test
## 首参就是当前 axes：剥掉，其余保持
%! h = figure ("visible", "off");
%! a = gca ();
%! r = __pb_strip_axes__ ("xlim", {a, [0 1]});
%! assert (numel (r), 1);
%! assert (r{1}, [0 1]);
%! close (h);

%!test
## 是 axes 但**不是**当前 axes：明确报错（这是"静默做错"改"清晰报错"的那一条）
%! ## ⚠️ 必须用**真 axes 句柄**：2026-09-24 收紧 `__pb_axes_arg__`（对齐核心的
%! ##    `__plt_get_axis_arg__`）之后，**figure 句柄不再算"首参句柄"** —— 以前这条测试
%! ##    拿 h2（一个 figure）冒充"别的 axes"，是**因为判据太松才过**的。
%! h1 = figure ("visible", "off");
%! a1 = gca ();
%! h2 = figure ("visible", "off");
%! a2 = gca ();
%! figure (h1);                              ## a1 是当前
%! caught = false;
%! try
%!   __pb_strip_axes__ ("xlim", {a2, [0 1]});
%! catch err
%!   caught = ! isempty (strfind (err.message, "only tracks the current axes"));
%! end_try_catch
%! assert (caught, true);
%! close (h1);
%! close (h2);

%!test
## figure 句柄与 0（root 对象）都**不是**"目标 axes" ⇒ 按核心一样落到"数据/选项"那条路
%! h = figure ("visible", "off");
%! r = __pb_strip_axes__ ("plot", {h, 1, 2});
%! assert (numel (r), 3);
%! r = __pb_strip_axes__ ("plot", {0, 1, 2});
%! assert (numel (r), 3);
%! close (h);
