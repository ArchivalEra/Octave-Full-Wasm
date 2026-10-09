// 探针：UI 站资产装载链诊断（为什么 path() 缺 plotbridge/webgraphics/webshims）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
// 用法：sh test/browser/run.sh test/browser/probe-ui-assets.mjs [URL]
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8868/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
page.on('requestfailed', r => logs.push('[reqfail] ' + r.url().slice(0, 140) + ' :: ' + (r.failure()?.errorText || '')));
page.on('response', r => { if (r.status() >= 400) logs.push('[http' + r.status() + '] ' + r.url().slice(0, 140)); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
await sleep(1500);

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
      base, mount: '#octave-raw-output', id: 'asset-diag',
      lane: { lane: 'base', dir: '', js: 'octave.js', wasm: 'octave.wasm', data: 'octave.data' },
    });
    return { ok: true, base };
  } catch (e) { return { ok: false, err: String(e).slice(0, 400) }; }
});
console.log('boot:', JSON.stringify(boot).slice(0, 300));

// 等就绪
for (let i = 0; i < 240; i++) {
  const ok = await page.evaluate(() => {
    const ent = (window.__octaveHosts || [])[0];
    return !!(ent && ent.ready === true);
  }).catch(() => false);
  if (ok) break;
  await sleep(500);
}
await sleep(2500);   // 多等：资产链在 onReady 前跑完

console.log('\n── console 消息（关键：assets 相关）────────────────────────────');
for (const l of logs) if (/assets|asset|plotbridge|webgraphics|pkgfix|webshims|清单|装载|fail|err/i.test(l)) {
  console.log('  ', l.slice(0, 220));
}

const state = await page.evaluate(async () => {
  const ent = (window.__octaveHosts || [])[0];
  const mod = ent && ent.mod;
  const out = {};
  out.hostReady = ent && ent.ready;
  out.hasAssetsGlobal = typeof window.OctaveAssets !== 'undefined';
  out.hasLanePlan = !!window.__octaveLanePlan;
  out.lanePlan = window.__octaveLanePlan;
  try { out.assetsList = window.OctaveAssets && window.OctaveAssets.list(); } catch (e) { out.assetsListErr = String(e).slice(0, 120); }
  try { out.assetsLoaded = window.OctaveAssets && window.OctaveAssets.loaded(); } catch (e) {}
  if (mod) {
    try { out.webassetsJson = mod.FS.readFile('/tmp/webassets.json', { encoding: 'utf8' }).slice(0, 600); } catch (e) { out.webassetsJsonErr = String(e).slice(0, 120); }
    try { out.path = mod.eval_string('disp(path())') , out.path = mod.FS.readFile('/tmp/_nul', {encoding:'utf8'}); } catch (e) {}
  }
  return out;
});
console.log('\n── 状态 ─────────────────────────────────────────────────────');
console.log(JSON.stringify(state, null, 1).slice(0, 1600));

// 试试资产装载器是否可用 + 手动装 plotbridge
const manual = await page.evaluate(async () => {
  try {
    if (!window.OctaveAssets) return { err: 'OctaveAssets 不存在' };
    await window.OctaveAssets.init();
    const names = window.OctaveAssets.list();
    return { ok: true, count: names.length, names: names.slice(0, 40) };
  } catch (e) { return { err: String(e).slice(0, 300) }; }
});
console.log('\n── OctaveAssets.init() 手动 ──────────────────────────────────');
console.log(JSON.stringify(manual).slice(0, 1200));

console.log('\n=== 探针结束 ===');
await browser.close();
