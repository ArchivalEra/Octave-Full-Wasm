// 探针：首帧冷启动的构成与"预热"的净收益（批次 E，HANDOFF §8 第 4 条）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 要回答的问题：真渲染器**第一次**出图要比之后慢多少（建 WebGL 上下文 + `initialize_gl4es()`
// + 编 shader + 首次 `glReadPixels`），以及"在页面启动时预热"能不能真的省掉它。
//
// ⚠️ **冷/温必须分开量**（§5.21 的教训：混着量会把归因搞错，"剩下的 480 ms 是 path 手术"
//    就是那么错出来的）。本探针只**测**不下结论 —— 结论与决策写在 HANDOFF §5.27。
// ⚠️ **别和其它 sweep 并行跑**（CPU 一抢，毫秒数就没意义了）。
//
// 判据（决策用）：
//   · 冷首图 = 用户第一次 `drawnow` 的等待；
//   · 预热若放在**页面启动时**：总时长不变（只是把这段从"首次出图"挪到"开页"）；
//   · 预热若放在 **ready 之后**：它会**独占主线程**（Octave 的 eval 是同步的）⇒ 用户
//     自己的第一条命令要排队，等于把等待挪到了更糟的地方。
//   所以本探针的产出是**三个数**：ready 时间、冷首图时间、温出图时间。
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/probe-cold-start.mjs [URL]
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8768/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text().slice(0, 300)));
page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 300)));

const tNav = Date.now();
await page.goto(URL, { waitUntil: 'load', timeout: 240000 });
const tLoaded = Date.now();
let tReady = null;
while (Date.now() - tNav < 300000) {
  if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) {
    tReady = Date.now();
    break;
  }
  await new Promise(r => setTimeout(r, 100));
}
console.log(`URL=${URL}`);
console.log(`navigation→load  = ${tLoaded - tNav} ms`);
console.log(`navigation→ready = ${tReady ? tReady - tNav : 'TIMEOUT'} ms`);

async function ev (code, ms = 1500) {
  logs.length = 0;
  const r = await page.evaluate(x => {
    const rc = window.Module.eval_string(x);
    return { rc, err: window.Module.last_error_message() };
  }, code);
  await new Promise(rr => setTimeout(rr, ms));
  return { rc: r.rc, err: r.err, out: [...logs].join(' ').replace(/\s+/g, ' ').trim() };
}

// ① 冷：三步分开（clf / plot / drawnow）—— 冷代价应该几乎全在**第一次 drawnow**
const cold = await ev('tic; clf; a = toc; tic; plot(1:10); b = toc; tic; drawnow; c = toc; ' +
  'disp(sprintf("cold_clf=%d cold_plot=%d cold_drawnow=%d", round(a*1000), round(b*1000), round(c*1000)))',
  2500);
console.log('① 冷（第一次出图）:', cold.out || cold.err);

// ② 温：再画一次（同尺寸）—— 这是"预热过之后"用户会看到的时间
const warm = await ev('tic; clf; plot(1:10); drawnow; d = toc; ' +
  'clf; plot(1:20); tic; drawnow; e = toc; ' +
  'disp(sprintf("warm_full=%d warm_drawnow=%d", round(d*1000), round(e*1000)))', 2500);
console.log('② 温（第二次之后）:', warm.out || warm.err);

// ③ 更大的图（3D）冷/温对照：冷启动代价在大图上是否被淹没
const surf = await ev('tic; clf; surf(peaks(24)); drawnow; f = toc; ' +
  'clf; surf(peaks(24)); tic; drawnow; g = toc; ' +
  'disp(sprintf("surf1=%d surf2=%d", round(f*1000), round(g*1000)))', 4000);
console.log('③ 3D 冷/温:', surf.out || surf.err);

// ④ 预热**等价物**：如果开页时先偷偷画一张（页面会为此多等 c 毫秒），
//    用户的第一张图就变成 warm_full。两条路的总时长对比写在输出里供人判断。
const m = cold.out.match(/cold_drawnow=(\d+)/);
const w = warm.out.match(/warm_full=(\d+)/);
if (m && w) {
  const c = Number(m[1]), wf = Number(w[1]);
  console.log(`\n判据：用户"第一次看到图"\n  · 不预热 = ready(${tReady - tNav}ms) + 冷首图(${c}ms)`);
  console.log(`  · 开页预热 = ready(${tReady - tNav}ms) + 预热(${c}ms) + 温首图(${wf}ms)  ←  总时长更长`);
  console.log(`  · ready 之后预热 = 独占主线程，用户第一条命令要排队 ${c}ms`);
}
console.log('\n（本探针只测不判；决策见 HANDOFF §5.27）');
await browser.close();
