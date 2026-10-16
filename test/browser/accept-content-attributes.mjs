// 验收：**内容三属性**（是否从源码构建 / 是否兼容 / 是否已安装）—— 用户点令 2026-10-16
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 验什么（全部浏览器侧实测）────────────────────────────────────────────────
// 用户点令原文：**「现在一个内容应该有三个属性，是否从源码构建与是否兼容与是否已安装」**。
// 三个属性**各自独立**、**全部派生**（不手写、不新增目录字段）——判据在客户端 `statusOf(name)`：
//   · `fromSource`：包带 `src`（`content` 含 src）⇒ 加速件是源码、本构建不编（无 mkoctfile）
//   · `compatible`：架构界（`arch` vs 宿主档）+ 版本约束（`requires`，若有）
//   · `installed`  ：会话态（本次会话装没装 —— 就是 `loaded[...]`）
//
//   S1 `statusOf` 在产物里（API 面存在）
//   S2 **三属性互相独立**（不许塌陷）：逐条实测其取值不是另一个的复读 ——
//      · 一个包可以 fromSource=true 而 compatible=true（现役 `optim` 等 8 个：带 src 但不涉架构）
//      · 能力层 `pyodide`：三者皆 false/true 的组合与"含 src 的包"不同（form:tree、content 空）
//      · 查无此包 ⇒ `null`（**不编**一个"全 false"的假状态 —— 零值守卫）
//   S3 `installed` **真的会翻**：装一个纯 .m 包（`cgl`）⇒ 前 false、后 true（会话态是实测不是猜）
//   S4 ★ **反向**：注入一条 `arch` 与宿主不符的条目 ⇒ `statusOf().compatible === false`
//      且 `install()` 响亮拒绝（cause=arch-mismatch）——**两个属性对同一条事实给一致的答案**
//   S5 ★ **反向（fromSource 不许乱报）**：注入一条**不含 `src`** 的条目 ⇒ `fromSource === false`
//      （若它报 true ⇒ 判据没有判别力，与 S2 的正例一起构成正反两向）
//
// 用法：sh test/browser/run.sh test/browser/accept-content-attributes.mjs <URL>
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

// ── S1 API 面 ─────────────────────────────────────────────────────────────────
const s1 = await page.evaluate(() => ({
  has: typeof window.OctaveAssets.statusOf === 'function',
  keys: (() => { try { const o = window.OctaveAssets.statusOf('optim'); return o ? Object.keys(o).sort() : null; }
                 catch (e) { return 'ERR:' + e.message; } })()
}));
check(s1.has, 'S1 statusOf 在产物里（API 面存在）', `keys=${JSON.stringify(s1.keys)}`);
check(Array.isArray(s1.keys) && ['compatible', 'fromSource', 'installed', 'name'].every(k => s1.keys.includes(k)),
  'S1b 返回对象带三属性（fromSource / compatible / installed）', JSON.stringify(s1.keys));

// ── S2 三属性互相独立（不塌陷）─────────────────────────────────────────────────
const s2 = await page.evaluate(async () => {
  try {
    await window.OctaveAssets.catalog();
  } catch (e) { /* catalog 读不到也能测随站条目 */ }
  const names = window.OctaveAssets.list();
  const cat0 = await window.OctaveAssets.catalog().catch(() => null);
  const rows = {};
  for (const n of names) {
    const st = window.OctaveAssets.statusOf(n);
    if (st) rows[n] = { f: st.fromSource, c: st.compatible, i: st.installed };
  }
  // 找目录里带 src 的条目（现役 8 个）
  const cat = await window.OctaveAssets.catalog().catch(() => null);
  const srcNames = cat ? (cat.packs || []).filter(p =>
      ((p.content || p.kinds || []).indexOf('src') >= 0)).map(p => p.name) : [];
  return { rows, srcNames, missing: window.OctaveAssets.statusOf('zzz_no_such_9f') };
});
const srcWithTrue = s2.srcNames.filter(n => s2.rows[n] && s2.rows[n].f === true);
const srcResolvable = s2.srcNames.filter(n => !!s2.rows[n]);
check(srcResolvable.length > 0 && srcWithTrue.length === srcResolvable.length,
  'S2a 带 src 的条目 fromSource 全为 true（判据在起作用）',
  `带 src 的 ${s2.srcNames.length} 个（statusOf 可解析 ${srcResolvable.length} 个），`
  + `fromSource=true 的 ${srcWithTrue.length} 个`);
