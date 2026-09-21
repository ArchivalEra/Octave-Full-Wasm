// 批次 4 验收：R6 压缩/归档（无 shell 环境下的 zip/unzip/tar/untar/gunzip/bunzip2）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/accept-archive.mjs [URL]
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
  const out = [...logs].join(' ').replace(/\s+/g, ' ').trim().slice(0, 180);
  const ok = r.rc === 0 && (!want || out.includes(want));
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${out || ('rc=' + r.rc + ' ' + r.err.slice(0, 120))}`);
}

// 准备：造几个文件
await page.evaluate(() => {
  Module.eval_string('mkdir("/work"); cd("/work");');
  Module.FS.writeFile('/work/alpha.txt', 'alpha content\n');
  Module.FS.writeFile('/work/beta.txt', 'beta content 12345\n');
  Module.eval_string('mkdir("/work/sub");');
  Module.FS.writeFile('/work/sub/gamma.txt', 'gamma\n');
});

console.log('--- 懒加载 webio + webshell + dldfcn 的 gzip ---');
// gzip/bzip2 的**压缩**侧来自 dldfcn 模块（批次 13 起是 .oct 资产，不再是内建）；
// 解压侧来自 webio/web shell 的进程内覆写。两边都要装。
const lr = await page.evaluate(async () => {
  try {
    await window.OctaveAssets.load('webshell');
    await window.OctaveAssets.load('gzip');
    return window.OctaveAssets.loaded().join(' ');
  }
  catch (e) { return 'ERR ' + String(e).slice(0, 140); }
});
console.log('  已加载:', lr);

console.log('--- gzip / gunzip（原版 gunzip 调 system，必失败）---');
await ev('f=gzip("/work/alpha.txt"); disp(exist("/work/alpha.txt.gz"))', 'gzip 生成 .gz', '2');
await ev('unlink("/work/alpha.txt"); r=gunzip("/work/alpha.txt.gz"); disp(exist("/work/alpha.txt"))', '★ gunzip 还原（进程内）', '2');
await ev('fid=fopen("/work/alpha.txt"); s=fgetl(fid); fclose(fid); disp(s)', '★ 还原内容正确', 'alpha content');

console.log('--- bzip2 / bunzip2 ---');
await ev('bzip2("/work/beta.txt"); disp(exist("/work/beta.txt.bz2"))', 'bzip2 生成 .bz2', '2');
await ev('unlink("/work/beta.txt"); bunzip2("/work/beta.txt.bz2"); disp(exist("/work/beta.txt"))', '★ bunzip2 还原（进程内）', '2');
await ev('fid=fopen("/work/beta.txt"); s=fgetl(fid); fclose(fid); disp(s)', '★ 还原内容正确', 'beta content 12345');

console.log('--- zip / unzip（自实现格式）---');
await ev('n=zip("/work/a.zip",{"/work/alpha.txt","/work/beta.txt"}); disp(numel(n))', 'zip 打包 2 个文件', '2');
await ev('disp(exist("/work/a.zip"))', 'zip 文件落盘', '2');
await ev('f=unzip("/work/a.zip","/work/uz"); disp(numel(f))', '★ unzip 解出 2 个', '2');
await ev('fid=fopen("/work/uz/alpha.txt"); s=fgetl(fid); fclose(fid); disp(s)', '★ 解出的内容正确', 'alpha content');
await ev('fid=fopen("/work/uz/beta.txt"); s=fgetl(fid); fclose(fid); disp(s)', '★ 第二个文件也对', 'beta content 12345');
// 二进制往返（含非文本字节）
await page.evaluate(() => { const b = new Uint8Array(256); for (let i=0;i<256;i++) b[i]=i; Module.FS.writeFile('/work/bin.dat', b); });
await ev('zip("/work/b.zip",{"/work/bin.dat"}); f=unzip("/work/b.zip","/work/bz"); disp(numel(f))', 'zip/unzip 二进制往返', '1');
await ev('a=fileread("/work/bin.dat"); b=fileread("/work/bz/bin.dat"); disp(isequal(a,b))', '★ 二进制字节级一致', '1');

console.log('--- tar / untar（自实现 ustar）---');
await ev('n=tar("/work/a.tar",{"/work/alpha.txt","/work/beta.txt"}); disp(numel(n))', 'tar 打包', '2');
await ev('f=untar("/work/a.tar","/work/ut"); disp(numel(f))', '★ untar 解出 2 个', '2');
await ev('fid=fopen("/work/ut/alpha.txt"); s=fgetl(fid); fclose(fid); disp(s)', '★ tar 内容正确', 'alpha content');
await ev('a=fileread("/work/bin.dat"); tar("/work/b.tar",{"/work/bin.dat"}); untar("/work/b.tar","/work/bt"); b=fileread("/work/bt/bin.dat"); disp(isequal(a,b))', '★ tar 二进制一致', '1');

console.log('--- 目录递归打包 ---');
await ev('n=tar("/work/d.tar",{"/work/sub"}); disp(numel(n)>0)', '★ tar 递归目录', '1');
await ev('n=zip("/work/d.zip",{"/work/sub"}); disp(numel(n)>0)', '★ zip 递归目录', '1');

console.log('--- 回归：gzip/bzip2 内建仍正常 ---');
await ev('z=gzip("/work/sub/gamma.txt"); disp(exist("/work/sub/gamma.txt.gz"))', 'gzip 内建', '2');

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
