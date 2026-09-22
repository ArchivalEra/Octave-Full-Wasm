// T2 图形句柄探针（跑 test/browser/fixtures/t2-graphics-probe.m）
// 为什么要"从文件读脚本再写进 FS"：多行 Octave 代码塞进 JS 字符串要过两层转义，
// 第一版就是被这个坑掉的（syntax error near line 54）。脚本独立成文件后，
// 引号/续行/注释全部自由，改探针不用碰 JS。
//
// 用法：harness/run.sh test/browser/probe-t2-run.mjs [URL]
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = readFileSync(join(HERE, 'fixtures', 't2-graphics-probe.m'), 'utf8');

const URL = process.argv[2] || 'http://127.0.0.1:8762/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
const sleep = ms => new Promise(r => setTimeout(r, ms));

await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
for (let i = 0; i < 300; i++) {
  const ok = await page.evaluate(() => window.__octaveReady === true).catch(() => false);
  if (ok) break; await sleep(500);
}
await sleep(800);
console.log(`URL=${URL}`);

const sentinel = '__T2' + Math.random().toString(36).slice(2) + '__';
logs.length = 0;
let trap = false;
try {
  await page.evaluate((c) => { window.Module.FS.writeFile('/tmp/t2probe.m', c); }, SCRIPT);
  await page.evaluate(([sn]) => window.Module.eval_string(`run('/tmp/t2probe.m'); disp('${sn}');`), [sentinel]);
} catch (e) { trap = true; console.log('★TRAP: ' + String(e).slice(0, 180)); }
const t = Date.now();
while (!trap && Date.now() - t < 90000) { if (logs.some(l => l.includes(sentinel))) break; await sleep(100); }

for (const l of logs.join('\n').split('\n')) {
  const s = l.trim();
  if (/^(avail=|[A-Z][0-9]?\)|error|.*ERR:)/.test(s)) console.log('   ' + s.slice(0, 180));
}
console.log(trap ? '\n=== 探针以 trap 结束 ===' : '\n=== 探针结束 ===');
await browser.close();
