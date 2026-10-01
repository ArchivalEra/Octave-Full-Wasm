// 基准：**四档同题竞速**（工单 31，2026-10-01）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 为什么有它：`bench-core.mjs` 是**单档**基准（跑站点默认选中的那一档），而四格上线后
// 最常被问的是"`w64` 是不是更快" —— 实测答案是**否**（见下表），但那个答案当时只活在一次
// 手跑的 /tmp 脚本里 ⇒ 不可复跑、会腐烂。本文件把它变成仓库里的仪器。
//
// 与 bench-core 的两处**刻意的**不同（都是实测踩出来的）：
//   ① **只用纯计算**（`rand`/`*`/`lu`/`svd`/`sum`/`sort`/解释器循环）—— 不碰需要懒加载资产的
//      函数。理由：`bench-core` 的 `fft 1e6` 在实测里让页面 **>90 s×3 次** 还没出结果
//      （四档串行必撞 900 s 看门狗），四档对比用不了；
//   ② 每档显式带 `?lane=`，四档跑**同一台机器、同一个站点、同一份工作**，中位数取 3 次。
//
// 产出：每档一行 `SPEED_JSON{...}`（含 `info.chosen/wasm64/shared`，便于核对"跑的确实是那一档"）。
//
// 用法：
//   HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh \
//     test/browser/bench-lanes.mjs "http://127.0.0.1:8761/" w64 > w64-logs/speed-w64.log
//   （`?lane=` 由本文件拼；lane ∈ base|threads|w64|w64-base）
import { chromium } from 'playwright-core';

const URL = process.argv.find(a => /^http/.test(a)) || 'http://127.0.0.1:8761/';
const LANE = process.argv.filter(a => !/^http/.test(a))[2] || 'w64';
const REPS = 3;
const CASES = {
  'matmul 500':  'A=rand(500);B=rand(500);tic;C=A*B;t=toc;',
  'matmul 1000': 'A=rand(1000);B=rand(1000);tic;C=A*B;t=toc;',
  'lu 800':      'A=rand(800);tic;[L,U,P]=lu(A);t=toc;',
  'lu 1500':     'A=rand(1500);tic;[L,U,P]=lu(A);t=toc;',
  'svd 400':     'A=rand(400);tic;[U,S,V]=svd(A);t=toc;',
  'sum 1e7':     'x=rand(1,1e7);tic;s=sum(x);t=toc;',
  'sort 2e6':    'x=rand(1,2e6);tic;y=sort(x);t=toc;',
  'loop 1e6':    'tic;s=0;for k=1:1e6,s=s+k;endfor;t=toc;',
};

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
await page.goto(`${URL}?lane=${LANE}`, { waitUntil: 'load', timeout: 300000 });
for (let i = 0; i < 600; i++) {
  if (await page.evaluate(() => { try { return !!window.Module?.feval?.('strcat', ['a', 'b'], 1); } catch { return false; } }).catch(() => false)) break;
  await new Promise(r => setTimeout(r, 200));
}
const info = await page.evaluate(() => {
  const c = window.__octaveCaps || {};
  return { chosen: (c.lane || {}).chosen || null, wasm64: !!(c.artifact && c.artifact.wasm64), shared: c.sharedMemory };
});
console.log(`lane=${LANE} chosen=${info.chosen} wasm64=${info.wasm64} shared=${info.shared}`);
const out = { lane: LANE, info, results: {} };
for (const [name, body] of Object.entries(CASES)) {
  const s = [];
  for (let r = 0; r < REPS; r++) {
    const rv = await page.evaluate((c) => {
      try {
        const rc = window.Module.eval_string(c + 'fid=fopen("/tmp/sp.txt","w");fprintf(fid,"%.6f",t);fclose(fid);');
        return { rc, err: window.Module.last_error_message() };
      } catch (e) { return { rc: -1, err: String(e).slice(0, 150) }; }
    }, body);
    if (rv.rc !== 0) { out.results[name] = { err: rv.err.replace(/\s+/g, ' ').slice(0, 120) }; break; }
    const v = await page.evaluate(() => { try { return Number(new TextDecoder().decode(window.Module.FS.readFile('/tmp/sp.txt'))); } catch { return NaN; } });
    if (Number.isFinite(v)) s.push(v);
  }
  if (s.length) {
    const so = [...s].sort((a, b) => a - b);
    out.results[name] = { median: so[Math.floor(so.length / 2)], all: s };
    console.log(`  ${name.padEnd(12)} ${out.results[name].median.toFixed(4)}s  (${s.map(x => x.toFixed(3)).join(', ')})`);
  } else {
    console.log(`  ${name.padEnd(12)} FAILED ${out.results[name].err || ''}`);
  }
}
console.log('SPEED_JSON' + JSON.stringify(out));
await browser.close();
process.exit(0);
