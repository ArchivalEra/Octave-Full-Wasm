// 工单 75 结算件：**wasm32 极简线（只要 octave.js 三件套）能不能接 symbolic**（2026-11-01）
// Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 为什么有这个探针（课程站 mail/067 的 Q1/Q2 要落地成实测）───────────────────
// 课程站只 vendor 我方的 **wasm32 Release 三件套**（octave.js/octave.wasm/octave.data），
// 无 `octave-core.js`、无 Worker、无 COI 头，问 symbolic 能不能接上。四问里两问只能实测答：
//
//   Q1：`webshims/system.m` 与 `__webshim_python_cmd__.m` 是否**已经烘进 `octave.data`**？
//   Q2：`probe-pyodide-sync` 那个 4/0 是在**本仓站点**（有 octave-core.js）测的；
//       在课程站那套极简环境（普通 `<script type="module">`，无 COI 头）还成立吗？
//
// ── 搭出"课程站的环境"（刻意不借本仓站点）──────────────────────────────────────
//   ① 起**无 COOP/COEP 头**的本地静态服务（课程站拿不到 COI 头 —— 前提，不是便利）；
//   ② 页面**只**加载 octave.js + 三件产物 + assets/m/webshims.js
//      （**不加载** octave-core.js / lane.js / octave-page.js）；
//   ③ 宿主手写最小三钩子（print/printErr/locateFile），照课程站 002 那份接法；
//   ④ Pyodide 走动态 import()，然后**同步**调 runPython —— 判据是它真返回值。
//
// ── 判据（每条都能红）──────────────────────────────────────────────────────────
//   E1 胶水里 webshim 零命中 ⇒ Q1 的答案（宿主 .m **不在** data 里）
//   E2 webshims.js 是可自包含装载的 JS 包（.m 元数据可读）
//   E3 ★ 装载它之后 __webshim_python_cmd__ 进 MEMFS 且 system 解析到 webshims
//   E3b 页面确实没有 octave-core.js（极简前提成立）
//   E4 ★ Pyodide 无 COI/无 JSPI/无 Worker 主线程**同步**跑通并算出 cos(x)
//   E5 ★ system('python3 -c "print(6*7)"') 端到端返回 42
//   E6 ☆ 反向：把 py 摘掉后必须报哨兵，不许静默空返回
//
// rc=0 ⇒ 全过；rc=1 ⇒ 有断言失败；rc=3 ⇒ 环境问题（缺产物/缺 Pyodide）
//
// 用法（playwright 只在 harness 的 node_modules 里 ⇒ 必须经 run.sh）：
//   HARNESS=/mnt/hdd/zcode-test/harness sh test/browser/run.sh \
//     test/browser/probe-wasm32-symbolic-minimal.mjs
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const SITE = process.env.SITE || '/mnt/hdd/octave-wasm-build/site';
const PYODIDE = process.env.PYODIDE || path.join(SITE, 'assets/pyodide/pyodide');
const OUTJ = process.env.OUTJ || '/mnt/hdd/octave-wasm-build/w64-logs/probe-wasm32-symbolic-minimal.json';

for (const f of ['octave.js', 'octave.wasm', 'octave.data', 'assets/m/webshims.js']) {
  const p = path.join(SITE, f);
  if (!fs.existsSync(p)) { console.log('FATAL: 缺 ' + p); process.exit(3); }
}
if (!fs.existsSync(path.join(PYODIDE, 'pyodide.mjs'))) {
  console.log('FATAL: 缺 Pyodide ' + PYODIDE); process.exit(3);
}

