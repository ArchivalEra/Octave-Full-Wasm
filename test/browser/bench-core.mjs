// R10 基准套件：同一组脚本的墙钟时间（O0/O1/O2 矩阵用同一份，便于对比）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/bench-core.mjs [URL]
//
// 测什么、为什么这么测：
//   * 每项跑 3 次取**中位数**：wasm 里的首次调用含惰性初始化（JIT 缓存、
//     懒加载的 .m、内存增长），只看一次会得到噪声极大的数。
//   * 计时器用 Octave 自己的 tic/toc（墙钟），不掺 JS 侧开销。
//   * 同时记录 ready 时间（goto → feval 可用）与三大件体积 —— R10 的验收
//     标准要的是"墙钟时间 + 体积差"，两项都得有。
//
// 产出：JSON 打到 stdout（末尾一行 BENCH_JSON{...}），便于跨 O 级比较。
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const LABEL = process.argv[3] || 'unknown';
const REPEAT = 3;

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text().slice(0, 300)));
page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 300)));

const t0 = Date.now();
await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
let readyMs = -1;
while (Date.now() - t0 < 300000) {
  const ok = await page.evaluate(() => { try { return !!window.Module?.feval?.('strcat', ['a', 'b'], 1); } catch { return false; } }).catch(() => false);
  if (ok) { readyMs = Date.now() - t0; break; }
  await new Promise(r => setTimeout(r, 100));
}
console.log(`label=${LABEL} url=${URL} ready=${(readyMs / 1000).toFixed(2)}s`);

// 资产装载时间（懒加载车道本身的成本）。
// 顺带把 ode15s 需要的 __ode15__ 装上：基准套件要测的是求解器的速度，
// 不是"忘了加载资产"。
const assetMs = await page.evaluate(async () => {
  const t = performance.now();
  let n = 0;
  for (const a of ['webnet', '__ode15__']) {
    try { await window.OctaveAssets.load(a); n++; } catch (e) {}
  }
  return { ms: Math.round(performance.now() - t), loaded: n };
});
console.log(`  资产装载（webnet + __ode15__）: ${assetMs.ms}ms, ${assetMs.loaded}/2`);

// 计时项：name → Octave 表达式（自己把耗时写进 /tmp/bench_<name>.txt）
const CASES = {
  '矩阵乘 500x500':  "A=rand(500); B=rand(500); tic; C=A*B; t=toc;",
  '矩阵分解 lu(800)': "A=rand(800); tic; [L,U,P]=lu(A); t=toc;",
  'FFT 1e6':          "x=randn(1,1048576); tic; y=fft(x); t=toc;",
  'ODE45 摆':         "tic; [tt,yy]=ode45(@(t,y) [y(2); -sin(y(1))], [0 20], [1;0]); t=toc;",
  'ODE15s 刚性':      "tic; [tt,yy]=ode15s(@(t,y) [-0.04*y(1)+1e4*y(2)*y(3); 0.04*y(1)-1e4*y(2)*y(3)-3e7*y(2)^2; 3e7*y(2)^2], [0 1], [1;0;0]); t=toc;",
  '稀疏求解 1e5':     "n=100000; A=spdiags([ones(n,1) -4*ones(n,1) ones(n,1)], -1:1, n, n); b=ones(n,1); tic; x=A\\b; t=toc;",
  '循环 1e6':         "tic; s=0; for k=1:1e6, s=s+k; endfor; t=toc;",
  'classdef':         "tic; for k=1:2000, o=struct('a',k); s=o.a+1; endfor; t=toc;",
  'sort 2e6':         "x=rand(1,2e6); tic; y=sort(x); t=toc;",
  'textscan':         "s=repmat('1.5 2.5\\n',1,20000); tic; c=textscan(s,'%f %f'); t=toc;",
};

const results = {};
for (const [name, body] of Object.entries(CASES)) {
  const samples = [];
  let err = '';
  for (let r = 0; r < REPEAT; r++) {
    logs.length = 0;
    const rv = await page.evaluate((code) => {
      try {
        const rc = window.Module.eval_string(code + ' fid=fopen("/tmp/bench_out.txt","w"); fprintf(fid,"%.6f",t); fclose(fid);');
        return { rc, err: window.Module.last_error_message() };
      } catch (e) { return { rc: -1, err: String(e) }; }
    }, body);
    if (rv.rc !== 0) { err = rv.err.replace(/\s+/g, ' ').slice(0, 120); break; }
    const v = await page.evaluate(() => {
      try { return Number(new TextDecoder().decode(window.Module.FS.readFile('/tmp/bench_out.txt'))); }
      catch (e) { return NaN; }
    });
    if (Number.isFinite(v)) samples.push(v);
  }
  if (samples.length) {
    const sorted = [...samples].sort((a, b) => a - b);
    results[name] = { median: sorted[Math.floor(sorted.length / 2)], all: samples };
    console.log(`  ${name.padEnd(18)} ${sorted[Math.floor(sorted.length / 2)].toFixed(4)}s  (${samples.map(s => s.toFixed(3)).join(', ')})`);
  } else {
    results[name] = { median: null, error: err };
    console.log(`  ${name.padEnd(18)} FAILED ${err}`);
  }
}

// 体积：从页面拿资源大小（Transfer-Encoding 之后拿不到原始值，所以用 HEAD）
const sizes = await page.evaluate(async () => {
  const out = {};
  for (const f of ['octave.wasm', 'octave.js', 'octave.data']) {
    try {
      const r = await fetch(f, { method: 'HEAD' });
      out[f] = Number(r.headers.get('Content-Length')) || -1;
    } catch (e) { out[f] = -1; }
  }
  return out;
});
console.log(`  体积: ${Object.entries(sizes).map(([k, v]) => `${k}=${(v / 1048576).toFixed(1)}MB`).join(' ')}`);

const report = { label: LABEL, url: URL, readyMs, assetMs, results, sizes };
console.log('BENCH_JSON' + JSON.stringify(report));
await browser.close();
process.exit(0);
