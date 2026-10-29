// Octave-Full-Wasm — **E 线 MATLAB 语义桥的页面装配**（工单 70；OM 回信 mail/025）
// Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
//
// 这是"让 UI 的 OpenModelica 终端真的能用"的那一层。它做四件事，**顺序不能反**
// （OM mail/025 §2 的时序，我按它实现并实测）：
//
//   1. 把站点 `omc/bridge/` 的 12 件**写进 MEMFS** + `addpath('/bridge')`
//      —— ★ 关键：**铺站点目录本身不产生效果**。`addpath` 走 MEMFS，站点 HTTP 路径
//      不在其中（我方独立复核：MEMFS 根只有 tmp/home/dev/proc/fonts/src/usr；
//      站点路径 exist=0；MEMFS 写文件后 addpath ⇒ exist=2）。所以这一步必须真写字节。
//   2. boot omc 引擎（`omc/OpenModelicaCompiler.js` 的 `__omc` ready）
//   3. import `omc/bridge/omc_bridge.js` 并 `serve({ omc, writeFile, readFile })`
//      —— 双重句柄（omc 命名空间 + Octave MEMFS）由**本模块**建立（桥自己不猜全局名）。
//   4. 之后才允许 `omc_*` 调用。
//
// 失败态三档（OM mail/025 §2 表；这就是 `Error (rc=2)` 的病根）：
//   ① MEMFS 写入 / addpath 失败 ⇒ 状态 'bridge-not-assembled'
//   ② `__omc` 未 ready           ⇒ 状态 'omc-not-ready'（桥不接单）
//   ③ `serve()` 未启动           ⇒ 状态 'bridge-not-serving'（请求永不应答 ⇒ 超时明说）
//
// 设计取舍（为什么不塞进 octave-page.js 的 boot 链）：
//   · omc 引擎是 74 MB 级的能力层，**不该拖慢开机**（开机路径上的重活是本仓反复踩的坑；
//     "探测/自检不许放在开机路径上"那条纪律同族）；
//   · 默认站点不带 omc（`omc/` 只在供了引擎的站点存在）⇒ 缺它是**合法形状**，不是错误。
//   ⇒ 由调用方按需触发：`await window.OctaveOmcBridge.ensure()`。UI 终端在用户点开
//     「OpenModelica 终端」时调它；失败时读 `.state` 显示对应文案（不要显示裸 rc=2）。
(function (global) {
  'use strict';

  var BRIDGE_DIR = 'omc/bridge';
  var MEMFS_DIR = '/bridge';
  var OM_RES = '/tmp/omc_res.txt';
  var OM_REQ = '/tmp/omc_req.txt';

  // 本模块状态机（UI 就靠读它决定显示什么；**不编假的 ready**）
  var STATE = {
    IDLE: 'idle',                            // 还没尝试
    NO_SITE_BYTES: 'no-site-bytes',          // 站点没有 omc/bridge/（这个站点没供 omc）
    ASSEMBLING: 'assembling',                // 写 MEMFS 中
    BRIDGE_NOT_ASSEMBLED: 'bridge-not-assembled', // ① 失败
    OMC_NOT_READY: 'omc-not-ready',          // ② 失败
    BRIDGE_NOT_SERVING: 'bridge-not-serving',// ③ 失败
    READY: 'ready'                           // 四步全过
  };

  var state = STATE.IDLE;
  var detail = '';
  var started = null;                        // ensure() 的 promise（幂等）

  function setState(s, d) {
    state = s;
    detail = d || '';
    // 让 UI/测试能观察到（只读语义；不暴露内部对象）
    try {
      global.__octaveOmcBridge = { state: state, detail: detail };
    } catch (e) { /* 无 window 环境（node 单测）忽略 */ }
  }

  // ── ① 站点 → MEMFS + addpath ────────────────────────────────────────────────
  // 清单从站点读（`omc/bridge/manifest.json` 的 12 件；清单本身不在 entries 里）。
  // ★ 为什么读清单位置而不硬编码 12 个名字：OM 改桥就得改清单，硬编码会漂。
  async function assembleMemfs(M, base) {
    var murl = (base || '') + BRIDGE_DIR + '/manifest.json';
    var manifest;
    try {
      var mr = await fetch(murl);
      if (!mr.ok) {
        // 站点没供 omc/bridge/ ⇒ 合法形状（这个站点没有 omc 能力层），不是错误
        setState(STATE.NO_SITE_BYTES, murl + ' → HTTP ' + mr.status);
        return false;
      }
      manifest = await mr.json();
    } catch (e) {
      setState(STATE.NO_SITE_BYTES, String(e && e.message || e));
      return false;
    }
    var entries = (manifest && manifest.entries) || [];
    if (!entries.length) {
      setState(STATE.BRIDGE_NOT_ASSEMBLED, '清单 entries 为空（零值守卫）');
      return false;
    }

    setState(STATE.ASSEMBLING, entries.length + ' 件');
    try {
      // 同步 FS API 挂在活跃 Octave 实例上（M.FS）；mkdir 幂等
      try { M.FS.mkdir(MEMFS_DIR); } catch (e) { /* 已存在 */ }
      var written = 0;
      for (var i = 0; i < entries.length; i++) {
        var name = entries[i].file;
        var url = (base || '') + BRIDGE_DIR + '/' + name;
        var r = await fetch(url);
        if (!r.ok) throw new Error(name + ' → HTTP ' + r.status);
        var buf = new Uint8Array(await r.arrayBuffer());
        M.FS.writeFile(MEMFS_DIR + '/' + name, buf);
        written++;
      }
      M.eval_string("addpath('" + MEMFS_DIR + "');");
      return written;
    } catch (e) {
      setState(STATE.BRIDGE_NOT_ASSEMBLED, String(e && e.message || e));
      return false;
    }
  }

  // ── ② boot omc 引擎 ────────────────────────────────────────────────────────
  // ★ 真实形态（2026-10-29 读站点产物确认，别猜）：OM 的 `OpenModelicaCompiler.js`
  //   是 **ESM**（wasm-bindgen 产物），不是 Emscripten 全局工厂：
  //     · `export { initSync, __wbg_init as default }` ← **default 导出就是初始化函数**
  //     · 命名导出：`omc_init` / `omc_eval` / `omc_abi` / `omc_enable_*` …
  //     · 初始化签名：`default({ module_or_path })` ⇒ 传站点上的 `_bg.wasm` URL
  //   我第一版按 Emscripten 惯例猜了 `createOpenModelicaCompiler`/`OpenModelicaCompiler`/
  //   `createOmc` 三个全局名 —— **全部不存在**（实测产物零命中）。产物自证优先于约定。
  //
  // 加载方式：动态 `import()`（ESM 只能这么进；本站点其余 JS 走 script 标签）
  async function bootOmc(base) {
    var g = global;
    if (g.__omc) return g.__omc;                       // 已 boot（幂等）
    var modUrl = (base || '') + 'omc/OpenModelicaCompiler.js';

    // 站点有没有这份引擎？没有 ⇒ 这个站点没供 omc（合法形状，不是错误）
    try {
      var head = await fetch(modUrl, { method: 'HEAD' });
      if (!head.ok) {
        setState(STATE.NO_SITE_BYTES, modUrl + ' → HTTP ' + head.status
                 + '（站点未供 omc 引擎）');
        return null;
      }
    } catch (e) {
      setState(STATE.NO_SITE_BYTES, String(e && e.message || e));
      return null;
    }

    setState(STATE.OMC_NOT_READY, 'boot 中（ESM import）');
    var ns;
    try {
      // ★ 动态 import 的说明符必须是**绝对 URL**（2026-10-29 实测：相对串
      //   "omc/OpenModelicaCompiler.js" 被当模块名解析 ⇒
      //   `Failed to resolve module specifier`）。用 new URL 对 base 归一化。
      ns = await import(/* webpackIgnore: true */ new URL(modUrl, global.location.href).href);
    } catch (e) {
      setState(STATE.OMC_NOT_READY, 'ESM import 失败: ' + String(e && e.message || e));
      return null;
    }
    var init = ns && ns.default;
    if (typeof init !== 'function') {
      setState(STATE.OMC_NOT_READY,
               'ESM 模块的 default 不是初始化函数（wasm-bindgen 形态变了？）');
      return null;
    }
    try {
      // module_or_path 可以是站点 URL；wasm-bindgen 内部会 fetch
      var wasmUrl = (base || '') + 'omc/OpenModelicaCompiler_bg.wasm';
      var ret = await init({ module_or_path: wasmUrl });
      // __wbg_init 返回的是导出的 wasm 绑定面（不是模块命名空间）——
      // 命名导出（omc_init 等）在 ns 上；把两边合成一个句柄交给桥。
      var omc = {
        omc_init: ns.omc_init, omc_eval: ns.omc_eval, omc_abi: ns.omc_abi,
        omc_request_cancel: ns.omc_request_cancel,
        omc_enable_cancel_poll: ns.omc_enable_cancel_poll,
        _raw: ret, _ns: ns
      };
      if (typeof omc.omc_init === 'function') {
        var ok = omc.omc_init();
        if (ok === false) {
          setState(STATE.OMC_NOT_READY, 'omc_init() 返回 false');
          return null;
        }
      } else {
        setState(STATE.OMC_NOT_READY, 'ESM 模块没有命名导出 omc_init');
        return null;
      }
      g.__omc = omc;
      return omc;
    } catch (e) {
      setState(STATE.OMC_NOT_READY, 'init() 失败: ' + String(e && e.message || e));
      return null;
    }
  }

  // ── ③ import 桥 + serve（双句柄）────────────────────────────────────────────
  // 桥模块是 CommonJS 风格（`module.exports = OmcBridge`）+ 挂 window。
  // 用动态 script 注入（本站点不用 ESM 的 import map；编译产物要 ES5 兼容）。
  function loadBridgeScript(base) {
    return new Promise(function (resolve, reject) {
      if (global.OmcBridge) return resolve(global.OmcBridge);
      var s = global.document.createElement('script');
      s.src = (base || '') + BRIDGE_DIR + '/omc_bridge.js';
      s.onload = function () {
        if (global.OmcBridge) resolve(global.OmcBridge);
        else reject(new Error('omc_bridge.js 执行了但没导出 OmcBridge'));
      };
      s.onerror = function () { reject(new Error('omc_bridge.js 加载失败: ' + s.src)); };
      global.document.head.appendChild(s);
    });
  }

  async function serveBridge(OmcBridge, omc, M) {
    // 双重句柄：omc 命名空间 + Octave MEMFS（桥自己不猜全局名 —— OM mail/025 §2）
    await OmcBridge.serve({
      omc: omc,
      writeFile: function (p, b) { M.FS.writeFile(p, b); },
      readFile: function (p) { return new TextDecoder().decode(M.FS.readFile(p)); },
      exists: function (p) { try { M.FS.stat(p); return true; } catch (e) { return false; } },
      intervalMs: 50
    });
    // 协议两条落地文件先建好（桥的 serve 里也会建，这里双保险：缺它 `.m` 侧要多判分支）
    try { M.FS.writeFile(OM_REQ, new Uint8Array(0)); } catch (e) { /* 已存在无妨 */ }
    try { M.FS.writeFile(OM_RES, new Uint8Array(0)); } catch (e) { /* 同上 */ }
    return OmcBridge;
  }

  // ── 对外：ensure()（幂等；四步顺序固定）────────────────────────────────────
  // opts: { base?: string, core?: object }  —— core 不给则用默认 Octave 实例
  //
  // ★ 两段式暴露（2026-10-29 实测逼出来的）：`ensure()` 整体要等 omc 引擎 boot（74 MB，
  //   几秒），但**桥的 .m 只要 MEMFS 装配完就可见**（`exist()` 立刻为真）。OM 的产品态
  //   套件（`accept-omc-bridge-product.mjs`）`addpath` 完**立刻**探 `exist()`，不等 boot
  //   ⇒ 只给一个 promise 会让它探到「装配未完成」的假红。
  //   所以额外暴露两个可等的进度句柄：
  //     `.memfs`  —— ① 完成（12 件写进 MEMFS + addpath）就 resolve ⇒ `.m` 已可见
  //     `.ready`  —— 四步全过才 resolve ⇒ `omc_*` 真能跑
  //   这两个是**真状态**，不是乐观值：失败时 reject 并带上 state/detail。
  var memfsP = null, readyP = null;

  function ensure(opts) {
    if (readyP) return readyP;                       // 幂等：重复调用拿同一个 promise
    opts = opts || {};
    var M = (opts.core && opts.core.module) || global.Module;
    if (!M || !M.FS || !M.eval_string) {
      var e0 = new Error('没有活跃的 Octave 实例（Module.FS 缺失）');
      setState(STATE.BRIDGE_NOT_ASSEMBLED, e0.message);
      memfsP = Promise.reject(e0);
      readyP = memfsP;
      readyP.catch(function () {});                  // 别让未处理 rejection 冒出来
      return readyP;
    }
    var base = opts.base || '';

    // ① MEMFS 先跑（快：12 个小文件）—— 这一段完成 = `omc_*.m` 对 addpath 可见
    memfsP = assembleMemfs(M, base).then(function (n) {
      if (n === false) throw new Error(detail || 'MEMFS 装配失败');
      return n;
    });
    memfsP.catch(function () {});                    // 上面同理

    readyP = (async function () {
      var n = await memfsP;                          // ①（已完成的直接过）
      var omc = await bootOmc(base);                 // ② 74 MB 级，慢
      if (!omc) throw new Error(detail || 'omc 未就绪');
      var OmcBridge;
      try {
        OmcBridge = await loadBridgeScript(base);    // ③
        await serveBridge(OmcBridge, omc, M);
      } catch (e) {
        setState(STATE.BRIDGE_NOT_SERVING, String(e && e.message || e));
        throw e;
      }
      setState(STATE.READY, n + ' 件已装配');
      return { ok: true, state: state, detail: detail, files: n, omc: omc, bridge: OmcBridge };
    })();
    readyP.catch(function () {});                    // 调用方没 catch 也别吵
    return readyP;
  }

  // 复位（测试/重建实例用；不销毁 omc 引擎 —— 它是能力层，重建代价大）
  function reset() {
    memfsP = null;
    readyP = null;
    setState(STATE.IDLE, '');
  }

  var API = {
    ensure: ensure, reset: reset, STATE: STATE,
    // 两个可等进度句柄（见 ensure 注释）：.memfs 完成 ⇒ `omc_*.m` 已可见；
    // .ready 完成 ⇒ 四步全过、`omc_*` 真能跑。未调用 ensure() 前都是 null。
    get memfs() { return memfsP; },
    get ready() { return readyP; },
    get state() { return state; }, get detail() { return detail; }
  };
  global.OctaveOmcBridge = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
