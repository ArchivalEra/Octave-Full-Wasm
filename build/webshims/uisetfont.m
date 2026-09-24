## uisetfont: 字体选择对话框要"等用户按按钮"的能力（JSPI 车道，见
## build/113/PLAN-next.md 的 G3/G5）—— 本构建还没有。**实测（2026-09-24）它以前挂死**
## （8 s 无响应）：核心 `uisetfont.m` 走 `__ok_cancel_dlg__` → `dialog` → `uiwait`，
## 而 `uiwait`/`waitfor` 在本构建里永远等不到"用户动作"这个事件。
##
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## 覆写只影响解释器的名字解析（本函数是核心 `.m`，没有内部调用者）。**不用**它就直接设属性：
##   `set (h, "fontname", "FreeSans", "fontsize", 12)`；
## 想知道有哪些字体用 `listfonts()`（R3 之后可用：本构建只有 4 个 FreeSans 面）。

function uisetfont (varargin)

  error ("uisetfont: the font-picker dialog is not available in this build (it waits for a button press, which would block the page; see build/113/PLAN-next.md G3/G5); set the font properties directly, e.g. set (h, \"fontname\", \"FreeSans\", \"fontsize\", 12)");

endfunction
