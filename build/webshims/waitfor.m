## waitfor: 等"对象被删 / 属性变化 / 点击"需要一个**浏览器事件**才能推进 —— 那要求 wasm
## 能挂起等它（JSPI 车道，见 build/113/PLAN-next.md 的 G3/G5）。本构建没有，而它以前
## **挂死页面**（实测 8 s 无响应）。本文件把挂死变成清晰报错。
##
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## ⚠️ `waitfor` 是**内建**（`libinterp/corefcn/graphics.cc`，`exist` 返回 5）—— 这条覆写靠
## "load path 里的 `.m` 遮得住内建"（与 `webshims/keyboard.m`、`popen.m` 同一个实测结论；
## 启动时那条 `shadows a built-in function` 警告**有意保留**）。
##
## ⚠️ 这也**更正**了 HANDOFF 早先那条"`waitfor` 可用"的记录：那句话只验过"名字存在"，
## 没验语义 —— 实测它在本构建里等不到事件，会一直挂着。现在它明确报错。

function waitfor (varargin)

  error ("waitfor: waiting for an object property or a click is not available in this build (it would block the page; see build/113/PLAN-next.md G3/G5)");

endfunction
