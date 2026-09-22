// T9 验收：`help <mfile>` 可用（.m docstring 构建期预渲染）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/accept-t9-helpm.mjs [URL]
//
// 背景：`.m` 文件的 docstring 是**运行时从文件里读**的，且**永远不查
// `built-in-docstrings`**（那条回退只在符号表和文件查找都失败时才走），所以 T1 那张表
// 救不了它；带 `-*- texinfo -*-` 标记时 `help` 会去调 makeinfo，而本构建没有 shell
// ⇒ `help ode45` 一直报 `system: unable to start subprocess for 'makeinfo …'`。
//
// 治法（与 T1 同构）：**构建期**把 docstring 渲染成纯文本、去掉标记，再预载进主链
// （`build/prerender-m-docstrings.py` + `build/render_docstring_batch.m`；渲染用官方的
// `__makeinfo__`，宿主同版 ⇒ 与桌面逐字一致，离线抽样 25/25 已验）。
//
// ⚠️ 断言必须查**正文内容**，不能只查"没报错" —— 这是本仓走过一次弯路的教训
//    （CLIBS.md 批次 T1：自研渲染器那次自测全过，因为只断言了"不是 makeinfo 错误"）。
import { chromium } from 'playwright-core';

const TARGET = process.argv[2] || 'http://127.0.0.1:8761/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text().slice(0, 800)));
page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 400)));
await page.goto(TARGET, { waitUntil: 'load', timeout: 240000 });
const t0 = Date.now();
while (Date.now() - t0 < 300000) {
  const ok = await page.evaluate(() => { try { return !!window.Module?.feval?.('strcat', ['a', 'b'], 1); } catch { return false; } }).catch(() => false);
  if (ok) break; await new Promise(r => setTimeout(r, 800));
}
console.log(`URL=${TARGET} ready=${((Date.now() - t0) / 1000).toFixed(1)}s`);
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
  await new Promise(rr => setTimeout(rr, 500));
  const out = [...logs].join(' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  const ok = r.rc === 0 && (!want || out.includes(want));
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${out || ('rc=' + r.rc + ' ' + r.err.slice(0, 180))}`);
}
// 负向断言：这些串**不该**出现在输出里
async function evNot (label, expr, unwanted) {
  logs.length = 0;
  let r;
  try { r = await page.evaluate(x => { const rc = window.Module.eval_string(x); return { rc, err: window.Module.last_error_message() }; }, expr); }
  catch (e) { console.log(`CRASH | ${label} :: ${String(e).slice(0, 130)}`); fail++; return; }
  await new Promise(rr => setTimeout(rr, 500));
  const out = [...logs].join(' ') + ' ' + (r.err || '');
  const ok = r.rc === 0 && !out.includes(unwanted);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${ok ? '（未出现 ' + unwanted + '）' : out.replace(/\s+/g, ' ').slice(0, 200)}`);
}

console.log('--- ① 核心：.m 文件的 help 有正文、且不再撞 makeinfo ---');
// ⚠️ 别只取前 N 个字符断言：`help` 的开头是签名行（`-- [T, Y] = ode45 (...)`），
// 正文在更后面。要在**整段**里找关键词。
await ev('★help ode45 有正文（整段找关键词）',
  'h=help("ode45"); disp([num2str(!isempty(strfind(h,"non-stiff"))) " " num2str(!isempty(strfind(h,"Solve a set of")))])', '1 1');
await evNot('★help ode45 不报 makeinfo', 'h=help("ode45"); disp("done")', 'makeinfo');
await ev('★help uigetfile 有正文（签名行）', 'h=help("uigetfile"); disp(!isempty(strfind(h,"MultiSelect")))', '1');
await evNot('★help uigetfile 不报 makeinfo', 'h=help("uigetfile"); disp("done")', 'makeinfo');
await ev('help ode15s 有正文', 'h=help("ode15s"); disp(!isempty(strfind(h,"stiff")))', '1');
// 用它自己的名字兜底（签名行里必有），别赌正文里的某个词
await ev('help fzero 有正文', 'h=help("fzero"); disp([num2str(!isempty(strtrim(h))) " " num2str(!isempty(strfind(h,"fzero")))])', '1 1');

console.log('--- ② 预渲染痕迹必须干净（标记/宏都不能露出来）---');
await evNot('正文里不该有 @deftypefn', 'h=help("ode45"); disp("done")', '@deftypefn');
await evNot('正文里不该有 texinfo 标记', 'h=help("meshgrid"); disp("done")', '-*- texinfo -*-');
await evNot('正文里不该有 @seealso 原文', 'h=help("polyfit"); disp("done")', '@seealso');

console.log('--- ③ 抽样扫一遍（覆盖多个目录；每条都要非空且不含宏）---');
const sweep = [
  // ⚠️ 用 strsplit 而不是多行 `{...}`：Octave 的 cell 字面量里**换行 = 换行**，
  //    每行列数必须一致，否则报 "number of columns must match"（踩过）。
  'ff=strsplit("ode45 ode23 ode15s ode23s decic odeget odeset uigetfile meshgrid interp2 histc '
  + 'fzero fminsearch sprand polyfit uniquetol tfqmr grabcode peaks gradient newplot fsolve '
  + 'strsplit textread imread quadgk integral trapz cumtrapz datevec");',
  'bad=0; empty=0; mac=0;',
  'for k=1:numel(ff)',
  '  try',
  '    h=help(ff{k});',
  '  catch',
  '    bad=bad+1;',
  '    continue;',
  '  end_try_catch',
  '  if isempty(strtrim(h)), empty=empty+1; endif',
  '  if !isempty(strfind(h,"@deftypefn")) || !isempty(strfind(h,"@seealso")), mac=mac+1; endif',
  'endfor',
  'printf("bad=%d empty=%d mac=%d\\n", bad, empty, mac);'
].join('\n');
// ⚠️ 表达式要用**换行**拼：用空格拼的话 `end_try_catch if` 会语法错（踩过）
await ev('★30 个函数的 help 全部可读（非空且不含宏）', sweep, 'bad=0 empty=0 mac=0');

console.log('--- ④ 内建不回归（T1 那条路要还在）---');
await ev('help sin（内建，走 built-in-docstrings）', 'h=help("sin"); disp(!isempty(strfind(h,"sine")))', '1');
await ev('help sqrt（内建）', 'h=help("sqrt"); disp(!isempty(strfind(h,"square root")))', '1');
await ev('没有自研渲染器残留', 'disp(exist("__tf_texinfo_to_plain__"))', '0');
await ev('__makeinfo__ 仍是官方文件', 'disp(!isempty(strfind(which("__makeinfo__"), "m/help/__makeinfo__.m")))', '1');
await ev('lookfor 仍可用', 'disp(!isempty(lookfor("sine")))', '1');
await ev('disp(@sin) 不报错', 'disp(@sin); disp("ok")', 'ok');
await ev('help plot（plot 桥覆写）仍可读', 'h=help("plot"); disp(!isempty(h))', '1');

console.log('--- ⑤ 无 trap ---');
await ev('还能继续 eval', 'disp("alive")', 'alive');

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
