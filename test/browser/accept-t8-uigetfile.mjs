// T8 验收：uigetfile（浏览器文件选择器，走官方缝 __fltk_uigetfile__）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/accept-t8-uigetfile.mjs [URL]
//
// 这一套验三件事：
//   ① 官方调用链的**门禁**：`__uigetfile_fltk__.m` 开头要求 `exist("__fltk_uigetfile__") == 3`
//      ⇒ 纯 .m 覆写满足不了，必须是 .oct（这是本批为什么要写 C++ 的唯一理由）。
//   ② 选择框**真的能用**：Playwright 的 fileChooser 把对话框走完（选文件 / 取消），
//      断言 Octave 侧拿到文件名、路径，且**字节内容可读**（复制进了当前目录）。
//   ③ **两步语义**如实：第一次调用弹框并报错提示"再跑一次"，第二次才返回结果。
//      这不是偷懒 —— 选择框是异步的，而 Octave 一阻塞页面就停摆（pause 期间
//      浏览器定时器 0 次触发，见 build/113/NOTES-t6-t7-hostlayer.md 坑 1），
//      Asyncify 也已实测排除（NOTES-asyncify.md）。
import { chromium } from 'playwright-core';

const TARGET = process.argv[2] || 'http://127.0.0.1:8761/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text().slice(0, 500)));
page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 400)));

// 选择框：按当前场景决定"选哪个文件"或"取消"
let scenario = 'none';
page.on('filechooser', async (fc) => {
  try {
    if (scenario === 'cancel') { await fc.setFiles([]); return; }
    const payload = scenario === 'multi'
      ? [{ name: 'm1.txt', mimeType: 'text/plain', buffer: Buffer.from('first\n') },
         { name: 'm2.txt', mimeType: 'text/plain', buffer: Buffer.from('second\n') }]
      : [{ name: 'hello.txt', mimeType: 'text/plain', buffer: Buffer.from('hello from the picker\n') }];
    await fc.setFiles(payload);
    console.log(`  （选择框已应答：${scenario}）`);
  } catch (e) { console.log('  （filechooser 处理失败: ' + e.message + '）'); }
});

await page.goto(TARGET, { waitUntil: 'load', timeout: 240000 });
const t0 = Date.now();
while (Date.now() - t0 < 300000) {
  const ok = await page.evaluate(() => { try { return !!window.Module?.feval?.('strcat', ['a', 'b'], 1); } catch { return false; } }).catch(() => false);
  if (ok) break; await new Promise(r => setTimeout(r, 800));
}
console.log(`URL=${TARGET} ready=${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`文件选择桥: ${await page.evaluate(() => typeof window.OctaveFilePick)}`);
await page.evaluate(async () => {
  if (!window.OctaveAssets) return;
  for (let i = 0; i < 120; i++) { if (window.OctaveAssets.loaded().includes('webdoc')) return; await new Promise(r => setTimeout(r, 200)); }
}).catch(() => {});
logs.length = 0;

let pass = 0, fail = 0;
async function ev (label, expr, want) {
  logs.length = 0;
  let r;
  try { r = await page.evaluate(x => { const rc = window.Module.eval_string(x); return { rc, err: window.Module.last_error_message() }; }, expr); }
  catch (e) { console.log(`CRASH | ${label} :: ${String(e).slice(0, 130)}`); fail++; return; }
  await new Promise(rr => setTimeout(rr, 400));
  const out = [...logs].join(' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  const ok = r.rc === 0 && (!want || out.includes(want));
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${out || ('rc=' + r.rc + ' ' + r.err.slice(0, 200))}`);
}
async function evErr (label, expr, want) {
  logs.length = 0;
  let r;
  try { r = await page.evaluate(x => { const rc = window.Module.eval_string(x); return { rc, err: window.Module.last_error_message() }; }, expr); }
  catch (e) { console.log(`CRASH | ${label} :: ${String(e).slice(0, 130)}`); fail++; return; }
  await new Promise(rr => setTimeout(rr, 400));
  const out = [...logs].join(' ').replace(/\s+/g, ' ').trim().slice(0, 400);
  const ok = r.rc !== 0 && out.includes(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${out || ('rc=' + r.rc + ' ' + r.err.slice(0, 200))}`);
}

// 负向断言：成功执行、且输出里**不出现**某串（用于"缺口已补"这类断言）
async function evNot (label, expr, unwanted) {
  logs.length = 0;
  let r;
  try { r = await page.evaluate(x => { const rc = window.Module.eval_string(x); return { rc, err: window.Module.last_error_message() }; }, expr); }
  catch (e) { console.log(`CRASH | ${label} :: ${String(e).slice(0, 130)}`); fail++; return; }
  await new Promise(rr => setTimeout(rr, 400));
  const out = [...logs].join(' ') + ' ' + (r.err || '');
  const ok = r.rc === 0 && !out.includes(unwanted);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${ok ? '（未出现 ' + unwanted + '）' : out.replace(/\s+/g, ' ').slice(0, 200)}`);
}