// ── 页面源码用数组拼：模板字符串里再套反引号会被解析器撕开（第一版就这么改坏过）──
const PAGE = [
  '<!doctype html><meta charset="utf-8"><body>',
  '<script type="text/javascript" src="octave.js"></script>',
  '<script type="text/javascript" src="assets/m/webshims.js"></script>',
  '<script type="module">',
  'window.__result = { phase: "start" };',
  'const log = (...a) => console.log("PROBE", ...a);',
  '(async () => {',
  '  try {',
  '    const M = await window.OCTAVE({',
  '      print: (s) => log("out:", s),',
  '      printErr: (s) => log("err:", s),',
  '      locateFile: (p) => p,',
  '    });',
  '    window.__result.phase = "module";',
  '    M.execute_interp();',
  '    window.__result.phase = "interp";',
  '',
  '    window.__result.corePresent = {',
  '      createOctaveCore: typeof window.createOctaveCore,',
  '      createOctaveAssets: typeof window.createOctaveAssets,',
  '      OctaveAssets: typeof window.OctaveAssets,',
  '    };',
  '',
  '    const A = window.__OCT_ASSETS__ && window.__OCT_ASSETS__["webshims"];',
  '    window.__result.packFiles = A ? Object.keys(A.files).length : 0;',
  '    window.__result.packAddpath = A ? A.addpath : null;',
  '    if (!A) throw new Error("webshims.js 没加载");',
  '',
  '    let wrote = 0;',
  '    for (const k of Object.keys(A.files)) {',
  '      const dir = k.replace(/\\/[^/]*$/, "");',
  '      try { M.FS.mkdirTree(dir); } catch (e) {}',
  '      M.FS.writeFile(k, A.files[k]);',
  '      wrote++;',
  '    }',
  '    M.eval_string("addpath(\'" + A.addpath[0] + "\');");',
  '    window.__result.wroteM = wrote;',
  '    const ask = (code) => {',
  '      const p = "/tmp/_pr_" + Math.random().toString(36).slice(2) + ".txt";',
  '      M.eval_string("fid=fopen(\'" + p + "\',\'w\');" + code + ";fclose(fid);");',
  '      try { return new TextDecoder().decode(M.FS.readFile(p)); } catch (e) { return "(read-fail)"; }',
  '    };',
  '',
  '    // ★ 第二件必带品：__web_pause_ms__.oct（导出 __web_run_js__ 这个兄弟别名）。',
  '    //   它**不在** octave.data 也不在 webshims.js —— 是站点的 .oct 资产（10.8 KB）。',
  '    const OCT_URL = "/assets/oct/__web_pause_ms__.oct";',
  '    const octDir = "/usr/src/octave/m/oct";',
  '    try { M.FS.mkdirTree(octDir); } catch (e) {}',
  '    const bin = new Uint8Array(await (await fetch(OCT_URL)).arrayBuffer());',
  '    M.FS.writeFile(octDir + "/__web_pause_ms__.oct", bin);',
  '    // 别名 = 符号链接（webio 先例）。MEMFS 的 symlink 走 FS.symlink。',
  '    const ALIASES = ["__web_suspend_ok__", "__web_ginput_arm__",',
  '                     "__web_ginput_pending__", "__web_ginput_pop__", "__web_run_js__"];',
  '    let aliased = 0;',
  '    for (const a of ALIASES) {',
  '      try { M.FS.symlink(octDir + "/__web_pause_ms__.oct", octDir + "/" + a + ".oct"); aliased++; }',
  '      catch (e) { try { M.FS.writeFile(octDir + "/" + a + ".oct", bin); aliased++; } catch (e2) {} }',
  '    }',
  '    M.eval_string("addpath(\'" + octDir + "\');");',
  '    window.__result.octBytes = bin.length;',
  '    window.__result.aliased = aliased;',
  '    window.__result.e3runjs = ask("fprintf(fid,\'%d\',exist(\'__web_run_js__\'))");',
  '',
  '    window.__result.e3exist = ask("fprintf(fid,\'%d\',exist(\'__webshim_python_cmd__\',\'file\'))");',
  '    window.__result.e3which = ask("fprintf(fid,\'%s\',which(\'system\'))");',
  '',
  '    const t0 = performance.now();',
  '    const mod = await import("./pyodide/pyodide.mjs");',
  '    const py = await mod.loadPyodide({ indexURL: location.origin + "/pyodide/" });',
  '    window.pyodide = py;   // ★ 桥按**全局名**找它（octave-core.js 的 installLayer 也这么做）',
  '    await py.loadPackage("sympy");',
  '    window.__result.pyodideReadyMs = Math.round(performance.now() - t0);',
  '    window.__result.coi = {',
  '      coi: crossOriginIsolated,',
  '      sab: typeof SharedArrayBuffer,',
  '      suspending: typeof WebAssembly.Suspending,',
  '      promising: typeof WebAssembly.promising,',
  '    };',
  '    window.__result.syncVersion = String(py.runPython("import sympy; sympy.__version__"));',
  '    window.__result.syncDiff = String(py.runPython(',
  '      "import sympy; x=sympy.Symbol(\'x\'); str(sympy.diff(sympy.sin(x), x))"));',
  '',
  '    window.__octaveRunPython = function (srcPath, outPath) {',
  '      // ⚠️ 必须读**全局** pyodide：本函数由 emscripten_run_script 在全局作用域 eval，',
  '      //    闭包变量看不见（探针第一版就因此误报"Pyodide 未就绪"）。',
  '      const P = window.pyodide;',
  '      window.__result.bridgeCalls = (window.__result.bridgeCalls || 0) + 1;',
  '      window.__result.pyAtBridge = !!(P && typeof P.runPython === "function");',
  '      let out;',
  '      try {',
  '        if (!P || typeof P.runPython !== "function") {',
  '          out = "__OCTAVE_PY_NO_RUNTIME__";',
  '          throw { __sentinel: true };',
  '        }',
  '        const code = M.FS.readFile(srcPath, { encoding: "utf8" });',
  '        const chunks = [];',
  '        let prev = null;',
  '        try { prev = P.setStdout({ batched: (s) => chunks.push(String(s)) }); } catch (e) {}',
  '        try { P.runPython(code); } catch (e) {',
  '          if (!chunks.length) chunks.push(String(e && e.message ? e.message : e));',
  '        } finally { try { if (prev) P.setStdout(prev); } catch (e) {} }',
  '        out = chunks.join("");',
  '        window.__result.bridgeOutLen = out.length;',
  '        window.__result.bridgeOutRaw = out.slice(0, 40);',
  '      } catch (e) {',
  '        window.__result.bridgeErr = String((e && e.message) || e).slice(0, 200);',
  '        if (!out) out = "BRIDGE_ERR: " + String((e && e.message) || e);',
  '      }',
  '      try { M.FS.writeFile(outPath, out); } catch (e) {}',
  '    };',
  '',
  '    // ⚠️ E5 的表达式要**先**把 system() 的结果落到一个变量，再写进我们的 out 文件。',
  '    //   第一版把 v 直接 fprintf 进 fid，而 system() 内部也用 fid/fopen —— 变量撞车。',
  '    // ⚠️ Octave 的 system()：**单输出 = 退出码**，双输出才是 [status, output]。',
  '    //    第一版写成 v = system(...) ⇒ v 是 0 ⇒ char(0) = \'\x00\' ⇒ 假红。',
  '    //    探针自己的错，不是产品缺陷（桥那侧记录的 bridgeOutRaw 一直是 \'42\'）。',
  '    window.__result.e5raw = ask("[st, v] = system(\'python3 -c \\"print(6*7)\\"\');" +',
  '      "fprintf(fid, \'st=%d out=%s\', st, v)");',
  '',
  '    window.__octaveRunPython = function (srcPath, outPath) {',
  '      try { M.FS.writeFile(outPath, "__OCTAVE_PY_NO_RUNTIME__"); } catch (e) {}',
  '    };',
  '    window.__result.e6 = ask("[st2, v2] = system(\'python3 -c \\"print(1)\\"\');" +',
  '      "fprintf(fid, \'%s\', v2)");',
  '',
  '    window.__result.phase = "done";',
  '  } catch (e) {',
  '    window.__result.phase = "error";',
  '    window.__result.error = String((e && e.stack) || e).slice(0, 400);',
  '    log("FATAL", window.__result.error);',
  '  }',
  '})();',
  '</script>',
].join('\n');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.data': 'application/octet-stream',
  '.whl': 'application/octet-stream', '.zip': 'application/zip', '.json': 'application/json',
};

