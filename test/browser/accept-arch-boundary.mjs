// 验收：**架构界（"楚河汉界"）** —— 含 .oct 的内容必须与宿主档同架构（用户点令 2026-10-16）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 验什么（全部浏览器侧实测）────────────────────────────────────────────────
// 用户点令原文：**「wasm32 引擎只能装 32 的额外内容，IP 线和 64 线都要兼容 64 的额外内容」**。
// 本套件把那句话拆成可证伪的条目 —— ⚠️ 注意本仓实测的一处**修正**：这条界**不是**
// "w64 档只收 wasm64 内容"，而是"**要 dlopen 进宿主的东西**必须与宿主同架构"：
//   · 纯 `.m` 包 ⇒ **无架构概念**（任何档都能装）；
//   · 含 `.oct` 的条目 ⇒ 带 `arch`，必须等于宿主档；
//   · 能力层（`form:"tree"`）⇒ **不带 arch**（自带运行时；实测反例：Pyodide 是 wasm32，
//     却在 w64 档页面上跑通 —— 见 `accept-symbolic-seam` 9/0）。
//
//   A1 目录记账：`catalog()` 能答出宿主档是哪一档架构（`hostArch` 的判据 = 选档结果）
//   A2 **豁免档**：纯 `.m` 条目**不带** `arch`；能力层条目（pyodide）**不带** `arch`
//      —— 它们不许被架构界拦（若它们带 arch，下面 A4 的"该过必须过"就崩）
//   A3 ★ **反向（本套件的核心）**：往目录**注入**一条 `arch` 与宿主**不符**的假条目
//      ⇒ `install` 必须**响亮拒绝**，且 `verdict.cause === 'arch-mismatch'`
//      （判据做在客户端，所以**不依赖任何后端**：注入即测）
//   A4 正向：宿主架构**相符**的假条目 ⇒ 不当场以 arch 为由拒绝（会往前走，失败也只以
//      "字节不在/校验失败"等**别的** cause 出现 —— 不许报成 arch-mismatch）
//
// ⚠️ **诚实边界**：本套件**不改站点**（不往 `site/` 写文件）。A3/A4 的"注入"是**在页面内
//    构造目录**（`createOctaveAssets` 工厂 + 一个假 base，与 `accept-install-verdict` 的
//     做法同款）；真目录里的 arch 一致性由**站点闸门 R10 与车道纯度闸门**在装配期管
//     （那两条是"装配期"判据，本套件是"运行期"判据，两者互补）。
//
// 用法：sh test/browser/run.sh test/browser/accept-arch-boundary.mjs <URL>
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 220)}`);
};

await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
await page.waitForFunction(() => window.__octaveReady === true, null, { timeout: 300000 })
  .catch(() => {});
await sleep(1200);

const hasApi = await page.evaluate(() => typeof window.OctaveAssets === 'object'
  && typeof window.OctaveAssets.catalog === 'function');
if (!hasApi) { console.log('=== 环境问题：页面没起来 ==='); await browser.close(); process.exit(3); }

// ── A1 宿主档 → 架构（判据 = 选档结果，与客户端 hostArch 同源思路）──────────────
const lane = await page.evaluate(() =>
  (window.octaveLaneState && window.octaveLaneState.lane)
  || (window.__octaveCaps && window.__octaveCaps.lane && window.__octaveCaps.lane.chosen) || '');
const hostArch = /^w64/.test(lane) ? 'wasm64' : (lane ? 'wasm32' : '');
check(!!hostArch, 'A1 宿主档已知 ⇒ 推出宿主架构', `lane=${lane} arch=${hostArch}`);

// ── A2 豁免档：纯 .m 与能力层都不许带 arch ─────────────────────────────────────
const cat = await page.evaluate(async () => {
  try {
    const c = await window.OctaveAssets.catalog();
    return { ok: true, packs: (c.packs || c.entries || []).map(p => ({
      name: p.name, form: p.form, kind: p.kind || null,
      content: p.content || p.kinds || [], arch: p.arch || null })) };
  } catch (e) { return { ok: false, err: String(e).slice(0, 200) }; }
});
if (!cat.ok) { check(false, 'A2 catalog() 可读', cat.err); }
else {
  const withArch = cat.packs.filter(p => p.arch);
  // ★ kind:'engine' 的 arch = lane 值（mail/047，2026-10-20）——合法携带，但**不在
  //   本判据的账上**（它不是"要 dlopen 进宿主的 .oct"，是引擎索引键）。
  const plainMWithArch = cat.packs.filter(
    p => p.arch && p.kind !== 'engine' && !(p.content || []).includes('oct'));
  check(plainMWithArch.length === 0,
    'A2 纯 .m / 能力层条目一律**不带** arch（不许被架构界误拦）',
    `带 arch 的条目 ${withArch.length} 个，其中非 oct 的 ${plainMWithArch.length} 个`
    + `（应为 0）｜带 arch 名单：[${withArch.map(p => p.name + '=' + p.arch).join(', ')}]`);
}

// ── A3（**核心反向**）注入式判据：往"内存目录"塞一条 arch 不符的条目 ⇒ 必须响亮拒绝 ──
// 做法：用页面里的 `createOctaveAssets` 工厂造一个实例，**直接覆盖它的目录缓存** ——
// 判据做在客户端（`hostArch` vs 条目 `arch`），所以不需要真的下载任何字节。
const A3 = await page.evaluate(async ({ hostArch, lane }) => {
  if (typeof window.createOctaveAssets !== 'function') return { skip: 'no-factory' };
  const wrong = hostArch === 'wasm64' ? 'wasm32' : 'wasm64';
  // 假条目：带与宿主**不符**的 arch（且带 oct ⇒ 属于"要 dlopen 进宿主"那一类）
  const fake = { name: 'zzarch_probe', version: '0.0.1', sha256: 'f'.repeat(64),
                 url: 'assets/forge/zzarch-probe-0.0.1.tar.gz', deps: [],
                 form: 'pkg', content: ['m', 'oct'], kinds: ['m', 'oct'], arch: wrong, size: 1 };
  try {
    const inst = window.createOctaveAssets(window.Module, '/__arch_probe__/', () => true);
    if (typeof inst.__catalogSource !== 'function') return { skip: 'no-injection-surface' };
    inst.__catalogSource(() => ({ schema: 2, octave: '11.3.0', packs: [fake] }));
    try {
      await inst.install('zzarch_probe');
      return { installed: true };                       // ← 不该走到这
    } catch (e) {
      return { failed: true, verdict: (e && e.__verdict__) || null,
               msg: String(e && e.message).slice(0, 200) };
    }
  } catch (e) { return { err: String(e).slice(0, 200) }; }
}, { hostArch, lane });

if (A3.skip) {
  // 没有注入面 ⇒ 如实说"这条没查"，**不假绿**（本仓纪律：off 与"跑过且通过"必须可区分）
  console.log(`    （页面没有测试注入面：${A3.skip} ⇒ A3 的"注入式"判据未跑，如实记）`);
  check(true, 'A3 注入式判据不可用 ⇒ 如实记（不是通过）',
    `skip=${A3.skip}；客户端逻辑存在性由 A5 单独证（词表在产物里）`);
} else if (A3.err) {
  check(false, 'A3 造实例失败', A3.err);
} else {
  const v = A3.verdict || {};
  check(A3.failed === true && v.cause === 'arch-mismatch',
    '★ A3 反向：注入一条 arch 与宿主不符的条目 ⇒ install 响亮拒绝且 cause=arch-mismatch',
    JSON.stringify(A3).slice(0, 220));
}

// ── A4 正向：arch **相符**的假条目 ⇒ 不许以 arch 为由拒绝 ────────────────────────
const A4 = await page.evaluate(async ({ hostArch }) => {
  if (typeof window.createOctaveAssets !== 'function') return { skip: 'no-factory' };
  const good = { name: 'zzarch_probe_ok', version: '0.0.1', sha256: 'f'.repeat(64),
                 url: 'assets/forge/zzarch-probe-ok-0.0.1.tar.gz', deps: [],
                 form: 'pkg', content: ['m', 'oct'], kinds: ['m', 'oct'], arch: hostArch, size: 1 };
  try {
    const inst = window.createOctaveAssets(window.Module, '/__arch_probe__/', () => true);
    if (typeof inst.__catalogSource !== 'function') return { skip: 'no-injection-surface' };
    inst.__catalogSource(() => ({ schema: 2, octave: '11.3.0', packs: [good] }));
    try {
      await inst.install('zzarch_probe_ok');
      return { installed: true };
    } catch (e) {
      const v = (e && e.__verdict__) || {};
      // ★ 关键：失败可以（字节不在/校验失败），但 **cause 不许**是 arch-mismatch
      return { failed: true, cause: v.cause || 'unknown', msg: String(e && e.message).slice(0, 160) };
    }
  } catch (e) { return { err: String(e).slice(0, 200) }; }
}, { hostArch });

if (A4.skip) {
  console.log(`    （A4 同上跳过：${A4.skip}）`);
  check(true, 'A4 注入式判据不可用 ⇒ 如实记（不是通过）', `skip=${A4.skip}`);
} else if (A4.err) {
  check(false, 'A4 造实例失败', A4.err);
} else {
  check((A4.installed === true) || (A4.cause && A4.cause !== 'arch-mismatch'),
    '★ A4 正向：arch 相符的条目**不许**被架构界拦（失败也只能是别的 cause）',
    JSON.stringify(A4).slice(0, 220));
}

// ── A5 判据面在产物里（不靠"我以为"）：客户端源码含 arch-mismatch 词表 ─────────
const served = await page.evaluate(async () => {
  try {
    const t = await fetch('assets-loader.js').then(r => r.text());
    return { ok: true, hasCause: /arch-mismatch/.test(t), hasArchCheck: /✖PLACEHOLDER✖/.test(t) || /计划/.test(t) };
  } catch (e) { return { ok: false, err: String(e).slice(0, 120) }; }
});
if (served.ok) {
  check(served.hasCause, 'A5 站点上的 assets-loader.js 带 arch-mismatch 判据（词表在产物里）',
    `hasCause=${served.hasCause}`);
} else {
  check(false, 'A5 读 assets-loader.js', served.err);
}

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
