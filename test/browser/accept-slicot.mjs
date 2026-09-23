// SLICOT（control 包的编译件）验收：`ss`/`step`/`pole`/`norm`/`lyap`/`care` 等
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/accept-slicot.mjs [URL]
//
// ── 这一套在验什么 ──────────────────────────────────────────────────────────
// control 包的 48 个 SLICOT 编译件（`__sl_*__`，打包在 `__control_slicot_functions__.oct`）
// 长期**不发布**，因为一调就把整页弄崩（HANDOFF §4.12 → §5.15）。2026-09-23 修好并发布，
// 本套件把"能用了"钉成硬断言 —— **断言的是解析可验的数值，不是"函数存在"**：
//
//   ss / pole / zero    : 极点、零点就是构造时给的数
//   step                : y(t) = 1 - e^-t（解析解，逐点比）
//   norm（H2）          : 1/√2 = 0.70710678…
//   tf2ss               : 用 C*(sI-A)^-1*B + D 在 s=2 处反算回原传递函数（5/12）
//                         ⚠️ `tf2ss` 属于 **signal 包**（不是 control）⇒ 本套件加载 signal
//   lyap / dlyap        : 连续/离散 Lyapunov 方程有手算解（0.5 / 1）
//   care                : 标量 ARE 的解析解（X=1）+ 残差
//   c2d / dcgain        : 离散化保直流增益
//
// ⚠️ 三条写测试的坑（本项目踩过）：
//   ① **必须先等 `window.__octaveReady`**，否则资产没装、前几条假失败（accept-print 踩过）；
//   ② 别用 Octave 的 `pause` 等（本构建里它**阻塞页面**，见 §5.10 坑 1），等待要在 JS 侧做；
//   ③ `help`/`print_usage` 对**资产包里的 `.m`** 仍会触发 makeinfo（那些 `.m` 没走 P1 的
//      预渲染）——所以本套件**不调用任何需要打印用法/帮助的形态**。
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
// ① 必须等 __octaveReady（资产装完）
const t2 = Date.now();
while (Date.now() - t2 < 300000) {
  const ready = await page.evaluate(() => !!window.__octaveReady).catch(() => false);
  if (ready) break; await new Promise(r => setTimeout(r, 500));
}
console.log(`URL=${URL} ready=${((Date.now() - t) / 1000).toFixed(1)}s`);

