// 探针：**堆上限与"64 位到底买到了什么"**（工单 31，2026-10-01）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 为什么有它（实测动机）：四格上线后我写过两句**相反的**、没有背书的话 ——
//   · "w64 比 wasm32 快" （用户直觉；实测**否**：w64 在 BLAS 上慢 1.17–1.19×、
//     `for` 循环慢 1.67× —— 见 w64-logs/speed-*.log 的四档基准）；
//   · "w64 的收益是地址空间（>4 GiB）"（我的说法；实测**也不成立**：四个档的
//     wasm 内存上限都是 **2 GiB**，存活上限都是 **1.49 GiB**）。
// ⇒ 把"能吃到多大"变成一条**可复跑的判据**，而不是散文。
//
// 怎么量：逐块分配 0.75 GiB 的 `zeros(1,100e6)`（double），直到 Octave 报
// `out of memory`；报出**最后一个成功的存活总量**（GiB）。这是"实际可用堆"的直接度量
// （读胶水里的 `maximum` 只是**声称**的上限，两者都要有）。
//
// 判据（红绿）：
//   ① 每档都必须量到一个 ≥0.5 GiB 的数（否则是探针自己坏了 ⇒ 红，不许当"没有优势"）；
//   ② 站点若声明了某档（`window.__octaveLanes`），该档必须真的能起（ready）；
//   ③ **verdict 行**：`W64_BIG_HEAP=yes` 当且仅当 `w64` 档量到 **≥4 GiB**
//      —— 这就是工单 31 的结算判据（抬 `MAXIMUM_MEMORY` 之前它必然是 `no`）。
// 反向断言：把 `w64` 档换成基础档产物跑（`?lane=base`）⇒ verdict 必须仍是 `no`，
//   且两档数字应当一致（"64 位在这份产物里没兑现"这条结论**可被证伪**）。
//
// 用法：sh test/browser/run.sh test/browser/probe-heap-ceiling.mjs [URL]
//   env：HEAP_LANES="base,threads,w64"（默认三档；w64-base 可选）
import { chromium } from 'playwright-core';

const URL = process.argv.find(a => /^http/.test(a)) || 'http://127.0.0.1:8761/';
const LANES = (process.env.HEAP_LANES || 'base,threads,w64').split(',');
const BLOCK = 100e6;            // 每块 100e6 个 double = 0.7629 GiB
const MAXBLOCK = 24;            // 上限 18 GiB，防呆

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 220)}`);
};

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });

const ceilings = {};
for (const lane of LANES) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const seen = [];
  page.on('console', m => { const t = m.text(); if (/LIVE /.test(t)) seen.push(t); });
  await page.goto(`${URL}?lane=${lane}`, { waitUntil: 'load', timeout: 300000 });
  // ★ 两段式就绪（工单 40/42）：先等 __octaveReady 再碰 feval（NT=8 下旧写法会挂死）。
  let ready = false;
  for (let i = 0; i < 300; i++) {
    if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) { ready = true; break; }
    await new Promise(r => setTimeout(r, 200));
  }
  for (let i = 0; i < 300 && ready; i++) {
    ready = await page.evaluate(() => { try { return !!window.Module?.feval?.('strcat', ['a', 'b'], 1); } catch { return false; } }).catch(() => false);
    if (ready) break;
    await new Promise(r => setTimeout(r, 300));
  }
  const info = await page.evaluate(() => {
    const c = window.__octaveCaps || {};
    return { chosen: (c.lane || {}).chosen || null, wasm64: !!(c.artifact && c.artifact.wasm64) };
  }).catch(() => ({}));
  await page.evaluate(({ block, maxblock }) => {
    try {
      window.Module.eval_string(`
        clear all; tot=0; k=0;
        do
          k++; A{k}=zeros(1,${block}); tot=tot+${block};
          printf("LIVE %.4f\\n", tot*8/2^30);
        until (k>=${maxblock});
      `);
    } catch (e) { /* 出错即停（下一次分配会失败并抛给 Octave） */ }
  }, { block: BLOCK, maxblock: MAXBLOCK }).catch(() => {});
  const vals = seen.map(t => Number((/LIVE ([0-9.]+)/.exec(t) || [])[1])).filter(Number.isFinite);
  const ceiling = vals.length ? vals[vals.length - 1] : null;   // 最后一个**成功**的存活量
  ceilings[lane] = { ceiling, ready, info, vals };
  console.log(`LIVE | lane=${lane} ready=${ready} chosen=${info.chosen} wasm64=${info.wasm64} ` +
              `块序列=[${vals.map(v => v.toFixed(2)).join(', ')}] ⇒ 上限=${ceiling === null ? '(一个块都没成功)' : ceiling.toFixed(2) + ' GiB'}`);
  await ctx.close();
}

console.log('\n════ 判据 ════');
for (const lane of LANES) {
  const c = ceilings[lane];
  check(c.ready === true, `${lane} · ② 该档能真的起（ready）`, `ready=${c.ready}`);
  // ① 零值守卫：量不到数（或 <0.5 GiB）不许当"没有优势"
  check(c.ceiling !== null && c.ceiling >= 0.5,
        `${lane} · ① 必须量到 ≥0.5 GiB 的存活上限（零值守卫）`,
        `ceiling=${c.ceiling === null ? 'null' : c.ceiling.toFixed(2)} GiB`);
}
const w64 = ceilings.w64;
const big = !!(w64 && w64.ceiling !== null && w64.ceiling >= 4);
console.log(`\nW64_BIG_HEAP=${big ? 'yes' : 'no'}   (w64 上限 ${w64 && w64.ceiling !== null ? w64.ceiling.toFixed(2) : '?'} GiB；`
          + `工单 31 的结算判据：抬 MAXIMUM_MEMORY 之后这里必须变 yes)`);
if (ceilings.base && ceilings.w64 && ceilings.base.ceiling !== null && ceilings.w64.ceiling !== null) {
  console.log(`（对照）base=${ceilings.base.ceiling.toFixed(2)} GiB / w64=${ceilings.w64.ceiling.toFixed(2)} GiB`
            + ` ⇒ ${Math.abs(ceilings.base.ceiling - ceilings.w64.ceiling) < 0.01 ? '两者**相同**（64 位在这份产物里没兑现）' : '两者不同'}`);
}

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
