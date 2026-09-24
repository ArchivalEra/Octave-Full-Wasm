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

(function (global) {
  'use strict';

  var MANIFEST_URL = 'assets/manifest.json';
  var OCTAVE_M = '/usr/src/octave/m';

  var manifest = null;
  var byName = {};
  var loaded = {};       // name -> {files: n, addpath: [...]}
  var inflight = {};     // name -> Promise
  var listeners = [];

  function log(msg) { if (global.console) console.log('[assets] ' + msg); }

  function fs() {
    var M = global.Module;
    if (!M || !M.FS) throw new Error('Module.FS 尚未就绪（Octave 还没起来？）');
    return M.FS;
  }

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
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('取资产失败 ' + url + ' → HTTP ' + r.status);
      return r.arrayBuffer();
    });
  }

  function fetchJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('取清单失败 ' + url + ' → HTTP ' + r.status);
      return r.json();
    });
  }

  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      var s = global.document.createElement('script');
      s.src = url;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('加载 JS 包失败 ' + url)); };
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
    var M = global.Module;
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

  function addPaths(dirs) {
    var M = global.Module;
    if (!dirs || !dirs.length || !M || !M.eval_string) return;
    var expr = dirs.map(function (d) {
      return 'addpath("' + d.replace(/"/g, '\\"') + '");';
    }).join('');
    M.eval_string(expr);
  }

  function evalSafe(expr) {
    var M = global.Module;
    if (M && M.eval_string) { try { M.eval_string(expr); } catch (e) {} }
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
              throw new Error('资产校验失败 ' + name + '（期望 ' + a.sha256.slice(0, 12) + '… 实得 ' + hex.slice(0, 12) + '…）');
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
        var base = a.base_url || a.url;
        return Promise.all((a.files || []).map(function (f) {
          return fetchBinary(base + '/' + f).then(function (buf) {
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
              throw new Error('资产校验失败 ' + name + '（期望 ' + a.sha256.slice(0, 12) + '… 实得 ' + hex.slice(0, 12) + '…）');
            }
            var mount = a.mount;
            if (!mount) throw new Error('资产 ' + name + ' 缺少 mount 路径');
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
          if (!bundle) throw new Error('JS 包 ' + a.url + ' 没声明 __OCT_ASSETS__["' + name + '"]');
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
      throw new Error('未知资产类型: ' + a.kind);
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
      var M = global.Module;
      if (isPkg && global.__octaveReady === true && M && M.eval_string) {
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
      var fs = (global.Module && global.Module.FS) || null;
      if (!fs || !fs.writeFile) return;
      // Forge 包（`assets/pkg/<名字>.js`）单独分出来：`pkg list` 只关心"包"，
      // 不该把 `plotbridge`/`doc-cache` 这类**基础设施资产**当成可选包列给用户看。
      function pkgs (names) {
        return names.filter(function (n) {
          var a = byName[n];
          return !!(a && typeof a.url === 'string' && a.url.indexOf('assets/pkg/') === 0);
        });
      }
      var av = Object.keys(byName), ld = Object.keys(loaded);
      fs.writeFile('/tmp/webassets.json', JSON.stringify({
        available: av, loaded: ld,
        pkg_available: pkgs(av), pkg_loaded: pkgs(ld),
        stamp: Date.now()
      }));
    } catch (e) { /* 记账失败不影响任何东西 */ }
  }

  var API = {
    OCTAVE_M: OCTAVE_M,
    init: function (url) {
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
    loaded: function () { return Object.keys(loaded); },
    onLoad: function (f) { listeners.push(f); },
    load: function (names) {
      var list = Array.isArray(names) ? names : [names];
      return API.init().then(function () {
        return list.reduce(function (chain, n) {
          return chain.then(function (acc) { return loadOne(n).then(function () { acc.push(n); return acc; }); });
        }, Promise.resolve([]));
      });
    },
    // 便捷：把资产交给 Octave（在主线程可用时同步调用）
    eval: function (expr) { return global.Module.eval_string(expr); }
  };

  global.OctaveAssets = API;
})(typeof window !== 'undefined' ? window : globalThis);
