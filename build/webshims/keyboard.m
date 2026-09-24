## keyboard: 嵌套命令 REPL 需要"等用户输入时把 wasm 挂起"的能力（JSPI 车道，见
## build/113/PLAN-next.md 的 G5）—— 本构建还没有，而它以前**挂死页面**（实测 8 s 无响应）。
## 本文件把挂死变成清晰报错。
##
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## ⚠️ `keyboard` 是**内建**（`libinterp/corefcn/input.cc`，`exist` 返回 5），不是核心 `.m`
## —— 所以这条覆写靠的是"load path 里的 `.m` 遮得住内建"（与 `webshims/popen.m` 同一个实测
## 结论，启动时会带一条 `shadows a built-in function` 警告，**有意保留**）。
## 覆写只影响解释器的名字解析；调试器内部的 `keyboard` 入口不受影响。
##
## 实现 G5 时删掉本文件即可（第一版只打算支持一层嵌套）。

function keyboard (varargin)

  error ("keyboard: the nested command prompt is not available in this build (it would block the page; see build/113/PLAN-next.md G5); use input() for a single prompt (it works, via window.prompt)");

endfunction
