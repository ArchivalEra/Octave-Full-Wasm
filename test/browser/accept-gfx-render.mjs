// 验收：**引擎图形栈真的把图送上屏了吗**（issue #5 评论的 5 项余留，2026-10-09）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 这一套在验什么 ──────────────────────────────────────────────────────────
// issue #5 第二轮评论报的不是"报错"，而是**静默失败**：命令成功、却没有像素。
// 本套件的断言对象是**用户看得到的东西**（DOM 里的 `<img>` / 幅面 >200px 的 SVG），
// 不是"函数返回了"：
//
//   A 干净站点 · 引擎渲染通道：`plot` / `title+xlabel+grid` / `bar` / `surf` 各自
//     **贴出一张图**（PNG via toolkit → `OctaveP5.show` → `<img>` blob）
//   B `hist` 三形态（nbins / 默认 / edges）—— 评论报 `horizontal dimensions mismatch`，
//     根因 = 核心 `hist` 内部走 `bar (hax, x, freq, "hist", …)`，而桥的 bar 没剥句柄
//   C `legend` 不再抛 `no valid object to label`
//   D 反向断言：`plot` 的结果是**真句柄**（`ishghandle`），不是宿主影子桩返回的假 1
//   E 反向断言（可选 LANE/宿主桩）：装了宿主影子桩后，**图仍然上屏** —— 这是"引擎权威"
//     的可证伪判据（守卫把桩清掉 ⇒ 渲染通道回到引擎）
//
// ⚠️ 判据的写法教训：GL 首次初始化要几秒 ⇒ 每次出图后**轮询**（最多 RENDER_WAIT_MS），
//    不等一个固定 sleep（第一版写 1.5s ⇒ 假红，实测踩到）。
//
// 用法：sh test/browser/run.sh test/browser/accept-gfx-render.mjs <URL> [ui|clean]
//   ui = 先装宿主影子桩（模拟 Octave-UI 的 SafePlotSinkPolyfill 现行版本）
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const MODE = process.argv[3] || 'clean';
const RENDER_WAIT_MS = Number(process.env.RENDER_WAIT_MS || 20000);
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 200)}`);
};

await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
await sleep(1200);

// ── 宿主自动识别：页面宿主（window.Module）或 embed 宿主（__octaveHosts）──
const isPage = await page.evaluate(() => !!(window.Module && window.Module.eval_string));
if (!isPage) {
  const boot = await page.evaluate(async () => {
    try {
      const meta = document.querySelector('meta[name="site-base"]');
      const gb = (meta && meta.getAttribute('content')) || '/';
      const base = (gb.endsWith('/') ? gb : gb + '/') + 'lanes/wasm32-final/';
      await new Promise((res, rej) => {
        const s = document.createElement('script'); s.src = base + 'octave.js';
        s.onload = () => res(); s.onerror = () => rej(new Error('load ' + s.src));
        document.head.appendChild(s);
      });
      await window.OctaveEmbed.create({ base, mount: '#octave-raw-output', id: 'gfxr',
        lane: { lane: 'base', dir: '', js: 'octave.js', wasm: 'octave.wasm', data: 'octave.data' } });
      return 'ok';
    } catch (e) { return 'ERR ' + String(e).slice(0, 160); }
  });
  if (boot !== 'ok') { console.log('boot:', boot); await browser.close(); process.exit(1); }
  for (let i = 0; i < 300; i++) {
    const ok = await page.evaluate(() => { const e = (window.__octaveHosts || [])[0]; return !!(e && e.ready === true); }).catch(() => false);
    if (ok) break; await sleep(500);
  }
}
const okMod = await page.evaluate(() => {
  const ent = (window.__octaveHosts || [])[0];
  if (ent && ent.mod && ent.mod.FS) { window.__M = ent.mod; return 'embed'; }
  if (window.Module && window.Module.FS) { window.__M = window.Module; return 'page'; }
  return null;
});
if (!okMod) { console.log('no module'); await browser.close(); process.exit(1); }
console.log(`URL=${URL} MODE=${MODE} host=${okMod}`);
await sleep(1500);

if (MODE === 'ui') {
  // Octave-UI 现行 SafePlotSinkPolyfill（figure 桩已删、plot 已改 h= 、drawnow no-op）
  const PLOT = ['% In-Engine Safe Shadow Plot Sink', 'function h = plot (varargin)',
    '  x = []; y = [];', '  if nargin == 1', '    val = varargin{1};',
    '    if isnumeric(val); y = double(val(:)\'); x = 1:length(y); endif', '  elseif nargin >= 2',
    '    v1 = varargin{1}; v2 = varargin{2};',
    '    if isnumeric(v1) && isnumeric(v2); x = double(v1(:)\'); y = double(v2(:)\'); endif',
    '  endif', "  s = struct('x', x, 'y', y, 'count', length(x));",
    "  assignin('base', '__octave_web_plot__', s);", '  h = 1;', 'endfunction', ''].join('\n');
  const DRN = '% Safe Drawnow Stub\nfunction drawnow (varargin)\nendfunction\n';
  const HELPER = ["function s = __get_plot_data__ ()",
    "  try; s = evalin('base', '__octave_web_plot__'); catch; s = struct('count', 0); end",
    'endfunction', ''].join('\n');
  await page.evaluate(([plot, drn, hlp]) => {
    const M = window.__M;
    const put = (paths, c) => { for (const x of paths) { try { const d = x.replace(/\/[^/]*$/, '') || '/'; try { M.FS.mkdirTree(d); } catch (e) {} M.FS.writeFile(x, c); } catch (e) {} } };
    put(['/usr/src/octave/m/plot/draw/plot.m', '/plot.m', '/home/web_user/plot.m'], plot);
    put(['/usr/src/octave/m/plot/draw/drawnow.m', '/drawnow.m', '/home/web_user/drawnow.m'], drn);
    put(['/usr/src/octave/m/plot/draw/__get_plot_data__.m', '/__get_plot_data__.m', '/home/web_user/__get_plot_data__.m'], hlp);
  }, [PLOT, DRN, HELPER]);
  console.log('宿主影子桩已装（UI 现行版）');
}

async function run (code, timeoutMs = 30000) {
  const s = '__G' + Math.random().toString(36).slice(2) + '__';
  logs.length = 0;
  try { await page.evaluate(([x, sn]) => window.__M.eval_string(`${x}\ndisp('${sn}');`), [code, s]); }
  catch (e) { return { trap: true, out: '' }; }
  const t = Date.now();
  while (Date.now() - t < timeoutMs) { if (logs.some(l => l.includes(s))) break; await sleep(100); }
  return { trap: false, out: logs.join(' ').split(s)[0].replace(/\s+/g, ' ').trim() };
}

// 计数"页面上真有图"：png blob 的 <img>（引擎通道）或幅面 >200px 的 SVG（宿主通道）
async function canvasState () {
  return page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img'))
      .filter(i => (i.naturalWidth || 0) > 100 || /^blob:/.test(i.src || ''))
      .map(i => ({ w: i.naturalWidth, h: i.naturalHeight, src: (i.src || '').slice(0, 24) }));
    const svgs = Array.from(document.querySelectorAll('svg'))
      .filter(s => s.getBoundingClientRect().width > 200)
      .map(s => ({ cls: s.getAttribute('class') || '', text: s.querySelectorAll('text').length,
                   line: s.querySelectorAll('line').length, path: s.querySelectorAll('path').length }));
    const p5 = !!document.getElementById('p5figure');
    let pngErr = false;
    try { pngErr = /error while generating texture data/.test(''); } catch (e) {}
    return { imgs, svgs, p5 };
  });
}

// 出图 + 轮询（GL 首次初始化慢 ⇒ 不等固定 sleep）
async function renderCase (label, code, want) {
  await run(code);
  let st = null, tries = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < RENDER_WAIT_MS) {
    st = await canvasState();
    tries++;
    const shown = st.imgs.length > 0 || st.svgs.some(s => s.path > 0 || s.line > 0);
    if (shown) break;
    // 再催一次渲染（GL 首帧偶发需要二次 flush）
    await run('try; drawnow; catch; end');
    await sleep(600);
  }
  const shown = st && (st.imgs.length > 0 || st.svgs.some(s => s.path > 0 || s.line > 0));
  const dbg = logs.filter(l => /error|Error|failed|P5|texture/i.test(l)).slice(-2).map(l => l.slice(0, 90));
  check(want ? shown : !shown, label,
        `imgs=${JSON.stringify((st && st.imgs) || []).slice(0, 90)} svgs=${JSON.stringify((st && st.svgs) || []).slice(0, 90)} tries=${tries} | ${dbg.join(' ~ ')}`);
  await run('close all');
  return st;
}

console.log('\n── A 引擎渲染通道：命令后必须贴出一张图 ──────────────');
await renderCase('A1 plot(1:10) 上屏', "clear -f; plot(1:10); drawnow;", true);
await renderCase('A2 plot+title+xlabel+grid 上屏（文字/网格在引擎像素里）',
  "clear -f; x=1:10; plot(x,x.^2); title('Curve'); xlabel('Time'); ylabel('Value'); grid on; drawnow;", true);
await renderCase('A3 bar([1 2 3]) 上屏', "clear -f; bar([1 2 3]); drawnow;", true);
await renderCase('A4 surf(peaks(20)) 上屏', "clear -f; surf(peaks(20)); drawnow;", true);
await renderCase('A5 stem(1:10) 上屏', "clear -f; stem(1:10); drawnow;", true);

console.log('\n── B hist 三形态（评论报告点）──────────────────────');
for (const [label, code] of [
  ['B1 hist(x,4)', "clear -f; hist([1 2 2 3 3 3 4 4 4 4], 4); drawnow;"],
  ['B2 hist(x)', "clear -f; hist([1 2 2 3 3 3 4 4 4 4]); drawnow;"],
  ['B3 hist(x,edges)', "clear -f; hist([1 2 2 3 3 3 4 4 4 4], [1 2 3 4 5]); drawnow;"],
]) {
  const r = await run(code + " fprintf('|ok');");
  const err = (r.out || '').includes('mismatch') || (r.out || '').includes('|ERR');
  check(!r.trap && !err, label + ' 不报错', (r.out || '').slice(0, 110));
  await sleep(400);
  const st = await canvasState();
  check(st.imgs.length > 0 || st.svgs.some(s => s.path > 0), label + ' 上屏',
        `imgs=${st.imgs.length} svgPaths=${st.svgs.map(s => s.path).join(',')}`);
  await run('close all');
}

console.log('\n── C legend / D 真句柄（反向断言）───────────────────');
{
  const r = await run("clear -f; plot(1:10); legend('data'); fprintf('|ok');");
  check(!r.trap && (r.out || '').includes('|ok') && !/no valid object/i.test(r.out || ''),
        'C1 legend 不再抛 no valid object to label', (r.out || '').slice(0, 120));
  await run('close all');
}
{
  const r = await run("clear -f; h=figure(); fprintf('|handle=%d|isreal=%d', h, ishghandle(h));");
  const real = /handle=\d/.test(r.out || '') && !/handle=1\|isreal=0/.test(r.out || '');
  check(!r.trap && /isreal=1/.test(r.out || ''), 'D1 figure() 返回**真图形句柄**（不是影子桩的假 1）', (r.out || '').slice(0, 120));
  await run('close all');
}
{
  const r = await run("clear -f; h=plot(1:10); fprintf('|h=%g|ok=%d', h, ishghandle(h));");
  check(!r.trap && /ok=1/.test(r.out || ''), 'D2 plot() 返回真 line 句柄（`ishghandle`=1）', (r.out || '').slice(0, 120));
  await run('close all');
}

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
