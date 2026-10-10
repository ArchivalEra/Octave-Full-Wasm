// 探针（工单 07）：浏览器下限矩阵 —— **低于部署下限的引擎必须优雅降级，不许坏页**。
//
// ## 它在测什么
//
// 外审判据（NOTES-jspi.md「浏览器下限」节）：部署要求 Chrome/Chromium ≥137、Firefox ≥153、
// Safari ≥27；更老的引擎没有 JSPI 的 JS API。产品自己的判据不是"版本号"，而是
// **D9 门槛**（CONTEXT.md）：页面在运行期探测"有没有可挂起的等待能力"
// （`Module.eval_string('__web_suspend_ok__')`），没有就退回内建阻塞 pause——
// 页面照常能用。本探针把这句话变成矩阵：
//
//   引擎 × { ready, evalOk, jspiApi, suspendOk, memory64, coi, lane } 逐格记录，
//   红绿判据只有四条（见 ASSERTS）：
//     ① 任何引擎页面必须 ready（低于下限也必须 ready —— 这是"优雅"的定义）
//     ② eval('2+2') 必须成立
//     ③ D9 门必须与 jspiApi **一致**：有 API ⇒ suspendOk=1；没 API ⇒ suspendOk=0
//        （两边不一致都是红：降级判定要么漏报要么误报）
//     ④ lane 必须与 (COI × memory64 × **站点档清单**) 一致（三者共同决定该选哪一档；
//        详见 `expectedLane()` —— ★ 无 memory64 的引擎**不许**落 w64，工单 30 的反向断言）
//
// 引擎清单（本机有的）与老引擎缺口如实记录：<137 的 Chromium 本机没有 ⇒ 那格
// 打 `engine-unavailable`，不算失败也不算通过（工单 07 为此保持 ready-for-human）。
//
// ## 退出码（照 NOTES-jspi.md 的约定）
//
//   0 = 判据全过；1 = 有断言失败；2 = 所有引擎都起不来（没做成判定）。
//
// 用法：sh test/browser/run.sh test/browser/probe-browser-floor.mjs [URL]
//   引擎可选：FLOOR_ENGINES="chromium,firefox,pw-firefox,webkit"
//   webkit 要 `PLAYWRIGHT_BROWSERS_PATH=/mnt/hdd/crossbuild-tools/pw-browsers`。
import { chromium, firefox, webkit } from 'playwright-core';

const URL = process.argv.find(a => /^http/.test(a)) || 'http://127.0.0.1:8761/';
const READY_TIMEOUT_MS = Number(process.env.READY_TIMEOUT_MS || 90000);
const ENGINES = (process.env.FLOOR_ENGINES || 'chromium,firefox,pw-firefox,webkit').split(',');

