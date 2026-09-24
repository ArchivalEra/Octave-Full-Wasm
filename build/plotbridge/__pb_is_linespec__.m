## __pb_is_linespec__ — 一个字符令牌**是不是线型串**（linespec）
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## 为什么要它：核心 `__plt__.m:92-104` 判定"这个字符串是线型串还是属性名"用的是**一个
## 明确的问句** —— `[~, valid] = __pltopt__ (caller, s, false)`，`valid` 为假就说明它是
## 属性**名**、后面跟着的那个令牌是它的**值**。桥要跟核心同判据，就不能自己拍一张
## "颜色字母表"（`"red"`/`"green"` 这种**全名**是合法线型串，`)`/`;key;` 也是，
## 手写表必然走样）；直接问核心的 `__pltopt__` 才对。
##
## `__pltopt__` 在 `scripts/plot/util/`（**不是** `private/`）⇒ 在我们的加载路径上；
## 同一个目录的 `colstyle` 桥早就在用了（`__pb_add__.m`）。
##
## 保守默认：**判不出来（非字符串 / 空串 / `__pltopt__` 本身抛错）就当它是线型串** ——
## 也就是"什么都不改"的老行为。这样这个 helper 只可能把"以前被当成数据/线型串的东西"
## 改成"属性对"，绝不会反过来把数据当属性名吞掉。

function tf = __pb_is_linespec__ (s)

  tf = true;

  if (! (ischar (s) && ! isempty (s)))
    return;
  endif

  try
    [~, tf] = __pltopt__ ("__pb_is_linespec__", s, false);
  catch
    tf = true;
  end_try_catch

endfunction


%!test
## 合法线型串：颜色 / 线型 / 标记 / 全名 / ;key; 形式（都问核心，不手写表）
%! assert (__pb_is_linespec__ ("r"));
%! assert (__pb_is_linespec__ ("-"));
%! assert (__pb_is_linespec__ ("--"));
%! assert (__pb_is_linespec__ ("o"));
%! assert (__pb_is_linespec__ ("r--o"));
%! assert (__pb_is_linespec__ ("red"));
%! assert (__pb_is_linespec__ ("green"));
%! assert (__pb_is_linespec__ (";mylabel;"));

%!test
## 属性名（核心会把它当"属性名 + 值"）：这些是 2026-09-24 实测里**静默做错**的那些
%! assert (! __pb_is_linespec__ ("parent"));
%! assert (! __pb_is_linespec__ ("linewidth"));
%! assert (! __pb_is_linespec__ ("color"));
%! assert (! __pb_is_linespec__ ("facecolor"));
%! assert (! __pb_is_linespec__ ("tag"));
%! assert (! __pb_is_linespec__ ("userdata"));

%!test
## 保守默认：非字符串与空串都算"线型串"（= 老行为，不当属性名）
%! assert (__pb_is_linespec__ (""));
%! assert (__pb_is_linespec__ (1));
%! assert (__pb_is_linespec__ ({"r"}));
%! assert (__pb_is_linespec__ ([]));
