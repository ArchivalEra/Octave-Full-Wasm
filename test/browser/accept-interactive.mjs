// 验收（小口子 3）：交互/等待一族 —— **要么能用，要么清晰报错，绝不许挂死**
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 为什么有它（2026-09-24 实测）：
//   · `waitbar` 以前**整族坏掉** —— 它建图时带 `"integerhandle","off"`，而桥把面板号当图号
//     传给 `__go_figure__` ⇒ `invalid graphics object` ⇒ waitbar/dialog/uisetfont 全部死在
//     `get: invalid handle (= 2)`。修 `plotbridge/figure.m`（这一对参数要传 NaN）之后
//     **waitbar 真能用**：句柄有效、tag=waitbar、1 个 axes、`getframe` 有墨。
//   · `ginput` / `keyboard` / `uisetfont` / `uiwait` / `waitfor` 以前**挂死页面**
//     （实测 8 s 无响应）—— 这比报错更糟（用户看到的是页面卡死）。
//     它们都需要"等浏览器事件时把 wasm 挂起"（JSPI 车道的 G3/G5）⇒ 现在由
//     `build/webshims/` 覆写成**清晰报错**。
//
// ★ 本套件的关键能力是**把"挂死"测成失败**：每个"不许挂死"的用例都在**新页面**里跑，
//   并在 Node 侧加超时 —— 挂死时 `page.evaluate` 永不 resolve，超时即判失败（而不是把
//   整个套件卡在这里）。这是上一轮学到的：交互面必须用"Node 侧计时 + 新页面"来测。
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/accept-interactive.mjs [URL]
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const HANG_MS = 8000;                      // 超过它就认为"挂死"（实测挂死是无限等，8 s 足够区分）
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext();

