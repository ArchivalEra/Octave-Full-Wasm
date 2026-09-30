// 探针（工单 02）：E2 线程版在 dlopen 的 `.oct` 路径上**不返回** —— 到底卡在哪一段？
//
// ## 它在问什么
//
// 已知（实测，台账 `e2_threaded_oct_rc`）：E2 **线程版**在 `accept-113-oct` 那条路上
// 跑满 600 s 不完成（`rc=124`），而**同一条链接**的单线程变体同套件**数秒级通过**、
// 车道基线 83 s。所以不是"慢"，是"不返回"。
//
// 这句结论原来的写法是：「在页面里先调 `openblas_set_num_threads(1)` 再跑同一路径」。
// 但那个旋钮**当时够不到** —— 三个产物的导出表（各 725 条）里**一条 BLAS 都没有**（实测）。
// ⇒ 工单 01 加了 `DIAG_EXPORTS` 口子（`--diag` 时并入 `--export-if-defined`），
//   本探针跑的就是**带那个导出的诊断档**。
//
// ## 两格与判据
//
//   格 A：裸跑 dlopen 的 `.oct` 路径           → 期望「不返回」（复现既有实测）
//   格 B：先 `openblas_set_num_threads(1)` 再跑同一路径
//          · 返回  ⇒ 定位在**多线程唤醒/并行执行**
//          · 不返回 ⇒ 定位在**线程版代码路径本身**（与线程数无关）
//
// 两格用**同一份产物**（只有 `set_num_threads` 那一处不同）⇒ 诊断档比线上慢这件事
// 在 A/B 之间抵消，不影响"返回 / 不返回"这个二值结论。
//
// ## 为什么探针必须能"在挂住时退出"
//
// 挂死的是 wasm 的**主线程** ⇒ 页面 JS 线程被占住 ⇒ `page.evaluate` 的 Promise
// **永不 settle**。所以：
//   · 不能用"轮询哨兵"那套（`accept-113-oct` 的 `run()` 就是这么挂住的）；
//   · 必须 `Promise.race` 一个硬超时；
//   · 每格**独立浏览器**（挂住的 renderer 杀不掉，只能丢）；
//   · 结尾**显式 `process.exit`** —— 一个"检测挂死"的探针如果自己会挂，它就没用。
//
// 用法：harness/run.sh test/browser/probe-e2-threads.mjs <URL>
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8792/';
const CELL_TIMEOUT_MS = Number(process.env.CELL_TIMEOUT_MS || 300000);   // 5 分钟/格
const READY_TIMEOUT_MS = 120000;

let pass = 0, fail = 0;
const results = [];

