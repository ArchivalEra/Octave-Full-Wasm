// 胶水层"自带测试"（%!test）—— 浏览器侧验收
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/accept-selftest.mjs [URL]
//
// ── 这一套在验什么 ──────────────────────────────────────────────────────────
// 把**仓库里早就写好的** `%!test` 断言真正跑起来。它们分布在：
//     build/webfile/*.m   （10 个文件：copyfile/movefile/ls + __wf_* 助手）
//     build/pkgfix/*.m    （4 个有断言的：__pkgfix_basename__/forge_root/local_list/make_packinfo）
// 在这之前，全仓 `test/browser/*.mjs` **一次都没调用过 Octave 的 `test`** —— 那些断言
// （`cp -r` 的嵌套规则、rename 回退、packinfo 布局…）是"写了但不执行的债"。
//
// **目标名单只有一份**：`build/glue-selftest.m`（本套件把它的**源码**读进来 `eval_string`，
// 因为它在浏览器里不是文件而是 MEMFS 里的一堆 .m）。宿主侧同一份驱动由
// `build/glue-selftest.sh` 跑 —— 秒级，改胶水 `.m` 时先跑那个。
//
// ── 断言口径 ────────────────────────────────────────────────────────────────
// 逐目标断言"该文件的全部 %!test 都过"（`pass == total`），最后断言 TOTAL 行。
// **不静默跳过**：某个目标跑不起来（函数不在 path 上）时驱动会打 `error=`，这里记 fail。
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const DRIVER = '/mnt/hdd/zcode-projects/Octave-Full-Wasm/build/glue-selftest.m';

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
await sleep(500);
console.log(`URL=${URL}`);

// ★ 匹配规则（`.githooks/check-wants.py` 会查这一条）：**单个数字**的 want 按「数字边界」匹配，
//   不是裸子串 —— `want='0'` 绝不该被输出里的 `10`/`100`/`13` 满足（`accept-hdf5` 就这么
//   假过了几个月：它查的 `__have_hdf5__` 在 11.3.0 里根本不存在，靠加载器日志里的杂数字对上）。
//   **点也算边界字符**：捕获窗口里有 `11.3.0` 这类版本号，`want='0'` 不该被它最后那位满足
//   （探针 `test/browser/probe-want-matcher.mjs` 把这几条钉在真浏览器里）。
//   多字符 want 保持子串匹配（`'0.7071'`、`'100 100'` 已足够具体；而 Octave 打印 1.5 是
//   `1.5000`，对它用严格词边界反而会误红）。
function wantHit (hay, want) {
  if (/^\d$/.test(want)) return new RegExp('(?<![\\d.])' + want + '(?![\\d.])').test(hay);
  return hay.includes(want);
}

let pass = 0, fail = 0;
function check(ok, label, detail) {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label.padEnd(46)} :: ${detail ?? ''}`);
}

// ① 装资产：webfile（不在启动清单里）与 pkgfix（启动清单里有，显式装载更明确）
for (const a of ['webfile', 'pkgfix']) {
  const r = await page.evaluate(async (n) => {
    try { await window.OctaveAssets.load(n); return 'ok'; } catch (e) { return 'ERR ' + String(e); }
  }, a);
  check(r === 'ok', `★ 资产 ${a} 装载`, r);
}
// 影子是否真的生效：webfile 的 copyfile 必须盖住核心那个（exist=2 = .m 文件）
logs.length = 0;
await page.evaluate(() => window.Module.eval_string('disp(exist("copyfile"))'));
await sleep(400);
check(wantHit(logs.join(' '), '2'), '★ webfile 的 copyfile 已影子核心实现（exist=2）',
  logs.join(' ').trim().slice(-40));

// ② 把驱动源码读进来执行（它必须**没有函数定义**，才能 eval）
const src = readFileSync(DRIVER, 'utf8');
// 目标名单**从驱动里抠出来**（单一真源），本套件不再抄一份
const mTargets = src.match(/targets\s*=\s*\{([\s\S]*?)\}/);
const targets = mTargets ? [...mTargets[1].matchAll(/"([^"]+)"/g)].map(x => x[1]) : [];
check(targets.length >= 14, '★ 驱动里声明的目标数 ≥ 14（名单单一真源）',
  `${targets.length} 个：${targets.slice(0, 3).join('/')}…`);

logs.length = 0;
const rc = await page.evaluate((code) => window.Module.eval_string(code), src + ';\ndisp("SELFTEST_DONE");');
await sleep(1500);
const out = logs.join('\n');
const results = new Map();
for (const m of out.matchAll(/^RESULT\s+(\S+)\s+pass=(\d+)\s+total=(\d+)(?:\s+error=(.*))?$/gm)) {
  results.set(m[1], { pass: Number(m[2]), total: Number(m[3]), error: m[4] || '' });
}
check(rc === 0 && out.includes('SELFTEST_DONE'), '驱动执行完毕（rc=0 + 哨兵）', `rc=${rc}`);

// ③ 逐目标断言
for (const t of targets) {
  const r = results.get(t);
  check(!!r && !r.error && r.pass === r.total,
    `★ ${t} 的自带测试全过`,
    r ? (r.error ? `跑不起来：${r.error}` : `${r.pass}/${r.total}`) : '驱动没有报这个目标');
}

// ④ TOTAL 行 —— 全局口径（防止某个目标被漏报）
const tm = out.match(/^TOTAL pass=(\d+) total=(\d+) badfiles=(\d+)/m);
check(!!tm && tm[3] === '0' && tm[1] === tm[2], '★ TOTAL：全部断言通过且无坏文件',
  tm ? `pass=${tm[1]} total=${tm[2]} badfiles=${tm[3]}` : '没有 TOTAL 行');

check(!/\[pageerror\]|RuntimeError: unreachable/.test(out), '无整页 trap', 'ok');

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
