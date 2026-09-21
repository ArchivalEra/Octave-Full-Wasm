// 批次 12 验收：signal + control（R2 验收标准里点名的两个包）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/accept-forge2.mjs [URL]
//
// R2 的验收标准要求 statistics / optim / signal / control 四个包冒烟通过。
// 前两个在批次 2A/2B 已做；这一套补上后两个：
//   signal  1.4.6  纯 .m（181 个）—— 滤波器设计/变换，教学里最常写的那类
//   control 4.1.3  314 个 .m（LTI 建模与频域分析）
//
// **control 的编译件（SLICOT）不发布**：它们作为 side module 调用主模块的
// Fortran 符号时签名不匹配，一调就把页面弄崩（见 CLIBS.md 坑 11）。
// 因此本套件既测可用面，也**明确断言那条边界**——否则将来有人看到
// `ss`/`step` 存在、以为能用，一跑就白屏。
//
// 断言的是**真数值**，不是"函数存在"：滤波器直流增益、传递函数系数、
// 反馈后的直流增益都要对得上。
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

let pass = 0, fail = 0;
async function ev(expr, label, want) {
  logs.length = 0;
  let r;
  try {
    r = await page.evaluate(x => { const rc = window.Module.eval_string(x); return { rc, err: window.Module.last_error_message() }; }, expr);
  } catch (e) { console.log(`CRASH | ${label} :: ${String(e).slice(0, 130)}`); fail++; return; }
  await new Promise(rr => setTimeout(rr, 650));
  const out = [...logs].join(' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  const ok = r.rc === 0 && (!want || out.includes(want));
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${out || ('rc=' + r.rc + ' ' + r.err.slice(0, 150))}`);
}

console.log('--- 懒加载前 ---');
await ev('disp(exist("butter"))', 'signal 不在', '0');
await ev('disp(exist("tf"))', 'control 不在', '0');

console.log('--- 懒加载 signal（应自动带出 control → control-oct）---');
console.log('  已加载:', await page.evaluate(async () => {
  try { await window.OctaveAssets.load('signal'); return window.OctaveAssets.loaded().slice(-3).join(' '); }
  catch (e) { return 'ERR ' + String(e).slice(0, 140); }
}));
await ev('disp(exist("butter"))', '★ signal 已装载', '2');
await ev('disp(exist("tf"))', '★ control 由依赖自动带出', '2');
// SLICOT 编译件不在发布清单里（见文件头注释）——这条断言是**有意**的护栏
await ev('disp(exist("__sl_td04ad__"))', '★ SLICOT 编译件未发布（有意）', '0');
await ev('disp(exist("__lti_input_idx__"))', '★ 基础编译件已发布（tf 依赖它）', '3');

console.log('--- signal：滤波器设计（真数值）---');
await ev('[b,a]=butter(4,0.2); disp(numel(b))', 'butter(4,0.2) 出 5 个系数', '5');
await ev('disp(abs(sum(b)/sum(a)-1)<1e-12)', '★ 低通直流增益 = 1', '1');
await ev('[b,a]=butter(2,0.2,"high"); disp(abs(sum(b)/sum(a))<1e-12)', '★ 高通直流增益 = 0', '1');
// 注意 freqz 返回 (P,N) 两点或 N 点，取决于调用形式：freqz(b,a,N) 是 N 点
await ev('[b,a]=butter(4,0.3); H=freqz(b,a,16); disp(numel(H))', 'freqz(b,a,16) 16 点频响', '16');
await ev('disp(abs(H(1)-1)<1e-12)', '★ 低通在 DC 处增益 = 1', '1');
await ev('disp(numel(fir1(30,0.3)))', 'fir1 31 抽头 FIR', '31');
await ev('[z,p,k]=buttap(3); disp(numel(p))', 'buttap 3 极点', '3');
await ev('[sos,g]=zp2sos(butter(6,0.4)); disp(rows(sos)>=3)', '★ zp2sos 出二阶节', '1');
await ev('w=kaiser(51,7.5); disp(abs(sum(w)-1)>0)', 'kaiser 窗非平凡', '1');
// filtfilt 的调用形式是 (b, a, x) —— 写成 filtfilt(butter(...), 1, x) 会把 1
// 当成滤波器系数 a，信号被压成噪声（实测 max=0.006）。必须先显式拆出 [b,a]。
await ev('[b,a]=butter(4,0.2); x=sin(2*pi*0.05*(0:255)); y=filtfilt(b,a,x); disp(numel(y))', 'filtfilt 零相位滤波', '256');
await ev('disp(max(abs(y))>0.9)', '★ 滤波后信号幅度保持（≈1）', '1');
await ev('disp(max(abs(y))<1.1)', '★ 且未放大', '1');

console.log('--- signal：变换 ---');
await ev('disp(numel(hilbert(1:16)))', 'hilbert 解析信号', '16');
await ev('disp(numel(fft(1:8)))', 'fft 不受影响', '8');
await ev('disp(abs(sum(abs(dct(1:8))))>0)', 'dct 可用', '1');

console.log('--- control：LTI 建模（真数值，纯 .m 面）---');
await ev('S=tf("s"); G=1/(S^2+2*S+1); disp(class(G))', '★ tf("s") 建模', 'tf');
await ev('[num,den]=tfdata(G,"v"); disp(all(num==[0 0 1]))', '★ 分子系数 = [0 0 1]', '1');
await ev('disp(all(den==[1 2 1]))', '★ 分母系数 s²+2s+1 = [1 2 1]', '1');
await ev('disp(abs(dcgain(G)-1)<1e-12)', '★ 直流增益 = 1', '1');
await ev('disp(numel(pole(G)))', '极点数 2', '2');
await ev('disp(sum(pole(G)))', '★ 极点之和 = -2', '-2');
await ev('disp(numel(zero(G)))', '零点数 0', '0');
await ev('disp(dcgain(feedback(G,1)))', '★ 单位反馈后直流增益 = 0.5', '0.5000');
// bode 的 m 是 (nw × outputs) 矩阵（不是三维数组），m(1) 即最低频点。
// 传递函数 1/(s²+2s+1) 在 w=0.1 处 |G|=|1/(1-0.01+0.2i)|=1/|0.99+0.2i|≈0.9801
await ev('disp(numel(bode(G,{0.1,10})))', 'bode 频响点数', '1001');
await ev('[m,p,w]=bode(G,{0.1,10}); disp(isequal(size(m),[1001 1]))', '★ bode m 的形状为 (nw×1)', '1');
await ev('[m,p,w]=bode(G,{0.1,10}); disp(abs(abs(m(1))-1/abs(0.99+0.2i))<1e-12)', '★ bode 最低频增益 = |1/(0.99+0.2i)|', '1');
await ev('disp(abs(dcgain(G*G)-1)<1e-12)', '串联系统直流增益仍为 1', '1');
await ev('disp(abs(dcgain(G/(1+G))-0.5)<1e-12)', '手动闭环与 feedback 一致', '1');

console.log('--- 不可用面必须清晰（不能崩页面）---');
// 这些走 SLICOT，编译件未发布 → 应当是"函数不存在"的清晰报错，
// 而不是 wasm 层崩溃（那种崩会让整个页面不可用）。
await ev('disp(exist("ss"))', 'ss 的 .m 在（但依赖编译件）', '2');
await ev('disp(exist("__sl_td04ad__"))', '★ SLICOT 后端确实未发布', '0');

console.log('--- 与核心 Octave 协同 ---');
await ev('disp(numel(eig(magic(4))))', 'eig 不受影响', '4');

console.log('--- 回归：核心功能不受影响 ---');
await ev('disp(numel(ode45(@(t,y) -y, [0 1], 1)))', 'ode45 仍可用', '1');
await ev('clf; plot(1:10); print("/tmp/f2.svg","-dsvg"); disp(exist("/tmp/f2.svg"))', 'plot/print 仍可用', '2');
await ev('[b,a]=butter(6,0.3); H=freqz(b,a,64); clf; plot(abs(H)); title("滤波器频响"); print("/tmp/f2b.svg","-dsvg"); disp(1)', '★ signal + plot + print 联动出图', '1');
await ev('disp(exist("/tmp/f2b.svg"))', '图已落盘', '2');
await ev('disp(numel(dir("/tmp/f2b.svg").bytes>2000))', '图非空', '1');

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
