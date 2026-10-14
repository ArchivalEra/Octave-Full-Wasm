// A/B：**SymPy 预编译字节码（.pyc）能不能缩短首次 import**（2026-10-14）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 用户问题（2026-10-14）─────────────────────────────────────────────────
// "transcript 预编译 python 是不是更好的路径，性能能快几倍吧"
// 这里有两件不同的事，本夹具量的是**第二件**（第一件由源码计数判决，见下）：
//   ① **静态编译成 JS**（Transcrypt 之类）—— 判据 = SymPy 源码里 `eval(` **340 处**、
//      `exec(` **61 处**（去 benchmarks/testing 的实测计数）。静态翻译器无法翻译运行期
//      构造的代码字符串 ⇒ 不是"更好"，是**不可行**（这条不靠本夹具，靠那个计数）。
//   ② **预编译字节码（.pyc）** —— 可行且**现在完全没做**（实测：pyodide 的
//      python_stdlib.zip 里 .pyc = 0、sympy/mpmath 轮子里 .pyc = 0）⇒ 本夹具量收益。
//
// ── 方法（唯一变量 = 轮子里有没有 __pycache__）──────────────────────────────
//   档 A `source-wheel`：官方轮子（全 .py）
//   档 B `pyc-wheel`   ：**同一个轮子重打包，只多加 `__pycache__/*.pyc`**
//                       （repack-wheel.py 打，见 run-ab.sh）
//   两档都走 pyodide 的 `loadPackage`（客户端只 fetch+解包 = 部署形态做的事），
//   计时只量 `import sympy`（含 mpmath），并数 `SourceFileLoader.source_to_code`
//   **调用次数**（= 真正发生"源码→字节码"编译的次数）。
//
//   ⚠️ 三条纪律（少一条 A/B 就是假的）：
//     · .pyc 由 **Pyodide 自己的 CPython** 编（magic 要匹配，run-ab.sh 保证）；
//     · **hash 校验模式**（timestamp 模式 mtime 对不上 ⇒ CPython 静默拒绝回落现编）；
//     · 仪器必须**说出谁在被编**（记录文件名清单）——B 档若仍有编译，点名是谁。
//
// ── 判据 ──────────────────────────────────────────────────────────────────
//   rc=0 ⇒ 两档都 import 成功、仪器读数齐全（**不预设"必须更快"**，如实报比值与字节）；
//   rc=1 ⇒ 有档 import 失败；rc=2 ⇒ 仪器不可信（B 档编译次数 ≥ A 档的一半）；
//   rc=3 ⇒ 环境问题。
//   **结论看 JSON**（导入 ms / 编译次数与文件清单 / 轮子字节）。
//
// ── 复跑 ──────────────────────────────────────────────────────────────────
//   sh test/fixtures/sympy-pyc-ab/run-ab.sh
//   （读 /mnt/hdd/octave-wasm-build/w64-logs/sympy-pyc-ab.json）
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const SERVE = process.env.SERVE || '/mnt/hdd/octave-wasm-build/symprobe/serve';
const OUTJ = '/mnt/hdd/octave-wasm-build/w64-logs/sympy-pyc-ab.json';
const PYDIR = path.join(SERVE, 'pyodide');
const LOCK = path.join(PYDIR, 'pyodide-lock.json');
// 重打包轮子的文件名/摘要由 run-ab.sh 写成 repacked.json
const REPACKED = JSON.parse(fs.readFileSync(path.join(PYDIR, 'repacked.json'), 'utf8'));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.whl': 'application/octet-stream', '.json': 'application/json',
  '.zip': 'application/zip' };

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

