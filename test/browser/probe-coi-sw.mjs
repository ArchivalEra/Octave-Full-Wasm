// 探针：coi-serviceworker 的真实行为 —— 默认 / credentialless 定制 / 关掉（E7 前置，2026-09-26）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 为什么要有它：C8（宿主站装 service worker 换 COI）整条路的**前提**是两句行为断言：
//   ① SW 注头之后，**同源** iframe 能继承 COI（⇒ 线程可用）；
//   ② 注的是 require-corp 还是 credentialless，直接决定**宿主站的 CDN 脚本活不活**。
// 上游 README 只给了"定制示例"，**默认值**得自己读文件/实测（`coi-serviceworker.js` 第 2 行
// 写的是 `let coepCredentialless = false`）⇒ 本条断言必须实测，不许照抄 README。
//
// 三档 × 三引擎：
//   mode=off     不装 SW（对照）
//   mode=default 装 SW，不带任何定制
//   mode=credless 装 SW + `window.coi = { coepCredentialless: () => true }`
// 每档记录：SW 是否接管、top.crossOriginIsolated、typeof SharedArrayBuffer、
//           **跨源无 CORP 脚本**是否加载（CDN 的形态）、同源 iframe 是否继承 COI。
// 引擎：chromium（系统 /usr/bin/chromium）、firefox、webkit（playwright 托管，
//       需要 PLAYWRIGHT_BROWSERS_PATH=/mnt/hdd/crossbuild-tools/pw-browsers）。
// ⚠️ 没有装 firefox/webkit 时**如实报 N/A**（不是 FAIL）—— 环境缺件 ≠ 断言红。
import { chromium, firefox, webkit } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const SW = '/mnt/hdd/zcode-projects/Octave-Full-Wasm/build/embed/coi-serviceworker.min.js';
const TOP = (mode) => `<!doctype html><meta charset="utf-8"><title>coi probe</title>
${mode === 'credless' ? `<script>window.coi = { coepCredentialless: () => true };</script>` : ''}
${mode === 'off' ? '' : `<script src="/coi-serviceworker.min.js"></script>`}
<script>
window.__cdnOK = false;
</script>
<script src="http://127.0.0.1:CDN_PORT/lib.js"></script>
<iframe name="f" src="/frame.html" style="width:50px;height:20px"></iframe>
<body>mode=${mode}</body>`;
const FRAME = `<!doctype html><meta charset="utf-8"><title>f</title><body>frame</body>`;

let CDN_PORT = 0;
const server = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/coi-serviceworker.min.js') {
    const body = await readFile(SW);
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    res.end(body); return;
  }
  if (u.pathname === '/frame.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(FRAME); return; }
  const html = TOP(u.searchParams.get('mode') || 'off').replace('CDN_PORT', String(CDN_PORT));
  res.writeHead(200, { 'Content-Type': 'text/html' });   // ★ 顶层**不注任何** COI 头（模拟静态托管）
  res.end(html);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const cdn = createServer((req, res) => {
  // 跨源、**不带 CORP**、也不带 crossorigin —— 就是 CDN 脚本的形态
  res.writeHead(200, { 'Content-Type': 'application/javascript' });
  res.end('window.__cdnOK = true;');
});
await new Promise(r => cdn.listen(0, '127.0.0.1', r));
CDN_PORT = cdn.address().port;

const ENGINES = [
  ['chromium', () => chromium.launch({ executablePath: '/usr/bin/chromium',
      args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] })],
  ['firefox', () => firefox.launch()],
  ['webkit', () => webkit.launch()],
];

