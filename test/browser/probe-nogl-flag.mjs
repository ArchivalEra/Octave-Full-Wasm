// 探针：哪种 chromium 旗标能让 **WebGL2 上下文建不出来**（为候选 1 的回落套件找触发方式）
// 用法：run.sh probe-nogl-flag.mjs [URL]
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8768/';
const BASE = ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'];
const CANDIDATES = [
  ['--disable-webgl', '基线 + --disable-webgl'],
  ['--disable-3d-apis', '基线 + --disable-3d-apis'],
  ['--disable-webgl --disable-3d-apis', '两个都开'],
];

for (const [flags, label] of CANDIDATES) {
  const args = [...BASE, ...flags.split(' ')];
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args });
  const page = await (await browser.newContext()).newPage();
  const logs = [];
  page.on('console', m => logs.push(m.text()));
  try {
    await page.goto(URL, { waitUntil: 'load', timeout: 120000 });
    for (let i = 0; i < 200; i++) {
      const ok = await page.evaluate(() => window.__octaveReady === true).catch(() => false);
      if (ok) break; await new Promise(r => setTimeout(r, 500));
    }
    // 直接问浏览器：能不能建出 webgl2 上下文
    const caps = await page.evaluate(() => {
      const c = document.createElement('canvas');
      const g2 = c.getContext('webgl2');
      const g1 = c.getContext('webgl');
      return { webgl2: !!g2, webgl1: !!g1,
               renderer: (() => { try { const d = g2.getContext ? g2 : null; } catch (e) {} return null; })() };
    });
    logs.length = 0;
    await page.evaluate(() => window.Module.eval_string(
      'figure(1); clf; plot(1:10,(1:10).^2); drawnow; disp("drawn")'));
    await new Promise(r => setTimeout(r, 2500));
    const out = logs.join(' ');
    const png = await page.evaluate(() => {
      try { return window.Module.FS.readFile('/tmp/p5_fig.png').length; } catch (e) { return -1; }
    });
    const noctx = /p5-no-context|no context|ContextResult|blocklist/i.test(out);
    console.log(`${label}`);
    console.log(`  浏览器能力: webgl2=${caps.webgl2} webgl1=${caps.webgl1}`);
    console.log(`  toolkit 侧: no-context warning=${noctx}  MEMFS 里的 PNG 字节=${png}`);
    console.log(`  drawnow 输出: ${out.replace(/\s+/g, ' ').slice(0, 160)}`);
  } catch (e) {
    console.log(`${label}: 探针失败 ${String(e).slice(0, 120)}`);
  }
  await browser.close();
}
