// 选档器的**宿主侧纯函数自检**（工单 23；秒级、无浏览器、无依赖）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 为什么有它：`bridge/lane.js` 的 `pickFrom(env)` 是纯函数（喂一份"环境事实"⇒ 返回选哪一档），
// 所以"站点只部署了 base 时**不许**选 w64"这件事可以在**宿主上**秒级证伪
// —— 不必每改一次就去浏览器里跑四格。浏览器侧的端到端判据仍在 `probe-lane.mjs`。
//
// 用法：node build/113/lane-pick-selftest.mjs        （接在 build/glue-selftest.sh 里）
import { readFileSync } from 'node:fs';

const HERE = new URL('.', import.meta.url).pathname;
const SRC = readFileSync(HERE + '../../bridge/lane.js', 'utf8');

function pick (env) {
  const g = Object.assign({ self: null }, env);
  g.self = g;
  new Function('global', 'self', SRC)(g, g);
  return g.octaveLaneState;
}

const SAB = function () {};
const two = ['base', 'w64'];   // 两格（threads/w64-base 双死档）
const onlyBase = ['base'];   // 无清单兜底 = [base]
const CASES = [
  // ① 双档站（8761/8768）：引擎有 memory64 也**不许**选 w64（那档没部署）
  ['站点只有 base + COI + m64 ⇒ base（不选没部署的 w64）',
   { crossOriginIsolated: true, SharedArrayBuffer: SAB, memory64: true, __octaveLanes: onlyBase }, 'base'],
  ['双档站 + 无 COI ⇒ base',
   { crossOriginIsolated: false, memory64: true, __octaveLanes: two }, 'base'],
  // ② **无清单**（老站点/第三方镜像）⇒ 历史形态，同样不许 w64
  ['无清单 + COI + m64 ⇒ base（兜底只认 base；threads 已删）',
   { crossOriginIsolated: true, SharedArrayBuffer: SAB, memory64: true }, 'base'],
  // ③ 四格站（8848）：能力最优照旧
  ['四格站 + COI + m64 ⇒ w64',
   { crossOriginIsolated: true, SharedArrayBuffer: SAB, memory64: true, __octaveLanes: two }, 'w64'],
  ['★ 无 COI（哪怕有 m64）⇒ base（master 线必须 COI；w64-base 死档）',
   { crossOriginIsolated: false, memory64: true, __octaveLanes: two }, 'base'],
  ['三格站 + COI + 无 m64 ⇒ base（wasm32 永远单线程——threads 已删的反向断言）',
   { crossOriginIsolated: true, SharedArrayBuffer: SAB, memory64: false, __octaveLanes: two }, 'base'],
  // ④ 退档与红线
  ['只有 base 的站 + COI ⇒ base（退档，且 base 是底线）',
   { crossOriginIsolated: true, SharedArrayBuffer: SAB, memory64: true, __octaveLanes: ['base'] }, 'base'],
  ['清单只有 w64 但引擎无 m64 ⇒ base（不选不能跑的档）',
   { crossOriginIsolated: true, SharedArrayBuffer: SAB, memory64: false, __octaveLanes: ['w64', 'base'] }, 'base'],
  // ⑤ worker 宿主（B6 的红线：worker 里不许自动选线程档）
  ['worker 宿主（importScripts 在场）⇒ base',
   { importScripts: function () {}, crossOriginIsolated: true, SharedArrayBuffer: SAB, memory64: true, __octaveLanes: two }, 'base'],
];

let pass = 0, fail = 0;
for (const [name, env, want] of CASES) {
  let got;
  try { got = pick(env).lane; } catch (e) { got = 'THREW: ' + String(e).slice(0, 60); }
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${name.padEnd(52)} :: got=${got}`);
}
console.log(`=== lane-pick 自检：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
