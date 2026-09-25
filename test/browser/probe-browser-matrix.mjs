// 探针：**浏览器矩阵**（2026-09-25）—— 同一产物跨引擎/跨版本的行为一致性
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：node test/browser/probe-browser-matrix.mjs <chromium|firefox> [URL]
//   · chromium 分支用系统 /usr/bin/chromium；firefox 分支用 playwright 托管的
//     Firefox（`cli.js install firefox`，装在 ~/.cache/ms-playwright，不碰系统浏览器）。
//   · 有 JSPI ⇒ 交互链必须真通（pause 让出 + 冒烟 pass）；
//     无 JSPI ⇒ 优雅降级（门如实 api-missing/no-entry + 解释器照常）。
//   · 无 JSPI 的**真**浏览器另见容器方案（zenika/alpine-chrome:123 + CDP，HISTORY §5.52）。
import { chromium, firefox } from 'playwright-core';
const KIND = process.argv[2] || 'chromium';
const URL = process.argv[3] || 'http://127.0.0.1:8761/';
const browser = await (KIND === 'firefox' ? firefox.launch() : chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'],
}));
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 160)));
page.on('console', m => { if (/error|FATAL/i.test(m.text())) logs.push('[c] ' + m.text().slice(0, 120)); });
await page.goto(URL, { waitUntil: 'load', timeout: 240000 });
let t0 = Date.now();
let ready = false;
while (Date.now() - t0 < 120000) {
  if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) { ready = true; break; }
  await new Promise(r => setTimeout(r, 250));
}
let pass = 0, fail = 0;
const check = (ok, label, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 180)}`); };
check(ready, `${KIND}: 页面就绪（__octaveReady）`, ready);
if (ready) {
  const boot = await page.evaluate(() => ({ rc: Module.eval_string('disp(2+2)'), sha: window.__octaveWasmSha ? window.__octaveWasmSha.slice(0, 12) : null }));
  check(boot.rc === 0, `${KIND}: 解释器可算（2+2）`, JSON.stringify(boot));
  check(!!boot.sha, `${KIND}: 页面 wasm 自证 sha 存在`, boot.sha);
  const cap = await page.evaluate(() => ({
    suspending: typeof WebAssembly.Suspending === 'function',
    promising: typeof WebAssembly.promising === 'function',
    evalAsync: typeof Module.eval_async,
    gate: window.__octaveJspi ? window.__octaveJspi.smoke : 'no-gate',
  }));
  console.log(`   ${KIND} 能力: ${JSON.stringify(cap)}`);
  if (cap.suspending && cap.promising && cap.evalAsync === 'function') {
    // 有 JSPI ⇒ 交互链必须真通
    const a = await page.evaluate(async () => {
      const t = performance.now();
      const before = Module.__tick || 0;
      let val, err = null;
      try { val = await Module.eval_async('pause(0.2); 43'); } catch (e) { err = String(e).slice(0, 120); }
      return { val, err, wall: Math.round(performance.now() - t), ticks: (Module.__tick || 0) - before };
    });
    check(a.err === null && Number(a.val) === 0 && a.wall >= 200 && a.ticks > 0,
      `${KIND}: ★ pause 真让出（rc 0 / ≥200ms / tick>0）`, JSON.stringify(a));
    const g = await page.evaluate(async () => {
      try { return await window.__octaveJspiProbe(8000); } catch (e) { return 'throw:' + String(e).slice(0, 80); }
    });
    check(g === 'pass' || g === 'pass-blocking', `${KIND}: ★ 能力门冒烟`, `smoke=${g}`);
  } else {
    // 无 JSPI ⇒ 优雅降级：核心能算 + 门如实报 api-missing
    const g = window ? await page.evaluate(() => window.__octaveJspiProbe ? window.__octaveJspiProbe(3000) : 'no-probe') : '';
    check(g === 'api-missing' || g === 'no-entry', `${KIND}: ★ 无 JSPI ⇒ 门如实报 api-missing/no-entry（降级）`, `smoke=${g}`);
    const still = await page.evaluate(() => { try { return Module.eval_string('1+1'); } catch (e) { return 'throw'; } });
    check(still === 0, `${KIND}: ★ 降级下解释器照常工作`, `rc=${still}`);
  }
} else {
  check(false, `${KIND}: 页面没起来`, 'browser matrix fail');
}
logs.slice(0, 4).forEach(l => console.log('  ' + l));
console.log(`\n=== ${KIND}: ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