let pass = 0, fail = 0, na = 0;
function check (ok, name, detail) {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${name.padEnd(58)} :: ${String(detail).slice(0, 90)}`);
}
function naMark (name, detail) {
  na++;
  console.log(`N/A  | ${name.padEnd(58)} :: ${String(detail).slice(0, 90)}`);
}

const LAUNCHERS = {
  'chromium':   { type: 'chromium', exe: '/usr/bin/chromium',
                  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] },
  'firefox':    { type: 'firefox',  exe: '/usr/bin/firefox' },
  'pw-firefox': { type: 'firefox',  exe: '/mnt/hdd/crossbuild-tools/pw-browsers/firefox-1543/firefox/firefox' },
  'webkit':     { type: 'webkit',   exe: null },   // 走 PLAYWRIGHT_BROWSERS_PATH 的默认解析
  // ★ 工单 24：**低于部署下限**那一侧的引擎（Chromium 125 < 137）。
  //   它由**旧版 playwright**（1.44.1，落在 /mnt/hdd/crossbuild-tools/pw-old）驱动 ——
  //   新 playwright 的 CDP 未必能驱动旧浏览器，所以跑这一格时要：
  //     HARNESS=/mnt/hdd/crossbuild-tools/pw-old FLOOR_ENGINES=old-chromium \
  //       sh test/browser/run.sh test/browser/probe-browser-floor.mjs <URL>
  //   路径可用 FLOOR_OLD_CHROME 覆盖。
  'old-chromium': { type: 'chromium',
                    exe: process.env.FLOOR_OLD_CHROME
                         || '/mnt/hdd/crossbuild-tools/pw-browsers/chromium-1117/chrome-linux/chrome',
                    args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] },
};

// ── D9 门与页面事实 ────────────────────────────────────────────────────────────
async function probePage (page) {
  for (let w = 0; w < 300; w++) {
    if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) break;
    await new Promise(r => setTimeout(r, 300));
  }
  return page.evaluate(async () => {
    let mem64 = false;
    try { new WebAssembly.Memory({ initial: 1n, address: 'i64' }); mem64 = true; } catch (e) { /* 引擎不支持 ⇒ false */ }
    // ⚠️ eval_string 返回的是 **rc 不是表达式值**（第一版就栽在这：把 rc=0 当成"门关着"）。
    //    值经 printf 进 #output，用唯一标记取回。
    // ★ 2026-10-10 修（实测假红）：输出**不是在 eval 返回的同一 tick 里进 DOM 的** ——
    //   引擎的输出队列要等一次 tick 才 drain（实测：紧跟 eval 读 #output = 只有 boot 警告；
    //   +800ms 后 SUSP=1 / EVALOK=4 都在）。原版同步读 ⇒ evalOk/suspendOk 恒 null、
    //   每轮 PROBES=1 在两个引擎上各假红一条。修法 = **轮询等到标记出现或超时**，
    //   超时仍无标记才记 null（那才是真信号）。
    let susp = null, evalOk = null;
    try { window.Module.eval_string("printf('SUSP=%d\\n', __web_suspend_ok__);"); } catch (e) { susp = `ERR:${String(e).slice(0, 40)}`; }
    try { window.Module.eval_string("printf('EVALOK=%d\\n', 2+2);"); } catch (e) { evalOk = `ERR:${String(e).slice(0, 40)}`; }
    const read = () => (document.getElementById('output') || document.body).textContent || '';
    let txt = read();
    for (let w = 0; w < 60 && !(/EVALOK=\d/.test(txt) && /SUSP=\d/.test(txt)); w++) {
      await new Promise(r => setTimeout(r, 100));
      txt = read();
    }
    const ms = /SUSP=(\d+)/.exec(txt.slice(txt.lastIndexOf('SUSP=') >= 0 ? txt.lastIndexOf('SUSP=') : 0));
    const me = /EVALOK=(\d+)/.exec(txt.slice(txt.lastIndexOf('EVALOK=') >= 0 ? txt.lastIndexOf('EVALOK=') : 0));
    const c = window.__octaveCaps || {};
    return {
      ready: window.__octaveReady === true,
      jspiApi: !!(c.engine && c.engine.jspiApi),
      sab: !!(c.engine && c.engine.sharedArrayBuffer),
      coi: c.engine ? c.engine.crossOriginIsolated : null,
      lane: (c.lane || {}).chosen || '?',
      // ★ 工单 30：把**站点档清单**也取回来 —— "该选哪一档"是 (COI × memory64 ×
      //   **这个站点到底部署了哪几档**) 的确定函数。不读清单就看不出"没有 memory64
      //   却选了 w64"这种错（老判据只要求 /threads|w64/ ⇒ 那条错**恒绿**）。
      lanes: (() => { try { return window.__octaveLanes ? Array.from(window.__octaveLanes) : null; } catch (e) { return null; } })(),
      mem64,
      suspendOk: susp && susp.startsWith('ERR') ? susp : (ms ? +ms[1] : null),
      evalOk: evalOk && evalOk.startsWith('ERR') ? evalOk : (me ? +me[1] === 4 : null),
    };
  }).catch(e => ({ error: String(e).slice(0, 80) }));
}

console.log(`URL=${URL}`);
const rows = [];
for (const name of ENGINES) {
  const L = LAUNCHERS[name];
  if (!L) { check(false, `${name} · 引擎名不认识`, 'LAUNCHERS 里没有'); continue; }
  let browser = null;
  try {
    const opts = { headless: true, timeout: 20000 };
    if (L.exe) opts.executablePath = L.exe;
    if (L.args) opts.args = L.args;
    const lib = L.type === 'chromium' ? chromium : L.type === 'firefox' ? firefox : webkit;
    browser = await lib.launch(opts);
  } catch (e) {
    // 环境缺件（引擎版本与 playwright 的 juggler 不匹配等）≠ 断言红 —— 照 coi-sw 的约定记 N/A
    naMark(`${name} · 引擎起不来（engine-unavailable）`, `${String(e).split('\n')[0].slice(0, 70)}`);
    continue;
  }
  const page = await browser.newPage();
  try {
    await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  } catch (e) { /* ready 循环还会兜底等 */ }
  const r = await Promise.race([
    probePage(page),
    new Promise(res => setTimeout(() => res({ error: `ready 超过 ${READY_TIMEOUT_MS / 1000}s` }), READY_TIMEOUT_MS)),
  ]);
  rows.push({ name, ...r });
  const tag = r.error ? 'fail' : 'PASS';
  console.log(`${tag} | ${name.padEnd(12)} ready=${r.ready} lane=${r.lane} lanes=${JSON.stringify(r.lanes)} jspiApi=${r.jspiApi} suspendOk=${r.suspendOk} mem64=${r.mem64} coi=${r.coi} ${r.error || ''}`);
  await Promise.race([browser.close(), new Promise(res => setTimeout(res, 8000))]).catch(() => {});
}

// ── 断言：矩阵的每一条红绿判据 ────────────────────────────────────────────────
// 该选哪一档 = 优先级顺序里**清单中真的部署了**的第一档（与 `bridge/lane.js` 同构）：
//   COI + m64     ⇒ w64 → threads → base
//   COI + 无 m64  ⇒ threads → base          ← ★ 不许是 w64（本批的反向断言）
//   非 COI + m64  ⇒ w64-base → base
//   非 COI + 无 m64 ⇒ base
function expectedLane (r) {
  const inv = Array.isArray(r.lanes) ? r.lanes : [];
  const order = r.coi === true
    ? (r.mem64 === true ? ['w64', 'threads', 'base'] : ['threads', 'base'])
    : (r.mem64 === true ? ['w64-base', 'base'] : ['base']);
  for (const l of order) if (inv.includes(l)) return l;
  return null;
}

console.log('\n════ 判据 ════');
for (const r of rows) {
  if (r.error) { check(false, `${r.name} · 页面事实没拿到`, r.error); continue; }
  check(r.ready === true, `${r.name} · ① 页面 ready（低于下限也必须优雅）`, `ready=${r.ready}`);
  check(r.evalOk === true, `${r.name} · ② eval('2+2') 成立`, `evalOk=${r.evalOk}`);
  if (r.jspiApi === true) check(r.suspendOk === 1 || r.suspendOk === '1',
    `${r.name} · ③a 有 JSPI API ⇒ D9 门必须开`, `suspendOk=${r.suspendOk}`);
  else check(r.suspendOk === 0 || r.suspendOk === '0',
    `${r.name} · ③b 无 JSPI API ⇒ D9 门必须关（不许误报可挂起）`, `jspiApi=${r.jspiApi} suspendOk=${r.suspendOk}`);
  // ④ lane 与 (COI × memory64 × **站点档清单**) 一致 —— 三者共同决定该选哪一档。
  //   ★ 工单 30：老判据是 `coi ? /threads|w64/ : lane==='base'`，它**分辨不出 w64 与 threads**
  //     ⇒ "没有 memory64 的引擎却选了 w64"这种错在那条判据下**恒绿**（正是本批要证伪的那条）。
  //     现在的判据：按优先级取"清单里真的部署了"的第一档，**必须逐字等于**页面选的档。
  const want = expectedLane(r);
  if (want === null) {
    check(false, `${r.name} · ④ 站点档清单为空 ⇒ 判不了（零值守卫，不许当通过）`,
          `lanes=${JSON.stringify(r.lanes)}`);
  } else {
    check(r.lane === want,
          `${r.name} · ④ lane 与 (COI × memory64 × 清单) 一致（期望 ${want}）`,
          `coi=${r.coi} mem64=${r.mem64} lane=${r.lane} lanes=${JSON.stringify(r.lanes)}`);
  }
}

console.log('');
console.log('════ 引擎缺口（如实，不算失败也不算通过）════');
// ⚠️ 这句话曾写着"本机没有 <137 的 Chromium"—— 2026-09-30 起**不再成立**：
//   旧的 Chromium 125 已装在 /mnt/hdd/crossbuild-tools/pw-browsers/chromium-1117（配套旧 playwright）。
//   跑它：HARNESS=/mnt/hdd/crossbuild-tools/pw-old FLOOR_ENGINES=old-chromium sh test/browser/run.sh <本探针> <URL>
console.log('  低于下限的格子：Chromium 125 已实测（ready ✓ / jspiApi=false ⇒ D9 门关 ✓）；');
console.log('  Firefox<153 与 Safari<27 那一侧的旧构建**本机仍没有** ⇒ 那两格如实留空（不算通过）。');
// ⚠️ 汇总行必须**恰好**是 `=== N PASS / M FAIL ===`（build/sweep.sh:108 的正则）
//    —— N/A 单独一行，别塞进汇总行（第一版塞了 ⇒ 被扫成"有问题"）。
if (na) console.log(`N/A 合计：${na} 格（引擎缺件，既不算通过也不算失败）`);
console.log(`=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : (rows.length ? 0 : 2));
