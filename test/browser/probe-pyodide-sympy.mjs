// 探针：**Pyodide + SymPy 在本机浏览器里能不能真算对**（2026-10-14）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 为什么有这个探针（缺口①"符号计算"的路线前提）───────────────────────────
// 本仓实测：`sym` = 0（Octave 核心/本构建都没有符号计算）。Forge 的 `symbolic` 包
// 是**纯 .m**，但它的全部功能经 `pycall_sympy__` → `python_ipc_driver` → Python/SymPy
// （实测：`python_ipc_native` 用 `pyexec/pyeval/pycall`，`python_ipc_system` 用
// `system()` 起子进程）。而本构建：**wasm 里 `pyexec`/`pyeval`/`pycall` 符号数 = 0、
// 无 shell**（`system`/`popen` webshim 直接清晰报错）⇒ 包原样跑不了。
//
// 于是唯一现实的路线 = **在浏览器里引一个真 Python（Pyodide）+ SymPy**，用我们的
// JS 桥把它接到 Octave 侧。**这个探针就是那条路线的前提实验**：
//   ① Pyodide 从**同源本地文件**起得来（不是 CDN；COEP 下跨域会被拦，与工具链同款约束）；
//   ② 在 **Worker（DOM-free）** 里起得来（算力不占主线程，与 WebGPU 探针同一形状）；
//   ③ **真算对**：`diff(sin(x), x)` ⇒ 恰好 `cos(x)`；
//   ④ **无 COI**（发不了 COOP/COEP 的宿主）同样能算 —— 决定"基础档用户有没有份"；
//   ⑤ **反向断言**：把 SymPy 轮子拿掉（404）时，装载必须**响亮失败**，不许静默。
//
// ── 判据 ──────────────────────────────────────────────────────────────────
//   rc=0 ⇒ ①②③④⑤ 全过（输出 JSON 记录各阶段耗时与字节数）；
//   rc=1 ⇒ 有失败（逐条点名）；rc=3 ⇒ 环境问题（缺 node_modules / 下不动资产）。
//
// ── 复跑 ──────────────────────────────────────────────────────────────────
//   sh test/browser/run.sh test/browser/probe-pyodide-sympy.mjs
//   （资产缓存 /mnt/hdd/octave-wasm-build/symprobe/cache/，首次运行时下载并核 sha256；
//     读数写 /mnt/hdd/octave-wasm-build/w64-logs/probe-pyodide-sympy.json）
//
// ── 纪律 ──────────────────────────────────────────────────────────────────
//   · 同源：页面与全部 .wasm/.whl 走**本脚本自起的 http 服务器**，不碰 CDN
//     （CDN 只用于"取回并钉版"，与 provision-upstream.sh 同款：URL+sha256 fail-closed）；
//   · 两种页面模式（带 COI / 不带 COI）各起一次，**不许只测一种就下结论**；
//   · 第三次（模式 coi+breaksympy）是**反向断言**：该报错的必须报错。
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

// ── 固定输入（URL + sha256，fail-closed；升级 = 改这一组 + 重跑）────────────
const PY_VER = '314.0.7';
const CORE_TAR = `pyodide-core-${PY_VER}.tar.bz2`;
const CORE_URL = `https://github.com/pyodide/pyodide/releases/download/${PY_VER}/${CORE_TAR}`;
const CORE_SHA = '2abdcc2e35208af406e07724cffa85bc582ced97e9028383ecf5462541393f95';
// ★ 轮子字节 = **PyPI 官方字节**（sha 取自 PyPI JSON API，fail-closed）。
//   ⚠️ 实测抓到的身份坑（2026-10-14，别改回去）：pyodide-core 自带 lock 对 sympy/mpmath
//   记的是 **pyodide 重打包版**的 sha（它对纯 Python 包去掉测试再打包，lock 里
//   `unvendored_tests: true` 就是这个意思），与 PyPI 官方字节**不同**：
//     sympy   lock 61ea8bb9… ≠ PyPI e091cc3e…
//     mpmath  lock e5ebd537… ≠ PyPI dc4f0ea2…
//   而 pyodide 的标准 CDN（cdn.jsdelivr.net）在本环境**连不上**（curl http=000）
//   ⇒ 供给走 PyPI，并把**我们托管的 lock** 里这两条的 sha 改写成实际字节的 sha
//   （见 overlayLock：我们才是供给方，pin 的必须是"我们放上去的字节"）。
const WHEELS = [
  { name: 'sympy-1.14.0-py3-none-any.whl',
    sha: 'e091cc3e99d2141a0ba2847328f5479b05d94a6635cb96148ccb3f34671bd8f5',
    url: 'https://pypi.org/pypi/sympy/1.14.0/json' },
  { name: 'mpmath-1.4.1-py3-none-any.whl',
    sha: 'dc4f0ea2304480d4a9a48a94c1020571558ade522b44a6912efac63a586e140f',
    url: 'https://pypi.org/pypi/mpmath/1.4.1/json' },
];

