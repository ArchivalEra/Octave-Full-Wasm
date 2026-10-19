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
// ── 两格矩阵（2026-10-19 用户点令二次裁决：w64-base 回退格废除——master 线必须
//    COI+多线程，无 COI 唯一线 = wasm32（base）；wasm64 不存在单线程产品形态）──
//   1. COI + SAB + m64 ⇒ `w64`（wasm64 多线程档，master/IP 线产物）
//   2. 其余一切 ⇒ `base`（wasm32 单线程 —— 无 COI 环境的唯一线）
//   死档（出现即非法）：threads（wasm32+atomics）、w64-base（wasm64 单线程）
//
// ── ★ 第三轴：**站点到底有哪些档**（工单 23，2026-09-30）──────────────────────
// 为什么需要：四格是**能力**上的最优；但站点可能**只部署了其中几档**
//   （8761/8768 只有 base+threads）。能力驱动的选择器在那种站点上会挑 `w64` 并 **404** ——
//   而"站点少一档"没有任何闸门会拦。所以：**候选档必须既能力可行、又在站点清单里**。
// 清单从哪来：装配期生成的 `lanes.js`（`build/gen-lanes.sh <站点目录>` 按磁盘上真实存在的
//   目录写 `global.__octaveLanes = [...]`），在 lane.js **之前**加载。
//   它**不是**手写文件 —— 手写就会漂（今天正是"手抄清单漂了两份资产"）。
// 没有清单时（老站点/第三方镜像）：退回 [base] 并**打一条告警**（threads 已删）；
//   wasm64 那两档**只在清单里声明了才可能被自动选中**（避免在没部署的站点上 404）。
//   显式 `?lane=w64` 仍然照旧**硬失败**（覆盖不改判据 —— 那是有意的可证伪档）。
(function (global) {
  'use strict';

  // 站点清单：装配期生成的 lanes.js 会设 global.__octaveLanes
  function declaredLanes(env) {
    try {
      var inv = env && env.__octaveLanes;
      if (Object.prototype.toString.call(inv) === '[object Array]' && inv.length) return inv;
    } catch (e) { /* 下面退回历史形态 */ }
    return null;   // 未声明
  }

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

  // 显式覆盖（测试/调试用）：URL 上写 `?lane=w64` 或 `?lane=base`（w64-base 已死档，写它会被忽略落自动选档）。
  // ⚠️ 覆盖**不改判据** —— 它只改"选哪一档"，物理前提仍是硬的：
  //    在没隔离的页面上强行选 w64 ⇒ 胶水建 shared 内存当场抛。
  //    这正是我们要能证伪的那一条（`probe-lane` 的反证档：**必须响亮地失败**）。
  function override(env) {
    try {
      var q = (env && env.location && env.location.search) || '';
      var m = /[?&]lane=(w64|w64-threads|base)(?:&|$)/.exec(q);
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
        : { lane: 'base',
            why: !coi ? '没有跨源隔离 ⇒ 用基础档（master 线必须 COI+多线程；无 COI 唯一线 = wasm32）'
                      : 'SharedArrayBuffer 不可用 ⇒ 用基础档（同上：wasm64 无单线程产品形态）' };
    } else {
      // ★ 三线裁决（2026-10-17）：非 m64 一律 base —— wasm32 永远单线程，
      //   不存在"wasm32 多线程档"（threads 档已删，COI+SAB 不再改变 wasm32 的选择）。
      auto = { lane: 'base',
               why: !coi ? '没有跨源隔离（宿主未发 COOP/COEP ⇒ 用基础档）'
                         : (sab ? '没有 memory64（wasm32 线 = 单线程基础档）'
                                 : 'SharedArrayBuffer 不可用（wasm32 线 = 单线程基础档）') };
    }

    // ★ 第三轴（工单 23）：能力可行 **且** 站点部署了 —— 否则按优先级退下一优。
    //   没有清单时只认 [base]（threads 已删；wasm64 两档必须在清单里才可选）。
    var inv = declaredLanes(env);
    var floor = ['base'];
    var avail = inv || floor;
    var whyInv = inv ? ('站点清单声明 ' + inv.join('/'))
                     : '站点**没有**档清单（lanes.js 缺失）⇒ 按 [base] 判定';
    if (avail.indexOf(auto.lane) < 0) {
      var order = ['w64', 'base'];
      var fallback = null;
      for (var i = 0; i < order.length; i++) {
        if (avail.indexOf(order[i]) >= 0) {
          // 只退到**能力可行**的那几档：wasm64 线程档要求 COI+SAB+m64
          var cand = order[i];
          var okCap = (cand === 'base') || (cand === 'w64' && coi && sab && m64);
          if (okCap) { fallback = cand; break; }
        }
      }
      if (fallback) {
        auto = { lane: fallback,
                 why: '能力本会选 ' + auto.lane + '，但' + whyInv
                      + ' ⇒ 退到 ' + fallback };
      } else {
        auto = { lane: 'base',
                 why: '能力本会选 ' + auto.lane + '，但' + whyInv
                      + '，且没有能力可行的已部署档 ⇒ 退到 base（任何静态托管的底线）' };
      }
    }

    var ov = override(env);
    // ★ B6（2026-09-27 实测）：**Worker 模式（`?worker=1`）默认落基础档**。
    //   原因：线程产物在 DedicatedWorker 里当**主宿主**是未验证组合 —— 实测 `accept-worker`
    //   在 COI 下 4 PASS / 12 FAIL（症状 `Module.eval_string is not a function`：pthread 胶水
    //   在这个上下文里没把导出挂上），而**同一份页面在基础档下 16/0 全绿**（8770 实测）。
    //   （threads 档已删；显式 `?lane=` 覆盖永远赢（可证伪）。
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
               why: 'worker 宿主：w64 产物在 DedicatedWorker 里当主宿主**未验证**'
                    + '（实测 accept-worker 4/12）⇒ 用基础档（wasm32 线 = 单线程）' };
    }
    if (ov && ov !== auto.lane) {
      var whyWarn = '';
      if ((ov === 'w64' || ov === 'w64-threads') && !coi) {
        whyWarn = '；⚠️ 没有 COI ⇒ 线程档会**硬失败**（这是有意的可证伪档；无 COI 唯一线 = base）';
      } else if ((ov === 'w64' || ov === 'w64-threads') && !m64) {
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
