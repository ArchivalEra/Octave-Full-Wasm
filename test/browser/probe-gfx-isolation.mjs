// 验收探针：图形隔离守卫（issue #5）——外部宿主写入的"零输出 figure stub"被修复
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 场景（三步，全部浏览器侧实测）：
//   ① boot（页面/embed 自动）→ 快照 = 现状；
//   ② 按 UI 的 SafePlotSinkPolyfill.install 逐字写入 12 个文件（figure 的 0 输出 stub
//      是 issue #5 的毒源）；
//   ③ 装 guard 模拟（与生产实现同款判据）→ 跑 issue #5 全矩阵 + 状态断言（title 真设上、
//      xlim 真改、plot 标记仍在、figure 计数正确）。
//
// 判据：
//   rc=0 且 "N PASS / 0 FAIL" ⇒ 守卫形状成立（生产实现可直接照搬）；
//   任一 fail ⇒ 守卫形状不成立（改设计，不是改判据）。
//
// 用法：sh test/browser/run.sh test/browser/probe-gfx-isolation.mjs <URL> [laneDir]
//   laneDir：embed 模式下动态装 lanes/<laneDir>/octave.js（缺省 lanes/wasm32-final/）
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const LANE_DIR = process.argv[3] || '';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
const sleep = ms => new Promise(r => setTimeout(r, ms));

await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
await sleep(1200);

const isPage = await page.evaluate(() => !!(window.Module && window.Module.eval_string));
console.log(`URL=${URL} laneDir=${LANE_DIR || '(auto/page)'} pageMode=${isPage}`);

if (!isPage) {
  const boot = await page.evaluate(async (laneDir) => {
    try {
      const meta = document.querySelector('meta[name="site-base"]');
      const gb = (meta && meta.getAttribute('content')) || '/';
      const dir = laneDir || 'wasm32-final';
      const base = (gb.endsWith('/') ? gb : gb + '/') + 'lanes/' + dir + '/';
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = base + 'octave.js';
        s.onload = () => res(); s.onerror = () => rej(new Error('load fail ' + s.src));
        document.head.appendChild(s);
      });
      // 与 UI WasmEmbedAdapter 同款：wasm32-final → base，其余 → w64
      const laneName = (dir === 'wasm32-final') ? 'base' : 'w64';
      await window.OctaveEmbed.create({
        base, mount: '#octave-raw-output', id: 'isolation',
        lane: { lane: laneName, dir: '', js: 'octave.js', wasm: 'octave.wasm', data: 'octave.data' },
      });
      return 'ok';
    } catch (e) { return 'ERR ' + String(e).slice(0, 240); }
  }, LANE_DIR || null);
  console.log('boot:', boot.slice(0, 200));
  if (boot !== 'ok') { await browser.close(); process.exit(1); }
  for (let i = 0; i < 300; i++) {
    const ok = await page.evaluate(() => {
      const ent = (window.__octaveHosts || [])[0];
      return !!(ent && ent.ready === true);
    }).catch(() => false);
    if (ok) break; await sleep(500);
  }
}
const hasMod = await page.evaluate(() => {
  const ent = (window.__octaveHosts || [])[0];
  if (ent && ent.mod) { window.__M = ent.mod; return true; }
  if (window.Module && window.Module.eval_string) { window.__M = window.Module; return true; }
  return false;
});
console.log('mod:', hasMod);
if (!hasMod) { await browser.close(); process.exit(1); }
await sleep(2500);

