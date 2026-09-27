// 探针：R5 —— `-fwasm-exceptions` + `-sJSPI` + `MAIN_MODULE=2` + `SIDE_MODULE`/dlopen
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：node test/browser/probe-jspi.mjs [产物目录]
//       产物目录由 `build/113/probe-jspi.sh`（容器内）产出，默认 /mnt/hdd/octave-wasm-build/jspi-probe
//
// ── 这条探针的性质 ───────────────────────────────────────────────────────────
// **它是能力闸门，不是产品功能**：外部审核对 R5 的判定是"JSPI 本身成熟，
// 但 JSPI + MAIN_MODULE=2 + SIDE_MODULE/dlopen 没有公开先例 ⇒ 必须自证"。
// 所以本探针只用极小的 C/JS（build/113/probe-jspi/），不碰 Octave 源码。
// 判据两条，缺一不可：
//   ① 墙上时间 ≥ 请求的毫秒数（真的等到了）；
//   ② **等待期间 JS 的 tick 计数增加**（`setTimeout` 落地了一次）—— 这条才是"让出了事件
//      循环"的证据；busy-loop 会让 ① 成立而 ② 为 0。
// 输出是**如实的能力报告**：通过就说通过（附实测数字），不通过就说清楚炸在哪一层。
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

// sweep 会把被测站 URL 传进来；本探针自 host **产物目录**（run.html），URL 参数不适用 ⇒ 忽略之
// ★ F4：输入契约在 `test/browser/manifest.json` 的 `inputs` 里声明；环境变量
//    `PROBE_DIR` 可覆盖路径（两处口径必须一致 —— 清单声明的就是探针读的这个）。
const DIR = process.env.PROBE_DIR || ((process.argv[2] && !/^http/.test(process.argv[2])) ? process.argv[2] : '/mnt/hdd/octave-wasm-build/jspi-probe');
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
console.log(`URL=${URL}  产物目录=${DIR}`);

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e).slice(0, 300)));
page.on('console', m => { if (m.type() === 'error') errs.push('[console.error] ' + m.text().slice(0, 300)); });
await page.goto(URL, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => typeof window.Module === 'object' && window.Module.asm !== undefined || window.__probeReady, null, { timeout: 120000 }).catch(() => {});
await new Promise(r => setTimeout(r, 1500));