let pass = 0, fail = 0, na = 0;
const res = {};
for (const [name, launch] of ENGINES) {
  let br;
  try { br = await launch(); }
  catch (e) { na++; console.log(`N/A  | ${name.padEnd(8)} 引擎不可用（装了吗？PLAYWRIGHT_BROWSERS_PATH 设了吗？）：${String(e).split('\n')[0].slice(0, 90)}`); continue; }
  res[name] = {};
  for (const mode of ['off', 'default', 'credless']) {
    const page = await (await br.newContext()).newPage();
    const errs = [];
    page.on('requestfailed', r => errs.push(`${r.url().split('/').pop()}:${(r.failure() || {}).errorText || ''}`.slice(0, 60)));
    await page.goto(`http://127.0.0.1:${PORT}/?mode=${mode}`, { waitUntil: 'load', timeout: 30000 });
    // ★ **不强制额外 reload**（第一版强制 reload 可能制造"受控首访拿不到 COI"的竞态，
    //   从而误触发 SW 的 coepDegrade 降级）。这里只等 SW 自己那一次 reload 走完：
    //   等 `controller` 出现 + 稳定 1.5s，再采一次 coiCoepHasFailed 这个**降级旗标**。
    // ★ 有界重试直到**受控**（SW 注册→激活→接管要跨一次导航；固定 sleep 会得到
    //   "controlled=false" 的噪声行，第一版就踩了）。不设"强制 reload"以外的干预。
    if (mode !== 'off') {
      for (let i = 0; i < 3; i++) {
        const ctl = await page.evaluate(() => !!navigator.serviceWorker.controller).catch(() => false);
        if (ctl) break;
        await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 12000 }).catch(() => {});
        await page.reload({ waitUntil: 'load' }).catch(() => {});
        await page.waitForTimeout(900);
      }
      await page.waitForTimeout(900);
    }
    const m = await page.evaluate(async () => {
      const f = document.querySelector('iframe');
      let fcoi = null;
      try { fcoi = f && f.contentWindow ? f.contentWindow.crossOriginIsolated : null; } catch (e) { fcoi = 'blocked'; }
      return { coi: self.crossOriginIsolated, sab: typeof SharedArrayBuffer,
               cdn: window.__cdnOK === true, fcoi: fcoi,
               controlled: !!navigator.serviceWorker.controller,
               coepFailed: sessionStorage.getItem('coiCoepHasFailed') === 'true',
               coepDegrading: sessionStorage.getItem('coiReloadedBySelf') === 'coepdegrade' };
    });
    res[name][mode] = m;
    console.log(`     ${name.padEnd(8)} ${mode.padEnd(9)} coi=${String(m.coi).padEnd(5)} sab=${String(m.sab).padEnd(9)} CDN脚本=${m.cdn ? '✓加载' : '✗被拦'} 同源iframe.coi=${String(m.fcoi).padEnd(7)} SW接管=${m.controlled} 降级旗标=${m.coepFailed}${errs.length ? '  [' + errs.slice(0, 2).join(',') + ']' : ''}`);
    await page.close();
  }
  await br.close();
}

console.log('\n──── 断言（可证伪）────');
function check(ok, label, detail) { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${detail}`); }
function get(e, m) { try { return res[e][m]; } catch (x) { return null; } }

// A 对照：不装 SW ⇒ 无 COI、SAB 缺席、CDN 正常
for (const e of Object.keys(res)) {
  const r = get(e, 'off');
  check(r && r.coi === false && r.sab === 'undefined' && r.cdn === true,
    `A ${e}：不装 SW ⇒ 无 COI（SAB 缺席）且 CDN 脚本照常`, JSON.stringify(r));
}
// B 装 SW（默认）⇒ COI 成立、同源 iframe 继承；CDN 脚本是否被拦 = 默认模式的**实测**值
for (const e of Object.keys(res)) {
  const r = get(e, 'default');
  check(r && r.coi === true && r.controlled === true,
    `★ B ${e}：默认模式 ⇒ SW 接管且 crossOriginIsolated=true（同源 iframe.coi=${r && r.fcoi}）`, JSON.stringify(r));
}
// C 定制 credentialless ⇒ COI 仍成立 且 CDN 脚本**不该**被拦（credentialless 的卖点）
for (const e of Object.keys(res)) {
  const r = get(e, 'credless');
  check(r && r.coi === true && r.cdn === true,
    `★ C ${e}：credentialless 定制 ⇒ COI 成立**且 CDN 脚本不被拦**`, JSON.stringify(r));
}

console.log('\n──── 默认模式 vs credentialless：CDN 脚本存活对比（本探针的核心数据）────');
for (const e of Object.keys(res)) {
  const d = get(e, 'default'), c = get(e, 'credless');
  console.log(`  ${e.padEnd(9)} 默认(require-corp)=${d && d.cdn ? '加载' : '被拦'}   credentialless=${c && c.cdn ? '加载' : '被拦'}`);
}

console.log(`\n=== ${pass} PASS / ${fail} FAIL${na ? ` / ${na} N/A(引擎缺)` : ''} ===`);
server.close(); cdn.close();
process.exit(fail ? 1 : 0);
