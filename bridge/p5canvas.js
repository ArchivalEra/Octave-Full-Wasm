// P5 页面侧：把 toolkit 渲出的图贴到页面上
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 这一侧**刻意很薄**：真正的活（GL 渲进 WebGL2 上下文、`glReadPixels`、编码 PNG）都在
// toolkit 里（`build/113/webgl_toolkit.cc`，编在主 wasm 内）。这里只做两件事：
//
//   1. `OctaveP5.show(path)` —— toolkit 每次 `redraw_figure` 之后会调它（通过
//      `emscripten_run_script`，因为 **`EM_ASM` 在 side module 里不可用**，
//      见 HANDOFF §4.13）。我们从 MEMFS 读那个 PNG，做成 blob URL 贴进 `<img>`。
//      用 `<img>` 而不是 canvas：不用手工处理像素格式/DPI，浏览器自己缩放，
//      且这条路径与"print -dpng 出的是同一个文件"完全一致。
//   2. `OctaveP5.useWebGL()` / `useWeb()` —— 切换 toolkit。
//      **默认已经是 `webgl`**（2026-09-23 用户拍板的 "A"：装 `webgraphics` 资产时由
//      `build/webgraphics/PKG_ADD` 选定），所以开箱 `plot(...); drawnow` 就出真图；
//      这里两个函数是给"显式切换"和验收用的。
//
// 为什么不做实时交互画布：本构建**没有 Asyncify**，Octave 一执行就把页面线程占住，
// 事件循环期间不跑（HANDOFF §5.10 实测）。所以"图 → 页面"只能是单向的、命令式的：
// 命令跑完 → toolkit 写 PNG → 我们贴出来。

