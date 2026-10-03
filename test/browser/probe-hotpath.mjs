// 探针：hotpath 的浏览器那一步 —— CDP Profiler 采样（工单 54）
// Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
//
// 由 build/113/hotpath.py 的 sample() 编排调用；读环境拿输入、写 raw.json 给它符号化。
//   HOTPATH_DIR     实验站目录（symbols() 组好的四格站，w64/ 是 diag 符号产物）
//   HOTPATH_PORT    站点端口（≠8761/8768）
//   HOTPATH_SNIPPET 要剖析的 Octave 片段
//   HOTPATH_SECONDS 采样墙钟上限（片段更快就提前停）
//   HOTPATH_OUT     raw.json 输出路径
//
// 关键纪律（照 AGENTS）：
//   · 站点必须**带头**（serve-coi.py）—— 否则页面落回 base 档，采的不是 w64。
//   · **两段式就绪**：先等 __octaveReady，再碰 feval（工单 40 的坑）。
//   · 只写实验站（hotpath.py 已校验）；本探针不自选端口。
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DIR = process.env.HOTPATH_DIR;
const PORT = Number(process.env.HOTPATH_PORT || 8892);
const SNIPPET = process.env.HOTPATH_SNIPPET || "A=rand(1200); tic; for k=1:25, B=A*A; end";
const SECONDS = Number(process.env.HOTPATH_SECONDS || 3);
const OUT = process.env.HOTPATH_OUT || '/tmp/hotpath-raw.json';
const RUN = '/mnt/hdd/zcode-projects/Octave-Full-Wasm/test/browser/run.sh';

if (!DIR) { console.error('缺 HOTPATH_DIR'); process.exit(2); }
if ([8761, 8768].includes(PORT)) { console.error('端口是活站点，拒绝'); process.exit(2); }

// 自托管实验站（带头）—— COI 才能选中 w64 档
const serve = spawn('python3',
  ['/mnt/hdd/zcode-projects/Octave-Full-Wasm/build/serve-coi.py', '--dir', DIR, '--port', String(PORT)],
  { stdio: 'ignore', detached: false });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
await wait(1200);

let pass = 0, fail = 0;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${name}${detail ? ' :: ' + detail : ''}`);
};

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on('pageerror', e => console.log('   [pageerror] ' + String(e).slice(0, 200)));

let frames = [], samples = 0, chosen = null;
try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load', timeout: 120000 });
  // 两段式就绪
  let ready = false;
  for (let i = 0; i < 600; i++) {
    if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) { ready = true; break; }
    await wait(200);
  }
  check(ready, '① 页面就绪（__octaveReady）');
  for (let i = 0; i < 300; i++) {
    if (await page.evaluate(() => { try { return !!window.Module?.feval?.('strcat', ['a', 'b'], 1); } catch { return false; } }).catch(() => false)) break;
    await wait(200);
  }
  chosen = await page.evaluate(() => (window.__octaveCaps?.lane || {}).chosen || null);
  check(chosen === 'w64', '② 选中的是 w64 档（不是落回 base）', `chosen=${chosen}`);

  // CDP 采样
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });   // 100µs
  await cdp.send('Profiler.start');
  const t0 = Date.now();
  // ★ 片段超时（实测教训：逐元素扩结构体数组是 O(n²)，能把仪器挂死）——用 eval_string 的
  //   中断旗标（_web_request_interrupt 到安全点生效；CPU 密集纯循环不吃安全点 ⇒ 超时后
  //   放弃这次采样，如实标 timeout，不让整个扫描卡住）。采样窗 = SECONDS + 余量。
  const hardMs = (SECONDS + 8) * 1000;
  const evalP = page.evaluate((snippet) => {
    try { return { rc: window.Module.eval_string(snippet) }; }
    catch (e) { return { rc: -1, err: String(e).slice(0, 120) }; }
  }, SNIPPET).catch(e => ({ rc: -9, err: String(e).slice(0, 120) }));
  const rc = await Promise.race([
    evalP,
    new Promise(res => setTimeout(() => {
      // 先请求中断（安全点会停；纯循环停不了则浏览器端会超时/被 kill）
      page.evaluate(() => { try { window.Module._web_request_interrupt && window.Module._web_request_interrupt(); } catch {} }).catch(() => {});
      res({ rc: -2, err: 'timeout' });
    }, hardMs)),
  ]);
  const wallMs = Date.now() - t0;
  const { profile } = await cdp.send('Profiler.stop');

  const byId = new Map(profile.nodes.map(n => [n.id, n]));
  const counts = (profile.samples || []).reduce((m, id) => (m[id] = (m[id] || 0) + 1, m), {});
  frames = Object.entries(counts).map(([id, n]) => {
    const f = byId.get(Number(id))?.callFrame || {};
    return { name: f.functionName || '(空)', url: (f.url || '').split('/').pop(), n };
  }).sort((a, b) => b.n - a.n);
  samples = profile.samples?.length || 0;
  check(rc.rc === 0, '③ 片段执行 rc=0', JSON.stringify(rc).slice(0, 120));
  check(samples > 100, '④ 采到样本（>100）', `samples=${samples} wall=${wallMs}ms`);
  // ⚠ CDP 的 url 形如 `octave.wasm-<hash>`（模块作用域后缀）⇒ 用 includes 不是 endsWith（实测踩过）
  const named = frames.some(f => f.url.includes('octave.wasm') && !/^wasm-function\[/.test(f.name));
  check(named, '⑤ 帧里有**带名字**的 wasm 函数（符号构建生效）',
        'top=' + JSON.stringify(frames.filter(f => f.url.includes('octave.wasm')).slice(0, 3).map(f => f.name)));
} finally {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ frames, samples, chosen, snippet: SNIPPET }, null, 1));
  await browser.close();
  try { serve.kill('SIGTERM'); } catch {}
}

console.log(`=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
