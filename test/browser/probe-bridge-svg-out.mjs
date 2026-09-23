// 把桥自己渲染的 surf 抠出来看：走 web toolkit（桥是显示路径）+ print -dsvg（__svg_render__）
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const URL = process.argv[2] || 'http://127.0.0.1:8763/';
const OUT = process.argv[3] || '/mnt/hdd/octave-wasm-build/out-surf-bridge.svg';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-proxy-server','--no-sandbox','--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
await page.goto(URL,{waitUntil:'load',timeout:300000});
const t0=Date.now();
while(Date.now()-t0<300000){const ok=await page.evaluate(()=>{try{return !!window.Module?.feval?.('strcat',['a','b'],1);}catch{return false;}}).catch(()=>false); if(ok)break; await new Promise(r=>setTimeout(r,800));}
while(!(await page.evaluate(()=>!!window.__octaveReady).catch(()=>false))) await new Promise(r=>setTimeout(r,500));
const res = await page.evaluate(() => {
  const M = window.Module;
  M.eval_string("graphics_toolkit('web');");
  M.eval_string('figure(1); clf; surf(peaks(40)); drawnow();');
  const t = performance.now();
  M.eval_string('print -dsvg /tmp/bridge_surf.svg;');
  const ms = performance.now() - t;
  let svg = null;
  try { svg = new TextDecoder().decode(M.FS.readFile('/tmp/bridge_surf.svg')); } catch (e) { svg = 'READERR ' + e; }
  const nseries = M.eval_string ? null : null;
  return { ms, len: svg ? svg.length : 0, head: svg ? svg.slice(0, 120) : '', series: (function(){ try { M.eval_string('__pb_n__=numel(__pstate__().series);'); } catch(e){} return null; })() };
});
console.log('  print -dsvg 耗时 :', res.ms.toFixed(0), 'ms');
console.log('  svg 字节         :', res.len);
console.log('  svg 头           :', res.head.replace(/\n/g,' ').slice(0,100));
if (res.len > 200) { fs.writeFileSync(OUT, res.head.endsWith('') ? '' : ''); }
// 完整取回并落盘
const full = await page.evaluate(() => { try { return new TextDecoder().decode(window.Module.FS.readFile('/tmp/bridge_surf.svg')); } catch(e){ return null; } });
if (full) { fs.writeFileSync(OUT, full); console.log('  已落盘           :', OUT, full.length, '字节'); }
await browser.close();