(function () {
  const CONTAINER_ID = 'p5figure';
  const last = { path: null, bytes: 0, error: null, count: 0 };

  function container() {
    let el = document.getElementById(CONTAINER_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = CONTAINER_ID;
      el.style.cssText = 'margin:4px 0;padding:4px;border-top:1px solid #ccc';
      const pre = document.getElementById('output');
      if (pre && pre.parentNode) pre.parentNode.insertBefore(el, pre.nextSibling);
      else document.body.appendChild(el);
    }
    return el;
  }

  function readBytes(path) {
    const M = window.Module;
    if (!M || !M.FS) throw new Error('OctaveP5: Module.FS 尚未就绪');
    return M.FS.readFile(path);   // Uint8Array
  }

  // toolkit 侧调用入口（`emscripten_run_script` 传过来的只是一个路径）
  function show(path) {
    try {
      const raw = readBytes(path);
      last.path = path;
      last.bytes = raw.byteLength;

      // ★ 按扩展名定 MIME：toolkit 发的是 PNG，而**无 GL 设备的回落**发的是 SVG
      //   （`/tmp/p5_fallback.svg`，由 `build/plotbridge/__pb_publish__.m` 写）。
      //   以前这里写死 'image/png' —— 那种情况下浏览器不会把 SVG 当图渲染。
      const isSvg = /\.svgz?$/i.test(path);
      last.type = isSvg ? 'image/svg+xml' : 'image/png';
      const blob = new Blob([raw], { type: last.type });
      const url = URL.createObjectURL(blob);

      const el = container();
      let img = el.querySelector('img');
      if (!img) {
        img = document.createElement('img');
        img.alt = 'Octave figure';
        img.style.cssText = 'max-width:100%;border:1px solid #ddd;background:#fff';
        el.appendChild(img);
      }
      if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
      img.dataset.url = url;
      img.src = url;
      last.count++;
      window.__p5_last = Object.assign({}, last);
      return true;
    } catch (e) {
      last.error = String(e && e.message || e);
      window.__p5_last = Object.assign({}, last);
      try { console.warn('OctaveP5.show failed: ' + last.error); } catch (e2) {}
      return false;
    }
  }

  // ── 无 GL 设备的显示回落（2026-09-23 胶水层审计候选 1）─────────────────────
  // 页面这一侧是**采样者**，两个信号任一变化就渲最新那一张：
  //   ① `/tmp/pb_rev.txt` —— `__pstate__` 每次状态变更写的修订号（只在**没有真渲染器**
  //      时写）。这一路覆盖"没有带 GL 的 wasm"与"GL 设备上下文建不出来"两种情形；
  //   ② `/tmp/p5_nogl.txt` —— toolkit 建不出 WebGL2 上下文时落的信号
  //      （`build/113/webgl_toolkit.cc` 的 P5_NOGL_PATH）。这一路专门补**第一条命令**：
  //      上下文是第一次 redraw 时才建的，那条命令写修订号时"有没有 GL"还没暴露。
  // 为什么由页面驱动而不是桥逐次推送：渲一张 SVG 实测 30–440 ms，跟着每个绘图命令推
  // 一次太贵；采样（250 ms）+ 只渲最新一张，代价与命令数无关。
  // 这块与仓库里其它宿主桥同一条路子：`.m` 写文件、页面轮询 —— 没有别的通道可用。
  const NOGL = '/tmp/p5_nogl.txt';
  const REV = '/tmp/pb_rev.txt';
  const FALLBACK = '/tmp/p5_fallback.svg';
  let sawNoGl = false;
  let lastRev = null;
  let lastSvg = null;
  function readText(fs, path) {
    try { return new TextDecoder().decode(fs.readFile(path)); } catch (e) { return null; }
  }
  function pollFallback() {
    const M = window.Module;
    const fs = M && M.FS;
    if (!fs || !fs.readFile) return;
    const nogl = readText(fs, NOGL) !== null;
    const rev = readText(fs, REV);
    const appeared = nogl && !sawNoGl;
    sawNoGl = nogl;
    if (!appeared && (rev === null || rev === lastRev)) return;   // 没有任何变化
    lastRev = rev;
    try { M.eval_string('__pb_publish__();'); } catch (e) { return; }
    const txt = readText(fs, FALLBACK);
    if (!txt || txt === lastSvg) return;
    lastSvg = txt;
    show(FALLBACK);
  }
  setInterval(pollFallback, 250);

  function evalString(s) {
    const M = window.Module;
    if (!M || !M.eval_string) throw new Error('OctaveP5: Module.eval_string 尚未就绪');
    const rc = M.eval_string(s);
    return { rc, err: M.last_error_message() };
  }

  // 曾经这里要按需加载一个 10.8MB 的 `.oct`（把 Mesa 全打进去那版，A 档）。**现在不需要了**：
  // `opengl_renderer` 与 toolkit 都编在**主 wasm** 里
  // （见 build/113/webgl_toolkit.cc 的文件头：`opengl_functions` 的虚表跨模块会失效）。
  // 保留这个函数只为接口稳定（验收脚本仍会 await 它）。
  function ensureAssets() {
    window.__p5_assets_loaded = true;
    return Promise.resolve(true);
  }

  // 切到真渲染那条线（并立刻重画一次）。
  // 2026-09-23 起**只剩 `webgl` 一条**（gl4es → GLES2 → WebGL2，GPU）：OSMesa 后端已退役
  // （软件光栅化，速度/体积都吃亏；脚本与配方留在 git 历史的 graphics-osmesa 分支）。
  const BACKENDS = ['webgl'];

  function useBackend(name) {
    return ensureAssets().then(function () {
      const r = evalString("graphics_toolkit('" + name + "');");
      if (r.rc === 0)
        window.__p5_toolkit = name;
      return r;
    });
  }

  // 图形线 WebGL（gl4es → GLES2 → WebGL2，GPU）。见 build/113/NOTES-webgl.md
  function useWebGL() {
    return useBackend('webgl').then(function (r) { return r; });
  }

  // 切回 T2 的稳定句柄面
  function useWeb() {
    const r = evalString("graphics_toolkit('web');");
    window.__p5_toolkit = 'web';
    return r;
  }

  // 验收/演示用：一次到位地"加载资产 + 切到**这个站点有的那个**真渲染器 + 画一条线 + 出图"。
  // ⚠️ 这里**不能写死后端** —— 老版本写死 'osmesa'，在 WebGL 构建上直接
  //    `graphics_toolkit: osmesa toolkit is not available`（实测踩到）。
  //    现在后端清单只有 webgl 一项，但这条"按清单逐个试"仍然留着：将来再加后端不用改这里。
  function demo() {
    return ensureAssets().then(function () {
      function tryAt(i) {
        if (i >= BACKENDS.length)
          return { rc: -1, err: 'no real renderer in this build (' + BACKENDS.join('/') + ')' };
        return useBackend(BACKENDS[i]).then(function (r) {
          if (r.rc !== 0)
            return tryAt(i + 1);
          return evalString(
            "figure(1); clf; plot(1:10, (1:10).^2); title('真渲染'); drawnow();");
        });
      }
      return tryAt(0);
    });
  }

  window.OctaveP5 = {
    show, useWebGL, useWeb, demo, ensureAssets,
    status: function () { return Object.assign({ toolkit: window.__p5_toolkit || null }, last); },
  };
})();
