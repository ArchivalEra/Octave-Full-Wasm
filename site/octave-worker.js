// Octave-Full-Wasm — C3/B5（2026-09-26）：**解释器跑在 DedicatedWorker 里**的宿主
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 为什么要有它：单页模式下解释器占住主线程 ⇒ 一次 `A*B`（2000² 要几秒）就冻页面。
// Worker 模式下 wasm + 虚拟 FS + 资产 + JSPI 全在 worker 里，主线程只剩 DOM 与转发。
// 机制前提都已实测过：Q4（B 姿势 JSPI 在 worker 里 100/100 挂起恢复）、
// E4（worker 里 dlopen 两种 FS 来源都通、挂起穿透 dlopen 边界）。
//
// 协议（主线程 ↔ worker，全部 postMessage）：
//   主 → worker ：{id, kind:'eval', code} / {id, kind:'evalAsync', code}
//                 {id, kind:'loadAssets', names} / {kind:'interrupt'}
//                 {kind:'click', data:[x,y,w,h,button]}
//   worker → 主 ：{kind:'ready'} / {kind:'out', text} / {kind:'plot', path, ab}
//                 {id, kind:'result', rc, err, ms} / {id, kind:'loaded', ok, err}
//
// ⚠️ 三个 worker 特有的坑（都实测/推演过，注释在对应位置）：
//   ① **没有 `window` / `document`**：产物里 toolkit 的 `emscripten_run_script` 会 eval
//      `window.OctaveP5.show(...)`、EM_ASM 会摸 `document` ⇒ 这里提供**最小 shim**
//      （`self.window = self` + `OctaveP5.show` 把 FS 里的图 postMessage 出去 + 只会返回
//      null 的 document），目的是让"没有 DOM"变成**可降级的失败**而不是抛异常打断解释器。
//   ② Forge 包靠 importScripts（见 assets-loader.js 的 worker 分支）。
//   ③ `--preload-file` 的 octave.data 由胶水 locateFile 取 —— 必须给 base 前缀。
//
// 已知边界（phase 1，与 PLAN B5 一致）：**图形真渲染后端（WebGL toolkit）在 worker 里
// 起不来**（EM_ASM 建 canvas 需要真 DOM）⇒ 走 plotbridge 的回落路径；把 WebGL 搬进 worker
// 需要改 webgl_toolkit.cc（canvas 契约 + OffscreenCanvas）并**重链**，属 B5 phase 2。

/* global OCTAVE, createOctaveAssets */
'use strict';

var BASE = '';                      // 由主线程第一条消息里的 opts.base 覆盖（默认同目录）
var booted = false;
var ready = false;
var clickQueue = [];
var armed = false;

function send(m) { self.postMessage(m); }
function out(t) { send({ kind: 'out', text: String(t) }); }

// ── ① 最小 DOM shim ────────────────────────────────────────────────────────
// 只为"让摸 DOM 的代码走到可降级的失败"，**不**假装有真 DOM：
// createElement('canvas') 给的假 canvas 没有真 getContext ⇒ WebGL 初始化会失败并回落。
var fakeCanvas = { id: '', style: {}, width: 16, height: 16,
                   getContext: function () { return null; },
                   getBoundingClientRect: function () { return { left: 0, top: 0, width: 0, height: 0 }; } };
// ★ 显式标记"我在 worker 里"：assets-loader 的 `kind:'js'` 包必须走 importScripts。
//   ⚠️ **不能用 `!document` 探测**——上面这段 shim 会给 worker 装上 document，
//   于是旧判断失效 ⇒ JS 包走 `<script>` 注入（worker 里是空操作）⇒ **promise 永不 settle**，
//   plotbridge/webshims 等包静默装不上（实测：链子卡在"加载 plotbridge …"，
//   连带 pause shim 缺席 ⇒ 中断判据 rc=0）。这条坑记在 NOTES-threads。
self.__octaveWorker = true;
self.document = {
  createElement: function () { return fakeCanvas; },
  getElementById: function () { return null; },
  querySelector: function () { return null; },
  querySelectorAll: function () { return []; },
  body: { appendChild: function () {}, innerText: '' },
  documentElement: { appendChild: function () {} },
  head: { appendChild: function () {} },
  currentScript: null,
};
self.window = self;                 // 产物里 `window.OctaveP5.show(...)` 靠它
// 图形成品：toolkit 渲染完会调它（路径在 MEMFS 里）⇒ 读出来 postMessage 给主线程贴图。
var OctaveP5 = {
  show: function (path) {
    try {
      var M = self.Module;
      if (!M || !M.FS) return;
      var bytes = M.FS.readFile(path);
      var copy = bytes.slice ? bytes.slice(0) : new Uint8Array(bytes);
      send({ kind: 'plot', path: String(path), ab: copy.buffer, bytes: copy.length });
    } catch (e) { out('[worker] OctaveP5.show 读取失败: ' + e); }
  },
  status: function () { return { backend: 'worker-none' }; },
};
self.OctaveP5 = OctaveP5;
self.__octaveClicks = clickQueue;
self.__octaveClicksArmed = false;

