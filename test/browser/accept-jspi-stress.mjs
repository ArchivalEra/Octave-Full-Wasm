// 验收：G2 —— pause 真让出 + EH/SjLj 压力矩阵（第三轮复审 §8 的五条全含）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：node test/browser/accept-jspi-stress.mjs [URL]
// 场景 × 判据（每条都"数值可验证"）：
//   A ★ pause 真让出：eval_async("pause(0.2); 43") ⇒ rc 0、墙上 ≥200ms、**ticks>0**
//     （G1 阶段 ticks=0 是 blocking；接上 webpause 后必须 >0 —— busy-loop/阻塞都是 0）
//   B unwind_protect 包着 pause ⇒ cleanup **恰好一次**（__g2 == "TC"）
//   C onCleanup（析构语义）包着 pause ⇒ 哨兵输出 **恰好一次**
//   D pause 之后 error ⇒ try/catch 抓到原文，rc 0
//   E 连续 10 次 pause(60ms) ⇒ 墙上 ≥600ms、ticks 累计 ≥10、解释器存活
//   F dlopen × 挂起交错：pause → 页面装载资产 → pause → 再装载 ⇒ 全程稳
//   G 【复审第一优先】**重入**：第一条 eval_async 还挂着（pause 500ms）时再进第二条。
//     影子栈共享是 JSPI 公认硬骨头 ⇒ 本探针**如实测量**并断言：产品用法必须是**串行**
//     （页面命令队列保证）；并发结果单独记录、事后新页面必须健康。
import { chromium } from 'playwright-core';
const URL = process.argv[2] || 'http://127.0.0.1:8768/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });

let pass = 0, fail = 0;
const check = (ok, label, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 220)}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function freshPage () {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => logs.push(m.text()));
  page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 200)));
  await page.goto(URL, { waitUntil: 'load', timeout: 240000 });
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) break;
    await sleep(200);
  }
  return { page, logs };
}
const run = (page, jsBody, guardMs = 15000) => {
  const inner = page.evaluate(async (code) => {
    const t = performance.now();
    const before = window.Module.__tick || 0;
    let val, err = null;
    try { val = await eval(code); } catch (e) { err = String(e).slice(0, 220); }
    return { val, err, wall: Math.round(performance.now() - t), ticks: (window.Module.__tick || 0) - before };
  }, jsBody);
  const guard = new Promise(res => setTimeout(() => res({ val: null, err: 'HARD-TIMEOUT', wall: guardMs, ticks: -1 }), guardMs));
  return Promise.race([inner, guard]);
};

