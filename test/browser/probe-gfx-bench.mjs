// 图形后端速度实测：WebGL（gl4es → ANGLE → 真 GPU / SwiftShader）
// 用 CDP 的 CPU 降频来近似"手机级 CPU"—— 桌面 i/dGPU 远快于手机，不降频的数字没意义。
//
// 用法：run.sh probe-gfx-bench.mjs [webglURL]
// （2026-09-23：OSMesa 后端已退役，原来那条"OSMesa vs WebGL"的对照列随之删掉；
//   历史数据留在 NOTES-webgl.md 与 NOTES-p5-osmesa.md 里。）
import { chromium } from 'playwright-core';

const WEBGL_URL = process.argv[2] || 'http://127.0.0.1:8768/';

const BASE_ARGS = ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'];
const GPU_ARGS  = [...BASE_ARGS, '--use-gl=angle', '--use-angle=gl',
                   '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
const SW_ARGS   = [...BASE_ARGS, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

async function measure(url, tk, args, throttle, label) {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => logs.push(m.text()));

  try {
    await page.goto(url, { waitUntil: 'load', timeout: 300000 });
    const t0 = Date.now();
    while (Date.now() - t0 < 300000) {
      const ok = await page.evaluate(() => { try { return !!window.Module?.feval?.('strcat', ['a', 'b'], 1); } catch { return false; } }).catch(() => false);
      if (ok) break; await new Promise(r => setTimeout(r, 800));
    }
    while (!(await page.evaluate(() => !!window.__octaveReady).catch(() => false))) await new Promise(r => setTimeout(r, 500));

    // 降频必须在跑之前设好（Emulation.setCPUThrottlingRate）
    const client = await ctx.newCDPSession(page);
    await client.send('Emulation.setCPUThrottlingRate', { rate: throttle });

    // 报一下这个浏览器的 WebGL 跑在哪，免得拿软件数字当 GPU
    await page.evaluate(() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (gl) {
        const d = gl.getExtension('WEBGL_debug_renderer_info');
        window.__glBackend = d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : '(unknown)';
      }
    });

    const ev = async (expr) => {
      logs.length = 0;
      await page.evaluate(x => { window.Module.eval_string(x); }, expr);
      await new Promise(r => setTimeout(r, 300));
      return logs.join(' ').replace(/\s+/g, ' ').trim();
    };

    // 切后端（两个站点各自只有一个真渲染器）
    await ev(`graphics_toolkit('${tk}'); disp('tk=${tk}')`);

    // 准备两张图：2D 用 line()、3D 用 surface() —— 这俩**都不过 plot 桥**
    // （桥里没有 line/surface），所以量到的是**渲染器本身**，不含桥的镜像开销。
    await ev('figure(1); clf; line(1:200, sin((1:200)/10)); drawnow(); "setup2d"');
    await ev('figure(2); clf; surface(peaks(40)); drawnow(); "setup3d"');

    // A. 纯渲染：getframe 必然走 toolkit 的 render()（不像 drawnow 可能被"没脏"跳过）
    const A2 = await ev('t=tic; for k=1:5; p=getframe(1); endfor; disp(round(toc(t)/5*1000))');
    const A3 = await ev('t=tic; for k=1:5; p=getframe(2); endfor; disp(round(toc(t)/5*1000))');

    // B. 端到端（含 plot 桥的镜像开销，两个后端一样，作对照）
    const B3 = await ev('t=tic; for k=1:3; figure(9); clf; surf(peaks(40)); drawnow(); endfor; disp(round(toc(t)/3*1000))');

    const glBackend = await page.evaluate(() => window.__glBackend || '(n/a)');
    const num = (s) => { const m = String(s).match(/(\d+)\s*$/); return m ? m[1] : '?'; };
    console.log(`${label.padEnd(34)} | getframe2D ${String(num(A2)).padStart(6)} ms | getframe3D ${String(num(A3)).padStart(6)} ms | 端到端surf ${String(num(B3)).padStart(6)} ms | WebGL=${String(glBackend).slice(0, 42)}`);
  } catch (e) {
    console.log(`${label.padEnd(34)} | 失败: ${String(e).slice(0, 120)}`);
  } finally {
    await browser.close();
  }
}

console.log('每格是该操作的平均毫秒数（越小越快）。降频 4× ≈ 约 4 倍慢的 CPU，用来近似手机档。\n');
for (const [url, tk, args, name] of [
  [WEBGL_URL,  'webgl',  GPU_ARGS,  'WebGL→ANGLE→真GPU'],
  [WEBGL_URL,  'webgl',  SW_ARGS,   'WebGL→SwiftShader(软件)'],
]) {
  for (const th of [1, 4]) {
    await measure(url, tk, args, th, `${name}  [CPU×${th}]`);
  }
  console.log('');
}
