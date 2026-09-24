## ginput: 交互式取点需要"等用户点击时把 wasm 挂起"的能力（JSPI 车道，见
## build/113/PLAN-next.md 的 G3）—— 本构建还没有，而它以前**挂死页面**（实测 8 s 无响应，
## 比报错更糟的一种"不清晰"）。本文件把挂死变成清晰报错。
##
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## 为什么覆写（2026-09-24，小口子 3）：与 `webshims/popen.m` 同一套路 —— **只影响解释器的
## 名字解析**，C++ 内部直接调用的路径不受影响（本函数是核心 `.m`，没有内部调用者）。
## 覆写后**连带**受益：核心 `gui/waitforbuttonpress.m` 与 `plot/appearance/gtext.m`
## 内部就是调 `ginput`（实测 grep），所以这两个也从"挂死"变成清晰报错。
##
## 实现 G3 时**删掉本文件**即可（页面侧把 DOM 事件收成队列 → resolve Promise → JSPI resume）。

function [x, y, buttons] = ginput (varargin)

  error ("ginput: interactive mouse input is not available in this build (waiting for a click would block the page; see build/113/PLAN-next.md G3); read the coordinates from data instead, or prompt with input()");

endfunction
