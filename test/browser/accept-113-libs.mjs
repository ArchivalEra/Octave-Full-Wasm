// ④ 逐库数值断言（树内可达的那部分）
//
// 分界很重要：**「库开起来了」不等于「函数可用」**。
//   - 树内可达（本套件验）：HDF5（save -hdf5）、SuiteSparse/CXSparse（稀疏 qr/lu/chol/inv）、
//     FFTW（fft）、zlib/bz2（压缩 save）、RapidJSON（jsonencode/jsondecode）、
//     qrupdate（cholupdate/qrinsert 之类）。
//   - **需要 .oct 车道**（不属于本套件）：ARPACK 的 eigs（__eigs__.oct）、
//     Qhull 的 delaunay/convhulln（__delaunayn__.oct）、GLPK 的 glpk（__glpk__.oct）、
//     libsndfile 的 audioread（audioread.oct）—— 那些在 S5 的资产车道上验。
//
// 期望值一律取自**本机 octave 11.3.0**（同版参照），不凭"应该对"。
//
// 用法：harness/run.sh test/browser/accept-113-libs.mjs [URL]
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8762/';
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));

let pass = 0, fail = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run (code, timeoutMs = 25000, useSentinel = true) {
  const s = '__SW' + Math.random().toString(36).slice(2) + '__';
  logs.length = 0;
  const rc = await page.evaluate(
    ([x, sentinel, want]) => window.Module.eval_string(want ? `${x}; disp('${sentinel}');` : x),
    [code, s, useSentinel]);
  const t = Date.now();
  while (Date.now() - t < timeoutMs) {
    if (!useSentinel) { if (Date.now() - t > 1200) break; }
    else if (logs.some(l => l.includes(s))) break;
    await sleep(80);
  }
  const seen = useSentinel ? logs.some(l => l.includes(s)) : true;
  const out = logs.join(' ').split(s)[0].replace(/\s+/g, ' ').trim();
  return { rc, out, seen, err: await page.evaluate(() => window.Module.last_error_message()) };
}

// 断言：输出里必须出现期望子串（期望值来自本机 11.3.0）
async function ev (name, code, expect) {
  const r = await run(code);
  let ok = r.seen && r.rc === 0 && !/^error/i.test(r.out);
  if (ok && expect !== undefined) ok = r.out.includes(expect);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${name.padEnd(30)} :: ${(r.out || r.err || '(空)').slice(0, 92)}`);
}

console.log(`URL=${URL}`);
await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
const t0 = Date.now();
while (Date.now() - t0 < 300000) {
  try { const r = await run('1+1', 4000); if (r.seen && r.rc === 0) break; } catch {}
  await sleep(700);
}
console.log(`ready=${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

console.log('--- HDF5 ---');
await ev('save -hdf5 往返', "A=magic(4); save('-hdf5','/tmp/t.h5','A'); clear A; load('/tmp/t.h5'); disp(A(1,1))", '16');
await ev('hdf5 whos -file',  "s=whos('-file','/tmp/t.h5'); disp(s(1).name)", 'A');

console.log('--- FFTW（双精度走 FFTW 后端）---');
await ev('fft 谱峰',         "x=sin(2*pi*8*(0:63)/64); y=abs(fft(x)); [~,k]=max(y); disp(k-1)", '8');
await ev('ifft 往返',        "x=rand(1,16); disp(max(abs(ifft(fft(x))-x))<1e-12)", '1');

console.log('--- SuiteSparse / CXSparse ---');
await ev('sparse qr: s=Q*R', "s=sparse([1 0 0;0 2 0;0 0 3]); [Q,R]=qr(s); disp(norm(full(s-Q*R))<1e-12)", '1');
await ev('sparse lu',        "s=sparse([4 1;1 3]); [L,U,P]=lu(s); disp(norm(full(P*s-L*U))<1e-12)", '1');
await ev('sparse chol',      "s=sparse([4 1;1 3]); R=chol(s); disp(norm(full(R'*R-s))<1e-12)", '1');
await ev('sparse inv',       "s=sparse([4 1;1 3]); d=inv(s)*s; disp(norm(full(d-eye(2)))<1e-12)", '1');

console.log('--- zlib / bz2（压缩 save）---');
await ev('save -z 往返',     "A=[1 2;3 4]; save('-z','/tmp/tz.mat','A'); clear A; load('/tmp/tz.mat'); disp(A(2,2))", '4');
await ev('save -v7 往返',    "A=[1 2;3 4]; save('-v7','/tmp/t7.mat','A'); clear A; load('/tmp/t7.mat'); disp(A(2,2))", '4');

console.log('--- RapidJSON ---');
await ev('json 往返',        "s=jsonencode(struct('a',1,'b',[1 2 3])); d=jsondecode(s); disp(d.b(3))", '3');

console.log('--- qrupdate ---');
await ev('cholupdate',       "R=chol([4 1;1 3]); R2=cholupdate(R, [1;0]); disp(norm(full(R2'*R2-[5 1;1 3]))<1e-12)", '1');

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
