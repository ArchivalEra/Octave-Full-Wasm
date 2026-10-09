// Octave-Full-Wasm — **页面适配器（TypeScript 源）**，编译产物 = bridge/octave-page.js
// Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 为什么重写（工单 48）──────────────────────────────────────────────────────
// 旧版（工单 38 的 A2 逐字搬运）把三件不相干的事揉在一处：① 内核 Host 契约、
// ② 输入捕获（pointer/键盘/点击队列）、③ 输出渲染（每行一次 DOM 写 + 滚动）。
// 实测（probe-output-cost）：一次 1.4MB 输出 = 27000 次 DOM 插入，其中真实 DOM 成本
// ~20%（540ms/2724ms），而 `createTextNode+appendChild` 本身只占 107ms —— 大头是**布局/重排**。
// ⇒ 治法是**把输出合并成"每帧一次"**（成本与输出量脱钩），不是把 DOM 挪进 wasm
//   （wasm 碰不到 DOM；每写一次反而多一次边界穿越）。本文件据此重画三道缝：
//     · Host 契约 = 类型化的 `CoreHooks`（内核与页面之间**唯一**的接口面）
//     · 输出 = 可替换的 `OutputSink`（默认 `createCoalescedPreSink`：合并刷新，行为兼容旧页）
//     · 输入捕获 = 独立小函数（页面级，需要 document，留在 JS）
// ⚠ 兼容硬约束：编译产物必须**逐名兼容**旧版对外面（window.createOctaveHost /
//   __octaveHosts / __octaveClicks / __octaveRequestInterrupt / 两个全局监听器）——
//   embed 套件与既有页面只读这些名字。
// ⚠ 依赖加载顺序不变：octave-core.js 与 octave.js（按档）**之间**。
var G = window;
// ── 输出 sink：合并刷新（工单 48 的核心）────────────────────────────────────────
// 时间预算 16ms：**同步 eval 期间也能中途 flush**（rAF 在同步循环里不触发），
// 于是既压掉"每行一次重排"、又保留"流式可见"（延迟界 ≈ 16ms）。异步突发时用 rAF 兜底。
var FLUSH_BUDGET_MS = 16;
var SCROLL_THROTTLE_MS = 200;
function perfNow() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
}
function scheduleFrame(fn) {
    if (typeof window.requestAnimationFrame === 'function')
        requestAnimationFrame(function () { return fn(); });
    else
        setTimeout(fn, FLUSH_BUDGET_MS);
}
/**
 * 合并刷新的 `<pre>` sink：把 append 攒进缓冲，按**时间预算**或下一帧合并成**一次**
 * DOM 写入。行为对旧页兼容（同为往 <pre> 追加文本 + 节流自动滚底），但 DOM 写入次数
 * 从"每行一次"降到"每 ~16ms 一次"。
 */
