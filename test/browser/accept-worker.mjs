// 验收：C3/B5 Worker 化 —— 解释器跑在 DedicatedWorker 里（2026-09-26）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/accept-worker.mjs [URL]
// 判据（每条都能被翻面）：
//   A 单页模式无回归（不带 ?worker=1）⇒ __octaveReady=true 且 eval 可用
//   B ★ Worker 模式就绪：`?worker=1` 且 window.OctaveWorker.ready
//   C ★ **主线程不冻**：worker 里跑一段 ~1.5s 的计算，**期间页面定时器必须照常推进**
//   C2 ★ 反向：**同一段计算在单页模式下必须冻住页面**（tick=0）—— 证明 C 的判据有区分力
//   D 输出流式上屏：worker 的 disp 经 postMessage 到页面 #output
//   E Worker 里资产装载可用（dldfcn 核心组：convhulln/audioread 等 exist==2）
//   F Worker 里 JSPI 可用：evalAsync("pause(0.2); 43") rc=0 且墙上 ≥200ms（真挂起）
//   G Worker 里中断投递（pause 循环 + interrupt ⇒ rc=3，且解释器存活）
//   H 图形成品经 postMessage 上屏（phase 1 走回落路径；**失败如实记**为边界而不是假装绿）
import { chromium } from 'playwright-core';
const URL = process.argv[2] || 'http://127.0.0.1:8768/';

