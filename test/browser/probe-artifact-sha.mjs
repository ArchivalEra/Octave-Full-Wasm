// 探针：**产物 SHA 自证**（2026-09-25）—— 防"改完程序用旧产物跑测试"
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：node test/browser/probe-artifact-sha.mjs [URL] [期望wasm sha]
// 三层判据：
//   ① 页面自证：`window.__octaveWasmSha`（页面在 instantiateWasm 钩子里对**实际实例化**
//      的 wasm 字节算的 sha256）必须存在；
//   ② HTTP 层：从被测 URL fetch octave.wasm 算 sha ⇒ 必须等于页面自证 sha
//      （服务器吐的字节 == 页面实例化的字节，防缓存/服务漂移）；
//   ③ 期望层（可选，给第二个参数）：== 期望 sha（刚构建的产物；批次收尾用）。
import { chromium } from 'playwright-core';
const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const EXPECT = process.argv[3] || '';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
await page.goto(URL, { waitUntil: 'load', timeout: 240000 });
let t0 = Date.now();
while (Date.now() - t0 < 180000) {
  const s = await page.evaluate(() => window.__octaveWasmSha || null).catch(() => null);
  if (s) break;
  await new Promise(r => setTimeout(r, 300));
}
let pass = 0, fail = 0;
const check = (ok, label, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 200)}`); };

const pageSha = await page.evaluate(() => window.__octaveWasmSha || null).catch(() => null);
check(!!pageSha, '① 页面自证 sha 存在（页面实例化的字节）', pageSha || '缺席（页面没算？）');
if (pageSha) {
  // ★ B6 双档（2026-09-27）：**取页面真正实例化的那一份**（线程档在 `threads/` 下）。
  //   第一版写死 `fetch('octave.wasm')` ⇒ 带头站点上"HTTP 层"必然报红（拿根目录那份去比
  //   线程档页面自证的 sha，实测 http=1ed3e528… page=c2899a71…）—— 那是**探针自己的** bug。
  const laneDir = await page.evaluate(() => {
    try { return (window.__octaveCaps && window.__octaveCaps.lane && window.__octaveCaps.lane.dir) || ''; }
    catch (e) { return ''; }
  });
  const httpSha = await page.evaluate(async (d) => {
    const b = await (await fetch(d + 'octave.wasm')).arrayBuffer();
    const dg = await crypto.subtle.digest('SHA-256', b);
    return Array.prototype.map.call(new Uint8Array(dg), x => ('0' + x.toString(16)).slice(-2)).join('');
  }, laneDir);
  check(httpSha === pageSha, `② HTTP 层：fetch(${laneDir}octave.wasm) 的 sha == 页面自证 sha`,
        `http=${httpSha.slice(0, 16)}… page=${pageSha.slice(0, 16)}… dir=${laneDir || '(根)'}`);
  if (EXPECT && laneDir) {
    console.log(`   ③ 期望层：页面跑的是 **线程档**（${laneDir}）⇒ 传进来的期望 sha 是基础档的，本层跳过；`);
    console.log(`      两档各自的 sha 由 check-deploy-sha.sh（磁盘/HTTP/页面三层）在批次收尾核`);
  } else if (EXPECT) {
    check(pageSha === EXPECT.toLowerCase(), '③ 期望层：== 刚构建的产物', `page=${pageSha.slice(0, 16)}… expect=${EXPECT.slice(0, 16)}…`);
  } else {
    console.log(`   ③ 期望层：未给期望 sha（页面自证 = ${pageSha}）—— 批次收尾请传第二参数`);
  }
}
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
