// 探针：`MAIN_MODULE=2`（DCE）下的**懒加载证据**（批次 C，HANDOFF §5.25）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 为什么要单独一条：M2 把主模块做了 DCE，而 `.oct` 是**资产车道**（不在主链命令行上）。
// 当年 route A（把 `.oct` 放主链命令行、靠 Emscripten 自动保活）就是这么死的：
// Emscripten 把它们记成**启动时要加载的 dylib**，页面一开就朝**站点根目录**要
// `__bfgsmin.oct`（实测 `404 : …/__bfgsmin.oct`）⇒ 懒加载设计直接破功，
// 而且那 44 个 `.oct` 全变成非懒加载。
//
// 本探针钉两条：
//   ① 页面加载期**不许**出现"站点根目录找 .oct"的请求（只许走 `assets/` 那条资产通道）；
//   ② 懒加载**仍然按需**：`butter`（signal 包）在加载前 exist=0，按需装载后才可用。
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/probe-m2-lazyload.mjs [URL]
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8768/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text().slice(0, 300)));
page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 300)));

// ★ 记录**加载期**的全部请求（就绪之后的不算）
const loadReqs = [];
let ready = false;
page.on('request', r => { if (!ready) loadReqs.push(r.url()); });

let pass = 0, fail = 0;
function check (ok, label, detail) {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 200)}`);
}

await page.goto(URL, { waitUntil: 'load', timeout: 240000 });
const t0 = Date.now();
while (Date.now() - t0 < 300000) {
  if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) break;
  await new Promise(r => setTimeout(r, 300));
}
ready = true;
console.log(`URL=${URL} ready=${((Date.now() - t0) / 1000).toFixed(1)}s  加载期请求 ${loadReqs.length} 条`);

// ① 加载期的 .oct 请求：全都必须走 assets/（资产车道），不许有站点根目录那种 dylib 自动加载
const octReqs = loadReqs.filter(u => /\.oct(\?|$)/.test(u));
const outside = octReqs.filter(u => !u.includes('/assets/'));
check(outside.length === 0,
  '★ 加载期没有"站点根目录找 .oct"的请求（M2 的 DCE 没把 .oct 变成启动 dylib）',
  outside.length ? outside.slice(0, 3).join(' ') : `加载期 .oct 请求 ${octReqs.length} 条，全在 assets/ 下`);
check(octReqs.length > 0 && octReqs.length <= 12,
  '加载期的 .oct 请求就是启动清单里那几个核心 .oct（数量合理）',
  `${octReqs.length} 条：${octReqs.map(u => u.split('/').pop()).join(' ')}`);
// 404 是 route A 的直接症状
const bad404 = loadReqs.filter(u => /__bfgsmin|__lti_input_idx|__sl_/.test(u));
check(bad404.length === 0, '★ 没有"把包编译件当启动 dylib 去要"的请求', bad404.join(' ') || '无');

// ② 懒加载仍然按需
async function ev (code) {
  logs.length = 0;
  const r = await page.evaluate(x => {
    const rc = window.Module.eval_string(x);
    return { rc, err: window.Module.last_error_message() };
  }, code);
  await new Promise(rr => setTimeout(rr, 500));
  return { rc: r.rc, err: r.err, out: logs.join(' ').replace(/\s+/g, ' ').trim() };
}
let r = await ev('disp(exist("butter"))');
check(r.rc === 0 && /(^|\s)0(\s|$)/.test(r.out),
  '装载前：`butter`（signal 包）不存在（=0，说明它确实没进首包）', r.out);

const loaded = await page.evaluate(async () => {
  try { await window.OctaveAssets.load('signal'); return 'ok'; }
  catch (e) { return 'ERR ' + String(e).slice(0, 120); }
});
check(loaded === 'ok', '按需装载 signal 资产成功', loaded);

r = await ev('disp(exist("butter"))');
check(r.rc === 0 && /\b2\b/.test(r.out),
  '★ 按需装载后 `butter` 可用（=2：.m 覆盖）', r.out);
r = await ev('disp(numel(butter(4, 0.2)))');
check(r.rc === 0 && /\b5\b/.test(r.out), '★ 真调用（butter(4,0.2) → 5 个系数）', r.out);

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