let pass = 0, fail = 0;
const check = (ok, label, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 200)}`); };

// 能力检测（外部审核点名的方式：**看 API，不看 UA**）
const cap = await page.evaluate(() => ({
  suspending: typeof WebAssembly.Suspending === 'function',
  promising: typeof WebAssembly.promising === 'function',
  ua: navigator.userAgent.slice(0, 60),
  hasModule: typeof window.Module === 'object',
  hasMainWait: typeof window.Module?._main_wait === 'function',
  hasRunSide: typeof window.Module?._run_side === 'function',
  logs: (window.__probeLog || []).join(' | ').slice(0, 300),
}));
console.log(`   chromium: ${cap.ua}`);
console.log(`   WebAssembly.Suspending=${cap.suspending} promising=${cap.promising}`);
console.log(`   Module: ${cap.hasModule} _main_wait=${cap.hasMainWait} _run_side=${cap.hasRunSide}`);
if (cap.logs) console.log(`   wasm 输出: ${cap.logs}`);

if (!cap.suspending || !cap.promising) {
  console.log('SKIP | 该浏览器没有 JSPI 的 JS API（WebAssembly.Suspending/promising）—— 探针无意义');
  console.log(`\n=== 0 PASS / 0 FAIL（环境不支持 JSPI，未做判定）===`);
  await browser.close(); server.close(); process.exit(2);
}
check(cap.hasMainWait && cap.hasRunSide, '主模块导出了 main_wait / run_side（-sJSPI 产物能加载）', JSON.stringify(cap).slice(0, 150));

const runCase = (code, ms = 40000) => page.evaluate(async (c) => {
  const t0 = performance.now();
  const before = window.Module.__tick || 0;
  let val, err = null;
  try {
    // ⚠️ JSPI 下这个导出返回的是 **Promise**（`-sJSPI_EXPORTS` 把它包成了 promising）
    val = await window.Module[c.fn](...c.args);
  } catch (e) { err = String(e).slice(0, 200); }
  const t2 = performance.now();
  const after = window.Module.__tick || 0;
  return { val, err, wall: Math.round(t2 - t0), ticks: after - before, tickAtCall: window.Module.__tickAtCall, after };
}, code);

// ① 主模块 helper（将来 pause() 的形态）
let r = await runCase({ fn: '_main_wait', args: [200] });
console.log(`   ① main_wait(200): 返回=${r.val} 墙上=${r.wall}ms tick差=${r.ticks} err=${r.err}`);
check(r.err === null, '① 主模块 helper 的挂起调用没抛异常', r.err || '(无)');
check(r.val === 42, '① 返回值正确（42）', r.val);
check(r.wall >= 200, '① 墙上时间 ≥ 200ms（真的等了）', `${r.wall}ms`);
check(r.ticks > 0, '★ ① 等待期间 JS 事件循环**在跑**（tick 增加 > 0）—— busy-loop 会是 0', `tick差=${r.ticks}`);

// ② 完整链：dlopen side module → dlsym → C 里调用 → 回调主模块 helper → 挂起
const wrote = await page.evaluate(async () => {
  try {
    const buf = await (await fetch('side.wasm')).arrayBuffer();
    window.Module.FS.writeFile('/side.wasm', new Uint8Array(buf));
    return window.Module.FS.readFile('/side.wasm').length;
  } catch (e) { return 'ERR ' + String(e).slice(0, 120); }
});
console.log(`   写入 /side.wasm: ${wrote} 字节`);
check(typeof wrote === 'number' && wrote > 0, 'side.wasm 能写进 MEMFS（dlopen 的前置）', wrote);

r = await runCase({ fn: '_run_side', args: [200] });   // 路径在 C 里写死：见 main.c 的注释（JSPI 边界不传字符串）
console.log(`   ② run_side(200): 返回=${r.val} 墙上=${r.wall}ms tick差=${r.ticks} err=${r.err}`);
// ★ 失败时必须把 wasm 侧的原话打出来（dlerror 的文本是唯一能说清"卡在哪一步"的东西）
const wasmLog = await page.evaluate(() => (window.__probeLog || []).slice(-6).join(' | '));
console.log(`   wasm 里说：${wasmLog}`);
// ⚠️ 这条**不能**只断言"没抛异常"：dlsym 失败时 run_side 会安静地返回 -2
//    （第一版就是这么假过的）⇒ 必须同时断言返回值。
check(r.err === null && r.val === 43,
  '② ★ 完整链（dlopen→dlsym→side→主模块 helper）走通且返回值正确（42 + 1 = 43）',
  `val=${r.val} err=${r.err || '(无)'}`);
check(r.wall >= 200, '② 墙上时间 ≥ 200ms', `${r.wall}ms`);
check(r.ticks > 0, '★ ② side module 那条链上**同样**让出了事件循环（tick 增加 > 0）', `tick差=${r.ticks}`);

// ③ 反证：同一件事在**不支持挂起**的普通导出上必须失败
//     （防"其实根本没挂起、只是普通同步调用"的假过）
const bad = await page.evaluate(async () => {
  try {
    const v = await window.Module._main_wait_not_jspi(100);   // 不存在 ⇒ 应当抛
    return 'unexpected ' + v;
  } catch (e) { return 'threw: ' + String(e).slice(0, 80); }
});
console.log(`   ③ 反证（不存在的普通导出）：${bad}`);

if (errs.length) console.log('   ⚠️ 页面报错：' + errs.slice(0, 3).join(' // '));
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
console.log('（判据：墙上时间达标 **且** 等待期间 tick 增加 —— 后者才是"让出事件循环"的证据）');
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
