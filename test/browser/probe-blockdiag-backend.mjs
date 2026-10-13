// 探针：**块图后端能力** —— 我们的引擎能不能支撑 Simulink 式仿真（2026-10-13）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 为什么有这个探针（用户点令）──────────────────────────────────────────────
// 用户挑战："pathsim 那种小玩意真能和 Xcos 碰瓷吗？我们硬生生把 Octave 从 500MB 压到
// 8MB。" ⇒ 这个挑战是对的，而判据不该是"pathsim 好不好"，而是"**我们自己的引擎够不够**"。
// 块图仿真（Simulink/Xcos 范式）需要三样：**建模 + 求解 + 控制器设计**。本探针逐条实测
// 本仓现役 wasm 是否具备（跑在真页面上，不是查文档）。
//
// ── 判据（每条都对应块图里的一类块）──────────────────────────────────────────
//   ① 状态空间建模 + 阶跃响应   ← 线性系统块（Simulink 的 State-Space / Transfer Fcn）
//   ② 传递函数 + 仿真            ← Transfer Fcn 块
//   ③ **非线性 ODE 求解**        ← 块图的核心（每个块是一个 ODE 项，整图是一个 ODE 系统）
//   ④ 控制器设计（LQR）          ← 控制器设计块
//   ⑤ 零极点/根轨迹              ← 分析块
//   rc=0 ⇒ 五条全过（引擎具备块图后端）；rc=1 ⇒ 有缺口（如实报哪条）；rc=3 ⇒ 环境问题。
//
// 用法：node test/browser/probe-blockdiag-backend.mjs [URL]
import { chromium } from 'playwright-core';
const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const br = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await br.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
await page.waitForFunction(() => window.__octaveReady === true, null, { timeout: 300000 })
  .catch(() => {});
await new Promise(r => setTimeout(r, 1500));
if (!(await page.evaluate(() => window.__octaveReady === true).catch(() => false))) {
  console.log('ENV: 页面没起来 ⇒ rc=3，这不是结论');
  await br.close(); process.exit(3);
}

let pass = 0, fail = 0;
const check = (ok, label, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 180)}`); };

async function ev (code) {
  return await page.evaluate((c) => {
    try {
      window.Module.eval_string("fid=fopen('/tmp/__bdg.txt','w'); " + c + "; fclose(fid); 0");
      return window.Module.FS.readFile('/tmp/__bdg.txt', { encoding: 'utf8' });
    } catch (e) { return 'JS-ERR ' + String(e).slice(0, 120); }
  }, code);
}

// 前置：control 包提供 ss/tf/lqr/zpkdata（货架/随站都有）
try { await page.evaluate(async () => { await window.Module.eval_async('pkg load control; 0'); }); }
catch (e) { console.log('（control 装载失败：' + String(e).slice(0, 80) + '）'); }
// 前置：`__ode15__`（SUNDIALS）是**懒加载资产**，不先装它 ode15s 会**静默返回空**
//   —— 实测踩到：第一版没装，③b 报空、探针误判"引擎有缺口"。装资产是块图用刚性求解器的前提。
try {
  await page.evaluate(async () => { await window.OctaveAssets.load('__ode15__'); });
  console.log('（__ode15__ 已装载）');
} catch (e) { console.log('（__ode15__ 装载失败：' + String(e).slice(0, 80) + '）'); }

// ① 状态空间 + 阶跃响应
const r1 = await ev("sys=ss([-1 0;0 -2],[1;1],[1 0],0); [y,t]=step(sys,0:0.1:2); fprintf(fid,'|len=%d yend=%.4f', numel(y), y(end))");
check(/\|len=\d+ yend=0\.86/.test(r1), '① 状态空间建模 + 阶跃响应（State-Space 块）', r1);

// ② 传递函数 + 仿真
const r2 = await ev("s=tf('s'); G=1/(s^2+0.5*s+1); [y,t]=step(G,0:0.1:5); fprintf(fid,'|yend=%.4f', y(end))");
check(/\|yend=1\.0/.test(r2), '② 传递函数 + 仿真（Transfer Fcn 块）', r2);

// ③ 非线性 ODE（块图核心）
const r3 = await ev("f=@(t,x) [x(2); -0.5*x(2)-sin(x(1))]; [t,x]=ode45(f,[0 10],[1;0]); fprintf(fid,'|steps=%d xend=%.4f', numel(t), x(end,1))");
check(/\|steps=\d+ xend=-0\.0/.test(r3), '★ ③ 非线性 ODE 求解（块图核心；ode45）', r3);

// ③b 刚性 ODE（ode15s —— pathsim 没有的那类）
const r3b = await ev("f=@(t,y) -1000*(y-cos(t))-sin(t); [t,y]=ode15s(f,[0 1],1); fprintf(fid,'|n=%d yend=%.4f', numel(t), y(end))");
check(/\|n=\d+ yend=0\.5/.test(r3b), '★ ③b **刚性** ODE（ode15s —— 块图里刚性系统的唯一出路）', r3b);

// ④ 控制器设计（LQR）
const r4 = await ev("K=lqr([0 1;-1 -1],[0;1],eye(2),1); fprintf(fid,'|K=[%.3f %.3f]', K(1), K(2))");
check(/\|K=\[0\.4/.test(r4), '④ 控制器设计（LQR）', r4);

// ⑤ 零极点 / 根轨迹
const r5 = await ev("s=tf('s'); G=(s+3)/(s^2+2*s+2); [z,p,k]=zpkdata(G); fprintf(fid,'|np=%d nz=%d', numel(p{1}), numel(z{1}))");
check(/\|np=2 nz=1/.test(r5), '⑤ 零极点分析（zpkdata）', r5);

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await br.close();
if (fail) { console.log('结论：引擎**有缺口**（上面 fail 的条目就是块图会缺的能力）'); process.exit(1); }
console.log('结论：本仓引擎**已具备块图后端**（建模 + 求解 + 控制器设计，含刚性 ODE）'
  + ' ⇒ 块图前端可以建在**这个引擎**上，不必引第二个运行时（Pyodide）。');
process.exit(0);
