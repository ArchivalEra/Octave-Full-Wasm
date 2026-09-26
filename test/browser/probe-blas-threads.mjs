// 探针：**线程版 BLAS 的缩放**（回答"多线程到底能让数学快多少"，2026-09-26）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 为什么有它：B6（线程档）的取舍缺一个数 —— "线程版 BLAS 到底快多少"。
//   · 现役的 refblas/lapack 是 f2c 出来的**标量**代码 ⇒ 光让运行时支持线程**一分钱买不到**；
//   · `E2`（OpenBLAS 链进 Octave）卡在 binaryen 的 76 个 `signature_mismatch` 悬案上，
//     但那是"进 Octave 主模块"这一步的问题，**与线程 BLAS 本身的性能无关** ⇒ 本探针绕开它。
//
// 产物怎么来：`bash build/113/probe-blas-threads.sh`（线程版 OpenBLAS = `USE_THREAD=1`，
//   产物名带 `p`：`libopenblas_wasm128p-r0.3.34.a`；实测 408 个 pthread/exec_blas 符号）。
//
// 用法（从仓库原路径直跑）：
//   cd /mnt/hdd/octave-wasm-build/harness && \
//     sh run.sh /mnt/hdd/zcode-projects/Octave-Full-Wasm/test/browser/probe-blas-threads.mjs
//   NOCOI=1 …同上…            # 反证档：不注入 COOP/COEP ⇒ 必须**起不来**
//
// 断言（可证伪）：
//   A 结构：每个引擎都跑到 `BLAS DONE`，且 3 个 N × 4 个 T = 12 个格子都出了数
//   B ★ **线程真的生效**：N=2000 上 T=4 的加速比 ≥ 1.2×（对**单线程**库这条必红 ⇒ 它同时
//     证明"我们编的这份库真是线程版"，而不只是"命令行上写了 -pthread"）
//   C（反证）**无 COI ⇒ 起不来**（SAB 不可用）—— 证明"线程硬依赖 COI"不是嘴上说说
// 数据（不算断言，如实打印）：每个 N 的 T=1 基线 + T=2/4/8 的加速比与 GFLOPS
import { chromium, firefox } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const DIR = process.env.PROBE_DIR || '/mnt/hdd/octave-wasm-build/blas-threads-probe';
const NOCOI = process.env.NOCOI === '1';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm' };
// pthread 需要 SharedArrayBuffer ⇒ 顶层页必须是 COI（require-corp 是三引擎都支持的那档）
const COI = NOCOI ? {} : { 'Cross-Origin-Opener-Policy': 'same-origin',
                           'Cross-Origin-Embedder-Policy': 'require-corp' };
const server = createServer(async (req, res) => {
  const p = normalize(join(DIR, decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(normalize(DIR))) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(p);
    res.writeHead(200, Object.assign({ 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }, COI));
    res.end(body);
  } catch { res.writeHead(404).end('nope'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL = `http://127.0.0.1:${server.address().port}/run.html`;

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 220)}`);
};
const ENGINES = [
  ['chromium', () => chromium.launch({ executablePath: '/usr/bin/chromium',
    args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] })],
  ['firefox', () => firefox.launch()],
];

async function runOne(name, launch) {
  const br = await launch();
  const page = await (await br.newContext()).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  await page.goto(URL, { waitUntil: 'load', timeout: 120000 }).catch(() => {});
  let done = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 420000) {
    done = await page.evaluate(() => window.__blasDone === true).catch(() => false);
    if (done) break;
    await new Promise(r => setTimeout(r, 500));
  }
  const lines = await page.evaluate(() => window.__blasLines || []).catch(() => []);
  const err = await page.evaluate(() => window.__blasErr).catch(() => null);
  const rows = {};
  for (const l of lines) {
    const m = /BLAS N=(\d+) T=(\d+) ms=([\d.]+) gflops=([\d.]+)/.exec(l);
    if (m) rows[`${m[1]}/${m[2]}`] = { ms: Number(m[3]), gflops: Number(m[4]) };
  }
  check(done && Object.keys(rows).length === 12,
    `${name}/A 跑到 BLAS DONE 且 12 个格子都有数（3 个 N × 4 个 T）`,
    done ? `格子数=${Object.keys(rows).length}` : `未完成（${((Date.now() - t0) / 1000).toFixed(0)}s）：${err || errs[0] || '无错误信息'}`);
  if (Object.keys(rows).length) {
    console.log(`   ${name} 数据（ms / GFLOPS，取 3 次最快）:`);
    for (const N of [512, 1024, 2000]) {
      const base = rows[`${N}/1`];
      if (!base) continue;
      const cells = [1, 2, 4, 8].map(T => {
        const r = rows[`${N}/${T}`];
        return r ? `T=${T}: ${r.ms.toFixed(0)}ms(${(base.ms / r.ms).toFixed(2)}×, ${r.gflops.toFixed(1)}GF)` : `T=${T}: -`;
      });
      console.log(`     N=${String(N).padEnd(5)} ${cells.join('  ')}`);
    }
  }
  // B：线程真的生效（对单线程库这条必红）
  const b2000 = rows['2000/1'], b2000t4 = rows['2000/4'], b2000t8 = rows['2000/8'];
  const sp4 = (b2000 && b2000t4) ? b2000.ms / b2000t4.ms : 0;
  const sp8 = (b2000 && b2000t8) ? b2000.ms / b2000t8.ms : 0;
  check(sp4 >= 1.2 || sp8 >= 1.2,
    `${name}/B ★ 线程真的生效（N=2000 上 T=4 或 T=8 的加速比 ≥ 1.2×）`,
    `T=1 ${b2000 ? b2000.ms.toFixed(0) + 'ms' : '-'}；T=4 ${sp4.toFixed(2)}×；T=8 ${sp8.toFixed(2)}×`);
  await br.close();
  return { rows, done };
}

const res = {};
for (const [name, launch] of ENGINES) {
  try { res[name] = await runOne(name, launch); }
  catch (e) { check(false, `${name}/启动`, String(e).slice(0, 180)); }
}

// C（反证）：没有 COI ⇒ 必须起不来（证明"线程硬依赖 COI"）
{
  const br = await chromium.launch({ executablePath: '/usr/bin/chromium',
    args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] }).catch(() => null);
  if (br) {
    // 同一个产物、同一个页面，**只把 COI 头去掉**（第二个 server 实例，不注入 COOP/COEP）
    const s2 = createServer(async (req, res) => {
      const p = normalize(join(DIR, decodeURIComponent(req.url.split('?')[0])));
      try { const b = await readFile(p);
        res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }); res.end(b);
      } catch { res.writeHead(404).end('nope'); }
    });
    await new Promise(r => s2.listen(0, '127.0.0.1', r));
    const url2 = `http://127.0.0.1:${s2.address().port}/run.html`;
    const p2 = await (await br.newContext()).newPage();
    const errs2 = [];
    p2.on('pageerror', e => errs2.push(String(e).slice(0, 200)));
    await p2.goto(url2, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 8000));
    const done2 = await p2.evaluate(() => window.__blasDone === true).catch(() => false);
    const coi = await p2.evaluate(() => self.crossOriginIsolated).catch(() => null);
    check(!done2 && coi !== true,
      '★ C（反证）**不注入 COI 时起不来**（SAB 不可用 ⇒ 线程版硬依赖 COI）',
      `done=${done2} crossOriginIsolated=${coi} err=${(errs2[0] || '(无)').slice(0, 120)}`);
    await br.close();
    s2.close();
  }
}

server.close();
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