let pass = 0, fail = 0;
const check = (ok, label, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 200)}`); };

// 每个用例一个新页面：挂死会阻塞该页面的主线程，同页后面的用例就都测不到了。
async function fresh () {
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => logs.push(m.text()));
  page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 120)));
  await page.goto(URL, { waitUntil: 'load', timeout: 240000 });
  const t = Date.now();
  while (Date.now() - t < 240000) {
    if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) break;
    await new Promise(r => setTimeout(r, 200));
  }
  return { page, logs };
}
// ⚠️ **不能只等固定时长**：本构建**第一次建图**会先刷一屏 gl4es 初始化日志，`disp` 的输出
//    排在它后面（实测 >2.5 s，随机器负载浮动）。所以匹配输出的用例传一个 `sentinel`，
//    这里**轮询到出现为止**（最多 9 s）—— 固定 sleep 会让这套件随机假失败.
async function run (page, logs, code, sentinel = null, budget = 9000) {
  logs.length = 0;
  let r;
  try {
    r = await Promise.race([
      page.evaluate(x => ({ rc: window.Module.eval_string(x), err: window.Module.last_error_message() }), code),
      new Promise((_, rej) => setTimeout(() => rej(new Error('__HANG__')), HANG_MS)),
    ]);
  } catch (e) {
    const hung = String(e.message).includes('__HANG__');
    return { rc: hung ? 'HANG' : 'CRASH', err: String(e.message).slice(0, 120), out: clean(logs) };
  }
  const t = Date.now();
  while (sentinel && Date.now() - t < budget && !sentinel.test(logs.join(' '))) {
    await new Promise(rr => setTimeout(rr, 150));
  }
  if (!sentinel) await new Promise(rr => setTimeout(rr, 600));
  return { rc: r.rc, err: r.err || '', out: clean(logs) };
}
// ⚠️ **按行**过滤 gl4es/WebGL 噪音，**不要**写成 `text.replace(/LIBGL:[^|]*/g, '')`：本构建的
//    日志里根本没有 `|`，于是 `[^|]*` 会一路吃到**整段日志末尾**（含我们要匹配的那一行）
//    —— 症状是"断言永远读到空串"。这是本套件第一版真踩的坑（waitbar 那三条因此假失败）。
const clean = (logs) => logs
  .filter(l => !/^LIBGL:/.test(l) && !/^\[\.WebGL/.test(l) && !/^WebGL: INVALID/.test(l))
  .join(' ').replace(/\s+/g, ' ').trim();

// ── ① waitbar：真能用（以前整族坏在 figure 的 integerhandle 上）────────────────
{
  const { page, logs } = await fresh();
  let r = await run(page, logs, 'close all; h = waitbar(0.25, "loading"); disp(sprintf("VALID=%d TAG=%s TYPE=%s", ishghandle(h), get(h,"tag"), get(h,"type")))', /VALID=/);
  check(r.rc === 0 && /VALID=1 TAG=waitbar TYPE=figure/.test(r.out),
    '★ waitbar 建得出来：句柄有效、tag=waitbar（以前死在 get: invalid handle (= 2)）', r.out);
  r = await run(page, logs, 'disp(sprintf("AXES=%d", numel(findall(h, "type", "axes"))))', /AXES=/);
  check(r.rc === 0 && /AXES=1/.test(r.out), 'waitbar 里有 1 个 axes', r.out);
  r = await run(page, logs, 'waitbar(0.75, h); ax = findall(h, "type", "axes"); hp = get(ax, "children"); disp(sprintf("UPDATED=%d", numel(get(hp(1), "xdata"))))', /UPDATED=/);
  check(r.rc === 0 && /UPDATED=4/.test(r.out), '★ waitbar(frac, h) 更新那条进度条（xdata 4 点）', r.out);
  r = await run(page, logs, 'disp(sprintf("INK=%d", sum(sum(getframe(h).cdata(:,:,1)))))', /INK=/);
  const ink = Number((r.out.match(/INK=(\d+)/) || [])[1] || 0);
  check(r.rc === 0 && ink > 1000, '★ waitbar 真画出东西了（getframe 有墨）', `INK=${ink}`);
  r = await run(page, logs, 'close(h); disp(sprintf("AFTER=%d", ishghandle(h)))', /AFTER=/);
  check(r.rc === 0 && /AFTER=0/.test(r.out), 'waitbar 的图能关掉（close 后句柄失效）', r.out);
  await page.close().catch(() => {});
}

// ── ② "不许挂死"一族：必须**清晰报错**（不是 TypeError、不是超时、不是静默）──────
// 每个都点名"为什么不行 + 去哪看"，因为这些名字在桌面版都可用，用户会以为是自己用错了。
const NOHANG = [
  ['ginput(1)',            'ginput(1)',                      /ginput: interactive mouse input is not available/],
  ['keyboard',             'keyboard',                       /keyboard: the nested command prompt is not available/],
  ['uisetfont',            'uisetfont',                      /uisetfont: the font-picker dialog is not available/],
  ['uiwait(gcf())',        'close all; h = figure(); uiwait(h)',  /uiwait: waiting for user interaction is not available/],
  ['waitfor(gcf())',       'close all; h = figure(); waitfor(h)', /waitfor: waiting for an object property or a click is not available/],
  ['waitforbuttonpress',   'waitforbuttonpress()',           /ginput: interactive mouse input is not available/],
  ['gtext("label")',       'clf; plot(1:3); gtext("label")', /ginput: interactive mouse input is not available/],
];
for (const [label, code, want] of NOHANG) {
  const { page, logs } = await fresh();
  const r = await run(page, logs, code);
  const ok = r.rc === 2 && want.test(r.err + ' ' + r.out);
  check(ok, `★ ${label}：清晰报错（以前**挂死**）`, r.rc === 'HANG' ? '★★ 仍然挂死' : (r.err || r.out));
  await page.close().catch(() => {});
}

// ── ③ 覆写生效的证据：名字解析指向 webshims（而不是核心实现）──────────────────
{
  const { page, logs } = await fresh();
  const r = await run(page, logs, 'ns = {"ginput","keyboard","uisetfont","uiwait","waitfor"}; for k=1:numel(ns); fprintf("%s->%s ", ns{k}, which(ns{k})); end; fprintf("\\n")', /waitfor->/);
  const allWeb = ['ginput', 'keyboard', 'uisetfont', 'uiwait', 'waitfor']
    .every(n => new RegExp(n + '->[^ ]*webshims/' + n + '\\.m').test(r.out));
  check(r.rc === 0 && allWeb, '★ 五个名字都解析到 build/webshims 的覆写（R1 的机制：.m 遮得住内建/核心）', r.out);
  const r2 = await run(page, logs, 'disp(sprintf("kb=%d popen=%d", exist("keyboard"), exist("popen")))', /kb=/);
  check(r2.rc === 0 && /kb=2 popen=2/.test(r2.out),
    '交底：覆写后 exist() 从 5（内建）/2 变成 2 —— 名字面如实反映"这是 .m 覆写"', r2.out);
  await page.close().catch(() => {});
}

// ── ④ 对照：真正能用的交互入口没被误伤 ────────────────────────────────────────
{
  const { page, logs } = await fresh();
  const r = await run(page, logs, 'disp(sprintf("menu=%d input=%d", exist("menu"), exist("input")))', /menu=/);
  // `input` 是**内建**（exist=5），走 `window.prompt`（同步浏览器 API）⇒ 本来就能用；
  // `menu` 是核心 `.m`（回落成控制台菜单，也走 input）。两个都不在我们的覆写名单里。
  check(r.rc === 0 && /menu=2 input=5/.test(r.out), '对照：menu / input（走 window.prompt，**能用**）没被覆写', r.out);
  await page.close().catch(() => {});
}

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
console.log('（本套件每例开新页面 + Node 侧 8 s 超时：**"挂死"会被判成失败**，不会把套件卡住）');
await browser.close();
process.exit(fail ? 1 : 0);
