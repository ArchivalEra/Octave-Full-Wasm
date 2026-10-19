// Octave-Full-Wasm — 资产懒加载器（按需把 .oct / .m 注入 wasm 文件系统）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 设计要点：
//   * 首包只带 loader + manifest（几 KB），能力资产用到哪个才 fetch 哪个；
//   * `.oct` 是二进制 side module → 写进 FS 后由 addpath + 首次调用触发 dlopen；
//   * 大批 .m（Forge 包）打成**单个 JS 包**，避免几百个碎请求，
//     也免掉在 JS 里实现 tar 解析——包的形态由生成器决定。
//
// 资产清单格式（assets/manifest.json）：
//   { "version": 1, "assets": [
//       { "name": "ode15s", "kind": "oct", "url": "assets/oct/__ode15__.oct",
//         "sha256": "…", "mount": "/usr/src/octave/m/oct/__ode15__.oct",
//         "addpath": "/usr/src/octave/m/oct", "deps": [], "note": "…" },
//       { "name": "statistics-1.7.7", "kind": "js", "url": "assets/pkg/statistics-1.7.7.js",
//         "sha256": "…", "deps": [], "note": "…" } ] }
//
// JS 包的形态（生成器产出，见 build/gen-asset-manifest.py）：
//   window.__OCT_ASSETS__['<name>'] = { files: { "<绝对路径>": "<内容>" },
//                                       addpath: ["<目录>", …] };
//
// 用法：
//   await OctaveAssets.init();              // 读 manifest
//   await OctaveAssets.load('ode15s');      // 含依赖自动解析
//   OctaveAssets.list();                    // 可用资产
//
// ── C6（2026-09-26）：**每实例一份** ─────────────────────────────────────────
// 以前 manifest/loaded/inflight 是模块级单例 ⇒ 同页第二个实例的 load() 直接命中
// 缓存，**文件永远进不了第二个实例的 FS**。现在全部状态收进 `createOctaveAssets()`
// 工厂；`window.OctaveAssets` 是**默认实例**的别名（26 个验收套件 + boot 链 +
// `pkg.m` 的裸名调用读的都是它，语义不变）。
// ⚠️ `OCTAVE_M` 这个字面量被 `.githooks/check-consistency.py` 逐字比对（assets.py
//    与 loader 必须同值）——别改写法。