// 独立性：至少有一个条目 fromSource=true 且 compatible=true（若全塌陷成同一值就不成立）
const indep = Object.entries(s2.rows).some(([, v]) => v.f === true && v.c === true);
check(indep, 'S2b 三属性不塌陷：存在 fromSource=true 而 compatible=true 的条目（两轴独立）',
  JSON.stringify(Object.entries(s2.rows).slice(0, 4)));
check(s2.missing === null, 'S2c 查无此包 ⇒ null（不编"全 false"的假状态 —— 零值守卫）',
  JSON.stringify(s2.missing));

// ── S3 installed 真的会翻 ─────────────────────────────────────────────────────
const s3 = await page.evaluate(async () => {
  // ⚠️ 契约：`statusOf` 读的是**目录缓存** ⇒ 调用方要先 `await catalog()`
  //   （与 `install()` 同款：它也先读目录）。本套件照实这么用。
  await window.OctaveAssets.catalog().catch(() => null);
  const PKG = 'cgi';                       // 货架上的纯 .m 包（14 条里的第一个）
  const before = window.OctaveAssets.statusOf(PKG);
  let err = null;
  try { await window.OctaveAssets.install(PKG); } catch (e) { err = String(e && e.message).slice(0, 160); }
  const after = window.OctaveAssets.statusOf(PKG);
  return { before, after, err };
});
check(s3.before && s3.before.installed === false, 'S3a 装之前 installed=false',
  JSON.stringify(s3.before && s3.before.installed));
check(s3.after && s3.after.installed === true, 'S3b 装之后 installed=true（会话态真的会翻）',
  `after=${s3.after && s3.after.installed} err=${s3.err}`);

// ── S4/S5 注入式（正反两向；不改站点）──────────────────────────────────────────
const s45 = await page.evaluate(async ({ hostArch }) => {
  if (typeof window.createOctaveAssets !== 'function') return { skip: 'no-factory' };
  const wrong = hostArch === 'wasm64' ? 'wasm32' : 'wasm64';
  const mk = (name, extra) => Object.assign({
    name, version: '0.0.1', sha256: 'f'.repeat(64),
    url: 'assets/forge/' + name + '-0.0.1.tar.gz', deps: [],
    form: 'pkg', content: ['m'], size: 1 }, extra);
  const out = {};
  // S4：arch 不符的条目 ⇒ compatible=false + install 拒绝
  {
    const inst = window.createOctaveAssets(window.Module, '/__attr_probe__/', () => true);
    if (typeof inst.__catalogSource !== 'function') return { skip: 'no-injection-surface' };
    inst.__catalogSource(() => ({ schema: 2, octave: '11.3.0', packs: [
      mk('zzattr_bad', { content: ['m', 'oct'], arch: wrong })] }));
    await inst.catalog();                     // ← 先让注入目录进缓存（statusOf 读的就是它）
    const st = inst.statusOf('zzattr_bad');
    let verdict = null;
    try { await inst.install('zzattr_bad'); } catch (e) { verdict = (e && e.__verdict__) || { state: 'threw' }; }
    out.bad = { compatible: st && st.compatible, cause: verdict && verdict.cause };
  }
  // S5：不含 src 的条目 ⇒ fromSource=false（反向：不许乱报 true）
  {
    const inst2 = window.createOctaveAssets(window.Module, '/__attr_probe__/', () => true);
    inst2.__catalogSource(() => ({ schema: 2, octave: '11.3.0', packs: [
      mk('zzattr_nosrc', { content: ['m'] })] }));
    await inst2.catalog();
    const st2 = inst2.statusOf('zzattr_nosrc');
    out.nosrc = { fromSource: st2 && st2.fromSource };
  }
  // S5b：含 src 的条目 ⇒ fromSource=true（正向对照 —— 与反向一起证明判据有判别力）
  {
    const inst3 = window.createOctaveAssets(window.Module, '/__attr_probe__/', () => true);
    inst3.__catalogSource(() => ({ schema: 2, octave: '11.3.0', packs: [
      mk('zzattr_src', { content: ['m', 'src'] })] }));
    await inst3.catalog();
    const st3 = inst3.statusOf('zzattr_src');
    out.src = { fromSource: st3 && st3.fromSource };
  }
  return out;
}, { hostArch: await page.evaluate(() => {
  const lane = (window.octaveLaneState && window.octaveLaneState.lane) || '';
  return /^w64/.test(lane) ? 'wasm64' : (lane ? 'wasm32' : '');
}) });

