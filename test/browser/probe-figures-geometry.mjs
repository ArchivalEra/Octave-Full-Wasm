// 探针：figures.geometry() 几何通道 + WebGPU 参考渲染（工单 50 第一实验）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 验证两件事：
//   A. **几何通道**（数据驱动，不过 drawnow/GL）：plot 后 `figures.geometry()` 返回
//      对象树导出——折线 x/y/颜色/线宽/marker + 坐标区语义（xlim/ylim/title…）。
//   B. **WebGPU 渲染**：WGSL line-strip 管线把几何画出来——离屏纹理渲染 +
//      copyTextureToBuffer + mapAsync **GPU 侧回读**数像素（合成器截图在 headless/
//      Xvfb 下不可靠，实测记录）。回读需要 headed GPU 路径：
//      `xvfb-run -a sh test/browser/run.sh …`（plain headless 下 SwiftShader 的
//      mapAsync 会报 external Instance 错——环境限制，如实跳过 B 格）。
//
// 用法：HARNESS=/mnt/hdd/octave-wasm-build/harness xvfb-run -a sh test/browser/run.sh \
//        test/browser/probe-figures-geometry.mjs <部署了 wgsl-demo.html 的站点>
//
// ★ 2026-10-10 修（PROBES=1 实测的"探针腐烂"）：sweep 按契约给**站点根 URL**，而本站点
//   不部署 `wgsl-demo.html` ⇒ 页面即站点首页、`__wgslDone` 永不为 true，探针在 180s 等待后
//   拿空数据报 2 红（每轮全量都假红，而清单声明的输入又没被消费）。修法 = **两处**：
//   ① URL 归一化：`…/` ⇒ `…/wgsl-demo.html`（根 URL 就当"这套页在该站点根下"）；
//   ② **页面缺席时如实报 N/A**（与 probe-e2-threads 同款：既不算通过也不算失败）——
//      判据 = 取回的 panel 是站点首页而不是探针页。避免"环境缺件 = 假红"。
import { chromium } from 'playwright-core';

let URL = process.argv[2] || 'http://127.0.0.1:8865/wgsl-demo.html';
if (/^https?:\/\/[^/]+\/?$/.test(URL)) URL = URL.replace(/\/?$/, '/') + 'wgsl-demo.html';
let pass = 0, fail = 0;
const check = (ok, name, detail = '') => {
  console.log(`${ok ? 'PASS' : 'fail'} | ${name}${detail ? ' :: ' + detail : ''}`);
  ok ? pass++ : fail++;
};

const headed = process.env.HEADLESS_GPU === '1';   // 显式 opt-in：需 xvfb-run -a（ headed 路径才有 GPU 回读）
const launchArgs = ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage',
  '--enable-unsafe-webgpu'];
if (headed) {
  launchArgs.push('--use-gl=angle', '--use-angle=vulkan', '--enable-features=Vulkan');
}
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  headless: !headed, args: launchArgs });
const page = await (await browser.newContext()).newPage();
page.on('pageerror', e => console.log('   [pageerror] ' + String(e).slice(0, 250)));
await page.goto(URL, { waitUntil: 'load', timeout: 120000 });

// ── ★ 页缺席 ⇒ 如实 N/A（既不算通过也不算失败；防"站点没部署 = 全量假红"）──────
//    判据用**页面自己的标记**：探针页在脚本一开始就置 `window.__wgslDone`（哪怕是
//    WebGPU 不可用那条路也会置 true）；站点首页上它恒为 undefined。
//    ⚠️ 顺序：先探标记（最多 5s）**再**等完成 —— 反过来的话缺席站点要白等 180s
//       （实测：修好的第一版就是这么慢的，sweep 里表现为"探针跑 3 分钟才报 N/A"）。
let onProbePage = false;
for (let w = 0; w < 25; w++) {
  onProbePage = await page.evaluate(() => typeof window.__wgslDone !== 'undefined').catch(() => false);
  if (onProbePage) break;
  await new Promise(r => setTimeout(r, 200));
}
if (!onProbePage) {
  console.log(`N/A  | 这个站点没有探针页 ${URL}（页面里没有 __wgslDone 标记）`);
  console.log('      本探针只对**部署了 wgsl-demo.html 的站点**有意义（工单 50 的实验页，');
  console.log('      随 embed 资产上站；8761/8768 目前不部署它）⇒ 不适用：不是通过也不是失败。');
  console.log('=== 0 PASS / 0 FAIL ===');
  await browser.close();
  process.exit(0);
}
await page.waitForFunction('window.__wgslDone === true', null, { timeout: 180000 })
  .catch(() => {});

