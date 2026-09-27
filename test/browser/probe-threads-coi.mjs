// 探针：线程版产物对 COI 的**硬依赖**（B6/C1 的设计前提，2026-09-26）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 要回答的问题（决定 C1「单产物 + 运行时能力门」这条设计还成不成立）：
//   `-pthread -sSHARED_MEMORY` 编出来的 wasm，在**没有** cross-origin isolation
//   （⇒ 没有 SharedArrayBuffer）的页面里还能不能**实例化**？
//   · 若**不能**（预期）⇒ 线程能力**不能**靠运行时门降级 ⇒ 必须**双档产物**（线程版/非线程版）
//     + 加载期按能力二选一（C1 的门要选产物，而不是"关掉一个开关"）。
//   · 若**能**（例如胶水有非共享回退）⇒ 单产物路线仍然成立，门可以只关线程。
// 做法：同一个线程版产物，用**两种服务**各发一次（带头 / 不带头），看页面侧的结果。
// 判据：
//   T1 带头（COI）：`crossOriginIsolated===true`、SAB 可用、且**线程程序跑通**（E3 的 100 轮）
//   T2 ★ 不带头：**实例化必须失败**（或明确报错）—— 若它照常跑通，本探针的结论要翻面
//   T3 两档都要给出**失败文本形态**（供产品侧能力门写"清晰报错"）
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

// ★ F4：输入契约在 `test/browser/manifest.json` 的 `inputs` 里声明；环境变量
//    `PROBE_DIR` 可覆盖路径（两处口径必须一致 —— 清单声明的就是探针读的这个）。
const DIR = process.env.PROBE_DIR || (process.argv[2] && !/^http/.test(process.argv[2]) ? process.argv[2] : '/mnt/hdd/octave-wasm-build/threads-probe');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm' };
const COI = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };

function mkServer(coi) {
  return createServer(async (req, res) => {
    const p = normalize(join(DIR, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(normalize(DIR))) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(p);
      const h = { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' };
      res.writeHead(200, coi ? Object.assign(h, COI) : h);
      res.end(body);
    } catch { res.writeHead(404).end('nope'); }
  });
}

let pass = 0, fail = 0;
const check = (ok, label, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 260)}`); };

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });

async function probe(coi) {
  const srv = mkServer(coi);
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/run.html`;
  const page = await (await browser.newContext()).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  page.on('console', m => { const t = m.text(); if (/error|RangeError|SharedArrayBuffer|wasm/i.test(t)) errs.push(t.slice(0, 160)); });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  let res = null;
  try {
    await page.waitForFunction(() => window.__e3Result !== null || window.__e3Error !== null, null, { timeout: 25000 });
    res = await page.evaluate(() => ({ r: window.__e3Result, e: window.__e3Error }));
  } catch { /* 超时 = 数据点 */ }
  await page.close(); srv.close();
  return { res, errs: [...new Set(errs)].slice(0, 4) };
}

// ── T1 带头（COI）──
const withCoi = await probe(true);
const R1 = (withCoi.res && withCoi.res.r) || null;
check(!!R1 && R1.pre && R1.pre.coi === true && R1.pre.sab === 'function',
  '★ T1a 带 COI 头：crossOriginIsolated=true 且 SAB 可用', R1 ? JSON.stringify(R1.pre) : JSON.stringify(withCoi.errs));
check(!!R1 && R1.ok === 100, '★ T1b 带 COI 头：线程程序跑通（E3 的 100 轮 dlopen + 2 线程）',
  R1 ? `ok=${R1.ok} busy=${R1.busy}` : `(无结果) errs=${JSON.stringify(withCoi.errs)}`);

// ── T2 ★ 不带头（无 COI）──
const noCoi = await probe(false);
const bootedNoCoi = !!(noCoi.res && noCoi.res.r && (noCoi.res.r.pre || noCoi.res.r.ok !== undefined));
const errText = [
  noCoi.res && noCoi.res.e ? 'window.__e3Error=' + noCoi.res.e : '',
  noCoi.res && noCoi.res.r && noCoi.res.r.error ? 'result.error=' + noCoi.res.r.error : '',
  ...noCoi.errs,
].filter(Boolean).join(' | ').slice(0, 240);
check(!bootedNoCoi, '★ T2 不带 COI 头：线程版产物**不能**正常实例化/运行（⇒ 必须双档产物，单产物门要选产物不能只关开关）',
  errText || '(居然跑通了)');
console.log(`   无 COI 时的失败文本形态：${errText || '(无)'}`);

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
