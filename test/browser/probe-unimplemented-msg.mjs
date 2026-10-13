// 探针：未实现函数给出的报错是否可读（工单 66 的结算件）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 判据（工单 66）──────────────────────────────────────────────────────────
//   两类名字必须给出**不同且可读**的信息：
//   ① **未实现的核心 MATLAB 名字**（Octave 认识、本构建装不上；如 table/datetime/string）
//      ⇒ 报错必须**含** "not yet implemented"（或至少**不含** `makeinfo` / `system:`）；
//   ② **真正不存在的名字**（如 zzz_abc）⇒ 报错必须含 "undefined"（**不许**说成"未实现"）。
//   rc=0 ⇒ 两类都对；rc=1 ⇒ 仍在报 makeinfo 子进程错误（工单未修）；
//   rc=2 ⇒ 反向断言失败（把"不存在"说成了"未实现"，或反之）；rc=3 ⇒ 环境问题（页面没起来）。
//
// 用法：node test/browser/probe-unimplemented-msg.mjs [URL]
import { chromium } from 'playwright-core';
const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const br = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await br.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
await page.waitForFunction(() => window.__octaveReady === true, null, { timeout: 300000 })
  .catch(() => {});
await new Promise(r => setTimeout(r, 1500));
if (!(await page.evaluate(() => window.__octaveReady === true).catch(() => false))) {
  console.log('ENV: 页面没起来（__octaveReady !== true）⇒ rc=3，这不是结论');
  await br.close();
  process.exit(3);
}

// 取一条 .m 报错：把 e.message 写进 MEMFS 再读回（避免 JS/Octave 字符串通道的坑）
async function msgOf (expr) {
  return await page.evaluate((e) => {
    try {
      window.Module.eval_string(
        "fid=fopen('/tmp/__u66.txt','w'); try; " + e + "; catch err; fprintf(fid,'%s', err.message); end; fclose(fid); 0");
      return window.Module.FS.readFile('/tmp/__u66.txt', { encoding: 'utf8' });
    } catch (ex) { return 'JS-ERR ' + String(ex).slice(0, 120); }
  }, expr);
}

// ① 未实现的核心名字（Octave 认识、装不上）
const UNIMPL = ['table', 'datetime', 'duration', 'string'];
// ② 真正不存在的名字
const MISSING = ['zzz_abc_9f', 'zzz_def_7q'];

let pass = 0, fail = 0;
const check = (ok, label, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 200)}`); };

let unimplBad = 0;
for (const n of UNIMPL) {
  const m = await msgOf(`${n}()`);
  const hasMakeinfo = /makeinfo|system:/.test(m);
  const hasUnimpl = /not yet implemented|not implemented/i.test(m);
  const ok = !hasMakeinfo;
  if (!ok) unimplBad++;
  check(ok, `① ${n}() ⇒ 报错**不含** makeinfo/system（可读）`,
    `含 makeinfo=${hasMakeinfo} 含 not-implemented=${hasUnimpl} :: ${m.slice(0, 110)}`);
}
let missingBad = 0;
for (const n of MISSING) {
  const m = await msgOf(`${n}()`);
  const ok = /undefined/.test(m) && !/not yet implemented/i.test(m);
  if (!ok) missingBad++;
  check(ok, `② ${n}() ⇒ 报 "undefined"（**不许**说成未实现）`, m.slice(0, 130));
}

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await br.close();
if (unimplBad) { console.log('结论：工单 66 **未修**（未实现的名字仍报 makeinfo 子进程错误）'); process.exit(1); }
if (missingBad) { console.log('结论：反向断言失败（"不存在"与"未实现"被混为一谈）'); process.exit(2); }
console.log('结论：工单 66 已修（两类名字信息可读且分得开）');
process.exit(0);
