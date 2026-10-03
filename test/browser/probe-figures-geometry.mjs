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
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8865/wgsl-demo.html';
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
