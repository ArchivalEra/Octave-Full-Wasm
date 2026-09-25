// 探针：D6 —— `pkg load <未装载的包>` 自动装载（2026-09-25）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：node test/browser/probe-pkg-d6.mjs [URL]
// 背景：网页版的包管理器是页面资产装载器；核心 `pkg.m` 的数据库只看磁盘。
//   webshims/pkg.m shim 拦截 `pkg load <名>`：包在清单里但未装载 ⇒ `__web_run_js__`
//   触发 `OctaveAssets.load` + `__web_pause_ms__` 轮询等落盘 ⇒ 委托核心 pkg 走官方路径。
// 判据：
//   ① `__webassets_pending__()` 给出待装包名单（≥1）；
//   ② `pkg load statistics` ⇒ rc 0（自动 fetch + 写盘 + 数据库/路径就绪）；
//   ③ 装载后 statistics 的函数真可用（geomean([1 2 4]) = 2）；
//   ④ `which('pkg')` 指向 webshims 的 shim（D6 的机制在位）。
import { chromium } from 'playwright-core';
const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });

let pass = 0, fail = 0;
const check = (ok, label, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 220)}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const page = await (await browser.newContext()).newPage();
await page.goto(URL, { waitUntil: 'load', timeout: 240000 });
let t0 = Date.now();
while (Date.now() - t0 < 120000) {
  if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) break;
  await sleep(200);
}

// ④ 机制在位（先于装载断言，避免装载改变 which 语义的误读）
await page.evaluate(() => Module.eval_async("fid=fopen('/tmp/d6w.txt','w'); fprintf(fid,'%s',which('pkg')); fclose(fid); 0"));
const whichPkg = await page.evaluate(() => Module.FS.readFile('/tmp/d6w.txt', { encoding: 'utf8' }));
check(/webshims\/pkg\.m/.test(whichPkg), '④ which(pkg) 指向 webshims 的 shim（D6 机制在位）', whichPkg);

// ① 待装名单
await page.evaluate(() => Module.eval_async("fid=fopen('/tmp/d6p.txt','w'); fprintf(fid,'%s', strjoin(__webassets_pending__(), ' ')); fclose(fid); 0"));
const pend = await page.evaluate(() => Module.FS.readFile('/tmp/d6p.txt', { encoding: 'utf8' }));
const pendNames = pend.trim().split(/\s+/).filter(Boolean);
check(pendNames.length >= 1, '① `__webassets_pending__()` 给出待装包名单', `${pendNames.length} 个：${pend.trim().slice(0, 100)}`);

// ②③ pkg load statistics 自动装载 + 函数可用
const r = await page.evaluate(async () => {
  try {
    const rc1 = await Module.eval_async('pkg load statistics; 0');
    const rc2 = await Module.eval_async("g = geomean([1 2 4]); fid=fopen('/tmp/d6g.txt','w'); fprintf(fid,'geomean=%.4f', g); fclose(fid); 0");
    return { rc1, rc2, out: Module.FS.readFile('/tmp/d6g.txt', { encoding: 'utf8' }) };
  } catch (e) { return { rc1: 'throw', rc2: '', out: String(e).slice(0, 140) }; }
});
check(r.rc1 === 0, '② `pkg load statistics` ⇒ rc 0（自动 fetch + 写盘 + 走核心 pkg）', `rc1=${r.rc1}`);
check(r.rc2 === 0 && /geomean=2\.0000/.test(r.out), '③ 装载后包函数真可用（geomean([1 2 4]) = 2）', r.out);

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
