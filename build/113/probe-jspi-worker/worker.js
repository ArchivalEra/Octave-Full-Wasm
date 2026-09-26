// Octave-Full-Wasm — Q4 探针：DedicatedWorker host（B 姿势 JSPI 在 worker 里的落地）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 为什么要有它：C3（把解释器搬进 DedicatedWorker）唯一没实测过的机制就是
// "Suspending/promising 在 worker 全局里是否照常"。worker 里没有 document、
// 没有 window.prompt，但 setTimeout/fetch/WebAssembly 都在。
//
// ⚠️ 坑（2026-09-25 实测，代价一整轮排查）：非模块化胶水**污染全局作用域**
//    （自带 run/doRun/Module/FS/environ_get…）。本文件第一版把自己的 async 函数
//    命名成 `run` ⇒ 覆盖胶水的 `run()` ⇒ 重入 initRuntime ⇒
//    `RangeError: Maximum call stack size exceeded`（栈顶显示 `_environ_get`，
//    极具误导性）。⇒ **所有自定义名字一律 `q4*` 前缀**。

var Q4N = 100;          // 挂起/恢复次数
var Q4WAIT = 1;         // 每次等待毫秒（tick 仪器需要 >0）

var q4Log = [];
function q4Say(s) { q4Log.push(String(s)); if (q4Log.length > 400) q4Log.shift(); }

var q4Result = {
  apiSuspending: typeof WebAssembly.Suspending === 'function',
  apiPromising: typeof WebAssembly.promising === 'function',
  n: Q4N, ok: 0, fails: [], ticks: 0, wallMs: 0, ping: null, error: null,
  rt: null, pre: null, e4Ms: null,
};

self.Module = {
  print: q4Say,
  printErr: q4Say,
  locateFile: function (p) { return p; },
  onRuntimeInitialized: function () { q4ProbeRun().catch(function (e) { q4Result.error = String(e); q4Finish(); }); },
  // B 姿势：唯一挂起 import 在**worker 侧**包成 Suspending，胶水不加任何 -sJSPI 旗标。
  // 钩子完全接管实例化（5.0.7 契约：返回 {}）。
  // ⚠️ 必须**原地改 `info.env` 并把 `info` 原样传下去**（复制 env 会触发惰性 getter 自引用）。
  instantiateWasm: function (info, receiveInstance) {
    try {
      if (typeof WebAssembly.Suspending === 'function'
          && info && info.env && typeof info.env.browser_wait_ms === 'function') {
        info.env.browser_wait_ms = new WebAssembly.Suspending(info.env.browser_wait_ms);
      } else if (typeof WebAssembly.Suspending !== 'function') {
        q4Result.error = 'api-missing: WebAssembly.Suspending 在 worker 里不存在';
        q4Finish();
        return {};
      }
    } catch (e) {
      q4Result.error = 'wrap-failed: ' + String(e).slice(0, 140);
      q4Finish();
      return {};
    }
    fetch('main.wasm')
      .then(function (r) { return r.arrayBuffer(); })
      .then(function (b) { return WebAssembly.instantiate(b, info); })
      .then(function (out) { receiveInstance(out.instance, out.module); })
      .catch(function (e) { q4Result.error = 'instantiate: ' + String(e).slice(0, 200)
              + ' || stack: ' + String(e && e.stack || '').slice(0, 900); q4Finish(); });
    return {};
  },
};

importScripts('main.js');

async function q4ProbeRun() {
  // 对照组：不碰挂起 import 的同步入口
  q4Result.ping = Module._worker_ping(35);            // 期望 42

  if (typeof WebAssembly.promising !== 'function') {
    q4Result.error = 'api-missing: WebAssembly.promising 在 worker 里不存在';
    return;
  }
  var wait = WebAssembly.promising(Module._worker_wait);
  var t0 = performance.now();
  for (var i = 0; i < Q4N; i++) {
    try {
      var r = await wait(Q4WAIT);
      if (r === Q4WAIT + 1) q4Result.ok++; else q4Result.fails.push('iter' + i + ':ret=' + r);
    } catch (e) {
      q4Result.fails.push('iter' + i + ':throw=' + String(e).slice(0, 120));
    }
  }
  q4Result.wallMs = Math.round(performance.now() - t0);
  q4Result.ticks = Module.__tick || 0;

  // ── E4：worker 里 dlopen × 两种 FS 来源 ──────────────────────────────
  // rt  = 运行时 fetch → FS.writeFile（产品资产装载形态）
  // pre = --preload-file 烘进 main.data（产品 octave.data 形态）
  // 两个入口都经 side_chain 回调主模块的 worker_wait（挂起 import）⇒ 全链挂起。
  var sideBuf = await (await fetch('side.wasm')).arrayBuffer();
  Module.FS.writeFile('/side_rt.wasm', new Uint8Array(sideBuf));
  var dlopenRt = WebAssembly.promising(Module._worker_dlopen_rt);
  var dlopenPre = WebAssembly.promising(Module._worker_dlopen_pre);
  var tE4 = performance.now();
  q4Result.rt = await dlopenRt(50);     // 期望 52 = 50 +1(worker_wait) +1(side_chain)
  q4Result.pre = await dlopenPre(50);   // 期望 52
  q4Result.e4Ms = Math.round(performance.now() - tE4);

  // 反向断言（B6 的 worker 版）：**没包 promising** 的直调碰挂起 import 必须炸。
  try {
    var r2 = Module._worker_wait(1);
    q4Result.unpromising = 'no-throw:ret=' + r2;
  } catch (e) {
    q4Result.unpromising = 'throw:' + String(e).slice(0, 140);
  }
  q4Finish();
}

function q4Finish() {
  q4Result.ticks = (self.Module && Module.__tick) || q4Result.ticks;
  q4Result.log = q4Log.slice(-12);
  self.postMessage(q4Result);
}
