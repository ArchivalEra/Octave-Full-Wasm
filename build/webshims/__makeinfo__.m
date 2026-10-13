## __makeinfo__: 无 shell 的构建里**渲染不了 texinfo** —— 本文件把它降级成"剥标记的纯文本"。
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## ── 为什么要覆写（实测，2026-10-13；工单 66）─────────────────────────────────
## 上游 `scripts/help/__makeinfo__.m` 的**唯一职责**是把 texinfo 标记渲成纯文本，实现是
## `system(["makeinfo …"])`。本构建**无 shell**（铁律）⇒ 那一步抛
## `system: unable to start subprocess for 'makeinfo …'`。
##
## 后果**不是**"帮助少了"，而是**把最有用的信息换成最没用的**：
##   · `table()` / `datetime()` / `string()` 这类 **Octave 认识、本构建装不上**的名字，
##     走 `scripts/help/__unimplemented__.m:549` —— 它先生成 "… is not yet implemented in
##     Octave" 再调 `__makeinfo__` 渲染，**渲染抛错盖掉了那句话** ⇒ 用户看到的是
##     "内部工具炸了"，而真相是"这个函数我们还没实现"（实测：8761 上 `table()` 报的就是
##     makeinfo 子进程错，而 `zzz_abc()` 报得很干净）。
##   · `help table` 同理（`help.m:110`）。
## 对照：`help sin`（len=105）、`help ode45`（len=2807）**能读** —— 它们的 docstring 走的是
## **已渲染**的 `doc-cache`/内建 DOCSTRINGS（format 不是 texinfo）⇒ 根本没到 `__makeinfo__`。
##
## ── 本覆写的判据（保守：只做"没有 makeinfo 时该做的事"）──────────────────────
##   · `output_type == "texinfo"` ⇒ 上游本来就是**原样返回**（不渲染）⇒ 行为不变；
##   · 其余（plain text / html）⇒ 上游要 shell out。本构建**做不到**，于是：
##       - **剥掉 texinfo 标记**（`__webshim_strip_texinfo__` 干这件事），
##         给一段**人能读**的文本 —— 比报"子进程起不来"有用得多；
##       - `status = 0`（**渲染成功**：我们确实产出了可读文本；报非 0 会让调用方
##         走它的"retry --force"分支，那还是要 shell）。
##   ⚠️ 这是**降级**，不是等价：`@math{}`/复杂表格等无法完美还原。**如实记**在
##      `build/GAPS.md`（能力边界）—— 别宣称"help 完整"。
##
## ── 为什么放在 webshims（而不是改上游树）──────────────────────────────────
## ① 上游树是 submodule pin 的，改它 = 动 pin（本仓不干）；
## ② 这类"本构建形态决定的适配"统一在 `build/webshims/`（system/popen/pkg 同族）；
## ③ 只影响**名字解析**（`addpath` 后本目录排在核心之前）—— C++ 内部直接调的不受影响，
##    而 `__makeinfo__` 是纯 `.m`、由 `help`/`__unimplemented__` 按名调用 ⇒ 拦得住。

function [retval, status] = __makeinfo__ (text, output_type, fsee_also)

  if (nargin < 1)
    print_usage ();
  endif
  if (! ischar (text))
    error ("__makeinfo__: first input argument must be a string");
  endif
  if (nargin < 2 || isempty (output_type))
    output_type = "plain text";
  endif
  if (! ischar (output_type))
    error ("__makeinfo__: second input argument must be a string");
  endif

  ## texinfo 请求：上游本就原样返回（不渲染）⇒ 一字不改（保持上游语义）
  if (strcmpi (output_type, "texinfo"))
    status = 0;
    retval = text;
    return;
  endif

  ## 其余：本构建无 makeinfo ⇒ **降级为剥标记**。
  ## ⚠️ 不抛错、不警告：调用方（help / __unimplemented__）要的是"能读的一段字"，
  ##    而我们给了；弹警告会把 `pkg load` 之类的正常输出刷屏。
  retval = __webshim_strip_texinfo__ (text);
  status = 0;

endfunction


%!test
## 顶层：texinfo 请求原样返回（上游语义不变）
%! [t, s] = __makeinfo__ ("@code{x}", "texinfo");
%! assert (s, 0);
%! assert (t, "@code{x}");

%!test
## 顶层：plain text 请求 ⇒ 剥标记（本构建无 makeinfo 的降级）
%! [t, s] = __makeinfo__ ("Return @code{true}.", "plain text");
%! assert (s, 0);
%! assert (t, "Return true.");

%!test
## ★ 反向：非法输入仍要报错（覆写不许把上游的入参检查弄丢）
%! fail ("__makeinfo__ (123)", "must be a string");
%! fail ("__makeinfo__ ('x', 456)", "must be a string");
