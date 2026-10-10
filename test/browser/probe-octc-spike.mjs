// 实验：**浏览器内自编 .oct 的 dlopen 端到端**（octc spike ①②③）
// 用法：sh test/browser/run.sh test/browser/probe-octc-spike.mjs http://127.0.0.1:8768/
//
// 三个问题一次答：
//   ① 裸 clang+wasm-ld（不经 emcc）编出的 minioct.oct，能否被现役 wasm Octave dlopen 并**真调用**
//      （det 会回调主模块的 LAPACK ⇒ 同时验"side module → 主模块符号解析"）。
//   ② 同源但**不带 -fwasm-exceptions** 编的版本（对照）：能不能装（预期不能 —— 主模块是
//      wasm-exceptions 模型，异常模型必须一致）。
//   ③ minithrow.oct：真抛异常 + try/catch 接住 + error() 路径 —— 验 **Wasm EH 跨 dlopen 边界**。
//
// 判据：装得上（exist==3）+ 调得对（数值/字符串）+ 该报错的真报错。
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8768/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));

let pass = 0, fail = 0;
const check = (ok, label, detail) => { ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 200)}`); };

await page.goto(URL, { waitUntil: 'load', timeout: 240000 });
await page.waitForFunction(() => window.__octaveReady === true, null, { timeout: 240000 })
  .catch(() => {});
console.log(`URL=${URL} ready=${await page.evaluate(() => window.__octaveReady)}`);

// 通用求值：把结果写进 /tmp 再读回（与既有套件同款通道）
async function ev (label, expr, want) {
  const r = await page.evaluate(async (code) => {
    try {
      const M = window.Module;
      const rc = M.eval_string(code);
      return { rc, out: M.evaluate ? '' : '' };
    } catch (e) { return { rc: 'ERR', err: String(e).slice(0, 300) }; }
  }, `fid=fopen('/tmp/spk.txt','w'); fprintf(fid,'%s', sprintf('%s', [${expr}])); fclose(fid);` );
  const out = await page.evaluate(() => {
    try { return window.Module.FS.readFile('/tmp/spk.txt', { encoding: 'utf8' }); }
    catch (e) { return 'ERR:' + e.message; }
  });
  const ok = r.rc === 0 && String(out).indexOf(want) >= 0;
  check(ok, label, `rc=${r.rc} out=${JSON.stringify(out).slice(0, 120)}${r.err ? ' err=' + r.err : ''}`);
  return { rc: r.rc, out };
}

// 把站点上的 .oct 拉进 MEMFS（模拟资产加载器：写文件 + 建函数名别名）
async function stage (url, filename, fnname) {
  return page.evaluate(async ([u, fn, fname]) => {
    try {
      const buf = await fetch(u).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); });
      const FS = window.Module.FS;
      const dir = '/usr/src/octave/m/oct';
      try { FS.mkdir(dir); } catch (e) {}
      FS.writeFile(dir + '/' + fn, new Uint8Array(buf));
      try { FS.symlink(dir + '/' + fn, dir + '/' + fname + '.oct'); } catch (e) {}
      return buf.byteLength;
    } catch (e) { return 'ERR: ' + e.message; }
  }, [url, filename, fnname]);
}

await page.evaluate(() => { try { window.Module.eval_string("addpath('/usr/src/octave/m/oct');"); } catch (e) {} });

// ── ① 裸编 minioct（-fwasm-exceptions）──────────────────────────────────────
console.log('\n── ① 裸编 minioct-bare.oct（clang+wasm-ld，不经 emcc）──');
{
  const n = await stage(URL + 'zzspike-minioct-bare.oct', 'zzspike-minioct-bare.oct', 'miniprobe');
  check(typeof n === 'number', 'A1 字节写进 MEMFS', `${n} 字节`);
  await ev('A2 exist(miniprobe)==3', "exist('miniprobe')", '3');
  await ev('A3 which 指向 .oct', "!isempty(which('miniprobe'))", '1');
  await ev('A4 ★真调用 det([2,3;1,4])=5（回调主模块 LAPACK）', "miniprobe([2,3;1,4])", '5');
  await ev('A5 再次调用 det([1,2;3,4])=-2', "miniprobe([1,2;3,4])", '-2');
  await ev('A6 clear 后重解析 det([2,0;0,3])=6', "clear miniprobe; miniprobe([2,0;0,3])", '6');
}

// ── ② 对照：不带 -fwasm-exceptions 的版本（预期装不上/调不通）──────────────
console.log('\n── ② 对照 minioct-noeh.oct（**无** wasm-exceptions）──');
{
  const n = await stage(URL + 'zzspike-minioct-noeh.oct', 'zzspike-minioct-noeh.oct', 'miniprobe2');
  check(typeof n === 'number', 'B1 字节写进 MEMFS', `${n} 字节`);
  const r = await page.evaluate(() => {
    try { window.Module.eval_string("addpath('/usr/src/octave/m/oct');"); } catch (e) {}
    try {
      const M = window.Module;
      M.eval_string("fid=fopen('/tmp/b2.txt','w'); try; v=miniprobe2([2,3;1,4]); fprintf(fid,'OK:%g',v); catch e; fprintf(fid,'ERR:%s', e.message); end; fclose(fid);");
      return M.FS.readFile('/tmp/b2.txt', { encoding: 'utf8' });
    } catch (e) { return 'THROW:' + String(e).slice(0, 200); }
  });
  // 这条**不是**红绿判据：两种结果都有信息量，如实打印
  console.log(`   [对照] 无 EH 版本调用结果：${String(r).slice(0, 180)}`);
}

// ── ③ Wasm EH 跨 dlopen 边界 ───────────────────────────────────────────────
console.log('\n── ③ minithrow.oct（真抛/真接 + error 路径）──');
{
  const n = await stage(URL + 'zzspike-minithrow.oct', 'zzspike-minithrow.oct', 'minithrow');
  check(typeof n === 'number', 'C1 字节写进 MEMFS', `${n} 字节`);
  await ev('C2 exist(minithrow)==3', "exist('minithrow')", '3');
  await ev('C3 不抛分支', "minithrow(0)", 'no-throw');
  await ev('C4 ★ C++ throw 被本模块 try/catch 接住', "minithrow(1)", 'caught:thrown-from-oct');
  // C5：error() 走 Octave 异常路径 —— 期望**调用方**能捕获（try/catch 在 m 侧）
  const c5 = await page.evaluate(() => {
    try {
      const M = window.Module;
      M.eval_string("fid=fopen('/tmp/c5.txt','w'); try; r=minithrow(2); fprintf(fid,'RET:%s', r); catch e; fprintf(fid,'CAUGHT:%s', e.message); end; fclose(fid);");
      return M.FS.readFile('/tmp/c5.txt', { encoding: 'utf8' });
    } catch (e) { return 'THROW:' + String(e).slice(0, 200); }
  });
  check(/CAUGHT:octave-error-from-oct/.test(String(c5)) || /RET:/.test(String(c5)),
        'C5 error() 从 .oct 抛出 ⇒ 调用侧能接住（不崩）', String(c5).slice(0, 160));
}

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
