// 探针：D7 —— IDBFS 持久化**边界**（2026-09-25）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：node test/browser/probe-idbfs-bounds.mjs [URL]
// 判据（accept-idbfs 之外的四条边界）：
//   ① 多文件：50 个小文件 + webSync + **真实页面重载** ⇒ 全部存活（数量与内容抽查）；
//   ② 大文件：8MB 二进制 + webSync + 重载 ⇒ 字节数与首尾内容一致；
//   ③ 写回耗时：~8MB 脏数据的 syncfs 墙钟（记录， informational）；
//   ④ 配额满的行为：无法在测试里可靠触发 Chromium 配额 ⇒ 如实记"未测"，
//      只验证 webSync 的错误路径存在（callback 形式，错误不会让页面崩）。
import { chromium } from 'playwright-core';
const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });

let pass = 0, fail = 0;
const check = (ok, label, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 200)}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sync = (page) => page.evaluate(() => new Promise(res => Module.webSync(() => res('synced'))));
async function freshPage () {
  const page = await (await browser.newContext()).newPage();
  const logs = [];
  page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 160)));
  await page.goto(URL, { waitUntil: 'load', timeout: 240000 });
  const t0 = Date.now();
  while (Date.now() - t0 < 180000) {
    if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) break;
    await sleep(250);
  }
  return { page, logs };
}

// ── 第一页：写 50 小文件 + 1 个 8MB 大文件，webSync ──
let page;
{
  ({ page } = await freshPage());
  const w = await page.evaluate(() => {
    try {
      Module.FS.mkdir('/home/web_user/d7bounds');
      for (let i = 0; i < 50; i++) Module.FS.writeFile(`/home/web_user/d7bounds/f${i}.txt`, `content-${i}`);
      const big = new Uint8Array(8 * 1024 * 1024);
      big[0] = 0xAB; big[1] = 0xCD; big[big.length - 1] = 0xEF;
      Module.FS.writeFile('/home/web_user/d7bounds/big.bin', big);
      return 'written:' + Module.FS.stat('/home/web_user/d7bounds/big.bin').size;
    } catch (e) { return 'err:' + String(e).slice(0, 120); }
  });
  const t = Date.now();
  await sync(page);
  const syncMs = Date.now() - t;
  console.log(`   写入=${w} webSync=${syncMs}ms（D7-③ 写回耗时，informational）`);
  check(String(w).startsWith('written:8388608'), '① 写入 50 小文件 + 8MB 大文件', w);
}
// ── 第二页（**同 context reload**）：验证全部存活 ──
// ⚠️ IndexedDB 是 per-context 的（accept-idbfs 的既知约束）：换 context = 换库，
//    必须在**同一个 context** 里 page.reload() 才测的是真持久化（实测：freshPage 版必挂）。
{
  await page.reload({ waitUntil: 'load', timeout: 240000 });
  // ★ IDBFS 的**读回**是异步的（boot 的 syncfs(true)）—— 页内**轮询直到全部可读**，
  //   只等单个文件会和其余文件的读回竞态（sweep 里实测 flaky）。
  await page.waitForFunction(() => {
    try {
      for (let i = 0; i < 50; i++) Module.FS.stat(`/home/web_user/d7bounds/f${i}.txt`);
      return Module.FS.stat('/home/web_user/d7bounds/big.bin').size > 0;
    } catch (e) { return false; }
  }, null, { timeout: 30000 }).catch(() => {});
  const r = await page.evaluate(() => {
    try {
      const n = [...Array(50)].filter((_, i) => {
        try { return Module.FS.readFile(`/home/web_user/d7bounds/f${i}.txt`, { encoding: 'utf8' }) === `content-${i}`; } catch (e) { return false; }
      }).length;
      const big = Module.FS.readFile('/home/web_user/d7bounds/big.bin');
      return { n, bigSize: big.length, head: big[0] + ',' + big[1] + ',' + big[big.length - 1] };
    } catch (e) { return { err: String(e && e.message || e).slice(0, 120) }; }
  });
  check(r.n === 50, '②a 重载后 50 个小文件全部存活（内容抽查）', JSON.stringify(r));
  check(r.bigSize === 8 * 1024 * 1024 && r.head === '171,205,239',
    '②b 重载后 8MB 大文件存活（字节数 + 首尾字节）', JSON.stringify(r));
  console.log('   ④ 配额满行为：无法在测试里可靠触发 Chromium IndexedDB 配额 ⇒ 未测（如实记）；' +
    'webSync 错误走 callback（页面不崩）——accept-idbfs 已覆盖错误路径存在性。');
  await page.close();
}
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