const CACHE = '/mnt/hdd/octave-wasm-build/symprobe/cache';
const SERVE = '/mnt/hdd/octave-wasm-build/symprobe/serve';
const OUTJ = '/mnt/hdd/octave-wasm-build/w64-logs/probe-pyodide-sympy.json';

const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const mb = (n) => (n / 1048576).toFixed(2) + ' MB';

async function dl (url, dest, sha, pickUrl) {
  if (fs.existsSync(dest) && sha256(dest) === sha) return dest;
  if (pickUrl) {                                    // 经 PyPI JSON API 解析第一个文件 URL
    const j = await (await fetch(url)).json();
    url = j.urls[0].url;
  }
  console.log(`  下载 ${path.basename(dest)} ← ${url}`);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`ENV: ${url} ⇒ HTTP ${r.status}`);
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
  const got = sha256(dest);
  if (got !== sha) throw new Error(`ENV: ${path.basename(dest)} sha 不符（Got ${got} ≠ 期望 ${sha}）`);
  return dest;
}

// ── 资产准备（一次）────────────────────────────────────────────────────────
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(path.dirname(OUTJ), { recursive: true });
// core 已解包过就跳过
const coreDir = path.join(CACHE, 'core', 'pyodide');
if (!fs.existsSync(path.join(coreDir, 'pyodide.js'))) {
  const tar = await dl(CORE_URL, path.join(CACHE, CORE_TAR), CORE_SHA);
  fs.mkdirSync(path.join(CACHE, 'core'), { recursive: true });
  execFileSync('tar', ['-xjf', tar, '-C', path.join(CACHE, 'core')]);   // bz2：node 无内建，用系统 tar
  console.log(`  解包 ${CORE_TAR} → ${coreDir}`);
}
const wheelPaths = [];
for (const w of WHEELS) {
  wheelPaths.push(await dl(w.url, path.join(CACHE, w.name), w.sha, true));
}

// ── 组装服务目录（同源）────────────────────────────────────────────────────
fs.rmSync(SERVE, { recursive: true, force: true });
fs.mkdirSync(path.join(SERVE, 'pyodide'), { recursive: true });
for (const f of fs.readdirSync(coreDir)) {
  fs.copyFileSync(path.join(coreDir, f), path.join(SERVE, 'pyodide', f));
}
for (const w of wheelPaths) fs.copyFileSync(w, path.join(SERVE, 'pyodide', path.basename(w)));

// ★ overlayLock：pyodide 装载轮子时**按 lock 自校验 sha** ⇒ 我们换了字节就必须同步改锁。
//   只动我们替换过的两条（其余保持 pyodide 官方值）；并写下 overlay 记录，可复查。
{
  const lf = path.join(SERVE, 'pyodide', 'pyodide-lock.json');
  const lock = JSON.parse(fs.readFileSync(lf, 'utf8'));
  const overlaid = [];
  for (const w of WHEELS) {
    const nm = w.name.split('-')[0];
    const before = lock.packages[nm].sha256;
    lock.packages[nm].sha256 = w.sha;
    lock.packages[nm].file_name = w.name;
    overlaid.push({ pkg: nm, before, after: w.sha });
  }
  fs.writeFileSync(lf, JSON.stringify(lock, null, 1));
  fs.writeFileSync(path.join(SERVE, 'pyodide', 'overlay-lock.json'),
    JSON.stringify({ at: new Date().toISOString(), why: 'PyPI bytes ≠ pyodide repack bytes; we host ours',
      overlaid }, null, 1));
  console.log('  overlayLock：改写 ' + overlaid.map((o) => o.pkg).join(' / ') + ' 的 sha');
}

