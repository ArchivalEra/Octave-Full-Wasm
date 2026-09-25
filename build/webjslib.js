// Octave-Full-Wasm — B 姿势 JSPI 的**唯一挂起 import**（G1 批次预埋，G2 接 pause）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ⚠️ 这就是产品里的 `browser_wait_ms`（探针里那个）对应物：
//   · 它**返回 Promise** —— 但本文件**不**加 `__async` 标记！实测（A2 最小实验，NOTES-jspi）：
//     `-sJSPI` 下 Emscripten 会把带 `.isAsync` 的 import 一律包成 Suspending，连带把
//     `dlopen` 也变成挂起点；B 姿势不加 `-sJSPI`，包装完全由页面钩子
//     （bridge/index.html 的 `instantiateWasm`，只包 `web_sleep_ms` 这一个）决定。
//   · main.cc 的 `web_pause_ms`（wasm 导出，webpause.oct 引用）转发到这里；
//     在 promising 栈（`eval_wait`）上调用 ⇒ 整个 wasm 栈真挂起，页面定时器照常。
//   · 记 tick 以便验收证伪 busy-loop：等待期间 `Module.__tick` 必须增加。
addToLibrary({
  web_sleep_ms: function (ms) {
    Module.__tickAtCall = Module.__tick || 0;
    return new Promise(function (resolve) {
      setTimeout(function () { Module.__tick = (Module.__tick || 0) + 1; resolve(); }, ms);
    });
  },
});
