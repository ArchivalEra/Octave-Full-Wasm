// 图形线 WebGL 步骤①验收：gl4es + WebGL2 在真浏览器里把**立即模式**跑对了吗
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/probe-gl4es-smoke.mjs [URL]
// 产物来自 `build/113/gl4es-smoke.sh`（默认站点 /mnt/hdd/octave-wasm-build/siteGL4ES）。
//
// 为什么要有这一步（与 OSMesa 那条线的步骤① 对称）：
//   整条 WebGL 线唯一的真未知是"gl4es 在 WebGL2 上能不能把**固定管线 + 立即模式**
//   跑对"。emscripten 自带的 `LEGACY_GL_EMULATION` 在这件事上是**实测失败**的
//   （Edge-Tools 死在 `numVertices must be an integer` at `glEnd`，见
//   build/113/vendor-edge-tools/MILESTONE-2.md）。gl4es 自己实现立即模式，但
//   **理论不算数 —— 这里在真 Chromium 里逐像素断言**。
//
// 断言（全部是"数值可验证"的，不看函数在不在）：
//   · WebGL2 上下文建得起来、gl4es 初始化成功
//   · glGetError 全程为 0（含 glBegin/glVertex/glEnd 之后）
//   · 立即模式绿三角：**中心像素是绿**、**两个角是清屏红**
//   · 绿像素占比合理（>10% 且 <70%）⇒ 确实做了光栅化，不是"整屏同色"
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8767/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage',
         '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + String(e)));

let pass = 0, fail = 0;
function assert (cond, label, extra) {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'fail'} | ${label}${extra ? ' :: ' + extra : ''}`);
}

await page.goto(URL, { waitUntil: 'load', timeout: 120000 });

// 等 smoke 自己跑完（它在 window.__gl4es_smoke.done 上落旗）
let st = null;
const t0 = Date.now();
while (Date.now() - t0 < 120000) {
  st = await page.evaluate(() => window.__gl4es_smoke || null).catch(() => null);
  if (st && st.done) break;
  await new Promise(r => setTimeout(r, 400));
}

console.log('--- console 输出 ---');
console.log(logs.join('\n').slice(0, 2500));
console.log('--- window.__gl4es_smoke ---');
console.log(JSON.stringify(st, null, 1));

if (!st) {
  assert(false, '★ smoke 落了 window.__gl4es_smoke（说明 wasm 根本没跑起来）');
  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await browser.close();
  process.exit(1);
}

console.log('--- 断言 ---');
assert(st.ctx === 'ok', '★ WebGL2 上下文创建成功', String(st.ctx));
assert(st.make_current === 'ok', '★ emscripten_webgl_make_context_current 成功');
assert(st.initialize_gl4es === 'called', '★ initialize_gl4es() 已调用（在任何 GL 调用之前）');
assert(!!st.gl_version && st.gl_version !== '(null)', 'GL_VERSION 非空', String(st.gl_version));
assert(!!st.gl_renderer && st.gl_renderer !== '(null)', 'GL_RENDERER 非空', String(st.gl_renderer));

for (const c of (st.checks || []))
  assert(!!c.ok, c.label);

// 关键像素证据再单独点名一次（便于从日志一眼看到数字）
assert(/^\d+ \d+ \d+ \d+$/.test(st.center_rgba || ''), '中心像素已取样', st.center_rgba);
assert(/^\d+ \d+ \d+ \d+$/.test(st.bottomleft_rgba || ''), '左下像素已取样', st.bottomleft_rgba);
assert(/^\d+ \d+ \d+ \d+$/.test(st.topright_rgba || ''), '右上像素已取样', st.topright_rgba);

console.log(`\n绿像素 = ${st.green_pixels} / 4096（${
  (100 * Number(st.green_pixels || 0) / 4096).toFixed(1)}%）`);
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
