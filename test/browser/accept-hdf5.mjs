// 批次 1 验收：HDF5 往返 + CXSparse 稀疏能力
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/accept-hdf5.mjs [URL]
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
  } catch (e) { console.log(`CRASH | ${label} :: ${String(e).slice(0, 120)}`); fail++; return; }
  await new Promise(rr => setTimeout(rr, 700));
  const out = [...logs].join(' ').replace(/\s+/g, ' ').trim().slice(0, 190);
  const ok = r.rc === 0 && (!want || out.includes(want));
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${out || ('rc=' + r.rc + ' ' + r.err.slice(0, 120))}`);
}

console.log('--- HDF5 ---');
await ev('disp(exist("__have_hdf5__"))', 'exist __have_hdf5__', '1');
await ev("A=magic(4); B='hello'; C=struct('x',1.5); save('-hdf5','/tmp/t.h5','A','B','C'); disp(exist('/tmp/t.h5'))", 'save -hdf5 落盘', '2');
await ev('clear A B C; load("/tmp/t.h5"); disp(A(1,1))', 'load 回读 A', '16');
await ev('disp(B)', 'load 回读字符串 B', 'hello');
await ev('disp(C.x)', 'load 回读 struct C', '1.5');
await ev('s=whos("-file","/tmp/t.h5"); disp(numel(s))', 'whos -file 列表长度', '3');
await ev('disp(isequal(load("/tmp/t.h5").A, magic(4)))', '往返一致性', '1');
// 压缩 + 大数组
await ev('X=reshape(1:10000,100,100); save("-hdf5","-z","/tmp/big.h5","X"); clear X; Y=load("/tmp/big.h5").X; disp([rows(Y) columns(Y)]); disp(sum(Y(:)))', '带压缩的 100x100 往返', '100 100');
await ev('Y=load("/tmp/big.h5").X; disp(sum(Y(:)))', '压缩往返数值', '5.0005e+07');

// HDF5 文件魔数（89 48 44 46 0d 0a 1a 0a）——证明确实是 HDF5 容器而非别的格式
const magic = await page.evaluate(() => {
  const b = Module.FS.readFile('/tmp/t.h5');
  return Array.from(b.slice(0, 8)).map(x => x.toString(16).padStart(2, '0')).join(' ');
});
const magicOk = magic === '89 48 44 46 0d 0a 1a 0a';
magicOk ? pass++ : fail++;
console.log(`${magicOk ? 'PASS' : 'fail'} | HDF5 魔数 :: ${magic}`);

console.log('--- CXSparse（稀疏）---');
await ev('disp(exist("__have_cxsparse__"))', 'exist __have_cxsparse__（无此内建则见下）', null);
await ev("s=gallery('poisson',8); x=ones(64,1); b=s*x; xx=s\\b; disp(norm(xx-x,inf)<1e-8)", '稀疏反斜杠求解（确定性 Poisson）', '1');
await ev("s=gallery('poisson',6); [L,U,P,Q]=lu(s); disp(issparse(L))", '稀疏 LU（CXSparse 路径）', '1');
// 注意：qr(s,0) 经济模式在 CXSparse 后端不受支持（Octave 自身限制，桌面版同样报错）
await ev("s=gallery('poisson',5); [Q,R]=qr(s); disp(issparse(R))", '稀疏 QR（完整模式）', '1');
// CXSparse 路径下 P/p 返回空，但 s=Q*R 恒等式成立——这才是实质判据（实测残差 7e-15）
await ev("s=gallery('poisson',5); [Q,R]=qr(s); disp(norm(full(s)-full(Q*R),1)<1e-8)", '稀疏 QR 一致性 s=Q*R', '1');
await ev('disp(nnz(speye(5)*2))', '稀疏基本运算', '5');

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