fs.writeFileSync(path.join(SERVE, 'index.html'), `<!doctype html>
<meta charset="utf-8"><title>pyodide sympy probe</title>
<script>
window.__result = null;
window.__t0 = performance.now();
const w = new Worker('./w.js', { type: 'module' });
  // ★ 必须 **module** worker：pyodide 314 的启动器在 classic worker 里直接拒绝
  //   （实测原文 "Classic web workers are not supported"），要 importScripts 走不通。
w.onmessage = (e) => {
  // ⚠️ Worker 会先回一条 'go'（自检信号）—— 第一版把它也当结果 ⇒ 探针卡在 "go" 假通过（实测）。
  if (e.data === 'go') return;
  window.__result = e.data;
};
w.onerror = (e) => { window.__result = { ok: false, error: 'worker onerror: ' + (e.message || e) }; };
</script>`);

fs.writeFileSync(path.join(SERVE, 'w.js'), `
// ⚠️ **module worker** + **静态 import**（第一版用 importScripts ⇒ pyodide 314 拒绝 classic
//    worker；实测原文 "Classic web workers are not supported"。自启动同理，页面不会发消息。）
import { loadPyodide } from './pyodide/pyodide.mjs';
const t0 = performance.now();
try {
  const pyodide = await loadPyodide({ indexURL: './pyodide/' });
  const tLoad = performance.now();
  await pyodide.loadPackage(['sympy']);              // 连带 mpmath（lock 里的依赖）
  const tPkg = performance.now();
  const r = await pyodide.runPythonAsync(
    "import sympy\\n" +
    "x = sympy.Symbol('x')\\n" +
    "str(sympy.diff(sympy.sin(x), x))");
  const tCmp = performance.now();
  self.postMessage({ ok: true, diff: r, sympy: pyodide.runPython("import sympy; sympy.__version__"),
    pyodide: pyodide.version, coi: self.crossOriginIsolated,
    t: { load: Math.round(tLoad - t0), pkg: Math.round(tPkg - tLoad), compute: Math.round(tCmp - tPkg) } });
} catch (err) {
  self.postMessage({ ok: false, error: String(err), coi: self.crossOriginIsolated });
}`);

// ── 自起 http 服务器（带/不带 COI 头；可注入 404 反向模式）──────────────────
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.whl': 'application/octet-stream', '.json': 'application/json',
  '.zip': 'application/zip' };
function serve ({ coi, breakSympy }) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      if (breakSympy && /sympy-.*\.whl$/.test(url)) { res.writeHead(404); res.end('gone'); return; }
      // ⚠️ `/` 必须映射到 index.html —— 第一版直接 join 得到目录 ⇒ statSync.isDirectory() ⇒ 404，
      //    页面根本没起来（探针自身缺陷，实测抓到：全模式 null）。
      const rel = url.replace(/^\/+/, '') || 'index.html';
      const f = path.join(SERVE, rel.endsWith('/') ? rel + 'index.html' : rel);
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
      const h = { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' };
      if (coi) { h['cross-origin-opener-policy'] = 'same-origin'; h['cross-origin-embedder-policy'] = 'require-corp'; }
      res.writeHead(200, h);
      fs.createReadStream(f).pipe(res);
    });
    s.listen(0, '127.0.0.1', () => resolve({ s, port: s.address().port }));
  });
}

