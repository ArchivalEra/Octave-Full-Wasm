// 探针：E3 — pthread × 运行期 dlopen（第四轮评审 Q1/Q3；threads 线最大未知数）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 形态：runner 自托管产物目录（临时端口），**给顶层页注入 COOP/COEP**
// （顶层是唯一能拿到 COI 的位置 —— iframe 自带同头在未隔离顶层里无效，见
//  test/browser/probe-iframe-coi.mjs 的九格实测）。
// 判据：
//   T1 前置：crossOriginIsolated=true 且 SharedArrayBuffer 可用（否则 pthread 无意义）
//   T2 ★ 100 轮 dlopen/dlsym/dlclose 全部成功（跨模块返回值 41+1=42）
//   T3 ★ 期间 2 个 pthread 真的在跑（busy 计数 > 0）
//   T4 ★ 无 hang（40s 硬超时兜底；超时本身就是"死锁"这个数据点）
//   T5 ★ 反向：dlopen 不存在的模块必须失败（证明这条路真的在跑，不是替身）
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

// ★ F4：输入契约在 `test/browser/manifest.json` 的 `inputs` 里声明；环境变量
//    `PROBE_DIR` 可覆盖路径（两处口径必须一致 —— 清单声明的就是探针读的这个）。
const DIR = process.env.PROBE_DIR || ((process.argv[2] && !/^http/.test(process.argv[2])) ? process.argv[2] : '/mnt/hdd/octave-wasm-build/threads-probe');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm' };
// ★ COI 头：pthread 需要 SharedArrayBuffer
const COI = { 'Cross-Origin-Opener-Policy': 'same-origin',
              'Cross-Origin-Embedder-Policy': 'require-corp' };
const server = createServer(async (req, res) => {
  const p = normalize(join(DIR, decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(normalize(DIR))) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(p);
    res.writeHead(200, Object.assign({ 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }, COI));
    res.end(body);
  } catch { res.writeHead(404).end('nope'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL = `http://127.0.0.1:${server.address().port}/run.html`;

let pass = 0, fail = 0;
const check = (ok, label, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 260)}`); };

const br = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await br.newContext()).newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e).slice(0, 300)));
await page.goto(URL, { waitUntil: 'load', timeout: 60000 });

let res = null;
try {
  await page.waitForFunction(() => window.__e3Result !== null || window.__e3Error !== null, null, { timeout: 40000 });
  res = await page.evaluate(() => ({ r: window.__e3Result, e: window.__e3Error }));
} catch { /* 40s 超时 = 死锁数据点 */ }

if (!res || (!res.r && !res.e)) {
  console.log('   ⚠️ 40s 内无结果（死锁/永久挂起）');
  check(false, '★ T2 100 轮 dlopen 全部成功', 'HARD-TIMEOUT-40s');
  check(false, '★ T4 无 hang', 'HARD-TIMEOUT-40s');
  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await br.close(); server.close(); process.exit(1);
}
if (res.e) console.log('   页面异常：' + res.e);
const R = res.r || {};
console.log('   回报：' + JSON.stringify(R).slice(0, 420));

check(R.pre && R.pre.coi === true, '★ T1 前置：顶层 crossOriginIsolated=true', JSON.stringify(R.pre));
check(R.pre && R.pre.sab === 'function' && R.pre.sabNew === 'ok', '★ T1 前置：SharedArrayBuffer 可用',
  R.pre ? `${R.pre.sab}/${R.pre.sabNew}` : '(无)');
check(R.ok === 100, '★ T2 100 轮 dlopen/dlsym/dlclose 全部成功（41+1=42）', `ok=${R.ok}`);
check(typeof R.busy === 'number' && R.busy > 0, '★ T3 期间 2 个 pthread 真在跑（busy>0）', `busy=${R.busy}`);
check(Number.isFinite(R.totalMs) && R.totalMs < 39000, '★ T4 无 hang（40s 硬超时未触发）', `totalMs=${R.totalMs}`);
check(R.missing === 0, '★ T5 反向：dlopen 不存在的模块必须失败', `missing=${R.missing}`);

if (R.log && R.log.length) console.log('   wasm 日志：' + R.log.join(' | ').slice(0, 300));
if (errs.length) console.log('   ⚠️ 页面报错：' + errs.slice(0, 3).join(' // '));
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await br.close(); server.close();
process.exit(fail ? 1 : 0);
