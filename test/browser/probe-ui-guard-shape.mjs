// 探针：issue #5 修复形状验证（清 UI 的 figure stub + 恢复核心 figure.m）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 在给定站点上：
//   ① embed boot（LANE 可配）
//   ② 写 UI 的 12 个 stub（SafePlotSinkPolyfill.install 逐字）
//   ③ 施加"守卫"：figure 三路径里凡是 UI stub 签名 ⇒ cwd/home 删除、核心路径恢复快照
//   ④ 跑 issue #5 的命令矩阵 + 状态检查（title 真设上、xlim 真改、plot 标记仍在）
//
// 用法：LANE=base sh test/browser/run.sh test/browser/probe-ui-guard-shape.mjs <URL>
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8868/';
const LANE = process.env.LANE || '';       // '' = 交给站点清单自动选；或 base/threads/w64/w64-base
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const STUB_SIG = 'No-op safe stub preventing GL4ES window init';

const STUBS = {
  '/usr/src/octave/m/plot/draw/plot.m': `% In-Engine Safe Shadow Plot Sink
function plot (varargin)
  x = [];
  y = [];
  if nargin == 1
    val = varargin{1};
    if isnumeric(val)
      y = double(val(:)');
      x = 1:length(y);
    endif
  elseif nargin >= 2
    v1 = varargin{1};
    v2 = varargin{2};
    if isnumeric(v1) && isnumeric(v2)
      x = double(v1(:)');
      y = double(v2(:)');
    endif
  endif
  s = struct('x', x, 'y', y, 'count', length(x));
  assignin('base', '__octave_web_plot__', s);
  printf("[OCTAVE_WEB_PLOT: %d points captured]\\n", length(x));
endfunction
`,
  '/plot.m': 'SAME:plot',
  '/home/web_user/plot.m': 'SAME:plot',
  '/usr/src/octave/m/plot/util/figure.m': `% Safe Figure Stub
function figure (varargin)
  % No-op safe stub preventing GL4ES window init
endfunction
`,
  '/figure.m': 'SAME:figure',
  '/home/web_user/figure.m': 'SAME:figure',
  '/usr/src/octave/m/plot/draw/drawnow.m': `% Safe Drawnow Stub
function drawnow (varargin)
  % No-op safe stub preventing OpenGL flush
endfunction
`,
  '/drawnow.m': 'SAME:drawnow',
  '/home/web_user/drawnow.m': 'SAME:drawnow',
  '/usr/src/octave/m/plot/draw/__get_plot_data__.m': `% Safe Helper for extracting plot data without scoping errors
function s = __get_plot_data__ ()
  try
    s = evalin('base', '__octave_web_plot__');
  catch
    s = struct('count', 0);
  end
endfunction
`,
  '/__get_plot_data__.m': 'SAME:helper',
  '/home/web_user/__get_plot_data__.m': 'SAME:helper',
};
const FIGURE_PATHS = ['/usr/src/octave/m/plot/util/figure.m', '/figure.m', '/home/web_user/figure.m'];

await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
await sleep(1200);
const isPage = await page.evaluate(() => !!(window.Module && window.Module.eval_string));
console.log(`URL=${URL} LANE=${LANE || '(auto)'} pageMode=${isPage}`);

if (!isPage) {
  const boot = await page.evaluate(async (lane) => {
    try {
      const meta = document.querySelector('meta[name="site-base"]');
      const globalBase = (meta && meta.getAttribute('content')) || '/';
      const base = (globalBase.endsWith('/') ? globalBase : globalBase + '/') + 'lanes/wasm32-final/';
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = base + 'octave.js';
        s.onload = () => resolve(); s.onerror = () => reject(new Error('load fail ' + s.src));
        document.head.appendChild(s);
      });
      const plan = lane
        ? { lane, dir: (lane === 'base' ? '' : lane + '/'), js: 'octave.js', wasm: 'octave.wasm', data: 'octave.data' }
        : undefined;
      await window.OctaveEmbed.create({
        base, mount: '#octave-raw-output', id: 'guard-test',
        ...(plan ? { lane: plan } : {}),
      });
      return 'ok';
    } catch (e) { return 'ERR ' + String(e).slice(0, 240); }
  }, LANE || null);
  console.log('boot:', boot.slice(0, 220));
  if (boot !== 'ok') { await browser.close(); process.exit(1); }
  for (let i = 0; i < 300; i++) {
    const ok = await page.evaluate(() => {
      const ent = (window.__octaveHosts || [])[0];
      return !!(ent && ent.ready === true);
    }).catch(() => false);
    if (ok) break;
    await sleep(500);
  }
}
const modOk = await page.evaluate(() => {
  const ent = (window.__octaveHosts || [])[0];
  if (ent && ent.mod) { window.__M = ent.mod; return true; }
  if (window.Module && window.Module.eval_string) { window.__M = window.Module; return true; }
  return false;
});
console.log('mod:', modOk);
if (!modOk) { await browser.close(); process.exit(1); }
await sleep(2500);

async function run (code, timeoutMs = 20000) {
  const s = '__V' + Math.random().toString(36).slice(2) + '__';
  logs.length = 0;
  try {
    await page.evaluate(([x, sn]) => window.__M.eval_string(`${x}; disp('${sn}');`), [code, s]);
  } catch (e) { return { trap: true, out: '', err: String(e).slice(0, 180) }; }
  const t = Date.now();
  while (Date.now() - t < timeoutMs) { if (logs.some(l => l.includes(s))) break; await sleep(80); }
  return { trap: false, out: logs.join(' ').split(s)[0].replace(/\s+/g, ' ').trim() };
}