function check (ok, name, detail) {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${name.padEnd(46)} :: ${String(detail).slice(0, 100)}`);
}

async function newBrowser () {
  return chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'],
  });
}

// 一格 = 一个独立浏览器 + 一个独立页面。返回 {prep, verdict, detail}。
async function cell (name, opts) {
  const LIMIT = opts.timeout || CELL_TIMEOUT_MS;
  const browser = await newBrowser();
  const page = await browser.newPage();
  const logs = [];
  page.on('console', m => logs.push(m.text()));
  page.on('pageerror', e => logs.push('[pageerror] ' + e.message));

  let prep = null, verdict = 'unknown', detail = '';
  try {
    if (opts.initScript) await page.addInitScript(opts.initScript);
    await page.goto(URL, { waitUntil: 'load', timeout: READY_TIMEOUT_MS });
    // 等启动链跑完（含 help 数据与 webgraphics —— 见 accept-113-oct 里那条实测注释）
    for (let w = 0; w < 400; w++) {
      if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) break;
      await new Promise(r => setTimeout(r, 300));
    }
    // 选档自证：本探针只在**线程档**上有意义（单线程档不会挂）
    const lane = await page.evaluate(() => ((window.__octaveCaps || {}).lane || {}).chosen || '?');
    check(lane === 'threads', `${name} · 页面跑的是线程档`, `lane=${lane}`);

    // 装夹具（与 accept-113-oct 同一套动作：写 .oct + 建函数名符号链接 + addpath）
    if (!opts.noFixture) {
      const wrote = await page.evaluate(async () => {
        try {
          const buf = await fetch('threads/minioct.oct').then(r => r.arrayBuffer());
          const FS = window.Module.FS, dir = '/usr/src/octave/m/oct';
          try { FS.mkdir(dir); } catch (e) { /* 已存在 */ }
          FS.writeFile(dir + '/minioct.oct', new Uint8Array(buf));
          try { FS.symlink(dir + '/minioct.oct', dir + '/miniprobe.oct'); } catch (e) { /* 已存在 */ }
          return buf.byteLength;
        } catch (e) { return 'ERR: ' + e.message; }
      });
      check(typeof wrote === 'number', `${name} · 夹具装进 FS`, `${wrote} 字节`);
      await page.evaluate(() => window.Module.eval_string("addpath('/usr/src/octave/m/oct');"));
    }

    // 本格特有的"准备"（格 B 在这里调 set_num_threads）
    if (opts.prepare) prep = await opts.prepare(page);

    // ★ 关键一步：硬超时赛跑。挂住的 wasm 会把 evaluate 的 Promise 永远挂着。
    const CODE = opts.code || "printf('%.10g', miniprobe([2,3;1,4])); disp('__E2DONE__');";
    const racing = page.evaluate(c => window.Module.eval_string(c), CODE)
      .then(() => 'returned')
      .catch(e => 'error: ' + String(e).slice(0, 90));
    let timer;
    const hung = new Promise(res => { timer = setTimeout(() => res('hung'), LIMIT); });
    verdict = await Promise.race([racing, hung]);
    clearTimeout(timer);
    // ⚠️ Octave 层的错误（error()/未定义函数）**不会**让 eval_string 抛 JS 异常 ⇒ verdict 仍是
    //    `returned`。判"这一格干了什么"要另读 last_error_message（F 格靠它区分"未定义"）。
    const lastErr = verdict === 'returned'
      ? await page.evaluate(() => { try { return String(window.Module.last_error_message() || ''); } catch (e) { return ''; } }).catch(() => '')
      : '';
    detail = verdict === 'returned'
      ? `输出=${logs.join(' ').split('__E2DONE__')[0].replace(/\s+/g, ' ').trim().slice(0, 45)}`
        + (lastErr ? ` ｜ last_error=${lastErr.slice(0, 55)}` : '')
      : (verdict === 'hung' ? `>${LIMIT / 1000}s 未返回（100% CPU 的典型形状）` : verdict);
  } catch (e) {
    verdict = 'threw: ' + String(e).slice(0, 90);
    detail = verdict;
  } finally {
    // 挂住的 renderer 关不掉是正常的 ⇒ 关不掉就算了，别让清理动作本身把探针拖住
    await Promise.race([browser.close(), new Promise(r => setTimeout(r, 8000))]).catch(() => {});
  }
  results.push({ name, prep, verdict, detail });
  return { prep, verdict, detail };
}

console.log(`URL=${URL}   每格超时=${CELL_TIMEOUT_MS / 1000}s`);

// ── 前置：本探针只对**诊断档**有意义 ────────────────────────────────────────────
// 为什么必须有这一步：工单 01 的导出只出现在 `--diag` 产物上。拿线上站点（单线程 E2）跑本探针，
// 格 A 会**瞬间返回**（单线程不挂）⇒ 断言 `A === 'hung'` 报红 —— 那是一个**假红**：
// 探针没错、站点没错，是"用错了地方"。而假红比不跑更坏（会被人一律忽略，最后连真红也不看）。
// 所以：够不到诊断符号 ⇒ 打一条 SKIP 并 **exit 0**，理由写清楚。
// （`sweep.sh` 只传 URL、不传清单里的 env ⇒ 探针**必须自己把关**，见 build/sweep.sh:74。）
async function precondition () {
  const browser = await newBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(URL, { waitUntil: 'load', timeout: READY_TIMEOUT_MS });
    for (let w = 0; w < 400; w++) {
      if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) break;
      await new Promise(r => setTimeout(r, 300));
    }
    const lane = await page.evaluate(() => ((window.__octaveCaps || {}).lane || {}).chosen || '?');
    const t = await page.evaluate(() => typeof (window.Module || {})._openblas_set_num_threads);
    return { lane, hasExport: t === 'function' };
  } finally {
    await Promise.race([browser.close(), new Promise(r => setTimeout(r, 8000))]).catch(() => {});
  }
}

const pre = await precondition();
console.log(`前置：lane=${pre.lane}  诊断导出=${pre.hasExport ? '在' : '不在'}`);
if (!pre.hasExport) {
  console.log('');
  console.log(`SKIP | 这个站点上没有诊断导出（Module._openblas_set_num_threads 不是函数）`);
  console.log(`       本探针只对 \`--diag\` 产物有意义（工单 01 的 DIAG_EXPORTS）。`);
  console.log(`       用诊断站点跑：E2_OPENBLAS=<openblas目录> relink.sh link threads --out <dir> --diag，`);
  console.log(`       再把那份产物放进某个站点的 threads/，然后 probe-e2-threads.mjs <那个站点URL>。`);
  // ⚠️ 汇总行必须**恰好**合规（sweep.sh:108 的正则）；"不适用"写在前一行。
  console.log('（不适用：不是通过也不是失败）');
  console.log('=== 0 PASS / 0 FAIL ===');
  process.exit(0);
}

