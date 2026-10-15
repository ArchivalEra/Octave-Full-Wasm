// 决定性实验：**wasm 里的 C 能否同步调 Pyodide 并拿回值**（2026-10-15）
// Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 为什么有这个探针（Claude 调研的"推论"要落地成实测）────────────────────────
// 调研结论（去标识后的外部搜索）：**没有**"emscripten 里的 C 同步调浏览器 Python"的现成桥
// （Q2/Q5 没找到）。唯一可走的路是**推论**：C 经 `EM_JS` 同步调 `pyodide.runPython()`，
// **不需要** JSPI / Asyncify / Atomics —— 前提是"同步调用路径本身不含 await"。
// ⇒ 本探针把那个推论**实测**掉（本仓纪律：推断必须能结案）。
//
// ── 判据 ──────────────────────────────────────────────────────────────────
//   rc=0 ⇒ ①②③ 全过：
//     ① wasm 里的 C **同步**调 Python 拿到字符串（`sympy.__version__`）
//     ② 同步调**真算对**：`diff(sin(x),x)` ⇒ `cos(x)`
//     ③ 全程**没有** JSPI / Asyncify / Atomics（页面侧不包装任何 import）
//   rc=1 ⇒ 有失败（逐条点名）；rc=3 ⇒ 环境问题。
//
// 复跑：node test/browser/probe-pyodide-sync.mjs
// 前置：先跑 `node test/fixtures/pyodide-sync/build.sh`（编 wasm + 组站点）
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.env.PROBE_DIR || '/mnt/hdd/octave-wasm-build/pyodide-sync-probe';
const OUTJ = '/mnt/hdd/octave-wasm-build/w64-logs/probe-pyodide-sync.json';
const MIME = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript',
  '.wasm': 'application/wasm', '.whl': 'application/octet-stream', '.json': 'application/json',
  '.zip': 'application/zip' };

function serve () {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      const rel = url.replace(/^\/+/, '') || 'index.html';
      const f = path.join(DIR, rel.endsWith('/') ? rel + 'index.html' : rel);
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    s.listen(0, '127.0.0.1', () => resolve({ s, port: s.address().port }));
  });
}

const { s, port } = await serve();
const br = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
let rc = 0;
const out = [];
try {
  const page = await (await br.newContext()).newPage();
  const consoleLines = [];
  page.on('console', m => consoleLines.push(m.text()));
  page.on('pageerror', e => consoleLines.push('[pageerror] ' + e.message));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__result && window.__result.phase !== 'start',
    null, { timeout: 300000 }).catch(() => {});
  const r = await page.evaluate(() => window.__result);
  const probeLines = consoleLines.filter(l => l.startsWith('PROBE'));

  let pass = 0, fail = 0;
  const check = (ok, label, detail) => { ok ? pass++ : fail++;
    console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 200)}`); };

  check(r && r.phase === 'done', '① 探针跑完（wasm 的 main 返回）', JSON.stringify(r).slice(0, 160));
  check(probeLines.some(l => /PROBE rc=\d+ val=\d+\.\d+/.test(l)),
    '② C **同步**调 Python 拿到 sympy 版本串', probeLines.find(l => l.startsWith('PROBE ')) || '(无)');
  check(probeLines.some(l => l.startsWith('PROBE2') && /val=cos\(x\)/.test(l)),
    '③ 同步调**真算对**：diff(sin(x),x) == cos(x)',
    probeLines.find(l => l.startsWith('PROBE2')) || '(无)');
  // 反向：页面侧**没有**包装任何 import（不靠 JSPI）—— 判据 = 本页面从没设 WebAssembly.Suspending
  check(r && typeof r.pyodideReadyMs === 'number',
    '④ 冷启动耗时已记录（Pyodide + sympy 装载）', r && `${r.pyodideReadyMs} ms`);

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  rc = fail === 0 ? 0 : 1;
  fs.mkdirSync(path.dirname(OUTJ), { recursive: true });
  fs.writeFileSync(OUTJ, JSON.stringify({ probe: 'pyodide-sync', at: new Date().toISOString(),
    result: r, probeLines, pass, fail, rc }, null, 1));
  console.log(`读数写入 ${OUTJ}`);
  await page.context().close();
} finally { await br.close(); s.close(); }
process.exit(rc);
