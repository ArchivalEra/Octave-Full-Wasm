// 探针：**UI 真实站点复现 issue #5**（8868 = Octave-UI dist + 其 serve.py，与线上同构）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 目标：在 UI 站点上验证
//   ① boot 后 path/which(figure) —— plotbridge 在不在 path 前部；
//   ② 运行裸命令 title('t')/gcf() 是否崩（复现 issue #5）；
//   ③ [OCTAVE_WEB_PLOT] 标记来自 UI 的 SafePlotSinkPolyfill 还是 plotbridge。
//
// 用法：sh test/browser/run.sh test/browser/probe-ui-repro.mjs [URL]
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8868/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
const sleep = ms => new Promise(r => setTimeout(r, ms));

await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
await sleep(2000);

// UI 站点上 window.OctaveEmbed 由 bridge/octave-embed.js 提供
const hasEmbed = await page.evaluate(() => typeof window.OctaveEmbed !== 'undefined');
console.log('URL=' + URL);
console.log('window.OctaveEmbed 存在:', hasEmbed);
if (!hasEmbed) {
  console.log('★ 站点上没有 OctaveEmbed —— UI 可能用别的桥接方式；退出');
  await browser.close();
  process.exit(0);
}

// 手动 boot 一个 embed（与 UI WasmEmbedAdapter 相同的参数形状）
console.log('\n── boot embed（lane=wasm32-final）─────────────────────────────');
const boot = await page.evaluate(async () => {
  try {
    // ① 与 UI WasmEmbedAdapter 同款：先按 site-base 拼 base，再动态装 octave.js
    const globalBase = (document.querySelector('meta[name="site-base"]')?.getAttribute('content') || '/');
    const normalizedBase = globalBase.endsWith('/') ? globalBase : globalBase + '/';
    const base = normalizedBase + 'lanes/wasm32-final/';
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = base + 'octave.js';
      s.setAttribute('data-lane', 'wasm32-final');
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('load fail ' + s.src));
      document.head.appendChild(s);
    });
    // ② create
    const embed = await window.OctaveEmbed.create({
      base,
      mount: '#octave-raw-output',
      id: 'probe-repro',
      lane: { lane: 'base', dir: '', js: 'octave.js', wasm: 'octave.wasm', data: 'octave.data' },
    });
    window.__probeEmbed = embed;
    return { ok: true, base };
  } catch (e) { return { ok: false, err: String(e).slice(0, 300) }; }
});
console.log('boot:', JSON.stringify(boot).slice(0, 300));
if (!boot.ok) { await browser.close(); process.exit(0); }

// 等引擎就绪
for (let i = 0; i < 240; i++) {
  const ok = await page.evaluate(() => window.__octaveReady === true || (window.Module && window.Module.calledRun))
    .catch(() => false);
  if (ok) break;
  await sleep(500);
}
await sleep(1500);

// 从注册表拿 mod（embed 路径下 window.Module 不存在，模块是 MODULARIZE 的）
const modId = await page.evaluate(() => {
  const ent = (window.__octaveHosts || [])[0];
  if (!ent) return -1;
  window.__probeMod = ent.mod;
  return 0;
});
console.log('__octaveHosts 拿到 mod:', modId === 0 ? 'OK' : 'FAIL');
if (modId !== 0) { await browser.close(); process.exit(0); }

async function run (code, timeoutMs = 25000) {
  const s = '__P' + Math.random().toString(36).slice(2) + '__';
  logs.length = 0;
  try {
    await page.evaluate(([x, sn]) => window.__probeMod.eval_string(`${x}; disp('${sn}');`), [code, s]);
  } catch (e) { return { trap: true, out: '', err: String(e).slice(0, 200) }; }
  const t = Date.now();
  while (Date.now() - t < timeoutMs) { if (logs.some(l => l.includes(s))) break; await sleep(80); }
  return { trap: false, out: logs.join(' ').split(s)[0].replace(/\s+/g, ' ').trim(),
           err: await page.evaluate(() => window.__probeMod.last_error_message()).catch(() => '') };
}

console.log('\n── ① UI 站点 boot 后解析状态 ──────────────────────────────────');
let r = await run('disp(path())');
console.log('path:', (r.out || '').slice(0, 600));
for (const n of ['figure', 'plot', 'title', 'gcf']) {
  r = await run(`printf("%s -> %s\\n", '${n}', which('${n}'))`);
  console.log(`which(${n}):`, (r.out || r.err || '').slice(0, 200));
}

console.log('\n── ② 直接跑 issue #5 的命令（不装 polyfill，看引擎原生状态）────');
for (const [code, name] of [
  ['plot(0:1:10)', 'plot'],
  ['title("t")', 'title'],
  ['h = gcf()', 'gcf'],
  ['xlabel("x")', 'xlabel'],
  ['grid on', 'grid'],
  ['legend("a")', 'legend'],
  ['bar([1 2 3])', 'bar'],
  ['subplot(2,1,1); plot(1:10)', 'subplot'],
]) {
  const rr = await run(`try; ${code}; printf("OK %s\\n", '${name}'); catch e; printf("ERR %s: %s\\n", '${name}', e.message); end`);
  console.log(`  ${name.padEnd(8)} :: ${rr.trap ? '★TRAP' : (rr.out || rr.err || '(空)').slice(0, 200)}`);
  await run('close all; clear -f');
}

console.log('\n── ③ 检查 UI stub 是否已在 FS 里（UI 的 install 是否已跑过）────');
for (const f of ['/usr/src/octave/m/plot/util/figure.m', '/usr/src/octave/m/plot/draw/plot.m',
                 '/usr/src/octave/m/plot/draw/drawnow.m']) {
  let rr = await run(`n=exist('${f}'); s=dir('${f}'); printf("exist=%d size=%d\\n", n, numel(s))`);
  let head = '';
  try {
    head = await page.evaluate((f) => {
      try { return window.__probeMod.FS.readFile(f, { encoding: "utf8" }).slice(0, 120).replace(/\s+/g, " "); }
      catch (e) { return 'FS-ERR ' + e.message; }
    }, f);
  } catch {}
  console.log(`  ${f}\n     ${(rr.out || rr.err || '').slice(0, 80)}\n     head: ${head}`);
}

console.log('\n=== 探针结束 ===');
await browser.close();
