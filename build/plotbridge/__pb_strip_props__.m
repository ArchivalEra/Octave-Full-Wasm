## __pb_strip_props__ — 把**属性对**从桥自己的参数解析里剥掉
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## ── 它修的是什么（2026-09-24 实测，全是**静默**的）────────────────────────
## 桥的每个 shim 都自己解析位置参数，**没有一个认得出"属性对"**：
##
##   `plot(1:3,2:4,'parent',gca())`  → 桥状态记了 **2 条**序列（第 2 条是 `y=句柄数值`）
##   `plot(1:3,2:4,'linewidth',2)`   → 同样 2 条（`'linewidth'` 被当成线型串、`2` 被当成数据）
##   `surf(X,Y,Z,'parent',gca())`    → 桥状态 **一条都不记**（`__pb_surf_args__` 的"丢属性对"
##                                     循环只认**值也是字符**的形态，句柄值落进数据槽）
## 而真渲染器那条路（镜像把**原样 varargin** 交给核心）一直是对的 —— 所以错的是**桥状态**，
## 后果在**无 GL 设备的 SVG 回落**上：多画一条不存在的线 / 整张图空掉。
##
## ── 判据跟核心同一条，不自己发明 ────────────────────────────────────────
## `__plt__.m:92-104`：字符令牌当线型串试；**不合法 ⇒ 它是属性名，下一个令牌是它的值**。
## 这里逐字复现那个规则（合法性问 `__pb_is_linespec__` ⇒ 核心的 `__pltopt__`）。
## 剥掉是**安全**的：核心照旧拿到完整的 varargin（`__pb_mirror__` 那一步用的是原样参数），
## 所以 `'linewidth',2` 这类属性**仍然真的生效**，只是不进桥状态。
##
## ── `'parent'` 是唯一的例外：要**校验**，不能一剥了事 ─────────────────────
## 核心允许 `'parent'` 是任意 axes（画到那个 axes 上），桥只有当前面板一份状态 ⇒
## `gca()` 之外一律**明确报错**（`__pb_check_parent__`），理由写在那个文件里。
##
## ── 保守之处（有意）──────────────────────────────────────────────────────
## **末尾那个** 不合法字符令牌（后面没有值了）**不动** —— 老行为把它当线型串，这里保持。
## 核心在那种形态上报 `properties must appear followed by a value`，但改成报错会动到
## 一批现有脚本的可见行为，不属于本项要修的东西；要收紧另开一项。

function args = __pb_strip_props__ (fname, args)

  out = {};
  i = 1;
  n = numel (args);

  while (i <= n)
    a = args{i};
    if (i < n && ischar (a) && ! __pb_is_linespec__ (a))
      if (strcmpi (a, "parent"))
        __pb_check_parent__ (fname, args{i + 1});
      endif
      i += 2;            ## 属性名 + 它的值，一起剥掉
      continue;
    endif
    out{end + 1} = a;
    i += 1;
  endwhile

  args = out;

endfunction


%!test
## 没有属性对：一个令牌都不动，顺序也不动
%! r = __pb_strip_props__ ("plot", {1:3, 2:4});
%! assert (numel (r), 2);
%! assert (r{1}, 1:3);
%! r = __pb_strip_props__ ("plot", {1:3, "r--"});
%! assert (numel (r), 2);
%! assert (r{2}, "r--");
%! r = __pb_strip_props__ ("plot", {});
%! assert (numel (r), 0);

%!test
## 值不是字符的属性对也被剥掉（这就是 `'linewidth',2` 那条）
%! r = __pb_strip_props__ ("plot", {1:3, 2:4, "linewidth", 2});
%! assert (numel (r), 2);
%! r = __pb_strip_props__ ("plot", {1:3, "linewidth", 2});
%! assert (numel (r), 1);
%! assert (r{1}, 1:3);

%!test
## 值也是字符的属性对（surf 那条循环本来只认这一种）
## ⚠️ cell 字面量里**不许**写 `magic (3)` 这种"函数名 + 空格 + (…)"：那会掉进命令语法、
##    变成**两个**元素（`magic` 与 `3`），`magic` 无参调用直接报错 —— 本仓记过两次的坑
##    （`__pb_surf_args__.m:92`、HISTORY §5.22）。一律用字面矩阵。
%! r = __pb_strip_props__ ("surf", {1:3, 1:3, [1 2 3; 4 5 6; 7 8 9], "facecolor", "interp"});
%! assert (numel (r), 3);

%!test
## 夹在中间的属性对（核心允许属性对出现在数据之后、任意位置）
%! r = __pb_strip_props__ ("plot", {1:3, 2:4, "linewidth", 2, "r--"});
%! assert (numel (r), 3);
%! assert (r{2}, 2:4);
%! assert (r{3}, "r--");

%!test
## 'parent' == gca()：剥掉（桥状态就是当前面板）
%! h = figure ("visible", "off");
%! a = gca ();
%! r = __pb_strip_props__ ("plot", {1:3, 2:4, "parent", a});
%! assert (numel (r), 2);
%! close (h);

%!test
## 'parent' 不是 axes 句柄 ⇒ 与核心同句报错；
## 是别的 axes ⇒ 报"桥只管当前 axes"（两条都不是静默通过）
%! h1 = figure ("visible", "off");
%! a1 = gca ();
%! h2 = figure ("visible", "off");
%! a2 = gca ();
%! figure (h1);
%! nope = false;
%! try
%!   __pb_strip_props__ ("plot", {1:3, "parent", 99});
%! catch err
%!   nope = ! isempty (strfind (err.message, "must be an axes handle"));
%! end_try_catch
%! assert (nope, true);
%! nope = false;
%! try
%!   __pb_strip_props__ ("plot", {1:3, "parent", a2});
%! catch err
%!   nope = ! isempty (strfind (err.message, "only tracks the current axes"));
%! end_try_catch
%! assert (nope, true);
%! close (h1);
%! close (h2);

%!test
## 末尾的"孤零零不合法字符"**不动**（有意保留老行为，见文件头"保守之处"）
%! r = __pb_strip_props__ ("surf", {[1 2 3; 4 5 6; 7 8 9], "interp"});
%! assert (numel (r), 2);
%! assert (r{2}, "interp");