const PAGE = `<!doctype html><meta charset="utf-8">
<script type="module">
import { loadPyodide } from './pyodide/pyodide.mjs';
window.__result = null;
try {
  const t0 = performance.now();
  const pyodide = await loadPyodide({ indexURL: './pyodide/' });
  const tLoad = performance.now();
  // 装包：**但先不 import**（sympy 的 __init__ 在 import 时才编译子模块）
  await pyodide.loadPackage(['sympy']);
  const tPkg = performance.now();

  // 仪器：数 source_to_code 调用（记录被编的文件名）
  await pyodide.runPythonAsync(
    "import sys\\n" +
    "import importlib._bootstrap_external as be\\n" +
    "globals()['__stc'] = []\\n" +
    "_orig = be.SourceFileLoader.source_to_code\\n" +
    "def _counted(self, data, path, *a, **k):\\n" +
    "    globals()['__stc'].append(path)\\n" +
    "    return _orig(self, data, path, *a, **k)\\n" +
    "be.SourceFileLoader.source_to_code = _counted");
  const tImp0 = performance.now();
  const ver = await pyodide.runPythonAsync("import sympy; str(sympy.__version__)");
  const tImp1 = performance.now();
  const compiled = await pyodide.runPythonAsync("globals()['__stc'][:]");
  const byTop = {};
  for (const p of compiled) {
    const t = p.includes('/mpmath/') ? 'mpmath' : (p.includes('/sympy') ? 'sympy' : 'other');
    byTop[t] = (byTop[t] || 0) + 1;
  }
  window.__result = { ok: true, sympy: ver, pyodide: pyodide.version,
    sourceToCode: compiled.length, compiledByTop: byTop, compiledSample: compiled.slice(0, 10),
    t: { load: Math.round(tLoad - t0), pkg: Math.round(tPkg - tLoad), import: Math.round(tImp1 - tImp0) } };
} catch (err) {
  window.__result = { ok: false, error: String(err) };
}
</script>`;

// 档 → lock 里 sympy/mpmath 的 file_name + sha256 指向哪个轮子
const origLock = fs.readFileSync(LOCK, 'utf8');
function applyLock (usePyc) {
  const lock = JSON.parse(origLock);
  for (const pkg of ['sympy', 'mpmath']) {
    if (usePyc) {
      lock.packages[pkg].file_name = REPACKED[pkg].file;
      lock.packages[pkg].sha256 = REPACKED[pkg].sha256;
    } else {
      lock.packages[pkg].file_name = REPACKED[pkg].origFile;
      lock.packages[pkg].sha256 = REPACKED[pkg].origSha256;
    }
  }
  fs.writeFileSync(LOCK, JSON.stringify(lock, null, 1));
}

const MODES = [
  { name: 'source-wheel', usePyc: false },
  { name: 'pyc-wheel', usePyc: true },
];

fs.mkdirSync(path.dirname(OUTJ), { recursive: true });
const report = { probe: 'sympy-pyc-ab', at: new Date().toISOString(),
  wheels: REPACKED, modes: [] };

const { s, port } = await serve();
const htmlFile = path.join(SERVE, 'ab.html');
fs.writeFileSync(htmlFile, PAGE);
const br = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });

try {
  for (const mode of MODES) {
    applyLock(mode.usePyc);
    const page = await (await br.newContext()).newPage();
    console.log(`== 档 ${mode.name}`);
    await page.goto(`http://127.0.0.1:${port}/ab.html`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.__result !== null, null, { timeout: 300000 }).catch(() => {});
    const r = await page.evaluate(() => window.__result);
    report.modes.push({ mode: mode.name, result: r });
    console.log('   ' + JSON.stringify(r).slice(0, 400));
    await page.context().close();
  }
} finally { await br.close(); s.close(); fs.writeFileSync(LOCK, origLock); fs.rmSync(htmlFile, { force: true }); }

let rc = 0;
const A = report.modes.find((m) => m.mode === 'source-wheel')?.result;
const B = report.modes.find((m) => m.mode === 'pyc-wheel')?.result;
if (!A?.ok || !B?.ok) rc = 1;
else if (B.sourceToCode >= A.sourceToCode / 2) rc = 2;      // 仪器不可信
if (A?.ok && B?.ok) {
  report.summary = { rc: rc || 0,
    importA_ms: A.t.import, importB_ms: B.t.import,
    speedup: +(A.t.import / Math.max(B.t.import, 1)).toFixed(2),
    sourceToCode: { A: A.sourceToCode, B: B.sourceToCode },
    compiledByTop: { A: A.compiledByTop, B: B.compiledByTop },
    bytes: { A: REPACKED.sympy.origBytes + REPACKED.mpmath.origBytes,
             B: REPACKED.sympy.bytes + REPACKED.mpmath.bytes },
    note: 'speedup = A÷B（>1 = .pyc 更快）；字节 = 两个轮子之和（**下载口径**）' };
  console.log(`\nA import ${A.t.import} ms（编译 ${A.sourceToCode} 次） / B import ${B.t.import} ms（编译 ${B.sourceToCode} 次） ⇒ ${report.summary.speedup}×`);
  console.log(`轮子字节：A ${(report.summary.bytes.A / 1048576).toFixed(2)} MB / B ${(report.summary.bytes.B / 1048576).toFixed(2)} MB`);
} else { report.summary = { rc }; }
fs.writeFileSync(OUTJ, JSON.stringify(report, null, 1));
console.log(`=== 读数写入 ${OUTJ} （rc=${rc}）===`);
process.exit(rc);
