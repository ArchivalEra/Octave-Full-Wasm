// 探针：`Capabilities`（D4）—— 开机算一次的能力对象，消费者只读
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 为什么有它：D4 的目标是"把 20 处各自为政的能力探测收成一个对象"。收成之后必须有东西
// **盯住它**，否则它会退化成"又一个没人读的字段"（而且它读的是产物身份证 `octave.build.json`，
// 那条链一旦断了是静默的）。
//
// 用法（从仓库原路径直跑）：
//   cd /mnt/hdd/octave-wasm-build/harness && \
//     sh run.sh /mnt/hdd/zcode-projects/Octave-Full-Wasm/test/browser/probe-caps.mjs [URL]
// 默认 URL = http://127.0.0.1:8761/
//
// 判据（绿）：
//   A `window.__octaveCaps` 存在，且 `mode`/`engine` 字段齐全（引擎侧全部是布尔或 null）；
//   B **站点上有身份证时**：`artifact.verdict === "ok"`、`simd === true`、`v128 === 4752`、
//     `fonts === 8`、`jspiEntry === true`（这些数字来自 A1 对现役产物的实测清单）；
//   C 反向断言（**必须能红，也必须能降级**）：把 `octave.build.json` 的请求拦成 404 ⇒
//     页面**照样 ready**（内核容忍缺席），且 `caps.artifact === null` —— 不是抛异常、
//     也不是塞一个假对象。
import { chromium } from 'playwright-core';

const URL = (process.argv[2] && !/^http/.test(process.argv[2]) ? '' : process.argv[2]) || 'http://127.0.0.1:8761/';
const BASE = URL.endsWith('/') ? URL : URL + '/';
const WAIT_MS = 180000;

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 220)}`);
};

const br = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });

// ── 正路：不拦任何请求 ──────────────────────────────────────────────────────
const ctx = await br.newContext();
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
const t0 = Date.now();
await page.goto(BASE, { waitUntil: 'load', timeout: 120000 }).catch(e => console.log('  goto: ' + String(e).slice(0, 120)));
let ready = false;
while (Date.now() - t0 < WAIT_MS) {
  ready = await page.evaluate(() => window.__octaveReady === true && !!window.Module).catch(() => false);
  if (ready) break;
  await new Promise(r => setTimeout(r, 200));
}
check(ready, 'A0 页面 ready（下面才有意义）', ((Date.now() - t0) / 1000).toFixed(1) + 's');

const caps = await page.evaluate(() => {
  const c = window.__octaveCaps;
  if (!c) return null;
  return { mode: c.mode, engine: c.engine, artifact: c.artifact,
           lane: c.lane && c.lane.chosen };
});
check(!!caps, '★ A `window.__octaveCaps` 存在（D4：开机算一次，消费者只读）', caps ? JSON.stringify(caps.engine) : '(无)');
if (caps) {
  const e = caps.engine || {};
  const shapeOk = caps.mode === 'single'
    && typeof e.jspiApi === 'boolean' && typeof e.offscreenCanvas === 'boolean'
    && typeof e.cryptoSubtle === 'boolean' && typeof e.sharedArrayBuffer === 'boolean'
    && (e.crossOriginIsolated === null || typeof e.crossOriginIsolated === 'boolean');
  check(shapeOk, 'A1 `mode`/`engine` 形状正确（布尔或 null，不是 undefined）', JSON.stringify(caps));
  check(e.jspiApi === true, 'A2 本机 Chromium 上 `engine.jspiApi === true`', e.jspiApi);

  const a = caps.artifact;
  if (a) {
    check(a.verdict === 'ok', '★ B1 身份证 `verdict === "ok"`（可部署的那一档）', JSON.stringify(a));
    // ★ B6 双档（2026-09-27）：这个"精确值"是**基础档**的实测值（台账 `wasm_v128`）。
    //   线程档是另一份产物、v128 也不同（台账 `threads_v128`）⇒ 精确值只在基础档那侧断言，
    //   线程档那侧断 `> 0` 并把实际值打出来（它的精确值由 `relink.sh verify threads` 与
    //   `check-deploy-sha.sh` 在**产物层**核）—— 否则探针会把正确的线程档判红（实测踩到）。
    if (caps.lane === 'threads') {
      check(a.simd === true && typeof a.v128 === 'number' && a.v128 > 0,
            '★ B2（线程档）`simd=true` 且 `v128>0`（精确值见台账 `threads_v128`）',
            `v128=${a.v128} lane=${caps.lane}`);
    } else {
      check(a.simd === true && a.v128 === 4752,
            '★ B2 `simd=true` 且 `v128=4752`（基础档；与 A1 实测清单一致）', `v128=${a.v128}`);
    }
    check(a.fonts === 8, 'B3 `fonts === 8`（FreeSans ×4 + FreeMono ×4）', a.fonts);
    check(a.jspiEntry === true, 'B4 `jspiEntry === true`（B 姿势导出在）', a.jspiEntry);
  } else {
    check(false, '★ B 站点上有身份证（`octave.build.json`）⇒ artifact 不该是 null',
      '（把产物身份证同步到站点：`promote-webgl.sh` 会一起拷；或先跑 relink.sh）');
  }
}
check(errs.length === 0, 'C0 全程无 pageerror', errs.length ? errs.slice(0, 2).join(' // ') : '(无)');

// ── 反证：把身份证拦成 404 ⇒ 页面照常 ready，artifact=null（不抛、不造假） ──
const ctx2 = await br.newContext();
await ctx2.route('**/octave.build.json', r => r.fulfill({ status: 404, body: 'nope' }));
const p2 = await ctx2.newPage();
const errs2 = [];
p2.on('pageerror', e => errs2.push(String(e).slice(0, 200)));
const t1 = Date.now();
await p2.goto(BASE, { waitUntil: 'load', timeout: 120000 }).catch(() => {});
let ready2 = false;
while (Date.now() - t1 < WAIT_MS) {
  ready2 = await p2.evaluate(() => window.__octaveReady === true).catch(() => false);
  if (ready2) break;
  await new Promise(r => setTimeout(r, 200));
}
const caps2 = await p2.evaluate(() => (window.__octaveCaps ? { artifact: window.__octaveCaps.artifact, mode: window.__octaveCaps.mode } : null));
check(ready2, '★ D1（反证）身份证 404 时页面**照样 ready**（内核容忍缺席）', ((Date.now() - t1) / 1000).toFixed(1) + 's');
check(caps2 && caps2.artifact === null, '★ D2（反证）`artifact === null` —— 不抛异常、也不塞假对象',
  JSON.stringify(caps2 && caps2.artifact));
check(errs2.length === 0, 'D3（反证）拦掉身份证也不产生 pageerror', errs2.length ? errs2.slice(0, 2).join(' // ') : '(无)');

await br.close();
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