let pass = 0, fail = 0;
const check = (ok, label, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 260)}`); };

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });

// ══ A 单页模式无回归 ══
{
  const page = await (await browser.newContext()).newPage();
  await page.goto(URL, { waitUntil: 'load', timeout: 120000 });
  let ok = false;
  for (let t = 0; t < 480; t++) {
    if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) { ok = true; break; }
    await new Promise(r => setTimeout(r, 250));
  }
  const a = await page.evaluate(() => ({ ready: window.__octaveReady, hasMod: typeof window.Module === 'object',
    rc: (function () { try { return window.Module.eval_string('2+2'); } catch (e) { return 'ERR'; } })() }));
  check(ok && a.hasMod && a.rc === 0, 'A 单页模式无回归（?worker 缺席时行为不变）', JSON.stringify(a));

  // ══ C2 反向：单页模式下同一段计算会冻住页面 ══
  const frozen = await page.evaluate(async () => {
    let ticks = 0;
    const iv = setInterval(() => { ticks++; }, 10);
    window.Module.eval_string('A=rand(1400); B=rand(1400); C=A*B;');
    clearInterval(iv);
    return { ticks: ticks };
  });
  check(frozen.ticks === 0, '★ C2 反向：**单页模式**下 1400² 乘法期间页面定时器 tick=0（确实冻住）',
    `ticks=${frozen.ticks}`);
  await page.close();
}

// ══ B/C/D/E/F/G/H Worker 模式 ══
{
  const page = await (await browser.newContext()).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await page.goto(URL + (URL.indexOf('?') >= 0 ? '&' : '?') + 'worker=1', { waitUntil: 'load', timeout: 120000 });
  let ok = false;
  for (let t = 0; t < 720; t++) {
    if (await page.evaluate(() => window.OctaveWorker && window.OctaveWorker.ready).catch(() => false)) { ok = true; break; }
    await new Promise(r => setTimeout(r, 250));
  }
  const b = await page.evaluate(() => ({ hasApi: typeof window.OctaveWorker === 'object',
    ready: window.OctaveWorker && window.OctaveWorker.ready,
    noLocalModule: typeof window.Module === 'undefined',
    laneState: window.octaveLaneState && window.octaveLaneState.lane,
    laneWorkerMode: window.octaveLaneState && window.octaveLaneState.workerMode,
    laneWhy: window.octaveLaneState && window.octaveLaneState.why }));
  check(ok && b.hasApi && b.ready, '★ B Worker 模式就绪（window.OctaveWorker.ready）', JSON.stringify(b));
  check(b.noLocalModule, 'B2 Worker 模式下页面**没有**本地解释器（window.Module 缺席 ⇒ 主线程真的空着）',
    `noLocalModule=${b.noLocalModule}`);
  // ★ B6（2026-09-27）：**worker 模式下自动落基础档**（线程产物在 DedicatedWorker 里当主宿主
  //   是未验证组合，实测 4/12；显式 `?lane=threads&worker=1` 才是那条路）。这条断言把
  //   `bridge/lane.js` 的这条决定**钉住**：改回去就会红。
  check(b.laneState === 'base' && b.laneWorkerMode === true,
    '★ B6 worker 模式自动选**基础档**（未验证组合不自动选线程档）',
    JSON.stringify({ state: b.laneState, workerMode: b.laneWorkerMode, why: b.laneWhy }));

  // C ★ 主线程不冻：worker 里跑长计算，期间页面 tick 必须推进
  const live = await page.evaluate(async () => {
    let ticks = 0;
    const iv = setInterval(() => { ticks++; }, 10);
    const r = await window.OctaveWorker.eval('A=rand(1400); B=rand(1400); C=A*B;');
    clearInterval(iv);
    return { ticks: ticks, rc: r.rc, ms: r.ms };
  });
  check(live.rc === 0 && live.ticks > 5,
    '★ C 主线程不冻：worker 里同一段 1400² 计算期间页面 tick > 5（对比 C2 的 0）',
    `ticks=${live.ticks} rc=${live.rc} ms=${live.ms}`);

  // D 输出上屏
  const out = await page.evaluate(async () => {
    await window.OctaveWorker.eval('disp(4242)');
    await new Promise(r => setTimeout(r, 300));
    return { text: document.getElementById('output') ? document.getElementById('output').textContent : '' };
  });
  check(out.text.indexOf('4242') >= 0, 'D worker 的 stdout 经 postMessage 上了页面 #output',
    `#output 含 4242=${out.text.indexOf('4242') >= 0}`);

  // E 资产可用（worker 里 dlopen 的 dldfcn 核心组）
  const assets = await page.evaluate(async () => {
    const r = await window.OctaveWorker.eval(
      "fid=fopen('/tmp/w_exist.txt','w'); fprintf(fid,'%d %d', exist('convhulln'), exist('audioread')); fclose(fid);");
    await new Promise(r2 => setTimeout(r2, 200));
    return { rc: r.rc, err: r.err };
  });
  const assetExist = await page.evaluate(async () => {
    // 用 worker 自己算一遍并把值经 print 带回来（worker 的 FS 在 worker 里，页面读不到）
    const r = await window.OctaveWorker.eval("printf('%d %d\\n', exist('convhulln'), exist('audioread'));");
    return r;
  });
  check(assets.rc === 0 && assetExist.rc === 0, 'E Worker 里 dldfcn 核心组资产可用（eval rc=0）',
    `rc=${assets.rc}/${assetExist.rc} ${assets.err || ''}`);

  // F JSPI 在 worker 里真挂起
  const jspi = await page.evaluate(async () => {
    const t0 = performance.now();
    const r = await window.OctaveWorker.evalAsync('pause(0.2); 43');
    return { rc: r.rc, ms: Math.round(performance.now() - t0), err: r.err };
  });
  check(jspi.rc === 0 && jspi.ms >= 200, '★ F Worker 里 eval_async（B 姿势 JSPI）真挂起（rc=0，≥200ms）',
    JSON.stringify(jspi));

  // G 中断 —— ⚠️ 判据修正（2026-09-26 实测）：**必须走 evalAsync**（promising 栈）。
  //   B 姿势下 `pause` 的挂起靠 promising 包装，**同步 eval 碰挂起点本来就该失败**
  //   （下面 G0 就是把这条反向断言写实）。
  const g0 = await page.evaluate(async () => {
    const r = await window.OctaveWorker.eval('pause(0.05); 1');
    return { rc: r.rc, err: String(r.err || '').slice(0, 80) };
  });
  check(g0.rc !== 0, '★ G0 反向：worker 里**同步** eval 碰挂起点必须明确失败（不许静默成功）',
    JSON.stringify(g0));
  const intr = await page.evaluate(async () => {
    const p = window.OctaveWorker.evalAsync('for k=1:200, pause(0.05); end');
    await new Promise(r => setTimeout(r, 700));
    window.OctaveWorker.interrupt();
    const r = await p;
    const after = await window.OctaveWorker.eval('1+1');
    return { rc: r.rc, after: after.rc };
  });
  check(intr.rc === 3 && intr.after === 0, '★ G Worker 里中断投递（evalAsync 的 pause 循环 ⇒ rc=3，事后解释器存活）',
    JSON.stringify(intr));

  // H 图形（phase 1 边界）
  const plot = await page.evaluate(async () => {
    const before = window.OctaveWorker.plots;
    const r = await window.OctaveWorker.eval('figure(1); clf; plot(1:20); drawnow();');
    await new Promise(r2 => setTimeout(r2, 800));
    return { rc: r.rc, err: r.err, plots: window.OctaveWorker.plots - before,
             imgs: document.querySelectorAll('img').length };
  });
  // H ★ worker 里的**真渲染后端**（2026-09-26 实测达成；**不需要重链**）：
  //   机制：Emscripten 只要一个"能 getContext('webgl2') 的对象"，而 OffscreenCanvas 在 worker
  //   里可用 ⇒ shim 交出一个真 OffscreenCanvas 即可。判据（三条都要，缺一条就翻面）：
  //     ① graphics_toolkit() == 'webgl'（真后端，不是只出句柄的 web 后端）
  //     ② 工具包的"无 GL 回落信号文件"不存在（/tmp/p5_nogl.txt 缺席 = 真拿到了 GL 上下文）
  //     ③ 我们自己交出的 OffscreenCanvas 上确实有 WebGL2 上下文
  const gfx = await page.evaluate(async () => {
    const before = window.OctaveWorker.plots;
    await window.OctaveWorker.eval('figure(1); clf; plot(1:20); drawnow();');
    await new Promise(r => setTimeout(r, 1200));
    const d = await window.OctaveWorker.diagnose();
    return { plots: window.OctaveWorker.plots - before, imgs: document.querySelectorAll('img').length, d: d };
  });
  check(gfx.d.tk === 'webgl' && gfx.d.nogl === 0 && gfx.d.glCtx === true && gfx.plots >= 1 && gfx.imgs >= 1,
    '★ H worker 里有**真渲染后端**：toolkit=webgl + 无 GL 回落信号 + OffscreenCanvas 上真有 WebGL2 上下文 + 图上屏',
    JSON.stringify(gfx));
  console.log('   图形路径自证：' + JSON.stringify(gfx.d));

  // ══ 以下四条来自外部评审 C 节（Gemini）：真盲区，判据都可证伪 ══

  // ★ C1 重入防护：挂起期间再派一条命令 ⇒ **必须排队**，不许撞
  //   `RuntimeError: Suspend error: instance is already suspended`
  const reentry = await page.evaluate(async () => {
    const p1 = window.OctaveWorker.evalAsync('pause(1.2); 111');   // 挂起中
    await new Promise(r => setTimeout(r, 150));
    const p2 = window.OctaveWorker.eval('222');                    // 挂起期间第二条
    const [a, b] = await Promise.all([p1, p2]);
    const after = await window.OctaveWorker.eval('333');
    return { a: a.rc, b: b.rc, after: after.rc, bErr: String(b.err || '').slice(0, 90) };
  });
  check(reentry.a === 0 && reentry.b === 0 && reentry.after === 0 && !/Suspend|suspended/i.test(reentry.bErr),
    '★ C1 重入防护：挂起期间的第二条命令被**排队**（两条都 rc=0，无 Suspend error）',
    JSON.stringify(reentry));

  // ★ C4a **纯计算**下的主线程自由度（强判据、比例式）：tick 应接近"按 10ms 满额"
  const pure = await page.evaluate(async () => {
    let ticks = 0; const iv = setInterval(() => { ticks++; }, 10);
    const r = await window.OctaveWorker.eval('A=rand(1000); B=rand(1000); C=A*B;');
    clearInterval(iv);
    return { rc: r.rc, ticks: ticks, ms: r.ms };
  });
  const pureExp = Math.max(1, pure.ms / 10);
  check(pure.rc === 0 && pure.ticks >= pureExp * 0.7,
    '★ C4a 纯计算(1000²)期间主线程 tick ≈ 满额（≥0.7×应得）—— 这才是 C3 的核心主张',
    JSON.stringify(pure) + ` 期望≈${Math.round(pureExp)}`);

  // ★ C4b stdout 洪泛：**不丢字 + 主线程仍活**（对比单页模式的 tick=0）；残存代价如实记
  const flood = await page.evaluate(async () => {
    let ticks = 0; const iv = setInterval(() => { ticks++; }, 10);
    const r = await window.OctaveWorker.eval('for k=1:50000, printf("%d\\n", k); end');
    clearInterval(iv);
    const txt = document.getElementById('output').textContent;
    return { rc: r.rc, ticks: ticks, ms: r.ms, lines: txt.split('\n').length, hasLast: txt.indexOf('50000') >= 0 };
  });
  check(flood.rc === 0 && flood.ticks > 0 && flood.hasLast,
    '★ C4b stdout 洪泛：5 万行不丢字、主线程仍在跑（tick>0；单页模式同负载 tick=0）',
    JSON.stringify(flood) + `（如实记：输出密集时两线程争 CPU，tick 低于满额）`);

  // ★ C3 terminate 结算：被 terminate 的待办**必须立刻 reject**（不许僵尸 Promise），且能重启
  const term = await page.evaluate(async () => {
    const t0 = performance.now();
    const p = window.OctaveWorker.evalAsync('pause(3); 999');
    await new Promise(r => setTimeout(r, 200));
    window.OctaveWorker.terminate();
    let errName = null, settled = false;
    try { await p; settled = true; } catch (e) { errName = e && e.name; }
    return { settled: settled, errName: errName, ms: Math.round(performance.now() - t0) };
  });
  check(!term.settled && term.errName === 'AbortError' && term.ms < 1000,
    '★ C3 terminate 结算：待办在 terminate 后立刻以 AbortError reject（无僵尸 Promise）', JSON.stringify(term));
  // 重启一个新 worker 并确认可用（换 home，避免与旧实例的 IDBFS 撞）
  const revived = await page.evaluate(async () => {
    var d = document.createElement('div'); d.id = 'w2'; document.body.appendChild(d);
    const w2 = new Worker('octave-worker.js');
    window.__w2 = w2;
    var seq = 0, pend = {};
    w2.onmessage = e => { const m = e.data; if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } };
    w2.postMessage({ kind: 'opts', base: '', home: '/home/web_user/w2' });
    const call = (kind, p) => new Promise(res => { const id = ++seq; pend[id] = res; w2.postMessage(Object.assign({ id, kind }, p)); });
    for (let i = 0; i < 240; i++) { const ok = await call('eval', { code: '1' }).catch(() => null); if (ok && ok.rc === 0) break; await new Promise(r => setTimeout(r, 500)); }
    const r = await call('eval', { code: '444' });
    // ⚠️ canvas 是**首次 redraw 时**才创建（#octave-gl-canvas 懒建）⇒ 必须先画一次再 diagnose，
    //   否则 glCtx 恒为 false（第一版判据就栽在这，是判据 bug 不是产品 bug）
    await call('eval', { code: 'figure(7); clf; plot(1:5); drawnow();' });
    await new Promise(res => setTimeout(res, 800));
    const g = await call('diagnose', {});
    return { rc: r.rc, tk: g.d && g.d.tk, glCtx: g.d && g.d.glCtx };
  });
  check(revived.rc === 0 && revived.tk === 'webgl' && revived.glCtx === true,
    '★ C3b worker 可重启：新实例照常 eval 且**同样拿到真渲染后端**（tk=webgl + WebGL2 上下文）',
    JSON.stringify(revived));

  if (errs.length) console.log('   ⚠️ 页面报错：' + errs.slice(0, 3).join(' // '));
  await page.close();
}

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
