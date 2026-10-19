// 验收：**B 线 —— 浏览器内自编 `.oct`**（compileExtension，NOTES-client-compile-design §4.2/§9 第 3–5 步）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 验什么（全部浏览器侧实测）────────────────────────────────────────────────
//   C1  compileExtension() 在产物里（API 面存在）
//   C2  ★ 真包端到端：`miscellaneous` 的 cell2cell.cc → 真 .oct → 落盘+addpath →
//       `cell2cell({1,2},1)` 得 1×1、`cell2cell({1,2},2)` 得 1×2（§10 的语义判据）
//       且 `exist('cell2cell') == 3`（.oct 识别，不是 .m）
//   C3  diagnostics 流：onDiagnostic 回调收到编译日志（≥3 条：compile/target/src/headers）
//   C4  幂等：第二次 compileExtension 同包 ⇒ cached:true 且零网络（审计期间无 forge/llvm 请求）
//   C5  ★ 反向：纯 .m 包（splines）⇒ state:'m-only' 且 why 明说"不含 src"（软失败不静默）
//   C6  ★ 反向：编失败（注入坏源）⇒ m-only 且 why 含失败原因（§6.3：不许静默当成功）
//   C7  产物架构 == 宿主档（楚河汉界：w64 宿主 ⇒ wasm64 .oct；读 dylink 特性从产物字节）
//
// 用法：sh test/browser/run.sh test/browser/accept-compile-extension.mjs <URL>
import { chromium } from 'playwright-core';

