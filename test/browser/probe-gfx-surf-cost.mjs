// surf(peaks(40)) 那 1.9 秒到底是谁花的：核心 surf 建对象 vs plot 桥的额外工作
import { chromium } from 'playwright-core';
const URL = process.argv[2] || 'http://127.0.0.1:8768/';
const TK  = process.argv[3] || 'webgl';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server','--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=gl'] });
const ctx = await browser.newContext(); const page = await ctx.newPage();
const logs = []; page.on('console', m => logs.push(m.text()));
await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
const t0 = Date.now();
while (Date.now()-t0 < 300000) { const ok = await page.evaluate(() => { try { return !!window.Module?.feval?.('strcat',['a','b'],1); } catch { return false; } }).catch(()=>false); if (ok) break; await new Promise(r=>setTimeout(r,800)); }
while (!(await page.evaluate(() => !!window.__octaveReady).catch(()=>false))) await new Promise(r=>setTimeout(r,500));
const client = await ctx.newCDPSession(page);
async function ev(expr){ logs.length=0; await page.evaluate(x=>{window.Module.eval_string(x);},expr); await new Promise(r=>setTimeout(r,200)); return logs.join(' ').replace(/\s+/g,' ').trim(); }
const num = s => { const m = String(s).match(/(\d+)\s*$/); return m?Number(m[1]):NaN; };
const STEPS = [
  ['surface(peaks(40))  核心，不过桥', 't=tic; for k=1:3; figure(30); clf; surface(peaks(40)); endfor; disp(round(toc(t)/3*1000))'],
  ['surf(peaks(40))     走桥+镜像',    't=tic; for k=1:3; figure(31); clf; surf(peaks(40)); endfor; disp(round(toc(t)/3*1000))'],
  ['mesh(peaks(40))     走桥+镜像',    't=tic; for k=1:3; figure(32); clf; mesh(peaks(40)); endfor; disp(round(toc(t)/3*1000))'],
  ['plot(1:100)         走桥+镜像',    't=tic; for k=1:3; figure(33); clf; plot(1:100); endfor; disp(round(toc(t)/3*1000))'],
  ['line(1:100)         核心，不过桥', 't=tic; for k=1:3; figure(34); clf; line(1:100, 1:100); endfor; disp(round(toc(t)/3*1000))'],
];
await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
await ev(`graphics_toolkit('${TK}');`);
console.log(`后端=${TK}（CPU×1）—— 每项 = 3 次平均毫秒，已含 figure+clf`);
for (const [l,e] of STEPS) console.log(`  ${l.padEnd(34)} ${String(num(await ev(e))).padStart(6)} ms`);
await browser.close();
