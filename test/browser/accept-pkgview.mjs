// 验收（小口子 4）：**可用包可见性** —— 账本、待装名单、以及"装完 pkg 就认识它"
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 为什么有它（2026-09-24 实测）：本构建的能力一半在 `assets/` 里**按需装载**，但解释器看不见
// JS 的加载器对象 ⇒ `pkg load statistics` 只回一句 **"package statistics is not installed"**
// （statistics 明明就在 assets/pkg/ 里等着被装），而 `pkg list` 恒说 "no packages installed"
// —— 因为 pkg 的数据库是**启动时**从磁盘现状生成的一次快照。
//
// 本套件钉三件事：
//   ① 账本（`bridge/assets-loader.js` 落 /tmp/webassets.json）能被 Octave 侧读到，
//      且与 JS 侧 `OctaveAssets.list()` **数量对得上**（两个视角不许各说各话）；
//   ② "可加载但尚未装载"的**包**名单正确（排除基础设施资产与 `*-oct` 伴随件）；
//   ③ **装完就认识**：`OctaveAssets.load('statistics')` 之后 pkg 数据库自动重对齐 ⇒
//      `pkg list` 看得到、`pkg load statistics` 成功、`normpdf` 真能算。
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/accept-pkgview.mjs [URL]
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 200)));
await page.goto(URL, { waitUntil: 'load', timeout: 240000 });
const t0 = Date.now();
while (Date.now() - t0 < 300000) {
  if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) break;
  await new Promise(r => setTimeout(r, 200));
}
console.log(`URL=${URL} ready=${((Date.now() - t0) / 1000).toFixed(1)}s`);

let pass = 0, fail = 0;
const check = (ok, label, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 200)}`); };
// 按行过滤 gl4es 噪音（**别**用 `replace(/LIBGL:[^|]*/g,'')`：日志里没有 `|`，那会把整段吃掉）
const clean = (l) => l.filter(x => !/^LIBGL:/.test(x) && !/^\[\.WebGL/.test(x) && !/^WebGL: INVALID/.test(x))
  .join(' ').replace(/\s+/g, ' ').trim();

async function ev (expr, label, want) {
  logs.length = 0;
  let r;
  try {
    r = await Promise.race([
      page.evaluate(x => ({ rc: window.Module.eval_string(x), err: window.Module.last_error_message() }), expr),
      new Promise((_, rej) => setTimeout(() => rej(new Error('__HANG__')), 20000)),
    ]);
  } catch (e) { console.log(`CRASH | ${label} :: ${String(e).slice(0, 120)}`); fail++; return ''; }
  const t = Date.now();
  while (want && Date.now() - t < 9000 && !want.test(clean(logs))) { await new Promise(rr => setTimeout(rr, 150)); }
  const out = clean(logs);
  const ok = r.rc === 0 && (!want || want.test(out));
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${out.slice(0, 190) || ('rc=' + r.rc + ' ' + String(r.err).slice(0, 120))}`);
  return out;
}

// ── ① 账本：Octave 侧读得到，且与 JS 侧数量一致 ─────────────────────────────
const jsAvail = await page.evaluate(() => window.OctaveAssets.list().length);
const jsLoaded = await page.evaluate(() => window.OctaveAssets.loaded().length);
const out1 = await ev('a = __webassets_available__(); fprintf("AVAIL=%d LOADED=%d\\n", numel(a), numel(__webassets_info__().loaded))',
  '★ 账本读得到（`__webassets_available__()` / `__webassets_info__()`）', /AVAIL=\d+/);
check(new RegExp(`AVAIL=${jsAvail} LOADED=${jsLoaded}`).test(out1),
  '★ Octave 视角与 JS 视角**数量一致**（`OctaveAssets.list()` vs `__webassets_available__()`）',
  `js avail=${jsAvail} loaded=${jsLoaded} :: ${out1}`);

// ── ② "可加载但尚未装载"的**包**名单 ───────────────────────────────────────
const out2 = await ev('p = __webassets_pending__(); fprintf("N=%d LIST=%s\\n", numel(p), strjoin(p,","))',
  '待装包名单（`__webassets_pending__()`）', /N=\d+/);
check(/N=[1-9]/.test(out2) && /statistics/.test(out2),
  '★ 启动时就能说清"哪些包可加载但未装载"（含 statistics）', out2);
check(!/plotbridge|doc-cache|pkgfix/.test(out2),
  '★ 名单里**没有基础设施资产**（plotbridge/doc-cache/pkgfix 不是"包"）', out2);
check(!/-oct/.test(out2),
  '★ 名单里**没有 `*-oct` 伴随件**（它们是包的编译件，跟着包一起装）', out2);

// ── ③ 装完就认识：数据库自动重对齐 ─────────────────────────────────────────
await ev('pkg list', '装载前的 `pkg list`（对照：此时不该有 statistics）', /packages? installed|no packages/);
const before = await ev('disp(sprintf("BEFORE=%d", any(strcmp(__webassets_pending__(), "statistics"))))',
  '交底：装载前 statistics 在待装名单里', /BEFORE=1/);
check(/BEFORE=1/.test(before), '交底：装载前 `statistics` 确实"未装载"', before);

await page.evaluate(() => window.OctaveAssets.load('statistics'));
await new Promise(r => setTimeout(r, 2500));      // 等 loader 的 publish + pkg 数据库重对齐

const after = await ev('disp(sprintf("AFTER=%d", any(strcmp(__webassets_pending__(), "statistics"))))',
  '装载后它从待装名单里消失', /AFTER=0/);
check(/AFTER=0/.test(after), '★ 装载后 `statistics` 不再出现在待装名单', after);

const plist = await ev('pkg list', '★ 装载后 `pkg list` **看得到** statistics（数据库自动重对齐）', /statistics/);
check(/statistics/.test(plist), '★ `pkg list` 真的列出了 statistics（不再说 no packages installed）', plist);

const pload = await ev('try; pkg load statistics; disp("LOADED-OK"); catch e; disp(["E: " e.message]); end',
  '★ `pkg load statistics` 成功（以前说 is not installed）', /LOADED-OK/);
check(/LOADED-OK/.test(pload), '★ `pkg load statistics` 成功', pload);

const calc = await ev("disp(sprintf('NORMPDF=%.6f', normpdf(0,0,1)))",
  '★ 装完真能用：`normpdf(0,0,1)` = 0.398942', /NORMPDF=0\.398942/);
check(/NORMPDF=0\.398942/.test(calc), '★ statistics 的核心函数真能算', calc);

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