(function (global) {
  'use strict';

  // ⚠️ 清单 URL 的注入点**已经存在**（下面的 `init(url)`，实现见 `fetchJSON(url || MANIFEST_URL)`）
  //    —— B6 多档复用它（w64 传 `assets/manifest.w64.json`）：**别再加法子**，
  //    两套机制必然分叉（本仓的老教训）。
  var MANIFEST_URL = 'assets/manifest.json';
  var OCTAVE_M = '/usr/src/octave/m';

  // module：实例的 Module 对象；传 **null** = 惰性绑 `global.Module`（默认实例语义，
  // 与旧版逐字节一致）。base：全部 fetch/script URL 的前缀。isReady：实例就绪谓词。
  function createOctaveAssets (module, base, isReady) {
    base = base || '';
    var readyFn = isReady || function () { return global.__octaveReady === true; };

    var manifest = null;
    // ── Forge 按需拉取状态（设计稿 §3）——每实例一份（与 manifest/loaded 同款纪律）──
    var _catalog = null;        // 已读到的货架目录（缓存）
    var _catalogP = null;       // 读取中的 promise（去重）
    var _catalogByName = {};    // name → pack 条目
    var _catalogSourceOverride = null;   // ★ 测试注入面（见 catalog() 上方注释）
    var installSeen = {};       // 安装去重（同实例内）
    // ── 给 `.m` 侧观察的**安装结果账**（T4，2026-10-12）──────────────────────────
    //   为什么需要：`pkg load <货架上的包>` 在 `.m` 侧只能"点火"（`__web_run_js__` 即返），
    //   而落盘是**异步**的 ⇒ `.m` 必须能分辨四种终态：装好了 / 装失败（带原因）/
    //   货架上没有 / 货架读不到。这三样跟 available/loaded 一起进 /tmp/webassets.json。
    //   读它的：build/pkgfix/__webassets_info__.m 与 build/pkgfix/__websource_of__.m。
    var installError = {};      // name → 失败原因（成功时删）
    var catalogMiss = {};       // name → 1（货架**读成功**但确实没这个包）
    var _compiled = {};         // B 线：name → {octPath, diagnostics}（compileExtension 幂等缓存）
    var _tcWorkers = {};        // target → Promise<Worker>（工具链 Worker 池：重活离主线程，一次起复用）
    var catalogState = 'unread'; // unread | ok | fail —— miss 是不是终态取决于它
    var byName = {};
    var loaded = {};       // name -> {files: n, addpath: [...]}
    var inflight = {};     // name -> Promise
    var listeners = [];

    function log(msg) { if (global.console) console.log('[assets] ' + msg); }

    // ── 结构化错误码（UI mail/028 Q1，2026-10-17）───────────────────────────────
    // 为什么：报错的 `message` 是给人读的中文（本仓工作语言）；但 UI 的国际化层需要
    // **机器可读的稳定代码**来选语言文案（`t('errors.' + err.code)`），AI/WebMCP Agent
    // 也靠它做确定性决策——**正则匹配中文消息是脆弱契约**（消息改一个字，分类就错）。
    // ⇒ 每个 throw 都带 `err.code`（稳定、闭集、与 `__verdict__.cause` 同词表扩展）；
    // `message` 保持中文（人读不变）。⚠️ code 是**追加**字段：旧消费者读 message 照旧。
    function errCode(code, message) {
      var e = new Error(message);
      e.code = code;                       // 机器可读（UI/AiM/Agent 契约）
      return e;
    }

    // ── 宿主架构（单一产地；install 的架构界与 statusOf 的 compatible 都用它）────────
    // 判据 = **选档结果**（`octaveLaneState.lane`，`w64*` ⇒ wasm64），与 `bridge/lane.js` 同源
    // —— 不新增第二处判据。老宿主/测试（不传 lane）⇒ ''（不表态 ⇒ 不拦，向后兼容）。
    function hostArchOf(opts) {
      try {
        var lane = '';
        var st = (typeof window !== 'undefined' && window.octaveLaneState)
               || (typeof self !== 'undefined' && self.octaveLaneState);
        if (st && st.lane) lane = st.lane;
        if (!lane && opts && opts.lane && opts.lane.lane) lane = opts.lane.lane;
        if (/^w64/.test(lane)) return 'wasm64';   // w64 / w64-base / w64-threads
        if (lane) return 'wasm32';                // base（wasm32 线 = 单线程）
        return '';
      } catch (e) { return ''; }
    }

    function fs() {
      var M = module || global.Module;
      if (!M || !M.FS) throw errCode('FS_NOT_READY', 'Module.FS 尚未就绪（Octave 还没起来？）');
      return M.FS;
    }
    function M() {
      var m = module || global.Module;
      if (!m) throw errCode('MODULE_NOT_READY', 'Module 尚未就绪');
      return m;
    }
    function withBase(u) { return base + u; }

    function mkdirp(path) {
      var parts = path.split('/').filter(Boolean);
      var cur = '';
      for (var i = 0; i < parts.length; i++) {
        cur += '/' + parts[i];
        try { fs().mkdir(cur); } catch (e) { /* 已存在 */ }
      }
    }

    function sha256Hex(buf) {
      if (!global.crypto || !global.crypto.subtle) return Promise.resolve(null);
      return global.crypto.subtle.digest('SHA-256', buf).then(function (d) {
        return Array.prototype.map.call(new Uint8Array(d), function (b) {
          return ('0' + b.toString(16)).slice(-2);
        }).join('');
      });
    }

    function fetchBinary(url) {
      return fetch(withBase(url)).then(function (r) {
        if (!r.ok) throw errCode('ASSET_FETCH_FAILED', '取资产失败 ' + withBase(url) + ' → HTTP ' + r.status);
        return r.arrayBuffer();
      });
    }

    function fetchJSON(url) {
      return fetch(withBase(url)).then(function (r) {
        if (!r.ok) throw errCode('MANIFEST_FETCH_FAILED', '取清单失败 ' + withBase(url) + ' → HTTP ' + r.status);
        return r.json();
      });
    }

    function loadScript(url) {
      // ⚠️ C3/B5（2026-09-26）：Forge 包（kind:'js'）在页面上靠 <script> 注入，
      //    在 DedicatedWorker 里必须改用 importScripts。判定用**显式标记**
      //    `__octaveWorker`，**不用 `!document`** —— worker 宿主为了 toolkit 的 EM_ASM
      //    装了 document shim，按 document 判断会误走 <script> 路径（空操作、promise 永不
      //    settle，实测：plotbridge 静默装不上）。页面路径逐字节不变。
      if (global.__octaveWorker && typeof global.importScripts === 'function') {
        return new Promise(function (resolve, reject) {
          try { global.importScripts(withBase(url)); resolve(); }
          catch (e) { reject(new Error('importScripts 失败 ' + withBase(url) + '：' + e)); }
        });
      }
      return new Promise(function (resolve, reject) {
        var s = global.document.createElement('script');
        s.src = withBase(url);
        s.onload = function () { resolve(); };
        s.onerror = function () { reject(new Error('加载 JS 包失败 ' + withBase(url))); };
        global.document.head.appendChild(s);
      });
    }

    function writeFiles(files) {
      var n = 0;
      for (var p in files) {
        if (!Object.prototype.hasOwnProperty.call(files, p)) continue;
        mkdirp(p.replace(/\/[^/]*$/, ''));
        fs().writeFile(p, files[p]);
        n++;
      }
      return n;
    }

    // Chrome 禁止在**主线程同步编译**大于 8MB 的 wasm 模块：
    //     RangeError: WebAssembly.Compile is disallowed on the main thread,
    //     if the buffer size is larger than 8MB.
    // 而 Octave 的 dlopen 是**同步**的（emscripten 的 `__dlopen_js` 恒传 loadAsync:false），
    // 所以超过这个尺寸的 `.oct` 必须**由这一侧先异步预加载**：
    // `loadDynamicLibrary()` 开头就查 `LDSO.loadedLibsByName[libName]`，命中直接返回，
    // 于是 Octave 之后同步 dlopen 时不会再编译一次。
    // （`Module.loadDynamicLibrary` 由 `build/post.js` 暴露。实测边界：SLICOT 模块
    //   8.1MB 能过、P5 的 OSMesa toolkit 10.8MB 不行。）
    var SYNC_COMPILE_LIMIT = 8 * 1024 * 1024;

    // 尺寸超限就先异步预加载。**失败不算致命** —— 交给 Octave 自己的 dlopen 报错，
    // 那条信息（"could not load dynamic lib"）比这里更贴切。
    function preloadIfHuge(name, mount, buf) {
      if (buf.byteLength <= SYNC_COMPILE_LIMIT) return Promise.resolve();
      var M = Msafe();
      if (!M || typeof M.loadDynamicLibrary !== 'function') {
        log(name + ' 超过 8MB 但 Module.loadDynamicLibrary 不可用（post.js 没烘进去？）');
        return Promise.resolve();
      }
      return M.loadDynamicLibrary(mount, { loadAsync: true, global: true, nodelete: true })
        .then(function () {
          log(name + ' 异步预加载完成（' + buf.byteLength + ' 字节 > 8MB，绕开主线程同步编译限制）');
        }, function (e) {
          log(name + ' 异步预加载失败（交给 dlopen 报错）: ' + e);
        });
    }

    function Msafe() { return module || global.Module; }

    function addPaths(dirs) {
      var M = Msafe();
      if (!dirs || !dirs.length || !M || !M.eval_string) return;
      var expr = dirs.map(function (d) {
        return 'addpath("' + d.replace(/"/g, '\\"') + '");';
      }).join('');
      M.eval_string(expr);
    }

    function evalSafe(expr) {
      var M = Msafe();
      if (M && M.eval_string) { try { M.eval_string(expr); } catch (e) {} }
    }

    // ── 能力层装载器（接缝 §5④）──────────────────────────────────────────────
    //   两种可能的形态：① Pyodide（起一个 Python 运行时，供 symbolic 用）；
    //   ② 未来的其他能力层（按 name 分派，别在调用点硬编码）。
    //   ⚠️ 诚实边界：本函数**只负责把运行时备好 + 记账**；"Octave 的 symbolic 包怎么跟它说话"
    //      是 IPC 缝的事（`.m` 侧 python_ipc_* 那条）—— 那是下一批（本批 §5④ 的判据只是
    //      "install('symbolic') 能把能力层拉进来且不报错"，见验收套件）。
    var layers = {};        // name → { ready:true, kind, base, info }
    function installLayer(p) {
      if (p.name === 'pyodide') {
        // 站点上资产在 <base>/assets/pyodide/pyodide/（provision-pyodide.sh 装配）
        // ⚠️ **别写 `var base = base + …`**：`var` 提升会让右边那个 `base` 也是本地的 ⇒
        //    `undefinedassets/pyodide/`（实测抓到）。用局部名 `pBase`。
        var pBase = withBase('assets/pyodide/pyodide/');
        if (layers.pyodide && layers.pyodide.ready) return Promise.resolve(layers.pyodide);
        // ★ 真起运行时（2026-10-15，IPC 缝的前提）：symbolic 的 `.m` 经 `__web_run_js__`
        //   → `__octaveRunPython`（octave-core.js）**同步**调 Pyodide ⇒ 运行时必须
        //   **已经**起好并挂在 `global.pyodide`（同步调用点等不了 Promise）。
        //   起实例是异步的 ⇒ 在本函数里 await 掉（install 本来就是 Promise 语义）。
        //   ⚠️ 失败必须响亮（不静默降级成"层就位"）。
        return fetchJSON(pBase + 'pyodide-lock.json').then(function () {
          if (global.pyodide && typeof global.pyodide.runPython === 'function') {
            layers.pyodide = { ready: true, kind: 'python', base: pBase,
                               version: p.version, bytes: p.size };
            return layers.pyodide;
          }
          // ⚠️ 动态 import() 收**模块说明符**，浏览器要求它可解析为 URL —— 相对串会被拒
          //   （实测：`Failed to resolve module specifier 'assets/...'`）。用基于当前文档的绝对 URL。
          var pyUrl = new URL(pBase + 'pyodide.mjs', global.location.href).href;
          return import(pyUrl).then(function (mod) {
            return mod.loadPyodide({ indexURL: pBase });
          }).then(function (py) {
            // sympy 是 symbolic 的硬依赖（纯 Python）⇒ 装它是"能力层就绪"的一部分
            return py.loadPackage(['sympy']).then(function () { return py; });
          }).then(function (py) {
            global.pyodide = py;             // ← 桥函数按名找它（同步调用点）
            layers.pyodide = { ready: true, kind: 'python', base: pBase,
                               version: py.version, bytes: p.size };
            log('能力层就绪：pyodide ' + py.version + '（含 sympy）');
            publish();
            return layers.pyodide;
          });
        }, function (e) {
          throw errCode('LAYER_UNREACHABLE', '能力层 pyodide 不可达（assets/pyodide/ 没装？跑 provision-pyodide.sh）：'
                          + (e && e.message ? e.message : e));
        });
      }
      return Promise.reject(new Error('未知的能力层：' + p.name + '（本构建只实现了 pyodide）'));
    }

    function loadOne(name, seen) {
      if (loaded[name]) return Promise.resolve(loaded[name]);
      if (inflight[name]) return inflight[name];
      var a = byName[name];
      if (!a) return Promise.reject(new Error('清单里没有资产: ' + name));

      seen = seen || {};
      if (seen[name]) return Promise.reject(new Error('资产依赖成环: ' + name));
      seen[name] = true;

      var deps = (a.deps || []).reduce(function (chain, d) {
        return chain.then(function () { return loadOne(d, seen); });
      }, Promise.resolve());

      var p = deps.then(function () {
        log('加载 ' + name + ' …');
        if (a.kind === 'oct') {
          return fetchBinary(a.url).then(function (buf) {
            return sha256Hex(buf).then(function (hex) {
              if (a.sha256 && hex && hex !== a.sha256) {
                throw errCode('SHA_MISMATCH', '资产校验失败 ' + name + '（期望 ' + a.sha256.slice(0, 12) + '… 实得 ' + hex.slice(0, 12) + '…）');
              }
              var mount = a.mount || (OCTAVE_M + '/oct/' + name + '.oct');
              mkdirp(mount.replace(/\/[^/]*$/, ''));
              fs().writeFile(mount, new Uint8Array(buf));
              // 超 8MB 的模块先异步预加载，再做原来的收尾（别名/加路径/登记）
              return preloadIfHuge(name, mount, buf).then(function () {
                var dir = mount.replace(/\/[^/]*$/, '');
                // Octave 按**文件名**找 .oct 模块：一个模块导出的函数若与文件名不同名，
                // 必须像桌面版那样给每个函数名建符号链接（例如 bzip2.oct -> gzip.oct）。
                // 否则 exist()/which() 都找不到——这是 webio.oct 六个内建第一次全失联的原因。
                (a.aliases || []).forEach(function (fn) {
                  var link = dir + '/' + fn + '.oct';
                  try { fs().symlink(mount, link); } catch (e) { /* 已存在 */ }
                });
                var dirs = a.addpath ? [a.addpath] : [dir];
                addPaths(dirs);
                loaded[name] = { files: 1, addpath: dirs };
                log(name + ' 就绪（' + buf.byteLength + ' 字节 → ' + mount + '）');
                return loaded[name];
              });
            });
          });
        }
        if (a.kind === 'octdir') {
          var dir = a.mount_dir || (OCTAVE_M + '/forge/' + name + '/oct');
          mkdirp(dir);
          var b = a.base_url || a.url;
          return Promise.all((a.files || []).map(function (f) {
            return fetchBinary(b + '/' + f).then(function (buf) {
              fs().writeFile(dir + '/' + f, new Uint8Array(buf));
              return f;
            });
          })).then(function (names) {
            // aliases：模块文件名与它导出的函数名不同时，Octave 按**文件名**
            // 找不到那个函数（见 §4.11）。control 包的 lti_input_idx.oct 导出
            // __lti_input_idx__，就是这种情况。
            // 值可以是字符串（函数名与文件名只差下划线包裹）或 {file, names}。
            (a.aliases || []).forEach(function (al) {
              var file, fns;
              if (typeof al === 'string') {
                file = al;
                fns = [al.indexOf('__') === 0 ? al : '__' + al + '__'];
              } else {
                file = al.file; fns = al.names || [];
              }
              fns.forEach(function (fn) {
                try { fs().symlink(dir + '/' + file + '.oct', dir + '/' + fn + '.oct'); }
                catch (e) { /* 已存在 */ }
              });
            });
            addPaths([dir]);
            loaded[name] = { files: names.length, addpath: [dir] };
            log(name + ' 就绪（' + names.length + ' 个 .oct → ' + dir + '）');
            return loaded[name];
          });
        }
        // kind=file：把一份**数据文件**放到指定 mount 路径，不 addpath。
        // 用来补 Octave 运行时需要、但构建时没打进 octave.data 的文件
        // （最典型的是 doc-cache：没有它，disp(函数对象)/help 会去调
        // makeinfo 子进程，而本构建无 shell，于是清晰报错）。
        if (a.kind === 'file') {
          return fetchBinary(a.url).then(function (buf) {
            return sha256Hex(buf).then(function (hex) {
              if (a.sha256 && hex && hex !== a.sha256) {
                throw errCode('SHA_MISMATCH', '资产校验失败 ' + name + '（期望 ' + a.sha256.slice(0, 12) + '… 实得 ' + hex.slice(0, 12) + '…）');
              }
              var mount = a.mount;
              if (!mount) throw errCode('ASSET_NO_MOUNT', '资产 ' + name + ' 缺少 mount 路径');
              mkdirp(mount.replace(/\/[^/]*$/, ''));
              fs().writeFile(mount, new Uint8Array(buf));
              loaded[name] = { files: 1, mount: mount };
              log(name + ' 就绪（' + buf.byteLength + ' 字节 → ' + mount + '）');
              return loaded[name];
            });
          });
        }

        if (a.kind === 'js') {
          return loadScript(a.url).then(function () {
            var bundle = (global.__OCT_ASSETS__ || {})[name];
            if (!bundle) throw errCode('JS_BUNDLE_NO_META', 'JS 包 ' + a.url + ' 没声明 __OCT_ASSETS__["' + name + '"]');
            var n = writeFiles(bundle.files || {});
            addPaths(bundle.addpath || []);
            // 注意：**不要**在这里手动 run PKG_ADD —— Octave 在 addpath 时会自己执行
            // 目录里的 PKG_ADD。手动再来一次会让幂等性差的注册（如 imformats("add")）
            // 重复执行，典型症状是 `imformats("png")` 返回两条、imwrite 报
            // "a cs-list cannot be further indexed"。
            loaded[name] = { files: n, addpath: bundle.addpath || [] };
            log(name + ' 就绪（' + n + ' 个文件）');
            return loaded[name];
          });
        }
        throw errCode('UNKNOWN_ASSET_KIND', '未知资产类型: ' + a.kind);
      });

      inflight[name] = p.then(function (r) {
        delete inflight[name];
        afterLoad(name);
        listeners.forEach(function (f) { try { f(name, r); } catch (e) {} });
        return r;
      }, function (e) {
        delete inflight[name];
        if (global.console) console.error('[assets] ' + name + ' 失败: ' + e.message);
        throw e;
      });
      return inflight[name];
    }

    // ── 装载成功后：账本落盘 + **把 pkg 数据库重新对齐**（小口子 4）────────────────
    // 为什么必须重对齐：pkg 的数据库是**启动时**由 `__pkgfix_sync_db__()` 从磁盘现状生成的一次
    // 快照。按需装载的包（`await OctaveAssets.load('statistics')`）在那一刻还没落盘 ⇒
    // `pkg list` 永远说 "no packages installed"、`pkg load statistics` 说
    // **"is not installed"**（实测 —— 而 statistics 明明已经装好了）。
    // ⇒ 每次装完**包**（`assets/pkg/*.js`）就重跑一次 sync，数据库随时反映现状。
    // ⚠️ 只在包装载后做：boot 期间的前几个基础设施资产可能早于 Octave 就绪，那时 eval 是危险的。
    function afterLoad (name) {
      publish();
      try {
        var a = byName[name];
        var isPkg = !!(a && typeof a.url === 'string' && a.url.indexOf('assets/pkg/') === 0);
        var M = Msafe();
        if (isPkg && readyFn() === true && M && M.eval_string) {
          M.eval_string("if (exist ('__pkgfix_sync_db__') == 2) try; __pkgfix_sync_db__ (); catch; end; end");
        }
      } catch (e) { /* 重对齐失败不致命：老快照仍然可用，只是看不到新装的包 */ }
    }

    // 为什么要落文件：Octave 的解释器**看不见 JS 的加载器对象**，而"包可见性"这件事必须能从
    // `.m` 侧问出来（否则 `pkg load statistics` 只会说一句误导人的 "is not installed" ——
    // statistics 明明就在 assets/ 里等着被装）。落一个小 JSON 是最省事又无副作用的桥
    //（`jsondecode` 本构建可用，见批次 1a）。
    // ⚠️ 读它的是 `build/pkgfix/__webassets_info__.m`；**只在 init 之后与每次装载成功之后**刷新，
    //    失败不致命（try 全兜住）—— 这个文件只是"给人看的账"，不该弄坏任何主流程。
    function publish () {
      try {
        var f = (Msafe() && Msafe().FS) || null;
        if (!f || !f.writeFile) return;
        // Forge 包（`assets/pkg/<名字>.js`）单独分出来：`pkg list` 只关心"包"，
        // 不该把 `plotbridge`/`doc-cache` 这类**基础设施资产**当成可选包列给用户看。
        function pkgs (names) {
          return names.filter(function (n) {
            var a = byName[n];
            return !!(a && typeof a.url === 'string' && a.url.indexOf('assets/pkg/') === 0);
          });
        }
        var av = Object.keys(byName), ld = Object.keys(loaded);
        f.writeFile('/tmp/webassets.json', JSON.stringify({
          available: av, loaded: ld,
          pkg_available: pkgs(av), pkg_loaded: pkgs(ld),
          // T4：货架侧的三样观察值（`pkg load <未随站包>` 靠它们分辨终态，见 __websource_of__.m）
          catalog_state: catalogState,
          catalog_packs: Object.keys(_catalogByName),
          install_error: installError,
          catalog_miss: Object.keys(catalogMiss),
          stamp: Date.now()
        }));
      } catch (e) { /* 记账失败不影响任何东西 */ }
    }

    // ── B 线的四个内部缝（§4.3：不暴露给调用方；每个可单独测）───────────────────

    // ① toolchainWorker(target)：起/复用编译 Worker（浏览器适配器 = 站点 assets/llvm/browser/worker.mjs，
    //    协议：init{clangWasmUrl,lldWasmUrl,sysrootTarUrl,sysrootSha256} → ready；compile → result）。
    //    ★ sysroot 按 target 选档（两档 sysroot 都发是 v0.1.1 修的 issue #1：错档产物缺
    //    _emscripten_tls_init ⇒ 线程宿主拒载）。sysroot sha 从工具链 manifest 读（fail-closed，
    //    不硬编码）。
    function toolchainWorker(target, log) {
      if (_tcWorkers[target]) return _tcWorkers[target];
      _tcWorkers[target] = Promise.all([fetchJSON('assets/llvm/manifest.json'),
                                        fetchJSON('assets/llvm/config.h.json').catch(function () { return null; })])
      .then(function (both) {
        var man = both[0], _configMacros = both[1];
        var byName = {};
        (man.assets || []).forEach(function (a) { byName[a.name] = a; });
        var sysroot = (target === 'wasm64') ? 'sysroot-headers.wasm64.tar' : 'sysroot-headers.tar';
        if (!byName[sysroot]) throw errCode('FLAVOR_UNAVAILABLE', '工具链缺 ' + sysroot + '（站点供给不全？跑 provision-llvm-wasm.sh）');
        var B = 'assets/llvm/';
        // ★ 用**本仓的分片 worker**（bridge/compile-worker.mjs，随页面资产上站）：
        //   首编只拉 clang + 本档 sysroot（两件、各自核 sha）；lld 31.8 MB 推迟到
        //   **首次链接**才拿。用户点令 2026-10-18：「需要保证能分次懒加载」。
        //   编排逻辑仍是生产者 driver/compile-core.mjs（worker 里 import，不复制）。
        var w = new Worker('compile-worker.mjs', { type: 'module' });
        return new Promise(function (resolve, reject) {
          w.onerror = function (e) { reject(errCode('MODULE_NOT_READY', 'Worker 起不来：' + (e.message || e.filename || '?') + (e.lineno ? ':' + e.lineno : ''))); };
          w.onmessage = function (ev) {
            var m = ev.data || {};
            if (m.type === 'log') { log(m.text); return; }
            if (m.type === 'phase') { log('[phase] ' + (m.phase || '?')); return; }
            if (m.type === 'ready') {
              w.onmessage = null;
              if (m.bytes) log('[lazy] 首编已拉：clang ' + (m.bytes.clang / 1048576).toFixed(1)
                               + ' MB + sysroot ' + (m.bytes.sysroot / 1048576).toFixed(1)
                               + ' MB（lld 推迟到首链）');
              resolve(w);
            }
          };
          w.postMessage({ type: 'init',
            clangWasmUrl: B + 'clang.wasm', clangGlueUrl: B + 'clang.js',
            lldWasmUrl: B + 'lld-wasm-only.wasm', lldGlueUrl: B + 'lld-wasm-only.js',
            sysrootTarUrl: B + sysroot, sysrootSha256: byName[sysroot].sha256,
            // ★ Octave 头**按目标档**选（2026-10-19 C2c 真根因）：wasm32 与 wasm64 树的
            //   octave/mxtypes.h 分叉（mwSize/mwIndex int32 vs int64）—— 用错档头编出的
            //   .oct 在宿主上索引宽度错位 ⇒ "Invalid resizing operation"。
            //   缺 wasm64 那份（旧站点）⇒ 回退 wasm32 版并让 worker 打警告（不静默）。
            octincTarUrl: (target === 'wasm64')
              ? 'assets/octinc/octave-headers.wasm64.tar.gz'
              : 'assets/octinc/octave-headers.tar.gz',
            configMacros: _configMacros });
        });
      });
      return _tcWorkers[target];
    }

    // ②b cfgReady()：config.h 宏数（诊断用；真正的 config.h 由 worker 写进 /src）
    function cfgReady() {
      return fetchJSON('assets/llvm/config.h.json').then(function (c) {
        return Object.keys(c || {}).length;
      }, function () { return 0; });
    }

    // ② headersInto(M, target)：Octave 头进**引擎 FS**（assets/octinc/ 一次拉；
    //    tar 解包委托引擎 gunzip+untar）+ 合成 config.h（25 宏跟 catalog 走：build-pkg-oct.sh
    //    emit_config_h 的同款产物，站点 assets/llvm/config.h.json 由供给脚本从容器取出）。
    var _headersDone = false;
    function headersInto(M, target) {
      if (_headersDone) return Promise.resolve(_headersDone);
      var inc = '/src/octinc';
      return fetchBinary('assets/octinc/octave-headers.tar.gz').then(function (buf) {
        M.FS.writeFile('/tmp/octinc.tar.gz', new Uint8Array(buf));
        var rc = M.eval_string("__forge_src_list__('/tmp/octinc.tar.gz', '" + inc + "', true)");
        if (rc !== 0) throw errCode('UNPACK_FAILED', 'Octave 头解包失败（rc=' + rc + '）');
        return fetchJSON('assets/llvm/config.h.json');
      }).then(function (cfg) {
        // config.h：25 宏逐条写（数据跟 catalog 走，不硬编码 —— §10 判据 2）
        var lines = ['#pragma once'];
        Object.keys(cfg || {}).forEach(function (k) { lines.push('#define ' + k + ' ' + cfg[k]); });
        M.FS.writeFile(inc + '/config.h', lines.join('\n'));
        _headersDone = (cfg && Object.keys(cfg).length) || 0;
        return _headersDone;
      });
    }

    // ②c 模块表（站点资产 `assets/pkg-module-table.json`，由 build/pkg-module-table.json
    //     上站）：包名 ⇒ [{name, sources:[…]}]。缺失 ⇒ 走 DEFUN 扫描兜底（不阻断编译）。
    var _moduleTables = null;
    function loadModuleTables() {
      if (_moduleTables) return Promise.resolve(_moduleTables);
      return fetchJSON('assets/pkg-module-table.json')
        .then(function (d) {
          _moduleTables = (d && d.module_table) || {};
          return _moduleTables;
        })
        .catch(function () { _moduleTables = {}; return _moduleTables; });
    }

    // ③ workerCompile(worker, files, target, log)：发 compile 请求。
    //    ★ v2（2026-10-18 多 TU 批）：模块表**优先来自数据**，扫 DEFUN 只作兜底。
    //    为什么数据优先（实测）：`miscellaneous` 的 `sample.cc` 在 11.3.0 头下编不过
    //    （`OCTAVE__RAND_UNIFORM()` 零参调用 vs 11.3.0 的 `rand_uniform(n, p)`），
    //    而容器 `build-pkg-oct.sh` 的模块表**本来就没列它**（现役站点只有
    //    cell2cell.oct + partint.oct）。靠扫 DEFUN 全编会造出"编译失败"，让人误判工具链坏。
    //    数据的产地 = `build/pkg-module-table.json`（容器表的对账副本，闸门
    //    `check-pkg-module-table.py` 盯着）；站点侧随 `assets/manifest*` 或 catalog 走。
    //    ⚠️ 产物名 = **源 basename**（不是 DEFUN 名）：现役
    //    `assets/octdir/miscellaneous/partint.oct` 的导出表同时有 `Gpartcnt` 与
    //    `Gpartint` ⇒ 一个源里的多个 DEFUN 共用一个以**源名**命名的模块。
    function moduleTable(files, log, pkgName) {
      var mods = [];
      // ① 数据表（站点资产；已由 loadModuleTables 预取到 _moduleTables）
      var tbl = (pkgName && _moduleTables && _moduleTables[pkgName]) || null;
      if (tbl && tbl.length) {
        mods = tbl.map(function (m) { return { name: m.name, sources: m.sources.slice() }; });
        log('[tu] 模块表来自数据（' + mods.length + '）：' + mods.map(function (m) { return m.name; }).join(', '));
        return mods;
      }
      // ② 兜底：扫 DEFUN，按**源 basename** 建模块（多 DEFUN 共用一个模块）
      var cc = Object.keys(files).filter(function (n) { return /\.(cc|cpp|c)$/.test(n); });
      cc.forEach(function (rel) {
        var text = String(files[rel] || '');
        var names = [];
        var re = /DEFUN_DLD\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)/g, m;
        while ((m = re.exec(text)) !== null) names.push(m[1]);
        if (!names.length) return;
        var base = String(rel).replace(/^\.\//, '').split('/').pop().replace(/\.[^.]+$/, '');
        mods.push({ name: base + '.oct', sources: [rel], defuns: names });
      });
      if (!mods.length) return null;
      var withDefun = {};
      mods.forEach(function (m) { withDefun[m.sources[0]] = 1; });
      var helpers = cc.filter(function (rel) { return !withDefun[rel]; });
      if (helpers.length) {
        mods[0].sources = mods[0].sources.concat(helpers);
        log('[tu] 辅助源并进 ' + mods[0].name + '：' + helpers.join(', '));
      }
      log('[tu] 模块表来自 DEFUN 扫描（兜底，' + mods.length + '）：'
          + mods.map(function (m) {
              return m.name + (m.defuns.length > 1 ? '[' + m.defuns.join('+') + ']' : '');
            }).join(', '));
      return mods;
    }

    function workerCompile(w, files, target, log, pkgName) {
      var names = Object.keys(files).sort(function (a, b) {
        var score = function (n) { return /__/.test(n) ? 0 : (/^[^/]+\.cc$/.test(n) ? 1 : 2); };
        return score(a) - score(b);
      });
      var main = names[0];
      var mods = moduleTable(files, log, pkgName);
      var req = { type: 'compile', source: files[main], target: target,
                  abi: { exceptions: 'wasm-legacy', pthread: true, memory64: target === 'wasm64' },
                  // ★ 两个 include 根（与容器同口径）：`octinc` 解 <octave/oct.h>，
                  //   `octinc/octave` 解 <randmtzig.h> 这类扁平内部头（sample.cc 实测缺它）
                  define: ['HAVE_CONFIG_H=1'],
                  include: ['/src/octinc', '/src/octinc/octave'], flags: ['-std=c++17'],
                  // lld 两件（worker 首链时才拉；不从 init 提前取）
                  lld: { wasmUrl: 'assets/llvm/lld-wasm-only.wasm',
                         glueUrl: 'assets/llvm/lld-wasm-only.js' } };
      if (mods) { req.modules = mods; req.files = files; }
      else if (names.length > 1) log('[v1] 无 DEFUN 可识别 ⇒ 只编主 TU：' + main);
      return new Promise(function (resolve, reject) {
        w.onmessage = function (ev) {
          var m = ev.data || {};
          if (m.type === 'log') { log(m.text); return; }
          if (m.type === 'result') { w.onmessage = null; resolve(m); }
        };
        w.onerror = function (e) { reject(errCode('MODULE_NOT_READY', '编译 Worker 崩了：' + (e.message || '?'))); };
        w.postMessage(req);
      });
    }

    // ④ guessOctName(name, files)：**单模块包**的产物文件名（多模块走 r.modules[].name）。
    //    规则（build-pkg-oct.sh 的模块表口径）：主 TU 去扩展名；__bfgsmin.cc 的 DEFUN 是
    //    __bfgsmin（单下划线）—— 但那是逐包表知识；通用兜底 = 主 TU basename。
    //    ⚠️ 有 DEFUN 时**必须**用 DEFUN 名：`partint.cc` ⇒ `partcnt.oct`（实测反例）。
    function guessOctName(name, files) {
      var mods = moduleTable(files, function () {}, name);
      if (mods && mods.length === 1) return mods[0].name;
      var names = Object.keys(files).sort(function (a, b) {
        var score = function (n) { return /__/.test(n) ? 0 : (/^[^/]+\.cc$/.test(n) ? 1 : 2); };
        return score(a) - score(b);
      });
      // ⚠️ 必须取 **basename**：源清单里的相对路径是 `pkg-1.3.3/src/cell2cell.cc`
      //   ⇒ 直接去扩展名会得到带子目录的名字，写盘时嵌套目录不存在 ⇒ ErrnoError 44（实测）。
      var base = String(names[0]).split('/').pop();
      return base.replace(/\.[^.]*$/, '') + '.oct';
    }

    // ── browse/statusOf 的共享内核 ────────────────────────────────────────────
    // 条目 → Entry（判决书 §3）：三属性 + 版本候选 + 描述。**一条产地**（statusOf 的三属性
    // 判据与 browse 的 Entry 同源 —— 同一事实不允许两个出口两个答案，N6 的教训）。
    function _browseEntry (p) {
      var content = p.content || p.kinds || [];
      var fromSource = content.indexOf('src') >= 0;
      var ha = hostArchOf(null);
      var archBad = !!(p.arch && ha && p.arch !== ha);
      // 版本候选（表带 versions[] 才有；老表 ⇒ undefined，别编）
      var versions = null;
      if (p.versions && p.versions.length) {
        versions = p.versions.map(function (c) {
          var cv = { version: c.version, stage: c.stage || 'staged' };
          if (cv.stage !== 'staged') {           // withheld（schema 词表仅两值；非 staged 一律按 withheld 形状如实带 cause）
            cv.stage = 'withheld';
            cv.withheld_cause = c.withheld_cause || 'unknown';
          } else {
            if (c.form) cv.form = c.form;
            if (c.content) cv.content = c.content;
            if (c.arch) cv.arch = c.arch;
            if (c.requires) cv.requires = c.requires;
            if (c.size) cv.size = c.size;
          }
          return cv;
        });
      }
      // 状态聚合（按当前解析出的那一版 = 条目顶层标量）：
      //   installed > blocked（arch 不符）> blocked（该版 withheld）> available
      var why = [];
      var st = 'available';
      if (archBad) { st = 'blocked'; why.push('arch ' + p.arch + ' ≠ 宿主 ' + ha); }
      var topCand = versions
        ? versions.filter(function (c) { return c.version === p.version; })[0] : null;
      if (topCand && topCand.stage === 'withheld') {
        if (st !== 'blocked') st = 'blocked';
        why.push('选中版本 ' + p.version + ' 未 stage（' + (topCand.withheld_cause || '?') + '）');
      }
      var installedKey = loaded['forge:' + p.name] || loaded['layer:' + p.name] || loaded[p.name];
      if (installedKey) st = 'installed';
      if (p.requires && p.requires.length) why.push('requires: ' + p.requires.join(','));
      return {
        name: p.name,
        version: p.version,
        // 三属性（与 statusOf 同一判据 —— 见上，一条产地）
        fromSource: fromSource,
        compatible: !archBad,
        installed: !!installedKey,
        // 包级透传（内容仓 mail/029/030；缺省空值不省键 ⇒ UI 恒可渲染）
        description: p.description || '',
        links: p.links || [],
        // 版本候选集（逐候选如实：staged 带派生轴、withheld 只带 cause —— 不许编）
        versions: versions,
        state: st, why: why,
        // 派生细节（诊断用；UI 不必读）
        detail: { arch: p.arch || null, hostArch: ha || null,
                  content: content, form: p.form || null,
                  acceleration: fromSource ? 'not-built' : 'none-needed' }
      };
    }

    var API = {
      OCTAVE_M: OCTAVE_M,
      init: function (url) {
        // ★ B6：**没显式给清单时按档取**（w64 = `assets/manifest.w64.json`）。
        //   为什么必要（实测踩到）：`window.OctaveAssets` 是**全局默认实例**（A2 之前的别名，
        //   套件/工具还在用它）—— 它不知道选档，默认拉基础档清单 ⇒ 线程档会把**基础档的 `.oct`**
        //   装进 FS ⇒ dlopen 报 `failed to load Incompatible version or missing dependencies`
        //   （accept-113-assets 12/4、accept-113-oct 3/5 的现场）。这里让默认值也跟着档走。
        url = url || (global.octaveLanePlan && global.octaveLanePlan.manifest) || url;
        if (manifest) return Promise.resolve(manifest);
        return fetchJSON(url || MANIFEST_URL).then(function (m) {
          manifest = m;
          (m.assets || []).forEach(function (a) { byName[a.name] = a; });
          log('清单就绪：' + Object.keys(byName).length + ' 个资产');
          publish();                      // 账本落盘：`__webassets_available__()` 读它
          return manifest;
        });
      },
      list: function () { return Object.keys(byName); },
      describe: function (name) { return byName[name] || null; },
      isLoaded: function (name) { return !!loaded[name]; },
      // ★ **三属性状态**（2026-10-16 用户点令「一个内容应该有三个属性」）：
      //   fromSource（是否从源码构建）· compatible（是否兼容本宿主）· installed（是否已安装）。
      //   三条**各自独立**、**全部派生**（不手写、不新增目录字段）——判据如下：
      //     · fromSource：包**带 `src`**（`content`/`kinds` 含 src）⇒ 加速件是"源码"
      //       ⇒ 本构建**不编**（无 mkoctfile）⇒ 值 = true 表示"要用源码才有加速件/或有源码未编"。
      //       ⚠️ 与 `content` 同源（`m`/`src`/`oct` 是包内源的构成）——**不是**第二份真值。
      //     · compatible：**架构界**（`arch` 与宿主档一致；无 arch ⇒ 无架构概念 ⇒ 兼容）+
      //       **Octave 版本约束**（`requires`，若目录带）。不兼容 ⇒ install 会响亮拒绝。
      //     · installed：**会话态**（`loaded[name]`）—— 就是"这次会话装没装"。
      //   返回对象；查无此包 ⇒ null（不编一个"全 false"的假状态）。
      statusOf: function (name) {
        // ⚠️ 取数优先级（实测踩过）：**目录条目优先** —— 随站清单（`byName`）里的条目用
        //   `kind`（单值）而不是 `content`（多值数组），先取它会得到 `content: []`。
        //   ⚠️ 目录还没读（`_catalogByName` 空，例如刚起的实例 / 注入实例）⇒ 回退随站清单，
        //   且**该条目也在货架上时**以货架那条为准（货架才带 content/arch/requires）。
        //   两边都没有 ⇒ null（查无此内容，不编假状态）。
        var p = _catalogByName[name] || byName[name] || null;
        if (!p) return null;
        // ★ 2026-10-17 起：三属性判据与 browse() 共用 `_browseEntry` 这**一条产地**
        //   （N6 的教训：同一事实两个出口两个答案）。本方法保持同步 + 旧返回形状
        //   （老套件/UI 在用）；多出来的键（description/links/versions/state/why）是纯增量。
        return _browseEntry(p);
      },
      loaded: function () { return Object.keys(loaded); },
      // ★ `browse()` —— 市场读面的**async 正门**（NOTES-market-design §3/§5 第 5 步；
      //   内容仓 mail/028 §④ 点令上调优先级 + mail/029 请把 description/links 带出）。
      //   为什么是它而不是 statusOf：statusOf 是**同步方法但依赖异步缓存**（接口缺陷，
      //   设计判决点名）⇒ 读货架必须走 async 正门；statusOf 留作兼容视图（同步、目录已读时用）。
      //   形状 = 判决书 §3 的 Entry[]：name/version + 三属性（fromSource/compatible/installed）
      //   + versions[]（逐候选：stage/derived/withheld_cause）+ description/links（包级透传）。
      //   状态聚合（state/why）按**当前解析出的那一版**算；解析失败（全 withheld/全不符）
      //   ⇒ state='blocked' + why 说明，**不抛**（读面不因单包异常挂掉整个列表）。
      browse: function () {
        return API.catalog().then(function (cat) {
          var out = [];
          (cat.packs || []).forEach(function (p) {
            try { out.push(_browseEntry(p)); } catch (e) { /* 单包异常不挂列表 */ }
          });
          return out;
        });
      },
      // ★ 能力层查询（接缝 §5④）：`{pyodide:{ready:true,kind:'python',version,bytes}}`
      layers: function () { return layers; },
      onLoad: function (f) { listeners.push(f); },
      load: function (names) {
        var list = Array.isArray(names) ? names : [names];
        return API.init().then(function () {
          return list.reduce(function (chain, n) {
            return chain.then(function (acc) {
              return loadOne(n).then(function () { acc.push(n); return acc; },
                function (e) {
                  // T4：随站资产的**装载失败**也是终态 ⇒ 落账（与 install() 同一张表）。
                  //   不落账的后果：`.m` 侧的 `pkg load` 只能干等满轮询上限才吭声。
                  installError[n] = String(e && e.message ? e.message : e).slice(0, 400);
                  publish();
                  throw e;
                });
            });
          }, Promise.resolve([]));
        });
      },
      // 便捷：把资产交给 Octave（在主线程可用时同步调用）
      eval: function (expr) { return Msafe().eval_string(expr); },

      // ── B 线：**浏览器内自编 .oct**（设计稿 NOTES-client-compile-design §4.2/§4.3）────
      //   接口 = 一个方法（深模块判据：删掉它 ⇒ 每个调用点都要自己拼工具链/头/sysroot 档/
      //   编译门槛/落盘 ⇒ 复杂度在 N 处复现）。返回 Verdict；diagnostics = 编译日志流
      //   （§4.2 + 内容仓 mail/037 裁决④：现编、产物只进 MEMFS、不写 OPFS、不产生下载记录）。
      //   内部四缝（§4.3，不暴露给调用方，只给测试注入）：toolchain()/headers()/
      //   pickSysroot()/compileAndLand()。
      compileExtension: function (name, opts) {
        opts = opts || {};
        var onProgress = opts.onProgress || function () {};
        var diags = [];                       // diagnostics：编译日志流（UI 终端/诊断抽屉消费）
        var pushDiag = function (text) {
          diags.push(String(text));
          if (opts.onDiagnostic) { try { opts.onDiagnostic(String(text)); } catch (e) {} }
        };
        // 幂等：同包编过（本会话）⇒ 直接回缓存（§4.2 "同 pin 键直接返回"的会话内形态）
        if (_compiled[name]) {
          // ★ 缓存返回**与首次返回同形**（octs/bytes/symbolGap 都要带上）：
          //   第一版只回 octPath ⇒ 第二次调用的调用方看到 `octs: undefined`，
          //   "同一事实两个出口两个答案"（N6 教训）。实测：多 TU 套件第二次拿到空数组。
          var c0 = _compiled[name];
          return Promise.resolve({ state: 'compiled', name: name, cached: true,
                                   diagnostics: c0.diagnostics,
                                   octPath: c0.octPath, octs: c0.octs || null,
                                   bytes: c0.bytes, symbolGap: c0.symbolGap || null });
        }
        // ★ 模块表与 catalog 都是"按包取知识"，一起预取（缺表不阻断 ⇒ DEFUN 兜底）
        return Promise.all([API.catalog(), loadModuleTables()]).then(function (both) {
          var cat = both[0];
          // ── 判 kinds：包必须带 src（B 的对象是 src/*.cc；纯 .m 包 ⇒ m-only 软失败，明说）
          var p = _catalogByName[name];
          if (!p) throw errCode('NOT_IN_ANY_LIST', '货架上没有包：' + name);
          var content = p.content || p.kinds || [];
          var srcTar = p.url;
          if (content.indexOf('src') < 0) {
            return { state: 'm-only', name: name,
                     why: '包不含 src（content=' + JSON.stringify(content) + '）⇒ 无可编译件；.m 部分用 install()',
                     diagnostics: diags };
          }
          // ── 宿主档 ⇒ 目标档（楚河汉界同判据：w64* ⇒ wasm64，其余 ⇒ wasm32）
          var hostArch = hostArchOf(opts);
          var target = (hostArch === 'wasm64') ? 'wasm64' : 'wasm32';
          pushDiag('[compile] ' + name + ' → ' + target + '（宿主 ' + (hostArch || '?') + ' 档）');
          // ── 取源码 tarball（货架字节，sha 核过）+ 展开成 files 映射
          // ── 前置：forge m 助手（__forge_src_list__ 在那个 bundle；与 install() 同款前置）
          return API.load(['webio', 'webshell', 'webfile', 'forge']).catch(function () { return null; })
          .then(function () {
          onProgress({ phase: 'src', name: name });
          return fetchBinary(srcTar).then(function (buf) {
            return sha256Hex(buf).then(function (hex) {
              if (p.sha256 && hex && hex !== p.sha256) {
                throw errCode('SHA_MISMATCH', '源码包校验失败 ' + name + '（期望 ' + p.sha256.slice(0, 12) + '… 实得 ' + hex.slice(0, 12) + '…）');
              }
              // 解包：委托引擎内建 gunzip+untar（零 JS tar 解析器，与 install() 同款）。
              //   展到 /tmp/compile-src/<name>/，再从 FS 读出 src/*.cc + config.h。
              var M = Msafe();
              if (!M || !M.eval_string) throw errCode('ENGINE_NOT_READY', '引擎还没就绪，不能取源');
              var workdir = '/tmp/compile-src/' + name;
              var tarPath = workdir + '.tar.gz';
              try { M.FS.mkdirTree('/tmp/compile-src'); } catch (e) {}
              M.FS.writeFile(tarPath, new Uint8Array(buf));
              var rc = M.eval_string("__forge_src_list__('" + tarPath + "', '" + workdir + "')");
              if (rc !== 0) throw errCode('UNPACK_FAILED', '源码解包失败（rc=' + rc + '）：' + (M.last_error_message() || ''));
              // 读回文件清单（__forge_src_list__ 写 workdir/../.filelist）
              var listRaw = '';
              try { listRaw = M.FS.readFile(workdir + '.files', { encoding: 'utf8' }); } catch (e) {}
              var srcFiles = {};
              (listRaw || '').split('\n').forEach(function (rel) {
                rel = rel.trim();
                if (!rel || !/\.cc$|\.cpp$|\.c$|\.h$/.test(rel)) return;
                try { srcFiles[rel] = M.FS.readFile(workdir + '/' + rel, { encoding: 'utf8' }); } catch (e) {}
              });
              if (!Object.keys(srcFiles).length) {
                return { state: 'm-only', name: name,
                         why: 'tarball 里没有可编译源（.cc/.cpp/.c）', diagnostics: diags };
              }
              pushDiag('[src] ' + Object.keys(srcFiles).length + ' 个源文件');
              // ── 取 Octave 头 + 合成 config.h（25 宏 = build-pkg-oct.sh emit_config_h 的产物，
              //    客户端复现的核心知识 ⇒ 数据跟 catalog 走，不硬编码 —— §10 判据 2）
              onProgress({ phase: 'headers', name: name });
              // 头由 worker 直接装进 clang FS（见 compile-worker.mjs 的 octincTarUrl 段）；
              // 这里只报"配置宏就绪"，不再在页面 FS 里解一遍（旧缝 headersInto 已成死代码，保留函数但不调用）。
              return Promise.resolve(cfgReady()).then(function (nMacro) {
                pushDiag('[headers] worker 侧安装（Octave 头 + config.h ' + nMacro + ' 宏）');
                // ── 起 Worker 跑编译（重活离主线程；§7.3）
                onProgress({ phase: 'toolchain', name: name });
                return toolchainWorker(target, pushDiag).then(function (worker) {
                  onProgress({ phase: 'compile', name: name });
                  return workerCompile(worker, srcFiles, target, pushDiag, name).then(function (r) {
                    if (!r.ok) {
                      // 编失败 ⇒ m-only 软失败 + 明说哪一件没成（§6.3 反向：不许静默当成功）
                      return { state: 'm-only', name: name, stage: r.error ? 'compile' : 'link',
                               why: String(r.error || 'unknown') +
                                    (r.detail ? '\n' + r.detail.join('\n') : ''),
                               diagnostics: diags };
                    }
                    // ── 落盘 + addpath + 同步 pkg 库（compileAndLand；§4.2）
                    //    ★ v2：多模块时**逐个写**（r.modules 里每个 ok 的模块各一个 .oct）；
                    //    单模块包与 v1 完全等价（r.moduleBytes + guessOctName 的 DEFUN 优先规则）。
                    var built = (r.modules || []).filter(function (m) { return m.ok; });
                    var toLand = built.length
                      ? built.map(function (m) { return { name: m.name, bytes: m.moduleBytes }; })
                      : [{ name: guessOctName(name, srcFiles), bytes: r.moduleBytes }];
                    pushDiag('[land] 编译成功 ' + toLand.length + ' 个模块（'
                             + toLand.map(function (t) { return t.name + ' ' + t.bytes.length + 'B'; }).join(', ')
                             + '），开始落盘');
                    var landDir = OCTAVE_M + '/forge/' + name + '/oct-' + target;
                    // ★ 门槛 2（设计稿 §10 实测）：嵌套路径必须**逐级建父目录**，否则
                    //   writeFile 报 `ErrnoError errno=44`。旧代码把 mkdirTree 的失败吞进
                    //   空 catch 里 ⇒ 真正的错在 writeFile 才炸（且信息是数字）。现在 fail-loud。
                    try { M.FS.mkdirTree(landDir); } catch (e) {
                      throw errCode('UNPACK_FAILED', '建不了落盘目录 ' + landDir + '：' + (e && e.message));
                    }
                    var landed = [];
                    toLand.forEach(function (t) {
                      var rel = landDir + '/' + t.name;
                      try {
                        M.FS.writeFile(rel, new Uint8Array(t.bytes));
                        landed.push({ name: t.name, path: rel, bytes: t.bytes.length });
                        pushDiag('[land] 写盘 OK → ' + rel);
                      } catch (e) {
                        throw errCode('UNPACK_FAILED', '写 .oct 失败（' + rel + '）：'
                                      + (e && (e.message || e.name) || e));
                      }
                    });
                    addPaths([landDir]);
                    pushDiag('[land] addpath OK');
                    try {
                      M.eval_string("if (exist('__pkgfix_sync_db__') == 2) try; __pkgfix_sync_db__ (); catch; end; end");
                    } catch (e) {}
                    var _totalBytes = toLand.reduce(function (a, t) { return a + t.bytes.length; }, 0);
                    _compiled[name] = { octPath: landed[0].path, octs: landed, bytes: _totalBytes,
                                        symbolGap: r.gap || null, diagnostics: diags.slice() };
                    onProgress({ phase: 'done', name: name });
                    return { state: 'compiled', name: name,
                             octPath: landed[0].path,
                             octs: landed,
                             bytes: toLand.reduce(function (a, t) { return a + t.bytes.length; }, 0),
                             symbolGap: r.gap || null,
                             diagnostics: diags };
                  });
                });
              });
            });
          });
        });
          }).catch(function (e) {   // ← forge preload 那层 .then 的 catch（整链兜底）
          // ★ 抛出物可能是**非 Error 对象**（实测：err:"undefined"、thrown:"[object Object]"）——
          //   序列化出来，别让调用方只看到 undefined。设计稿 §6.3：失败要明说哪一件没成。
          var detail;
          try { detail = (e && e.message) ? (e.message + '\n' + (e.stack || '')) : JSON.stringify(e); }
          catch (x) { detail = String(e); }
          // 打点：最近一条 diags 是哪阶段（errno=44 之类无栈错误靠这个定位）
          var _last = diags.length ? diags[diags.length - 1] : '(none)';
          var err = errCode((e && e.code) || 'COMPILE_FAILED',
                            '编译失败：' + String(detail).slice(0, 300)
                            + ' ｜ 最后阶段：' + String(_last).slice(0, 120));
          err.__verdict__ = { state: 'failed', name: name, cause: (e && e.code) || 'compile-failed',
                              why: String(detail).slice(0, 400), retriable: false };
          err.diagnostics = diags;
          throw err;
        });
      },

      // ── Forge **按需拉取**（设计稿 build/113/NOTES-forge-ondemand.md §3）──────────
      // 「货架」= 站点上的 `assets/forge-catalog.json`（构建期由 build/forge-catalog.py
      // 从货架仓 `shelf/` 生成；版本按 **fork 的 Octave 版本**过滤、字节 sha 逐条核过）。
      // 客户端**读它但不下载任何包字节** —— 谁 install 谁才拉。
      // ★ **测试注入面**（2026-10-16，架构界套件要它）：让测试**在不碰站点**的前提下
      //   把一份合成目录喂进来（`accept-arch-boundary` 的 A3/A4 靠它验"arch 不符 ⇒ 响亮拒绝"）。
      //   为什么是公开方法而不是"内部钩子"：判据做在客户端，而客户端的输入就是目录 ⇒
      //   "能换目录来源"是这个模块**本就该有的缝**（accept-install-verdict 的 V3/V4 也只差它）。
      //   ⚠️ 只影响**本实例**（与 manifest/loaded 同款：全部状态收进工厂闭包）。
      __catalogSource: function (src) { _catalogSourceOverride = src || null; },
      catalog: function () {
        if (_catalog) return Promise.resolve(_catalog);
        if (_catalogP) return _catalogP;
        if (typeof _catalogSourceOverride === 'function') {
          // 注入路径：本源直接给一份目录对象（不 fetch）——同样走"填缓存 + 记账"两步，
          // 这样注入目录与真目录在**后续所有判据**上同权（不是旁路）。
          _catalogP = Promise.resolve()
            .then(function () { return _catalogSourceOverride(); })
            .then(function (c) {
              _catalog = c || { packs: [] };
              var byName3 = {};
              (_catalog.packs || []).forEach(function (p) { byName3[p.name] = p; });
              _catalogByName = byName3;
              catalogState = 'ok';
              publish();
              return _catalog;
            });
          return _catalogP;
        }
        // ⚠️ 传**裸路径**（fetchJSON 内部会 withBase）—— 曾经这里又 withBase 一次，
        //    base 为空时无害、非空时双拼（`/base//base/assets/…` ⇒ 404）。
        //    由 accept-install-verdict 的 V3（同源子路径 base）首次暴露。
        _catalogP = fetchJSON('assets/forge-catalog.json').then(function (c) {
          _catalog = c || { packs: [] };
          var byName2 = {};
          (_catalog.packs || []).forEach(function (p) { byName2[p.name] = p; });
          _catalogByName = byName2;
          catalogState = 'ok';
          publish();                              // 货架可读这件事本身也要进账本（T4）
          return _catalog;
        }, function (e) {
          _catalogP = null;                       // 失败不缓存（下次可重试）
          catalogState = 'fail';
          publish();                              // 读不到 ≠ 货架没这个包（两态必须可分辨）
          throw errCode('CATALOG_UNREADABLE', '读不到 Forge 货架（assets/forge-catalog.json）：' + e.message);
        });
        return _catalogP;
      },

      // install(name) —— 依赖闭包 → 逐个 fetch+sha 校验 → **委托引擎 gunzip+untar 解包**
      //   → 按 `pkg install` 的真实布局落盘（inst/ 上提 + PKG_ADD + 元数据）→ addpath。
      // ⚠️ 为什么不在 JS 里解 tar：引擎（wasm 内）已有真的 gunzip/untar（webio.cc，zlib+ustar），
      //    `pkg install` 内部调的就是它们 —— 实测解真 tarball 211 文件。JS 侧零解析器。
      // ⚠️ 为什么不调核心 `pkg install`：本构建下它坏（`dirlist(3): out of bound 2`，T0 spike
      //    实测）⇒ 由本函数**直写**（正是布局复现那条路；对拍断见验收套件）。
      // ⚠️ 只支持 kinds 里没有 'oct' 的包（纯 .m）：含预编译 .oct 的包要宿主预编 ⇒ v2。
      //     ★ 2026-10-16 起：**含 .oct 的条目进目录时带 `arch`**，且这里会先判它与宿主档是否
      //     一致（不一致 ⇒ 立即响亮拒绝，cause='arch-mismatch'）。判据见下面的 hostArch()。
      install: function (name, opts) {
        opts = opts || {};
        var onProgress = opts.onProgress || function () {};
        installSeen = installSeen || {};
        // ★ 架构界（裁决 2026-10-16 用户点令「楚河汉界」）：「要 dlopen 进宿主的东西」必须与
        //   宿主**同架构**，否则立即响亮拒绝（早失败优于"装上了跑不了" —— 与
        //   symbolic→pyodide 的硬依赖同款裁决）。只在两边都有值时才判（老站点/老宿主不拦）。
        var hostArch = hostArchOf(opts);      // ← 单一产地（闭包级函数，statusOf 也用它）
        var chain = API.catalog().then(function (cat) {
          var plan = [], seen = {};
          (function walk (n) {
            if (seen[n]) return;
            seen[n] = true;
            var p = _catalogByName[n];
            if (!p) {
              // T4：货架**读成功**而查无此包 ⇒ 记进账本（这是**终态**：再等也不会出现）。
              catalogMiss[n] = 1;
              publish();
              throw errCode('NOT_IN_ANY_LIST', '货架上没有包：' + n);
            }
            (p.deps || []).forEach(walk);
            plan.push(p);
          })(name);
          onProgress({ phase: 'plan', plan: plan.map(function (p) { return p.name; }) });
          // ★ 架构检查（含在闭包里，覆盖 deps 闭包里的每一条 —— 能力层条目不带 arch ⇒ 自然豁免）
          if (hostArch) {
            for (var _pi = 0; _pi < plan.length; _pi++) {
              var _pa = plan[_pi].arch;
              if (_pa && _pa !== hostArch) {
                var _m = '架构不匹配：' + plan[_pi].name + ' 需要 ' + _pa
                       + '，当前宿主是 ' + hostArch + ' 档（它带要在宿主里 dlopen 的 .oct，必须同架构）';
                var _err = errCode('ARCH_MISMATCH', _m);
                _err.__verdict__ = { state: 'failed', name: plan[_pi].name,
                                     cause: 'arch-mismatch', why: _m, retriable: false };
                throw _err;
              }
            }
          }
          // ★ planOnly（©5 第③步）：**只算账不下载**（UI 预演"要拉多少"）。零网络字节。
          //   判据：page.on('response') 在该调用期间**没有任何**对 assets/pkg|assets/forge 的响应。
          if (opts.planOnly) {
            var layers = plan.filter(function (p) { return p.form === 'tree'; })
                             .map(function (p) { return { name: p.name, form: p.form, bytes: p.size }; });
            var done = { state: 'ok', name: name, planOnly: true,
                     installed: [], layers: layers,
                     bytes: plan.reduce(function (a, p) { return a + (p.size || 0); }, 0) };
            onProgress({ phase: 'done', plan: plan.map(function (p) { return p.name; }), planOnly: true });
            return done;
          }
          // Forge 的 .m 包只依赖引擎内建的 gunzip/untar ⇒ 先确保它们在
          // 先确保四样在（缺一不可，全部是**既有资产**，不新增机制）：
          //   webio    —— 引擎内建 gunzip/untar（zlib/ustar，解包用）
          //   webshell —— untar.m / gunzip.m 等 m 入口（把内建接上官方名字）
          //   webfile  —— **无 shell 的 copyfile/movefile**（核心 copyfile 在本构建里会去
          //                fork `cp -r`，无 shell ⇒ 必失败；这是本批实测踩到的坑）
          //   forge    —— 安装助手 __forge_install__.m（本仓 build/forge/）
          return API.load(['webio', 'webshell', 'webfile', 'forge']).catch(function () { return null; })
            .then(function () { return plan.reduce(function (chain, p) {
              return chain.then(function (acc) {
                var key = (p.form === 'tree' ? 'layer:' : 'forge:') + p.name;
                if (loaded[key]) { acc.push(p.name); return acc; }
                // ★ 能力层（form:"tree"，接缝 §5④）：**不是包** ⇒ 不走 __forge_install__ 布局，
                //   而是把运行时**挂进页面**（Pyodide 起实例），并记一个可用标记供 `.m` 侧查询。
                //   为什么不做"解包到 FS"：Pyodide 是个**宿主侧运行时**（要 fetch 自己的
                //   .wasm/.whl、要跨 worker），它的生命周期属于页面，不属于 Octave 的 MEMFS。
                if (p.form === 'tree') {
                  onProgress({ phase: 'layer', name: p.name, size: p.size });
                  return installLayer(p).then(function (info) {
                    loaded[key] = info;
                    delete installError[p.name];
                    onProgress({ phase: 'installed', name: p.name, layer: true });
                    publish();
                    acc.push(p.name);
                    return acc;
                  });
                }
                onProgress({ phase: 'fetch', name: p.name, size: p.size });
                return fetchBinary(p.url).then(function (buf) {
                  return sha256Hex(buf).then(function (hex) {
                    if (p.sha256 && hex && hex !== p.sha256) {
                      throw errCode('SHA_MISMATCH', '包校验失败 ' + p.name + '（期望 ' + p.sha256.slice(0, 12)
                                      + '… 实得 ' + hex.slice(0, 12) + '…）—— 拒绝安装');
                    }
                    var tar = '/tmp/forge-' + p.name + '-' + p.version + '.tar.gz';
                    fs().writeFile(tar, new Uint8Array(buf));
                    onProgress({ phase: 'unpack', name: p.name });
                    // 解包 + 按 `pkg install` 布局落盘：**引擎侧 m 助手**（build/forge/__forge_install__.m）
                    //   —— 它内部调引擎内建 gunzip+untar（zlib/ustar，不写 JS tar 解析器），
                    //      再把 inst/ 上提 + 元数据落包根 + 拒绝异架构 .oct（设计稿 §3/§4）。
                    var M = Msafe();
                    if (!M || !M.eval_string) throw errCode('ENGINE_NOT_READY', '引擎还没就绪，不能安装包');
                    var pkgdir = '/usr/src/octave/m/forge/' + p.name;
                    var rc = M.eval_string(
                      "n = __forge_install__ ('" + tar + "', '" + p.name + "', '/usr/src/octave/m/forge');");
                    if (rc !== 0) throw errCode('UNPACK_FAILED', '__forge_install__ 失败（rc=' + rc + '）：'
                                                  + (M.last_error_message() || ''));
                    addPaths([pkgdir]);
                    // 让核心 pkg 数据库重扫（否则 `pkg list` 看不见新包 —— pkgfix 的既有机制）
                    try {
                      M.eval_string("if (exist('__pkgfix_sync_db__')) try; __pkgfix_sync_db__ (); catch; end; end");
                    } catch (e) { /* 数据库重扫失败不致命：包已经装上了 */ }
                    loaded[key] = { files: 0, addpath: [pkgdir], forge: p };
                    delete installError[p.name];   // T4：成功就要**清掉**旧失败（否则重试成功仍报错）
                    onProgress({ phase: 'installed', name: p.name });
                    publish();
                    acc.push(p.name);
                    return acc;
                  });
                });
              });
            }, Promise.resolve([])); })
            .then(function (names) {
              onProgress({ phase: 'done', installed: names });
              // ★ Verdict（©5 第③步）：四态返回值是**值**，不是布尔。
              //   旧字段 `name`/`installed` **逐一保留**（老套件/老代码在用）；
              //   新键 = `state`（四态之一）+ `layers`（要拉的能力层）+ `bytes`。
              // ★ N6 修复（2026-10-16，工单 68 / design-it-twice 的 ④ 方案发现）：
              //   此前三字段是**字面量**（layers:[] / bytes:0 / acceleration:'not-built'）⇒
              //   装 symbolic（闭包含 22 MB 的 Pyodide）也报 bytes:0；而 statusOf(:504) 与
              //   planOnly(:630) 对同一事实**真算** —— 同一条事实两个出口两个答案。
              //   ⇒ 复用 planOnly 的同一算法（闭包里的 plan 与真下载的字节一致）。
              var _fetchedLayers = plan.filter(function (p) { return p.form === 'tree'; })
                                       .map(function (p) { return { name: p.name, form: p.form, bytes: p.size }; });
              var _fetchedBytes = plan.reduce(function (a, p) { return a + (p.size || 0); }, 0);
              // acceleration 与 statusOf 走**同一个判据**（content 含 src ⇒ not-built，否则 none-needed）
              var _entry = _catalogByName[name];
              var _content = (_entry && (_entry.content || _entry.kinds)) || [];
              var _accel = (_content.indexOf('src') >= 0) ? 'not-built' : 'none-needed';
              return { state: 'ok', name: name, installed: names,
                       layers: _fetchedLayers, bytes: _fetchedBytes,
                       acceleration: _accel };
            });
        });
        // T4：**整条链**的失败都要落账（含"货架读不到"这种在 catalog() 就炸掉的路径）——
        //   `.m` 侧等的是终态；只挂在后半段的话，网络错误会让它干等满 60 秒轮询上限。
        // ★ 返回 Verdict（四态），并**同时保留旧语义**：reject 的 Error 仍按旧样（消息）抛，
        //   但在其 `.verdict` 上带 {state,cause,why,retriable}（对我不想 catch 重做判断的调用方）。
        return chain.then(null, function (e) {
          var msg = String(e && e.message ? e.message : e).slice(0, 400);
          installError[name] = msg;
          publish();
          var st = 'failed', why = msg, cause = 'unknown';
          // ★ 分类读 e.code（UI mail/028 Q1，2026-10-17）：正则匹配中文消息是脆弱契约
          //   （消息改一个字分类就错）；code 是 throw 时钉死的。映射表与既有 cause 词表逐字同值
          //   —— 旧消费者（.m 侧 pkg.m 按消息前缀分流）照读 message，不受影响。
          //   ★ 2026-10-17 补全（内容仓 mail/030 §Q1 点名）：原表只收 7 码，其余 7 码若从
          //   install 链冒出（install 会先 API.load 基础资产 ⇒ load 路径的错也能传到这里）
          //   会静默落 `cause:'unknown'`。⇒ 全 14 码进表 —— **每个 errCode 都有分类**
          //   （"err.code 渲染文案 + __verdict__.cause 分类"两者不再不同源）。
          //   状态映射口径：取字失败类 = failed（可重试的 fetch 失败，UI 可提示重试；
          //   cannot-know 只保留给"连目录都读不到"——那是唯一真正"无从判断"的态）。
          var _byCode = { ARCH_MISMATCH:        ['failed',      'arch-mismatch'],
                          NOT_IN_ANY_LIST:      ['not-found',   'not-in-any-list'],
                          CATALOG_UNREADABLE:   ['cannot-know', 'catalog-unreadable'],
                          SHA_MISMATCH:         ['failed',      'sha-mismatch'],
                          ENGINE_NOT_READY:     ['failed',      'engine-not-ready'],
                          FS_NOT_READY:         ['failed',      'fs-not-ready'],
                          UNPACK_FAILED:        ['failed',      'unpack-failed'],
                          MODULE_NOT_READY:     ['failed',      'module-not-ready'],
                          ASSET_FETCH_FAILED:   ['failed',      'asset-fetch-failed'],
                          MANIFEST_FETCH_FAILED:['failed',      'manifest-fetch-failed'],
                          LAYER_UNREACHABLE:    ['failed',      'layer-unreachable'],
                          ASSET_NO_MOUNT:       ['failed',      'asset-no-mount'],
                          JS_BUNDLE_NO_META:    ['failed',      'js-bundle-no-meta'],
                          UNKNOWN_ASSET_KIND:   ['failed',      'unknown-asset-kind'] };
          if (e && e.code && _byCode[e.code]) { st = _byCode[e.code][0]; cause = _byCode[e.code][1]; }
          else if (/^架构不匹配：/.test(msg))          { st = 'failed';      cause = 'arch-mismatch'; }
          else if (/^货架上没有包：/.test(msg))         { st = 'not-found';   cause = 'not-in-any-list'; }
          else if (/^读不到 Forge 货架/.test(msg))     { st = 'cannot-know'; cause = 'catalog-unreadable'; }
          else if (/包校验失败/.test(msg))            { st = 'failed';      cause = 'sha-mismatch'; }
          else if (/引擎还没就绪/.test(msg))          { st = 'failed';      cause = 'engine-not-ready'; }
          else if (/__forge_install__ 失败/.test(msg)) { st = 'failed';     cause = 'unpack-failed'; }
          e.__verdict__ = { state: st, name: name, cause: cause, why: why,
                            retriable: st === 'cannot-know' };
          throw e;
        });
      }
    };
    return API;
  }

  global.createOctaveAssets = createOctaveAssets;
  // 默认实例别名：module=null ⇒ 惰性绑 global.Module（与旧版行为逐字节一致）
  global.OctaveAssets = createOctaveAssets(null, '', function () { return global.__octaveReady === true; });
})(typeof window !== 'undefined' ? window : globalThis);
