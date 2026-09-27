// 探针：Q4 — JSPI（B 姿势手搓）在 DedicatedWorker 里能不能挂起/恢复
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 为什么要有它：C3（把解释器搬进 DedicatedWorker）唯一没实测过的机制就是这一条。
// 形态与 probe-jspi-b.mjs 同族：runner 自托管产物目录（临时端口），宿主页 run.html
// 只负责起 worker，结论由 worker 自己 postMessage 回来。
// 判据：
//   W1 worker 里有 JSPI API（没有 ⇒ 如实报 api-missing，不算失败而是"环境无此能力"）
//   W2 同步入口在 worker 里照常（对照组，值 = 输入+7）
//   W3 ★ 100 次挂起/恢复全部返回 ms+1（无一失败）
//   W4 ★ 等待期间 worker 的 setTimeout tick 递增（真让出，不是 busy-loop）
//   W5 墙上时间下界（≥ 100×1ms）
//   W6 ★ 反向：没包 promising 的直调必须抛（穷举语义在 worker 里同样成立）
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

// ★ F4：输入契约在 `test/browser/manifest.json` 的 `inputs` 里声明；环境变量
//    `PROBE_DIR` 可覆盖路径（两处口径必须一致 —— 清单声明的就是探针读的这个）。
const DIR = process.env.PROBE_DIR || ((process.argv[2] && !/^http/.test(process.argv[2])) ? process.argv[2] : '/mnt/hdd/octave-wasm-build/jspi-worker-probe');
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
const HOSTPAGE = process.env.HOSTPAGE || 'run.html';   // run-page.html = 同一产物的页面对照组
const URL = `http://127.0.0.1:${server.address().port}/${HOSTPAGE}`;

let pass = 0, fail = 0;
const check = (ok, label, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 260)}`); };

const br = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await br.newContext()).newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e).slice(0, 300)));
await page.goto(URL, { waitUntil: 'load', timeout: 60000 });

// 30s 硬超时：worker 永久挂起本身就是数据点
let res = null;
try {
  await page.waitForFunction(() => window.__workerResult !== null || window.__workerError !== null,
    null, { timeout: 30000 });
  res = await page.evaluate(() => ({ r: window.__workerResult, e: window.__workerError }));
} catch { /* 超时 */ }

if (!res || (!res.r && !res.e)) {
  console.log('   ⚠️ 30s 内 worker 未回报任何结果（永久挂起？）');
  check(false, '★ W3 worker 完成 100 次挂起/恢复', 'HARD-TIMEOUT-30s（无回报）');
  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await br.close(); server.close(); process.exit(1);
}
if (res.e) console.log('   worker onerror：' + res.e);

const R = res.r || {};
console.log('   worker 回报：' + JSON.stringify({
  apiSuspending: R.apiSuspending, apiPromising: R.apiPromising, ok: R.ok, fails: (R.fails || []).slice(0, 3),
  ticks: R.ticks, wallMs: R.wallMs, ping: R.ping, rt: R.rt, pre: R.pre, e4Ms: R.e4Ms,
  unpromising: R.unpromising, error: R.error,
}).slice(0, 500));

// W1：api-missing 是"环境无此能力"，如实记录，不计入红
if (R.error && String(R.error).startsWith('api-missing')) {
  console.log(`N/A  | W1 worker 里的 JSPI API :: ${R.error}（如实记录：该环境下 C3 需走降级路径，不是本探针的红）`);
  console.log(`\n=== ${pass} PASS / ${fail} FAIL（含 1 条 N/A）===`);
  await br.close(); server.close(); process.exit(0);
}

check(R.apiSuspending && R.apiPromising, '★ W1 worker 里存在 JSPI API（Suspending/promising）',
  `Suspending=${R.apiSuspending} promising=${R.apiPromising}`);
check(R.ping === 42, 'W2 对照组：同步入口在 worker 里照常（35+7=42）', `ping=${R.ping}`);
check(R.ok === R.n && (R.fails || []).length === 0, '★ W3 100 次挂起/恢复全部成功（返回值 = ms+1）',
  `ok=${R.ok}/${R.n} fails=${JSON.stringify((R.fails || []).slice(0, 3))}`);
check(R.ticks > 0, '★ W4 等待期间 worker 的 tick 递增（真让出，不是 busy-loop）', `ticks=${R.ticks}`);
check(R.wallMs >= 100, 'W5 墙上时间下界（≥100×1ms）', `wallMs=${R.wallMs}`);
check(typeof R.unpromising === 'string' && /^throw/.test(R.unpromising) && /Suspend|promising/i.test(R.unpromising),
  '★ W6 反向：未包 promising 的直调在 worker 里同样抛（穷举语义成立）', R.unpromising);
check(R.rt === 52, '★ W7 E4：worker 里 dlopen **运行时写进 FS** 的 side，且经它回调主模块挂起 import（52=50+1+1）',
  `rt=${R.rt} e4Ms=${R.e4Ms}`);
check(R.pre === 52, '★ W8 E4：worker 里 dlopen **--preload-file 烘进 .data** 的 side（52）', `pre=${R.pre}`);

if (errs.length) console.log('   ⚠️ 页面报错：' + errs.slice(0, 3).join(' // '));
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await br.close(); server.close();
process.exit(fail ? 1 : 0);
