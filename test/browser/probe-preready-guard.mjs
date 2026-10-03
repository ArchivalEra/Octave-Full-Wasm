// 探针：pre-ready eval 守卫（工单 46）—— boot 中途调 eval/feval 必须**快速抛错**，不许挂死
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 背景（工单 40 的残留尖角）：execute_interp 内部有可挂起点（dlopen/资产链），外部
// evaluate 能插进挂起间隙 —— 在那个间隙调解释器入口，NT=4 干净抛错、**NT=8 上主线程
// 卡死在 wasm 里**（任何 JS 层 catch/超时都救不了，embed 门面的 try/catch 同样被穿透）。
// main.cc 的就绪守卫（g_interp_ready + require_interp_ready）把两个入口变成边界上的
// 快速 JS Error（消息含 "not ready"）。
//
// 探针形状 = **票 40 调用方本尊**：单次 page.evaluate 里紧密轮询 feval（1ms 间隔，
// 给挂起中的 boot 让出主线程），把"第一次试探"的结局如实带回来：
//   · 守卫在    ⇒ 启动早期试探抛 "not ready"（≥1 次），随后才成功 ⇒ PASS；
//   · 守卫缺失  ⇒ 启动早期试探**挂死** ⇒ 本 evaluate 永不返回 ⇒ 外层超时红（判别成功）。
// 判据：
//   ① notReady ≥ 1 次（守卫在真实窗口开过火）；
//   ② 成功调用发生 在 notReady 之后（先拒后放，不是一直放行）；
//   ③ 探针结束后页面事件循环仍活；就绪后 eval_string("2+3") rc=0（守卫不误伤）。
// 用法：HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh \
//        test/browser/probe-preready-guard.mjs <URL>
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
let pass = 0, fail = 0;
const check = (ok, name, detail = '') => {
  console.log(`${ok ? 'PASS' : 'fail'} | ${name}${detail ? ' :: ' + detail : ''}`);
  ok ? pass++ : fail++;
};

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
page.on('pageerror', e => console.log('   [pageerror] ' + String(e).slice(0, 160)));

await page.goto(URL, { waitUntil: 'load', timeout: 120000 });

// ★ 票 40 调用方形状：从 feval 导出那刻起紧密试探，直到第一次成功或 90s。
const r = await page.evaluate(async () => {
  const t0 = Date.now();
  // 先等导出挂上（wasm 实例化完成）
  while (Date.now() - t0 < 30000) {
    if (typeof window.Module?.feval === 'function') break;
    await new Promise(res => setTimeout(res, 5));
  }
  if (typeof window.Module?.feval !== 'function') {
    return { fatal: 'feval 30s 未导出（页面坏）' };
  }
  let notReady = 0, firstErr = '', success = false, afterMs = -1, otherErr = 0;
  while (Date.now() - t0 < 90000) {
    try {
      window.Module.feval('disp', ['x'], 1);
      success = true;
      afterMs = Date.now() - t0;
      break;                                   // 第一次成功即停（就绪了）
    } catch (e) {
      const m = String((e && e.message) || e);
      if (/not ready/i.test(m)) { notReady++; if (!firstErr) firstErr = m; }
      else otherErr++;
    }
    await new Promise(res => setTimeout(res, 1));   // 让主线程（给挂起中的 boot 呼吸）
  }
  return { notReady, firstErr, success, afterMs, otherErr, elapsed: Date.now() - t0 };
});
if (r.fatal) { console.log('fail | ' + r.fatal); await browser.close(); process.exit(1); }
// ①（记录性）：外部轮询能否踩进"旗标关"的缝隙取决于 boot 时序（实测首试 778ms 已在
//   execute_interp 之后）—— 它**不可靠**，所以硬断言放在 ⑤（quit 后的确定性状态）。
console.log(`   [info] notReady=${r.notReady} success=${r.success} afterMs=${r.afterMs} otherErr=${r.otherErr}`);
check(r.success, '② 启动期试探从不挂死、最终成功（调用方形状回归 = 票 40 的形状）',
      `afterMs=${r.afterMs}`);
check(r.otherErr === 0, '②b 无异型错误（不是靠崩过去的）', `otherErr=${r.otherErr}`);

// ③ 页面事件循环仍活 + 就绪后正常 eval（守卫不误伤）。
let ready = false;
for (let i = 0; i < 600; i++) {
  if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) { ready = true; break; }
  await new Promise(res => setTimeout(res, 200));
}
check(ready, '③ __octaveReady 就绪（两段式）');
const rc = await page.evaluate(() => { try { return window.Module.eval_string('2+3'); } catch (e) { return -9; } });
check(rc === 0, '④ 就绪后 eval_string("2+3") rc=0（守卫不误伤）', `rc=${rc}`);

// ⑤ ★ 确定性断言（旗标关的黑盒等价态）：quit_interp 销毁解释器并复位就绪旗标 ——
//    此刻再调 eval_string，**守卫在** ⇒ 快速抛 "not ready"（干净 Error）；
//    **守卫缺** ⇒ 解引用 null interpreter ⇒ wasm 崩溃（messy，非 not ready）。
//    这是同一代码路径（旗标 false ⇒ 边界抛错），boot 窗口保护与它同源。
const post = await page.evaluate(() => {
  const out = {};
  try { window.Module.quit_interp(); out.quit = 'ok'; }
  catch (e) { out.quit = 'throw: ' + String((e && e.message) || e).slice(0, 60); }
  try { window.Module.eval_string('1'); out.eval = { threw: false }; }
  catch (e) { out.eval = { threw: true, msg: String((e && e.message) || e) }; }
  return out;
});
check(post.quit === 'ok' && post.eval.threw && /not ready/i.test(post.eval.msg),
      '⑤ 旗标关（quit 后）eval_string 快速抛 "not ready"（非 wasm 崩溃）',
      `quit=${post.quit} msg=${(post.eval.msg || '').slice(0, 70)}`);

await browser.close();
console.log(`=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
