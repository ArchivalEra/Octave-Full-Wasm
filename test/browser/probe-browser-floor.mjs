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
//     ④ lane 必须与 COI 一致（带头 ⇒ threads/w64；不带头 ⇒ base）
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
    //    值经 printf 进 #output（单页模式同步追加），用唯一标记取回。
    let susp = null, evalOk = null;
    try { window.Module.eval_string("printf('SUSP=%d\\n', __web_suspend_ok__);"); } catch (e) { susp = `ERR:${String(e).slice(0, 40)}`; }
    try { window.Module.eval_string("printf('EVALOK=%d\\n', 2+2);"); } catch (e) { evalOk = `ERR:${String(e).slice(0, 40)}`; }
    const txt = (document.getElementById('output') || document.body).textContent || '';
    const ms = /SUSP=(\d+)/.exec(txt.slice(txt.lastIndexOf('SUSP=') >= 0 ? txt.lastIndexOf('SUSP=') : 0));
    const me = /EVALOK=(\d+)/.exec(txt.slice(txt.lastIndexOf('EVALOK=') >= 0 ? txt.lastIndexOf('EVALOK=') : 0));
    const c = window.__octaveCaps || {};
    return {
      ready: window.__octaveReady === true,
      jspiApi: !!(c.engine && c.engine.jspiApi),
      sab: !!(c.engine && c.engine.sharedArrayBuffer),
      coi: c.engine ? c.engine.crossOriginIsolated : null,
      lane: (c.lane || {}).chosen || '?',
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
  console.log(`${tag} | ${name.padEnd(12)} ready=${r.ready} lane=${r.lane} jspiApi=${r.jspiApi} suspendOk=${r.suspendOk} mem64=${r.mem64} coi=${r.coi} ${r.error || ''}`);
  await Promise.race([browser.close(), new Promise(res => setTimeout(res, 8000))]).catch(() => {});
}

// ── 断言：矩阵的每一条红绿判据 ────────────────────────────────────────────────
console.log('\n════ 判据 ════');
for (const r of rows) {
  if (r.error) { check(false, `${r.name} · 页面事实没拿到`, r.error); continue; }
  check(r.ready === true, `${r.name} · ① 页面 ready（低于下限也必须优雅）`, `ready=${r.ready}`);
  check(r.evalOk === true, `${r.name} · ② eval('2+2') 成立`, `evalOk=${r.evalOk}`);
  if (r.jspiApi === true) check(r.suspendOk === 1 || r.suspendOk === '1',
    `${r.name} · ③a 有 JSPI API ⇒ D9 门必须开`, `suspendOk=${r.suspendOk}`);
  else check(r.suspendOk === 0 || r.suspendOk === '0',
    `${r.name} · ③b 无 JSPI API ⇒ D9 门必须关（不许误报可挂起）`, `jspiApi=${r.jspiApi} suspendOk=${r.suspendOk}`);
  const laneOk = r.coi === true ? /threads|w64/.test(r.lane) : r.lane === 'base';
  check(laneOk, `${r.name} · ④ lane 与 COI 一致`, `coi=${r.coi} lane=${r.lane}`);
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
