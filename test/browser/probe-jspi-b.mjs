// 探针：B 方案（手搓 JSPI）—— 与 A2 同一份 C 代码，唯一变量 = 包装方式
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 依据：A2 实验的根因发现（5.0.7 `-sJSPI` ⇒ dlopen 无条件是挂起点，
// 见 NOTES-jspi「A2 最小实验」）+ 第三轮复审 §3 的 B 判据。
// B = 不加 `-sJSPI`：run-b.html 的 instantiateWasm 钩子把 **唯一** 挂起 import
// （browser_wait_ms）包成 `WebAssembly.Suspending`，入口由页面按需 `WebAssembly.promising`。
// 预期矩阵（与 A2 对照）：
//   plain 栈 dlopen 新模块        → **绿**（A2 是红 —— 这是 B 的决定性优势）
//   promising 入口挂起            → 绿（42/tick>0；43/tick>0 跨模块）
//   任意导出都能 promising 化      → 绿（"漏标"问题消失：不需要 JSPI_EXPORTS 名单）
//   没包 promising 的入口碰挂起点  → 红（穷举语义不变，但由页面自己控制）
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

// ★ F4：输入契约在 `test/browser/manifest.json` 的 `inputs` 里声明；环境变量
//    `PROBE_DIR` 可覆盖路径（两处口径必须一致 —— 清单声明的就是探针读的这个）。
const DIR = process.env.PROBE_DIR || ((process.argv[2] && !/^http/.test(process.argv[2])) ? process.argv[2] : '/mnt/hdd/octave-wasm-build/jspi-probe-b');
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
const URL = `http://127.0.0.1:${server.address().port}/run-b.html`;

let pass = 0, fail = 0;
const check = (ok, label, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 220)}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const br = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await br.newContext()).newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e).slice(0, 300)));
await page.goto(URL, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.Module && window.Module.asm !== undefined, null, { timeout: 60000 }).catch(() => {});
await sleep(1200);

const call = async (jsBody, label) => {
  // ★ 每次调用 10s 硬超时（挂起类调用的"永不 settle"本身就是数据点）
  const inner = page.evaluate(async (code) => {
    const t0 = performance.now();
    const before = window.Module.__tick || 0;
    let val, err = null;
    try { val = await eval(code); } catch (e) { err = String(e).slice(0, 200); }
    return { val, err, wall: Math.round(performance.now() - t0), ticks: (window.Module.__tick || 0) - before,
             log: (window.__probeLog || []).slice(-3).join(' | ') };
  }, jsBody);
  const guard = new Promise(res => setTimeout(() => res({ val: null, err: 'HARD-TIMEOUT-10s', wall: 10000, ticks: -1, log: '' }), 10000));
  const r = await Promise.race([inner, guard]);
  console.log(`   ${label}：val=${r.val} err=${r.err || '(无)'} tick差=${r.ticks} 墙上=${r.wall}ms`);
  return r;
};

// ── 前置：能力与产物形状 ──
const cap = await page.evaluate(() => ({
  suspending: typeof WebAssembly.Suspending === 'function',
  promising: typeof WebAssembly.promising === 'function',
  ctor: typeof window.Module?._run_ctor_unmarked === 'function',
  hook: !!window.Module?.wasmBinary,
}));
check(cap.suspending && cap.promising, 'JSPI API 在（Suspending/promising）', JSON.stringify(cap));
check(cap.ctor, '未标记导出在产物里（B 下无所谓标记不标记 —— 页面说了算）', cap.ctor);

// 页面侧把"可能挂起的入口"逐个 promising 化（B 的用法：名单在页面，不在链接行）
await page.evaluate(() => {
  const M = window.Module;
  window.pmain_wait = WebAssembly.promising(M._main_wait);
  window.pmain_wait_unmarked = WebAssembly.promising(M._main_wait_unmarked);
  window.prun_side = WebAssembly.promising(M._run_side);
  window.prun_ctor = WebAssembly.promising(M._run_ctor_unmarked);
  window.promising = WebAssembly.promising;
  return true;
});
check(true, '页面侧 promising 化 4 个入口（main_wait / main_wait_unmarked / run_side / run_ctor_unmarked）', 'WebAssembly.promising 直接可用');

