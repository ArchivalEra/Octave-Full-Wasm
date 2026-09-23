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
// ⚠️ **还要等启动资产装完**（`window.__octaveReady` 在 index.html 里是"整条启动链跑完"
//    —— 含 help 数据与 webgraphics —— 才置真的）。只等解释器可用就往下跑时，页面侧的
//    资产加载器会继续打 `[assets] …就绪` 日志，那些行落进前几次 eval 的捕获窗口，
//    把要匹配的文本挤出截断窗口 ⇒ **偶发假红**（2026-09-23 实测：accept-hdf5 与
//    accept-net 各中过一次；这两条的根因是同一个，不是两条独立的毛病）。
for (let _w = 0; _w < 600; _w++) {
  if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) break;
  await new Promise(r => setTimeout(r, 300));
}
await new Promise(r => setTimeout(r, 400));
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
// ★ 匹配规则（`.githooks/check-wants.py` 会查这一条）：**单个数字**的 want 按「数字边界」匹配，
//   不是裸子串 —— `want='0'` 绝不该被输出里的 `10`/`100`/`13` 满足（`accept-hdf5` 就这么
//   假过了几个月：它查的 `__have_hdf5__` 在 11.3.0 里根本不存在，靠加载器日志里的杂数字对上）。
//   **点也算边界字符**：捕获窗口里有 `11.3.0` 这类版本号，`want='0'` 不该被它最后那位满足
//   （探针 `test/browser/probe-want-matcher.mjs` 把这几条钉在真浏览器里）。
//   多字符 want 保持子串匹配（`'0.7071'`、`'100 100'` 已足够具体；而 Octave 打印 1.5 是
//   `1.5000`，对它用严格词边界反而会误红）。
function wantHit (hay, want) {
  if (/^\d$/.test(want)) return new RegExp('(?<![\\d.])' + want + '(?![\\d.])').test(hay);
  return hay.includes(want);
}

async function ev(expr, label, want) {
  logs.length = 0;
  let r;
  try {
    r = await page.evaluate(x => { const rc = window.Module.eval_string(x); return { rc, err: window.Module.last_error_message() }; }, expr);
  } catch (e) { console.log(`CRASH | ${label} :: ${String(e).slice(0, 120)}`); fail++; return; }
  await new Promise(rr => setTimeout(rr, 700));
  // 断言从 console 输出里找子串。为了不让页面启动日志（资产清单、404 等）
  // 挤掉断言输出，main 里在断言开始前会把 logs 清空一次——见下面那行。
  const full = [...logs].join(' ').replace(/\s+/g, ' ').trim();
  const out = full.slice(0, 180);      // ★ 只用于显示；匹配必须用 full（不许先截断再匹配）
  const ok = r.rc === 0 && (!want || wantHit(full, want));
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
// ⚠️ 原来这里**只断言了 exist("lsode")==5**，从没真的调用过 —— 而 `lsode` 那时
//    一调用就整页 trap（odepack 回调参数个数 4 vs Octave 的 5，wasm 的 call_indirect
//    做精确类型检查所以必炸）。这个"只查存在性"的弱断言正是它藏了很久的原因
//    （HANDOFF §10.3 坑 4）。2026-09-22 修好后，这里改成**真调用 + 数值断言**。
//    注意 `lsode` 的返回约定是 `[x, istate, msg]`，不是 `[t, y]`。
await ev('x=lsode(@(y,t) -y,1,[0 2]); disp(abs(x(end)-exp(-2))<1e-6)', '★ lsode 真调用（|x(2)-e^-2|<1e-6）', '1');

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
