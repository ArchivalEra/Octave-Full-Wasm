// 探针：UI 站资产链失败根因（console + 直连 fetch 状态）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
// 用法：sh test/browser/run.sh test/browser/probe-ui-assets2.mjs [URL]
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8868/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push('[' + m.type() + '] ' + m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
page.on('requestfailed', r => logs.push('[reqfail] ' + r.url().slice(0, 160) + ' :: ' + (r.failure()?.errorText || '')));
page.on('response', r => { if (r.status() >= 400) logs.push('[http' + r.status() + '] ' + r.url().slice(0, 160)); });

const sleep = ms => new Promise(r => setTimeout(r, ms));
await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
await sleep(1200);

// 先直连 fetch 几个关键 URL（用页面自己的 origin）
const fetches = await page.evaluate(async () => {
  const urls = [
    '/repo/Octave/lanes/wasm32-final/assets/manifest.json',
    '/repo/Octave/lanes/wasm32-final/assets/manifest.w64.json',
    '/repo/Octave/lanes/wasm32-final/assets/m/plotbridge.js',
  ];
  const out = {};
  for (const u of urls) {
    try {
      const r = await fetch(u, { cache: 'no-store' });
      out[u] = 'HTTP ' + r.status + ' len=' + (await r.arrayBuffer()).byteLength;
    } catch (e) { out[u] = 'THROW ' + String(e).slice(0, 140); }
  }
  return out;
});
console.log('── 直连 fetch ────────────────────────');
for (const [k, v] of Object.entries(fetches)) console.log('  ', k, '=>', v);

const boot = await page.evaluate(async () => {
  try {
    const globalBase = (document.querySelector('meta[name="site-base"]')?.getAttribute('content') || '/');
    const base = (globalBase.endsWith('/') ? globalBase : globalBase + '/') + 'lanes/wasm32-final/';
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = base + 'octave.js';
      s.onload = () => resolve(); s.onerror = () => reject(new Error('load fail'));
      document.head.appendChild(s);
    });
    window.__probeEmbed = await window.OctaveEmbed.create({
      base, mount: '#octave-raw-output', id: 'asset-diag2',
      lane: { lane: 'base', dir: '', js: 'octave.js', wasm: 'octave.wasm', data: 'octave.data' },
    });
    return { ok: true };
  } catch (e) { return { ok: false, err: String(e).slice(0, 400) }; }
});
console.log('boot:', JSON.stringify(boot).slice(0, 300));

for (let i = 0; i < 240; i++) {
  const ok = await page.evaluate(() => {
    const ent = (window.__octaveHosts || [])[0];
    return !!(ent && ent.ready === true);
  }).catch(() => false);
  if (ok) break;
  await sleep(500);
}
await sleep(3000);

console.log('\n── 全部 console（前 120 条）──────────────────────────');
logs.slice(0, 120).forEach(l => console.log('  ', l.slice(0, 220)));

const state = await page.evaluate(() => {
  const ent = (window.__octaveHosts || [])[0];
  const mod = ent && ent.mod;
  const out = {};
  try { out.hasPlotbridgeFile = mod.FS.analyzePath('/usr/src/octave/m/plotbridge/plot.m').exists; } catch (e) { out.pbErr = String(e).slice(0, 120); }
  try { out.webassetsJson = mod.FS.readFile('/tmp/webassets.json', { encoding: 'utf8' }).slice(0, 300); } catch (e) { out.webassetsJson = 'MISSING'; }
  try { out.cwd = mod.cwd ? mod.cwd() : 'n/a'; } catch (e) {}
  try { out.path = mod.FS.readFile('/tmp/__path.txt', { encoding: 'utf8' }); } catch (e) {}
  return out;
});
console.log('\n── 状态 ─────────────────────────────────');
console.log(JSON.stringify(state, null, 1).slice(0, 900));

// 用 mod 直接查 path
const pathOut = await page.evaluate(() => {
  const ent = (window.__octaveHosts || [])[0];
  const mod = ent && ent.mod;
  if (!mod) return 'no mod';
  try { mod.eval_string("disp(path())"); } catch (e) { return 'eval err ' + e; }
  return 'ok';
});
console.log('path 触发:', pathOut);
await sleep(500);
console.log('\n── console 里含 assets/path 的行 ─────────────────');
logs.filter(l => /assets|plotbridge|webgraphics|清单|可用/.test(l)).slice(0, 40).forEach(l => console.log('  ', l.slice(0, 240)));

console.log('\n=== 探针结束 ===');
await browser.close();
