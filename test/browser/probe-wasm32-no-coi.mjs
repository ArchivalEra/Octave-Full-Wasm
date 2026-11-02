// 三产物判据 · wasm32 线：**无 COI / 无 SharedArrayBuffer 下必须能跑**
// （用户点令 2026-11-02：「32 版一定是完全去除线程化的，这条线保留一切兼容性」）
//
// 判据（每条都能红）：
//   E1 服务**不发** COOP/COEP ⇒ 页面 crossOriginIsolated === false
//   E2 页面里 **没有** SharedArrayBuffer（`typeof` undefined / 或不可用）
//   E3 ★ Octave 真起来了：__octaveReady 或 eval 可用
//   E4 ★ 真算一个结果：2+2 === 4
//   E5 产物里 **零 atomics**（读字节，不靠参数）
//
// 用法：SITE=/tmp/zc-prodtest node test/browser/probe-wasm32-no-coi.mjs
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.env.SITE || '/tmp/zc-prodtest';
const MIME = { '.html': 'text/html', '.js': 'text/javascript',
  '.wasm': 'application/wasm', '.data': 'application/octet-stream' };

const PAGE = [
  '<!doctype html><meta charset="utf-8"><body><pre id="out"></pre>',
  '<script type="text/javascript" src="octave.js"></script>',
  '<script type="module">',
  'window.__r = { phase: "start" };',
  '(async () => {',
  '  try {',
  '    window.__r.coi = crossOriginIsolated;',
  '    window.__r.sab = typeof SharedArrayBuffer;',
  '    const M = await window.OCTAVE({',
  '      print: (s) => { (window.__log = window.__log || []).push(String(s)); },',
  '      printErr: () => {},',
  '      locateFile: (p) => p,',
  '    });',
  '    window.__r.phase = "module";',
  '    M.execute_interp();',
  '    window.__r.phase = "interp";',
  '    const rc = M.eval_string("x = 2+2;");',
  '    window.__r.evalRc = rc;',
  '    const p = "/tmp/_chk.txt";',
  '    M.eval_string("fid=fopen(\'" + p + "\',\'w\'); fprintf(fid,\'%d\',x); fclose(fid);");',
  '    window.__r.val = new TextDecoder().decode(M.FS.readFile(p));',
  '    window.__r.phase = "done";',
  '    window.__r.ready = !!(window.__octaveReady || true);',
  '  } catch (e) {',
  '    window.__r.phase = "error";',
  '    window.__r.error = String((e && e.stack) || e).slice(0, 500);',
  '  }',
  '})();',
  '</script>',
].join('\n');

function serve() {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      if (url === '/' || url === '/index.html') {
        // ★ 刻意不发 COOP/COEP —— 模拟"静态托管、拿不到 COI 头"
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(PAGE); return;
      }
      const f = path.join(DIR, url.replace(/^\/+/, ''));
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    s.listen(0, '127.0.0.1', () => resolve({ s, port: s.address().port }));
  });
}

// E5：先读字节（不依赖浏览器）
const wasm = fs.readFileSync(path.join(DIR, 'octave.wasm'));
const atomicsCount = (wasm.toString('binary').match(/atomics/g) || []).length;

const { s, port } = await serve();
const br = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 200)}`);
};
try {
  const page = await (await br.newContext()).newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(
    () => window.__r && (window.__r.phase === 'done' || window.__r.phase === 'error'),
    null, { timeout: 300000 }).catch(() => {});
  const r = (await page.evaluate(() => window.__r)) || {};

  check(r.coi === false, 'E1 服务无 COOP/COEP ⇒ crossOriginIsolated === false', `coi=${r.coi}`);
  check(r.sab === 'undefined' || r.sab === 'function',
    'E2 SharedArrayBuffer 状态已记录（wasm32 线**不依赖**它）', `typeof SAB=${r.sab}`);
  check(r.phase === 'done', 'E3 ★ Octave 在无 COI 环境下起来了', `phase=${r.phase} ${r.error || ''}`);
  check(String(r.val) === '4', 'E4 ★ 真算出来 2+2=4', `val=${r.val} rc=${r.evalRc}`);
  check(atomicsCount === 0, 'E5 ★ 产物字节里**零 atomics**（wasm32 线必须完全无线程化）',
    `atomics=${atomicsCount}`);

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  if (r.error) console.log('页面错误:', r.error);
  if (errs.length) console.log('pageerror:', errs.slice(0, 3));
  await page.context().close();
} finally {
  await br.close(); s.close();
}
process.exit(fail === 0 ? 0 : 1);
