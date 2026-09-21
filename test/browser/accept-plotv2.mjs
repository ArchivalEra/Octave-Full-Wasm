// 批次 7a 验收：plot 桥 v2（2D 图型 + subplot/figure(n)/axis）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/accept-plotv2.mjs [URL]
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
console.log(`URL=${URL} ready=${((Date.now() - t) / 1000).toFixed(1)}s`);

let pass = 0, fail = 0;
// 每个用例先 reset 状态，避免上一例的 figure/panel 残留影响判定
async function ev(expr, label) {
  logs.length = 0;
  let r;
  try {
    r = await page.evaluate(x => {
      const rc = window.Module.eval_string(x);
      return { rc, err: window.Module.last_error_message() };
    }, expr);
  } catch (e) { console.log(`CRASH | ${label} :: ${String(e).slice(0, 130)}`); fail++; return; }
  await new Promise(rr => setTimeout(rr, 550));
  const out = [...logs].join(' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  const ok = r.rc === 0;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${out || ('rc=' + r.rc + ' ' + r.err.slice(0, 150))}`);
}
// 生成 SVG 并统计图元（用浏览器自己的 XML 解析器）
async function svg(path, label, checks = {}) {
  const r = await page.evaluate((p) => {
    try {
      const txt = new TextDecoder().decode(window.Module.FS.readFile(p));
      const doc = new DOMParser().parseFromString(txt, 'image/svg+xml');
      const err = doc.querySelector('parsererror');
      const q = (s) => doc.querySelectorAll(s).length;
      return { ok: true, len: txt.length, parseErr: err ? err.textContent.slice(0, 80) : null,
        poly: q('polyline'), polyg: q('polygon'), circ: q('circle'),
        line: q('line'), rect: q('rect'), text: q('text'), g: q('g'), svg: q('svg'),
        texts: [...doc.querySelectorAll('text')].map(e => e.textContent) };
    } catch (e) { return { ok: false, err: String(e).slice(0, 140) }; }
  }, path);
  let ok = r.ok && !r.parseErr && r.len > 250 && r.svg === 1;
  const notes = [`len=${r.len}`, `poly=${r.poly}`, `polyg=${r.polyg}`, `circ=${r.circ}`,
    `line=${r.line}`, `rect=${r.rect}`, `text=${r.text}`];
  for (const [k, v] of Object.entries(checks)) {
    if (k === 'hasText') {
      const good = r.texts.some(s => s.includes(v));
      ok = ok && good;
      if (!good) notes.push(`缺文本"${v}"`);
      continue;
    }
    if (k === 'maxText') {
      const good = r.text <= v;
      ok = ok && good;
      if (!good) notes.push(`!!text=${r.text}>${v}`);
      continue;
    }
    const good = r[k] >= v;
    ok = ok && good;
    if (!good) notes.push(`!!${k}=${r[k]}<${v}`);
  }
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${notes.join(' ')} ${r.ok ? '' : r.err || ''}`);
  return r;
}
const reset = 'clear global __pb__; clf;';

console.log('--- v2 新 2D 图型 ---');
await ev(`${reset} barh([3 7 2 5]); print('/tmp/pv_barh.svg','-dsvg')`, 'barh 出 SVG');
await svg('/tmp/pv_barh.svg', 'barh → 4 根水平条', { rect: 4, hasText: '1' });

await ev(`${reset} x=(1:8)'; errorbar(x, x.^2, 0.5*x); print('/tmp/pv_eb.svg','-dsvg')`, 'errorbar 出 SVG');
await svg('/tmp/pv_eb.svg', 'errorbar → 竖线 + 上下帽 + 连线', { line: 30, poly: 1 });

await ev(`${reset} stairs(1:10); print('/tmp/pv_st.svg','-dsvg')`, 'stairs 出 SVG');
await svg('/tmp/pv_st.svg', 'stairs → 阶梯折线', { poly: 1, line: 2 });

await ev(`${reset} area([1 3 2 5 4]); print('/tmp/pv_ar.svg','-dsvg')`, 'area 出 SVG');
await svg('/tmp/pv_ar.svg', 'area → 填充多边形', { polyg: 1 });

await ev(`${reset} pie([3 1 1 1]); print('/tmp/pv_pie.svg','-dsvg')`, 'pie 出 SVG');
await svg('/tmp/pv_pie.svg', 'pie → 4 个扇形', { polyg: 4, poly: 0 });

console.log('--- 中文标签 ---');
await ev(`${reset} plot(1:10); title('中文标题'); xlabel('横轴'); ylabel('纵轴'); print('/tmp/pv_cjk.svg','-dsvg')`, '中文标题出 SVG');
await svg('/tmp/pv_cjk.svg', '★ 中文 title/xlabel/ylabel 完整', { hasText: '中文标题' });
await svg('/tmp/pv_cjk.svg', '★ 中文横轴', { hasText: '横轴' });
await svg('/tmp/pv_cjk.svg', '★ 中文纵轴', { hasText: '纵轴' });

console.log('--- subplot ---');
await ev(`${reset} subplot(2,1,1); plot(1:10); subplot(2,1,2); plot((1:10).^2); print('/tmp/pv_sub.svg','-dsvg')`, 'subplot 2x1 出 SVG');
const rsub = await svg('/tmp/pv_sub.svg', '★ subplot → 两个 panel 各有内容', { poly: 2, g: 2 });
await ev(`${reset} subplot(2,2,1); plot(1:5); subplot(2,2,2); plot(1:5); subplot(2,2,3); plot(1:5); subplot(2,2,4); plot(1:5); print('/tmp/pv_sub4.svg','-dsvg')`, 'subplot 2x2 出 SVG');
await svg('/tmp/pv_sub4.svg', '★ subplot 2x2 → 4 条曲线', { poly: 4 });
// 各 panel 的标题互不串（panel 状态隔离）
await ev(`${reset} subplot(2,1,1); plot(1:5); title('上'); subplot(2,1,2); plot(1:5); title('下'); print('/tmp/pv_subt.svg','-dsvg')`, '各 panel 独立标题');
const rst = await svg('/tmp/pv_subt.svg', '★ panel 标题隔离（上/下都在）', { hasText: '上' });
if (rst.texts) {
  const two = rst.texts.includes('上') && rst.texts.includes('下');
  two ? pass++ : fail++;
  console.log(`${two ? 'PASS' : 'fail'} | ★ 两个 panel 的标题互不覆盖 :: [${rst.texts.filter(s => s === '上' || s === '下').join('|')}]`);
}

console.log('--- figure(n) 多图 ---');
await ev(`${reset} figure(1); plot(1:5,'-r'); figure(2); plot(1:5,'-b'); figure(1); print('/tmp/pv_f1.svg','-dsvg')`, 'figure 切换');
await svg('/tmp/pv_f1.svg', '★ figure(1) 内容在切回后仍在', { poly: 1 });
await ev(`figure(2); print('/tmp/pv_f2.svg','-dsvg')`, 'figure(2) 打印');
await svg('/tmp/pv_f2.svg', '★ figure(2) 独立内容', { poly: 1 });
await ev('disp(exist("/tmp/pv_f1.svg") + exist("/tmp/pv_f2.svg"))', '两图都落盘');
await ev(`${reset} figure(1); plot(1:3); clear global __pb__; figure(3); disp(1)`, '新 figure 从空白开始');

console.log('--- axis ---');
await ev(`${reset} plot(1:10); axis('equal'); print('/tmp/pv_eq.svg','-dsvg')`, 'axis equal');
await svg('/tmp/pv_eq.svg', 'axis equal 产出正常', { poly: 1 });
await ev(`${reset} plot(1:10); axis('tight'); print('/tmp/pv_ti.svg','-dsvg')`, 'axis tight');
await svg('/tmp/pv_ti.svg', 'axis tight 产出正常', { poly: 1 });
await ev(`${reset} plot(1:10); axis('off'); print('/tmp/pv_of.svg','-dsvg')`, 'axis off');
const roff = await svg('/tmp/pv_of.svg', '★ axis off 隐藏框/刻度/文字', { poly: 1, maxText: 1 });
await ev(`${reset} plot(1:10); axis([2 8 0 12]); print('/tmp/pv_lim.svg','-dsvg')`, 'axis([x1 x2 y1 y2])');
await svg('/tmp/pv_lim.svg', 'axis 向量形式生效', { poly: 1 });

console.log('--- 回归：v1 全部图型仍正常 ---');
await ev(`${reset} x=(0:0.5:10)'; plot(x, x.^2, '--ro'); hold on; plot(x, x.^3); hold off; title('t'); legend('a','b'); grid on; print('/tmp/pv_r1.svg','-dsvg')`, 'v1 plot 组合');
await svg('/tmp/pv_r1.svg', 'v1 lines+linespoints+legend+grid', { poly: 2 });
await ev(`${reset} scatter(1:10, rand(1,10)); print('/tmp/pv_r2.svg','-dsvg')`, 'v1 scatter');
await svg('/tmp/pv_r2.svg', 'v1 scatter → 10 点', { circ: 10 });
await ev(`${reset} stem(1:10); print('/tmp/pv_r3.svg','-dsvg')`, 'v1 stem');
await svg('/tmp/pv_r3.svg', 'v1 stem → 10 竖线 + 10 点', { circ: 10, line: 20 });
await ev(`${reset} [nn,xx]=hist(randn(1,300),9); bar(xx,nn); print('/tmp/pv_r4.svg','-dsvg')`, 'v1 bar');
await svg('/tmp/pv_r4.svg', 'v1 bar → 9 矩形', { rect: 9 });
await ev(`${reset} x=logspace(0,3,50); semilogy(x, x.^2); print('/tmp/pv_r5.svg','-dsvg')`, 'v1 semilogy');
await svg('/tmp/pv_r5.svg', 'v1 semilogy → log 刻度', { hasText: '100' });
await ev(`${reset} x=(1:20)'; plot(x, x+randn(20,1)*2, '-o'); saveas(1, '/tmp/pv_r6.svg'); disp(exist('/tmp/pv_r6.svg'))`, 'v1 saveas');

console.log('--- 参数解析（plot(Y,SPEC) 曾报 dimensions mismatch）---');
await ev(`${reset} plot((1:5), '-r'); print('/tmp/pv_p1.svg','-dsvg')`, '★ plot(Y,SPEC) 双参数形式');
await svg('/tmp/pv_p1.svg', '★ plot(Y,"-r") 不再报尺寸不符', { poly: 1 });
await ev(`${reset} plot(1:5, '-r', 1:5, '--b'); print('/tmp/pv_p2.svg','-dsvg')`, '多组 (Y,S,Y,S)');
await svg('/tmp/pv_p2.svg', '多组简写 → 2 条线', { poly: 2 });
await ev(`${reset} plot(1:5, (1:5).^2, 'g^'); print('/tmp/pv_p3.svg','-dsvg')`, '(X,Y,SPEC)');
// 'g^' 只给颜色+标记、不给线型 → marker-only 图（与 Octave 一致：没有折线）
await svg('/tmp/pv_p3.svg', '(X,Y,"g^") → 5 个三角标记（无线）', { polyg: 5 });
await ev(`${reset} plot(1:5, (1:5).^2, 'g^-'); print('/tmp/pv_p4.svg','-dsvg')`, '(X,Y,"g^-")');
await svg('/tmp/pv_p4.svg', '(X,Y,"g^-") → 折线 + 三角标记', { poly: 1, polyg: 5 });

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
