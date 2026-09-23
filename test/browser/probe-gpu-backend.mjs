// 这台机器上 headless Chromium 的 WebGL 到底跑在哪（SwiftShader 软件 还是 真 GPU）？
// 这决定"图形后端在手机上的速度"这件事在这里能测到什么程度。
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8768/';

const VARIANTS = [
  ['默认（headless 默认通常是 SwiftShader 软件）', ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage']],
  ['显式要真 GPU：--use-angle=gl', ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']],
  ['显式 software（对照组）', ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']],
];

for (const [label, args] of VARIANTS) {
  let browser;
  try {
    browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args });
    const page = await (await browser.newContext()).newPage();
    await page.goto('about:blank');
    const info = await page.evaluate(() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return { err: 'no webgl context' };
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        version: gl.getParameter(gl.VERSION),
        vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        isWebGL2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
      };
    });
    console.log(`--- ${label}`);
    console.log('   ' + JSON.stringify(info));
  } catch (e) {
    console.log(`--- ${label}\n   启动/查询失败: ${String(e).slice(0, 140)}`);
  } finally {
    if (browser) await browser.close();
  }
}
