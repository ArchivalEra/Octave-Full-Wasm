// 探针：名字面与"已知偏差"的**当班实况**（2026-09-24，缺口语义审计）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 为什么要有它：HANDOFF §7 有一批"名字能用/不能用"的断言，而它们会**随构建变化而腐烂**
// ——本轮就抓到三条与文档口径不符的：
//   · `popen` **不是**"清晰报错"，它静默返回 `-1`（而 `system`/`unix` 是清晰报错）；
//   · `listfonts()` **不是**"返回空"，它报 `structure has no member 'family'`；
//   · "句柄/对话框一族未做"这条**大部分已经不成立**了 —— 真渲染器上线后
//     `hgsave`/`copyobj`/`uicontrol`/`uimenu`/`gcbo`/`menu`/`movie` 实测都能用。
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/probe-core-names.mjs [URL]
// 退出码：0 = **该成立的都成立**（已知缺口按"仍然如此"记录，不算失败）；1 = 出现意外
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text().slice(0, 400)));
page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 200)));
await page.goto(URL, { waitUntil: 'load', timeout: 240000 });
const t0 = Date.now();
while (Date.now() - t0 < 300000) {
  if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) break;
  await new Promise(r => setTimeout(r, 300));
}
console.log(`URL=${URL} ready=${((Date.now() - t0) / 1000).toFixed(1)}s`);

async function run (code, ms = 900) {
  logs.length = 0;
  const r = await page.evaluate(x => {
    const rc = window.Module.eval_string(x);
    return { rc, err: window.Module.last_error_message() };
  }, code);
  await new Promise(rr => setTimeout(rr, ms));
  // gl4es 开场的 banner 与 GPU stall 提示是噪音，去掉
  const out = logs.join(' ').replace(/LIBGL:[^|]*?(?=[A-Z]|$)/g, '').replace(/\s+/g, ' ').trim();
  return { rc: r.rc, err: r.err || '', out };
}
let pass = 0, fail = 0;
const check = (ok, label, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 150)}`); };

// ── ① shell 一族：★ **"清晰报错"只在两输出形式成立**（本轮实测，HANDOFF §7 之前写笼统了）
// 上游语义：`[st,out]=system(cmd)` 走 popen 那条路（失败即 error）；而 `st=system(cmd)` /
// `system(cmd)` 走"返回状态"那条路 —— 在无 shell 的构建里就是**静默 -1 / 静默通过**。
let r = await run('try; [st,out] = system("ls"); disp("NOERR"); catch e; disp(["E: " e.message]); end');
check(r.rc === 0 && /unable to start subprocess/.test(r.out),
  'system [st,out]（两输出）：清晰报错（无 shell，有意保持）', r.out);
r = await run('try; [st,out] = unix("pwd"); disp("NOERR"); catch e; disp(["E: " e.message]); end');
check(r.rc === 0 && /unable to start subprocess/.test(r.out), 'unix [st,out]：同上', r.out);
// ★ 静默失败那两条是**已知缺口**（候选：用覆写层改成清晰报错）
r = await run('st = system("ls"); disp(sprintf("st=%d",st))');
check(r.rc === 0 && /st=-1/.test(r.out),
  '★ 已知缺口：`st = system(cmd)` **静默返回 -1**（不抛错 —— 与项目自己的"宁可清晰报错"相悖）', r.out);
r = await run('system("ls"); disp("SURVIVED")');
check(r.rc === 0 && /SURVIVED/.test(r.out),
  '★ 已知缺口：`system(cmd)`（无输出参数）**静默通过**', r.out);
r = await run('try; print("/tmp/pn.png","-dpng"); disp("NOERR"); catch e; disp(["E: " e.message]); end');
check(r.rc === 0 && /no rasteriser|not available/.test(r.out), 'print -dpng 清晰报错（无光栅器）', r.out);
r = await run('try; print("/tmp/pn.pdf","-dpdf"); disp("NOERR"); catch e; disp(["E: " e.message]); end');
check(r.rc === 0 && /Ghostscript|not available/.test(r.out), 'print -dpdf 清晰报错（无 gs）', r.out);

// ── ② 已知缺口：**仍然如此**才算通过（变了就该改文档）─────────────────────
r = await run('fid=popen("ls","r"); disp(sprintf("fid=%d",fid))');
check(r.rc === 0 && /fid=-1/.test(r.out),
  '★ 已知缺口：popen() **静默返回 -1**（不是清晰报错 —— §7 之前写错了）', r.out);
r = await run('try; L=listfonts(); disp(sprintf("nf=%d",numel(L))); catch e; disp(["E: " e.message]); end');
check(r.rc === 0 && /structure has no member/.test(r.out),
  '★ 已知缺口：listfonts() 报"结构无成员"（无 fontconfig 的后果，不是空列表）', r.out);
r = await run('try; questdlg("q?"); disp("NOERR"); catch e; disp(["E: " e.message]); end');
check(r.rc === 0 && /not available in this version/.test(r.out),
  '已知缺口：questdlg 按上游口径报 not available（无 dialogs）', r.out);
r = await run('x=[0 .5 1 .5 0]; y=[0 .5 0 1 .5]; try; voronoi(x,y); disp("NOERR"); catch e; disp(["E: " e.message]); end');
check(r.rc === 0 && /sizes do not match/.test(r.out),
  '已知缺口：voronoi **单输出**报尺寸不符（桥不支持 plot(hax,…)）', r.out);
r = await run('[vx,vy]=voronoi([0 .5 1 .5 0],[0 .5 0 1 .5]); disp(sprintf("cells=%d",numel(vx)))');
check(r.rc === 0 && /cells=\d+/.test(r.out), '对照：voronoi **两输出**正常', r.out);

// ── ③ 「句柄/对话框一族」：本轮实测**多数已能用**（以前记成"未做"）─────────
const NAMES = [
  ['hgsave',    'clf; plot(1:5); hgsave("/tmp/pn.hgs"); disp(exist("/tmp/pn.hgs"))', /(^|\s)2(\s|$)/],
  ['copyobj',   'clf; plot(1:5); c=copyobj(get(gca,"children"),gca); disp(numel(c))', /(^|\s)1(\s|$)/],
  ['uicontrol', 'clf; h=uicontrol("style","pushbutton","string","x"); disp(get(h,"string"))', /x/],
  ['uimenu',    'clf; h=uimenu(gcf,"label","m"); disp(numel(h))', /(^|\s)1(\s|$)/],
  ['gcbo',      'disp(exist("gcbo"))', /(^|\s)2(\s|$)/],
  ['menu',      'disp(exist("menu"))', /(^|\s)2(\s|$)/],
  ['movie',     'clf; plot(1:3); F=getframe(gcf); try; movie(F,1,1); disp("ONE"); catch e; disp(["E: " e.message]); end', /at least two frames/],
];
for (const [name, code, want] of NAMES) {
  const rr = await run(code, 1100);
  check(rr.rc === 0 && want.test(rr.out), `句柄族实测可用：${name}（真渲染器上线后已能用）`, rr.out);
}

// ── ④ 字体：fontname 存得住（渲染时被忽略，见 §5.26 的代价）──────────────
r = await run('clf; plot(1:3); set(gca,"fontname","Courier"); disp(get(gca,"fontname"))');
check(r.rc === 0 && /Courier/.test(r.out), 'fontname 属性可存可读（渲染时被忽略：无 fontconfig）', r.out);

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
console.log('（★ 标记的是"已知缺口仍然如此"；若某条变红/变绿，说明构建行为变了，要同步 HANDOFF §7）');
await browser.close();
process.exit(fail ? 1 : 0);
