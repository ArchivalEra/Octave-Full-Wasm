// Octave-Full-Wasm — **嵌入 API**（工单 38；接口表 = docs/embed-api.md，照官方前端契约映射）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 这一层是什么 ──────────────────────────────────────────────────────────────
// 前端（REPL / 教学页 / Notebook）不碰 wasm/胶水，只面对 `OctaveEmbed.create()` 给的
// 那个对象。本文件是 `docs/embed-api.md` 接口表里 🔜 项的实现层：长在已验证的通道上
// （`createOctaveHost` 工厂 + `eval_string` rc 通道 + MEMFS 写回值通道），**不碰 wasm**。
//
// ── v1 契约（与 docs/embed-api.md 逐条对应）──────────────────────────────────
//   octave.eval(code)         → Promise<{ok, rc}>            语句；输出走 on.output
//   octave.evalJSON(expr)     → Promise<{ok, value?, error?}> 表达式；jsonencode 值通道
//   octave.workspace()        → Promise<[{name,class,bytes,size…}]>   （whos 结构化）
//   octave.pwd() / octave.cd(dir) / octave.help(name) / octave.history()
//   octave.interrupt()        → 到安全点置位（与官方语义一致：不是抢占）
//   octave.on.output(cb) / .onError(cb) / .onState(cb) / .onFigure(cb)
//   octave.input(text)        → 预填 stdin 队列（默认实例；UI 对话框接管见 docs）
//   octave.fs.read/write/ls/rm/upload/download
//   octave.state              → 'booting' | 'idle' | 'busy'
//
// ── 已知边界（如实，接口表 §3 同款）─────────────────────────────────────────
//   · 图形/四条队列桥仍是**默认实例**单例（wasm 侧 publish_png 分派待下次重链，E6）
//     ⇒ 本层创建的第一个实例 = 默认实例时才承诺 onFigure；
//   · eval 是页面上的同步调用 ⇒ 'busy' 对同步 eval 不可观察（worker 模式才可观察）；
//   · `input(text)` 走 `window.__octaveStdin` 队列（默认实例的 stdinLine 先读队列再 prompt）。
(function (global) {
  'use strict';

  function OctaveEmbed(modRef, opts) {
    opts = opts || {};
    var seq = 0;
    var subs = { output: [], error: [], state: [], figure: [] };
    var state = 'booting';
    var geometrySeq = 0;

    // ★ 几何导出器（m 源，工单 50）：走图形对象树（**不过 drawnow/GL**），v1 覆盖
    //   line/text/坐标区语义；输出结构 = {xlim,ylim,xscale,yscale,title,xlabel,ylabel,objects[]}
    var GEOM_EXPORT_M = [
    'function s = __oct_geometry_export__(gh)',
    '  s = struct();',
    '  ax = get(gh, "currentaxes");',
    '  if isempty(ax), s.objects = {}; return; end',
    '  s.xl = get(ax, "xlim"); s.yl = get(ax, "ylim");',
    '  s.xscale = get(ax, "xscale"); s.yscale = get(ax, "yscale");',
    '  s.xgrid = get(ax, "xgrid"); s.ygrid = get(ax, "ygrid");',
    '  s.title = get(get(ax, "title"), "string");',
    '  s.xlabel = get(get(ax, "xlabel"), "string");',
    '  s.ylabel = get(get(ax, "ylabel"), "string");',
    '  kids = get(ax, "children");',
    '  objs = cell(1, numel(kids)); n = 0;',
    '  for k = 1:numel(kids)',
    '    h = kids(k); t = get(h, "type");',
    '    if strcmp(t, "line")',
    '      n = n + 1;',
    '      objs{n} = struct("type", "line", "x", get(h, "xdata"), "y", get(h, "ydata"), ...',
    '        "color", get(h, "color"), "linewidth", get(h, "linewidth"), ...',
    '        "linestyle", get(h, "linestyle"), "marker", get(h, "marker"), ...',
    '        "markersize", get(h, "markersize"));',
    '    elseif strcmp(t, "text")',
    '      n = n + 1;',
    '      objs{n} = struct("type", "text", "x", get(h, "position")(1), ...',
    '        "y", get(h, "position")(2), "str", get(h, "string"), ...',
    '        "color", get(h, "color"), "fontsize", get(h, "fontsize"));',
    '    endif',
    '  endfor',
    '  s.objects = objs(1:n);',
    'endfunction',
  ].join('\n');

    // ★ display_exception 的 Web 面（工单 47 实测补上）：Qt 的 display_exception 在
    //   Web 里 = evalJSON 的 error 字段 **加** on.error 订阅回调。此前 subs.error 只能
    //   注册、没有任何触发点（死订阅）—— 逐接口实测抓出来的。
    function fireError (msg) {
      for (var i = 0; i < subs.error.length; i++) {
        try { subs.error[i](msg); } catch (e) { /* 订阅者异常不毒死解释器 */ }
      }
    }

    function setState(s) {
      if (state === s) return;
      state = s;
      for (var i = 0; i < subs.state.length; i++) {
        try { subs.state[i](s); } catch (e) { /* 订阅者异常不毒死解释器 */ }
      }
    }

    // ── 输出订阅：挂在实例输出区的 DOM 变更上（core 的 print 汇会写进 mount 的 pre）──
    var outEl = (opts.mount && document.querySelector(opts.mount)) || document.getElementById('output');
    if (outEl && typeof MutationObserver === 'function') {
      new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var add = muts[i].addedNodes;
          for (var j = 0; j < add.length; j++) {
            var t = add[j].textContent || '';
            if (!t) continue;
            for (var s = 0; s < subs.output.length; s++) {
              try { subs.output[s](t); } catch (e) {}
            }
          }
        }
      }).observe(outEl, { childList: true, subtree: true, characterData: true });
    }

    // ── 图形订阅：#p5figure 容器出 <canvas>/<img> 即回调（默认实例边界，见文件头）──
    function watchFigures() {
      var box = document.getElementById('p5figure');
      if (!box || typeof MutationObserver !== 'function') return;
      new MutationObserver(function () {
        var els = box.querySelectorAll('canvas,img');
        for (var i = 0; i < subs.figure.length; i++) {
          try { subs.figure[i](els.length ? els[els.length - 1] : null); } catch (e) {}
        }
      }).observe(box, { childList: true, subtree: true });
    }
    var hosts = global.__octaveHosts || [];
    var isDefault = hosts.length > 0 && hosts[0].mod === modRef;
    if (isDefault) { watchFigures(); }
    else { opts.quiet || (typeof console !== 'undefined' && console.warn &&
      console.warn('[octave-embed] 非默认实例：onFigure 不可用（图形上屏是默认实例单例，E6 边界）')); }

    var mod = modRef;

    function q(s) { return String(s).replace(/'/g, "''"); }   // Octave 单引号转义

    // 值通道（已验证形态）：表达式 jsonencode → MEMFS 文件 → FS.readFile → JSON.parse
    function evalJSON(expr) {
      return new Promise(function (resolve) {
        seq += 1;
        var p = '/tmp/.octave_embed_' + seq + '.json';
        var code = "fid=fopen('" + p + "','w'); try, T__=(" + expr +
          "); fprintf(fid,'%s',jsonencode(T__)); catch e; fprintf(fid,'%s',jsonencode(struct('err',e.message))); end; fclose(fid);";
        setState('busy');
        var rc;
        try { rc = mod.eval_string(code); } catch (e) { rc = -1; }
        setState('idle');
        var val = null, err = null;
        try {
          var txt = new TextDecoder().decode(mod.FS.readFile(p));
          val = JSON.parse(txt);
          if (val && typeof val === 'object' && val.err !== undefined) err = val.err;
        } catch (e) { err = 'embed 值通道失败：' + String(e).slice(0, 120); }
        try { mod.FS.unlink(p); } catch (e) {}
        if (err !== null) fireError(err);
        resolve(err === null ? { ok: rc === 0 && err === null, value: val, rc: rc }
                             : { ok: false, error: err, rc: rc });
      });
    }

    return {
      id: opts.id || (isDefault ? 'default' : 'inst'),
      get state() { return state; },
      eval: function (code) {
        setState('busy');
        var rc;
        try { rc = mod.eval_string(code); } catch (e) { rc = -1; }
        setState('idle');
        if (rc !== 0) fireError('eval 失败 rc=' + rc + '（Octave 错误文本走 on.output 通道）');
        return Promise.resolve({ ok: rc === 0, rc: rc });
      },
      evalJSON: evalJSON,
      workspace: function () { return evalJSON("whos()"); },   // 通道自带 jsonencode，别套娃
      pwd: function () { return evalJSON("pwd()"); },
      cd: function (dir) { return this.eval("cd('" + q(dir) + "');"); },
      help: function (name) { return this.eval("help '" + q(name) + "';"); },
      history: function () { return this.eval("history;"); },
      _setIdle: function () { setState('idle'); },
      interrupt: function () {
        try { if (mod._web_request_interrupt) { mod._web_request_interrupt(); return true; } } catch (e) {}
        return false;
      },
      input: function (text) {
        // 预填 stdin 队列（默认实例的 stdinLine 先读队列再 prompt —— index.html 的契约）
        var w = global;
        if (!w.__octaveStdin) w.__octaveStdin = [];
        w.__octaveStdin.push(String(text));
        return w.__octaveStdin.length;
      },
      // ★ 订阅器按接口表的**属性式**形状：octave.on.output(cb) / .onError → on.error(cb) …
      on: (function () {
        function mk(ev) {
          return function (cb) { subs[ev].push(cb); return true; };
        }
        return { output: mk('output'), error: mk('error'), state: mk('state'), figure: mk('figure') };
      })(),
      fs: {
        read: function (p) { return new TextDecoder().decode(mod.FS.readFile(p)); },
        write: function (p, text) { mod.FS.writeFile(p, String(text)); return true; },
        ls: function (d) {
          var out = [];
          var names = mod.FS.readdir(d);
          for (var i = 0; i < names.length; i++) {
            if (names[i] === '.' || names[i] === '..') continue;
            var st = null;
            try { st = mod.FS.stat(d + '/' + names[i]); } catch (e) {}
            out.push({ name: names[i], dir: !!(st && (st.mode & 0x4000)), size: st ? st.size : null });
          }
          return out;
        },
        rm: function (p) { mod.FS.unlink(p); return true; },
        // 下载到真文件（浏览器侧 Blob）；上传走 input[type=file] → write()
        download: function (p) {
          var data = mod.FS.readFile(p);
          var blob = new Blob([data]);
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = p.split('/').pop();
          document.body.appendChild(a); a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
          return true;
        },
      },
      figures: {
        // 导出最后一张图：canvas 直接 toDataURL；img 用 src（publish 通道已给 dataURL）
        export: function () {
          var box = document.getElementById('p5figure');
          if (!box) return null;
          var c = box.querySelector('canvas:last-of-type');
          if (c && c.toDataURL) return c.toDataURL('image/png');
          var img = box.querySelector('img:last-of-type');
          return img ? img.src : null;
        },
        // ★ 几何数据通道（工单 50，UI RFC #1 采纳项）：**数据驱动、不过 drawnow/GL**——
        //   直接走图形对象树（get 语义）导出折线/标记/文本/坐标区语义，UI 侧
        //   WebGPU/任何渲染器自己画。写导出函数到 /tmp → addpath → 调用 → JSON 回读
        //   （evalJSON 值通道同款管道）。
        geometry: function (figH) {
          var seqg = ++geometrySeq;
          var jp = '/tmp/.octave_geom_' + seqg + '.json';
          var mp = '/tmp/__oct_geometry_export.m';
          mod.FS.writeFile(mp, GEOM_EXPORT_M);
          var code =
            "try, addpath('/tmp'); " +
            (figH ? ("__gh__=" + figH + "; ") : "__gh__=gcf; ") +
            "T__=__oct_geometry_export(__gh__); " +
            "fid=fopen('" + jp + "','w'); fprintf(fid,'%s',jsonencode(T__)); fclose(fid); " +
            "catch e; fid=fopen('" + jp + "','w'); fprintf(fid,'%s',jsonencode(struct('err',e.message))); fclose(fid); end";
          setState('busy');
          var rc;
          try { rc = mod.eval_string(code); } catch (e) { rc = -1; }
          setState('idle');
          var val = null, err = null;
          try {
            var txt = new TextDecoder().decode(mod.FS.readFile(jp));
            val = JSON.parse(txt);
            if (val && typeof val === 'object' && val.err !== undefined) err = val.err;
          } catch (e) { err = 'geometry 通道失败：' + String(e).slice(0, 120); }
          try { mod.FS.unlink(jp); } catch (e) {}
          if (err !== null) fireError(err);
          return err === null ? Promise.resolve({ ok: rc === 0 && err === null, geometry: val, rc: rc })
                              : Promise.resolve({ ok: false, error: err, rc: rc });
        },
      },
    };
  }

  // ── 工厂：建实例 → 等就绪 → 返回 facade ────────────────────────────────────
  // opts：{ base, mount（缺省自建 <div id="octave-embed">）, home, id }
  // ⚠ 依赖页面已装 bridge/index.html 的 createOctaveHost + octave.js 的 OCTAVE 工厂
  //   （embed-demo.html 是标准接法；本文件不重复实现 boot 链）。
  global.OctaveEmbed = {
    create: function (opts) {
      opts = opts || {};
      return new Promise(function (resolve, reject) {
        if (typeof global.createOctaveHost !== 'function') {
          reject(new Error('OctaveEmbed.create：页面缺 createOctaveHost（先装 bridge/index.html 那一套）'));
          return;
        }
        if (!opts.mount) {
          var d = document.createElement('div');
          d.id = 'octave-embed';
          document.body.appendChild(d);
          opts.mount = '#octave-embed';   // ★ 回填：facade 的输出观察器要用它
        }
        var mount = opts.mount;
        // ★ createOctaveHost 返回的是 **Module 形态对象**（直接喂 OCTAVE）；就绪信号在
        //   注册表 `window.__octaveHosts`（{id,ready,mod,…}）里，不在返回值上 ——
        //   实测教训：把返回值当 inst 读 .ready ⇒ 永远 undefined ⇒ create 永远 pending。
        // ★ lane 计划必须透传（与 index.html 的 dispatch 同款）：页面已按档 document.write
        //   了胶水，内核的 lane 计划若缺省 = base ⇒ 资产清单错配（实测：demo 页纹理创建失败）。
        var mod;
        try {
          mod = global.createOctaveHost({
            base: opts.base || '', mount: mount,
            home: opts.home, id: opts.id,
            lane: opts.lane || global.__octaveLanePlan,
          });
        } catch (e) { reject(e); return; }
        if (typeof global.OCTAVE !== 'function') {
          reject(new Error('OctaveEmbed.create：页面缺 OCTAVE 工厂（octave.js 未装或未按 MODULARIZE 接线）'));
          return;
        }
        global.OCTAVE(mod);
        var t = 0;
        (function wait() {
          var ent = (global.__octaveHosts || []).find(function (h) { return h.mod === mod; });
          if (ent && ent.ready === true) {
            var h = OctaveEmbed(mod, opts);
            h._setIdle();
            resolve(h);
            return;
          }
          if (++t > 1200) { reject(new Error('OctaveEmbed.create：300s 未就绪（boot 链问题，看 console）')); return; }
          setTimeout(wait, 250);
        })();
      });
    },
  };
})(typeof window !== 'undefined' ? window : this);
