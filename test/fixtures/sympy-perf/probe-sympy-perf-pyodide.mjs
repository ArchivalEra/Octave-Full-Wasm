// 浏览器侧：在 Pyodide worker 里跑**同一份** bench.py，输出与原生侧同格式的 JSON（2026-10-14）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用户之问：① "pyodide 是不是性能承重件……用原生 octave+uv 跑下对比"
//           ② "那试试预编译 pyc，还能快多少"
// ⇒ 本探针是那两句对比的**浏览器那一半**：与 `test/fixtures/sympy-perf/bench-sympy.py`
//   **同一个文件**（fetch 它，不复制逻辑），在真浏览器 worker 里 exec。**两种轮子档**：
//     WHEELS=source ⇒ 官方轮子（全 .py）
//     WHEELS=pyc    ⇒ 预编字节码轮子（先跑 prepare-pyc-wheels.sh 产出）
//   唯一变量 = pyodide lock 指向哪个轮子（改 lock 而不是页面里塞 .pyc —— 后者会把
//   "我的测试写法"的开销算进去；实测过：逐个 FS.writeFile 要 3.6 s，那是交付方式的开销）。
//
// 复跑：sh test/fixtures/sympy-perf/run-perf.sh [source|pyc]
// 读数：/mnt/hdd/octave-wasm-build/w64-logs/sympy-perf-pyodide[-pyc].json
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const SERVE = process.env.SERVE || '/mnt/hdd/octave-wasm-build/symprobe/serve';
const WHEELS = process.env.WHEELS || 'source';               // source | pyc
const OUTJ = process.env.OUTJ || (WHEELS === 'pyc'
  ? '/mnt/hdd/octave-wasm-build/w64-logs/sympy-perf-pyodide-pyc.json'
  : '/mnt/hdd/octave-wasm-build/w64-logs/sympy-perf-pyodide.json');
const BENCH_SRC = process.env.BENCH ||
  path.join(path.dirname(new URL(import.meta.url).pathname), 'bench-sympy.py');
const REPS = process.env.REPS || '3';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.whl': 'application/octet-stream', '.json': 'application/json',
  '.zip': 'application/zip', '.py': 'text/plain' };

function serve () {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      const rel = url.replace(/^\/+/, '') || 'index.html';
      const f = path.join(SERVE, rel.endsWith('/') ? rel + 'index.html' : rel);
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    s.listen(0, '127.0.0.1', () => resolve({ s, port: s.address().port }));
  });
}

// ── lock 改写：把 sympy/mpmath 指向选中的轮子（唯一变量）──
const LOCKF = path.join(SERVE, 'pyodide', 'pyodide-lock.json');
const ORIG_LOCK = fs.readFileSync(LOCKF, 'utf8');
const REPACKED_F = path.join(SERVE, 'pyodide', 'repacked.json');

function applyLock () {
  const lock = JSON.parse(ORIG_LOCK);
  if (WHEELS === 'pyc') {
    if (!fs.existsSync(REPACKED_F)) {
      throw new Error('缺 repacked.json —— 先跑 sh test/fixtures/sympy-pyc-ab/prepare-pyc-wheels.sh');
    }
    const rep = JSON.parse(fs.readFileSync(REPACKED_F, 'utf8'));
    for (const pkg of ['sympy', 'mpmath']) {
      lock.packages[pkg].file_name = rep[pkg].file;
      lock.packages[pkg].sha256 = rep[pkg].sha256;
    }
  }
  // source 档：原样写回 ORIG_LOCK（保证从 pyc 档跑完后能复位）
  fs.writeFileSync(LOCKF, JSON.stringify(lock, null, 1));
}

fs.writeFileSync(path.join(SERVE, 'index.html'), `<!doctype html>
<meta charset="utf-8"><title>sympy perf (pyodide, ${WHEELS})</title>
<script>
window.__result = null;
new Worker('./w.js', { type: 'module' }).onmessage = (e) => { window.__result = e.data; };
</script>`);

fs.writeFileSync(path.join(SERVE, 'w.js'), `
import { loadPyodide } from './pyodide/pyodide.mjs';
try {
  const t0 = performance.now();
  const pyodide = await loadPyodide({ indexURL: './pyodide/' });
  const tLoad = performance.now();
  await pyodide.loadPackage(['sympy']);
  const tPkg = performance.now();
  // 仪表：loadPackage 是否已经**导入**了 sympy（决定 import_s 这行怎么读）
  const preImported = await pyodide.runPythonAsync("import sys; 'sympy' in sys.modules");
  const src = await (await fetch('./bench.py')).text();
  const core = src.split('if __name__')[0];   // ⚠️ 切掉 __main__ 段（否则跑两遍，见 pyc-ab 注释）
  const res = await pyodide.runPythonAsync(
    core + "\\nimport json as _j\\n_j.dumps(run_bench(${REPS}, 'py'))");
  const tEnd = performance.now();
  self.postMessage({ ok: true, raw: res, preImported, wheels: '${WHEELS}',
    t: { load: Math.round(tLoad - t0), pkg: Math.round(tPkg - tLoad),
         bench: Math.round(tEnd - tPkg) } });
} catch (err) {
  self.postMessage({ ok: false, error: String(err).slice(0, 600) });
}`);

// bench.py 要从站点读（run.sh 会 cp 到 harness 跑 ⇒ import.meta.url 指向 harness，
// 所以用 BENCH env 或从仓库路径显式拷进 SERVE）。
const BENCH_DST = path.join(SERVE, 'bench.py');
if (process.env.BENCH) fs.copyFileSync(process.env.BENCH, BENCH_DST);
else if (!fs.existsSync(BENCH_DST)) fs.copyFileSync(BENCH_SRC, BENCH_DST);

applyLock();
const { s, port } = await serve();
const br = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
let rc = 0;
try {
  const page = await (await br.newContext()).newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__result !== null, null, { timeout: 600000 }).catch(() => {});
  const r = await page.evaluate(() => window.__result);
  console.log(JSON.stringify(r).slice(0, 400));
  if (!r || !r.ok) { rc = 1; }
  else {
    const bench = JSON.parse(r.raw);
    fs.mkdirSync(path.dirname(OUTJ), { recursive: true });
    fs.writeFileSync(OUTJ, JSON.stringify({ mode: `pyodide-${WHEELS}`, wheels: WHEELS,
      preImported: r.preImported, reps: Number(REPS), timings: r.t, bench }, null, 1));
    console.log(`\n=== 读数写入 ${OUTJ} ===`);
  }
  await page.context().close();
} finally { await br.close(); s.close(); fs.writeFileSync(LOCKF, ORIG_LOCK); }
process.exit(rc);
