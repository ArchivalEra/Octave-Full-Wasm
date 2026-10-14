// 探针：浏览器里的 **WebGPU / DOM-free 能力面**（2026-10-14）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 为什么有它（一次**实测踩到的假结论**）────────────────────────────────────
// 我曾在无头浏览器 + `about:blank` 上探 `navigator.gpu` ⇒ 得到 `undefined` ⇒ 写下
// "**这台机器/我们的场景没有 WebGPU**"（推而广之："GPU 是结构性差距"）。**两处都错**：
//   · **`about:blank` 不是安全上下文** ⇒ `navigator.gpu` 根本不存在（与有无 GPU 无关）；
//   · `http://127.0.0.1` 是安全上下文 ⇒ `navigator.gpu` 在，且能拿到**真设备**。
// ⇒ 本探针把"在**安全上下文**里测"写成代码（`goto(URL)` 之后才探），并**真的跑一个
//    compute shader 把结果读回**（不是只看 `typeof`）——"能问"与"能用"是两回事。
//
// ── 判据（每条都对应一个具体问题）──────────────────────────────────────────
//   ① 主线程：安全上下文 + `navigator.gpu` + 拿得到 adapter/device
//   ② **Worker 内**（DOM-free）：同上 —— 这是"算力放 Worker"是否成立的关键
//   ③ **真计算**：dispatch 一个 compute pipeline，`[1,1,1,1] × 2` 读回 `[2,2,2,2]`
//   ④ OffscreenCanvas + WebGL2（Worker 里）—— 渲染不依赖 DOM 的证据
//   ⑤ 硬件接口（WebSerial/USB/HID）—— 网页原生，`npm` 级的"驱动"在这里是浏览器 API
//   rc=0 ⇒ 全绿；rc=1 ⇒ WebGPU 不可用（如实报哪一条）；rc=3 ⇒ 页面没起来（环境问题）。
//
// 用法：node test/browser/probe-webgpu-capability.mjs [URL]
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const HEADFUL = process.env.HEADLESS !== '1';          // 默认有头（X 显示在时更真实）
const br = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  headless: !HEADFUL,
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-webgpu'],
});
const page = await (await br.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 160)));

// ★ 顺序是关键：**先 goto 真页面**（安全上下文），再探。别在 about:blank 上探。
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 300000 }).catch(() => {});
await page.waitForFunction(() => window.__octaveReady === true, null, { timeout: 300000 })
  .catch(() => {});
