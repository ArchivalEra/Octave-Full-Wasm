// 探针：issue #5 修复设计验证（模拟守卫拒绝 figure/plot stub 后的矩阵）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 模拟"守卫"的预期结果：figure.m 与 plot.m 的 0 输出 stub 被拒（= 不写入），
// drawnow.m / __get_plot_data__.m 允许。然后跑 issue #5 全矩阵 + legend 联动 + loglog。
// 若矩阵全绿 ⇒ 守卫拒 figure+plot 即可修好 issue #5（UI 零改动）。
//
// 用法：sh test/browser/run.sh test/browser/probe-ui-fix-design.mjs [URL]
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8868/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// UI 的 drawnow / __get_plot_data__ stub（允许写；figure/plot 被守卫拒 ⇒ 不写）
const ALLOWED = {
  '/usr/src/octave/m/plot/draw/drawnow.m': `% Safe Drawnow Stub
function drawnow (varargin)
  % No-op safe stub preventing OpenGL flush
endfunction
`,
  '/drawnow.m': 'SAME',
  '/home/web_user/drawnow.m': 'SAME',
  '/usr/src/octave/m/plot/draw/__get_plot_data__.m': `% Safe Helper for extracting plot data without scoping errors
function s = __get_plot_data__ ()
  try
    s = evalin('base', '__octave_web_plot__');
  catch
    s = struct('count', 0);
  end
endfunction
`,
  '/__get_plot_data__.m': 'SAME',
  '/home/web_user/__get_plot_data__.m': 'SAME',
};

await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
await sleep(1200);
const isPage = await page.evaluate(() => !!(window.Module && window.Module.eval_string));
console.log(`URL=${URL} pageMode=${isPage}`);

if (!isPage) {
  const boot = await page.evaluate(async () => {
    try {
      const meta = document.querySelector('meta[name="site-base"]');
      const gb = (meta && meta.getAttribute('content')) || '/';
      const base = (gb.endsWith('/') ? gb : gb + '/') + 'lanes/wasm32-final/';
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = base + 'octave.js';
        s.onload = () => res(); s.onerror = () => rej(new Error('load fail'));
        document.head.appendChild(s);
      });
      window.__probeEmbed = await window.OctaveEmbed.create({
        base, mount: '#octave-raw-output', id: 'fixdesign',
        lane: { lane: 'base', dir: '', js: 'octave.js', wasm: 'octave.wasm', data: 'octave.data' },
      });
      return 'ok';
    } catch (e) { return 'ERR ' + String(e).slice(0, 220); }
  });
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

async function run (code, timeoutMs = 20000) {
  const s = '__D' + Math.random().toString(36).slice(2) + '__';
  logs.length = 0;
  try {
    await page.evaluate(([x, sn]) => window.__M.eval_string(`${x}; disp('${sn}');`), [code, s]);
  } catch (e) { return { trap: true, out: '', err: String(e).slice(0, 180) }; }
  const t = Date.now();
  while (Date.now() - t < timeoutMs) { if (logs.some(l => l.includes(s))) break; await sleep(80); }
  return { trap: false, out: logs.join(' ').split(s)[0].replace(/\s+/g, ' ').trim() };
}
const head = (o, n = 230) => (o || '').slice(0, n);

// ── 写允许的那部分（drawnow/helper）；figure/plot 不动（模拟被拒）──
const wrote = await page.evaluate((stubs) => {
  const out = {};
  const dw = stubs['/drawnow.m'];
  const hp = stubs['/__get_plot_data__.m'];
  for (const [p, c] of Object.entries(stubs)) {
    const content = c === 'SAME' ? (p.includes('drawnow') ? dw : hp) : c;
    try {
      const dir = p.replace(/\/[^/]*$/, '') || '/';
      try { window.__M.FS.mkdirTree(dir); } catch (e) {}
      window.__M.FS.writeFile(p, content);
      out[p] = 'ok';
    } catch (e) { out[p] = 'ERR'; }
  }
  return Object.keys(out).length;
}, ALLOWED);
console.log('写允许 stub 数:', wrote);

console.log('\n── 环境 ─────────────────────────');
let r = await run('printf("wf=[%s] wp=[%s] wd=[%s]\\n", which("figure"), which("plot"), which("drawnow"))');
console.log(head(r.out, 260));

console.log('\n── issue #5 矩阵（figure/plot 未 stub）──────');
const MATRIX = [
  ['plot(0:1:10)', 'plot', ''],
  ['clf; plot(1:10); title("t"); printf("T=[%s]", get(get(gca(),"title"),"string"))', 'title', 'T=[t]'],
  ['h = figure(); printf("FIG=%d", ishghandle(h))', 'figure()', 'FIG=1'],
  ['h = gcf(); printf("GCF=%d", ishghandle(h))', 'gcf()', 'GCF=1'],
  ['clf; plot(1:10); xlabel("x"); printf("X=[%s]", get(get(gca(),"xlabel"),"string"))', 'xlabel', 'X=[x]'],
  ['clf; plot(1:10); grid on; printf("G=[%s]", get(gca(),"xgrid"))', 'grid', 'G=[on]'],
  ['clf; plot(1:10); legend("a"); printf("LEG-OK")', 'legend(plot后)', 'LEG-OK'],
  ['clf; plot(1:10); axis([0 11 0 11]); xl=get(gca(),"xlim"); printf("XL=[%g %g]", xl(1), xl(2))', 'axis', 'XL=[0 11]'],
  ['clf; plot(1:10); hold on; plot(2:11); printf("HOLD-OK")', 'hold', 'HOLD-OK'],
  ['subplot(2,1,1); plot(1:10); printf("SUB-OK %d", numel(get(gcf(),"children")))', 'subplot', 'SUB-OK'],
  ['clf; bar([1 2 3]); printf("BAR-OK")', 'bar', 'BAR-OK'],
  ['clf; loglog(1:10, 1:10); printf("LOGLOG-OK")', 'loglog', 'LOGLOG-OK'],
  ['clf; plot(1:10); drawnow; printf("DN-OK")', 'drawnow', 'DN-OK'],
];
let pass = 0, fail = 0;
for (const [code, name, want] of MATRIX) {
  const rr = await run(`clear -f; try; ${code}; printf("|%s", ' OK'); catch e; printf("|ERR: %s", e.message); end`);
  const out = rr.trap ? '★TRAP' : (rr.out || '(空)');
  const ok = !rr.trap && out.includes('| OK') && !out.includes('ERR');
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'fail'} | ${name.padEnd(13)} :: ${head(out, 200)}`);
  await run('close all');
}
console.log(`\n矩阵：${pass} PASS / ${fail} FAIL`);

console.log('\n── 显式输出与计数 ──────────────────');
r = await run('clear -f; h1=figure(1); h2=figure(2); printf("h1=%g h2=%g cur=%g\\n", h1, h2, gcf())');
console.log(head(r.out, 200));
r = await run('clear -f; [az, hh] = contour(peaks(20)); printf("CONTOUR-OK %d %d\\n", numel(az), numel(hh))');
console.log(head(r.out, 200));

console.log('\n=== 探针结束 ===');
await browser.close();
