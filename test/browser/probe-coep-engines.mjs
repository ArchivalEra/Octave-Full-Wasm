// 探针：三引擎对 COEP `credentialless` 的支持（C8 的引擎能力底座，2026-09-26）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 为什么要有它：`probe-coi-sw.mjs` 测出"firefox/webkit 的 CDN 脚本被拦"，但那可能来自
// coi-serviceworker 的 `coepDegrade`（首次受控加载拿不到 COI 就自动降级 require-corp），
// **不能直接归因于引擎不支持 credentialless**。这里用**静态响应头**（不经过 SW）把两件事
// 分开：引擎到底认不认 `COEP: credentialless`。
// 每格记录：crossOriginIsolated、typeof SharedArrayBuffer、**跨源无 CORP 脚本**是否加载。
// 三引擎：chromium（系统）/ firefox / webkit（playwright 托管，需 PLAYWRIGHT_BROWSERS_PATH）。
import { chromium, firefox, webkit } from 'playwright-core';
import { createServer } from 'node:http';

const MODES = {
  'require-corp':  { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
  'credentialless':{ 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' },
  'none(对照)':    {},
};
let CDN_PORT = 0;
const page = (mode) => `<!doctype html><meta charset="utf-8"><title>${mode}</title>
<script>window.__cdnOK=false;</script>
<script src="http://127.0.0.1:${CDN_PORT}/lib.js"></script><body>${mode}</body>`;

const srv = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const mode = u.searchParams.get('mode') || 'none(对照)';
  res.writeHead(200, Object.assign({ 'Content-Type': 'text/html' }, MODES[mode] || {}));
  res.end(page(mode));
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;
const cdn = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/javascript' });
  res.end('window.__cdnOK = true;');   // 无 CORP、无 crossorigin ⇒ 纯 CDN 形态
});
await new Promise(r => cdn.listen(0, '127.0.0.1', r));
CDN_PORT = cdn.address().port;

const ENGINES = [
  ['chromium', () => chromium.launch({ executablePath: '/usr/bin/chromium',
      args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] })],
  ['firefox', () => firefox.launch()],
  ['webkit', () => webkit.launch()],
];

const res = {}; let na = 0;
for (const [name, launch] of ENGINES) {
  let br;
  try { br = await launch(); } catch (e) {
    na++; console.log(`N/A  | ${name}：引擎不可用（${String(e).split('\n')[0].slice(0, 70)}）`); continue;
  }
  res[name] = {};
  for (const mode of Object.keys(MODES)) {
    const p = await (await br.newContext()).newPage();
    await p.goto(`http://127.0.0.1:${PORT}/?mode=${encodeURIComponent(mode)}`, { waitUntil: 'load', timeout: 30000 });
    await p.waitForTimeout(300);
    const m = await p.evaluate(() => ({ coi: self.crossOriginIsolated, sab: typeof SharedArrayBuffer, cdn: window.__cdnOK === true }));
    res[name][mode] = m;
    console.log(`     ${name.padEnd(8)} ${mode.padEnd(15)} COI=${String(m.coi).padEnd(5)} SAB=${String(m.sab).padEnd(9)} 跨源无CORP脚本=${m.cdn ? '✓加载' : '✗被拦'}`);
    await p.close();
  }
  await br.close();
}

console.log('\n──── 断言（可证伪）────');
let pass = 0, fail = 0;
const check = (ok, label, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${detail}`); };
for (const e of Object.keys(res)) {
  const n = res[e]['none(对照)'], r = res[e]['require-corp'], c = res[e]['credentialless'];
  check(n && n.coi === false && n.cdn === true, `${e}：无头 ⇒ 无 COI 且 CDN 照常`, JSON.stringify(n));
  check(r && r.coi === true && r.cdn === false, `${e}：require-corp ⇒ COI 成立但**CDN 被拦**`, JSON.stringify(r));
  // credentialless：引擎是否认它 —— 认 ⇒ COI 且 CDN 该加载；不认 ⇒ COI 假（或与 require-corp 同表现）
  console.log(`  ★ ${e.padEnd(8)} credentialless ⇒ COI=${c && c.coi} / CDN=${c && c.cdn ? '加载' : '被拦'}  ` +
    `${c && c.coi && c.cdn ? '【支持】' : (c && !c.coi ? '【不支持：COI 都没拿到】' : '【认了 header 但不给 CDN 放行】')}`);
}
console.log('\n──── 引擎能力底座（C8 的结论表）────');
for (const e of Object.keys(res)) {
  const c = res[e]['credentialless'];
  const verdict = c && c.coi && c.cdn ? 'credentialless 可用（CDN 与 COI 兼得）'
    : (c && !c.coi ? 'credentialless 无效（拿不到 COI）' : 'header 被接受但 CDN 仍被拦');
  console.log(`  ${e.padEnd(9)} ${verdict}`);
}
console.log(`\n=== ${pass} PASS / ${fail} FAIL${na ? ` / ${na} N/A` : ''} ===`);
// ★ A3：再打一行**规范格式**（`=== N PASS / M FAIL ===`）—— 仓库外的旧 sweep 只认这一种，
//   上面那行带 ` / N N/A` 会让它解析不到（实测被记成 NO-SUMMARY）。规范行放最后（扫描取末条）。
console.log(`=== ${pass} PASS / ${fail} FAIL ===`);
srv.close(); cdn.close();
process.exit(fail ? 1 : 0);
