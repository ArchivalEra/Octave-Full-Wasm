// Octave-Full-Wasm — Q4 探针：JS 侧可挂起函数（在 worker 里同样成立）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 与 probe-jspi/jslib.js 同形：返回 Promise 的 import，供页面/worker 侧包成
// `new WebAssembly.Suspending(...)`。这里额外记 tick —— 在 worker 里 setTimeout
// 依然可用，所以"等待期间 tick 递增"这条仪器原样搬过来。
addToLibrary({
  browser_wait_ms: function (ms) {
    Module.__tickAtCall = Module.__tick || 0;
    return new Promise(function (resolve) {
      setTimeout(function () { Module.__tick = (Module.__tick || 0) + 1; resolve(); }, ms);
    });
  },
});