// ── ① 写 UI 的 12 个 stub ─────────────────────────────
const wrote = await page.evaluate(([stubs, figPaths]) => {
  const out = {};
  const realFigure = stubs['/usr/src/octave/m/plot/util/figure.m'];
  const realPlot = stubs['/usr/src/octave/m/plot/draw/plot.m'];
  const realDrawnow = stubs['/usr/src/octave/m/plot/draw/drawnow.m'];
  const realHelper = stubs['/usr/src/octave/m/plot/draw/__get_plot_data__.m'];
  const byKey = { plot: realPlot, figure: realFigure, drawnow: realDrawnow, helper: realHelper };
  for (const [p, c] of Object.entries(stubs)) {
    let content = c;
    if (c.startsWith('SAME:')) content = byKey[c.slice(5)];
    try {
      const dir = p.replace(/\/[^/]*$/, '') || '/';
      try { window.__M.FS.mkdirTree(dir); } catch (e) {}
      window.__M.FS.writeFile(p, content);
      out[p] = 'ok';
    } catch (e) { out[p] = 'ERR ' + String(e).slice(0, 60); }
  }
  return Object.keys(out).length + ' paths written; sample=' + out[figPaths[0]];
}, [STUBS, FIGURE_PATHS]);
console.log('① stubs:', wrote);

// ── ② 快照 + 守卫（模拟修复后的行为）─────────────────
const guard = await page.evaluate(([figPaths, sig]) => {
  const rep = { snapshot: null, actions: {} };
  let snap = null;
  try { snap = window.__M.FS.readFile(figPaths[0], { encoding: 'utf8' }); } catch (e) {}
  if (snap && snap.includes(sig)) { rep.snapshot = 'REFUSED (已是 stub)'; snap = null; }
  else rep.snapshot = snap ? ('taken ' + snap.length + 'B') : 'none';
  for (const p of figPaths) {
    let cur = null;
    try { cur = window.__M.FS.readFile(p, { encoding: 'utf8' }); } catch (e) { rep.actions[p] = 'absent'; continue; }
    if (!cur.includes(sig)) { rep.actions[p] = 'clean(skip)'; continue; }
    if (p === figPaths[0]) {
      if (snap) { window.__M.FS.writeFile(p, snap); rep.actions[p] = 'restored ' + snap.length + 'B'; }
      else rep.actions[p] = 'STUB-KEPT(no snapshot)';
    } else {
      try { window.__M.FS.unlink(p); rep.actions[p] = 'unlinked'; } catch (e) { rep.actions[p] = 'unlink-ERR'; }
    }
  }
  return rep;
}, [FIGURE_PATHS, STUB_SIG]);
console.log('② guard:', JSON.stringify(guard));

// ── ③ 矩阵 ────────────────────────────────────────
console.log('\n③ 矩阵（守卫后）：');
const MATRIX = [
  ['plot(0:1:10)', 'MARKER', 'OCTAVE_WEB_PLOT'],
  ['title("t"); printf("T=[%s]", get(get(gca(),"title"),"string"))', 'title', 'T=[t]'],
  ['h = figure(); printf("FIG=%d", ishghandle(h))', 'figure()', 'FIG=1'],
  ['h = gcf(); printf("GCF=%d", ishghandle(h))', 'gcf()', 'GCF=1'],
  ['plot(1:10); xlabel("x"); printf("X=[%s]", get(get(gca(),"xlabel"),"string"))', 'xlabel', 'X=[x]'],
  ['plot(1:10); grid on; printf("G=[%s]", get(gca(),"xgrid"))', 'grid', 'G=[on]'],
  ['plot(1:10); hold on; plot(2:11); legend("a","b"); printf("LEG=%d", numel(get(gca(),"children")))', 'legend', 'LEG='],
  ['plot(1:10); axis([0 11 0 11]); xl=get(gca(),"xlim"); printf("XL=[%g %g]", xl(1), xl(2))', 'axis', 'XL=[0 11]'],
  ['subplot(2,1,1); plot(1:10); printf("SUB=%d", numel(get(gcf(),"children")))', 'subplot', 'SUB='],
  ['bar([1 2 3]); printf("BAR-OK")', 'bar', 'BAR-OK'],
];
let pass = 0, fail = 0;
for (const [code, name, want] of MATRIX) {
  const r = await run(`clf; clear -f; try; ${code}; printf("|%s OK", '${name}'); catch e; printf("|%s ERR: %s", '${name}', e.message); end`);
  const out = r.trap ? '★TRAP' : (r.out || '(空)');
  const ok = !r.trap && out.includes(want) && !out.includes('ERR');
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'fail'} | ${name.padEnd(9)} :: ${out.slice(0, 200)}`);
  await run('close all');
}
console.log(`\n因为图形状态检查：${pass} PASS / ${fail} FAIL`);

// ── ④ 解析自证 ────────────────────────────────────
const w = await run('printf("WF=[%s] WP=[%s]", which("figure"), which("plot"))');
console.log('④ which:', (w.out || '').slice(0, 220));
const fs1 = await page.evaluate(([p]) => {
  try { return window.__M.FS.readFile(p, { encoding: 'utf8' }).slice(0, 50).replace(/\n/g, ' '); }
  catch (e) { return 'ABSENT'; }
}, ['/figure.m']);
console.log('   /figure.m:', fs1);

console.log('\n=== 探针结束 ===');
await browser.close();
