// 探针：`matrix-android.html`（浏览器矩阵自测页）—— 这个页面以前**零测试覆盖**，它就是这么漂掉的
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 为什么有这个探针：`site/matrix-android.html` 是**手工维护、无生成器**的页面（DEPLOY.md:13 写明
// 用途："浏览器矩阵自测页（自动跑能力门并把结果写进 DOM，供截图/无头读取）"）。2026-09-26 实测
// 发现它的三份副本已经不一致：8768 是 C6 时代的 700 行版，8761 与仓库还是 C6 之前的 575 行版，
// 而**没有任何测试/脚本会因此变红** —— 于是它静静漂了一个版本。
//
// 用法（从仓库原路径直跑，按 AGENTS「测试用例从仓库原路径直跑」）：
//   cd /mnt/hdd/octave-wasm-build/harness && \
//     node /mnt/hdd/zcode-projects/Octave-Full-Wasm/test/browser/probe-matrix-android.mjs [URL]
// 默认 URL = http://127.0.0.1:8761/
//
// 判据（绿）：
//   A 页面起得来，且**能力门自己跑完并把结果写进 DOM**（`#matrix-result` 出现）；
//   B 那行结果形状正确：`smoke=` 是 pass/pass-blocking 之一，且 Suspending/promising/eval_async
//     都是 function（这个产物是 B 姿势 JSPI，页面层的 `eval_async` 必须包得出来）；
//   C 全程无 pageerror（有就报出来，不吞）。
// 反向断言（必须能红）：
//   D 同一个 URL 前缀下**不存在的页面** ⇒ 404，且**不会**出现 `#matrix-result`
//     （证明 A 不是"无论加载什么都绿"）。
import { chromium } from 'playwright-core';

const URL = (process.argv[2] && !/^http/.test(process.argv[2]) ? '' : process.argv[2]) || 'http://127.0.0.1:8761/';
const BASE = URL.endsWith('/') ? URL : URL + '/';
const PAGE = BASE + 'matrix-android.html';
const WAIT_MS = 180000;          // 冷启动 + 能力门（门自己有 8s 超时）
const SHOT = process.env.SHOT === '1';

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 240)}`);
};

const br = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await br.newContext();
const page = await ctx.newPage();
const errs = [];
const badRes = [];
page.on('pageerror', e => errs.push(String(e).slice(0, 300)));
page.on('console', m => {
  if (m.type() !== 'error') return;
  // 把 URL 一起记下来 —— 不然只剩一句"Failed to load resource: 404"，查不出是哪个资源
  const loc = (() => { try { return m.location()?.url || ''; } catch { return ''; } })();
  errs.push(`[console.error] ${m.text().slice(0, 160)}${loc ? ' @ ' + loc : ''}`);
});
// 4xx/5xx 单独记 URL —— 不然只能看到一句"Failed to load resource: 404"，查不出是哪个资源
page.on('response', r => { if (r.status() >= 400) badRes.push(`${r.status()} ${r.url()}`); });

console.log(`page=${PAGE}`);
const t0 = Date.now();
await page.goto(PAGE, { waitUntil: 'load', timeout: 120000 }).catch(e => console.log('  goto: ' + String(e).slice(0, 160)));

// ── A：能力门的结果写进 DOM 了没有（这是"整页真的跑到终点"的唯一硬证据）──
let text = '';
while (Date.now() - t0 < WAIT_MS) {
  text = await page.evaluate(() => {
    const el = document.getElementById('matrix-result');
    return el ? el.textContent : '';
  }).catch(() => '');
  if (text) break;
  await new Promise(r => setTimeout(r, 500));
}
check(!!text, '★ A 页面跑到终点：能力门结果写进 DOM（#matrix-result）', text ? `${((Date.now() - t0) / 1000).toFixed(1)}s :: ${text.slice(0, 160)}` : `等了 ${WAIT_MS / 1000}s 没有任何结果`);

// ── B：结果行的形状 ──
const m = /MATRIX-RESULT\s+smoke=([^\s|]+)/.exec(text || '');
check(!!m, 'B1 结果行含 `MATRIX-RESULT smoke=`', text ? text.slice(0, 120) : '(无)');
check(!!m && (m[1] === 'pass' || m[1] === 'pass-blocking'),
  '★ B2 smoke 是 pass / pass-blocking（page 层能力门真跑过了）', m ? m[1] : '(无)');
for (const k of ['Suspending', 'promising']) {
  const r = new RegExp(`${k}=(function|undefined)`).exec(text || '');
  check(!!r && r[1] === 'function', `B3 ${k} 在页面里是 function`, r ? r[1] : '(结果行里没有这个字段)');
}
{
  const r = /eval_async=(function|undefined)/.exec(text || '');
  check(!!r && r[1] === 'function', '★ B4 eval_async 是 function（B 姿势：页面把 promising(_eval_wait) 包出来了）', r ? r[1] : '(缺)');
}

// ── C：没吞错 ──
// favicon 那条噪声**不写死豁免**，而是当场测一次 `/favicon.ico` 的状态：
//   实测（2026-09-26）：8761/8768 的 `/favicon.ico` 都是 404，而**普通 index.html 也产生
//   完全相同的一条 `Failed to load resource: 404`**（差分测试）⇒ 那是浏览器自发请求，与本页无关。
//   所以：只有"favicon 确实 404"时才允许最多一条该文案；哪天站点补上 favicon，这个豁免自动消失。
// ⚠️ 这次状态查询走 **Node 侧 fetch**，不走页面：在页面里 fetch 会自己产生一条
//    `Failed to load resource: 404` 混进被测量的窗口（实测踩过：噪声从 1 条变 2 条）。
const favStatus = await fetch(BASE + 'favicon.ico').then(r => r.status).catch(() => -1);
const faviconErrs = errs.filter(e => /Failed to load resource.*404/.test(e));
const otherErrs = errs.filter(e => !/Failed to load resource.*404/.test(e));
check(otherErrs.length === 0 && faviconErrs.length <= (favStatus === 404 ? 1 : 0),
  '★ C2 无 pageerror / 无未解释的 console.error',
  `favicon.ico=${favStatus} ⇒ 允许 ${favStatus === 404 ? 1 : 0} 条 favicon 噪声；`
  + `实得 favicon 噪声 ${faviconErrs.length} 条、其它错误 ${otherErrs.length} 条`
  + (otherErrs.length ? ' :: ' + otherErrs.slice(0, 2).join(' // ') : ''));

if (SHOT) {
  const p = `/tmp/matrix-android-${(new URL(BASE)).port || 'x'}.png`;
  await page.screenshot({ path: p, fullPage: true }).catch(() => {});
  console.log('  截图：' + p);
}

// ── D（反证）：不存在的页面必须 404 且不产结果 —— 证明 A 不是"加载什么都绿" ──
const p2 = await ctx.newPage();
const bad = await p2.goto(BASE + 'matrix-android-NOPE-404.html', { waitUntil: 'load', timeout: 30000 })
  .then(r => r ? r.status() : 0).catch(() => -1);
const badText = await p2.evaluate(() => {
  const el = document.getElementById('matrix-result');
  return el ? el.textContent : '';
}).catch(() => '');
check(bad === 404 && !badText,
  '★ D（反证）不存在的页面 ⇒ 404 且无结果行（A 的判据不是恒真）',
  `status=${bad} result=${badText ? '有（不该有）' : '(无)'}`);

await br.close();
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
