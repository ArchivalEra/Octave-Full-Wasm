// 探针：Embed API **逐接口盘点**（工单 47）—— docs/embed-api.md 的每一行 ✅e 都在这里
// 变成一行浏览器实测（对照 qt-interpreter-events.h / event-manager.h 的语义）。
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 产出：逐行 PASS/FAIL（行号 = 接口表的行）+ 结尾 EMBED_INVENTORY_JSON（给 issue 引用）。
// ⚠ 已知边界（不算 FAIL，如实标注）：embed 页面 GL 纹理边界（plot 打死实例，E6/图形线）——
//   figures 行只测接口面，不画图；多实例边界由 accept-embed-multi 覆盖。
// 用法：HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh \
//        test/browser/probe-embed-inventory.mjs <部署了 embed-demo.html 的站点>
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8865/';
let pass = 0, fail = 0;
const rows = [];
const check = (row, qt, web, ok, detail) => {
  ok ? pass++ : fail++;
  rows.push({ row, qt, web, status: ok ? 'PASS' : 'FAIL', detail: String(detail).slice(0, 200) });
  console.log(`${ok ? 'PASS' : 'fail'} | §${row} ${qt} → ${web} :: ${String(detail).slice(0, 160)}`);
};

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
page.on('pageerror', e => console.log('   [pageerror] ' + String(e).slice(0, 160)));
await page.goto(`${URL}embed-demo.html`, { waitUntil: 'load', timeout: 120000 });

// 就绪（create 的 state=idle）
let ready = false;
for (let t = 0; t < 600; t++) {
  if (await page.evaluate(() => window.octave && window.octave.state === 'idle').catch(() => false)) { ready = true; break; }
  await new Promise(r => setTimeout(r, 250));
}
check('A', '生命周期 start_gui/close_gui', 'OctaveEmbed.create + state', ready, `state=${ready ? 'idle' : '未就绪'}`);

const all = await page.evaluate(async () => {
  const o = window.octave;
  const out = {};

  // §1.1 interpreter_output → on.output
  const got = [];
  o.on.output(t => got.push(t));
  const e1 = await o.eval("disp('inv-output-marker');");
  out.output = { rc: e1.rc, marker: /inv-output-marker/.test(got.join('')), n: got.length };

  // §1.2 display_exception → evalJSON error 字段 + on.error 回调（工单 47 修的死订阅）
  const errs = [];
  o.on.error(m => errs.push(m));
  const bad = await o.evalJSON('__no_such_var_xyz__');
  const badEval = await o.eval('error(\'inv-err-marker\'); 1;');
  out.error = { field: bad.ok === false && !!bad.error, cbHit: errs.length > 0,
                cbMsg: errs[0] || '', evalRc: badEval.rc };

  // §1.3 update_prompt → state + on.state
  const seen = [];
  o.on.state(s => seen.push(s));
  await o.eval('1;');
  out.state = { seen, current: o.state };

  // §1.4 set_workspace/clear_workspace → workspace()
  await o.eval('inv_w = magic(4);');
  const ws = await o.workspace();
  const wrow = (ws.value || []).find(x => x.name === 'inv_w');
  out.workspace = { hit: !!wrow, cls: wrow && wrow.class, size: wrow && wrow.size,
                    bytes: wrow && wrow.bytes };

  // §1.5 set_history → history()（rc 通道；**历史文本走 on.output** —— 接口表明示）
  const hOut = [];
  const offH = null;
  o.on.output(t => hOut.push(t));
  const h = await o.history();
  out.history = { ok: h.ok, outLen: hOut.join('').length, sample: hOut.join('').slice(0, 40) };

  // §1.6 directory_changed → pwd/cd 往返
  const d0 = (await o.pwd()).value;
  await o.cd('/tmp');
  const d1 = (await o.pwd()).value;
  await o.cd(String(d0));
  out.dir = { d0, d1, back: (await o.pwd()).value };

  // §1.7 edit_file/prompt_new_edit_file → fs
  o.fs.write('/tmp/.inv_probe.txt', 'inv-42');
  const txt = o.fs.read('/tmp/.inv_probe.txt');
  const ls = o.fs.ls('/tmp').find(x => x.name === '.inv_probe.txt');
  let rev = 'no-throw';
  try { o.fs.read('/tmp/.inv_missing__'); } catch (e) { rev = 'throw'; }
  o.fs.rm('/tmp/.inv_probe.txt');
  out.fs = { txt, lsHit: !!ls, rev };

  // §1.8 show_documentation → help()（文档文本走 on.output，同上）
  const hpOut = [];
  o.on.output(t => hpOut.push(t));
  const hp = await o.help('plot');
  out.help = { ok: hp.ok, hasDoc: /plot/i.test(hpOut.join('')), outLen: hpOut.join('').length };

  // §1.9 copy_image_to_clipboard → figures 接口面（⚠ GL 边界：不画图）
  let figSub = false, figExport = 'unset';
  try { figSub = o.on.figure(function () {}); } catch (e) { figSub = 'throw'; }
  try { const u = o.figures.export(); figExport = (u === null || /^data:image/.test(String(u))) ? 'graceful' : 'bad'; }
  catch (e) { figExport = 'throw'; }
  out.figures = { figSub, figExport };

  // §2.1 中断 → interrupt() 原语
  out.interrupt = { t: typeof o.interrupt, ret: typeof o.interrupt() };

  // §2.2 input 预填
  o.input('42');
  const ir = await o.eval("inv_v = input('n: ');");
  const iv = await o.evalJSON('inv_v');
  out.input = { ok: ir.ok, v: iv.value };

  // §2.3 fs.download 原语（真下载触发浏览器下载事件；headless 下只验不炸）
  let dl = 'unset';
  try { o.fs.write('/tmp/.inv_dl.txt', 'x'); dl = (o.fs.download('/tmp/.inv_dl.txt') === true) ? 'ok' : 'bad'; }
  catch (e) { dl = 'throw'; }
  out.download = dl;

  // §2.4 选档透明
  out.lane = { chosen: (window.__octaveCaps || {}).lane };
  return out;
});

