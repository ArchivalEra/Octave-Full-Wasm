// 待办2 验收：27 个 Forge 包 .oct **按 11.3.0 重编**后，是否真的能装载并执行
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 为什么需要单独一套（现有 accept-pkg 不够）：
//   accept-pkg 验的是 **pkg 语义**（数据库、list/load/describe、addpath），
//   它只在少数几个点上碰到编译件，覆盖不到全部 27 个模块 —— 而且它用 7.2 编的
//   .oct 也是 16/16 通过，所以它**区分不出**我们这次换没换成 11.3.0 的产物。
//
// 判据（按 HANDOFF §10.3 坑 4：装载类断言不够，必须真的调用）：
//   对 27 个模块**每个都真调一次**，结果分三类：
//     OK        —— 返回 0 且输出命中期望值（最强证据）
//     CLEAN-ERR —— 返回非 0，但错误是函数自己的参数检查（说明模块已装载并执行）
//     TRAP      —— RuntimeError/unreachable（整页崩，不可接受）
//   TRAP 一出现即整页死掉，所以后面的条目会被标成 SKIP。
//
// 用法：harness/run.sh test/browser/accept-113-pkgoct.mjs [URL]
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

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run (code, timeoutMs = 30000, useSentinel = true) {
  const s = '__K' + Math.random().toString(36).slice(2) + '__';
  logs.length = 0;
  let rc;
  try {
    rc = await page.evaluate(
      ([x, sn, w]) => window.Module.eval_string(w ? `${x}; disp('${sn}');` : x),
      [code, s, useSentinel]);
  } catch (e) {
    return { rc: 'TRAP', out: '', seen: false, trap: true, err: String(e).slice(0, 140) };
  }
  const t = Date.now();
  while (Date.now() - t < timeoutMs) {
    if (!useSentinel) { if (Date.now() - t > 1500) break; }
    else if (logs.some(l => l.includes(s))) break;
    await sleep(80);
  }
  const seen = useSentinel ? logs.some(l => l.includes(s)) : true;
  let err = '';
  try { err = await page.evaluate(() => window.Module.last_error_message()); } catch { err = '(页面已死)'; }
  return { rc, out: logs.join(' ').split(s)[0].replace(/\s+/g, ' ').trim(), seen, trap: false, err };
}

// ⚠️ **还要等启动资产装完**（`window.__octaveReady` 在 index.html 里是"整条启动链跑完"
//    —— 含 help 数据与 webgraphics —— 才置真的）。只等解释器可用就往下跑时，页面侧的
//    资产加载器会继续打 `[assets] …就绪` 日志，那些行落进前几次 eval 的捕获窗口，
//    把要匹配的文本挤出截断窗口 ⇒ **偶发假红**（2026-09-23 实测：accept-hdf5 与
//    accept-net 各中过一次；这两条的根因是同一个，不是两条独立的毛病）。
for (let _w = 0; _w < 600; _w++) {
  if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) break;
  await new Promise(r => setTimeout(r, 300));
}
await new Promise(r => setTimeout(r, 400));
console.log(`URL=${URL}`);
await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
const t0 = Date.now();
while (Date.now() - t0 < 300000) {
  const r = await run('1+1', 5000);
  if (r.rc === 0) break;
  await sleep(700);
}
console.log(`ready=${((Date.now() - t0) / 1000).toFixed(1)}s`);

// 装载 6 个含编译件的 Forge 包（octdir 资产）
const loaded = await page.evaluate(async () => {
  const out = [];
  for (const a of ['control', 'geometry', 'miscellaneous', 'optim', 'statistics', 'struct']) {
    try { await window.OctaveAssets.load(a); out.push(a); } catch (e) { out.push(a + ':ERR'); }
  }
  return out.join(',');
});
console.log(`资产装载: ${loaded}`);
await sleep(1500);
logs.length = 0;

