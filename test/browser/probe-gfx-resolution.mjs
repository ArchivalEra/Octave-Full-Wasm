// 手机相关的关键轴：**分辨率**。
// OSMesa 是逐像素 CPU 光栅化 ⇒ 耗时随像素数线性涨；GPU 那条几乎不涨。
// 这个差异**与具体设备无关**（手机 GPU 比 4060 弱，但仍是并行的），
// 比"跑一个 Android 模拟器"更能回答"手机上会不会卡"。
//
// 用法：run.sh probe-gfx-resolution.mjs [URL] [toolkit]
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8768/';
const TK  = process.argv[3] || 'webgl';

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage',
         '--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const logs = [];
page.on('console', m => logs.push(m.text()));
await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
const t0 = Date.now();
while (Date.now() - t0 < 300000) {
  const ok = await page.evaluate(() => { try { return !!window.Module?.feval?.('strcat', ['a','b'], 1); } catch { return false; } }).catch(() => false);
  if (ok) break; await new Promise(r => setTimeout(r, 800));
}
while (!(await page.evaluate(() => !!window.__octaveReady).catch(() => false))) await new Promise(r => setTimeout(r, 500));

async function ev(expr) {
  logs.length = 0;
  await page.evaluate(x => { window.Module.eval_string(x); }, expr);
  await new Promise(r => setTimeout(r, 150));
  return logs.join(' ').replace(/\s+/g, ' ').trim();
}
const num = s => { const m = String(s).match(/(\d+)\s*$/); return m ? Number(m[1]) : NaN; };

await ev(`graphics_toolkit('${TK}');`);

// 560×420 ≈ 桌面默认；×2 = 手机高 DPR；×3 再翻一档
const SIZES = [[560, 420], [1120, 840], [1680, 1260], [2240, 1680]];
console.log(`后端=${TK}（真 GPU / CPU 不降频）—— 同一张 3D 图，只改图窗像素尺寸`);
console.log('   尺寸            像素数      渲染 ms      每百万像素 ms');
for (const [w, h] of SIZES) {
  await ev(`figure(5); clf; set(5,'position',[0 0 ${w} ${h}]); surface(peaks(40)); drawnow(); "ok"`);
  const ms = num(await ev('t=tic; for k=1:5; p=getframe(5); endfor; disp(round(toc(t)/5*1000))'));
  const px = w * h;
  console.log(`   ${String(w + 'x' + h).padEnd(12)} ${String(px).padStart(9)}   ${String(ms).padStart(9)}   ${(ms / (px / 1e6)).toFixed(1)}`);
}
await browser.close();