function createCoalescedPreSink(el) {
    var pending = [];
    var scheduled = false;
    var lastFlush = perfNow();
    var lastScroll = 0;
    function autoScroll() {
        // ★ 读 scrollHeight 会强制同步布局 —— 这是实测里 DOM 成本的大头（107ms 调用 vs
        //   ~430ms 布局）。所以：① 只在 flush 后读；② 200ms 节流（旧版同值）。
        var now = perfNow();
        if (now - lastScroll <= SCROLL_THROTTLE_MS)
            return;
        lastScroll = now;
        if (document.documentElement.scrollHeight > window.innerHeight) {
            window.scrollTo(0, document.body.scrollHeight);
        }
    }
    function flush() {
        scheduled = false;
        if (!pending.length)
            return;
        var text = pending.join('');
        pending = [];
        el.appendChild(document.createTextNode(text));
        lastFlush = perfNow();
        autoScroll();
    }
    return {
        append: function (text) {
            if (!text)
                return;
            pending.push(text);
            // 预算到了就立刻 flush（同步 eval 里靠这条保住流式）；否则攒到下一帧。
            if (perfNow() - lastFlush >= FLUSH_BUDGET_MS)
                flush();
            else if (!scheduled) {
                scheduled = true;
                scheduleFrame(flush);
            }
        },
    };
}
/** 页面级默认 sink：找/建 `#output`（旧版语义：没有就 append 到 body）。 */
function createPageSink() {
    var el = document.getElementById('output');
    if (!el) {
        el = document.createElement('pre');
        el.id = 'output';
        document.body.appendChild(el);
    }
    return createCoalescedPreSink(el);
}
// ── 输入捕获（页面级；需要 document，留在 JS）──────────────────────────────────
function createClickQueue() {
    var q = {
        list: [],
        length: function () { return q.list.length; },
        push: function (c) { q.list.push(c); },
        shift: function () { return q.list.shift(); },
        clear: function () { q.list.length = 0; },
    };
    return q;
}
/** 全局 pointerdown：把命中 IMG/CANVAS 的点击**扇出**给所有 armed 实例（C6）。 */
function installPointerFanout() {
    window.addEventListener('pointerdown', function (e) {
        var el = e.target;
        if (!el || (el.tagName !== 'IMG' && el.tagName !== 'CANVAS'))
            return;
        var r = el.getBoundingClientRect();
        if (!r.width || !r.height)
            return;
        var click = [e.clientX - r.left, e.clientY - r.top, r.width, r.height,
            e.button === 2 ? 3 : (e.button === 1 ? 2 : 1)];
        var hit = false;
        for (var i = 0; i < G.__octaveHosts.length; i++) {
            var h = G.__octaveHosts[i];
            if (h.armed) {
                h.clicks.push(click);
                hit = true;
            }
        }
        if (hit)
            e.preventDefault();
    });
}
/** G4 Ctrl-C（Cmd+C 不拦）→ 中断旗标。中断非抢占：只在安全点生效。 */
function requestInterrupt() {
    try {
        if (G.Module && G.Module._web_request_interrupt)
            G.Module._web_request_interrupt();
    }
    catch (err) { /* 无事 */ }
}
function installInterruptKeys() {
    window.addEventListener('keydown', function (e) {
        if (e.ctrlKey && (e.key === 'c' || e.key === 'C'))
            requestInterrupt();
    });
}
// ── Host 工厂（内核/页面之间唯一那道缝）─────────────────────────────────────────
// opts.base  资源前缀   opts.mount 输出挂点（选择器，缺省=页面级 #output）
// opts.home  IDBFS 挂载点（非默认实例必须换，否则同源下两实例互覆持久键）
// opts.id    实例名     opts.lane  选档计划（缺省=页面计划；**必须转发**，见下）
// 返回 Module 形态对象（喂给 OCTAVE()）；第一个实例是"默认实例"，拿走全部 window.* 别名。
function createOctaveHost(opts) {
    var o = opts || {};
    var base = o.base || '';
    var isDefault = (G.__octaveHosts.length === 0);
    var inst = {
        id: o.id || (isDefault ? 'default' : ('inst-' + G.__octaveHosts.length)),
        clicks: [], armed: false, ready: false, mem: null, mod: null,
    };
    // 输出落点：指定 mount 就在挂点里开自己的 <pre>；否则用页面级 sink。
    // ⚠ 挂点解析在**注册之前**：不存在必须 throw，且不许在注册表留下幽灵实例。
    var sink;
    if (o.mount) {
        var mountEl = document.querySelector(o.mount);
        if (!mountEl)
            throw new Error('createOctaveHost: 找不到挂点 ' + o.mount);
        var outEl = document.createElement('pre');
        mountEl.appendChild(outEl);
        sink = createCoalescedPreSink(outEl);
    }
    else {
        sink = createPageSink();
    }
    G.__octaveHosts.push(inst);
    var clicks = createClickQueue();
    inst.clicks = clicks.list; // 兼容：既有断言读 inst.clicks 长度
    var core = G.createOctaveCore({
        base: base, mode: 'single', isDefault: isDefault, home: o.home,
        state: inst, clicks: clicks,
        // ★ 必须转发 lane：不转发 ⇒ 页面按档加载了 threads/w64 的胶水，内核却取根目录产物
        //   ⇒ 开机 BindingError / eval_string is not a function（probe-lane / embed-multi 实测）。
        //   缺省必须是**页面的选档计划**（页面只有一档）。
        lane: o.lane || G.__octaveLanePlan,
        host: {
            // ⚠ 两条都要：套件读 console（只写 DOM 会打掉 26 套），人读 DOM。
            print: function (t) { console.log(t); sink.append(t + '\n'); },
            printErr: function (t) { console.warn(t); sink.append(t + '\n'); },
            note: function (m) { console.warn(m); },
            stdinLine: function () {
                var q = G.__octaveStdin;
                if (q && q.length)
                    return String(q.shift());
                if (typeof G.prompt === 'function') {
                    var r = G.prompt('Input: ');
                    return r === null ? null : r;
                }
                return null;
            },
            doc: document,
            assets: function (mod, b, isReady) {
                // 默认实例复用 assets-loader.js 文件级那份（否则测试读的与 boot 链用的不是同一份状态）。
                // ⚠️ 但文件级别名是 `createOctaveAssets(null, …)` —— **惰性绑 `global.Module`**。
                //    页面宿主会设它（index.html: `window.Module = createOctaveHost(…)`），而 **embed 路径不设**
                //    （MODULARIZE，模块只活在 `__octaveHosts[i].mod`）⇒ 别名一用就抛「Module.FS 尚未就绪」
                //    ⇒ plotbridge/webgraphics/pkgfix 整链装不上（issue #5 第二层；实测 addpath 报
                //    `plotbridge: No such file or directory`）。判据 = **全局 Module 是否就是本模块**
                //    （`G.Module === mod`，与赋值时序无关）：是 ⇒ 老行为；否 ⇒ 建一份绑到本实例 mod 的，
                //    并更新别名（保证"测试读的与 boot 链用的"仍是同一份状态）。
                if (isDefault && G.OctaveAssets && G.Module === mod)
                    return G.OctaveAssets;
                var loader = G.createOctaveAssets(mod, b, isReady);
                if (isDefault)
                    G.OctaveAssets = loader;
                return loader;
            },
            onReady: function () { inst.ready = true; if (isDefault) {
                G.__octaveReady = true;
            } },
        },
    });
    inst.mod = core.module;
    inst.core = core;
    if (isDefault) {
        G.__octaveClicks = clicks.list; // 别名 = 默认实例队列（webjslib 原始实现读它）
        G.__octaveCaps = core.caps; // Capabilities（开机算一次，只读）
    }
    return core.module;
}
// ── 装到 window（兼容旧版的全局名，一个不少）──────────────────────────────────
G.__octaveHosts = [];
G.__octaveClicks = [];
G.__octaveClicksArmed = false;
G.__octaveRequestInterrupt = requestInterrupt;
G.createOctaveHost = createOctaveHost;
installPointerFanout();
installInterruptKeys();
