// Octave-Full-Wasm — **内核**：页面宿主与 Worker 宿主共用的那一份（D3；批次 A2，2026-09-26）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 为什么有它（`build/113/PLAN-arch.md` §1.3）─────────────────────────────────
// 以前同一件事写了两遍（`bridge/index.html` 的 `createOctaveHost` 与 `bridge/octave-worker.js`
// 的 Module 段），**已经漂了 10 处**（逐条见 PLAN-arch §2 A2）：取点写内存一边用 `inst.mem`
// 一边用模块级 `wasmMemory`；页面有 sha 自证 / JSPI 能力门 / 800ms 写回，worker **三样都没有**；
// `stdin` 一边是整段 TTY 模拟一边直接 EOF；`execute_interp()` 与 JSPI 包装的**顺序相反**。
// 这一份只做**搬运**，不改行为：谁把逻辑写歪了，由宿主侧的断言暴露（见宿主文件里的说明）。
//
// ── 缝（内核拥有什么 / 宿主提供什么）─────────────────────────────────────────
// 内核**拥有**：Module 配置骨架、`instantiateWasm`（B 姿势挂起包装 + 取点原语覆写 + sha 自证）、
// 启动链（`execute_interp` → JSPI 包装 → 资产三组）、IDBFS 挂载 + `webSync`/去抖写回、
// JSPI 能力门（两个 gate）、`Capabilities`。
// 宿主**提供**（9 件，全部是"这一侧才知道的事"）：
//   base      资源前缀（wasm/.data/资产/清单都在它后面）
//   lane      选档计划（B6）：`{lane,dir,js,wasm,data,manifest}` —— 线程档时 wasm 在 `threads/`、
//             资产清单换成 `assets/manifest.threads.json`（只有 `.oct` 那部分不同）
//             子目录（文件名不变，胶水内部的 `octave.data` 引用因此不用改）。
//             缺省 = 基础档（`opts.lane` 不传时的行为与 B6 之前逐字节一致）
//   print     stdout 汇（页面：console.log + 上屏；worker：合批 postMessage）
//   printErr  stderr 汇（页面分开 console.warn；worker 与 stdout 同路）
//   note      诊断汇（非致命警告）
//   stdinChar 取一个字符码；null = EOF
//   clicks    点击队列**对象**（宿主拥有：页面按实例、worker 是模块级）
//   doc       document 形态（真 DOM，或 worker 的最小 shim）
//   assets    资产装载器工厂 (module, base, isReady) → loader
//   onReady   就绪回调（页面置 inst.ready/window.__octaveReady；worker 发 ready）
//
// ⚠️ **宿主侧的批处理策略不统一，也不该统一**：页面按 rAF/200ms 节流（DOM 强制布局贵），
//    worker 按 8KB/16ms 合批（postMessage 贵）—— 所以 `print` 由宿主实现，内核只管调用。
(function (global) {
  'use strict';

  // CORE 组：dldfcn 核心（开箱就该能用的几何/压缩/音频）。走官方 dlopen 装载
  //   （与桌面版同一机制、同一 exist/which 语义）。装不上不致命：页面照常可用，
  //   只是这些函数不存在（会清晰报错）。
  var CORE_DLDFCN = ['convhulln', '__delaunayn__', '__voronoi__',
                     '__glpk__', 'fftw', 'gzip', 'audioread',
                     '__web_pause_ms__'];
  // HELP 组（`help`/`lookfor`/`doc` 的数据依赖与图形句柄 toolkit）—— 逐条理由见
  //   index.html 原注释（built-in-docstrings 必须有、webgraphics 让 `figure` 能建出来…）。
  var HELP_ASSETS = ['built-in-docstrings', 'doc-cache', 'macros.texi', 'plotbridge',
                     'webgraphics', 'webdoc', 'pkgfix'];
  // pkg 语义（T4）：11.3.0 车道只要 pkgfix 那一半。⚠️ 顺序：webshims 必须在 pkgfix **之后**
  //   装载（两者都 addpath，后装载者排前 ⇒ pkg.m 的 shim 要排在核心 m/pkg 之前）。
  var PKG_ASSETS = ['pkgfix', 'webshims'];
  var JSPI_SUPPORT = '支持 JSPI 的浏览器（Chromium 137+ / Safari 27+ 等；**以能力检测为准，别信版本号**）';

  function createOctaveCore(opts) {
    opts = opts || {};
    var host = opts.host || {};
    // ⚠️ base **必须活取**：worker 的 BASE 是 `opts` 消息到达时才设的（晚于 createOctaveCore）
    //    ⇒ 捕获成值会让 `?worker=1&base=...` 静默失效（读的是空前缀）。传函数即活取。
    var baseOf = (typeof opts.base === 'function') ? opts.base : function () { return opts.base || ''; };
    // ★ B6 选档：宿主把 `octaveLanePlan` 传进来；不传 = 基础档（老宿主/老测试不受影响）。
    var lane = opts.lane || { lane: 'base', dir: '', js: 'octave.js',
                              wasm: 'octave.wasm', data: 'octave.data' };
    var base = baseOf();           // 仅用于同步场景（页面宿主是常量）
    var isDefault = opts.isDefault !== false;
    // st = **宿主自己的**实例记录（页面的注册表条目要读 `armed`/`ready`/`mem` 做扇出与断言）
    // ⇒ 内核直接写它，而不是自己另存一份（否则页面的 `h.armed` 永远不亮）。
    var st = opts.state || {};
    var clicks = opts.clicks || { list: [], length: function () { return 0; },
                                 push: function () {}, shift: function () {}, clear: function () {} };
    var state = { homeMounted: false, home: opts.home || '/home/web_user' };

    // ── Capabilities（D4）：**开机只算一次**，消费者只读对象、不再各自探测 ──────────
    // 引擎侧只做**全局安全**的探测：不碰 canvas（页面 createElement('canvas') 会造真 canvas、
    // worker 上会顶掉 toolkit 那个 OffscreenCanvas ⇒ 那两处 WebGL 探测留在各自宿主里）。
    var caps = {
      mode: opts.mode || 'single',
      engine: {
        jspiApi: (typeof WebAssembly.Suspending === 'function'
                  && typeof WebAssembly.promising === 'function'),
        offscreenCanvas: (typeof global.OffscreenCanvas === 'function'),
        cryptoSubtle: !!(global.crypto && global.crypto.subtle),
        crossOriginIsolated: (typeof global.crossOriginIsolated === 'boolean')
                             ? global.crossOriginIsolated : null,
        sharedArrayBuffer: (typeof global.SharedArrayBuffer === 'function'),
      },
      lane: { chosen: lane.lane, dir: lane.dir || '', js: lane.js,
              threads: (lane.lane === 'threads' || lane.lane === 'w64' || lane.lane === 'w64-threads'),
              wasm64: (lane.lane === 'w64' || lane.lane === 'w64-threads' || lane.lane === 'w64-base') },
      sharedMemory: null,      // 实例化后填（见 instantiateWasm 的 .then）
      artifact: null,     // 由 octave.build.json 填充（读不到就是 null，绝不因此报错）
    };
    // ── JSPI 能力门的状态（G0）────────────────────────────────────────────────
    // ⚠️ 它**必须在外层作用域**：`boot()` 里赋值、返回对象上的 `jspi()` 要能读到
    //    （写在 boot() 里的话外层闭包看不见 ⇒ ReferenceError）。
    var J = {
      api: caps.engine.jspiApi,
      smoke: 'unprobed',   // unprobed|pending|pass|pass-blocking|fail|timeout|no-entry|api-missing
      entry: null, note: ''
    };
    // 产物身份证（D2）：**读不到是正常情况**（老产物没有清单）⇒ 只记 null，不打断开机。
    // ⚠️ 它在 `boot()` 里读（不是创建时）：worker 的 base 要到 `opts` 消息才定。
    function loadManifest() {
      try {
        var f = (typeof global.fetch === 'function') ? global.fetch : null;
        if (!f) return;
        // ★ B6：身份证**按档读** —— 线程档跑的是另一份产物，拿基础档的身份证会自相矛盾
        //   （`caps.artifact.threads` 会说 false 而实际在跑线程档；probe-lane 交叉核对会当场红）。
        f(baseOf() + (lane.dir || '') + 'octave.build.json').then(function (r) {
          if (!r || !r.ok) return null;
          return r.json();
        }).then(function (m) {
          if (!m || !m.measured) return;
          var me = m.measured;
          caps.artifact = {
            verdict: m.verdict || null,
            mode: (m.build && m.build.mode) || null,
            simd: !!((me.simd || {}).v128 > 0),
            v128: (me.simd || {}).v128,
            jspiEntry: !!me.jspi_entry,
            threads: !!((me.threads || {}).shared_memory),   // 产物侧实测（内存 shared）
            wasm64: !!me.wasm64,
            gl4es: !!((me.gl4es || {}).symbol_hits > 0),
            idbfs: !!me.idbfs,
            fontconfig: !!me.fontconfig,
            fonts: (me.fonts || []).length,
          };
          if (isDefault) global.__octaveCaps = caps;
        }).catch(function () { /* 清单缺席 = 老产物，静默 */ });
      } catch (e) { /* 同上 */ }
    }

    function warn(m) { (host.note || function () {})(m); }

    // ── IDBFS：挂到 HOME 并**读回**（幂等）────────────────────────────────────
    // ⚠️ 前置条件：产物必须带 `-lidbfs.js`（link-web.sh 有 IDBFS 自检），否则
    //    `FS.filesystems.IDBFS` 是 undefined。**那种情况下不报错、不挂**（页面照常可用），
    //    只是没有持久化 —— 所以先判存在，再挂，再读回。
    // homeOverride：worker 的 opts 消息可能晚于 postRun 到达；**只在还没挂过时**生效
    //   （挂过就以第一次为准 —— 与两个宿主原来的语义一致）。
    function mountHome(homeOverride) {
      if (state.homeMounted) return;
      if (homeOverride) state.home = homeOverride;
      try {
        if (Module.FS.filesystems && Module.FS.filesystems.IDBFS) {
          try { Module.FS.mkdir(state.home); } catch (e) { /* 已存在 */ }
          Module.FS.mount(Module.FS.filesystems.IDBFS, {}, state.home);
          state.homeMounted = true;
          Module.FS.syncfs(true, function (err) {          // 开机读回（早于用户第一次敲命令）
            if (err) warn('[idbfs] 读回失败：' + err);
            // ⚠️ 这条**必须无条件打**：`accept-idbfs.mjs:59` 断言控制台里有 `[idbfs] 已读回`
            //    （它读的是 console 捕获窗口，不看级别）。别为了"安静一点"给它加开关。
            else host.print('[idbfs] 已读回 ' + state.home + '（IndexedDB）');
          });
        } else {
          warn('[idbfs] 这个产物没编入 IDBFS（缺 -lidbfs.js）⇒ 本次会话不持久化');
        }
      } catch (e) { warn('[idbfs] 挂载失败：' + String(e).slice(0, 140)); }
    }

    var Module = {
      // ── JSPI **B 姿势**（2026-09-25 定案）：包装只发生在宿主层 ──────────────────
      // 把唯一的挂起 import `web_sleep_ms` 包成 `WebAssembly.Suspending`，其余 import
      // **原样透传**；旧产物（WITH_JSPI=0，没有这个 import）走无害空操作。
      // ⚠️ 5.0.7 的钩子契约 = **完全接管实例化**（preamble.js:835-850，无 fall-through）
      //    ⇒ 自己 fetch + **异步**编译（29MB 在主线程同步编译会被 Chrome 拒）再回调。
      //    为什么不走 `instantiateStreaming`：python http.server 不发 application/wasm，
      //    现役开机本来就在走 arrayBuffer 回退（无回归）。
      // 为什么坚持 B 姿势（宿主层包装，不加 `-sJSPI`）：实测 5.0.7 里 `-sJSPI` 经
      //   `__dlopen_js.isAsync=true` 把 **dlopen 无条件变成挂起点** ⇒ 开机资产装载会整批炸
      //   （NOTES-jspi「A2 最小实验」）；宿主层包装让挂起点只剩 `web_sleep_ms`。
      instantiateWasm: function (info, receiveInstance) {
        try {
          // 没有 JSPI API 的浏览器（Gate 0 单产物策略）⇒ **不包装、不告警** ——
          // "无挂起"是预期降级路径，不是错误；包装失败也不许把裸 TypeError 打到控制台。
          if (typeof WebAssembly.Suspending === 'function'
              && info && info.env && typeof info.env.web_sleep_ms === 'function') {
            info.env.web_sleep_ms = new WebAssembly.Suspending(info.env.web_sleep_ms);
          }
        } catch (e) {
          warn('[jspi-b] 挂起包装不可用，已降级为无挂起（其余功能照常）');
        }
        // ── 取点三原语按**本实例**覆写（webjslib 的原始实现读写 window 全局队列 ⇒
        //    同页两实例互踩）。pop 写 double 用**本实例**的 memory（receiveInstance 时捕获；
        //    每次 pop 现建 Float64Array，天然免掉 growth 失效）。
        try {
          if (info && info.env) {
            var env = info.env;
            if (typeof env.web_ginput_arm_impl === 'function') {
              env.web_ginput_arm_impl = function () {
                clicks.clear();
                st.armed = true;
                if (isDefault) global.__octaveClicksArmed = true;   // 兼容别名
                return 0;
              };
            }
            if (typeof env.web_ginput_pending_impl === 'function') {
              env.web_ginput_pending_impl = function () { return clicks.length(); };
            }
            if (typeof env.web_ginput_pop_impl === 'function') {
              env.web_ginput_pop_impl = function (ptr) {
                if (!clicks.length()) return -1;
                var c = clicks.shift();
                if (st.mem) {
                  var base = typeof ptr === 'bigint' ? Number(ptr / 8n) : Math.floor(Number(ptr) / 8);
                  var H = new Float64Array(st.mem.buffer);
                  H[base] = c[0];
                  H[base + 1] = c[1];
                  H[base + 2] = c[2];
                  H[base + 3] = c[3];
                }
                return c[4] | 0;
              };
            }
          }
        } catch (e) { /* 覆写失败 = 退回 webjslib 原始（window 队列）语义，不致命 */ }
        global.fetch(baseOf() + (lane.dir || '') + 'octave.wasm')
          .then(function (r) { return r.arrayBuffer(); })
          .then(function (b) {
            // ★ SHA 自证（2026-09-25）：把**本页实际实例化的 wasm 字节**算成 sha256 暴露出来。
            //   测试/收尾用它对照"磁盘文件"与"刚构建的产物"——防"改完程序跑旧产物"
            //   （promote 覆盖事故与 harness 旧副本都是这一类，HISTORY §5.50）。
            try {
              if (global.crypto && global.crypto.subtle) {
                global.crypto.subtle.digest('SHA-256', b).then(function (d) {
                  global.__octaveWasmSha = Array.prototype.map.call(new Uint8Array(d),
                    function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
                }).catch(function () {});
              }
            } catch (e) { /* 老浏览器没有 subtle：自证缺席，其余功能不受影响 */ }
            return WebAssembly.instantiate(b, info);
          })
          .then(function (out) {
            // ⚠️ 内存可能**不是导出的、而是从 JS 导入的**（pthread 构建实测如此）⇒ 只认
            //    `exports.memory` 会让 `st.mem` 为 null，连带两条都坏：① `caps.sharedMemory` 报 false；
            //    ② 内核里"把点击写进内存"的路径（`st.mem.buffer`）静默失效（交互套件会假过）。
            //    ⇒ 取"导出优先、退回导入的 memory"。
            st.mem = (out.instance.exports && out.instance.exports.memory)
                  || (info && info.env && info.env.memory)
                  || (global.Module && global.Module.wasmMemory) || null;
            // ★ B6：把"内存是不是 shared"记进 Capabilities —— 这是"线程档真的在跑"的**产物侧证据**，
            //   而且给了探针一个稳定取法（`Module.HEAP8` 在 -O2 构建里没导出，实测读不到）。
            try {
              caps.sharedMemory = !!(st.mem && st.mem.buffer
                && typeof SharedArrayBuffer === 'function'
                && st.mem.buffer instanceof SharedArrayBuffer);
            } catch (e) { caps.sharedMemory = null; }
            receiveInstance(out.instance, out.module);
          })
          .catch(function (e) {
            // 宿主侧原来一边 console.error、一边 postMessage fatal ⇒ 统一走 note（宿主决定落点）
            warn('[instantiate] 失败: ' + e);
          });
        return {};
      },
      // ⚠️ octave.data 一向走胶水的 locateFile（默认文档 base）；有了 base 就统一由它管。
      // ⚠️ 只重写**胶水自己会去取的那一个名字**（`octave.data`）；带 '/' 的路径一律不动
      //    （前缀一个目录会把 `assets/x` 这类路径弄坏 —— 资产两档共用根目录）。
      locateFile: function (p) {
        if (p === 'octave.data') return baseOf() + (lane.data || 'octave.data');
        return baseOf() + p;
      },
      print: function (t) { host.print(t); },
      printErr: function (t) { host.printErr(t); },
      // stdin：Emscripten 的**官方扩展点**（`/dev/stdin` 的设备回调，必须在**启动前**定义 ——
      //   `library_fs.js` 只在 `FS.init()` 时 `FS.createDevice('/dev','stdin',Module['stdin'])`；
      //   启动后再赋值是**无效的**，实测注入后 input() 仍走 TTY）。
      // 空闲时回退到 window.prompt（宿主实现），所以对真人用户的体验与默认行为一致；
      // 给宿主一个可注入的队列是为了**可测**（prompt 同步阻塞与 playwright 异步 dialog 交错
      // 会让连续多次 input() 拿到错位的答案 —— 实测答案为上一次的）。
      // 语义与 Emscripten 的 TTY 一致：每次返回**一个字符码**，行尾 `\n`，无输入返回 `null`(EOF)。
      stdin: (function () {
        var buf = '';
        return function () {
          if (!buf) {
            var line = host.stdinLine();
            if (line === null || line === undefined) return null;
            buf = line + '\n';
          }
          var c = buf.charCodeAt(0);
          buf = buf.slice(1);
          return c;
        };
      })(),
      postRun: function () { boot(); }
    };
    st.mod = Module;

    // ── 启动链（两个宿主原来是两份，这里合一）──────────────────────────────────
    function boot() {
      loadManifest();
      mountHome();

      // **明确的写回点**：把 MEMFS 的持久区刷进 IndexedDB。
      //   · 交互用户：由宿主每条命令后的去抖自动写回兜住（800ms 合并）；
      //   · 脚本/测试：`await new Promise(r => Module.webSync(r))` 拿确定性（验收就靠它）。
      Module.webSync = function (cb) {
        try { Module.FS.syncfs(false, function (err) { if (cb) cb(err || null); }); }
        catch (e) { if (cb) cb(e); }
      };
      var __syncTimer = null;
      function syncSoon() {
        if (__syncTimer) return;
        __syncTimer = setTimeout(function () { __syncTimer = null; Module.webSync(); }, 800);
      }
      if (isDefault) global.__octaveSyncSoon = syncSoon;
      Module.__syncSoon = syncSoon;      // 宿主自己的 ev() 包装也用它（页面 ?bench=1 走别名）

      // ── JSPI 能力门（G0，2026-09-24）─────────────────────────────────────────
      // **两个独立 gate**（GPT 复审的要求：只看 `typeof WebAssembly.Suspending` 不够 ——
      // Pyodide 至今仍有 JSPI 稳定性 issue、还提供"禁用 JSPI"的 workaround）：
      //   ① API 门：`WebAssembly.Suspending` / `promising` 都是函数；
      //   ② **Octave 级冒烟**：真的跑一次 suspending 入口（等一小段 + 确认页面定时器在跑）。
      // 做法是**单产物 + 运行时能力门**（Gate 0 已实测：删掉这两个 API 后 `-sJSPI` 产物照样
      // 加载，只是被包过的导出不存在）⇒ 不抬浏览器下限、不维护两条车道。
      // ⚠️ **现在没有任何功能依赖它**（"等用户动作"一族都是清晰报错）⇒ 这里不弹任何提示。
      if (isDefault) global.__octaveJspi = J;

      // ── B 姿势的入口包装（2026-09-25）：`eval_wait`（真 wasm 导出）→ promising ──
      // 宿主级 API 名仍是 `eval_async` ⇒ G0 门机制、探针、D9 接线**全部不变**。
      // ⚠️ **wasm 边界不传 JS 字符串**（探针教训，实测重现）：`_eval_wait(const char*)`
      //    直收 JS 串会得到 NULL 指针 ⇒ eval 空串、rc=0 装成功。⇒ 先 malloc 堆指针、写串、
      //    调用、settle 后 free —— **必须堆分配**（栈分配的指针在挂起期间会被复用）。
      // ⚠️ 必须**等导出存在**（postRun 里 exports 已就位）；没有 JSPI API 或旧产物
      //    （无 `_eval_wait`）不包 ⇒ 门如实记 `no-entry`（单产物 + 运行时能力门）。
      try {
        if (typeof WebAssembly.promising === 'function' && typeof Module['_eval_wait'] === 'function'
            && typeof Module.eval_async !== 'function') {
          var __evalWaitPromised = WebAssembly.promising(Module['_eval_wait']);
          Module.eval_async = function (code) {
            var n = Module.lengthBytesUTF8(code) + 1;
            var p = Module._malloc(n);
            if (!p) return Promise.reject(new Error('eval_async: malloc 失败'));
            Module.stringToUTF8(code, p, n);
            var lane = (opts.lane && opts.lane.lane)
              || (typeof window !== 'undefined' && window.octaveLaneState && window.octaveLaneState.lane)
              || (typeof self !== 'undefined' && self.octaveLaneState && self.octaveLaneState.lane)
              || '';
            var isW64 = (lane === 'w64' || lane === 'w64-base' || lane === 'w64-threads');
            var arg = (isW64 && typeof p !== 'bigint') ? BigInt(p) : p;
            return __evalWaitPromised(arg).finally(function () { Module._free(p); });
          };
        }
      } catch (e) { warn('[jspi-b] eval_async 包装失败：' + e); }

      // ★ 冒烟**不在开机时自动跑**（2026-09-24 事故改的）：G1 第一次把 `eval_async` 链进来时，
      //   那个绑定是坏的（`RuntimeError: null function`），而开机自检去调它 ⇒ **整个页面卡死**，
      //   所有浏览器验收一起挂。教训：**"探测一个可能把主线程卡住的东西"不能放在开机路径上**。
      //   ⇒ 改成按需 `__octaveJspiProbe()`（带超时），开机只如实记 `unprobed`。
      var octaveJspiProbe = function (timeoutMs) {
        if (!J.api) {
          J.smoke = 'api-missing'; J.note = '页面里没有 WebAssembly.Suspending/promising';
          return Promise.resolve(J.smoke);
        }
        var fn = (typeof Module.eval_async === 'function') ? Module.eval_async : null;
        if (!fn) {
          J.smoke = 'no-entry'; J.note = '本产物没有 suspending 入口（G1 会加 eval_async）';
          return Promise.resolve(J.smoke);
        }
        J.entry = 'eval_async';
        J.smoke = 'pending';
        var ticks = 0;
        var timer = setInterval(function () { ticks++; }, 20);
        var done = function (st, note) { clearInterval(timer); J.smoke = st; J.note = note; return st; };
        // 超时兜底：坏绑定可能**永不 settle**（实测会连页面一起卡住）⇒ 到点如实记 timeout
        var guard = new Promise(function (res) {
          setTimeout(function () { res(done('timeout', 'eval_async 在 ' + (timeoutMs || 5000) + 'ms 内没有 settle')); },
                     timeoutMs || 5000);
        });
        var real = Promise.resolve().then(function () {
          // ★ **解释器装配之前不许碰它**（2026-09-24 深夜实测，HISTORY §5.46）：
          //   `execute_interp()` 之前的任何解释器调用 —— `eval_string` 与 `eval_async`
          //   **一样** —— 都抛 `RuntimeError: null function`。直接调会把冒烟**误判成 `fail`**
          //   （JSPI 其实没问题，只是叫早了）。⇒ 先等 ready；等不到就由 guard 如实记 `timeout`。
          if (st.ready) return null;
          return new Promise(function (res) {
            var t = setInterval(function () {
              if (st.ready) { clearInterval(t); res(null); }
            }, 50);
          });
        }).then(function () { return fn('pause(0.2); 43'); }).then(function (v) {
          // 两条都要：**rc=0**（eval 的返回值是**返回码**，'43' 是表达式值不进返回值 ——
          // 当年写 indexOf('43') 是 G0 时代没真测过的口径，2026-09-25 实测纠正）
          // 且**等待期间页面没被堵死**（ticks > 0）。ticks=0 但 rc=0 ⇒ `pass-blocking`。
          return done(Number(v) === 0 ? (ticks > 0 ? 'pass' : 'pass-blocking') : 'fail',
                      'ticks=' + ticks + ' rc=' + v);
        }).catch(function (e) { return done('fail', String(e).slice(0, 140)); });
        return Promise.race([real, guard]);
      };
      if (isDefault) {
        global.__octaveJspiProbe = octaveJspiProbe;
        global.__octaveJspiRequire = function (feature) {
          var ok = J.api && J.smoke !== 'fail' && J.smoke !== 'timeout' && J.smoke !== 'no-entry';
          if (ok) return null;
          return feature + ': 本构建的"等用户动作"需要 JSPI，而当前页面没通过能力门（'
                 + (J.api ? ('smoke=' + J.smoke) : 'api-missing') + '）。'
                 + '支持 JSPI 的浏览器：' + JSPI_SUPPORT + '。';
        };
      }
      // 依赖 JSPI 的入口在调用前问它：可用 ⇒ 返回 null；不可用 ⇒ 返回**一句能读懂的话**
      // （而不是让用户撞上 `TypeError: WebAssembly.Suspending is not a constructor`）。
      // ⚠️ 还没冒烟过（`unprobed`）**不算失败** —— 依赖项自己会再走一次 `__octaveJspiProbe()`。

      // ⚠️ **顺序照抄页面宿主的**（execute_interp 在包装**之后**）：两个宿主原来的顺序相反
      //    （worker 是先 execute_interp 再包装），实测两者都能跑 ⇒ 取页面那一份为准，
      //    免得动到 77 个套件依赖的启动时序。
      Module.execute_interp();

      // ── 图形核心 m 树保护（issue #5，2026-10-09）──────────────────────────────
      // 现象：`title/xlabel/grid/legend/axis/hold/subplot/bar` 全报
      //   「figure: function called with too many outputs」，而裸 `plot` 正常。
      // 根因（实测钉死，见 test/browser/probe-issue5-*.mjs）：
      //   **外部宿主**（如 Octave-UI 的 SafePlotSinkPolyfill）在每次运行前往 FS 写若干
      //   **0 输出**的桩函数（`function figure (varargin)`，无 `h =`）。而核心
      //   `plot/util/gcf.m:57` 写的是 `h = figure ()` —— Octave 的**输出个数检查发生在
      //   函数体之前** ⇒ 进函数体前就抛错。凡经 `gca→gcf→figure` 的句柄路径全崩；
      //   裸 `plot` 因为宿主也换了它、不走 figure，反而幸存。
      // 两条解析规则（都在本机实测过）：
      //   ① **调用者目录优先** —— `gcf.m` 调 `figure()` 先在 `plot/util/` 里找 ⇒ 宿主
      //      覆盖核心 `plot/util/figure.m` 就直接命中桩（改 path 顺序救不了）；
      //   ② **path 顺序**（`.`=cwd 永远第一）—— 用户直接敲 `figure()` 时，宿主写在
      //      cwd 根 / home 的同名桩会盖住 plotbridge 与核心实现。
      // 做法（**最小、只读、可证伪**）：开机**快照**受保护文件；每次用户 eval 前扫一遍，
      //   ① 核心文件**签名退化**（原带输出、现 0 输出）⇒ 还原快照；
      //   ② cwd 根 / home 的**已知同名桩**（开机不存在、现出现且 0 输出）⇒ 删除；
      //   任一处改动 ⇒ `rehash`。
      //   ⚠️ 只在"退化"时动手 ⇒ **干净站点上它是纯 no-op**（反向断言见 accept-gfx-isolation）。
      //   ⚠️ 不碰 UI 仓库、不碰 Octave 树 ⇒ 三线照常吃上游更新。
      var _gfxCore = [
        '/usr/src/octave/m/plot/util/figure.m',
        '/usr/src/octave/m/plot/util/gcf.m',
        '/usr/src/octave/m/plot/util/gca.m',
        '/usr/src/octave/m/plot/util/axes.m',
        '/usr/src/octave/m/plot/util/newplot.m',
        '/usr/src/octave/m/plot/util/subplot.m',
        '/usr/src/octave/m/plot/util/hold.m',
        '/usr/src/octave/m/plot/draw/plot.m',
        '/usr/src/octave/m/plot/draw/bar.m',
        '/usr/src/octave/m/plot/appearance/title.m',
        '/usr/src/octave/m/plot/appearance/xlabel.m',
        '/usr/src/octave/m/plot/appearance/ylabel.m',
        '/usr/src/octave/m/plot/appearance/legend.m',
        '/usr/src/octave/m/plot/appearance/axis.m',
      ];
      // 宿主往"path 最前面"写的同名桩（`. `=cwd、home）—— 出现即删（开机时它们不存在）
      var _gfxShadows = [
        '/figure.m', '/plot.m', '/gcf.m', '/gca.m',
        '/home/web_user/figure.m', '/home/web_user/plot.m',
        '/home/web_user/gcf.m', '/home/web_user/gca.m',
      ];
      function _hasOutput(text) {
        // 第一个 `function` 行里，`(` 之前有 `=` ⇒ 该函数声明了输出；不是函数文件 ⇒ null。
        var m = text.match(/^[ \t]*function[ \t]+([^\n]*)/m);
        if (!m) return null;
        return m[1].indexOf('=') >= 0;
      }
      var _gfxSnap = {};                          // 核心 path → 开机内容（必有）
      function _snapshotGfx() {
        for (var i = 0; i < _gfxCore.length; i++) {
          var p = _gfxCore[i];
          try { _gfxSnap[p] = Module.FS.readFile(p, { encoding: 'utf8' }); }
          catch (e) { _gfxSnap[p] = null; }       // 本产物没有这个文件 ⇒ 不参与保护
        }
      }
      var _gfxRepaired = [];                      // 诊断/断言用：修过哪些 path
      function _repairGfx() {
        var changed = false;
        for (var i = 0; i < _gfxCore.length; i++) {
          var p = _gfxCore[i], snap = _gfxSnap[p];
          if (!snap || _hasOutput(snap) !== true) continue;    // 快照本就没输出 ⇒ 不保护
          var cur;
          try { cur = Module.FS.readFile(p, { encoding: 'utf8' }); } catch (e) { continue; }
          if (cur !== snap && _hasOutput(cur) === false) {     // 签名退化 ⇒ 还原
            try {
              Module.FS.writeFile(p, snap);
              if (_gfxRepaired.indexOf(p) < 0) _gfxRepaired.push(p);
              changed = true;
            } catch (e) { /* 还原失败不致命：下一次 eval 会再试 */ }
          }
        }
        for (var j = 0; j < _gfxShadows.length; j++) {
          var s = _gfxShadows[j], txt = null;
          try { txt = Module.FS.readFile(s, { encoding: 'utf8' }); } catch (e) { continue; }
          if (_hasOutput(txt) === false) {                     // 0 输出的同名桩 ⇒ 删
            try {
              Module.FS.unlink(s);
              if (_gfxRepaired.indexOf(s) < 0) _gfxRepaired.push(s);
              changed = true;
            } catch (e) {}
          }
        }
        if (changed) { try { _rawEvalString.call(Module, 'rehash;'); } catch (e) {} }
        return changed;
      }
      _snapshotGfx();
      // 包一层 eval_string：**用户求值前**先修一次（宿主在上一轮末尾写的桩，这一轮开头清掉）。
      // ⚠️ 内部调用（本内核自己调 eval_string）也走这层 —— 无害（无桩时是 no-op）。
      // ⚠️ `_rawEvalString` 必须在 `_repairGfx` 之前捕获（rehash 走原始函数，避免递归）。
      var _rawEvalString = Module.eval_string;
      if (typeof _rawEvalString === 'function') {
        Module.eval_string = function () {
          try { _repairGfx(); } catch (e) { /* 守卫不许弄坏求值本身 */ }
          return _rawEvalString.apply(this, arguments);
        };
      }
      // worker 路径走 eval_async：同样在它前面修一次。
      if (typeof Module.eval_async === 'function') {
        var _rawEvalAsync = Module.eval_async;
        Module.eval_async = function () {
          try { _repairGfx(); } catch (e) {}
          return _rawEvalAsync.apply(this, arguments);
        };
      }
      st.gfxGuard = function () { return { repaired: _gfxRepaired.slice() }; };

      // 资产车道：读清单但不预先加载任何东西（能力资产用到哪个才 fetch 哪个）。
      // 控制台里：await OctaveAssets.load('ode15s') / OctaveAssets.list()
      var Assets = host.assets(Module, baseOf(), function () { return st.ready; });
      st.assets = Assets;
      // ★ B6：资产清单**按档**（线程档的 `.oct` 在 `oct-threads/`，理由见 bridge/lane.js）。
      Assets.init(lane.manifest).then(function () {
        host.print('[assets] 可用资产: ' + Assets.list().join(', '));
        return Assets.load(CORE_DLDFCN).catch(function (e) {
          warn('[assets] dldfcn 核心组装载失败（这些函数将不可用）: ' + e.message);
          return null;
        });
      }).then(function () {
        return Assets.load(HELP_ASSETS).catch(function (e) {
          warn('[assets] help 数据装载失败（help/lookfor 将不可用）: ' + e.message);
          return null;
        });
      }).then(function () {
        // ⚠️ **不要再要求装 `installed_packages.m`**：那是 7.2 车道的东西（vanilla 11.3.0
        //    那个文件是完好的，PROMOTION.md 已核实）—— 以前挂着它会让每次开页打一句误导性告警。
        return Assets.load(PKG_ASSETS).then(function () {
          try {
            Module.eval_string(
              "if (exist('__pkgfix_sync_db__')) " +
              "  try; __pkgfix_sync_db__ (); catch e; " +
              "    warning('pkg sync failed: %s', e.message); end; endif;");
          } catch (e) { warn('[pkg] 数据库同步失败: ' + e.message); }
          return null;
        }).catch(function (e) {
          warn('[assets] pkg 支持装载失败（pkg list/load 将不可用）: ' + e.message);
          return null;
        });
      }).then(function () {
        st.ready = true;
        host.onReady(null);
      }).catch(function (e) {
        warn('[assets] 清单未就绪（无 assets/ 目录时属正常）: ' + e.message);
        st.ready = true;
        host.onReady(e);
      });

      // 音频/录音/文件选择三个队列桥：**默认实例单例**（window.Octave* 别名绑死默认实例）
      //   ⇒ 只在默认实例上 init；非默认实例的音频/文件选择是**下一次重链**的活。
      if (isDefault) {
        if (global.OctaveAudio) {
          global.OctaveAudio.init().catch(function (e) { warn('[audio] 桥未就绪: ' + e.message); });
          // 浏览器 autoplay 策略：首次点击解锁 AudioContext。
          global.addEventListener('click', function once() {
            global.OctaveAudio.resume();
            global.removeEventListener('click', once);
          });
        }
        // 录音桥：只轮询队列。麦克风权限**不在页面加载时要** —— 那会在用户还没表达任何意图时
        //   弹权限框；真正要权限的时机是第一次 record()。
        if (global.OctaveRec) {
          global.OctaveRec.init().catch(function (e) { warn('[audiorec] 桥未就绪: ' + e.message); });
        }
        // 文件选择器桥：只轮询队列，不主动弹任何框（弹框的时机是用户调 uigetfile）。
        if (global.OctaveFilePick) {
          global.OctaveFilePick.init().catch(function (e) { warn('[filepick] 桥未就绪: ' + e.message); });
        }
      }
    }

    return {
      module: Module,
      clicks: clicks,
      state: st,
      caps: caps,
      assets: function () { return st.assets; },
      isReady: function () { return !!st.ready; },
      isArmed: function () { return !!st.armed; },
      mountHome: mountHome,
      jspi: function () { return J; },
    };
  }

  global.createOctaveCore = createOctaveCore;
})(typeof window !== 'undefined' ? window : self);
