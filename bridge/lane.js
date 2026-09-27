// Octave-Full-Wasm — **选档**：线程档 / 基础档（B6，2026-09-27）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 为什么必须有它 ────────────────────────────────────────────────────────────
// 线程档的产物（`-pthread` ⇒ wasm 内存 **shared**）在**没有跨源隔离**的页面上**连实例化都
// 做不到**：SharedArrayBuffer 不可用 ⇒ 胶水建内存就崩（实测报错是
// `DataCloneError: … SharedArrayBuffer transfer requires self.crossOriginIsolated`）。
// 所以"用哪一档"必须在**加载胶水之前**、用**同步**判据决定 —— 不能等异步探测回来再选。
//
// ── 判据（两条都要）────────────────────────────────────────────────────────────
//   `crossOriginIsolated === true` —— 宿主发了 `Cross-Origin-Opener-Policy: same-origin`
//     + `Cross-Origin-Embedder-Policy: require-corp`（**要求宿主发头**是本轮的产品决定）
//   `typeof SharedArrayBuffer === 'function'` —— 有些环境有隔离但没有 SAB（少见，但白测一次便宜）
// 两条都满足 ⇒ 线程档；否则 ⇒ 基础档（**任何静态托管都能跑**，这是不能退的红线）。
//
// ── 两档都在（红线）──────────────────────────────────────────────────────────
// 线程档**不许**是唯一产物：文件同名，线程档放在 `threads/` 子目录里（`threads/octave.js`…）。
// 为什么是子目录而不是改文件名：Emscripten 胶水里**写死了** `octave.data` 这个名字，
// 换名就得同时改胶水内部引用；放进子目录则胶水一行不用改，`locateFile` 一处前缀搞定。
// 资产（`assets/`）与清单**两档共用**根目录那一份 ⇒ 不重复部署 9.7MB 的 `octave.data`。
(function (global) {
  'use strict';

  // 显式覆盖（测试/调试用）：URL 上写 `?lane=threads` 或 `?lane=base`。
  // ⚠️ 覆盖**不改判据** —— 它只改"选哪一档"，物理前提（COI）仍是硬的：
  //    在没隔离的页面上强行选 threads ⇒ 胶水建 shared 内存当场抛。
  //    这正是我们要能证伪的那一条（`probe-lane` 的第 4 格：**必须响亮地失败**）。
  function override(env) {
    try {
      var q = (env.location && env.location.search) || '';
      var m = /[?&]lane=(threads|base)(?:&|$)/.exec(q);
      return m ? m[1] : null;
    } catch (e) { return null; }
  }

  // 纯函数：给一份"环境事实"返回该选哪一档（自证/探针可直接喂合成输入）
  function pickFrom(env) {
    var coi = env.crossOriginIsolated === true;
    var sab = typeof env.SharedArrayBuffer === 'function';
    var auto = (coi && sab)
      ? { lane: 'threads', why: '跨源隔离 + SharedArrayBuffer 都可用' }
      : { lane: 'base',
          why: !coi ? '没有跨源隔离（宿主未发 COOP/COEP ⇒ 用基础档）'
                    : 'SharedArrayBuffer 不可用（用基础档）' };
    var ov = override(env);
    if (ov && ov !== auto.lane) {
      return { lane: ov, coi: coi, sab: sab, forced: true,
               why: '显式覆盖为 ' + ov + '（环境本来该选 ' + auto.lane + '）'
                    + (ov === 'threads' && !coi
                       ? '；⚠️ 没有 COI ⇒ 线程档会**硬失败**（这是有意的可证伪档）' : '') };
    }
    return { lane: auto.lane, coi: coi, sab: sab, forced: false, why: auto.why };
  }

  var FILES = {
    // data 两档共用根目录那一份 —— 前提是两档的 `octave.data` **sha 相同**（链接后核对，
    // 记录在 HANDOFF/PLAN 里）。若哪天不同了，把 threads 的 data 改成 'threads/octave.data'
    // 并把文件部署过去即可（探针 probe-lane 会核对"胶水要的文件真的取得到"）。
    // ★ 两档**只有 `.oct` 那部分资产不同**（2026-09-27 实测）：非 atomics 编的 side module 在
    //   shared-memory 主模块里连 dlopen 都过不去（`TypeError: tlsInitFunc is not a function`，
    //   见 NOTES-threads.md B5）⇒ 线程档必须用自己的 `.oct` 集（`oct-threads/`、`octdir-threads/`），
    //   其余资产（.m 包 / 文档 / 字体数据）两档共用。清单里逐条带 `url`，所以"分档"= 换一份清单。
    threads: { lane: 'threads', dir: 'threads/',
               js: 'threads/octave.js', wasm: 'threads/octave.wasm', data: 'octave.data',
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
