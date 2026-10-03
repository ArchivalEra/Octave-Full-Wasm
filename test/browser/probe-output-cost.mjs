// 探针：输出路径成本对照（工单 48）——"DOM 重绘到底占多少"从感觉变数字
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 问题（用户提出）：octave-page.js 的输出 sink 每行一次 createTextNode+appendChild，
//   "DOM 重绘是不是比计算还贵？该不该挪进 wasm？"
// 方法：同页跑两遍**同一段大输出**：
//   A = 真实 DOM sink（现状）
//   B = 同样计数 DOM 操作、但 **不真的插进树**（createTextNode 返回哑对象、appendChild 空操作）
//   ⇒ delta = 真实 DOM 插入/布局成本；B ≈ wasm 计算 + 边界开销。
//   另量主线程阻塞（1ms ticker 的停摆）——那才是 UX 真正受伤的地方。
// 判据：不设红绿（探索性），只出数字 + EMBED_OUTPUT_COST_JSON。
// 用法：HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh \
//        test/browser/probe-output-cost.mjs <部署了 embed-demo 的站点>
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8865/';
const BIG = process.env.BIG_OUTPUT || 'disp(rand(400,400));';   // ≈1.4MB 文本

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
page.on('pageerror', e => console.log('   [pageerror] ' + String(e).slice(0, 160)));
await page.goto(`${URL}embed-demo.html`, { waitUntil: 'load', timeout: 120000 });

let ready = false;
for (let t = 0; t < 600; t++) {
  if (await page.evaluate(() => window.octave && window.octave.state === 'idle').catch(() => false)) { ready = true; break; }
  await new Promise(r => setTimeout(r, 250));
}
if (!ready) { console.log('fail | 页面未就绪'); await browser.close(); process.exit(1); }

const r = await page.evaluate(async (BIG) => {
  const o = window.octave;
  const out = { bigBytes: BIG.length };

  // 主线程阻塞探针：1ms ticker，跑期间停摆多少
  function blocked(evalFn) {
    return new Promise(async (res) => {
      let ticks = 0; const iv = setInterval(() => ticks++, 1);
      const t0 = performance.now();
      await evalFn();
      const ms = performance.now() - t0;
      clearInterval(iv);
      // 1ms ticker 在最理想情况下应 tick ≈ ms 次；实际 tick 数反映"没被阻塞的槽位"
      res({ evalMs: +ms.toFixed(1), ticks, blockedPct: +((1 - ticks / Math.max(ms, 1)) * 100).toFixed(0) });
    });
  }

  // ── 清空输出区并取引用（uiAppend 每次重新 getElementById('output')）──
  function clearOut() { const el = document.getElementById('output'); if (el) el.textContent = ''; }

  // ── A：真实 DOM sink ──
  clearOut();
  const origCTN = document.createTextNode.bind(document);
  const origAppend = Node.prototype.appendChild;
  let domAppends = 0, domMs = 0;
  document.createTextNode = function (s) { const a = performance.now(); const n = origCTN(s); domMs += performance.now() - a; return n; };
  Node.prototype.appendChild = function (c) { const a = performance.now(); const n = origAppend.call(this, c); domMs += performance.now() - a; domAppends++; return n; };
  const A = await blocked(() => o.eval(BIG));
  const outChars = (document.getElementById('output') || {}).textContent.length;
  document.createTextNode = origCTN;
  Node.prototype.appendChild = origAppend;
  out.A = { ...A, domAppends, domMs: +domMs.toFixed(1), outChars };

  // ── B：DOM 操作计数但不真插（隔离 wasm 计算 + 边界）──
  clearOut();
  let bAppends = 0;
  document.createTextNode = function (s) { return { __fake: true, nodeValue: s }; };
  Node.prototype.appendChild = function (c) { bAppends++; return c; };
  const B = await blocked(() => o.eval(BIG));
  document.createTextNode = origCTN;
  Node.prototype.appendChild = origAppend;
  out.B = { ...B, domAppends: bAppends };

  out.delta = {
    domMs: +(out.A.evalMs - out.B.evalMs).toFixed(1),        // A-B ≈ 真实 DOM 时间
    domPct: +(((out.A.evalMs - out.B.evalMs) / out.A.evalMs) * 100).toFixed(0),
    perAppendUs: +(out.A.domMs / Math.max(out.A.domAppends, 1) * 1000).toFixed(2),
    coalesceWin: +((out.A.evalMs - out.B.evalMs) * (1 - 1 / Math.max(out.A.domAppends, 1))).toFixed(1),
  };
  return out;
}, BIG);

console.log(JSON.stringify(r, null, 1));
console.log('EMBED_OUTPUT_COST_JSON' + JSON.stringify({ A: r.A, B: r.B, delta: r.delta }));
await browser.close();
