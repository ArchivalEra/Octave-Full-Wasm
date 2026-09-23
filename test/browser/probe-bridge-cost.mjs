// 拆解 plot 桥里 surf(peaks(40)) 那 ~1.9 秒：写文件？投影？建 cell？还是别处？
import { chromium } from 'playwright-core';
const URL = process.argv[2] || 'http://127.0.0.1:8768/';
const TK  = process.argv[3] || '';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server','--no-sandbox','--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = []; page.on('console', m => logs.push(m.text()));
await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
const t0 = Date.now();
while (Date.now()-t0 < 300000) { const ok = await page.evaluate(() => { try { return !!window.Module?.feval?.('strcat',['a','b'],1); } catch { return false; } }).catch(()=>false); if (ok) break; await new Promise(r=>setTimeout(r,800)); }
while (!(await page.evaluate(() => !!window.__octaveReady).catch(()=>false))) await new Promise(r=>setTimeout(r,500));
async function ev(expr){ logs.length=0; await page.evaluate(x=>{window.Module.eval_string(x);},expr); await new Promise(r=>setTimeout(r,150)); return logs.join(' ').replace(/\s+/g,' ').trim(); }
const num = s => { const m=String(s).match(/(\d+(?:\.\d+)?)\s*$/); return m?Number(m[1]):NaN; };
if (TK) await ev(`graphics_toolkit('${TK}');`);

// 1521 这个数来自 (40-1)*(40-1)：surf 每个网格单元一个多边形
const STEPS = [
  ['A 只写 1521 个小 .dat（save -ascii）',
   'z=peaks(40); t=tic; for k=1:1521; D=[1 2;3 4]; save("-ascii", sprintf("/tmp/bt%d.dat",k), "D"); endfor; disp(round(toc(t)*1000))'],
  ['B 只写 1521 次但内容同规模(5x2)',
   'z=peaks(40); t=tic; for k=1:1521; D=[1 2;3 4;5 6;7 8;9 10]; save("-ascii", sprintf("/tmp/bu%d.dat",k), "D"); endfor; disp(round(toc(t)*1000))'],
  ['C 写 1 个文件（1521 行，对照 A）',
   'z=peaks(40); D=repmat([1 2],1521,1); t=tic; save("-ascii","/tmp/bone.dat","D"); disp(round(toc(t)*1000))'],
  ['D 投影 __pb_project3__（40x40）',
   'z=peaks(40); [Xg,Yg]=meshgrid(1:40,1:40); t=tic; [px,py]=__pb_project3__(Xg,Yg,z,[],[]); disp(round(toc(t)*1000))'],
  ['E 建 1521 个 cell 的循环',
   't=tic; p=cell(1,1521); for k=1:1521; p{k}=[1 2;3 4;5 6;7 8;9 10]; endfor; disp(round(toc(t)*1000))'],
  ['F 桥的 surf(peaks(40))（总计）',
   't=tic; figure(60); clf; surf(peaks(40)); disp(round(toc(t)*1000))'],
  ['G 核心 surface(peaks(40))（对照，不过桥）',
   't=tic; figure(61); clf; surface(peaks(40)); disp(round(toc(t)*1000))'],
  ['H 纯 __pb_add__ 一条（看单条固定开销）',
   's=__pstate__(); t=tic; for k=1:1521; s=__pb_add__(s,[1;2;3;4;5],[2;3;4;5;6],"","lines"); endfor; disp(round(toc(t)*1000))'],
];
console.log(`URL=${URL} tk=${TK || '(default)'}`);
for (const [l,e] of STEPS) console.log(`  ${l.padEnd(38)} ${String(num(await ev(e))).padStart(7)} ms`);
await browser.close();