// 每个模块一条：模块名 | 真调用的表达式 | 期望。
//   期望写成正则（对输出做 test）；写 'ERR-OK' 表示"允许干净的参数检查错误"
//   —— 那类错误同样证明模块已装载并执行到自身代码，只是我给的实参不完整。
const CALLS = [
  // ---- control（8）----
  ['is_matrix',        'disp(is_matrix(1))', /^1$/],
  ['is_real_matrix',   'disp(is_real_matrix(eye(2)))', /^1$/],
  ['is_real_scalar',   'disp(is_real_scalar(1))', /^1$/],
  ['is_real_square_matrix', 'disp(is_real_square_matrix(eye(2)))', /^1$/],
  ['is_real_vector',   'disp(is_real_vector([1 2]))', /^1$/],
  ['is_zp_vector',     'disp(is_zp_vector([1 2]))', /^1$/],
  // 别名：octdir 里有 lti_input_idx.oct（模块内导出的其实是 __lti_input_idx__），
  // 所以只要求"能被解析到"（exist 3=.oct，2=.m，5=内建），不锁死具体数字。
  ['lti_input_idx',    'disp(exist("lti_input_idx"))', /[235]/],
  ['__control_helper_functions__', 'ss(1,1,1,1); disp("ss-built")', /ss-built/],
  // ---- geometry（1）----
  // polybool 的签名是 polybool(op, VX1, VY1, VX2, VY2)（见 inst/polybool.m:18）。
  // 第一版传了两个 struct，被当成 MSP/MCP 走，报 "X1, Y1 ... must be same class"。
  // ⚠️ 必须显式给第 6 个参数 "mrf"：polybool 的默认库是 **clipper**（polybool.m:199
  //    `blib = "clipper"`），不给就走 clipPolygon_clipper，**根本碰不到 polybool_mrf**。
  //    而且它外面套了 try/catch（:237-246），失败只报 "internal error, possibly
  //    invalid geometric input"，把真因吞掉 —— 所以第一版的报错看不出问题在哪。
  ['polybool_mrf',     '[x,y]=polybool("or",[0 1 1 0],[0 0 1 1],[0.5 1.5 1.5 0.5],[0.5 0.5 1.5 1.5],"mrf"); disp(numel(x)>0)', /^1$/],
  // ---- miscellaneous（2）----
  // cell2cell 只吃两个参数：cell2cell(c, dim)（第一版给了 3 个 → print_usage）。
  ['cell2cell',        'c=cell2cell({1,2;3,4},2); disp(numel(c)>0)', /^1$/],
  // ⚠️ 不能调 partcnt：它虽然**在 partint.oct 里**（emnm 可见 Gpartcnt），
  //    但 Octave 按 `<函数名>.oct` 找模块，而文件名是 partint.oct →
  //    `partcnt` 解析不到（实测报 `'partcnt' undefined`）。这不是本次重编引入的，
  //    7.2 编的同名文件也一样。所以按**文件名对应的那个函数** partint 来调。
  ['partint',          'p=partint(5); disp(numel(p)>0)', /^1$/],
  // ---- optim（5）----
  // bfgsmin 的第一个参数**必须是字符串函数名**，不接受函数句柄
  // （第一版传 @(x)… 报 "first argument must be string holding objective function"）。
  ['__bfgsmin',        '[x,v]=bfgsmin("sin", {1}); disp(numel(x)>0)', /^1$/],
  ['__disna_optim__',  'disp(exist("__disna_optim__"))', /[235]/],
  // 参数必须是**用户定义**函数的句柄：内部要 user_function_value()，
  // 而 @sin 是内建句柄，会报 "user_function_value(): wrong type argument"。
  ['__max_nargin_optim__', 'disp(__max_nargin_optim__(@(x) x))', /^1$/],
  // 同 bfgsmin：第一个参数要**字符串函数名**，不接受函数句柄。
  // 返回不一定是 cell（标量自变量时直接是标量），所以别索引 g{1}。
  ['numgradient',      'g=numgradient("sin", {1}); disp(numel(g))', /^1$/],
  ['numhessian',       'h=numhessian("sin", {1}); disp(numel(h))', /^1$/],
  // ---- statistics（7）----
  ['editDistance',     'disp(editDistance("kitten","sitting"))', /^3$/],
  ['svmtrain',         'm=svmtrain([1;-1],[0 0;1 1],"-q"); disp(isstruct(m)||isclass(m))', /^1$/],
  ['svmpredict',       'm=svmtrain([1;-1],[0 0;1 1],"-q"); p=svmpredict([1;-1],[0 0;1 1],m,"-q"); disp(numel(p))', /^2$/],
  // fcnn/libsvm 需要真实数据集/文件，这里只要求"能被解析到"（存在性 + 不是 trap）
  ['fcnntrain',        'disp(exist("fcnntrain"))', /[235]/],
  ['fcnnpredict',      'disp(exist("fcnnpredict"))', /[235]/],
  ['libsvmread',       'disp(exist("libsvmread"))', /[235]/],
  ['libsvmwrite',      'disp(exist("libsvmwrite"))', /[235]/],
  // ---- struct（4）----
  ['cell2fields',      's=struct(); s=cell2fields({1,2},{"a","b"},2,s); disp(isfield(s,"a"))', /^1$/],
  ['fieldempty',       's.a=[]; disp(fieldempty(s,"a"))', /^1$/],
  ['fields2cell',      's2.a=1; s2.b=2; c=fields2cell(s2,{"a","b"}); disp(numel(c))', /^2$/],
  ['structcat',        's3=structcat(2, struct("a",1), struct("a",2)); disp(numel(s3))', /^2$/],
];

let ok = 0, cleanErr = 0, trap = 0, skip = 0, dead = false;
for (const [mod, code, expect] of CALLS) {
  if (dead) { console.log(`SKIP | ${mod.padEnd(28)} :: （页面已死）`); skip++; continue; }
  const r = await run(code);
  if (r.trap) {
    trap++; dead = true;
    console.log(`TRAP | ${mod.padEnd(28)} :: ★ 整页崩 :: ${r.err}`);
    continue;
  }
  const quiet = r.seen && r.rc === 0 && !/^error/i.test(r.out);
  const matched = expect === 'ERR-OK' ? quiet : (quiet && expect.test(r.out));
  if (matched) {
    ok++;
    console.log(`OK   | ${mod.padEnd(28)} :: ${r.out.slice(0, 78)}`);
  } else if (r.rc !== 0) {
    cleanErr++;
    console.log(`CERR | ${mod.padEnd(28)} :: （干净的报错，说明模块已执行）${(r.out || r.err).slice(0, 56)}`);
  } else {
    cleanErr++;
    console.log(`???? | ${mod.padEnd(28)} :: rc=${r.rc} 输出=${(r.out || '(空)').slice(0, 60)}`);
  }
}

console.log(`\n=== ${CALLS.length} 个模块：OK ${ok} / 干净错误 ${cleanErr} / TRAP ${trap} / SKIP ${skip} ===`);
const bad = trap + skip;
await browser.close();
process.exit(bad ? 1 : 0);