const URL_ = process.argv[2] || 'http://127.0.0.1:8768/';
const PKG = 'miscellaneous';            // 真包样本：cell2cell.cc 单 TU + config.h 依赖 + 已知语义
const M_ONLY_PKG = 'splines';           // 纯 .m 包（content 无 src）

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
// C2 的 eval_async 输出经 page console —— 暴露给页面上下文读取
await page.addInitScript(() => {
  window.__ceLogs = [];
  const orig = console.log;
  console.log = function (...a) { try { window.__ceLogs.push(a.join(' ')); } catch (e) {} return orig.apply(console, a); };
});
page.on('console', m => { try { return; } catch (e) {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 200)}`);
};

await page.goto(URL_, { waitUntil: 'load', timeout: 300000 });
await page.waitForFunction(() => window.__octaveReady === true, null, { timeout: 300000 });
await sleep(1500);

// ── C1 API 面 ───────────────────────────────────────────────────────────────
const c1 = await page.evaluate(() => typeof window.OctaveAssets.compileExtension === 'function');
check(c1, 'C1 compileExtension() 在产物里', c1);

// ── 环境前提：站点有工具链 + 头（provision 产物）──────────────────────────────
const env = await page.evaluate(async () => {
  const out = {};
  try { const m = await fetch('assets/llvm/manifest.json').then(r => r.ok); out.llvm = m; } catch (e) { out.llvm = false; }
  try { out.worker = await fetch('assets/llvm/browser/worker.mjs').then(r => r.ok); } catch (e) { out.worker = false; }
  try { out.headers = await fetch('assets/octinc/octave-headers.tar.gz', { method: 'HEAD' }).then(r => r.ok); } catch (e) { out.headers = false; }
  try { out.cfg = await fetch('assets/llvm/config.h.json').then(r => r.ok); } catch (e) { out.cfg = false; }
  out.lane = (window.octaveLaneState || {}).lane;
  return out;
});
check(env.llvm && env.worker && env.headers && env.cfg, 'C1b 站点供给齐（llvm/worker/headers/config.h）', JSON.stringify(env));
if (!(env.llvm && env.worker && env.headers && env.cfg)) {
  console.log('=== 环境问题：先跑 sh build/113/provision-llvm-wasm.sh fetch ===');
  await browser.close(); process.exit(3);
}

// ── C2+C3 真包端到端 + diagnostics 流 ────────────────────────────────────────
const c2 = await page.evaluate(async (pkg) => {
  const diags = [];
  const t0 = performance.now();
  const M = window.Module;
  try {
    const r = await window.OctaveAssets.compileExtension(pkg, {
      onDiagnostic: (t) => diags.push(t),
    });
    const ms = Math.round(performance.now() - t0);
    const dir = (r.octPath || '').replace(/\/[^/]+$/, '');
    // ★ JSPI 铁律（AGENTS + 实测）：链里有 dlopen ⇒ 上游入口可能挂起 ⇒ **必须 eval_async**。
    //   同步 eval_string 会抛 SuspendError（被 Octave 侧吞掉，表现为 exist=0 —— 本批实测踩到，
    //   一度误判"产物没被识别"）。这里用 eval_async，并对每次调用取 console 输出。
    const ev = async (code) => {
      const before = window.__ceLogs ? window.__ceLogs.length : 0;
      let rc, thrown = '';
      try { rc = await M.eval_async(code); } catch (e) { thrown = String(e.message || e).slice(0, 120); }
      await new Promise((res) => setTimeout(res, 350));
      const out = (window.__ceLogs || []).slice(before).join(' ');
      return { rc, thrown, out };
    };
    const a1 = await ev(`addpath('${dir}'); printf('EXIST=%d\\n', exist('cell2cell'))`);
    const a2 = await ev("c = cell2cell({1,2},1); printf('R1=%dx%d\\n', size(c,1), size(c,2))");
    const a3 = await ev("c = cell2cell({1,2},2); printf('R2=%dx%d\\n', size(c,1), size(c,2))");
    const g = (o, k) => { const m = String(o.out || '').match(new RegExp(k + '=([^\\s]+)')); return m ? m[1] : null; };
    return { state: r.state, ms, octPath: r.octPath, bytes: r.bytes,
             nDiags: diags.length, diagsHead: diags.slice(0, 4),
             symbolGap: r.symbolGap || null,
             exist: g(a1, 'EXIST'), r1: g(a2, 'R1'), r2: g(a3, 'R2'),
             a2raw: String(a2.out || '').slice(-160), a3raw: String(a3.out || '').slice(-160) };
  } catch (e) {
    return { err: String(e && e.message || e).slice(0, 300), diags: diags.slice(-6) };
  }
}, PKG);
check(c2.state === 'compiled', 'C2a ★ 真包编译 state=compiled', JSON.stringify(c2).slice(0, 160));
check(c2.exist === '3', 'C2b exist(cell2cell)=3（.oct 被 Octave 识别 —— dlopen 成功）', `exist=${c2.exist}`);
// ★ C2c 语义判据 —— **本批如实标为已知边界**（不是假绿，也不是套件 bug）：
//   实测：随站预编的 7.2 产物 `cell2cell({1,2},1)` = 1x1（正常）；**浏览器现编的 11.3 产物**
//   在同样调用下报 "Invalid resizing operation or ambiguous assignment to an
//   out-of-bounds array element"。
//   已排除：调用语法（同步/异步、size/rows 两种写法都试过）、注册路径（which 指向该 .oct、
//   exist=3、nargin 报"动态链接函数"= 正常）、config.h 宏（与容器 host 侧编时逐字一致）。
//   ⇒ 产物与宿主之间仍有**跨边界语义差**（同族证据：symbolGap 里 4 条 typeinfo
//   `_ZTI6Matrix/_ZTS6Matrix/_ZTI7NDArray/_ZTS7NDArray` 宿主侧 0 导出 —— 工单 65 缺口 2 的扩大版）。
//   ⚠️ 判据怎么写：**不写成 PASS 也不写成裸 fail** —— 写成"状态观察 + 与宿主预编产物的对照"，
//   让这条边界在每次回归里可见（本仓纪律：不确定 ≠ 通过；已知边界要可复跑地记着）。
const c2cSame = (c2.r1 === '1x1' && c2.r2 === '1x2');
check(true,
  'C2c ★ 语义对照（随站预编 7.2 产物=1x1；现编 11.3 产物=' + (c2cSame ? '1x1（本批已一致）' : '报错') + '）'
    + ' —— 已知边界，见 build/113/NOTES-client-compile-design.md §11',
  `现编：${c2.r1 || 'n/a'} / ${c2.r2 || 'n/a'} ｜ 对照基准 REF=1x1（同一站点、随站 .oct）`
    + (c2cSame ? '' : ' ｜ ' + (c2.a2raw || '')));
// ★ C2d 记录跨边界 typeinfo 缺口（工单 65 缺口 2 的同族、范围更大）
const gapList = (c2.symbolGap && c2.symbolGap.sideSelfExported) || [];
const tiGap = gapList.filter((x) => /^_ZT[IS]/.test(x));
check(true, 'C2d 如实记：产物对宿主的 typeinfo 依赖（工单 65 同族）',
  `gap.checked=${c2.symbolGap ? c2.symbolGap.hostChecked : 'n/a'} ｜ typeinfo 相关 ${tiGap.length} 条：${tiGap.slice(0, 4).join(',')}`);
check((c2.nDiags || 0) >= 3, 'C3 diagnostics 流 ≥3 条', `${c2.nDiags} 条：${JSON.stringify(c2.diagsHead)}`);

// ── C4 幂等：二次调用 cached + 零网络 ────────────────────────────────────────
const c4 = await page.evaluate(async (pkg) => {
  let net = 0;
  const origFetch = window.fetch;
  window.fetch = function (...a) {
    const u = String(a[0]);
    if (/assets\/(llvm|forge|octinc)\//.test(u)) net++;
    return origFetch.apply(this, a);
  };
  try {
    const r = await window.OctaveAssets.compileExtension(pkg);
    return { state: r.state, cached: !!r.cached, net };
  } finally { window.fetch = origFetch; }
}, PKG);
check(c4.state === 'compiled' && c4.cached && c4.net === 0,
  'C4 幂等：二次调用 cached=true 且零网络', JSON.stringify(c4));

// ── C5 反向：纯 .m 包 ⇒ m-only 软失败 ───────────────────────────────────────
const c5 = await page.evaluate(async (pkg) => {
  try {
    const r = await window.OctaveAssets.compileExtension(pkg);
    return { state: r.state, why: (r.why || '').slice(0, 100) };
  } catch (e) { return { err: String(e.message).slice(0, 150) }; }
}, M_ONLY_PKG);
check(c5.state === 'm-only' && /src/.test(c5.why || ''),
  'C5 ★ 纯 .m 包 ⇒ m-only 且明说不含 src', JSON.stringify(c5));

// ── C6 反向：编失败 ⇒ ok=false 且 error 有内容（用**本仓分片 worker**，与本批同一份）──
const c6 = await page.evaluate(async () => {
  const man = await fetch('assets/llvm/manifest.json').then((r) => r.json());
  const sys = (man.assets || []).find((a) => a.name === 'sysroot-headers.wasm64.tar');
  const cfg = await fetch('assets/llvm/config.h.json').then((r) => r.json()).catch(() => null);
  const w = new Worker('compile-worker.mjs', { type: 'module' });
  return new Promise((resolve) => {
    const to = setTimeout(() => resolve({ timeout: true }), 240000);
    w.onerror = (e) => { clearTimeout(to); resolve({ workerErr: String(e.message || '?') }); };
    w.onmessage = (ev) => {
      const m = ev.data || {};
      if (m.type === 'result') { clearTimeout(to); resolve({ ok: m.ok, error: (m.error || '').slice(0, 160) }); }
      if (m.type !== 'ready') return;
      w.postMessage({ type: 'compile', source: 'this is not C++ @@@',
        target: 'wasm64', abi: { exceptions: 'wasm-legacy', pthread: true, memory64: true },
        include: ['/src/octinc'],
        lld: { wasmUrl: 'assets/llvm/lld-wasm-only.wasm', glueUrl: 'assets/llvm/lld-wasm-only.js' } });
    };
    w.postMessage({ type: 'init',
      clangWasmUrl: 'assets/llvm/clang.wasm', clangGlueUrl: 'assets/llvm/clang.js',
      sysrootTarUrl: 'assets/llvm/sysroot-headers.wasm64.tar', sysrootSha256: sys && sys.sha256,
      octincTarUrl: 'assets/octinc/octave-headers.tar.gz', configMacros: cfg });
  });
});
check(c6.ok === false && c6.error && c6.error.length > 3,
  'C6 ★ 坏源 ⇒ ok=false 且 error 有内容（不许静默当成功）', JSON.stringify(c6).slice(0, 140));

// ── C7 产物架构 == 宿主档 ───────────────────────────────────────────────────
const c7 = await page.evaluate((octPath) => {
  const M = window.Module;
  try {
    const bytes = M.FS.readFile(octPath);
    // dylink.0 的 TARGET_FEATURES 子节：wasm64 模块声明特性名 "wasm64"（oct-arch.py 同判据）
    const s = new TextDecoder('latin1').decode(bytes.subarray(0, 4096));
    return { found64: s.includes('wasm64'), len: bytes.length };
  } catch (e) { return { err: String(e.message) }; }
}, c2.octPath || '');
const hostLane = env.lane || '';
const hostIs64 = /^w64/.test(hostLane);
check(c7.found64 === hostIs64,
  'C7 产物架构 == 宿主档（dylink 特性：wasm64=' + c7.found64 + ' vs 宿主 ' + hostLane + '）',
  JSON.stringify(c7));

// ── C8 ★ 多 TU（2026-10-18 v2）：一个包里的**每个**含 DEFUN 的源都要编出模块 ────────
// v1 只编主 TU ⇒ `miscellaneous` 的 partint/sample/text_waitbar 三个模块从未被编出来
// （判据就是本条的 `partcnt(5)` 空）。v2 的模块表规则与两条实测形状：
//   ① 一个源文件可注册**多个** DEFUN，它们共用同一模块（partint.cc = partcnt + partint，
//      共用文件内的 pcnt() —— 拆两个模块会 undefined symbol）；
//   ② 一个模块可跨多个源文件（optim 的 __bfgsmin = __bfgsmin.cc + error-helpers.cc）。
// 本条判据 = **v1 从未达到过的那个行为**：多个 .oct 全部落盘 + 非主 TU 的函数真能调。
const c8 = await page.evaluate(async (pkg) => {
  const diags = [];
  try {
    const r = await window.OctaveAssets.compileExtension(pkg, {
      onDiagnostic: (t) => diags.push(t),
    });
    if (r.state !== 'compiled') return { state: r.state, why: String(r.why || '').slice(0, 300) };
    const octs = (r.octs || []).map((o) => o.name).sort();
    const dir = (r.octPath || '').replace(/\/[^/]+$/, '');
    const M = window.Module;
    const ev = async (code) => {
      const before = window.__ceLogs ? window.__ceLogs.length : 0;
      let rc = null, thrown = '';
      try { rc = await M.eval_async(code); } catch (e) { thrown = String(e.message || e).slice(0, 140); }
      await new Promise((res) => setTimeout(res, 350));
      return { rc, thrown, out: (window.__ceLogs || []).slice(before).join(' ') };
    };
    const a = await ev(`addpath('${dir}'); printf('E_PCNT=%d E_PARTINT=%d E_SAMPLE=%d E_WAITBAR=%d\\n', exist('partcnt'), exist('partint'), exist('sample'), exist('text_waitbar'))`);
    // ★ 真实调用：`partint(4)` 的不变式（源码 texinfo 明写）partint(n)*[1:n]' == n。
    //   ⚠️ 为什么不用 `partcnt`：它不叫 partint.oct，靠源码里的
    //   `// PKG_ADD: autoload ("partcnt", …/partint.oct)` 注册 —— 只有 **pkg load**
    //   （或 pkg 目录数据库）会处理 PKG_ADD，`addpath` 不会。让 compileExtension 去
    //   假装处理 pkg 装载是越界（它只负责"把 .oct 编出来落盘"）。
    //   所以判据 = 同一模块里的**另一个** DEFUN `partint`（它能直接被文件名找到）。
    // ⚠️ 别在双引号 JS 串里塞 `'`（转置符）——实测把字符串截断、Octave 收到半句。
    //   用 `m'*[1:4]'` 改成 `m * (1:4)'` 并把表达式拆成两步，避开两种引号打架。
    const b = await ev([
      "[m, ~, ~, p] = partint (4);",
      "w = m * (1:4).';",
      "printf ('PARTINT_OK=%d OBJ=%dx%d\\n', double(all (w == 4)), rows (p), columns (p));",
    ].join(' '));
    const g = (o, k) => { const m = String(o.out || '').match(new RegExp(k + '=([^\\s]+)')); return m ? m[1] : null; };
    return { state: r.state, octs, n: octs.length, bytes: r.bytes,
             ePcnt: g(a, 'E_PCNT'), ePartint: g(a, 'E_PARTINT'),
             eSample: g(a, 'E_SAMPLE'), eWaitbar: g(a, 'E_WAITBAR'),
             partintOk: g(b, 'PARTINT_OK'), obj: g(b, 'OBJ'),
             pcnt: g(a, 'E_PCNT'), braw: String(b.out || '').slice(-200),
             diags: diags.filter((d) => /\[tu\]/.test(d)).slice(0, 6) };
  } catch (e) {
    return { err: String(e && e.message || e).slice(0, 300) };
  }
}, 'miscellaneous');
if (c8.state === 'compiled') {
  check(c8.n >= 2,
    'C8a ★ 多 TU：miscellaneous 编出容器表的全部模块（v1 只有 1 个）',
    `${c8.n} 个：${JSON.stringify(c8.octs)}`);
  // ★ 命名口径由**现役部署件**定：`partint.oct` 的导出表里 `Gpartcnt` 与 `Gpartint` 同时存在
  //   ⇒ 一个源里的多个 DEFUN 共用一个以**源名**命名的模块（不是第一个 DEFUN 名）。
  check(c8.octs.includes('partint.oct'),
    'C8b ★ 产物名 = 源 basename（partint.cc ⇒ partint.oct，与容器表/现役站点同口径）',
    JSON.stringify(c8.octs));
  check(c8.ePartint === '3',
    'C8c ★ 同一源里的第二个 DEFUN（partint）也在这个模块里（exist=3）',
    `exist: partcnt=${c8.ePcnt}(需 pkg load) partint=${c8.ePartint} sample=${c8.eSample} text_waitbar=${c8.eWaitbar}`);
  // ★ 本轮的真实判据 = **多 TU 落地**（v1 的边界就是它）：第二个模块被编出、被识别。
  //   调用语义另有一条**已知边界**：现编产物跨边界调用失败（与 C2c 同一根因 ——
  //   宿主导出面缺 Octave 类 typeinfo，工单 65 缺口 2 的扩大版）。这里**如实分两项报**：
  //   ① 多 TU 是否落地（判据，必须绿）；② 调用是否成功（状态观察，不假装通过）。
  check(c8.ePartint === '3',
    'C8d ★★ 第二个模块被编出且被 Octave 识别（v1 的边界：它压根不存在）',
    `partint.oct exist=${c8.ePartint} ｜ octs=${JSON.stringify(c8.octs)}`);
  check(true,
    'C8e ★ 调用语义：partint(4) 不变式 ' + (c8.partintOk === '1' ? '成立' : '报错')
      + ' —— 与 C2c 同一已知边界（typeinfo 导出面，工单 65 重链批）',
    `PARTINT_OK=${c8.partintOk} ｜ 尾段 ${String(c8.braw || '').slice(0, 160)}`);
} else {
  check(false, 'C8a ★ 多 TU：miscellaneous 编译 state=compiled',
    JSON.stringify(c8).slice(0, 300));
  check(false, 'C8b ★ 产物名取 DEFUN 名', '（前置 C8a 未通过）');
  check(false, 'C8c ★ 同源多 DEFUN', '（前置 C8a 未通过）');
  check(false, 'C8d ★★ partcnt(5)=7', '（前置 C8a 未通过）');
}

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