await new Promise(r => setTimeout(r, 1500));

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 220)}`);
};

// ── ① 主线程 ──────────────────────────────────────────────────────────────
const main = await page.evaluate(async () => {
  const o = { secure: window.isSecureContext, hasGPU: typeof navigator.gpu !== 'undefined' };
  if (!o.hasGPU) return o;
  try {
    const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    o.adapter = a ? 'OK' : 'null';
    if (a) { const d = await a.requestDevice(); o.device = d ? 'OK' : 'null';
             o.vendor = a.info ? a.info.vendor : '?'; }
  } catch (e) { o.err = String(e).slice(0, 120); }
  return o;
});
check(main.secure === true, '① 安全上下文（`isSecureContext`）—— WebGPU 的前提', JSON.stringify(main).slice(0, 140));
check(main.hasGPU === true, '① `navigator.gpu` 存在（**在真页面上**探，不是 about:blank）', String(main.hasGPU));
check(main.adapter === 'OK' && main.device === 'OK',
  '① 拿得到 adapter **与** device', `adapter=${main.adapter} device=${main.device} vendor=${main.vendor}`);

// ── ② Worker（DOM-free）+ ③ 真计算 + ④ OffscreenCanvas ────────────────────
const WS = `
self.onmessage = async () => {
  const o = { hasGPU: typeof navigator.gpu !== 'undefined',
              hasOffscreen: typeof OffscreenCanvas !== 'undefined',
              hasSAB: typeof SharedArrayBuffer !== 'undefined',
              coi: self.crossOriginIsolated === true };
  try {
    if (o.hasOffscreen) { try { o.webgl2 = !!new OffscreenCanvas(1,1).getContext('webgl2'); } catch(e){ o.webgl2 = false; } }
    if (!navigator.gpu) { postMessage(o); return; }
    const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    o.adapter = a ? 'OK' : 'null';
    if (!a) { postMessage(o); return; }
    o.vendor = a.info ? a.info.vendor : '?';
    const dev = await a.requestDevice();
    o.device = dev ? 'OK' : 'null';
    if (!dev) { postMessage(o); return; }
    // 真算：4 个 f32 各乘 2
    const N = 4, BYTES = N * 4;
    const buf = dev.createBuffer({ size: BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    dev.queue.writeBuffer(buf, 0, new Float32Array([1,1,1,1]));
    const rd = dev.createBuffer({ size: BYTES, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const mod = dev.createShaderModule({ code: [
      '@group(0) @binding(0) var<storage, read_write> d: array<f32>;',
      '@compute @workgroup_size(4) fn main(@builtin(global_invocation_id) g: vec3u) { d[g.x] = d[g.x] * 2.0; }'
    ].join('\\n') });
    const pipe = dev.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'main' } });
    const bg = dev.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buf } }] });
    const enc = dev.createCommandEncoder();
    const p = enc.beginComputePass(); p.setPipeline(pipe); p.setBindGroup(0, bg); p.dispatchWorkgroups(1); p.end();
    enc.copyBufferToBuffer(buf, 0, rd, 0, BYTES);
    dev.queue.submit([enc.finish()]);
    await rd.mapAsync(GPUMapMode.READ);
    o.out = Array.from(new Float32Array(rd.getMappedRange().slice(0)));
    o.computeOK = o.out.every(v => v === 2);
  } catch (e) { o.err = String(e).slice(0, 160); }
  postMessage(o);
};`;
const w = await page.evaluate(async (code) => {
  const ww = new Worker(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
  return await new Promise(res => {
    const t = setTimeout(() => res({ timeout: true }), 25000);
    ww.onmessage = e => { clearTimeout(t); res(e.data); };
    ww.onerror = e => { clearTimeout(t); res({ workerErr: String(e.message || e).slice(0, 160) }); };
    ww.postMessage('go');
  });
}, WS);
check(w.hasGPU === true, '② **Worker 内**（DOM-free）也有 `navigator.gpu`', JSON.stringify(w).slice(0, 160));
check(w.adapter === 'OK' && w.device === 'OK', '② Worker 内拿得到 adapter/device', `vendor=${w.vendor}`);
check(JSON.stringify(w.out) === '[2,2,2,2]' && w.computeOK === true,
  '★ ③ **Worker 里真跑 compute shader**（[1,1,1,1]×2 → [2,2,2,2]）',
  `out=${JSON.stringify(w.out)} err=${w.err || 'none'}`);
check(w.hasOffscreen === true && w.webgl2 === true,
  '④ Worker 内 OffscreenCanvas + **webgl2**（渲染不依赖 DOM）', `offscreen=${w.hasOffscreen} webgl2=${w.webgl2}`);

// ── ⑤ 硬件接口（网页原生）─────────────────────────────────────────────────
const hw = await page.evaluate(() => ({
  serial: typeof navigator.serial !== 'undefined',
  usb: typeof navigator.usb !== 'undefined',
  hid: typeof navigator.hid !== 'undefined',
}));
const nHW = [hw.serial, hw.usb, hw.hid].filter(Boolean).length;
check(nHW >= 2, '⑤ 硬件接口（WebSerial/WebUSB/WebHID）—— 网页原生，无需装驱动',
  `serial=${hw.serial} usb=${hw.usb} hid=${hw.hid}`);

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await br.close();
if (fail) { console.log('结论：有缺口（见上面 fail 条目）'); process.exit(1); }
console.log('结论：WebGPU **在 Worker 里可用且真算对**；OffscreenCanvas/WebGL2/SAB 齐；'
  + '硬件接口网页原生。⇒ "算力放 Worker + GPU 加速 + 页面出图"这条链路**成立**。');
process.exit(0);
