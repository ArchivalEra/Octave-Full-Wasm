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
  const browser = await newBrowser();
  const page = await browser.newPage();
  const logs = [];
  page.on('console', m => logs.push(m.text()));
  page.on('pageerror', e => logs.push('[pageerror] ' + e.message));

  let prep = null, verdict = 'unknown', detail = '';
  try {
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

    // 本格特有的"准备"（格 B 在这里调 set_num_threads）
    if (opts.prepare) prep = await opts.prepare(page);

    // ★ 关键一步：硬超时赛跑。挂住的 wasm 会把 evaluate 的 Promise 永远挂着。
    const CODE = "printf('%.10g', miniprobe([2,3;1,4])); disp('__E2DONE__');";
    const racing = page.evaluate(c => window.Module.eval_string(c), CODE)
      .then(() => 'returned')
      .catch(e => 'error: ' + String(e).slice(0, 90));
    let timer;
    const hung = new Promise(res => { timer = setTimeout(() => res('hung'), CELL_TIMEOUT_MS); });
    verdict = await Promise.race([racing, hung]);
    clearTimeout(timer);
    detail = verdict === 'returned'
      ? `输出=${logs.join(' ').split('__E2DONE__')[0].replace(/\s+/g, ' ').trim().slice(0, 60)}`
      : (verdict === 'hung' ? `>${CELL_TIMEOUT_MS / 1000}s 未返回（100% CPU 的典型形状）` : verdict);
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
  console.log('=== SKIP（0 PASS / 0 FAIL —— 不是通过，是"不适用"）===');
  process.exit(0);
}

console.log('--- 格 A：裸跑（期望"不返回"，复现既有实测）---');
const A = await cell('A/裸跑', {});
check(A.verdict === 'hung', 'A · 复现"不返回"', A.detail);

console.log('--- 格 B：先 set_num_threads(1) ---');
const B = await cell('B/set_num_threads(1)', {
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

console.log('');
console.log('════ 结论 ════');
console.log(`  格 A（裸跑）            : ${A.verdict}   ${A.detail}`);
console.log(`  格 B（先设 1 线程）     : ${B.verdict}   ${B.detail}`);
if (A.verdict === 'hung' && B.verdict === 'returned') {
  console.log('  ⇒ 定位在**多线程唤醒/并行执行**：设成单线程就返回了。');
} else if (A.verdict === 'hung' && B.verdict === 'hung') {
  console.log('  ⇒ 定位在**线程版代码路径本身**：与线程数无关（设成 1 线程仍不返回）。');
} else if (A.verdict === 'returned') {
  console.log('  ⇒ 格 A 就返回了 ⇒ 与既有实测（>600s 不返回）**不符**：先查这份诊断档是不是真线程版。');
} else {
  console.log('  ⇒ 两格都不干净（见上面 detail），本次不构成结论。');
}
console.log(`=== ${pass} PASS / ${fail} FAIL ===`);
// ★ 显式退出：挂住的浏览器可能关不掉，绝不能让探针自己挂在收尾上。
process.exit(fail ? 1 : 0);
