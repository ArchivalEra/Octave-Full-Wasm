// 探针：A2 最小实验（第三轮外部复审的三条判据）—— 收窄 `-sJSPI` 的机制边界
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 依据：`build/113/GPT-REVIEW-3-bridge-reply.md` §2 的三条可证伪判据：
//   判据1（预期**红**）：**没列进 JSPI_EXPORTS** 的同步导出直达挂起 import
//     ⇒ 抛 `SuspendError`（量化"漏标入口"的代价：不是优雅降级，是当场炸）。
//   判据2（预期**绿**）：dlopen 一个**带全局构造函数**（做与挂起无关的间接调用）的
//     side module ⇒ 不许炸；炸了 = VTK 案例复现 = binaryen 包了不该包的。
//   判据3（测"热身契约"）：promising 入口 → 同步 dlopen → promising 入口 交替，
//     看是否需要"先热身"才稳定（机制②是 V8 实现细节还是稳定行为）。
//
// 用法：node test/browser/probe-jspi-a2.mjs [产物目录]
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const DIR = process.argv[2] || '/mnt/hdd/octave-wasm-build/jspi-probe';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm' };

const server = createServer(async (req, res) => {
  const p = normalize(join(DIR, decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(normalize(DIR))) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(p);
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('nope'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL = `http://127.0.0.1:${server.address().port}/run.html`;

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });

let pass = 0, fail = 0;
const check = (ok, label, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 220)}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 开一个新页面（每组判据一条全新 wasm 实例 —— C1 的"炸"不能污染后面的测量）
async function freshPage () {
  const page = await (await browser.newContext()).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 300)));
  await page.goto(URL, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.Module && window.Module.asm !== undefined, null, { timeout: 120000 }).catch(() => {});
  await sleep(1200);
  return { page, errs };
}
const call = (page, fn, ...args) => page.evaluate(async ([f, a]) => {
  const t0 = performance.now();
  const before = window.Module.__tick || 0;
  let val, err = null, threw = null;
  try { val = await window.Module[f](...a); }
  catch (e) { err = String(e).slice(0, 200); threw = String(e).slice(0, 80); }
  const after = window.Module.__tick || 0;
  return { val, err, threw, wall: Math.round(performance.now() - t0), ticks: after - before,
           log: (window.__probeLog || []).slice(-4).join(' | ') };
}, [fn, args]);
const writeFs = (page, url, path) => page.evaluate(async ([u, p]) => {
  try {
    const buf = await (await fetch(u)).arrayBuffer();
    window.Module.FS.writeFile(p, new Uint8Array(buf));
    return window.Module.FS.readFile(p).length;
  } catch (e) { return 'ERR ' + String(e).slice(0, 120); }
}, [url, path]);

console.log(`URL=${URL}`);

// ── 判据 1（新页面、任何 promising 调用之前）：未标记入口直达挂起 import ──
{
  const { page } = await freshPage();
  const cap = await page.evaluate(() => ({
    suspending: typeof WebAssembly.Suspending === 'function',
    promising: typeof WebAssembly.promising === 'function',
    unmarked: typeof window.Module?._main_wait_unmarked === 'function',
    ctor: typeof window.Module?._run_ctor_unmarked === 'function',
  }));
  check(cap.suspending && cap.promising, 'JSPI API 在（Suspending/promising）', JSON.stringify(cap));
  check(cap.unmarked && cap.ctor, '两个**未标记**导出都在产物里（main_wait_unmarked / run_ctor_unmarked）', JSON.stringify(cap));
  if (!cap.suspending || !cap.promising) {
    console.log('SKIP | 环境无 JSPI API，未做判定'); console.log(`=== 0 PASS / 0 FAIL ===`);
    await browser.close(); server.close(); process.exit(2);
  }

  const c1 = await call(page, '_main_wait_unmarked', 100);
  console.log(`   判据1 未标记入口(100ms)：err=${c1.err} val=${c1.val} tick差=${c1.ticks}`);
  check(c1.err !== null && /SuspendError|promising/i.test(c1.err),
    '★ 判据1（预期红）：未列 JSPI_EXPORTS 的同步入口一调就抛 SuspendError —— "漏标=当场炸"实锤', c1.err || ('居然成功返回 ' + c1.val));
  check(c1.ticks === 0, '判据1 佐证：等待期间 tick=0（根本没挂起，直接抛）', c1.ticks);
  // 炸完之后运行期还活着吗（"代价"的另一维：能不能恢复）
  const rec = await call(page, '_main_wait', 100);
  check(rec.err === null && rec.val === 42 && rec.ticks > 0,
    '判据1 事后：被标记入口仍正常（SuspendError 没把运行期炸瘫）', `val=${rec.val} err=${rec.err} ticks=${rec.ticks}`);
  await page.close();
}

// ── 判据 2 + 3：全新页面。顺序刻意安排成"C2 先于任何成功的 promising 调用" ──
{
  const { page } = await freshPage();
  const n1 = await writeFs(page, 'side_ctor.wasm', '/side_ctor.wasm');
  check(typeof n1 === 'number' && n1 > 0, 'side_ctor.wasm 写进 MEMFS', n1);
  const n2 = await writeFs(page, 'side.wasm', '/side.wasm');
  check(typeof n2 === 'number' && n2 > 0, 'side.wasm 写进 MEMFS', n2);

  // 判据 2：**任何 promising 调用之前**，未标记同步入口 dlopen 带构造函数的 side module
  const c2 = await call(page, '_run_ctor_unmarked');
  console.log(`   判据2 无热身+未标记 dlopen(ctor)：val=${c2.val} err=${c2.err} | wasm: ${c2.log}`);
  check(c2.err === null && c2.val === 7,
    '★ 判据2（预期绿）：**没有任何 promising 热身**时，未标记同步 dlopen（含构造函数间接调用）照常工作',
    `val=${c2.val} err=${c2.err || '(无)'}`);

  // 判据 3：promising → 同步 dlopen → promising 交替三轮，不许需要任何"热身仪式"
  let seqOk = true, seqDetail = [];
  for (let i = 1; i <= 3; i++) {
    const w = await call(page, '_main_wait', 80);
    const d = await call(page, '_run_ctor_unmarked');
    const s = await call(page, '_run_side', 80);
    const okRow = w.err === null && w.val === 42 && w.ticks > 0 && d.err === null && d.val === 7
                  && s.err === null && s.val === 43 && s.ticks > 0;
    seqOk = seqOk && okRow;
    seqDetail.push(`#${i} wait=${w.val}/${w.ticks}ctor=${d.val} side=${s.val}/${s.ticks}${s.err ? ' err=' + s.err : ''}`);
  }
  check(seqOk, '★ 判据3：promising↔同步dlopen 交替三轮全稳（机制②的"热身"在收窄口径下**不需要依赖**）', seqDetail.join(' | '));
  await page.close();
}

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
console.log('（判据1 红 = JSPI 穷举语义实锤；判据2/3 绿 = 收窄口径下 dlopen 不需热身、不误伤）');
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