// 写 side module
for (const [u, p] of [['side.wasm', '/side.wasm'], ['side_ctor.wasm', '/side_ctor.wasm']]) {
  const n = await page.evaluate(async ([uu, pp]) => {
    try { const b = await (await fetch(uu)).arrayBuffer(); Module.FS.writeFile(pp, new Uint8Array(b)); return Module.FS.readFile(pp).length; }
    catch (e) { return 'ERR ' + String(e).slice(0, 100); }
  }, [u, p]);
  check(typeof n === 'number' && n > 0, `${p} 写进 MEMFS`, n);
}

// ── B1（决定性对照）：**plain 栈** dlopen 新模块 —— A2 在这里是红 ──
const b1 = await call(`Module._run_ctor_unmarked()`, 'B1 plain栈 dlopen 新模块(ctor)');
check(b1.err === null && b1.val === 7,
  '★ B1（预期绿，A2 实测红）：**不加 -sJSPI ⇒ dlopen 不是挂起点** —— plain 栈装载带构造函数的新模块照常工作',
  `val=${b1.val} err=${b1.err || '(无)'}`);

// ── B2：promising 入口挂起（主模块 helper）──
const b2 = await call(`window.pmain_wait(100)`, 'B2 promising(main_wait)(100)');
check(b2.err === null && b2.val === 42 && b2.ticks > 0 && b2.wall >= 100,
  '★ B2：钩子包的 Suspending import + 页面包的 promising ⇒ 挂起/恢复真成立（42，tick>0）',
  `val=${b2.val} ticks=${b2.ticks} err=${b2.err}`);

// ── B3：**任意**导出都能 promising 化（"漏标"问题消失）──
const b3 = await call(`window.pmain_wait_unmarked(100)`, 'B3 promising(main_wait_unmarked)(100)');
check(b3.err === null && b3.val === 43 && b3.ticks > 0,
  '★ B3：不需要 JSPI_EXPORTS 名单 —— 任何导出由页面按需 promising（A2 判据1 的"漏标=当场炸"在 B 下变成"想包谁就包谁"）',
  `val=${b3.val} ticks=${b3.ticks} err=${b3.err}`);

// ── B4：完整链（dlopen→dlsym→side→主模块→挂起）──
const b4 = await call(`window.prun_side(200)`, 'B4 promising(run_side)(200)');
check(b4.err === null && b4.val === 43 && b4.ticks > 0 && b4.wall >= 200,
  '★ B4：完整跨模块链在 B 下成立（43 = 42+1，等待期间 tick>0）',
  `val=${b4.val} ticks=${b4.ticks} err=${b4.err}`);

// ── B5：promising 栈 dlopen 新模块（带构造函数）──
const b5 = await call(`window.prun_ctor()`, 'B5 promising(run_ctor)(新模块)');
check(b5.err === null && b5.val === 7, '★ B5：promising 栈 dlopen 新模块照常（与 A2 补测A 同绿）', `val=${b5.val} err=${b5.err}`);

// ── B6（反证）：没包 promising 的入口碰挂起点必须炸 ──
const b6 = await call(`Module._main_wait(50)`, 'B6 反证：未 promising 的 _main_wait 直调');
check(b6.err !== null && /SuspendError|promising/i.test(b6.err),
  '★ B6（预期红）：直调未包装入口照样抛 SuspendError —— 穷举语义不变，但名单在页面手里',
  b6.err || ('居然成功 ' + b6.val));
const alive = await call(`window.pmain_wait(50)`, 'B6 事后：promising 入口仍正常');
check(alive.err === null && alive.val === 42, 'B6 事后运行期存活（与 A2 判据1 事后一致）', `val=${alive.val}`);

// ── B7：交替三轮（sync dlopen ↔ promising），应当全绿无热身依赖 ──
let seqOk = true; const seqDetail = [];
for (let i = 1; i <= 3; i++) {
  const d = await call(`Module._run_ctor_unmarked()`, `B7#${i} sync dlopen`);
  const w = await call(`window.prun_side(60)`, `B7#${i} promising 链`);
  const okRow = d.err === null && d.val === 7 && w.err === null && w.val === 43 && w.ticks > 0;
  seqOk = seqOk && okRow;
  seqDetail.push(`#${i} ctor=${d.val} side=${w.val}/${w.ticks}${w.err ? ' err=' + w.err : ''}`);
}
check(seqOk, '★ B7：sync dlopen ↔ promising 交替三轮全绿 —— **无需热身、无需全异步开机**', seqDetail.join(' | '));

if (errs.length) console.log('   ⚠️ 页面报错：' + errs.slice(0, 3).join(' // '));
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await br.close(); server.close();
process.exit(fail ? 1 : 0);
