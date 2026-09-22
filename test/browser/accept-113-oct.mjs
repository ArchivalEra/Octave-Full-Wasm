// 闸门（真 .oct）：一个由本树头文件编出的真 .oct，能否被 11.3.0 的主模块装载并正确调用
//
// 为什么单独一套：accept-113-boot 验的是「解释器能起、能 eval」；
// 这一套验的是**整套按需加载架构成立与否**——真 DEFUN_DLD 模块 + 本树 ABI +
// side module 从主模块解析符号（包括回调主模块里的 LAPACK）。
// 按外部校对建议，探针刻意做成非平凡：调用两次、传矩阵、走错误路径、清掉再调。
//
// 用法：harness/run.sh test/browser/accept-113-oct.mjs [URL]
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8762/';
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();

const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));

let pass = 0, fail = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run (code, timeoutMs = 20000, useSentinel = true) {
  const s = '__SW' + Math.random().toString(36).slice(2) + '__';
  logs.length = 0;
  const rc = await page.evaluate(
    ([x, sentinel, want]) => window.Module.eval_string(want ? `${x}; disp('${sentinel}');` : x),
    [code, s, useSentinel]);
  const t = Date.now();
  while (Date.now() - t < timeoutMs) {
    if (!useSentinel) { if (Date.now() - t > 1200) break; }
    else if (logs.some(l => l.includes(s))) break;
    await sleep(80);
  }
  const seen = useSentinel ? logs.some(l => l.includes(s)) : true;
  const out = logs.join(' ').split(s)[0].replace(/\s+/g, ' ').trim();
  return { rc, out, seen, err: await page.evaluate(() => window.Module.last_error_message()) };
}

async function ev (name, code, expect) {
  const r = await run(code);
  let ok = r.seen && r.rc === 0 && !/^error/i.test(r.out);
  if (ok && expect !== undefined) ok = r.out.includes(expect);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${name.padEnd(30)} :: ${(r.out || r.err || '(空)').slice(0, 96)}`);
  return r;
}

console.log(`URL=${URL}`);
await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
const t0 = Date.now();
while (Date.now() - t0 < 300000) {
  try { const r = await run('1+1', 4000); if (r.seen && r.rc === 0) break; } catch {}
  await sleep(700);
}
console.log(`ready=${((Date.now() - t0) / 1000).toFixed(1)}s`);

// ---- 把 .oct 放进 wasm 文件系统（模拟资产加载器的动作）---------------------
// ⚠️ 关键：**Octave 是按「函数名.oct」这个文件名去找模块的**，不是按模块内部
//    导出的名字。我们的模块文件叫 minioct.oct 但导出的是 miniprobe，所以必须
//    像桌面版那样给每个函数名建符号链接（正是资产加载器 `aliases` 机制做的事）。
//    第一版漏了这一步，`exist('miniprobe')` 直接返回 0，而 `exist('zzfake')`
//    对同目录一个垃圾内容的 zzfake.oct 却返回 3 —— 正是这条规则的实证。
const wrote = await page.evaluate(async () => {
  try {
    const buf = await fetch('minioct.oct').then(r => r.arrayBuffer());
    const FS = window.Module.FS;
    const dir = '/usr/src/octave/m/oct';
    try { FS.mkdir(dir); } catch (e) { /* 已存在 */ }
    FS.writeFile(dir + '/minioct.oct', new Uint8Array(buf));
    // 给导出的函数名建别名（与 bridge/assets-loader.js 的 aliases 同一机制）
    try { FS.symlink(dir + '/minioct.oct', dir + '/miniprobe.oct'); }
    catch (e) { /* 已存在 */ }
    return buf.byteLength;
  } catch (e) { return 'ERR: ' + e.message; }
});
console.log(`写入 minioct.oct：${wrote} 字节`);
if (typeof wrote === 'number') pass++; else fail++;

console.log('--- 装载与调用（闸门本体）---');
await ev('addpath 插件目录', "addpath('/usr/src/octave/m/oct'); disp(1)", '1');
await ev('exist 报 3（=.oct 文件）', "disp(exist('miniprobe'))", '3');
await ev('which 指向 .oct',       "w=which('miniprobe'); disp(!isempty(w))", '1');
// 关键一条：走完整 ABI，并且 determinant() 会回调**主模块里的 LAPACK**
await ev('调用① det→5',          "printf('%.10g', miniprobe([2,3;1,4]))", '5');
await ev('调用② det→-2（再次调用）', "printf('%.10g', miniprobe([1,2;3,4]))", '-2');
await ev('非方阵走错误路径',       "miniprobe([1,2,3])", undefined);
await ev('clear 后再调用（重解析）', "clear miniprobe; printf('%.10g', miniprobe([2,0;0,3]))", '6');

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
