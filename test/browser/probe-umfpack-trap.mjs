// 探针（工单 04 结算件）：稀疏 lu 3+ 输出的**最小复现** —— 报告页面行为，不做红绿判决。
//
// ## 为什么是这一行
//
// 根因（52489ab 查明，build/113/NOTES-umfpack.md + build-libs.sh 的 SS 配置注释）：
// UMFPACK 的 C 代码按"标准 BLAS"约定调 `dgemm_`/`dger_`/`dtrsv_`/`dtrsm_`，而本仓 BLAS
// 是 f2c 转出来的（隐藏长度 `ftnlen` 形参约定）⇒ 形参错位、内存被踩 ⇒ wasm `unreachable`。
// **1/2 输出的稀疏 lu 不走数值分解所以不炸；3+ 输出走分解必炸** —— 触发条件就此最小化：
//
//     s = sparse([1,1,2,3],[1,2,2,3],[1,2,3,4]);
//     [L,U,P] = lu(s);          % 3 输出 ⇒ UMFPACK 数值分解 ⇒（无 -DNBLAS 时）trap
//
// ## 输出（给驱动脚本 build/113/repro-umfpack-trap.sh 判决用）
//
//   === LU-TRAP            页面拿到 wasm trap（unreachable/abort）—— 旧墙复现
//   === LU-OK              3 输出稀疏 lu 正常返回（修复后的现役行为）
//   === LU-OTHER <原文>    其它失败（挂起/超时/别的错）—— 驱动按"没复现"处理
//
// 用法：sh test/browser/run.sh test/browser/probe-umfpack-trap.mjs <站点URL>
import { chromium } from 'playwright-core';

const URL = process.argv.find(a => /^http/.test(a)) || 'http://127.0.0.1:8768/';
const HARD_TIMEOUT_MS = Number(process.env.HARD_TIMEOUT_MS || 60000);

const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await (await browser.newContext()).newPage();
const pageErrs = [];
page.on('pageerror', e => pageErrs.push(String(e.message || e)));
await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
let ready = false;
for (let t = 0; t < 240; t++) {
  if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) { ready = true; break; }
  await new Promise(r => setTimeout(r, 250));
}
if (!ready) { console.log('=== LU-OTHER 页面 60s 未就绪 ==='); await browser.close(); process.exit(0); }

// 挂起安全：trap 会把 evaluate 的 Promise 打成 reject，用 race 兜底；独立 browser 兜底挂死
const out = await Promise.race([
  page.evaluate(async () => {
    try {
      const r = window.Module.eval_string(
        "s = sparse([1,1,2,3],[1,2,2,3],[1,2,3,4]);\n" +
        "[L,U,P] = lu(s);\n" +
        "printf('LUOK nz=%d\\n', nnz(L));");
      return { kind: 'returned', rc: r, out: window.__lastOut || '' };
    } catch (e) {
      return { kind: 'threw', msg: String(e.message || e).slice(0, 120) };
    }
  }),
  new Promise(res => setTimeout(() => res({ kind: 'hung' }), HARD_TIMEOUT_MS)),
]).catch(e => ({ kind: 'threw', msg: String(e.message || e).slice(0, 120) }));

if (out.kind === 'threw' && /unreachable|abort|RuntimeError/i.test(out.msg)) {
  console.log('=== LU-TRAP ' + out.msg.replace(/\n/g, ' '));
} else if (out.kind === 'returned') {
  console.log('=== LU-OK rc=' + out.rc);
} else if (out.kind === 'hung') {
  console.log('=== LU-OTHER >' + HARD_TIMEOUT_MS / 1000 + 's 未返回');
} else {
  console.log('=== LU-OTHER ' + (out.msg || '').replace(/\n/g, ' '));
}
if (pageErrs.length) console.log('   pageerror: ' + pageErrs.slice(0, 2).join(' | ').slice(0, 140));
await Promise.race([browser.close(), new Promise(r => setTimeout(r, 8000))]).catch(() => {});
process.exit(0);
