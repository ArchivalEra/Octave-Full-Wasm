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
var HOME = '/home/web_user';        // 由 opts.home 覆盖（多 worker 必须各用各的，否则同源撞同一个库）
'use strict';

var BASE = '';                      // 由主线程第一条消息里的 opts.base 覆盖（默认同目录）
var booted = false;      // 仅用于记录（就绪由 st.ready 表达）
// 点击队列**对象**（内核按这个接口用：clear/length/push/shift）；
// `self.__octaveClicks` 仍指向里面的**数组**（webjslib 原始实现与既有断言读它）。
var clickQ = {
  list: [],
  length: function () { return clickQ.list.length; },
  push: function (c) { clickQ.list.push(c); },
  shift: function () { return clickQ.list.shift(); },
  clear: function () { clickQ.list.length = 0; },
};

function send(m) { self.postMessage(m); }
// ── stdout **合批**（背压；2026-09-26 补，源自外部评审 C-4）──────────────────
// 裸发的问题：`for i=1:50000, printf(...)` 会产生 5 万条 postMessage，主线程事件循环被
// 淹没 ⇒ 页面 tick 再次跌零（worker 不卡 CPU 但卡消息队列）。这里按"16ms 或 8KB"合批；
// **发 result 之前必须 flush**，否则输出与结果顺序会乱。
var outBuf = [], outBytes = 0, outTimer = null;
function flushOut() {
  if (outTimer) { clearTimeout(outTimer); outTimer = null; }
  if (!outBuf.length) return;
  send({ kind: 'out', text: outBuf.join('\n') });
  outBuf.length = 0; outBytes = 0;
}
function out(t) {
  t = String(t);
  outBuf.push(t); outBytes += t.length;
  if (outBytes >= 8192) flushOut();
  else if (!outTimer) outTimer = setTimeout(flushOut, 16);
}

// ── ① 最小 DOM shim ────────────────────────────────────────────────────────
// 只为"让摸 DOM 的代码走到可降级的失败"，**不**假装有真 DOM：
// createElement('canvas') 给的假 canvas 没有真 getContext ⇒ WebGL 初始化会失败并回落。
// ★ B5 phase 2 尝试（2026-09-26）：**交出一个真的 OffscreenCanvas** ——
//   读 Emscripten 5.0.7 的源码得出：胶水只需要一个"能被 getContext('webgl2') 的对象"
//   （`findCanvasEventTarget` → `specialHTMLTargets[target] || document.querySelector(target)`，
//    拿到后就自己调 getContext）。而 `OffscreenCanvas.getContext('webgl2')` **在 worker 里可用**
//   ⇒ 理论上不需要任何重链/新旗标，只要 shim 把 canvas 交给它。
//   若成立，worker 模式就有**真渲染后端**了（渲染→glReadPixels→PNG→postMessage→页面贴图）。
//   `style` 用普通可写属性（OffscreenCanvas 是可扩展对象，工具包会写 style）。
var _glCanvas = null;
function makeCanvas(id) {
  var c = new OffscreenCanvas(16, 16);
  c.id = id || '';
  c.style = {};                     // 工具包会写 cssText/position 等，给个可写壳
  _glCanvas = c;                    // EM_ASM 建完会写 c.id ⇒ 之后 getElementById/querySelector 能查到
  return c;
}
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
  // 真 canvas（OffscreenCanvas）—— 见上面 makeCanvas 的说明
  createElement: function (tag) {
    if (String(tag).toLowerCase() === 'canvas') return makeCanvas('');
    return fakeCanvas;
  },
  getElementById: function (id) { return (_glCanvas && _glCanvas.id === id) ? _glCanvas : null; },
  querySelector: function (sel) {
    if (typeof sel === 'string' && sel.charAt(0) === '#') {
      return (_glCanvas && _glCanvas.id === sel.slice(1)) ? _glCanvas : null;
    }
    if (sel === 'canvas') return _glCanvas;
    return null;
  },
  querySelectorAll: function () { return _glCanvas ? [_glCanvas] : []; },
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
self.__octaveClicks = clickQ.list;
self.__octaveClicksArmed = false;

// ── 内核（★ A2：与页面宿主**共用同一份** bridge/octave-core.js）──────────────────
// 这一侧只提供"只有 worker 才知道的"那几件（见 core 文件头的 10 件接口）：
//   print/printErr → out()（合批 postMessage）、note 同上、stdinLine 恒 null（如实 EOF）、
//   doc = 上面那个 shim、assets = createOctaveAssets、onReady = 发 ready 消息。
// ⚠️ `importScripts` 必须在 createOctaveCore **之前**（要用 assets-loader 的工厂），
//    而 OCTAVE(Module) 必须在 createOctaveCore **之后**（内核提供 instantiateWasm/postRun）。
// ★ B6（2026-09-27）**选档**：先决定用哪一档，再按档 importScripts 胶水。
//   worker 里 `crossOriginIsolated` 继承自页面（同源 worker），判据与页面侧同一份（lane.js）。
//   ⚠️ 顺序不能反：线程档胶水在被 import 的那一刻就会建 **shared** 内存，没有隔离会直接崩。
importScripts('assets-loader.js', 'octave-core.js', 'lanes.js', 'lane.js');
var LANE = octaveLaneFiles(octaveLaneState.lane);
importScripts(LANE.js);

