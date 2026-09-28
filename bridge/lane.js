// Octave-Full-Wasm — **选档**：线程档 / 基础档 × wasm32 / wasm64（工单 18，2026-09-28）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 为什么必须有它 ────────────────────────────────────────────────────────────
// 两条正交轴：
//   轴 1：跨源隔离（COI：crossOriginIsolated && typeof SharedArrayBuffer === 'function'）
//     线程档产物（`-pthread` ⇒ wasm 内存 **shared**）在没有跨源隔离的页面上连实例化都做不到。
//   轴 2：memory64 支持（`WebAssembly.Memory({initial:1n,address:"i64"})` 可用性）
//     64 位 WebAssembly 在不支持 memory64 的引擎上无法实例化。
// 必须在**加载胶水之前**、用**同步**判据决定 —— 不能等异步探测回来再选。
//
// ── 四格矩阵（优先级从高到低）────────────────────────────────────────────────
//   1. COI + m64 ⇒ `w64`（wasm64 多线程档，目标形态）
//   2. 非COI + m64 ⇒ `w64-base`（wasm64 单线程基础档）
//   3. COI + 非m64 ⇒ `threads`（wasm32 线程档）
//   4. 非COI + 非m64 ⇒ `base`（wasm32 单线程基础档）
(function (global) {
  'use strict';

  function hasMemory64(env) {
    if (env && typeof env.memory64 === 'boolean') return env.memory64;
    try {
      var WA = (env && env.WebAssembly) || (typeof WebAssembly !== 'undefined' ? WebAssembly : null);
      if (!WA || typeof WA.Memory !== 'function') return false;
      var m = new WA.Memory({ initial: 1n, address: 'i64' });
      return m instanceof WA.Memory;
    } catch (e) {
      return false;
    }
  }

  // 显式覆盖（测试/调试用）：URL 上写 `?lane=w64`、`?lane=w64-base`、`?lane=threads` 或 `?lane=base`。
  // ⚠️ 覆盖**不改判据** —— 它只改"选哪一档"，物理前提仍是硬的：
  //    在没隔离的页面上强行选 threads/w64 ⇒ 胶水建 shared 内存当场抛。
  //    这正是我们要能证伪的那一条（`probe-lane` 的反证档：**必须响亮地失败**）。
  function override(env) {
    try {
      var q = (env && env.location && env.location.search) || '';
      var m = /[?&]lane=(w64|w64-threads|w64-base|threads|base)(?:&|$)/.exec(q);
      return m ? m[1] : null;
    } catch (e) { return null; }
  }

  // 纯函数：给一份"环境事实"返回该选哪一档（自证/探针可直接喂合成输入）
  function pickFrom(env) {
    env = env || {};
    var coi = env.crossOriginIsolated === true;
    var sab = typeof env.SharedArrayBuffer === 'function';
    var m64 = hasMemory64(env);

    var auto;
    if (m64) {
      auto = (coi && sab)
        ? { lane: 'w64', why: '跨源隔离 + SharedArrayBuffer + memory64 可用（目标 wasm64 线程档）' }
        : { lane: 'w64-base',
            why: !coi ? '没有跨源隔离（宿主未发 COOP/COEP ⇒ 用 wasm64 基础档）'
                      : 'SharedArrayBuffer 不可用（用 wasm64 基础档）' };
    } else {
      auto = (coi && sab)
        ? { lane: 'threads', why: '跨源隔离 + SharedArrayBuffer 都可用（wasm32 线程档）' }
        : { lane: 'base',
            why: !coi ? '没有跨源隔离（宿主未发 COOP/COEP ⇒ 用基础档）'
                      : 'SharedArrayBuffer 不可用（用基础档）' };
    }

    var ov = override(env);
    // ★ B6（2026-09-27 实测）：**Worker 模式（`?worker=1`）默认落基础档**。
    //   原因：线程产物在 DedicatedWorker 里当**主宿主**是未验证组合 —— 实测 `accept-worker`
    //   在 COI 下 4 PASS / 12 FAIL（症状 `Module.eval_string is not a function`：pthread 胶水
    //   在这个上下文里没把导出挂上），而**同一份页面在基础档下 16/0 全绿**（8770 实测）。
    //   要线程档得**显式** `?lane=threads&worker=1`（走"显式覆盖"分支：失败由它自己硬失败，
    //   不做静默降级）。⚠️ 这条只在**没有显式覆盖**时生效 —— 显式 `?lane=` 永远赢（可证伪）。
    var q = (function () {
      try { return (env.location && env.location.search) || ''; } catch (e) { return ''; }
    })();
    if ((/[?&]worker=1(?:&|$)/.test(q) || typeof env.importScripts === 'function') && !ov) {
      // ★ 两个触发条件都要：
      //   ① 页面上的 `?worker=1`（把解释器交给 worker 的那种加载姿势）；
      //   ② **本上下文自己就是一个 worker 宿主**（`importScripts` 是 worker 专有；
      //      页面没有它）。
      return { lane: 'base', coi: coi, sab: sab, memory64: m64, forced: false, workerMode: true,
               why: 'worker 宿主：线程产物在 DedicatedWorker 里当主宿主**未验证**'
                    + '（实测 accept-worker 4/12）⇒ 用基础档；要线程档请显式 ?lane=threads' };
    }
    if (ov && ov !== auto.lane) {
      var whyWarn = '';
      if ((ov === 'threads' || ov === 'w64' || ov === 'w64-threads') && !coi) {
        whyWarn = '；⚠️ 没有 COI ⇒ 线程档会**硬失败**（这是有意的可证伪档）';
      } else if ((ov === 'w64' || ov === 'w64-threads' || ov === 'w64-base') && !m64) {
        whyWarn = '；⚠️ 没有 memory64 支持 ⇒ wasm64 档会**硬失败**（这是有意的可证伪档）';
      }
      return { lane: ov, coi: coi, sab: sab, memory64: m64, forced: true,
               why: '显式覆盖为 ' + ov + '（环境本来该选 ' + auto.lane + '）' + whyWarn };
    }
    return { lane: auto.lane, coi: coi, sab: sab, memory64: m64, forced: false, why: auto.why };
  }

  var FILES = {
    w64: { lane: 'w64', dir: 'w64/',
           js: 'w64/octave.js', wasm: 'w64/octave.wasm', data: 'w64/octave.data',
           manifest: 'assets/manifest.w64.json' },
    'w64-threads': { lane: 'w64', dir: 'w64/',
                     js: 'w64/octave.js', wasm: 'w64/octave.wasm', data: 'w64/octave.data',
                     manifest: 'assets/manifest.w64.json' },
    'w64-base': { lane: 'w64-base', dir: 'w64-base/',
                  js: 'w64-base/octave.js', wasm: 'w64-base/octave.wasm', data: 'w64-base/octave.data',
                  manifest: 'assets/manifest.w64.json' },
    threads: { lane: 'threads', dir: 'threads/',
               js: 'threads/octave.js', wasm: 'threads/octave.wasm', data: 'threads/octave.data',
               manifest: 'assets/manifest.threads.json' },
    base: { lane: 'base', dir: '',
            js: 'octave.js', wasm: 'octave.wasm', data: 'octave.data',
            manifest: 'assets/manifest.json' }
  };

  function filesFor(lane) { return FILES[lane] || FILES.base; }

  global.octaveLanePick = pickFrom;
  global.octaveLaneFiles = filesFor;
  global.octaveLaneState = pickFrom(global);          // 开机**只算一次**
  global.octaveLanePlan = filesFor(global.octaveLaneState.lane);
})(typeof window !== 'undefined' ? window : self);