function serve() {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      if (url === '/' || url === '/index.html') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(PAGE);
        return;
      }
      const rel = url.replace(/^\/+/, '');
      const cand = rel.startsWith('pyodide/')
        ? path.join(PYODIDE, rel.slice('pyodide/'.length))
        : path.join(SITE, rel);
      if (!fs.existsSync(cand) || fs.statSync(cand).isDirectory()) {
        res.writeHead(404); res.end('nf'); return;
      }
      // ★ 故意不发任何 COOP/COEP：课程站是静态托管，拿不到 COI 头
      res.writeHead(200, { 'content-type': MIME[path.extname(cand)] || 'application/octet-stream' });
      fs.createReadStream(cand).pipe(res);
    });
    s.listen(0, '127.0.0.1', () => resolve({ s, port: s.address().port }));
  });
}

const { s, port } = await serve();
const br = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'],
});
let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS' : 'fail') + ' | ' + label + ' :: ' + String(detail).slice(0, 220));
};

try {
  const page = await (await br.newContext()).newPage();
  const lines = [];
  page.on('console', (m) => lines.push(m.text()));
  page.on('pageerror', (e) => lines.push('[pageerror] ' + e.message));
  await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(
    () => window.__result && (window.__result.phase === 'done' || window.__result.phase === 'error'),
    null, { timeout: 400000 }).catch(() => {});
  const r = (await page.evaluate(() => window.__result)) || {};

  const glue = fs.readFileSync(path.join(SITE, 'octave.js'), 'utf8');
  check(glue.indexOf('webshim') < 0,
    'E1 ① 胶水/产物里 webshim 零命中 ⇒ 宿主 .m 不在 octave.data',
    'octave.js 里 webshim 出现 ' + (glue.split('webshim').length - 1) + ' 次');
  check(r.packFiles > 0, 'E2 ② webshims.js 可自包含装载（.m 元数据可读）',
    r.packFiles + ' 个 .m / addpath=' + r.packAddpath);
  check(r.e3exist === '2' && String(r.e3which).indexOf('webshims') >= 0,
    'E3 ★ 自己写 MEMFS + addpath 后 system 解析到 webshims/system.m',
    'exist=' + r.e3exist + ' which=' + r.e3which + ' wrote=' + r.wroteM);
  check(r.e3runjs === '3',
    'E3c ★ __web_run_js__ 可解析（__web_pause_ms__.oct + 别名已装）',
    'exist=' + r.e3runjs + ' oct=' + r.octBytes + 'B aliased=' + r.aliased);
  check(r.corePresent && r.corePresent.createOctaveCore === 'undefined',
    'E3b ③ 页面确实没有 octave-core.js（极简前提成立）', JSON.stringify(r.corePresent));
  check(r.syncDiff === 'cos(x)' && r.syncVersion,
    'E4 ★ Pyodide 无 COI/无 JSPI/无 Worker 主线程同步跑通',
    'sympy=' + r.syncVersion + ' diff=' + r.syncDiff + ' coi=' + JSON.stringify(r.coi) +
    ' ready=' + r.pyodideReadyMs + 'ms');
  check(/42/.test(String(r.e5raw)),
    'E5 ★ system() 的 python 分支在极简环境端到端返回 42', r.e5raw);
  // ★ E6 的真实形态：`system.m` 在 Pyodide 不在时**抛清晰错误**（不是返回空串）——
  //   那是比"返回哨兵"更强的保证：调用方拿到的是异常，绝不会把空字符串当 Python 输出。
  //   判据 = console 里出现过那句人话错误，且 `.m` 侧调用**没有**静默返回空。
  const errSeen = lines.some((l) => /符号计算需要 Python 运行时/.test(l));
  check(errSeen, 'E6 ☆ 反向：py 不在时 .m 侧抛清晰错误（不静默返回空）',
    errSeen ? '命中「符号计算需要 Python 运行时」' : ('未命中；e6=' + JSON.stringify(r.e6)));

  console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  if (r.error) console.log('页面错误：' + r.error);
  fs.mkdirSync(path.dirname(OUTJ), { recursive: true });
  fs.writeFileSync(OUTJ, JSON.stringify({
    probe: 'wasm32-symbolic-minimal', at: new Date().toISOString(),
    result: r, lines: lines.slice(-40), pass, fail,
  }, null, 1));
  console.log('读数写入 ' + OUTJ);
  await page.context().close();
} finally {
  await br.close();
  s.close();
}
process.exit(fail === 0 ? 0 : 1);