check('1.1', 'interpreter_output', 'on.output(cb) + eval rc', all.output.rc === 0 && all.output.marker,
      JSON.stringify(all.output));
check('1.2', 'display_exception', 'evalJSON error 字段 + on.error(cb)', all.error.field && all.error.cbHit,
      JSON.stringify(all.error));
check('1.3', 'update_prompt', 'state + on.state(cb)', all.state.current === 'idle' && all.state.seen.length > 0,
      JSON.stringify(all.state));
check('1.4', 'set_workspace/clear_workspace', 'workspace() 结构化', all.workspace.hit && all.workspace.cls === 'double',
      JSON.stringify(all.workspace));
check('1.5', 'set_history/append/clear', 'history() 机制可用（rc=0）——⚠ 语义注记：embed 是'
      + '非交互会话，eval 进的命令不进 history ⇒ 列表合法为空，**UI 需自维护命令历史**',
      all.history.ok === true, JSON.stringify(all.history));
check('1.6', 'directory_changed', 'pwd()/cd() 往返', all.dir.d1 === '/tmp' && all.dir.back === all.dir.d0,
      JSON.stringify(all.dir));
check('1.7', 'edit_file/prompt_new_edit_file', 'fs write/read/ls/rm + 反向', all.fs.txt === 'inv-42' && all.fs.lsHit && all.fs.rev === 'throw',
      JSON.stringify(all.fs));
check('1.8', 'show_documentation', 'help(name) 文本走 on.output', all.help.ok && all.help.hasDoc,
      JSON.stringify(all.help));
check('1.9', 'copy_image_to_clipboard', 'on.figure 可挂 + export 优雅降级（⚠ GL 边界不画图）',
      all.figures.figSub === true && all.figures.figExport === 'graceful', JSON.stringify(all.figures));
check('2.1', '中断', 'interrupt() 原语', all.interrupt.t === 'function' && all.interrupt.ret === 'boolean',
      JSON.stringify(all.interrupt));
check('2.2', '回答输入请求', 'input() 预填 → input() 真拿到', all.input.ok && all.input.v === 42,
      JSON.stringify(all.input));
check('2.3', '文件下载', 'fs.download() 原语', all.download === 'ok', all.download);
check('2.4', '选档', 'UI 不用管（lane 自动选）', !!all.lane.chosen, JSON.stringify(all.lane));

// ➖ 行如实入表（UI 侧/桌面专属/调试器——v1 不承诺）
for (const nm of ['enter/execute/exit_debugger_event', 'show_preferences 等偏好系统',
                  'show_community_news 等桌面壳', '窗口管理语义（UI 自己渲染）']) {
  rows.push({ row: '➖', qt: nm, web: 'v1 不承诺（接口位留好）', status: 'N/A', detail: '' });
}

console.log('\nEMBED_INVENTORY_JSON' + JSON.stringify(rows));
console.log(`=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