async function runMode (br, mode) {
  const { s, port } = await serve(mode);
  const results = [];
  let pageBytes = { decoded: 0, transfer: 0 };
  try {
    const ctx = await br.newContext();
    const page = await ctx.newPage();
    page.on('response', async (resp) => {
      try {
        const u = resp.url();
        if (!u.startsWith(`http://127.0.0.1:${port}`) || resp.status() !== 200) return;
        const b = await resp.body();
        pageBytes.decoded += b.length;
        const ts = resp.request().timing().responseEnd - resp.request().timing().requestStart;
        void ts;                                     // 本地环回，传输时间无意义，只记字节
      } catch { /* 流式响应拿不到 body 时忽略，字节另有磁盘口径 */ }
    });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.__result !== null, null, { timeout: 240000 })
      .catch(() => {});
    const r = await page.evaluate(() => window.__result);
    results.push(r);
    await ctx.close();
  } finally { s.close(); }
  return { mode, result: results[0] || null, pageBytes };
}

// ── 跑三种模式 ─────────────────────────────────────────────────────────────
let rc = 0;
const report = { probe: 'pyodide-sympy', at: new Date().toISOString(), modes: [], bytes: {} };
const br = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] }).catch((e) => {
  console.log('ENV: chromium 起不来：' + e); process.exit(3);
});

try {
  for (const mode of [{ coi: true, breakSympy: false }, { coi: false, breakSympy: false },
                      { coi: true, breakSympy: true }]) {
    const tag = `coi=${mode.coi} breakSympy=${mode.breakSympy}`;
    console.log(`== 模式 ${tag}`);
    const { result, pageBytes } = await runMode(br, mode);
    report.modes.push({ tag, result, pageBytes });
    console.log('   ' + JSON.stringify(result)?.slice(0, 300));
  }
} finally { await br.close(); }

// ── 判据 ───────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const check = (ok, label, detail) => { ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 200)}`); };

const [coiR, nocoR, brkR] = report.modes.map((m) => m.result);
check(!!coiR && coiR.ok === true, '① COI 模式 Worker 里 Pyodide 起得来', coiR && (coiR.error || `pyodide ${coiR.pyodide}`));
check(!!coiR && coiR.diff === 'cos(x)', '② 真算对：diff(sin(x),x) == "cos(x)"', coiR && coiR.diff);
check(!!coiR && String(coiR.sympy) === '1.14.0', '③ SymPy 版本 = 1.14.0', coiR && coiR.sympy);
check(!!nocoR && nocoR.ok === true && nocoR.diff === 'cos(x)',
  '④ 无 COI（无 COOP/COEP）同样算对 —— 基础档用户有份', nocoR && (nocoR.error || `coi=${nocoR.coi} diff=${nocoR.diff}`));
check(!!brkR && brkR.ok === false && /sympy|wheel|404|404|Failed|fetch/i.test(String(brkR.error)),
  '⑤ 反向断言：拿掉 SymPy 轮子 ⇒ 装载**响亮失败**（不许静默）', brkR && String(brkR.error).slice(0, 160));

// 字节口径：磁盘（精确、可复算）
const diskBytes = { coreTar: fs.statSync(path.join(CACHE, CORE_TAR)).size,
  wheels: wheelPaths.reduce((a, f) => a + fs.statSync(f).size, 0) };
diskBytes.coreExtracted = (() => { let n = 0;
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name); e.isDirectory() ? walk(p) : n += fs.statSync(p).size; } };
  walk(path.join(SERVE, 'pyodide')); return n; })();
report.bytes = { disk: diskBytes, pagePerMode: report.modes.map((m) => m.pageBytes) };
console.log('== 字节（磁盘口径，可复算）');
console.log(`   core tar（压缩）= ${mb(diskBytes.coreTar)} ；解包后 pyodide/ = ${mb(diskBytes.coreExtracted)}`);
console.log(`   轮子 sympy+mpmath = ${mb(diskBytes.wheels)}`);
console.log(`   合计站点新增（解包+轮子）= ${mb(diskBytes.coreExtracted + diskBytes.wheels)}`);
console.log(`   页面实际收到（模式级）= ${report.modes.map((m) => mb(m.pageBytes.decoded)).join(' / ')}`);

report.summary = { pass, fail, rc };
fs.writeFileSync(OUTJ, JSON.stringify(report, null, 1));
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===  （读数写入 ${OUTJ}）`);
process.exit(fail === 0 ? 0 : 1);
