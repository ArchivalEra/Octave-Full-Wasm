// 探针（工单 05 结算件）：G1 机制的两值判定 —— v13 的永久形态。
//
// ## 判据（2026-09-29 实测后定的形状）
//
//   control（启动期不碰 dlopen）⇒ 页面 ready **且** callSide(1)==2
//     —— 锚：harness/旗标/同步 dlopen 本身都没坏；
//   startup （静态初始化器同步 dlopen）⇒ **机制指纹必须出现**：
//     pageerror = `trying to suspend without WebAssembly.promising`
//     （⚠️ ErrorEvent.message **不含 "SuspendError:" 名字前缀** —— 第一版按名字匹配，
//      指纹就在眼前却判了不匹配；按消息体匹配）。
//   startup 的 ready / callSide 行为**如实记录不判红**：v13 当日（09-24）实测是
//   "ready=false 页面起不来"，2026-09-29 复测同容器同 emcc 下 throw 仍在但 boot 存活
//   —— 形状随胶水时序漂，机制指纹才是稳定判据（这条差异已记 NOTES-jspi）。
//
// 产物由 build/113/probe-jspi-g1.sh 生成（control/startup 两变体），本探针自托管。
// 输入：PROBE_DIR（默认 /mnt/hdd/octave-wasm-build/g1-probe）—— 已登记进 manifest.json。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const PROBE_DIR = process.env.PROBE_DIR || '/mnt/hdd/octave-wasm-build/g1-probe';
const READY_TIMEOUT_MS = Number(process.env.READY_TIMEOUT_MS || 30000);

let pass = 0, fail = 0;
const check = (ok, name, detail) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${name.padEnd(58)} :: ${String(detail).slice(0, 100)}`);
};

const server = createServer(async (req, res) => {
  try {
    const p = new URL(req.url, 'http://x').pathname;
    const body = await readFile(`${PROBE_DIR}${p === '/' ? '/control/index.html' : p}`);
    res.writeHead(200, { 'Content-Type': p.endsWith('.wasm') ? 'application/wasm'
      : p.endsWith('.html') ? 'text/html' : 'application/javascript' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('no'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'],
});

async function boot (variant) {
  const page = await (await browser.newContext()).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message || e)));
  await page.goto(`${base}/${variant}/index.html`, { waitUntil: 'load', timeout: 20000 });
  let ready = false;
  for (let t = 0; t < READY_TIMEOUT_MS / 250; t++) {
    if (await page.evaluate(() => window.__ready === true).catch(() => false)) { ready = true; break; }
    await new Promise(r => setTimeout(r, 250));
  }
  const callSide = await page.evaluate(() => {
    try { return { kind: 'returned', v: window.Module.callSide(1) }; }
    catch (e) { return { kind: 'threw', msg: String(e.message || e).slice(0, 90) }; }
  }).catch(e => ({ kind: 'threw', msg: String(e.message || e).slice(0, 90) }));
  const state = await page.evaluate(() => ({
    ready: window.__ready === true,
    loadErr: window.__loadErr || null,
    pageErr: window.__pageErr || null,
  })).catch(e => ({ ready: false, loadErr: null, pageErr: `evaluate-failed: ${String(e).slice(0, 60)}` }));
  await Promise.race([page.close(), new Promise(r => setTimeout(r, 3000))]).catch(() => {});
  return { ready, errs, callSide, ...state };
}

// ── 控制组：ready + **运行期**同步 dlopen 必抛（v10 机制）─────────────────────
const ctl = await boot('control');
check(ctl.ready === true, 'control · 页面 ready（锚：harness 与 -sJSPI 旗标本身没坏）',
  `ready=${ctl.ready} loadErr=${ctl.loadErr || '无'}`);
check(ctl.callSide.kind === 'threw' && /suspend without/i.test(ctl.callSide.msg || ''),
  '★ control · callSide(1) 必抛 SuspendError（v10：未预热就同步调 dlopen 链入口 —— 机制①）',
  JSON.stringify(ctl.callSide));

// ── 实验组：机制指纹必须出现 ────────────────────────────────────────────────
const st = await boot('startup');
const errTxt = `${st.pageErr || ''} ${st.loadErr || ''} ${st.errs.join(' ')}`;
check(/suspend without WebAssembly\.promising/i.test(errTxt),
  '★ startup · 机制指纹：`trying to suspend without WebAssembly.promising`（启动期同步 dlopen 被拒）',
  errTxt.slice(0, 95) || '（无错误事件——机制没触发，翻面重查）');
console.log(`     [如实记] startup ready=${st.ready} callSide=${JSON.stringify(st.callSide).slice(0, 70)}`
  + '（v13 当日 ready=false；今日 throw 仍在但 boot 存活、bindings 注册被打残 —— 形状随胶水时序漂，指纹才是判据）');

await Promise.race([browser.close(), new Promise(r => setTimeout(r, 8000))]).catch(() => {});
server.close();
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
