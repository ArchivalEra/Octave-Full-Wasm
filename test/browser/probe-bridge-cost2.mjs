import { chromium } from 'playwright-core';
const URL = process.argv[2] || 'http://127.0.0.1:8768/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server','--no-sandbox','--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs=[]; page.on('console', m=>logs.push(m.text()));
await page.goto(URL,{waitUntil:'load',timeout:300000});
const t0=Date.now();
while(Date.now()-t0<300000){const ok=await page.evaluate(()=>{try{return !!window.Module?.feval?.('strcat',['a','b'],1);}catch{return false;}}).catch(()=>false); if(ok)break; await new Promise(r=>setTimeout(r,800));}
while(!(await page.evaluate(()=>!!window.__octaveReady).catch(()=>false))) await new Promise(r=>setTimeout(r,500));
async function ev(e){logs.length=0; await page.evaluate(x=>{window.Module.eval_string(x);},e); await new Promise(r=>setTimeout(r,200)); return logs.join(' ').replace(/\s+/g,' ').trim();}
const num=s=>{const m=String(s).match(/(\d+)\s*$/); return m?Number(m[1]):NaN;};
const STEPS=[
 ['1 建好 1521 条 series（不含 emit）',
  'z=peaks(40); s=__pstate__(); s=__pb_clear_series__(s); t=tic; s=__pb_surface__(s,[],[],z,"surf",""); disp(round(toc(t)*1000))'],
 ['2 只 emit 一次（1521 条）',
  't=tic; __pstate__(s); disp(round(toc(t)*1000))'],
 ['3 再 emit 一次（对照，看是否与条数成正比）',
  't=tic; __pstate__(s); disp(round(toc(t)*1000))'],
 ['4 emit 时 series 数',
  'disp(numel(__pstate__().series))'],
 ['5 清空后再 emit（0 条，基线）',
  's2=__pstate__(); s2=__pb_clear_series__(s2); t=tic; __pstate__(s2); disp(round(toc(t)*1000))'],
];
for(const [l,e] of STEPS) console.log(`  ${l.padEnd(40)} ${String(num(await ev(e))).padStart(7)} ms`);
await browser.close();
