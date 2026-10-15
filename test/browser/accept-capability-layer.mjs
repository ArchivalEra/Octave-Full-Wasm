// 验收：**能力层进图**（接缝 §5 第④步）—— symbolic 靠 deps 边拉到 Pyodide
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 验什么（全部浏览器侧实测）────────────────────────────────────────────────
//   §5④ 的判据（设计稿原文）：**"能力层接进同一张图：Pyodide 供给 + 一条 form:"tree" 条目
//   ⇒ `install('symbolic')` 走通"**。本套件把那句话拆成可证伪的条目：
//     L1 目录里**有**能力层条目：`pyodide`，`form:"tree"`，`content:[]`（裁决①），有 `consumer`
//     L2 `symbolic` 的 `deps` **边指向它**（§2 的落法：不加 needs 字段）
//     L3 **闭包正确**：`install('symbolic')` 的实际装载序列里**先 pyodide 后 symbolic**
//     L4 能力层真就位：`OctaveAssets.layers().pyodide.ready === true`（装载器记账）
//     L5 端到端不报错 + Verdict 四态仍成立（`state:'ok'`）
//   ⚠️ **诚实边界**（本批范围）：**"Octave 的 symbolic 包调用 Python"** 是 IPC 缝的活
//      （`.m` 侧 `python_ipc_*` 那条），**不在本套件判据内** —— 本套件只验"能力层进了图、
//      被正确拉取、且不破坏既有装包路径"。symbolic 真跑 `diff(sin(x),x)` 属下一批。
//
// 用法：sh test/browser/run.sh test/browser/accept-capability-layer.mjs <URL>
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
const net = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
page.on('request', r => net.push(r.url()));
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 210)}`);
};

await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
await page.waitForFunction(() => window.__octaveReady === true, null, { timeout: 300000 })
  .catch(() => {});
await sleep(1500);
console.log(`URL=${URL}`);

const hasApi = await page.evaluate(() => typeof window.OctaveAssets === 'object'
  && typeof window.OctaveAssets.install === 'function');
if (!hasApi) { console.log('ENV: 页面没起来 ⇒ rc=3'); await browser.close(); process.exit(3); }

// ── L1 目录里能力层条目形状正确 ──
const l1 = await page.evaluate(async () => {
  const cat = await window.OctaveAssets.catalog();
  const py = (cat.packs || []).find(p => p.name === 'pyodide');
  return py ? { form: py.form, content: py.content, consumer: py.consumer, size: py.size,
                url: py.url } : null;
});
check(!!l1, 'L1a 目录里有能力层条目 pyodide', JSON.stringify(l1).slice(0, 160));
check(!!l1 && l1.form === 'tree', 'L1b pyodide 的 form=tree（能力层形态）', l1 && l1.form);
check(!!l1 && Array.isArray(l1.content) && l1.content.length === 0,
  'L1c 能力层 content 为空（裁决①）', l1 && JSON.stringify(l1.content));
check(!!l1 && Array.isArray(l1.consumer) && l1.consumer.includes('octave'),
  'L1d 能力层声明 consumer（裁决②）', l1 && JSON.stringify(l1.consumer));
check(!!l1 && l1.size > 1000000, 'L1e 能力层字节规模合理（>1MB —— 真运行时不可能是空的）',
  l1 && `${(l1.size / 1048576).toFixed(1)} MB`);

// ── L2 symbolic 的 deps 边指向它（§2 落法：不加 needs 字段）──
const l2 = await page.evaluate(async () => {
  const cat = await window.OctaveAssets.catalog();
  const sy = (cat.packs || []).find(p => p.name === 'symbolic');
  return sy ? { deps: sy.deps, hasNeeds: 'needs' in sy, kinds: sy.kinds } : null;
});
check(!!l2 && Array.isArray(l2.deps) && l2.deps.includes('pyodide'),
  'L2a symbolic 的 deps 边指向 pyodide（§2 落法）', l2 && JSON.stringify(l2.deps));
check(!!l2 && l2.hasNeeds === false,
  '★ L2b 反向：symbolic **没有** needs 字段（§2 判决：不加新字段）', l2 && `needs=${l2.hasNeeds}`);

// ── L3 装载序列：先 pyodide 后 symbolic ──
const l3 = await page.evaluate(async () => {
  const seq = [];
  try {
    const r = await window.OctaveAssets.install('symbolic', {
      onProgress: e => { if (e.phase === 'installed') seq.push(e.name); }
    });
    return { ok: true, seq, state: r.state, installed: r.installed };
  } catch (e) {
    return { ok: false, err: String(e && e.message ? e.message : e).slice(0, 220),
             verdict: (e && e.__verdict__) || null, seq };
  }
});
check(l3.ok, 'L5a install(symbolic) 走通（不报错）', JSON.stringify(l3).slice(0, 240));
check(l3.seq && l3.seq.indexOf('pyodide') >= 0 && l3.seq.indexOf('symbolic') >= 0
  && l3.seq.indexOf('pyodide') < l3.seq.indexOf('symbolic'),
  'L3 装载序列先 pyodide 后 symbolic（闭包拓扑序）', JSON.stringify(l3.seq));
check(l3.ok && l3.state === 'ok', 'L5b Verdict 四态仍成立（state=ok）', l3.state || '');

// ── L4 能力层真就位（装载器记账）──
const l4 = await page.evaluate(() => {
  const f = window.OctaveAssets.layers;
  if (typeof f !== 'function') return { noApi: true };
  const L = f();
  return { keys: Object.keys(L), py: L.pyodide || null };
});
check(!l4.noApi && l4.py && l4.py.ready === true,
  'L4 能力层就位（layers().pyodide.ready）',
  l4.noApi ? '（缺 layers() API）' : JSON.stringify(l4).slice(0, 180));

// ── 反向：能力层的字节没请求过 tarball 解包路径（它不该走 __forge_install__）──
const forgeTar = net.filter(u => /assets\/forge\/pyodide.*\.tar\.gz/.test(u));
check(forgeTar.length === 0,
  '★ 反向：能力层**没有**被当成包去拉 tarball（不误入 __forge_install__ 路径）',
  `tarball 请求 ${forgeTar.length} 条`);

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