const panel = await page.evaluate(() => document.getElementById('panel')?.textContent || '');
const geom = await page.evaluate(() => window.__lastGeometry || null);

// ── A：几何通道 ──
const g = geom && geom.geometry;
check(!!g, 'A1 geometry 通道返回结构', g ? JSON.stringify(Object.keys(g)) : 'null');
if (g) {
  const lines = (g.objects || []).filter(o => o.type === 'line');
  check((g.objects || []).length === 3 && lines.length === 3,
        'A2 三条 line 对象（对象树遍历）', `objects=${(g.objects || []).length}`);
  // ⚠ axes children 是后画的在前——按**颜色语义**找红线，不依赖顺序
  const red = lines.find(o => Array.isArray(o.color) && o.color[0] === 1 && o.color[1] === 0 && o.color[2] === 0) || {};
  check(Array.isArray(red.x) && red.x.length === 10 &&
        red.y && red.y[1] === 4 && red.y[9] === 100,
        'A3 数据正确（红线 = plot(1:10,(1:10).^2) 的 y=[1,4,…,100]）', JSON.stringify(red.y));
  check(red.linewidth === 0.5 && red.marker === 'none' && red.linestyle === '-',
        'A4 样式语义（默认 lw=0.5 / marker=none / ls=-——该页 plot 用 \'r-\' 无属性）',
        JSON.stringify({ lw: red.linewidth, marker: red.marker, ls: red.linestyle }));
  const starred = lines.find(o => o.marker === '*');
  check(!!starred && starred.color[0] === 0 && starred.color[2] === 0,
        'A4b 第三条线（k*）marker=* 颜色黑', starred ? JSON.stringify({ marker: starred.marker, color: starred.color }) : 'missing');
  check(Array.isArray(g.xl) && Array.isArray(g.yl) && g.yl[1] === 100,
        'A5 坐标区语义（xlim/ylim）', JSON.stringify({ xl: g.xl, yl: g.yl }));
  check(g.title === '测试图' && g.xlabel === 'x' && g.ylabel === 'y',
        'A6 标题/轴标（text 语义）', JSON.stringify({ t: g.title, x: g.xlabel, y: g.ylabel }));
}

// ── B：WebGPU 渲染 + GPU 侧回读 ──
const drawn = await page.evaluate(() => window.__wgslDrawn || 0);
const px = await page.evaluate(() => window.__wgslPixels || null);
const gpuInfo = await page.evaluate(() => ({
  gpu: !!navigator.gpu, pinned: !!window.__gpuDevice }));
check(gpuInfo.gpu, 'B1 navigator.gpu 存在（Chrome/Edge 113+）');
check(drawn >= 2, 'B2 line-strip 提交（≥2 条）', `drawn=${drawn}`);
if (px) {
  check(px.red > 50 && px.blue > 50, 'B3 GPU 回读像素（红/蓝线真画上了）',
        `red=${px.red} blue=${px.blue} drawn2=${px.drawn2}`);
} else {
  console.log('   [info] GPU 回读不可用（plain headless 下 mapAsync 受限）——'
            + '用 xvfb-run -a + HEADLESS_GPU=1 重跑本探针可验 B3');
}

await browser.close();
console.log(`=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
