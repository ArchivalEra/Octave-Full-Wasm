// 浏览器侧：在 Pyodide worker 里跑**同一份** bench.py，输出与原生侧同格式的 JSON（2026-10-14）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用户之问："pyodide 是不是性能承重件……用原生 octave+uv 跑下对比"
// ⇒ 本探针是那句对比的**浏览器那一半**：与 `test/fixtures/sympy-perf/bench-sympy.py`
//   **同一个文件**（不复制逻辑，只 copy 文件），在真浏览器 worker 里 exec。
//   判据：两侧跑完同一组 ops，出 `test/fixtures/sympy-perf/compare.py` 做比值。
//
// 复跑：sh test/fixtures/sympy-perf/run-perf.sh
// 读数：/mnt/hdd/octave-wasm-build/w64-logs/sympy-perf-pyodide.json
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const SERVE = process.env.SERVE || '/mnt/hdd/octave-wasm-build/symprobe/serve';
const OUTJ = process.env.OUTJ || '/mnt/hdd/octave-wasm-build/w64-logs/sympy-perf-pyodide.json';
const BENCH_SRC = process.env.BENCH || new URL('./bench-sympy.py', import.meta.url).pathname;
const REPS = process.env.REPS || '3';

// 同一份源码，塞进页面（fetch 相对路径 → worker 里读；避免两处逻辑漂移）
const BENCH = fs.readFileSync(BENCH_SRC, 'utf8');

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

fs.writeFileSync(path.join(SERVE, 'index.html'), `<!doctype html>
<meta charset="utf-8"><title>sympy perf (pyodide)</title>
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
  // 仪表：loadPackage 是否已经**导入**了 sympy（决定 import_s 这一行怎么读）
  const preImported = await pyodide.runPythonAsync("import sys; 'sympy' in sys.modules");
  const src = await (await fetch('./bench.py')).text();
  // ⚠️ **切掉 \`__main__\` 段**：runPythonAsync 里 __name__ == '__main__' ⇒ 留着守卫
  //    会让 bench 跑**两遍**（第二遍全热、import_s=0.0）—— 实测抓到，别改回去。
  const core = src.split('if __name__')[0];
  const res = await pyodide.runPythonAsync(
    core + "\\nimport json as _j\\n_j.dumps(run_bench(${REPS}, 'py'))");
  const tEnd = performance.now();
  self.postMessage({ ok: true, raw: res, preImported,
    t: { load: Math.round(tLoad - t0), pkg: Math.round(tPkg - tLoad),
         bench: Math.round(tEnd - tPkg) } });
} catch (err) {
  self.postMessage({ ok: false, error: String(err).slice(0, 600) });
}`);

const { s, port } = await serve();
const br = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
let rc = 0;
try {
  const page = await (await br.newContext()).newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__result !== null, null, { timeout: 600000 }).catch(() => {});
  const r = await page.evaluate(() => window.__result);
  console.log(JSON.stringify(r).slice(0, 500));
  if (!r || !r.ok) { rc = 1; }
  else {
    const bench = JSON.parse(r.raw);
    fs.mkdirSync(path.dirname(OUTJ), { recursive: true });
    fs.writeFileSync(OUTJ, JSON.stringify({ mode: 'pyodide', reps: Number(REPS),
      timings: r.t, bench }, null, 1));
    console.log(`\n=== 浏览器读数写入 ${OUTJ} ===`);
  }
  await page.context().close();
} finally { await br.close(); s.close(); }
process.exit(rc);
