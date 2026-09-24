// 探针：名字面与"已知偏差"的**当班实况**（2026-09-24，缺口语义审计）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 为什么要有它：HANDOFF §7 有一批"名字能用/不能用"的断言，而它们会**随构建变化而腐烂**
// ——2026-09-24 首次跑出三条与文档口径不符的（`popen` 静默 -1、`listfonts` 报结构无成员、
// 句柄/对话框族大多已能用）。
//
// ★ 这条探针的价值在"**两个方向都亮**"：缺口被修好、或该成立的东西坏掉，都必须当场变红。
//   2026-09-24 第二轮改动（外部审核的 R1/R4）就触发了前一种：
//     · `popen` / `st = system(cmd)` / `system(cmd)` 的**静默 -1** 已改成清晰报错（覆写层）；
//     · `voronoi` 的**单输出**（要画图）已能走通（桥支持 `plot(hax, …)`）。
//   所以下面这两组断言从"已知缺口，仍然如此"**翻成了"必须成立"**。
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/probe-core-names.mjs [URL]
// 退出码：0 = **该成立的都成立**（仍存在的缺口按"仍然如此"记录，不算失败）；1 = 出现意外
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

// ── ① shell 一族：★ **"清晰报错"现在四种形态都成立**（2026-09-24 R1/R0 覆写层）
// 上游语义：`[st,out]=system(cmd)` 走 popen 那条路（失败即 error）；而 `st=system(cmd)` /
// `system(cmd)` 走"返回状态"那条路 —— 在无 shell 的构建里本来是**静默 -1 / 静默通过**。
// 现在 `build/webshims/system.m` 与 `popen.m` 把后者也变成清晰报错（覆写只作用于
// 解释器名字解析；C++ 内部的 `octave::popen()` 不受影响）。
let r = await run('try; [st,out] = system("ls"); disp("NOERR"); catch e; disp(["E: " e.message]); end');
check(r.rc === 0 && /unable to start subprocess/.test(r.out),
  'system [st,out]（两输出）：清晰报错（无 shell，有意保持）', r.out);
r = await run('try; [st,out] = unix("pwd"); disp("NOERR"); catch e; disp(["E: " e.message]); end');
check(r.rc === 0 && /unable to start subprocess/.test(r.out), 'unix [st,out]：同上', r.out);
// ★ 这三条以前是"已知缺口：静默 -1"（本轮修好 ⇒ 断言翻面）
r = await run('try; st = system("ls"); disp(sprintf("st=%d",st)); catch e; disp(["E: " e.message]); end');
check(r.rc === 0 && /unable to start subprocess/.test(r.out),
  '★ 已修：`st = system(cmd)` 现在清晰报错（R1 覆写层；以前静默返回 -1）', r.out);
r = await run('try; system("ls"); disp("NOERR"); catch e; disp(["E: " e.message]); end');
check(r.rc === 0 && /unable to start subprocess/.test(r.out),
  '★ 已修：`system(cmd)`（无输出参数）现在清晰报错（以前静默通过）', r.out);
r = await run('try; st = unix("pwd"); disp(sprintf("st=%d",st)); catch e; disp(["E: " e.message]); end');
check(r.rc === 0 && /unable to start subprocess/.test(r.out),
  '★ 已修：`st = unix(cmd)` 也报同一条（unix.m 走 system 两输出，本来就报）', r.out);
// ★ 小口子 5（2026-09-24）之后**断言翻面**：`-dpng` 不再是报错 —— 它把页面渲出的
// /tmp/p5_fig.png **逐字节拷**到目标路径（真渲染器在，就有图）。没 GL 时仍清晰报错。
r = await run('clf; plot(1:3); try; print("/tmp/pn.png","-dpng"); disp(sprintf("OK=%d", dir("/tmp/pn.png").bytes > 1000)); catch e; disp(["E: " e.message]); end');
check(r.rc === 0 && /OK=1/.test(r.out), '★ 已修：print -dpng 真出图（页面 PNG 逐字节拷贝）', r.out);
r = await run('try; print("/tmp/pn.pdf","-dpdf"); disp("NOERR"); catch e; disp(["E: " e.message]); end');
check(r.rc === 0 && /Ghostscript|not available/.test(r.out), 'print -dpdf 清晰报错（无 gs）', r.out);

// ── ② R1：popen 覆写层（已修 ⇒ "必须成立"）+ 剩下的已知缺口 ─────────────────
r = await run('try; fid=popen("ls","r"); disp(sprintf("fid=%d",fid)); catch e; disp(["E: " e.message]); end');
check(r.rc === 0 && /popen: unable to start subprocess/.test(r.out),
  '★ 已修：popen() 现在清晰报错（R1；以前静默返回 -1）', r.out);
r = await run('disp(which("popen"))');
check(r.rc === 0 && /webshims\/popen\.m/.test(r.out),
  '★ popen 确实被 load path 上的覆写遮住（which 指向 webshims/popen.m）', r.out);
r = await run('disp(which("system"))');
check(r.rc === 0 && /webshims\/system\.m/.test(r.out), '★ system 同上', r.out);
r = await run('try; system(); catch e; disp(["E: " e.message]); end');
check(r.rc === 0 && /Invalid call to system/.test(r.out), '对照：system() 无参仍是用法错误（覆写没吃掉它）', r.out);
// ★ 这条也**翻面**了（2026-09-24 收口时发现它一直没跟着 R3 翻）：R3（fontconfig）上线后
//   `listfonts()` 不再报"结构无成员"，而是真的列出字体（本构建只有 4 个 FreeSans 面）。
//   ⇒ 这正是本探针存在的意义：构建变了、断言没改，它当场变红。
// ⚠️ 2026-09-24 又跟着**小口子 6**翻了一次面：预载了 FreeMono ×4 之后 `listfonts()` 返回
//   **2 个家族**（而且 FreeMono 按字典序排在前面 —— 别写 `L{1} == "FreeSans"` 这种假设顺序的断言）。
r = await run('L=listfonts(); disp(sprintf("nf=%d HASMONO=%d HASSANS=%d", numel(L), any(strcmp(L,"FreeMono")), any(strcmp(L,"FreeSans"))))');
check(r.rc === 0 && /nf=2 HASMONO=1 HASSANS=1/.test(r.out),
  '★ 已修（R3 + 小口子 6 之后）：listfonts() 列出 **FreeSans 与 FreeMono** 两个家族', r.out);
r = await run('try; questdlg("q?"); disp("NOERR"); catch e; disp(["E: " e.message]); end');
check(r.rc === 0 && /not available in this version/.test(r.out),
  '已知缺口：questdlg 按上游口径报 not available（无 dialogs）', r.out);
// ★ voronoi 单输出：R4（plot(hax,…)）之后**能画了** —— 断言翻面
r = await run('clf; x=[0 .5 1 .5 0]; y=[0 .5 0 1 .5]; try; h=voronoi(x,y); disp(numel(h)>0); catch e; disp(["E: " e.message]); end');
check(r.rc === 0 && /(^|\s)1(\s|$)/.test(r.out),
  '★ 已修：voronoi **单输出**（要画图）现在能走通（R4 的 plot(hax,…)；以前报 sizes do not match）', r.out);
r = await run('[vx,vy]=voronoi([0 .5 1 .5 0],[0 .5 0 1 .5]); disp(sprintf("cells=%d",numel(vx)))');
check(r.rc === 0 && /cells=\d+/.test(r.out), '对照：voronoi **两输出**仍正常', r.out);

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