var st = { armed: false, ready: false, mem: null, mod: null };
var core = createOctaveCore({
  // ⚠️ base 传**函数**（活取）：BASE 是 `opts` 消息到达时才设的，晚于这一句。
  base: function () { return BASE; }, mode: 'worker', isDefault: true, home: HOME, state: st, clicks: clickQ,
  lane: LANE,                                   // B6：选档计划（线程档时 wasm 在 threads/）
  host: {
    print: function (t) { out(t); },
    printErr: function (t) { out(t); },
    note: function (m) { out(m); },
    stdinLine: function () { return null; },   // worker 里没有 prompt：如实 EOF（与 octave-cli < /dev/null 同）
    doc: self.document,                        // 上面那个最小 shim
    assets: function (mod, b, isReady) { return createOctaveAssets(mod, b, isReady); },
    onReady: function (e) {
      st.ready = true; booted = true;
      send(e ? { kind: 'ready', warn: String(e.message || e) } : { kind: 'ready' });
    },
  },
});
var Module = core.module;      // 顶层 var ⇒ 顺带挂上 self.Module（OctaveP5.show 读它）
OCTAVE(Module);

// ── 请求队列：同一时刻只跑一个解释器任务（挂起期间也不例外）───────────────────
var jobQueue = [], jobBusy = false;
function enqueue(m) { jobQueue.push(m); pumpQueue(); }
function pumpQueue() {
  if (jobBusy || !jobQueue.length) return;
  var m = jobQueue.shift();
  jobBusy = true;
  runJob(m, function () { jobBusy = false; pumpQueue(); });
}

// ── 消息分发 ────────────────────────────────────────────────────────────────
self.onmessage = function (ev) {
  var m = ev.data || {};
  if (m.kind === 'opts') {
    BASE = m.base || '';
    if (m.home) HOME = m.home;
    core.mountHome(m.home);     // ★ A2：挂载在内核里（幂等；只在还没挂过时用新 home）
    return;
  }
  if (m.kind === 'interrupt') {
    try { if (Module._web_request_interrupt) Module._web_request_interrupt(); } catch (e) {}
    return;
  }
  if (m.kind === 'click') { clickQ.push(m.data); return; }
  if (m.kind === 'diagnose') {
    // 自证用：把 worker **内部**的状态读出来（页面读不到 worker 的 FS/GL）
    //   tk    = graphics_toolkit() 的实际值（经虚拟 FS 取回，不靠 printf 匹配）
    //   nogl  = 工具包的"无 GL 回落信号文件"是否存在（存在 ⇒ 没拿到 GL 上下文）
    //   glCtx = 我们自己交出去的那个 OffscreenCanvas 上是否真有 WebGL2 上下文
    var d = {};
    try {
      Module.eval_string('fid=fopen("/tmp/_diag.txt","w"); fprintf(fid,"%s",graphics_toolkit()); fclose(fid);');
      d.tk = new TextDecoder().decode(Module.FS.readFile('/tmp/_diag.txt'));
    } catch (e) { d.tk = 'ERR:' + String(e).slice(0, 60); }
    try { d.nogl = Module.FS.analyzePath('/tmp/p5_nogl.txt').exists ? 1 : 0; } catch (e) { d.nogl = -1; }
    try { d.glCtx = !!(_glCanvas && _glCanvas.getContext('webgl2')); } catch (e) { d.glCtx = 'ERR'; }
    d.glSize = _glCanvas ? (_glCanvas.width + 'x' + _glCanvas.height) : '(无)';
    // ★ A2：Capabilities（D4）也一起回 —— worker 里没有 window.*，诊断通道是唯一读得到的地方。
    try { d.caps = core.caps; } catch (e) { d.caps = 'ERR'; }
    send({ id: m.id, kind: 'diag', d: d });
    return;
  }
  if (m.kind === 'loadAssets') {
    Assets.load(m.names).then(function () { send({ id: m.id, kind: 'loaded', ok: true }); },
                              function (e) { send({ id: m.id, kind: 'loaded', ok: false, err: String(e.message || e) }); });
    return;
  }
  if (m.kind === 'eval' || m.kind === 'evalAsync') {
    // ── ★ 重入防护（外部评审 C-1）：**JSPI 挂起期间严禁再次进入同一个实例** ──
    // 挂起时 wasm 栈是活的，再调一次入口 V8 会抛
    //   `RuntimeError: Suspend error: instance is already suspended`
    // ⇒ 这里一律**排队**（FIFO），不裸调；interrupt/click 是带外消息，不排队。
    enqueue(m);
    return;
  }
  if (m.kind === '__crash_test') {
    // ★ 工单 08 的判据通道（2026-09-29）：worker 里**所有**消息路径都有守卫 ⇒
    //   真实崩溃（OOM / 引擎杀 / 未捕获异常）无法从测试侧确定性复现，onerror 判据
    //   就没法写。这个 kind 在**一切 try/catch 之外**（setTimeout 回调）抛，
    //   确定性地走与真实崩溃同一条 onerror 通路。发消息时不带 id ⇒ 不 resolve 任何待办。
    setTimeout(function () { throw new Error('crash-test: 非受控异常（工单 08 判据通道）'); }, 0);
    send({ id: m.id, kind: 'result', rc: 0 });
    return;
  }
  if (false) {
  }
};

function runJob(m, finished) {
  var t0 = performance.now();
  var done = function (rc, err) {
    flushOut();                       // ★ 先冲输出再发结果（顺序）
    send({ id: m.id, kind: 'result', rc: rc, err: err || (function () {
      try { return String(Module.last_error_message() || ''); } catch (e) { return ''; }
    })(), ms: Math.round(performance.now() - t0) });
    finished();
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
}
send({ kind: 'boot' });
