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
            var dirs = a.addpath ? [a.addpath] : [mount.replace(/\/[^/]*$/, '')];
            addPaths(dirs);
            loaded[name] = { files: 1, addpath: dirs };
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
          loaded[name] = { files: n, addpath: bundle.addpath || [] };
          log(name + ' 就绪（' + n + ' 个文件）');
          return loaded[name];
        });
      }
      throw new Error('未知资产类型: ' + a.kind);
    });

    inflight[name] = p.then(function (r) {
      delete inflight[name];
      listeners.forEach(function (f) { try { f(name, r); } catch (e) {} });
      return r;
    }, function (e) {
      delete inflight[name];
      if (global.console) console.error('[assets] ' + name + ' 失败: ' + e.message);
      throw e;
    });
    return inflight[name];
  }

  var API = {
    OCTAVE_M: OCTAVE_M,
    init: function (url) {
      if (manifest) return Promise.resolve(manifest);
      return fetchJSON(url || MANIFEST_URL).then(function (m) {
        manifest = m;
        (m.assets || []).forEach(function (a) { byName[a.name] = a; });
        log('清单就绪：' + Object.keys(byName).length + ' 个资产');
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