// ── 工单 16 的**轻量二分格**（先跑，别让 A/B 的 5 分钟挂死挡路）─────────────────
// 选格：CELLS=C,D,E,F,A,B（默认全跑）。E/F 是 2026-09-29 补的**判别格**：
//   C · 只 dlopen 不进 LAPACK：miniprobe(1)（非方阵 ⇒ 在 determinant **之前**报错）
//   E · 纯 error() 路径（**不装夹具 ⇒ 无 dlopen**）：`error('boom')` —— 判别"是不是 error 本身就挂"
//   F · 同一句 miniprobe(1) 但**不装夹具**（函数不存在 ⇒ 干净"未定义"错误，**不 dlopen**）
//       ⇒ E/F 都返回而 C 挂 ⇒ 墙**必须**经过 .oct 的 dlopen（把"error 路径"这个变量劈掉）
//   D · 纯 OpenBLAS 乘法：rand(300)*rand(300) —— **完全没有 dlopen** 参与
const CELLS = (process.env.CELLS || 'C,D,E,F,A,B').split(',').map(s => s.trim());
const CD_MS = Number(process.env.CD_TIMEOUT_MS || 90000);
const got = {};

if (CELLS.includes('C')) {
  console.log('--- 格 C：只 dlopen 不进 LAPACK（miniprobe(1) 应干净报错）---');
  got.C = await cell('C/只dlopen', { timeout: CD_MS, code: "miniprobe(1); disp('__E2DONE__');" });
  // 判据是"**返回与否**"，不是错误文本：装载成功 ⇒ 函数跑到自己的参数检查并干净报错
  // （scalar ⇒ "must be a numeric matrix"；方阵 ⇒ 会走到 determinant）。两者都算返回。
  check(got.C.verdict === 'returned',
    '★ C · 只 dlopen（.oct 在）⇒ **返回**（装载段活着；修好前这里是挂死）', got.C.detail);
}
if (CELLS.includes('E')) {
  console.log('--- 格 E：纯 error() 路径（无 dlopen）---');
  got.E = await cell('E/纯error', { timeout: CD_MS, noFixture: true, code: "error('boom');" });
  check(got.E.verdict === 'returned',
    '★ E · 纯 error() 返回（无 dlopen）⇒ error 路径本身不挂', got.E.detail);
}
if (CELLS.includes('F')) {
  console.log('--- 格 F：同一句 miniprobe(1) 但不装夹具（不 dlopen）---');
  got.F = await cell('F/无夹具', { timeout: CD_MS, noFixture: true, code: "miniprobe(1); disp('__E2DONE__');" });
  check(got.F.verdict === 'returned' && /not found|undefined|未定义/i.test(got.F.detail),
    '★ F · 同一句但**不 dlopen** ⇒ 干净报"未定义"并返回（判别格）', got.F.detail);
}
if (CELLS.includes('D')) {
  console.log('--- 格 D：纯 OpenBLAS 乘法（无 dlopen）---');
  got.D = await cell('D/纯BLAS', { timeout: CD_MS, noFixture: true,
    code: "r = rand(300)*rand(300); printf('__E2DONE__ %d', numel(r));" });
  check(got.D.verdict === 'returned', '★ D · 纯 OpenBLAS dgemm（无 dlopen）返回 ⇒ 墙不在计算本身',
    got.D.detail);
}
if (CELLS.includes('G')) {
  // ★ 工单 19 的判别格：**只强制内存增长，不碰 dlopen**。
  //   机制假设：Emscripten 的共享内存在 ALLOW_MEMORY_GROWTH 下要**所有线程到安全点**
  //   才能增长，而 OpenBLAS(USE_THREAD=1) 的池线程自旋 => 永远到不了安全点 =>
  //   需要增长的 dlopen 永不完成（100% CPU 忙等）。若"只增长"就挂 => 假设成立。
  console.log('--- 格 G：只强制内存增长（不 dlopen）---');
  got.G = await cell('G/只增长', { timeout: CD_MS, noFixture: true,
    code: "a = zeros(1, 200e6); a(end) = 1; printf('__E2DONE__ %d', numel(a));" });
  check(got.G.verdict === 'returned',
    '★ G · 纯内存增长（无 dlopen）返回 ⇒ 墙不在"增长"本身', got.G.detail);
}
if (CELLS.includes('H')) {
  // ★ 大 dgemm：**超过 OpenBLAS 的线程阈值**（D 格用 300² 可能走了单线程路径 ⇒ 没测到池）。
  //   挂 ⇒ 线程池计算路径本身卡；返回 ⇒ 池能干活，墙只在装载段。
  console.log('--- 格 H：大 dgemm（越过线程阈值，无 dlopen）---');
  got.H = await cell('H/大dgemm', { timeout: CD_MS, noFixture: true,
    code: "A=rand(1200); B=rand(1200); C=A*B; printf('__E2DONE__ %d', numel(C));" });
  check(got.H.verdict === 'returned',
    '★ H · 大 dgemm 返回 ⇒ 线程池计算可用（D 的 300² 可能低于阈值）', got.H.detail);
}
if (CELLS.includes('I')) {
  // ★ 工单 19 的判别格：**在模块初始化之前**把 OpenBLAS 的池关掉（NUM_THREADS=1）。
  //   若 dlopen 因此能过 ⇒ 池线程就是元凶（Emscripten 的 dlsync：dlopen 要其它线程回到
  //   事件循环应答，而自旋在原生代码里的池线程做不到）。
  //   做法：initScript 在页面脚本之前放一个 `window.Module = {ENV:{...}}` ——
  //   Emscripten 胶水是 `var Module = typeof Module != 'undefined' ? Module : {}` ⇒ 会合并。
  console.log('--- 格 I：初始化前关池（OPENBLAS_NUM_THREADS=1）后 dlopen ---');
  got.I = await cell('I/关池后dlopen', {
    timeout: CD_MS,
    initScript: () => { window.Module = Object.assign(window.Module || {}, { ENV: { OPENBLAS_NUM_THREADS: '1' } }); },
    code: "miniprobe([2,3;1,4]); disp('__E2DONE__');",
  });
  check(got.I.verdict === 'returned',
    '★ I · 初始化前关池 ⇒ dlopen 能过（池线程是 dlonen 挂死的元凶 ⇒ dlsync 假设成立）',
    got.I.detail);
}
if (CELLS.includes('L')) {
  // ★ 判别格：**先空闲一段时间**（让 OpenBLAS 的池线程从"自旋"转为"park"）再 dlopen。
  //   返回 ⇒ 墙只在"池在自旋"时存在（修法可以是"确保空闲"或缩短自旋）；
  //   仍挂 ⇒ **park 后的线程也不应答邮箱** ⇒ 任何长驻原生等待都不行（修法必须更深）。
  console.log('--- 格 L：空闲 5s 后 dlopen ---');
  got.L = await cell('L/空闲后dlopen', { timeout: CD_MS,
    code: "pause(5); miniprobe([2,3;1,4]); disp('__E2DONE__');" });
  check(got.L.verdict === 'returned', '★ L · 空闲后 dlopen 能过（墙只在自旋期）', got.L.detail);
}
if (CELLS.includes('A')) {
  console.log('--- 格 A：裸跑（期望"不返回"，复现既有实测）---');
  got.A = await cell('A/裸跑', {});
  check(got.A.verdict === 'hung', 'A · 复现"不返回"', got.A.detail);
}
if (CELLS.includes('B')) {
  console.log('--- 格 B：先 set_num_threads(1) ---');
  got.B = await cell('B/set_num_threads(1)', {
    prepare: async (page) => {
      // ① 先证明**诊断口子真的交付了**：页面侧够得到那个符号
      const t = await page.evaluate(() => typeof (window.Module || {})._openblas_set_num_threads);
      check(t === 'function', 'B · 页面够得到 Module._openblas_set_num_threads', `typeof=${t}`);
      // ② 再调它
      const r = await page.evaluate(() => {
        try { window.Module._openblas_set_num_threads(1); return 'ok'; }
        catch (e) { return 'ERR: ' + e.message; }
      });
      check(r === 'ok', 'B · set_num_threads(1) 调用成功', r);
      return r;
    },
  });
}