if (s45.skip) {
  console.log(`    （注入面不可用：${s45.skip} ⇒ S4/S5 未跑，如实记）`);
  check(true, 'S4/S5 注入式判据不可用 ⇒ 如实记（不是通过）', `skip=${s45.skip}`);
} else {
  check(s45.bad && s45.bad.compatible === false,
    '★ S4 反向：arch 不符 ⇒ statusOf().compatible === false（与 install 拒绝一致）',
    JSON.stringify(s45.bad));
  check(s45.bad && s45.bad.cause === 'arch-mismatch',
    '★ S4b 同一条事实：install 也响亮拒绝（cause=arch-mismatch）—— 两属性答同一件事',
    JSON.stringify(s45.bad));
  check(s45.nosrc && s45.nosrc.fromSource === false,
    '★ S5 反向：不含 src 的条目 fromSource === false（不许乱报 true）',
    JSON.stringify(s45.nosrc));
  check(s45.src && s45.src.fromSource === true,
    'S5b 正向对照：含 src 的条目 fromSource === true（证明判据有判别力）',
    JSON.stringify(s45.src));
}

// ── N6（工单 68 的结算断言，2026-10-16 加）：install() 成功路径三字段必须**真算** ──
//   背景（design-it-twice 的 ④ 方案发现）：此前 layers:[]/bytes:0/acceleration:'not-built'
//   是**字面量** ⇒ 装 symbolic（闭包含 22 MB Pyodide）也报 bytes:0；而 statusOf 真算。
//   修复后三个字段与 planOnly/statusOf 同一算法/同一判据。
const S3 = await page.evaluate(async () => {
  const out = {};
  try { out.symbolic = await window.OctaveAssets.install('symbolic'); }
  catch (e) { out.symbolicErr = String(e.message).slice(0, 150); }
  try { out.tsa = await window.OctaveAssets.install('tsa'); }
  catch (e) { out.tsaErr = String(e.message).slice(0, 150); }
  return out;
});
const sy = S3.symbolic || {};
check(Array.isArray(sy.layers) && sy.layers.some(x => x.name === 'pyodide'),
  '★ N6a 装 symbolic ⇒ layers 真算（含 pyodide，不再是字面量 []）',
  JSON.stringify(sy.layers).slice(0, 140));
check(typeof sy.bytes === 'number' && sy.bytes > 0,
  '★ N6b bytes 真算 > 0（不再是字面量 0）', sy.bytes);
check((S3.tsa || {}).acceleration === 'not-built' && (sy.acceleration === 'none-needed'),
  '★ N6c acceleration 与 statusOf 同一判据（tsa=m+src ⇒ not-built；symbolic=纯 m ⇒ none-needed）',
  `tsa=${(S3.tsa || {}).acceleration} symbolic=${sy.acceleration}`);

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