console.log('--- ① 门禁：官方链要求 exist(...) == 3，所以必须是 .oct ---');
await ev('uigetfile 本身在（官方 .m）', 'disp(num2str(exist("uigetfile")))', '2');
await ev('未加载 → __fltk_uigetfile__ 不存在', 'disp(exist("__fltk_uigetfile__"))', '0');
await evErr('★门禁确实挡着（这就是改动前的错）', "uigetfile({'*.txt','Text'})", 'fltk graphics toolkit required');

console.log('--- 懒加载 __fltk_uigetfile__（我们写的浏览器实现）---');
await page.evaluate(async () => { await window.OctaveAssets.load('__fltk_uigetfile__'); });
logs.length = 0;
await ev('加载后 exist = 3（.oct）', 'disp(exist("__fltk_uigetfile__"))', '3');
await ev('which 指向资产目录', 'disp(!isempty(strfind(which("__fltk_uigetfile__"), "oct/")))', '1');
// `__uigetfile_fltk__.m` 住在 m/gui/**private**/ 里 —— private 函数对外不可见，
// 从外部 exist 就是 0；它在 gui/ 内部可调用（上面那条链已经证明了）。
await ev('private 的中间层对外不可见（exist=0，正常）', 'disp(num2str(exist("__uigetfile_fltk__")))', '0');

console.log('--- ② 两步语义：第一次弹框 + 明确报错 ---');
scenario = 'single';
await evErr('★第一次调用：弹框并报错提示再跑一次',
  "uigetfile({'*.txt','Text'})", 'has been opened in the page');
// 等页面把选择框应答完并写下结果
await new Promise(r => setTimeout(r, 2500));
const bridge = await page.evaluate(() => window.OctaveFilePick.status());
console.log(`  （桥状态: ${JSON.stringify(bridge).slice(0, 200)}）`);

console.log('--- ③ 第二次调用：拿到结果，且**文件字节可读** ---');
// ⚠️ 每次调用都会**消费**结果（返回后即清空）。所以只调一次、把结果存进变量，
// 后续断言都基于变量 —— 第一版每条断言都重调，于是后面几条又去开了新框
// （测试自己的病，不是实现的病）。"结果被消费"由 ④ 的第一条来证：若旧结果还在，
// 那次调用就不会报错。
await ev('★取结果（只调这一次）', "[uf_f,uf_p,uf_i]=uigetfile({'*.txt','Text'}); disp(uf_f)", 'hello.txt');
await ev('★返回的路径非空', 'disp(num2str(!isempty(uf_p)))', '1');
await ev('★filter index = 1', 'disp(num2str(uf_i))', '1');
await ev('★选中的文件**内容**能在 Octave 里读出来',
  'disp(strtrim(fileread(fullfile(uf_p,uf_f))))', 'hello from the picker');
await new Promise(r => setTimeout(r, 800));

console.log('--- ④ 取消 → 返回 0（与桌面版一致）---');
scenario = 'cancel';
await evErr('第一次调用（准备取消；若旧结果未被消费，这里就不会报错）', "uigetfile({'*.txt','Text'})", 'has been opened in the page');
await new Promise(r => setTimeout(r, 2500));
await ev('★取消后返回 0', "[f,p,i]=uigetfile({'*.txt','Text'}); disp(num2str(isequal(f,0)))", '1');

console.log('--- ⑤ 多选 → 返回 cell ---');
scenario = 'multi';
await evErr('第一次调用（多选）', "uigetfile({'*.txt','Text'},'MultiSelect','on')", 'has been opened in the page');
await new Promise(r => setTimeout(r, 2500));
await ev('★多选取结果（只调这一次）',
  "[mf,mp]=uigetfile({'*.txt','Text'},'MultiSelect','on'); disp([num2str(iscell(mf)) ' ' num2str(numel(mf))])", '1 2');
await ev('第二个文件也能读', 'disp(num2str(!isempty(fileread(fullfile(mp,mf{2})))))', '1');
await ev('多选内容正确（逐个核）', 'disp(strtrim(fileread(fullfile(mp,mf{2}))))', 'second');

console.log('--- 回归护栏 ---');
// ⚠️ 这里原来断言的是**反向**的东西：`help uigetfile` 曾因 `.m` docstring 走运行时
// makeinfo（本构建无 shell）而报错 —— 那是 T8 之前就存在的缺口，当时用一条"断言那个
// 既存错误"的护栏把它钉住，免得将来误判成本批引入的。
// **P1（2026-09-22）把缺口补上了**（.m docstring 构建期预渲染），于是这条护栏在 8762 的
// 全量回归里如实报错 —— 护栏该有的行为。现在翻成正向断言：
await ev('help uigetfile 现在可读（P1 已补 .m docstring）',
  'h=help("uigetfile"); disp([num2str(!isempty(h)) " " num2str(!isempty(strfind(h,"MultiSelect")))])', '1 1');
await evNot('help uigetfile 不再报 makeinfo', 'h=help("uigetfile"); disp("done")', 'makeinfo');
await ev('无整页 trap', 'disp("alive")', 'alive');

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