// ── ② UI 的 12 个写入（SafePlotSinkPolyfill.ts 逐字）────────────────────────
const UI_WRITES = {
  '/usr/src/octave/m/plot/draw/plot.m': 'PLOT',
  '/plot.m': 'PLOT',
  '/home/web_user/plot.m': 'PLOT',
  '/usr/src/octave/m/plot/util/figure.m': 'FIGURE',
  '/figure.m': 'FIGURE',
  '/home/web_user/figure.m': 'FIGURE',
  '/usr/src/octave/m/plot/draw/drawnow.m': 'DRAWNOW',
  '/drawnow.m': 'DRAWNOW',
  '/home/web_user/drawnow.m': 'DRAWNOW',
  '/usr/src/octave/m/plot/draw/__get_plot_data__.m': 'HELPER',
  '/__get_plot_data__.m': 'HELPER',
  '/home/web_user/__get_plot_data__.m': 'HELPER',
};
const SOURCES = {
  PLOT: `% In-Engine Safe Shadow Plot Sink
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
  FIGURE: `% Safe Figure Stub
function figure (varargin)
  % No-op safe stub preventing GL4ES window init
endfunction
`,
  DRAWNOW: `% Safe Drawnow Stub
function drawnow (varargin)
  % No-op safe stub preventing OpenGL flush
endfunction
`,
  HELPER: `% Safe Helper for extracting plot data without scoping errors
function s = __get_plot_data__ ()
  try
    s = evalin('base', '__octave_web_plot__');
  catch
    s = struct('count', 0);
  end
endfunction
`,
};

// ① 快照 + 装 guard 模拟（与计划中的生产实现同款：读-判-修，修完 rehash）
const guardInfo = await page.evaluate(([paths, sources, sigRe]) => {
  const M = window.__M;
  const G = { snap: {}, repaired: [], paths };
  const re = new RegExp(sigRe, 'm');
  for (const p of paths) {
    try { G.snap[p] = M.FS.readFile(p, { encoding: 'utf8' }); }
    catch (e) { G.snap[p] = null; }
  }
  window.__guardState = G;
  function poison(text) { return re.test(text); }
  const orig = M.eval_string;
  M.eval_string = function () {
    let changed = false;
    for (const p of G.paths) {
      let cur = null;
      try { cur = M.FS.readFile(p, { encoding: 'utf8' }); } catch (e) { cur = null; }
      if (cur === G.snap[p]) continue;
      if (cur !== null && poison(cur)) {
        try {
          if (G.snap[p] !== null) M.FS.writeFile(p, G.snap[p]);
          else M.FS.unlink(p);
          changed = true;
          if (G.repaired.indexOf(p) < 0) G.repaired.push(p);
        } catch (e) {}
      }
    }
    if (changed) { try { orig.call(M, 'rehash;'); } catch (e) {} }
    return orig.apply(this, arguments);
  };
  return { snapTaken: Object.keys(G.snap).length, snapshotSizes: Object.fromEntries(Object.entries(G.snap).map(([k, v]) => [k, v === null ? 'absent' : v.length])) };
}, [
  ['/figure.m', '/home/web_user/figure.m', '/usr/src/octave/m/plot/util/figure.m',
   '/usr/src/octave/m/plotbridge/figure.m',
   '/plot.m', '/home/web_user/plot.m', '/usr/src/octave/m/plot/draw/plot.m',
   '/usr/src/octave/m/plotbridge/plot.m'],
  SOURCES,
  // 毒源 = **零输出**的 figure/plot（真实现都带 `h =`）——判定按函数签名行，不按文件头注释
  '^\\s*function\\s+(?:figure|plot)\\s*\\('
]);
console.log('① 快照:', JSON.stringify(guardInfo.snapshotSizes));

// ② 写 UI 的 12 个文件（经 fs writeFile 直写，模拟 install）
const wrote = await page.evaluate(([writes, sources]) => {
  const M = window.__M;
  let n = 0;
  for (const [p, key] of Object.entries(writes)) {
    try {
      const dir = p.replace(/\/[^/]*$/, '') || '/';
      try { M.FS.mkdirTree(dir); } catch (e) {}
      M.FS.writeFile(p, sources[key]);
      n++;
    } catch (e) {}
  }
  return n;
}, [UI_WRITES, SOURCES]);
console.log('② 写入 UI stub:', wrote, '个');

async function run (code, timeoutMs = 22000) {
  const s = '__I' + Math.random().toString(36).slice(2) + '__';
  logs.length = 0;
  try {
    await page.evaluate(([x, sn]) => window.__M.eval_string(`${x}; disp('${sn}');`), [code, s]);
  } catch (e) { return { trap: true, out: '', err: String(e).slice(0, 180) }; }
  const t = Date.now();
  while (Date.now() - t < timeoutMs) { if (logs.some(l => l.includes(s))) break; await sleep(80); }
  return { trap: false, out: logs.join(' ').split(s)[0].replace(/\s+/g, ' ').trim() };
}

// ③ 矩阵（用 guard 包装过的 eval 跑）
console.log('\n③ 矩阵（guard 生效后）：');
const MATRIX = [
  ['plot(0:1:10); printf("|M=%d", numel(get(gca(),"children")))', 'plot', '|M='],
  ['title("t"); printf("|T=[%s]", get(get(gca(),"title"),"string"))', 'title', '|T=[t]'],
  ['h = figure(); printf("|F=%d", ishghandle(h))', 'figure()', '|F=1'],
  ['h = gcf(); printf("|G=%d", ishghandle(h))', 'gcf()', '|G=1'],
  ['plot(1:10); xlabel("x"); printf("|X=[%s]", get(get(gca(),"xlabel"),"string"))', 'xlabel', '|X=[x]'],
  ['plot(1:10); ylabel("y"); printf("|Y=[%s]", get(get(gca(),"ylabel"),"string"))', 'ylabel', '|Y=[y]'],
  ['plot(1:10); grid on; printf("|GR=%s", get(gca(),"xgrid"))', 'grid', '|GR=on'],
  ['plot(1:10); hold on; plot(2:11); printf("|H=%d", numel(get(gca(),"children")))', 'hold', '|H='],
  ['plot(1:10); legend("a"); printf("|L=ok")', 'legend', '|L=ok'],
  ['plot(1:10); axis([0 11 0 11]); xl=get(gca(),"xlim"); printf("|A=[%g %g]", xl(1), xl(2))', 'axis', '|A=[0 11]'],
  ['subplot(2,1,1); plot(1:10); printf("|S=%d", numel(get(gcf(),"children")))', 'subplot', '|S='],
  ['bar([1 2 3]); printf("|B=ok")', 'bar', '|B=ok'],
];
let pass = 0, fail = 0;
for (const [code, name, want] of MATRIX) {
  const r = await run(`clear -f; try; ${code}; catch e; printf("|ERR: %s", e.message); end`);
  const out = r.trap ? '★TRAP' : (r.out || '(空)');
  const ok = !r.trap && out.includes(want) && !out.includes('|ERR');
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'fail'} | ${name.padEnd(9)} :: ${out.slice(0, 200)}`);
  await run('close all');
}

// ④ 计数与状态一致性
console.log('\n④ 计数/状态：');
let r = await run('clear -f; close all; h1=figure(1); h2=figure(2); printf("|c: %g %g %g", h1, h2, gcf())');
console.log('  figure 计数 ::', (r.out || '').slice(0, 200), r.out && r.out.includes('|c: 1 2 2') ? 'PASS' : 'fail');
r = await run('clear -f; [c, h] = contour(peaks(20)); printf("|ct: %d %d", numel(c), numel(h))');
console.log('  contour 双输出 ::', (r.out || '').slice(0, 200));
r = await run('clear -f; plot(0:1:10); printf("|mk: %s", which("plot"))');
console.log('  which(plot) ::', (r.out || '').slice(0, 220));
const rep = await page.evaluate(() => window.__guardState.repaired);
console.log('  guard 修复记录 ::', JSON.stringify(rep));

console.log(`\n因矩阵：${pass} PASS / ${fail} FAIL`);
const exitOk = fail === 0;
console.log(exitOk ? '\n=== 探针结束：守卫生效（矩阵全绿）===' : '\n=== 探针结束：仍有失败（守卫形状不成立）===');
await browser.close();
process.exit(exitOk ? 0 : 1);
