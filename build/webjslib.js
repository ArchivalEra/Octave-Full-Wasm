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
  // ── 批次 3：D9 门槛 + G3 取点原语（即返，不挂起）──────────────────────────
  // ⚠️ 这些 import 只有在 main.cc 引用了对应转发器时才会出现在主模块 import 表里，
  //    页面钩子才包得到/调得到。pop 写double 经 HEAPF64（jslib 作用域里就有）。
  web_suspend_ok_impl: function () {
    return (typeof WebAssembly.Suspending === 'function') ? 1 : 0;
  },
  web_ginput_arm_impl: function () {
    window.__octaveClicks = [];
    window.__octaveClicksArmed = true;
    return 0;
  },
  web_ginput_pending_impl: function () {
    return (window.__octaveClicks || []).length;
  },
  // v = [x, y, rectW, rectH]（画布 CSS px，y 向下）；返回按键 1/2/3，空 = -1
  web_ginput_pop_impl: function (ptr) {
    var q = window.__octaveClicks || [];
    if (!q.length) return -1;
    var c = q.shift();
    HEAPF64[ptr >> 3] = c[0];
    HEAPF64[(ptr + 8) >> 3] = c[1];
    HEAPF64[(ptr + 16) >> 3] = c[2];
    HEAPF64[(ptr + 24) >> 3] = c[3];
    return c[4] | 0;
  },
});
