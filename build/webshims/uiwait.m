## uiwait: "等用户动作"（关窗/`uiresume`）需要一个**浏览器事件**才能推进 —— 那要求 wasm
## 能挂起等它（JSPI 车道，见 build/113/PLAN-next.md 的 G3/G5）。本构建没有，而它以前
## **挂死页面**（实测 8 s 无响应）。本文件把挂死变成清晰报错。
##
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## 为什么值得覆写：核心 `gui/` 里 **`dialog.m` / `questdlg.m` / `uisetfont.m`** 都靠它
##（实测 grep）。覆写后这些对话框一律"清晰报错"而不是"停在那里不动" —— 后者对用户
## 而言是**页面卡死**，最坏的一种失败方式。
##
## 覆写只影响解释器的名字解析；C++ 内部不直接调它。

function uiwait (varargin)

  error ("uiwait: waiting for user interaction is not available in this build (it would block the page; see build/113/PLAN-next.md G3/G5)");

endfunction
