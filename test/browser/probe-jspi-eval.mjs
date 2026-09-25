// 探针：G1 验收（B 姿势）—— `eval_async`（= promising(eval_wait)）三例 + 挂起链路自证
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：node test/browser/probe-jspi-eval.mjs [URL]
// 判据（跟随产物姿势走）：
//   ① `eval_async("42")` ⇒ rc 0（与同步 `eval_string` 同一语义）；
//   ② `eval_async("error('x')")` ⇒ rc 2 且 `last_error_message` 含 'x'
//      （Octave 的报错走 rc + last_error_message，**不**变成 Promise reject —— 与同步一致；
//        reject 只留给真 wasm trap）；
//   ③ 挂起链路自证（钩子有效性）：plain 栈直调 `_web_pause_ms(50)` 必抛
//      `SuspendError`（证明页面钩子把 web_sleep_ms 包成了 Suspending）；
//      再 `promising(_web_pause_ms)(50)` ⇒ 正常返回、墙上 ≥50ms、`Module.__tick` 增加
//      （证明挂起/恢复端到端成立 —— 这格在 G2 接 pause 前就能测，不欠账）；
//   ④ `eval_async("pause(0.2); 43")` ⇒ 43（G1 阶段 pause 仍 blocking，ticks=0 如实记）。
import { chromium } from 'playwright-core';
const URL = process.argv[2] || 'http://127.0.0.1:8768/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 200)));
page.on('console', m => { const t = m.text(); if (/error|FATAL|failed/i.test(t)) logs.push(t.slice(0, 180)); });
await page.goto(URL, { waitUntil: 'load', timeout: 240000 });
let t0 = Date.now();
while (Date.now() - t0 < 120000) {
  if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) break;
  await new Promise(r => setTimeout(r, 200));
}
const ready = await page.evaluate(() => window.__octaveReady === true).catch(() => false);

let pass = 0, fail = 0;
const check = (ok, label, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 200)}`); };
const call = async (jsBody, guardMs = 12000) => {
  const inner = page.evaluate(async (code) => {
    const before = window.Module.__tick || 0;
    const t = performance.now();
    let val, err = null;
    try { val = await eval(code); } catch (e) { err = String(e).slice(0, 200); }
    return { val, err, wall: Math.round(performance.now() - t), ticks: (window.Module.__tick || 0) - before };
  }, jsBody);
  const guard = new Promise(res => setTimeout(() => res({ val: null, err: 'HARD-TIMEOUT', wall: guardMs, ticks: -1 }), guardMs));
  return Promise.race([inner, guard]);
};

check(ready === true, '页面就绪（__octaveReady）', ready);
if (ready) {
  const shape = await page.evaluate(() => ({
    evalAsync: typeof Module.eval_async, evalWait: typeof Module._eval_wait,
    wpause: typeof Module._web_pause_ms, suspending: typeof WebAssembly.Suspending,
  }));
  check(shape.evalAsync === 'function' && shape.evalWait === 'function',
    '★ 页面暴露 `Module.eval_async`（= promising(eval_wait)），真 wasm 导出 `_eval_wait` 在', JSON.stringify(shape));
  check(shape.wpause === 'function' && shape.suspending === 'function',
    '★ G2 预埋就位：`_web_pause_ms` 导出在、浏览器 Suspending API 在', JSON.stringify(shape));

  // ① 值语义与同步一致
  const c1 = await call(`Module.eval_async("42")`);
  check(c1.err === null && c1.val === 0, '① eval_async("42") ⇒ rc 0（与同步一致，不是 42 —— rc 语义）',
    `val=${c1.val} err=${c1.err || '(无)'}`);
  // ② 错误语义：Octave 报错走 rc=2 + last_error_message，不是 reject
  const c2 = await call(`(async () => { const rc = await Module.eval_async("error('x')"); return rc + '|' + Module.last_error_message(); })()`);
  const [rc2, msg2] = String(c2.val || '').split('|');
  check(c2.err === null && rc2 === '2' && /x/.test(msg2 || ''),
    '② eval_async("error(\\"x\\")") ⇒ rc 2 + last_error_message 含 x（错误不是 Promise reject —— 与同步一致）',
    `val=${c2.val} err=${c2.err || '(无)'}`);
  // ③ 挂起链路自证（钩子有效性 —— 不欠 G2 的账）
  const c3a = await call(`Module._web_pause_ms(50)`);
  check(c3a.err !== null && /SuspendError|promising/i.test(c3a.err),
    '③a plain 栈直调 _web_pause_ms 必抛 SuspendError（证明钩子把 web_sleep_ms 包上了）', c3a.err || ('居然成功 ' + c3a.val));
  const c3b = await call(`WebAssembly.promising(Module._web_pause_ms)(120)`);
  check(c3b.err === null && c3b.wall >= 120 && c3b.ticks > 0,
    '★ ③b promising(_web_pause_ms)(120) ⇒ 真挂起/恢复（墙上 ≥120ms 且 tick>0，busy-loop 会是 0）',
    `wall=${c3b.wall}ms ticks=${c3b.ticks} err=${c3b.err || '(无)'}`);
  // ④ pause 例（G1 阶段允许 blocking —— pause 还没接到挂起 import，那是 G2 的活）
  const c4 = await call(`Module.eval_async("pause(0.2); 43")`);
  const blockingOk = c4.err === null && Number(c4.val) === 0;
  check(blockingOk, '④ eval_async("pause(0.2); 43") ⇒ rc 0（G1 阶段允许 blocking；ticks=' + c4.ticks + ' 如实记）',
    `val=${c4.val} ticks=${c4.ticks} err=${c4.err || '(无)'}`);
  // 事后：解释器仍健康
  const alive = await call(`Module.eval_string("1+1")`);
  check(alive.err === null && alive.val === 0, '事后解释器存活（同步 eval_string 正常）', `val=${alive.val}`);
} else {
  console.log('fail | 页面没就绪，无从断言');
}
logs.slice(0, 5).forEach(l => console.log('   ' + l));
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
