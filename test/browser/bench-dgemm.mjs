// E1 基准：DGEMM 尺寸扫描（SIMD vs 非 SIMD 的 A/B）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/bench-dgemm.mjs <URL> [LABEL]
// 例：  跑 SIMD 车道 8771 与基线 8768，各得一行 DGEMM_JSON，再算 B/A。
//
// 口径（照 bench-core.mjs，刻意保持一致以便跨档比较）：
//   * `rand` 放在 `tic` **之外**（只测乘法本身）；
//   * 每尺寸跑 REPEAT=3 取**中位数**；
//   * 计时用 Octave 自己的 tic/toc（墙钟）；
//   * 取数走"写进虚拟 FS 再读回"，不吃 console 匹配。
// 尺寸选 512/1024/2000：小尺寸看函数调用/打包开销，大尺寸看吞吐。
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8771/';
const LABEL = process.argv[3] || 'simd';
const REPEAT = 3;
const SIZES = [512, 1024, 2000];

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
page.on('pageerror', e => console.log('   [pageerror] ' + String(e).slice(0, 200)));

const t0 = Date.now();
await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
let readyMs = -1;
// ★ 就绪判定两段式（工单 40/42，2026-10-02）：**先等 __octaveReady，再碰 feval**（同 bench-core）。
let __ready = false;
for (let i = 0; i < 600; i++) {
  if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) { __ready = true; break; }
  await new Promise(r => setTimeout(r, 200));
}
if (!__ready) throw new Error('bench-dgemm: 120s 内 __octaveReady 未就绪');
while (Date.now() - t0 < 300000) {
  const ok = await page.evaluate(() => { try { return !!window.Module?.feval?.('strcat', ['a', 'b'], 1); } catch { return false; } }).catch(() => false);
  if (ok) { readyMs = Date.now() - t0; break; }
  await new Promise(r => setTimeout(r, 100));
}
console.log(`label=${LABEL} url=${URL} ready=${(readyMs / 1000).toFixed(2)}s`);

// 产物身份自证：确认跑的不是缓存/旧件（SHA 铁律）
const sha = await page.evaluate(() => window.__octaveWasmSha || '(无自证)');
console.log(`   wasm sha（页面自证）= ${sha}`);

const out = {};
for (const n of SIZES) {
  const body = `A=rand(${n}); B=rand(${n}); tic; C=A*B; t=toc;`;
  const samples = [];
  let err = '';
  for (let r = 0; r < REPEAT; r++) {
    const rv = await page.evaluate((code) => {
      try {
        const rc = window.Module.eval_string(code + ' fid=fopen("/tmp/bd_out.txt","w"); fprintf(fid,"%.6f",t); fclose(fid);');
        return { rc, err: window.Module.last_error_message() };
      } catch (e) { return { rc: -1, err: String(e) }; }
    }, body);
    if (rv.rc !== 0) { err = String(rv.err).replace(/\s+/g, ' ').slice(0, 140); break; }
    const v = await page.evaluate(() => {
      try { return Number(new TextDecoder().decode(window.Module.FS.readFile('/tmp/bd_out.txt'))); }
      catch (e) { return NaN; }
    });
    if (Number.isFinite(v)) samples.push(v);
  }
  if (samples.length) {
    const sorted = [...samples].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    out[`dgemm${n}`] = { median: med, all: samples };
    console.log(`  dgemm ${String(n).padEnd(5)} 中位数 ${med.toFixed(4)}s  (${samples.map(s => s.toFixed(3)).join(', ')})`);
  } else {
    out[`dgemm${n}`] = { median: null, error: err };
    console.log(`  dgemm ${n} FAILED ${err}`);
  }
}

await browser.close();
console.log('DGEMM_JSON' + JSON.stringify({ label: LABEL, url: URL, sha, readyMs, sizes: out }));
process.exit(0);
