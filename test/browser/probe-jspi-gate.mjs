// 探针（G0）：**JSPI 能力门** —— 两个独立 gate，两条路都要测
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 为什么要有"两个独立 gate"（GPT 复审的红线）：`typeof WebAssembly.Suspending` **只说明 API 在**，
// 不说明它在**这个产物、这个解释器**上真能用 —— Pyodide 至今仍有 JSPI 稳定性 issue，还给"禁用
// JSPI"的 workaround。所以门有两道：① API 存在性；② **Octave 级冒烟**（真跑一次 suspending
// 入口：等一小段 + 确认等待期间页面定时器**还在跑** —— busy-loop 会让 ticks=0，只看"值对"会被骗）。
//
// 单产物策略（Gate 0 已实测）：把 `WebAssembly.Suspending`/`promising` 删掉之后，`-sJSPI` 产物
// **仍能加载**，只是被包过的导出不存在 ⇒ 页面照常可用，依赖 JSPI 的入口**清晰报错**。
//
// ★ 本探针的断言**跟着产物走、不跟着愿望走**：现在产物里还没有 suspending 入口（G1 才加），
//   于是 `smoke` 应当是 `no-entry`；**一旦 `entry` 非空（G1 之后），冒烟就必须 `pass`** ——
//   这条断言到那时会自动变成硬要求，不需要改探针。
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/probe-jspi-gate.mjs [URL]
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });

let pass = 0, fail = 0;
const check = (ok, label, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 200)}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function open (init) {
  const ctx = await browser.newContext();
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => logs.push(m.text()));
  page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 150)));
  await page.goto(URL, { waitUntil: 'load', timeout: 240000 });
  const t = Date.now();
  while (Date.now() - t < 300000) {
    if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) break;
    await sleep(200);
  }
  await sleep(1500);      // 给冒烟（G1 之后是 pause(0.2)）跑完的时间
  return { page, logs };
}

// ── ① 正常浏览器：API 门必须过；冒烟按产物现状给结论 ─────────────────────────
{
  const { page, logs } = await open(null);
  // ⚠️ 冒烟**不在开机时自动跑**（2026-09-24 事故：坏绑定会让开机自检把整页卡死）⇒ 这里**按需**触发。
  const J = await page.evaluate(async () => {
    const j = window.__octaveJspi || {};
    const before = j.smoke;
    let after = null;
    try { after = await window.__octaveJspiProbe(5000); } catch (e) { after = 'throw:' + String(e).slice(0, 60); }
    return { api: j.api, smoke: j.smoke, entry: j.entry, note: j.note, before, after,
             susp: typeof WebAssembly.Suspending, prom: typeof WebAssembly.promising,
             hasProbe: typeof window.__octaveJspiProbe === 'function',
             hasRequire: typeof window.__octaveJspiRequire === 'function' };
  });
  check(J.hasRequire && J.hasProbe && typeof J.api === 'boolean',
    '★ 页面暴露能力门 `__octaveJspi` + **按需**冒烟 `__octaveJspiProbe()` + `__octaveJspiRequire()`', JSON.stringify(J).slice(0, 200));
  check(J.before === 'unprobed', '★ 开机**不自动**跑冒烟（`unprobed`）—— 坏绑定不会在开机路径上把页面卡死', `before=${J.before}`);
  check(J.api === true && J.susp === 'function' && J.prom === 'function',
    '★ gate① API 门：Chromium 里 `Suspending`/`promising` 都在（api=true）', `susp=${J.susp} prom=${J.prom}`);
  const known = ['unprobed', 'pending', 'pass', 'pass-blocking', 'fail', 'timeout', 'no-entry', 'api-missing'];
  check(known.indexOf(J.smoke) >= 0, '★ gate② 冒烟给出**已知状态之一**（不是沉默）', `smoke=${J.smoke} note=${J.note}`);
  // ★ 跟着产物走的硬要求：有入口就必须真过（G1 之后自动生效）
  if (J.entry) {
    // G1 之后：值对 **且** 等待期间定时器在跑 = pass；值对但 ticks=0 = pass-blocking（挂起有了、
    // `pause` 还没接上 —— 那是 G2 的活）；都不满足 = fail。**绝不允许 timeout/永不 settle**。
    check(J.smoke === 'pass' || J.smoke === 'pass-blocking',
      '★ 有 suspending 入口 ⇒ 冒烟必须给出 pass 或 pass-blocking（不许 timeout / 不许永不 settle）',
      `entry=${J.entry} smoke=${J.smoke} ${J.note}`);
  } else {
    check(J.smoke === 'no-entry',
      '本产物还没有 suspending 入口 ⇒ smoke=no-entry（G1 加了 `eval_async` 之后这条会变成"必须 pass"）',
      `smoke=${J.smoke} ${J.note}`);
  }
  // 可用时 require 必须放行（返回 null）
  const avail = await page.evaluate(() => window.__octaveJspiRequire('ginput'));
  check(J.smoke === 'no-entry' || J.smoke === 'fail' ? avail !== null : avail === null,
    '`__octaveJspiRequire()` 与冒烟结论一致（可用 ⇒ null；不可用 ⇒ 一句人话）', String(avail).slice(0, 180));
  check(J.smoke === 'no-entry' || J.smoke === 'fail' ? /JSPI|Chrome/.test(String(avail)) : true,
    '不可用时那句话点明"需要 JSPI"与支持的浏览器版本', String(avail).slice(0, 180));
}

