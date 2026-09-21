// 批次 3 验收：R1 SUNDIALS → ode15s / ode15i（懒加载 .oct，主 wasm 未重链）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/accept-ode15.mjs [URL]
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text().slice(0, 300)));
page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 300)));
await page.goto(URL, { waitUntil: 'load', timeout: 240000 });
const t = Date.now();
while (Date.now() - t < 300000) {
  const ok = await page.evaluate(() => { try { return !!window.Module?.feval?.('strcat', ['a', 'b'], 1); } catch { return false; } }).catch(() => false);
  if (ok) break; await new Promise(r => setTimeout(r, 800));
}
console.log(`URL=${URL} ready=${((Date.now() - t) / 1000).toFixed(1)}s`);

// index.html 会在 ready 之后自动装载 dldfcn 核心组，那批日志（资产清单、
// 逐个资产的加载消息）会落进 console，把紧接着的断言输出挤出截取窗口。
// 等它落定再清一次日志，断言才稳定。__ode15__ 不在自动组里，所以下面的
// "未加载 → exist=0" 前置断言仍然成立。
await page.evaluate(async () => {
  if (!window.OctaveAssets) return;
  for (let i = 0; i < 100; i++) {
    const got = window.OctaveAssets.loaded().length;
    if (got >= 7) return;
    await new Promise(r => setTimeout(r, 200));
  }
}).catch(() => {});
logs.length = 0;

let pass = 0, fail = 0;
async function ev(expr, label, want) {
  logs.length = 0;
  let r;
  try {
    r = await page.evaluate(x => { const rc = window.Module.eval_string(x); return { rc, err: window.Module.last_error_message() }; }, expr);
  } catch (e) { console.log(`CRASH | ${label} :: ${String(e).slice(0, 120)}`); fail++; return; }
  await new Promise(rr => setTimeout(rr, 700));
  // 断言从 console 输出里找子串。为了不让页面启动日志（资产清单、404 等）
  // 挤掉断言输出，main 里在断言开始前会把 logs 清空一次——见下面那行。
  const out = [...logs].join(' ').replace(/\s+/g, ' ').trim().slice(0, 180);
  const ok = r.rc === 0 && (!want || out.includes(want));
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${out || ('rc=' + r.rc + ' ' + r.err.slice(0, 120))}`);
}

console.log('--- 懒加载语义 ---');
await ev('disp(exist("__ode15__"))', '未加载 → exist __ode15__ = 0（SUNDIALS 不在主 wasm 里）', '0');
const lr = await page.evaluate(async () => {
  try { await window.OctaveAssets.load('__ode15__'); return 'ok'; } catch (e) { return 'ERR ' + String(e).slice(0, 120); }
});
console.log('  load __ode15__:', lr);
await ev('disp(exist("__ode15__"))', '.oct 装载后 → exist = 3', '3');

console.log('--- ode15s 刚性方程（精确解已知）---');
// y' = -1000(y - cos t) - sin t, y(0)=1  →  精确解 y = cos t
await ev('[t,y]=ode15s(@(t,y) -1000*(y-cos(t))-sin(t), [0 1], 1); disp(numel(t))', 'ode15s 完成（步数）', null);
await ev('disp(max(abs(y-cos(t))))', '★ 与精确解 y=cos(t) 的最大误差', null);
await ev('disp(max(abs(y-cos(t))) < 1e-3)', '★ 误差达标（<1e-3）', '1');
// 松弛到非刚：应退回普通行为
await ev('[t2,y2]=ode15s(@(t,y) -y, [0 2], 1); disp(abs(y2(end)-exp(-2)))', '非刚衰减 y2 与 e^-2 的差（默认 RelTol=1e-3）', null);
await ev('[t2,y2]=ode15s(@(t,y) -y, [0 2], 1, odeset("RelTol",1e-8,"AbsTol",1e-10)); disp(abs(y2(end)-exp(-2)))', '★ 收紧容差后误差（应 <1e-6）', null);

console.log('--- Van der Pol（经典刚性测试）---');
await ev("vdp=@(t,y) [y(2); 1000*(1-y(1)^2)*y(2)-y(1)]; [tv,yv]=ode15s(vdp,[0 20],[2;0]); disp(rows(tv)>10)", '★ Van der Pol mu=1000 跑通', '1');
await ev("disp(max(abs(yv(:,1)))<3)", '★ 解有界（数值稳定）', '1');

console.log('--- ode15i 隐式求解 ---');
await ev('[ti,yi]=ode15i(@(t,y,yp) yp + y, [0 2], 1, -1); disp(abs(yi(end)-exp(-2)))', '★ ode15i 隐式求解误差（默认容差）', null);
await ev('[ti,yi]=ode15i(@(t,y,yp) yp + y, [0 2], 1, -1, odeset("RelTol",1e-8,"AbsTol",1e-10)); disp(abs(yi(end)-exp(-2))<1e-6)', '★ ode15i 收紧容差后 <1e-6', '1');

console.log('--- 回归：原有求解器不受影响 ---');
await ev('[t45,y45]=ode45(@(t,y) -y, [0 2], 1); disp(abs(y45(end)-exp(-2))<1e-5)', 'ode45 仍正常', '1');
await ev('disp(exist("ode23"))', 'ode23 在', '2');
await ev('disp(exist("lsode"))', 'lsode 在（builtin）', '5');

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
