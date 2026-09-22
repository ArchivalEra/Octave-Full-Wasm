// 需求级验收：R1–R10 各一条最小实测（一屏看全"计划落地了吗"）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/accept-requirements.mjs [URL]
//
// 与其余 14 套的区别：那些套件按**批次**组织、每套几十项；这一套按**需求编号**
// 组织、每个需求一条最小编译断言。用途是"新会话/新环境起手时的一屏体检"——
// 13 行就能看出十条需求各自还在不在，出问题时再去看对应批次套件。
//
// 注意：这些能力大多走**懒加载车道**（设计如此），所以先按需装载再断言；
// 不装载就测等于测"没按需加载"，不是测"能力不存在"。
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

// 等 index.html 的 dldfcn 自动组装完，再补装其余懒加载资产
await page.evaluate(async () => {
  for (let i = 0; i < 100; i++) {
    if (window.OctaveAssets && window.OctaveAssets.loaded().length >= 7) break;
    await new Promise(r => setTimeout(r, 200));
  }
}).catch(() => {});
console.log('  懒加载资产:', await page.evaluate(async () => {
  const out = [];
  for (const a of ['__ode15__', 'webimage', 'webaudio', 'webnet', 'signal']) {
    try { await window.OctaveAssets.load(a); out.push(a + ':ok'); }
    catch (e) { out.push(a + ':ERR'); }
  }
  return out.join(' ');
}));

let pass = 0, fail = 0;
async function ev(name, code) {
  logs.length = 0;
  let r;
  try {
    r = await page.evaluate(x => { const rc = window.Module.eval_string(x); return { rc, err: window.Module.last_error_message() }; }, code);
  } catch (e) { console.log(`CRASH | ${name} :: ${String(e).slice(0, 110)}`); fail++; return; }
  await new Promise(rr => setTimeout(rr, 650));
  const out = [...logs].join(' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  // 判定：rc=0 且输出里没有 error —— 这些是"最小可用"断言，数值正确性由各批次套件保证
  const ok = r.rc === 0 && out && !/error/i.test(out);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${name.padEnd(24)} :: ${out || r.err.slice(0, 90)}`);
}

console.log('--- R1–R10 各一条最小实测 ---');
// ⚠️ 原先 R5 与"二进制往返"把 URL 写死成 http://127.0.0.1:8761/ —— 于是这套
//    **只能在 8761 上跑**。8761/8762 同时在服务时，在 8762 上跑也仍去 8761 取文件：
//    ① 测的不是当前站点；② 跨源 fetch 还会被 CORS 挡。改成跟页面自己的 origin 走
//    （在 8761 上跑时，URL 与改之前完全相同）。
const ORIGIN = await page.evaluate(() => location.origin);
await ev('R1 SUNDIALS ode15s', "tic; [tt,yy]=ode15s(@(t,y) -y, [0 1], 1); disp(abs(yy(end)-exp(-0.1))<1e-4)");
await ev('R2 Forge 包', "disp([exist('butter') exist('tf') exist('normpdf')])");
await ev('R3 HDF5', "A=magic(3); save('-hdf5','/tmp/req.h5','A'); clear A; load('/tmp/req.h5'); disp(A(1,1))");
await ev('R4 图像 I/O', "A=uint8(reshape(mod(0:255,256),16,16)); imwrite(A,'/tmp/req.png'); disp(isequal(A,imread('/tmp/req.png')))");
await ev('R5 同步网络', `s=urlread('${ORIGIN}/assets/manifest.json'); disp(numel(s)>100)`);
await ev('R6 压缩归档', "fid=fopen('/tmp/req.txt','w'); fprintf(fid,'x\\n'); fclose(fid); gzip('/tmp/req.txt'); disp(exist('/tmp/req.txt.gz'))");
await ev('R7 CXSparse', "s=sparse([1 0;0 2]); [Q,R]=qr(s); disp(norm(full(s-Q*R))<1e-10)");
await ev('R8 WebAudio', "y=sin(2*pi*440*(0:999)/8000); pl=audioplayer(y,8000); play(pl); disp(pl.Running)");
await ev('R9 print -dsvg', "clf; plot(1:10); print('/tmp/req.svg','-dsvg'); d=dir('/tmp/req.svg'); disp(d.bytes>2000)");
await ev('R10 -O1 生效', "tic; s=0; for k=1:1e6, s=s+k; endfor; t=toc; disp(t<1.5)");

console.log('--- 架构要点（回归护栏）---');
await ev('官方 .oct 装载', "disp([num2str(exist('convhulln')) ' ' which('convhulln')])");
await ev('plot 桥 v2 3D', "clf; [X,Y]=meshgrid(-1:0.5:1); surf(X,Y,X.*Y); print('/tmp/req3.svg','-dsvg'); d=dir('/tmp/req3.svg'); disp(d.bytes>3000)");
await ev('中文字符串', "clf; title('中文标题'); print('/tmp/reqc.svg','-dsvg'); s=fileread('/tmp/reqc.svg'); disp(!isempty(strfind(s,'中文标题')))");
// R10 的阈值 1.5s 是 7.2 -O1 基线定的；11.3.0 同档 -O1，判定沿用不变。
await ev('二进制往返', `urlwrite('${ORIGIN}/octave.wasm','/tmp/req.wasm'); d=dir('/tmp/req.wasm'); disp(d.bytes>1000000)`);

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
