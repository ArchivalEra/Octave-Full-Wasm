// plot 桥成本拆解（2026-09-23）：冷启动 vs 温 + 单价表 —— 旧"path 手术"桥 vs 新"句柄缓存"桥
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 背景：HANDOFF §5.20 把桥 `figure; clf; surf(peaks(40))` 剩下的 ~480 ms 归因成
// "镜像的两次 path() 手术"。2026-09-23 把那套手术换成**一次性句柄缓存**（`__pb_core__.m`）
// 之后端到端只从 517 → 431 ms —— 说明那个归因是错的：端到端那个数被**冷启动**盖住了。
// 所以本探针把①冷启动（第一次画图：建上下文/编 shader/首帧这些一次性成本）与
// ②温（桥每张图的开销）**分开量**，另加③单价表（path()、镜像一次、核心句柄直调一次、
// `__pb_add__`、`__pb_surface__`、emit）。
//
// ⚠️ 两个写探针踩过的坑（都得到过假数，别再踩）：
//   ① 别"取日志里最后一个整数" —— 会抓到别的输出（第一版三个数一模一样地假）；
//      每个数都用带标记的行输出（`PBCOST <标签> <数>`）再解析。
//   ② 测量表达式的传参别串位（第二版把"要打印的表达式"和"计时表达式"搞混了，
//      所有数都成了 1）——所以这里统一约定：**code 把要报的数存进变量 V**。
//
// 用法：harness/run.sh test/browser/probe-bridge-mirror-cost.mjs [URL] [tk]
import { chromium } from 'playwright-core';
const URL = process.argv[2] || 'http://127.0.0.1:8768/';
const TK = process.argv[3] || 'webgl';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server','--no-sandbox','--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs=[]; page.on('console', m=>logs.push(m.text()));
await page.goto(URL,{waitUntil:'load',timeout:300000});
const t0=Date.now();
while(Date.now()-t0<300000){const ok=await page.evaluate(()=>{try{return !!window.Module?.feval?.('strcat',['a','b'],1);}catch{return false;}}).catch(()=>false); if(ok)break; await new Promise(r=>setTimeout(r,800));}
while(!(await page.evaluate(()=>!!window.__octaveReady).catch(()=>false))) await new Promise(r=>setTimeout(r,500));
async function ev(e,w=250){logs.length=0; await page.evaluate(x=>{window.Module.eval_string(x);},e); await new Promise(r=>setTimeout(r,w)); return logs.join('\n');}

let seq = 0;
// code 必须把要报告的数存进变量 V
async function meas(code, wait = 250) {
  const tag = 'M' + (++seq);
  const out = await ev(`${code}; disp(sprintf("PBCOST ${tag} %d", round(V)))`, wait);
  const m = out.match(new RegExp('PBCOST\\s+' + tag + '\\s+(-?\\d+)'));
  return { v: m ? Number(m[1]) : NaN, out };
}
const row = (l, r, u, extra = '') =>
  console.log(`  ${l.padEnd(44)} ${String(r.v).padStart(8)} ${u}${extra}`);
const loop = (n, e) => `N=${n}; t=tic; for k=1:N; ${e}; endfor; V=toc(t)*1e6/N`;   // µs/次
const loopms = (n, e) => `N=${n}; t=tic; for k=1:N; ${e}; endfor; V=toc(t)*1000/N`; // ms/次
const once = e => `t=tic; ${e}; V=toc(t)*1000`;                                     // ms

console.log(`URL=${URL} tk=${TK}`);
await ev(`graphics_toolkit("${TK}")`, 300);

console.log('\n-- 一、冷启动（页面刚起来，这里是第一次画图）--');
row('① 第一次 figure()', await meas(once('figure(60)')), 'ms');
row('② 第一次 clf（含镜像）', await meas(once('clf')), 'ms');
row('③ 第一次 surf(peaks(40))（含镜像）', await meas(once('surf(peaks(40))')), 'ms');
row('④ 第一次 drawnow（首帧：上下文+shader+PNG）', await meas(once('drawnow'), 1500), 'ms');

console.log('\n-- 二、温：同一条命令再来三次（figure; clf; surf; drawnow）--');
for (let k = 0; k < 3; k++) {
  const r = await meas(once(`figure(62+${k}); clf; surf(peaks(40)); drawnow`), 900);
  const n = (await ev('disp(numel(findall(gcf, "type", "surface")))', 300)).trim().split('\n').pop();
  row(`第 ${k + 1} 次`, r, 'ms', `   [gcf 上真 surface 对象 ${n}]`);
}

console.log('\n-- 三、单价表（温，N 次平均）--');
row('path() 单次（旧方案每次镜像 2 次）', await meas(loop(20, 'p=path(); path(p)')), 'µs');
row('__pb_in_core__() 单次（每个 shim 开头那句）', await meas(loop(200, '__pb_in_core__()')), 'µs');
row('镜像一次 __pb_mirror__("clf")', await meas(loop(20, '__pb_mirror__("clf")')), 'µs');
row('__pb_core__("clf") 直调（对照）', await meas(loop(20, '__pb_core__("clf")')), 'µs');
row('__pb_add__ 一条（含 save -ascii 小文件）', await meas(
  's=__pstate__(); s=__pb_clear_series__(s); N=100; t=tic; ' +
  'for k=1:N; s=__pb_add__(s,[1;2;3;4;5],[2;3;4;5;6],"","lines"); endfor; V=toc(t)*1e6/N', 400), 'µs');
row('__pb_surface__ 建 39 条 series', await meas(
  'z=peaks(40); s=__pstate__(); s=__pb_clear_series__(s); ' + once('s=__pb_surface__(s,[],[],z,"surf","")')), 'ms');
row('__pstate__ emit 一次（39 条）', await meas(
  'z=peaks(40); s=__pstate__(); s=__pb_clear_series__(s); s=__pb_surface__(s,[],[],z,"surf",""); ' + once('__pstate__(s)')), 'ms');
row('__pb_core__("surf", peaks(40)) 直调', await meas(loopms(3, '__pb_core__("surf", peaks(40))')), 'ms');
row('核心 surface(peaks(40)) 直调（对照）', await meas(loopms(3, 'surface(peaks(40))')), 'ms');

await browser.close();