// ── ② 把 JSPI API 删掉：产物**仍要能加载**、页面**仍要能用**、依赖项报**明确**错 ──
{
  const { page, logs } = await open(() => {
    try { delete WebAssembly.Suspending; } catch (e) {}
    try { delete WebAssembly.promising; } catch (e) {}
  });
  const J = await page.evaluate(async () => {
    const before = window.__octaveJspi.smoke;
    let after = null;
    try { after = await window.__octaveJspiProbe(3000); } catch (e) { after = 'throw'; }
    return { api: window.__octaveJspi.api, smoke: window.__octaveJspi.smoke, before, after,
             susp: typeof WebAssembly.Suspending };
  });
  check(J.api === false && J.susp === 'undefined', '★ 删掉 API 之后 gate① 如实为 false', `api=${J.api} susp=${J.susp}`);
  check(J.smoke === 'api-missing', '★ gate② 状态为 `api-missing`（不是沉默、不是 TypeError）', `smoke=${J.smoke}`);
  const r = await page.evaluate(() => {
    const rc = window.Module.eval_string('2+2');
    return { rc, err: window.Module.last_error_message() };
  });
  check(r.rc === 0, '★ **没有 JSPI 的浏览器里产物照样起得来**（单产物策略的关键证据）', `rc=${r.rc} err=${String(r.err).slice(0, 80)}`);
  const msg = await page.evaluate(() => window.__octaveJspiRequire('ginput'));
  // ★ 断言口径 2026-09-25 随第三轮复审翻面：版本号（尤其 Firefox）各方口径不一 ⇒ 文案改为
  //   "点名浏览器 + 以能力检测为准"，不再硬编码版本号（GPT-REVIEW-3-bridge-reply §7）。
  check(typeof msg === 'string' && /JSPI/.test(msg) && /Chromium|Chrome|Firefox|Safari/i.test(msg),
    '★ 依赖 JSPI 的入口得到**明确一句话**（点名支持的浏览器 + 能力检测口径），不是 `TypeError`', String(msg).slice(0, 200));
  const typerr = logs.filter(l => /WebAssembly\.Suspending is not a constructor|is not a function/.test(l));
  check(typerr.length === 0, '★ 全程没有 `WebAssembly.Suspending is not a constructor` 这类裸 TypeError', typerr.slice(0, 1).join(' ') || '(无)');
}

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
console.log('（★ 是判别性断言；`entry` 一旦非空，冒烟就自动变成硬要求 —— 探针不用改）');
await browser.close();
process.exit(fail ? 1 : 0);
