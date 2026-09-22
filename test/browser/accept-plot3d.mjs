// 批次 7b 验收：plot 桥 v2 3D（plot3/scatter3/mesh/surf/contour）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/accept-plot3d.mjs [URL]
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text().slice(0, 300)));
page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 300)));
await page.goto(URL, { waitUntil: 'load', timeout: 240000 });
const t = Date.now();
while (Date.now() - t < 300000) {
  const ok = await page.evaluate(() => { try { return !!window.Module?.feval?.('strcat', ['a', 'b'], 1); } catch { return false; } }).catch(() => false);
  if (ok) break; await new Promise(r => setTimeout(r, 800));
}
// ⚠️ 等站点自己置的 ready 标志（`plotbridge` 是页面启动装载清单里的资产）。
//    不等的话头几条 plot3 会假失败（plotbridge 还没挂上），并连带后面的
//    svg 解析返回 undefined —— 实测就是这样。与 accept-print/accept-plotv2 同源。
await page.evaluate(async () => {
  for (let i = 0; i < 300; i++) {
    if (window.__octaveReady === true) return;
    await new Promise(r => setTimeout(r, 200));
  }
}).catch(() => {});
await new Promise(r => setTimeout(r, 500));
console.log(`URL=${URL} ready=${((Date.now() - t) / 1000).toFixed(1)}s`);

let pass = 0, fail = 0;
async function ev(expr, label) {
  logs.length = 0;
  let r;
  try {
    r = await page.evaluate(x => { const rc = window.Module.eval_string(x); return { rc, err: window.Module.last_error_message() }; }, expr);
  } catch (e) { console.log(`CRASH | ${label} :: ${String(e).slice(0, 130)}`); fail++; return; }
  await new Promise(rr => setTimeout(rr, 600));
  const out = [...logs].join(' ').replace(/\s+/g, ' ').trim().slice(0, 190);
  const ok = r.rc === 0;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${out || ('rc=' + r.rc + ' ' + r.err.slice(0, 150))}`);
}
async function svg(path, label, checks = {}) {
  const r = await page.evaluate((p) => {
    try {
      const txt = new TextDecoder().decode(window.Module.FS.readFile(p));
      const doc = new DOMParser().parseFromString(txt, 'image/svg+xml');
      const err = doc.querySelector('parsererror');
      const q = (s) => doc.querySelectorAll(s).length;
      return { ok: true, len: txt.length, parseErr: err ? err.textContent.slice(0, 80) : null,
        poly: q('polyline'), polyg: q('polygon'), circ: q('circle'), line: q('line'),
        rect: q('rect'), text: q('text'), g: q('g'), svg: q('svg') };
    } catch (e) { return { ok: false, err: String(e).slice(0, 140) }; }
  }, path);
  let ok = r.ok && !r.parseErr && r.len > 250 && r.svg === 1;
  // ⚠️ r.ok===false 时上面 try 的返回值只有 {ok,err} —— 直接拼 `len=${r.len}` 会打出
  //    一屏 undefined，真因（读取/解析失败的原话）反而看不清。第一版就是这样。
  const notes = r.ok
    ? [`len=${r.len}`, `poly=${r.poly}`, `polyg=${r.polyg}`, `circ=${r.circ}`, `line=${r.line}`]
    : [`读取/解析失败: ${r.err || '?'}`];
  for (const [k, v] of Object.entries(checks)) {
    if (!r.ok) break;                       // 读不出来就别再逐项比了，notes 里已有真因
    const good = r[k] >= v;
    ok = ok && good;
    if (!good) notes.push(`!!${k}=${r[k]}<${v}`);
  }
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${notes.join(' ')} ${r.ok ? '' : r.err || ''}`);
  return r;
}
const reset = 'clear global __pb__; clf;';

console.log('--- plot3 曲线 ---');
await ev(`${reset} t=linspace(0,6*pi,200)'; plot3(sin(t),cos(t),t); print('/tmp/pd_p3.svg','-dsvg')`, 'plot3 螺旋线');
await svg('/tmp/pd_p3.svg', '★ plot3 → 投影成 2D 折线（200 点）', { poly: 1, line: 4 });
await ev(`${reset} plot3(1:5, 1:5, (1:5).^2, 'ro-'); print('/tmp/pd_p3s.svg','-dsvg')`, 'plot3 带 spec');
await svg('/tmp/pd_p3s.svg', 'plot3 带 marker', { poly: 1, circ: 5 });
await ev(`${reset} t=(0:0.2:2*pi)'; plot3(cos(t), sin(t), t, 'g'); print('/tmp/pd_p3g.svg','-dsvg')`, 'plot3 单色');
await svg('/tmp/pd_p3g.svg', 'plot3 单色线', { poly: 1 });
await ev(`${reset} plot3(1:10); print('/tmp/pd_p3y.svg','-dsvg')`, 'plot3 单参数');
await svg('/tmp/pd_p3y.svg', 'plot3(Y) 单参数形式', { poly: 1 });

