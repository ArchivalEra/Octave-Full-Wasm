// Octave-Full-Wasm 浏览器验收套件（21 项：核心回归 + .oct 装载 + 资产懒加载）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh <本文件> [URL]
// 默认 URL = http://127.0.0.1:8761/（项目验收底线端口）
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text().slice(0, 300)));
page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 300)));

const t0 = Date.now();
await page.goto(URL, { waitUntil: 'load', timeout: 240000 });
let ready = false;
const t1 = Date.now();
while (Date.now() - t1 < 300000) {
  const ok = await page.evaluate(() => {
    try { return !!window.Module?.feval?.('strcat', ['a', 'b'], 1); } catch { return false; }
  }).catch(() => false);
  if (ok) { ready = true; break; }
  await new Promise(r => setTimeout(r, 800));
}
console.log(`URL=${URL}  ready=${ready} (${((Date.now() - t1) / 1000).toFixed(1)}s)  goto=${((t1 - t0) / 1000).toFixed(1)}s`);
if (!ready) { console.log(logs.slice(-12).join('\n')); await browser.close(); process.exit(1); }
console.log('Module._dlopen:', await page.evaluate(() => typeof window.Module._dlopen));

// dldfcn 核心组（convhulln/gzip/… 7 个 .oct）由 index.html 在清单就绪后自动装载。
// 它比 ready 稍晚（要先 fetch manifest 再拉约 300KB 的 .oct），所以等一下，
// 否则下面的函数调用会撞上"还没装好"。
await page.evaluate(async () => {
  if (!window.OctaveAssets) return;
  for (let i = 0; i < 100; i++) {
    const want = ['convhulln', 'gzip', 'audioread'];
    const got = window.OctaveAssets.loaded();
    if (want.every(w => got.includes(w))) return;
    await new Promise(r => setTimeout(r, 200));
  }
}).catch(() => {});
console.log('  dldfcn 核心组:', await page.evaluate(() => {
  const got = window.OctaveAssets ? window.OctaveAssets.loaded() : [];
  return ['convhulln', '__delaunayn__', '__voronoi__', '__glpk__', 'fftw', 'gzip', 'audioread']
    .filter(n => got.includes(n)).length + '/7';
}));

let pass = 0, fail = 0;
async function ev(expr, label, want) {
  logs.length = 0;
  let r;
  try {
    r = await page.evaluate(x => {
      const rc = window.Module.eval_string(x);
      return { rc, err: window.Module.last_error_message() };
    }, expr);
  } catch (e) { console.log(`CRASH | ${label} :: ${String(e).slice(0, 120)}`); fail++; return; }
  await new Promise(rr => setTimeout(rr, 650));
  const out = [...logs].join(' ').replace(/\s+/g, ' ').trim().slice(0, 190);
  const ok = r.rc === 0 && (!want || out.includes(want));
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${out || ('rc=' + r.rc + ' ' + r.err.slice(0, 110))}`);
}

console.log('--- 批次 0/1a/1b 核心回归 ---');
await ev('disp(2+3)', 'basic', '5');
await ev('disp(det([1 2;3 4]))', 'det', '-2');
await ev('v=eigs([2 0;0 3]); disp(sort(v)\')', 'eigs', '2 3');
await ev('disp(sum(fft([1 0 0 0])))', 'fft', '4');
await ev('disp(size(delaunay([0;1;0],[0;0;1]),1))', 'delaunay', '1');
await ev('disp(convhulln([0 0;1 0;0 1])(:)\')', 'convhulln', '1 3 2');
// 这五个是 dldfcn 模块（批次 13 起走官方 dlopen 装载，.oct 资产）。
// 桌面版语义：exist=3、which() 指向 .oct 文件——不再是内建。
// index.html 会在清单就绪后自动装载这一组，所以下面还要等一下。
await ev('disp(exist("__glpk__"))', 'exist __glpk__（dldfcn .oct）', '3');
await ev('disp(exist("gzip"))', 'exist gzip', '3');
await ev('disp(exist("bzip2"))', 'exist bzip2（gzip.oct 的别名）', '3');
await ev('disp(exist("audioread"))', 'exist audioread', '3');
await ev('disp(exist("fftw"))', 'exist fftw', '3');
await ev('disp(!isempty(strfind(which("convhulln"),".oct")))', '★ convhulln 来自 .oct 文件', '1');
await ev('s=jsonencode(struct("a",1)); disp(s)', 'jsonencode', '"a"');
await ev('A=magic(3); save("-v7","/tmp/a.mat","A"); clear A; load("/tmp/a.mat"); disp(A(1,1))', 'save/load -v7', '8');
await ev('fs=8000; t=(0:fs-1)/fs; y=sin(2*pi*440*t); audiowrite("/tmp/t.wav", y, fs); i=audioinfo("/tmp/t.wav"); disp(i.SampleRate)', 'audio 往返', '8000');
await ev('disp(which("plot"))', 'plot 桥', 'plotbridge');

console.log('--- 真 .oct 动态装载 ---');
const n = await page.evaluate(async () => {
  try { Module.FS.mkdir('/oct'); } catch (e) {}
  let resp = await fetch('dldprobe.oct');
  if (!resp.ok) resp = await fetch('oct/dldprobe.oct');
  const b = new Uint8Array(await resp.arrayBuffer());
  Module.FS.writeFile('/oct/dldprobe.oct', b);
  return b.length;
}).catch(e => 'ERR ' + String(e).slice(0, 80));
console.log('  dldprobe.oct 写入:', n);
await ev('addpath("/oct"); disp(exist("dldprobe"))', 'exist dldprobe（来自 .oct）', '3');
await ev('disp(dldprobe())', '★ 调用 .oct 里的函数', '42');
await ev('disp(which("dldprobe"))', 'which dldprobe', '.oct');

console.log('--- 资产懒加载车道 ---');
const assetRes = await page.evaluate(async () => {
  try { const r = await window.OctaveAssets.load('lanetest'); return { ok: true, files: r.files }; }
  catch (e) { return { ok: false, err: String(e).slice(0, 140) }; }
});
console.log('  加载 lanetest:', JSON.stringify(assetRes));
await ev('disp(lanetest())', '★ 懒加载资产里的函数', 'asset-lane-ok');

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