console.log('');
console.log('════ 结论（工单 16 的二分阶梯）════');
for (const k of ['C', 'E', 'F', 'D', 'G', 'H', 'I', 'L', 'A', 'B']) {
  if (got[k]) console.log(`  ${k} : ${got[k].verdict}   ${got[k].detail}`);
}
const hung = k => got[k] && got[k].verdict === 'hung';
if (hung('C') && !hung('F') && !hung('E') && !hung('D')) {
  console.log('  ⇒ **墙必须经过 `.oct` 的 dlopen**：同一句代码，装了夹具（要 dlopen）就挂、'
    + '不装（不 dlopen）就干净报"未定义"；而纯 error()、纯 BLAS 都活。'
    + '\n     线程数不是变量（B 设 1 线程仍挂）⇒ 定位 = **线程版 OpenBLAS 产物上的 .oct 动态装载**。');
} else if (got.G && got.G.verdict === 'hung') {
  console.log('  ⇒ ★ **墙是"共享内存增长"**：不碰 dlopen、只增长就挂 ⇒ 自旋的池线程挡住了增长安全点；'
    + '\n     dlopen 只是"需要增长的那件事"（工单 19 的假设 1 成立）。');
} else if (got.H && got.H.verdict === 'hung') {
  console.log('  ⇒ 墙在 **OpenBLAS 线程池的计算路径**（大 dgemm 就挂；D 的 300² 多半低于线程阈值）。');
} else if (got.D && got.D.verdict === 'hung') {
  console.log('  ⇒ 定位在 **OpenBLAS(USE_THREAD=1) 的计算/线程池本身**（D 无 dlopen 也挂）。');
} else {
  console.log('  ⇒ 见上面各格原样记录（组合与已知形状不符时别硬下结论）。');
}
console.log(`=== ${pass} PASS / ${fail} FAIL ===`);
// ★ 显式退出：挂住的浏览器可能关不掉，绝不能让探针自己挂在收尾上。
process.exit(fail ? 1 : 0);
