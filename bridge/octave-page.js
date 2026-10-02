// Octave-Full-Wasm — **页面适配器**（createOctaveHost 等；自 bridge/index.html 逐字抽出，工单 38）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ⚠ A2 纪律：本文件是**搬运**（index.html 的内联脚本原样外置），不改任何行为；
//   index.html 用 <script src="octave-page.js"> 引它。抽出理由：嵌入 API（octave-embed.js）
//   与未来的 REPL/教学页都要用同一个工厂 —— 页面适配器从此是一份可装载的资产，不是某页的私产。
// ⚠ 依赖：加载顺序必须在 octave-core.js 与 octave.js（按档）**之间**（本文件顶部的注释即原样）。
  // ── 输出落点（T6c）────────────────────────────────────────────────────────
  // 上游骨架只留了一个空的 `<pre id="output">`，而且**没有人往里写东西**：
  // 实测 `disp(42)` 之后 `document.body.innerText` 仍是空串 —— 所有 Octave 输出
  // 都只进浏览器控制台，页面上什么也看不到。这对"打开链接就能用"是硬缺口，
  // 所以这里把 stdout/stderr **同时**显示到页面。
  //
  // ⚠️ 仍然照常走 console：验收套件（test/browser/accept-*.mjs）读的就是 console
  // 里的输出，只写 DOM 会把 26 套全打掉。是"额外再显示一份"，不是"改道"。
  function octaveUiAppend(s) {
    var el = document.getElementById('output');
    if (!el) {
      el = document.createElement('pre');
      el.id = 'output';
      document.body.appendChild(el);
    }
    el.appendChild(document.createTextNode(s));
    // 只在页面真的可滚动时才跟到底部：输出多的时候避免每次写都做一次布局查询。
    // ★ 2026-09-26 修：**读 `scrollHeight` 会强制同步布局**，海量输出时每条都读 =
    //   37 次 ×(300KB 文本的)布局 ≈ 2 秒 ⇒ 主线程照样被卡（外部评审 C-4 的"背压"问题
    //   真身在这里，不在 worker 的消息条数）。⇒ 按时间**节流**（200ms 一次）。
    var __now = (window.performance && performance.now) ? performance.now() : Date.now();
    if (__now - (window.__octaveScrollAt || 0) > 200) {
      window.__octaveScrollAt = __now;
      if (document.documentElement.scrollHeight > window.innerHeight) {
        window.scrollTo(0, document.body.scrollHeight);
      }
    }
  }

  // ── C6（2026-09-26）：实例注册表 + 全局监听 fan-out ─────────────────────────
  // 以前整套桥按"页面单例"设计（固定 id + 固定 window 全局 + 共享点击队列），
  // 同页第二个实例必然互踩。现在：每个实例有自己的点击队列（arm/pending/pop 三个
  // import 由工厂按实例覆写，见 createOctaveHost），全局 pointerdown **扇出**给所有
  // armed 的实例。window.__octaveClicks / __octaveClicksArmed 保留为**默认实例**的
  // 别名（wasm 侧 webjslib 的原始实现读它们；覆写后默认实例语义不变）。
  window.__octaveHosts = [];
  window.__octaveClicks = [];
  window.__octaveClicksArmed = false;
  window.addEventListener('pointerdown', function (e) {
    var el = e.target;
    if (!el || (el.tagName !== 'IMG' && el.tagName !== 'CANVAS')) return;
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var click = [e.clientX - r.left, e.clientY - r.top, r.width, r.height,
                 e.button === 2 ? 3 : (e.button === 1 ? 2 : 1)];
    var hit = false;
    for (var i = 0; i < window.__octaveHosts.length; i++) {
      var h = window.__octaveHosts[i];
      if (h.armed) { h.clicks.push(click); hit = true; }
    }
    if (hit) e.preventDefault();
  });
  // ── G4 Ctrl-C：Ctrl+C（Cmd+C 不拦，mac 用户用按钮/函数）→ 置位中断旗标 ──────
  // ⚠️ 只在解释器**正在跑**时才有意义；CPU 密集循环不经过安全点 ⇒ 不是抢占（如实记）。
  //    C6 边界：中断走 window.Module（默认实例）；非默认实例的中断要用它自己的
  //    Module._web_request_interrupt（实例对象上就有）。
  window.addEventListener('keydown', function (e) {
    if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
      try { if (window.Module && window.Module._web_request_interrupt) window.Module._web_request_interrupt(); } catch (err) {}
    }
  });
  window.__octaveRequestInterrupt = function () {
    try { if (window.Module && window.Module._web_request_interrupt) window.Module._web_request_interrupt(); } catch (err) {}
  };

  // ── C6：实例工厂（★ A2 起它只是**页面适配器** —— 逻辑全在 bridge/octave-core.js）──────
  // 用法：var mod = createOctaveHost({ base: '', mount: '#host2', home: '/home/web_user/i2', id: 'i2' });
  //       OCTAVE(mod);                       // octave.js 的工厂（MODULARIZE），自己调
  // opts：
  //   base  资源前缀（wasm/.data/manifest/全部资产）——嵌进子目录或别的路径时用
  //   mount 输出区挂点（选择器）；缺省 = 页面级 #output（默认实例语义）
  //   home  IDBFS 挂载点；缺省 /home/web_user。非默认实例**必须**换一个，
  //         否则同源下两个实例的 syncfs 会互相覆盖同一批持久键
  //   id    实例名（注册表与报错里用）
  // 返回 Module 形态的对象（喂给 OCTAVE()）；**第一个**创建的实例是"默认实例"，
  // 拿走全部 window.* 兼容别名（window.Module / __octaveReady / OctaveAssets / …）——
  // 77 个验收套件与既有页面读的就是这些名字，语义一字不变。
  // ⚠️ 已知边界（C6=页面层，产物不变）：图形上屏与四个队列桥（audio/rec/filepick/net）
  //    仍是默认实例单例；非默认实例的 eval/FS/资产完全独立，但 plot 不上屏、
  //    音频队列不被 drain —— 分派要动 wasm 侧（webgl_toolkit.cc），与下一次重链合并。
  //
  // 这一侧只提供"只有页面才知道的"那几件（10 件接口里的页面实现，见 core 文件头）：
  //   print/printErr（console + 上屏，**两条都要**：套件读 console，人读 DOM）、
  //   note（诊断走 console.warn）、stdinLine（__octaveStdin 队列 → window.prompt 回落）、
  //   doc（真 document）、clicks（每实例一个队列）、assets（默认实例复用文件级那份）、onReady。
  window.createOctaveHost = function (opts) {
    opts = opts || {};
    var base = opts.base || '';
    var isDefault = (window.__octaveHosts.length === 0);
    var inst = {
      id: opts.id || (isDefault ? 'default' : ('inst-' + window.__octaveHosts.length)),
      clicks: [], armed: false, ready: false, mem: null, mod: null,
    };

    // 输出区：指定 mount 就在挂点里开自己的 <pre>；否则用页面级 #output。
    // ⚠️ 挂点解析放在**注册之前**：挂点不存在必须 throw，且不许在注册表里留下幽灵实例。
    var uiAppend;
    if (opts.mount) {
      var mountEl = document.querySelector(opts.mount);
      if (!mountEl) { throw new Error('createOctaveHost: 找不到挂点 ' + opts.mount); }
      var outEl = document.createElement('pre');
      mountEl.appendChild(outEl);
      uiAppend = function (s) { outEl.appendChild(document.createTextNode(s)); };
    } else {
      uiAppend = octaveUiAppend;
    }
    window.__octaveHosts.push(inst);      // 注册：内核会把 armed/ready/mem 写在这个对象上

    // 点击队列：**每实例一个**（旧实现读 window 全局 ⇒ 同页两实例互踩）。
    // 全局 pointerdown 把命中扇出给所有 armed 的实例（见文件顶部那段）。
    var clicks = {
      list: [],
      length: function () { return clicks.list.length; },
      push: function (c) { clicks.list.push(c); },
      shift: function () { return clicks.list.shift(); },
      clear: function () { clicks.list.length = 0; },
    };
    inst.clicks = clicks.list;            // 兼容：既有断言读 inst.clicks 的长度

    var core = window.createOctaveCore({
      base: base, mode: 'single', isDefault: isDefault, home: opts.home,
      state: inst, clicks: clicks,
      // ★ B6：**必须转发** —— 不转发的话页面按档加载了 `threads/octave.js` 胶水，内核却去取
      //   根目录的 `octave.wasm`（基础档）⇒ 胶水/产物不匹配，开机当场
      //   `BindingError: Cannot register multiple overloads of a function with the same number
      //   of arguments (0)!`（probe-lane 实测抓到；`caps.chosen` 会显示 base 而 plan 是 threads）。
      // ★★ 第二处（2026-09-27，accept-embed-multi 实测）：**不带 opts.lane 的第二个实例**也会
      //   掉进同一个坑 —— 内核的缺省是基础档，而页面上只加载了**本档的**胶水（`document.write`
      //   写死一份）⇒ 两个实例一个线程档胶水 + 一个基础档产物，第二个实例 `eval_string is not
      //   a function`（表现成 i2Ready=false）。所以缺省值必须是**页面的选档计划**（页面只有一档）。
      lane: opts.lane || window.__octaveLanePlan,
      host: {
        // ⚠️ 仍然照常走 console：验收套件读的就是 console 里的输出，只写 DOM 会把 26 套全打掉。
        print: function (t) { console.log(t); uiAppend(t + '\n'); },
        printErr: function (t) { console.warn(t); uiAppend(t + '\n'); },
        note: function (m) { console.warn(m); },
        stdinLine: function () {
          var q = window.__octaveStdin;
          if (q && q.length) { return String(q.shift()); }
          if (typeof window.prompt === "function") {
            var r = window.prompt("Input: ");
            return r === null ? null : r;
          }
          return null;
        },
        doc: document,
        assets: function (mod, b, isReady) {
          // 默认实例**复用** assets-loader.js 文件级创建的那份（惰性绑 global.Module）——
          // 否则测试读的（window.OctaveAssets）与 boot 链用的不是同一份状态。
          if (isDefault && window.OctaveAssets) { return window.OctaveAssets; }
          return window.createOctaveAssets(mod, b, isReady);
        },
        onReady: function () { inst.ready = true; if (isDefault) { window.__octaveReady = true; } },
      },
    });
    inst.mod = core.module;
    inst.core = core;
    if (isDefault) {
      window.__octaveClicks = clicks.list;   // 别名 = 默认实例的队列（webjslib 原始实现读它）
      window.__octaveCaps = core.caps;       // Capabilities（D4）：开机算一次，消费者只读
    }
    return core.module;
  };