// ── A：pause 真让出（本验收的核心判据）──────────────────────────────────────
{
  const { page, logs } = await freshPage();
  const a = await run(page, `Module.eval_async("pause(0.2); 43")`);
  check(a.err === null && Number(a.val) === 0 && a.wall >= 200 && a.ticks > 0,
    '★ A pause 真让出：rc 0、墙上 ≥200ms、ticks>0（G1 时是 blocking/ticks=0）',
    `val=${a.val} wall=${a.wall} ticks=${a.ticks} err=${a.err || '(无)'}`);
  const gate = await page.evaluate(async () => window.__octaveJspiProbe(8000));
  check(gate === 'pass', '★ 能力门冒烟随 pause 接线自动升格为 `pass`（G1 时是 pass-blocking）', `smoke=${gate}`);

  // ── B：unwind_protect 包着 pause ⇒ cleanup 恰好一次 ──
  const bCode = [
    "global __g2 = '';",
    "__g2 = '';",
    'unwind_protect',
    '__web_pause_ms__(80);',
    "__g2 = [__g2, 'T'];",
    'unwind_protect_cleanup',
    "__g2 = [__g2, 'C'];",
    'end_unwind_protect',
    '0'].join('\n');
  const b = await run(page, `Module.eval_async(${JSON.stringify(bCode)})`);
  const bchk = await run(page, `Module.eval_async("assert(strcmp(__g2, 'TC')); 0")`);
  check(b.err === null && Number(b.val) === 0 && bchk.err === null && Number(bchk.val) === 0,
    '★ B cleanup **恰好一次**：__g2 == "TC"（双 C = cleanup 跑两遍；缺 C = 没跑）',
    `val=${b.val}/${bchk.val} err=${b.err || bchk.err || '(无)'}`);

  // ── C：onCleanup 恰好一次（哨兵走 console，可数次数）──
  const cLogsBefore = logs.length;
  const c = await run(page, `Module.eval_async("u = onCleanup(@() disp('OC-SENTINEL-G2')); __web_pause_ms__(60); clear u; 0")`);
  await sleep(300);
  const sentinelCount = logs.slice(cLogsBefore).filter(l => l.indexOf('OC-SENTINEL-G2') >= 0).length;
  check(c.err === null && Number(c.val) === 0 && sentinelCount === 1,
    '★ C onCleanup（析构语义）哨兵**恰好一次**', `count=${sentinelCount} val=${c.val} err=${c.err || '(无)'}`);

  // ── D：pause 之后 error ⇒ catch 抓到原文 ──
  const dCode = ["try", '__web_pause_ms__(60);', "error('boom42');", 'catch err', "disp(['CAUGHT:' err.message]);", 'end', '0'].join('\n');
  const d = await run(page, `Module.eval_async(${JSON.stringify(dCode)})`);
  // ⚠️ `last_error_message` 是 **embind 的 JS 绑定**（build/main.cc），不是 Octave 函数 ——
  //   在 Octave 代码里调它会报 undefined（HANDOFF §7 那条粘连语义的同源事实）。
  const dMsg = await page.evaluate(() => { try { return Module.last_error_message(); } catch (e) { return String(e).slice(0, 80); } });
  check(d.err === null && Number(d.val) === 0 && String(dMsg).indexOf('boom42') >= 0,
    '★ D pause 后 error 被 try/catch 抓到（异常跨挂起点没坏；JS 绑定读到 boom42）',
    `val=${d.val} msg=${String(dMsg).slice(0, 60)} err=${d.err || '(无)'}`);

  // ── E：连续 10 次挂起 ──
  const e = await run(page, `Module.eval_async("__t = 0; for k = 1:10; __web_pause_ms__(60); __t += 1; end; assert(__t == 10); 0")`, 25000);
  check(e.err === null && Number(e.val) === 0 && e.wall >= 600 && e.ticks >= 10,
    '★ E 连续 10 次 pause(60ms)：墙上 ≥600ms、tick 累计 ≥10、循环体内状态正确',
    `val=${e.val} wall=${e.wall} ticks=${e.ticks} err=${e.err || '(无)'}`);

  // ── F：dlopen × 挂起交错（页面装载资产 ↔ pause 交替）──
  const f1 = await run(page, `Module.eval_async("__web_pause_ms__(50); 0")`);
  const f2 = await page.evaluate(async () => { try { await window.OctaveAssets.load('splines'); return 'ok'; } catch (e) { return String(e).slice(0, 120); } });
  const f3 = await run(page, `Module.eval_async("__web_pause_ms__(50); 0")`);
  const f4 = await page.evaluate(async () => { try { await window.OctaveAssets.load('nan'); return 'ok'; } catch (e) { return String(e).slice(0, 120); } });
  const f5 = await run(page, `Module.eval_async("__web_pause_ms__(50); assert(1==1); 0")`);
  check(f1.err === null && f2 === 'ok' && f3.err === null && f4 === 'ok' && f5.err === null,
    '★ F pause ↔ 资产装载交错三轮全稳（B 姿势下 dlopen 不是挂起点，互不干扰）',
    `f1=${f1.err || 'ok'} f2=${f2} f3=${f3.err || 'ok'} f4=${f4} f5=${f5.err || 'ok'}`);
  const aliveF = await run(page, `Module.eval_string("1+1")`);
  check(aliveF.err === null && aliveF.val === 0, 'F 事后解释器存活', `val=${aliveF.val}`);
  await page.close();
}

// ── G：【复审第一优先】重入测量（独立页面 —— 结果可能是楔死，不能污染别人）──────
{
  const { page } = await freshPage();
  const g = await page.evaluate(() => Promise.race([
    (async () => {
      const r1 = { state: 'pending' };
      const p1 = Module.eval_async('pause(0.5); 43').then(
        v => { r1.state = 'settled:' + v; },
        e => { r1.state = 'rejected:' + String(e).slice(0, 80); });
      let r2;
      try { r2 = 'settled:' + await Module.eval_async('1'); }
      catch (e) { r2 = 'rejected:' + String(e).slice(0, 80); }
      await p1;
      return { r1: r1.state, r2 };
    })(),
    new Promise(res => setTimeout(() => res({ r1: 'TIMEOUT', r2: 'TIMEOUT' }), 8000)),
  ])).catch(e => ({ r1: 'bridge:' + String(e).slice(0, 80), r2: 'bridge' }));
  console.log(`   G 重入测量（并发第二条 eval_async）：${JSON.stringify(g)}`);
  // 判据：**产品用法必须串行**（页面命令队列保证）；并发行为如实记录；
  // 判别性断言 = 并发之后同页的**串行**调用仍正常（若页面已楔死则本条 fail 并记档）。
  const seq = await run(page, `Module.eval_async("2+2")`);
  check(seq.err === null && Number(seq.val) === 0,
    `★ G 并发重入之后同页**串行**调用仍正常（并发实测：r2=${g.r2}，r1=${g.r1}）`,
    `val=${seq.val} err=${seq.err || '(无)'}`);
  check(g.r1 !== undefined && g.r2 !== undefined, 'G 并发测量有结论（不沉默）', JSON.stringify(g));
  await page.close();
}
// 事后隔离验证：换新页面一切照常
{
  const { page } = await freshPage();
  const z = await run(page, `Module.eval_async("pause(0.05); 1+1")`);
  check(z.err === null && Number(z.val) === 0 && z.ticks > 0, '★ 事后新页面：挂起链路照常（无跨页污染）', `val=${z.val} ticks=${z.ticks}`);
  await page.close();
}
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
