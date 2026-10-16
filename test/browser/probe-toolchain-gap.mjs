// 工单 65 结算件：clang-wasm 工具链驱动 → 本仓宿主的**两条接入缺口**判据（2026-10-16）
// Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：sh test/browser/run.sh test/browser/probe-toolchain-gap.mjs <URL> [<模块目录>]
//   <URL>      宿主站点（默认 http://127.0.0.1:8761/）—— 页面按 COI×m64 选档，须是 w64 档
//   <模块目录> 已编好的两个探针 `p-throw.oct` / `p-nothrow.oct` 所在目录（默认 /tmp）
//
// rc 契约（工单 65 头部的 `**Settling:**` 行，逐条对齐）：
//   rc=0 ⇒ 两条缺口都已修（模块 dlopen 成功且真调用 probe_f(20+2)==22）
//   rc=1 ⇒ 缺口 1（TLS `_emscripten_tls_init` 未定义 ⇒ tlsInitFunc is not a function）仍在
//   rc=2 ⇒ 缺口 2（基本类型 typeinfo `_ZTIi` 不可解析 ⇒ reading 'value'）仍在
//   rc=3 ⇒ 环境问题（宿主自带夹具都装不上 / 页面没起来），不是缺口结论
//
// 判据形态（与 `build/113/ISSUE-1-verify-comment.md` 的复验同款）：
//   ① `Module.loadDynamicLibrary(<path>, {loadAsync:false})` —— 与 Octave dlopen 走同一路径；
//   ② 调**导出函数**（不是 DEFUN_DLD）：探针是 side-module 层的裸函数
//      （工单的最小复现就是这么给的）⇒ 直接 `inst.exports.probe_f(22)`。
//   ⚠️ 不写成 DEFUN_DLD：那是"真 .oct"层的事，与本工单两条 ABI 缺口（TLS/typeinfo）无关。
//
// ⚠️ **一个模块 = 一次全新页面**（本仓实测铁律）：同一页连续 `loadDynamicLibrary` 两次会因
//    加载器内部状态给出不一致结果（第一次就这样把真失败误判成 OK）。
import { chromium } from 'playwright-core';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const MODDIR = process.argv[3] || '/tmp';
const THROW_OCT = join(MODDIR, 'p-throw.oct');
const NOTHROW_OCT = join(MODDIR, 'p-nothrow.oct');

for (const f of [THROW_OCT, NOTHROW_OCT]) {
  if (!existsSync(f)) {
    console.log(`FATAL: 缺探针 ${f} —— 编法见工单 65「最小复现」（**必须 per-arch sysroot 形态**，`
      + `单 tar 会被驱动 precheck 拒）。`);
    process.exit(3);
  }
}

/** 一个模块 = 一次全新页面。返回观察（不抛）。 */
async function tryLoad (browser, octPath, expectVal) {
  const bytes = readFileSync(octPath);
  const page = await (await browser.newContext()).newPage();
  const obs = { ok: false, lane: null, dlopen: null, err: null, val: null };
  try {
    await page.goto(URL, { waitUntil: 'load', timeout: 240000 });
    await page.waitForFunction(() => window.__octaveReady === true, null, { timeout: 240000 })
      .catch(() => {});
    if (!await page.evaluate(() => window.__octaveReady === true)) {
      obs.err = 'page-not-ready'; return obs;
    }
    obs.lane = await page.evaluate(() =>
      (window.__octaveCaps && window.__octaveCaps.lane && window.__octaveCaps.lane.chosen) || null);
    const r = await page.evaluate(async ({ b64 }) => {
      const out = { dlopen: null, val: null, err: null };
      try {
        const FS = window.Module.FS;
        const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        FS.writeFile('/tmp/toolgap.so', bin);
        // ★ 取导出的正确姿势（实测 2026-10-16）：`loadDynamicLibrary` 返回**布尔**（不是实例），
        //   导出去处在第三个参数 `localScope` —— `global:false` 时 emscripten 把 `dso.exports`
        //   赋进它。`global:true` 走的是 `mergeLibSymbols`（本构建下取不到 probe_f）。
        const scope = {};
        await window.Module.loadDynamicLibrary('/tmp/toolgap.so',
          { loadAsync: false, global: false, nodelete: true }, scope);
        out.dlopen = 'OK';
        const fn = scope.probe_f;
        if (typeof fn !== 'function') {
          out.err = 'probe_f-not-exported（localScope 里没有该函数；导出面形态变了？）';
          return out;
        }
        // 真调用：20+2 应当得 22（throw 版只在负数时抛 ⇒ 这条正数路径不抛）
        out.val = fn(20 + 2);
      } catch (e) { out.err = String(e && e.message ? e.message : e).slice(0, 300); }
      return out;
    }, { b64: bytes.toString('base64') });
    obs.dlopen = r.dlopen; obs.val = r.val; obs.err = r.err;
    obs.ok = (r.dlopen === 'OK' && r.val === expectVal);
  } catch (e) {
    obs.err = String(e && e.message ? e.message : e).slice(0, 300);
  } finally {
    await page.close();
  }
  return obs;
}

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });

console.log(`URL=${URL} 模块目录=${MODDIR}`);
console.log('── ① 不带 throw（p-nothrow.oct）—— 只看缺口 1（TLS 入口）──');
const nothrow = await tryLoad(browser, NOTHROW_OCT, 22);
console.log(`   lane=${nothrow.lane} dlopen=${nothrow.dlopen} probe_f(22)=${JSON.stringify(nothrow.val)} `
            + `err=${nothrow.err}`);

console.log('── ② 带 throw（p-throw.oct）—— 走缺口 2（typeinfo）──');
const throwing = await tryLoad(browser, THROW_OCT, 22);
console.log(`   lane=${throwing.lane} dlopen=${throwing.dlopen} probe_f(22)=${JSON.stringify(throwing.val)} `
            + `err=${throwing.err}`);
await browser.close();

// ── 判据（严格按工单 65 的四条；形态与 ISSUE-1-verify-comment.md 同款）────────
const errOf = (o) => String(o.err || '');
const tlsHit = (o) => /tlsInitFunc|_emscripten_tls_init/i.test(errOf(o));
const tiHit = (o) => /reading 'value'|_ZTIi|GOT\.mem/i.test(errOf(o));

if (nothrow.ok && throwing.ok) {
  console.log('\n=== rc 0 === 两条缺口都已修（两个模块都 dlopen OK 且 probe_f(22)==22）');
  process.exit(0);
}
if (nothrow.lane === null) {
  console.log('\n=== rc 3 === 环境问题（页面没起来 / 拿不到档信息）—— 不是缺口结论');
  process.exit(3);
}
if (tlsHit(nothrow)) {
  console.log('\n=== rc 1 === 缺口 1 仍在（TLS 入口未定义）');
  process.exit(1);
}
if (tiHit(throwing)) {
  console.log('\n=== rc 2 === 缺口 2 仍在（基本类型 typeinfo 不可解析）');
  process.exit(2);
}
console.log(`\n=== rc 3 === 两个模块都没到"可断言"的状态（非已知缺口形态）⇒ 环境/夹具问题，不是缺口结论`
  + `\n   nothrow: ${JSON.stringify(nothrow)}` + `\n   throw  : ${JSON.stringify(throwing)}`);
process.exit(3);
