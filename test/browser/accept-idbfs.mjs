// 验收（小口子 6/7）：**持久化 IDBFS** + **FreeMono 家族**（都要重链才有的两件）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 为什么有它（2026-09-24 实测）：这两条原来被列成"不碰 wasm 的小口子"，一量才发现是**重链车道** ——
//   · IDBFS 必须显式 `-lidbfs.js`（否则 `FS.filesystems` 只有 MEMFS，`mount(IDBFS,…)` 一定失败）；
//   · FreeMono 是**预载**字体（要进 `--preload-file` 的清单）。
// 重链之后才有本套件能测的东西：
//   ① `FS.filesystems` 里有 IDBFS，`Module.webSync()` 存在（明确的写回点）；
//   ② `save('/home/web_user/x.mat')` + `webSync()` + **整页 reload** ⇒ `load` 取回同一个值；
//   ③ **负对照**：写到 `/tmp` 的东西 reload 之后**必须不在** —— 这一条是"真的重载了"的证据，
//      否则"reload 后还在"可能只是同一次会话里的假过；
//   ④ `listfonts()` 里有 **FreeMono**（等宽家族名不再静默落回 FreeSans）。
//
// ⚠️ 必须**同一个 context** 里 reload（context 换掉就等于换了 IndexedDB，测不到持久化）。
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/accept-idbfs.mjs [URL]
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext();

let pass = 0, fail = 0;
const check = (ok, label, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 190)}`); };
// 按行过滤 gl4es/WebGL 噪音（**别**用 `.replace(/LIBGL:[^|]*/g,'')`：日志里没有 `|`，会吃掉整段）
const clean = (l) => l.filter(x => !/^LIBGL:/.test(x) && !/^\[\.WebGL/.test(x) && !/^WebGL: INVALID/.test(x))
  .join(' ').replace(/\s+/g, ' ').trim();

async function open () {
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => logs.push(m.text()));
  page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 150)));
  await page.goto(URL, { waitUntil: 'load', timeout: 240000 });
  const t = Date.now();
  while (Date.now() - t < 300000) {
    if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) break;
    await new Promise(r => setTimeout(r, 200));
  }
  await new Promise(r => setTimeout(r, 1200));      // 等 syncfs(true) 把 IndexedDB 读回来
  return { page, logs };
}
async function ev (page, logs, code, sentinel = null, budget = 9000) {
  logs.length = 0;
  const r = await page.evaluate(x => ({ rc: window.Module.eval_string(x), err: window.Module.last_error_message() }), code);
  const t = Date.now();
  while (sentinel && Date.now() - t < budget && !sentinel.test(clean(logs))) await new Promise(rr => setTimeout(rr, 150));
  if (!sentinel) await new Promise(rr => setTimeout(rr, 700));
  return { rc: r.rc, err: r.err || '', out: clean(logs) };
}

// ── ① 能力面：IDBFS 编进来了、写回点存在 ────────────────────────────────────
let { page, logs } = await open();
const fsKeys = await page.evaluate(() => JSON.stringify(Object.keys(window.Module.FS.filesystems || {})));
check(/IDBFS/.test(fsKeys), '★ 产物里编入了 IDBFS（`-lidbfs.js` 生效；以前只有 MEMFS）', fsKeys);
check(await page.evaluate(() => typeof window.Module.webSync === 'function'),
  '★ 有**明确的写回点** `Module.webSync()`（不是"靠运气"）', 'typeof = ' + await page.evaluate(() => typeof window.Module.webSync));
check(logs.some(l => /\[idbfs\] 已读回/.test(l)), '开机把持久区读回来了（控制台有 [idbfs] 已读回）',
  logs.filter(l => /idbfs/.test(l)).join(' | ') || '(没有 idbfs 日志)');

// ── ② 写 → 同步 → **整页 reload** → 读回 ──────────────────────────────────
let r = await ev(page, logs, "x = 4242; save('/home/web_user/persist.mat', 'x'); fprintf('SAVED=%d\\n', exist('/home/web_user/persist.mat','file'))", /SAVED=/);
check(r.rc === 0 && /SAVED=2/.test(r.out), '前置：文件在**内存**文件系统里确实写出来了（否则后面的"还在"没有意义）', r.out);
r = await ev(page, logs, "y = 777; save('/tmp/notpersist.mat', 'y'); fprintf('TMP=%d\\n', exist('/tmp/notpersist.mat','file'))", /TMP=/);
check(r.rc === 0 && /TMP=2/.test(r.out), '负对照的前置：/tmp 那份也写出来了', r.out);
const syncErr = await page.evaluate(() => new Promise(res => window.Module.webSync(e => res(e ? String(e) : 'ok'))));
check(syncErr === 'ok', '★ `webSync()` 写回成功（IndexedDB）', syncErr);
await page.close();

({ page, logs } = await open());          // ← 同一个 context：整页重载
r = await ev(page, logs, "try; load('/home/web_user/persist.mat'); fprintf('X=%d\\n', x); catch e; fprintf('E=%s\\n', e.message); end", /X=|E=/);
check(r.rc === 0 && /X=4242/.test(r.out), '★ **刷新页面之后文件还在**（load 取回 x=4242）', r.out);
r = await ev(page, logs, "fprintf('TMPNOW=%d\\n', exist('/tmp/notpersist.mat','file'))", /TMPNOW=/);
check(r.rc === 0 && /TMPNOW=0/.test(r.out),
  '★ 负对照：`/tmp` 的东西**没了** ⇒ 证明确实整页重载过（不是同一次会话的假过）', r.out);

// ── ③ FreeMono 家族（重链预载的 4 个面）──────────────────────────────────
r = await ev(page, logs, "L = listfonts(); fprintf('NF=%d HASMONO=%d HASSANS=%d\\n', numel(L), any(strcmp(L,'FreeMono')), any(strcmp(L,'FreeSans')))", /NF=/);
check(r.rc === 0 && /HASMONO=1/.test(r.out) && /HASSANS=1/.test(r.out),
  '★ `listfonts()` 里同时有 FreeSans 与 **FreeMono**（以前只有 FreeSans）', r.out);

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
console.log('（持久化那几条必须在**同一个 context** 里 reload —— 换 context 就等于换 IndexedDB）');
await browser.close();
process.exit(fail ? 1 : 0);