// ── 解释器（与页面同一套 B 姿势：包装只在宿主层）─────────────────────────────
var Module = {
  print: function (t) { out(t); },
  printErr: function (t) { out(t); },
  locateFile: function (p) { return BASE + p; },
  instantiateWasm: function (info, receiveInstance) {
    try {
      if (typeof WebAssembly.Suspending === 'function'
          && info && info.env && typeof info.env.web_sleep_ms === 'function') {
        info.env.web_sleep_ms = new WebAssembly.Suspending(info.env.web_sleep_ms);
      }
      // 取点三原语按**本 worker** 覆写（队列在 worker 里，页面点击靠 postMessage 送进来）
      if (info && info.env) {
        var env = info.env;
        if (typeof env.web_ginput_arm_impl === 'function') {
          env.web_ginput_arm_impl = function () { clickQueue.length = 0; armed = true; return 0; };
        }
        if (typeof env.web_ginput_pending_impl === 'function') {
          env.web_ginput_pending_impl = function () { return clickQueue.length; };
        }
        if (typeof env.web_ginput_pop_impl === 'function') {
          env.web_ginput_pop_impl = function (ptr) {
            if (!clickQueue.length) return -1;
            var c = clickQueue.shift();
            var H = new Float64Array(wasmMemory.buffer);
            H[ptr >> 3] = c[0]; H[(ptr + 8) >> 3] = c[1];
            H[(ptr + 16) >> 3] = c[2]; H[(ptr + 24) >> 3] = c[3];
            return c[4] | 0;
          };
        }
      }
    } catch (e) { out('[worker] 挂起包装不可用，降级为无挂起: ' + e); }
    fetch(BASE + 'octave.wasm').then(function (r) { return r.arrayBuffer(); })
      .then(function (b) { return WebAssembly.instantiate(b, info); })
      .then(function (res) {
        wasmMemory = res.instance.exports.memory;
        receiveInstance(res.instance, res.module);
      })
      .catch(function (e) { send({ kind: 'fatal', err: 'instantiate: ' + e }); });
    return {};
  },
  stdin: function () { return null; },     // worker 里没有 prompt：如实 EOF（与 octave-cli < /dev/null 同）
  postRun: function () { bootChain(); },
};
var wasmMemory = null;
var Assets = null;

function bootChain() {
  var CORE = ['convhulln', '__delaunayn__', '__voronoi__', '__glpk__', 'fftw', 'gzip', 'audioread',
              '__web_pause_ms__'];
  var HELP = ['built-in-docstrings', 'doc-cache', 'macros.texi', 'plotbridge', 'webgraphics', 'webdoc', 'pkgfix'];
  Module.execute_interp();
  if (typeof WebAssembly.promising === 'function' && typeof Module._eval_wait === 'function') {
    var p = WebAssembly.promising(Module._eval_wait);
    Module.eval_async = function (code) {
      var n = Module.lengthBytesUTF8(code) + 1;
      var ptr = Module._malloc(n);
      if (!ptr) return Promise.reject(new Error('eval_async: malloc 失败'));
      Module.stringToUTF8(code, ptr, n);
      return p(ptr).finally(function () { Module._free(ptr); });
    };
  }
  Assets = createOctaveAssets(Module, BASE, function () { return ready; });
  Assets.init().then(function () { return Assets.load(CORE).catch(function (e) { out('[assets] 核心组: ' + e.message); }); })
    .then(function () { return Assets.load(HELP).catch(function (e) { out('[assets] help 组: ' + e.message); }); })
    .then(function () { return Assets.load(['pkgfix', 'webshims']).catch(function (e) { out('[assets] pkg: ' + e.message); }); })
    .then(function () {
      try { Module.eval_string("if (exist('__pkgfix_sync_db__')) try; __pkgfix_sync_db__ (); catch; end; end"); } catch (e) {}
      ready = true; booted = true;
      send({ kind: 'ready' });
    })
    .catch(function (e) { ready = true; booted = true; send({ kind: 'ready', warn: String(e.message) }); });
}

importScripts('assets-loader.js', 'octave.js');
OCTAVE(Module);

// ── 消息分发 ────────────────────────────────────────────────────────────────
self.onmessage = function (ev) {
  var m = ev.data || {};
  if (m.kind === 'opts') { BASE = m.base || ''; return; }
  if (m.kind === 'interrupt') {
    try { if (Module._web_request_interrupt) Module._web_request_interrupt(); } catch (e) {}
    return;
  }
  if (m.kind === 'click') { clickQueue.push(m.data); return; }
  if (m.kind === 'loadAssets') {
    Assets.load(m.names).then(function () { send({ id: m.id, kind: 'loaded', ok: true }); },
                              function (e) { send({ id: m.id, kind: 'loaded', ok: false, err: String(e.message || e) }); });
    return;
  }
  if (m.kind === 'eval' || m.kind === 'evalAsync') {
    var t0 = performance.now();
    var done = function (rc, err) {
      send({ id: m.id, kind: 'result', rc: rc, err: err || (function () {
        try { return String(Module.last_error_message() || ''); } catch (e) { return ''; }
      })(), ms: Math.round(performance.now() - t0) });
    };
    try {
      if (m.kind === 'evalAsync') {
        if (!Module.eval_async) { done(-2, 'no-entry: 本产物没有 eval_wait'); return; }
        Module.eval_async(m.code).then(function (rc) { done(Number(rc), ''); },
                                      function (e) { done(-1, String(e).slice(0, 200)); });
      } else {
        done(Module.eval_string(m.code), '');
      }
    } catch (e) { done(-1, String(e).slice(0, 200)); }
    return;
  }
};
send({ kind: 'boot' });
