// Octave-Full-Wasm — JSPI 组合探针（R5）：JS 侧可挂起函数
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ⚠️ 关键点：这个函数**返回 Promise**。在 `-sJSPI` + `-sJSPI_IMPORTS=browser_wait_ms`
//    下，Emscripten 会把它包成 `WebAssembly.Suspending(...)` ⇒ wasm 侧一调它，
//    **整个 wasm 栈就挂起**（不是 Asyncify 那种二进制重写），JS 事件循环继续跑，
//    Promise 落地后从**同一条栈**继续。
//
// 它同时记两个数，用来证伪"其实是在 busy-loop 卡着浏览器"：
//   Module.__tick     ：等待期间被 setTimeout 推进的次数（>0 才算真的让出了事件循环）
//   Module.__tickAtCall：进入时的那一刻（给探针做"tick 发生在 t0 与 t2 之间"的断言）
addToLibrary({
  browser_wait_ms: function (ms) {
    Module.__tickAtCall = Module.__tick || 0;
    return new Promise(function (resolve) {
      setTimeout(function () { Module.__tick = (Module.__tick || 0) + 1; resolve(); }, ms);
    });
  },
});
