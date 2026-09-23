// 拆解"端到端 surf+drawnow 要 2 秒"到底花在哪 —— 渲染器只占一小部分
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

const client = await ctx.newCDPSession(page);

async function ev(expr) {
  logs.length = 0;
  await page.evaluate(x => { window.Module.eval_string(x); }, expr);
  await new Promise(r => setTimeout(r, 200));
  return logs.join(' ').replace(/\s+/g, ' ').trim();
}
const num = (s) => { const m = String(s).match(/(\d+)\s*$/); return m ? Number(m[1]) : NaN; };

const STEPS = [
  ['peaks(40) 只算数据',        't=tic; for k=1:3; z=peaks(40); endfor; disp(round(toc(t)/3*1000))'],
  ['figure+clf',                't=tic; for k=1:3; figure(20); clf; endfor; disp(round(toc(t)/3*1000))'],
  ['figure+clf+surf',           't=tic; for k=1:3; figure(21); clf; surf(peaks(40)); endfor; disp(round(toc(t)/3*1000))'],
  ['figure+clf+surf+drawnow',   't=tic; for k=1:3; figure(22); clf; surf(peaks(40)); drawnow; endfor; disp(round(toc(t)/3*1000))'],
  ['纯 drawnow（已画好，重复）', 'figure(23); clf; surf(peaks(40)); drawnow; t=tic; for k=1:3; drawnow; endfor; disp(round(toc(t)/3*1000))'],
  ['纯 getframe（强制渲染）',    't=tic; for k=1:3; p=getframe(23); endfor; disp(round(toc(t)/3*1000))'],
];

for (const th of [1, 4]) {
  await client.send('Emulation.setCPUThrottlingRate', { rate: th });
  await ev(`graphics_toolkit('${TK}'); disp('tk')`);
  console.log(`\n=== ${URL} 后端=${TK}  CPU×${th} ===`);
  let prev = 0;
  for (const [label, expr] of STEPS) {
    const v = num(await ev(expr));
    const delta = (label.startsWith('figure+clf+surf')) ? `  (增量 ${v - prev} ms)` : '';
    if (label === 'figure+clf+surf') prev = v;
    console.log(`  ${label.padEnd(26)} ${String(v).padStart(6)} ms${delta}`);
  }
}
await browser.close();