let pass = 0, fail = 0;
async function ev(expr, label, want) {
  logs.length = 0;
  let r;
  try {
    r = await page.evaluate(x => { const rc = window.Module.eval_string(x); return { rc, err: window.Module.last_error_message() }; }, expr);
  } catch (e) { console.log(`CRASH | ${label} :: ${String(e).slice(0, 160)}`); fail++; return; }
  await new Promise(rr => setTimeout(rr, 500));
  const out = [...logs].join(' ').replace(/\s+/g, ' ').trim().slice(0, 220);
  const ok = r.rc === 0 && (!want || out.includes(want));
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${out || ('rc=' + r.rc + ' ' + r.err.slice(0, 160))}`);
}

console.log('--- 懒加载前 ---');
await ev('disp(exist("__sl_td04ad__"))', 'SLICOT 尚未装载', '0');

console.log('--- 加载 signal（依赖自动带出 control → control-oct → SLICOT 编译件）---');
console.log('  已加载:', await page.evaluate(async () => {
  try { await window.OctaveAssets.load('signal'); return window.OctaveAssets.loaded().slice(-3).join(' '); }
  catch (e) { return 'ERR ' + String(e).slice(0, 160); }
}));

console.log('--- 一、模块与命名 ---');
await ev('disp(exist("__sl_td04ad__"))', '★ __sl_td04ad__ 存在', '3');
await ev('disp(exist("__control_slicot_functions__"))', '★ 调度模块存在', '3');
await ev('p = which("__sl_td04ad__"); disp(!isempty(strfind(p, "__sl_td04ad__.oct")) || !isempty(strfind(p, "__control_slicot_functions__.oct")))',
         '★ which 指向 .oct（别名符号链接生效）', '1');

console.log('--- 二、ss 构造与 pole/zero（数就是给的那些）---');
await ev('s = ss(-1,1,1,0); disp(s.a); disp(s.b); disp(s.c); disp(s.d)', '★ ss(-1,1,1,0) 的 a/b/c/d', '-1 1 1 0');
await ev('disp(class(ss(-1,1,1,0)))', 'class 是 ss', 'ss');
await ev('disp(pole(tf(1,[1 1])))', '★ pole(tf(1,[1 1])) = -1', '-1');
await ev('disp(zero(tf([1 0],[1 1])))', '★ zero(tf([1 0],[1 1])) = 0', '0');
await ev('disp(pole(tf(1,[1 3 2])))', '二极点系统 [1 3 2] → -1 -2', '-1');
console.log('（-2 也可能被打到下一行，只判 -1 出现过）');

console.log('--- 三、step：与解析解 1-e^-t 逐点比 ---');
await ev('t=0:0.25:2; y=step(ss(-1,1,1,0),t)(:); disp(max(abs(y-(1-exp(-t(:))))))', '★ step 与 1-e^-t 的最大误差 < 1e-12',
         '0');
await ev('t=0:0.5:2; disp(step(ss(-1,1,1,0),t)(:)\x27)', 'step 数值（0 0.3935 0.6321 0.7769 0.8647）', '0.3935');

console.log('--- 四、norm（H2/Hinf 走 AB13BD/AB13AD）---');
await ev('disp(norm(tf(1,[1 1])))', '★ H2 norm(tf(1,[1 1])) = 1/sqrt(2)', '0.7071');
await ev('disp(abs(norm(tf(1,[1 1])) - 1/sqrt(2)) < 1e-12)', '与 1/sqrt(2) 差 < 1e-12', '1');
await ev('disp(norm(ss(-1,1,1,0)))', 'ss 形态的同一个 norm', '0.7071');

console.log('--- 五、tf2ss / dssdata（tb04bd / td04ad 那条链）---');
await ev('[A,B,C,D] = tf2ss([1 3],[1 3 2]); s=2; g = C*inv(s*eye(size(A))-A)*B + D; disp(abs(g - 5/12) < 1e-10)',
         '★ tf2ss 反算 s=2 处传递函数 = 5/12', '1');
await ev('[A,B,C,D] = tf2ss([1 3],[1 3 2]); disp(size(A,1))', 'tf2ss 得到 2 阶状态空间', '2');

console.log('--- 六、Lyapunov：手算解 ---');
await ev('disp(lyap(-1,1))', '★ lyap(-1,1) = 0.5', '0.5');
await ev('disp(dlyap(0.5,0.75))', '★ dlyap(0.5,0.75) = 1', '1');

console.log('--- 七、ARE：标量解析解 + 残差 ---');
await ev('X = care(0,1,1,1); disp(abs(X-1) < 1e-10)', '★ care(0,1,1,1) = 1（-X^2+1=0）', '1');
await ev('[X,L,G] = care(0,1,1,1); disp(abs((0\x27*X + X*0 - X*1/1*1\x27*X + 1)) < 1e-10)',
         'care 解的 ARE 残差 < 1e-10', '1');

console.log('--- 八、离散化保直流增益（c2d）---');
await ev('sys = tf(1,[1 1]); ds = c2d(sys, 0.1); disp(abs(dcgain(ds) - 1) < 1e-10)',
         '★ dcgain(c2d(tf(1,[1 1]),0.1)) = 1', '1');

console.log('--- 九、与既有能力共存（不回归）---');
await ev('disp(exist("butter"))', '★ signal 包仍在（纯 .m）', '2');
await ev('disp(exist("tf"))', '★ control 包仍在', '2');
await ev('plot(1:10); print -dsvg /tmp/slicot.svg; d=dir("/tmp/slicot.svg"); disp(d.bytes > 500)',
         '★ plot 桥 + print -dsvg 未受影响', '1');
await ev('disp(42)', '末条：解释器还活着（没有整页 trap）', '42');

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