console.log('--- scatter3 ---');
await ev(`${reset} x=randn(50,1); y=randn(50,1); z=randn(50,1); scatter3(x,y,z); print('/tmp/pd_s3.svg','-dsvg')`, 'scatter3');
await svg('/tmp/pd_s3.svg', '★ scatter3 → 50 个投影点', { circ: 50 });
await ev(`${reset} scatter3(1:10, 1:10, (1:10).^2, 20, 'filled'); print('/tmp/pd_s3b.svg','-dsvg')`, 'scatter3 带尺寸/颜色参数');
await svg('/tmp/pd_s3b.svg', 'scatter3 5 参数形式', { circ: 10 });

console.log('--- mesh ---');
await ev(`${reset} [X,Y]=meshgrid(-2:0.4:2); Z=X.*exp(-X.^2-Y.^2); mesh(X,Y,Z); print('/tmp/pd_m.svg','-dsvg')`, 'mesh 11x11 网格');
await svg('/tmp/pd_m.svg', '★ mesh → 100 格线框', { poly: 100 });
await ev(`${reset} [X,Y]=meshgrid(-1:0.5:1); mesh(X,Y,X.*Y); print('/tmp/pd_m2.svg','-dsvg')`, 'mesh 5x5');
await svg('/tmp/pd_m2.svg', 'mesh 5x5 → 16 格', { poly: 16 });
await ev(`${reset} mesh(peaks(15)); print('/tmp/pd_mp.svg','-dsvg')`, 'mesh(peaks)');
await svg('/tmp/pd_mp.svg', 'mesh(peaks(15)) 单参数', { poly: 100 });

console.log('--- surf ---');
await ev(`${reset} [X,Y]=meshgrid(-2:0.5:2); Z=X.*exp(-X.^2-Y.^2); surf(X,Y,Z); print('/tmp/pd_s.svg','-dsvg')`, 'surf 9x9');
await svg('/tmp/pd_s.svg', '★ surf → 64 个填充面片', { polyg: 64 });
await ev(`${reset} surf(peaks(20)); print('/tmp/pd_sp.svg','-dsvg')`, 'surf(peaks)');
await svg('/tmp/pd_sp.svg', 'surf(peaks(20)) → 361 面片', { polyg: 300 });

console.log('--- contour ---');
await ev(`${reset} [X,Y]=meshgrid(-2:0.2:2); Z=X.*exp(-X.^2-Y.^2); contour(X,Y,Z); print('/tmp/pd_c.svg','-dsvg')`, 'contour 默认 8 层');
await svg('/tmp/pd_c.svg', '★ contour → 等值线段（多层）', { poly: 20 });
await ev(`${reset} [X,Y]=meshgrid(-1:0.5:1); contour(X,Y,X.^2-Y.^2, 4); print('/tmp/pd_c4.svg','-dsvg')`, 'contour(Z,4) 指定层数');
await svg('/tmp/pd_c4.svg', 'contour(X,Y,Z,N) 产出', { poly: 3 });
await ev(`${reset} contour(peaks(20), [0.5 1 1.5]); print('/tmp/pd_cv.svg','-dsvg')`, 'contour(Z,V) 指定水平');
await svg('/tmp/pd_cv.svg', 'contour(Z,V) 三层', { poly: 3 });

console.log('--- 与 2D / subplot 共存 ---');
await ev(`${reset} subplot(2,1,1); plot3(1:10,1:10,1:10); subplot(2,1,2); plot(1:10); print('/tmp/pd_sub.svg','-dsvg')`, 'subplot 混 2D/3D');
await svg('/tmp/pd_sub.svg', '★ subplot 里 2D 与 3D 共存', { poly: 2 });
await ev(`${reset} t=(0:0.1:2*pi)'; plot3(cos(t),sin(t),t); hold on; plot3(cos(t).*2,sin(t).*2,t); hold off; print('/tmp/pd_h.svg','-dsvg')`, '两条 3D 曲线叠加');
await svg('/tmp/pd_h.svg', 'hold 下两条 3D 曲线', { poly: 2 });
await ev(`${reset} plot3(1:10, 1:10, (1:10).^2); title('三维螺旋'); print('/tmp/pd_t.svg','-dsvg')`, '3D + 中文标题');
await svg('/tmp/pd_t.svg', '3D 图也能带中文标题', { poly: 1, text: 8 });

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
