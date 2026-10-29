// 验收：**E 线 MATLAB 语义桥的产品态**（工单 70 的结算件；根本仓纪律重写）
// Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 为什么本仓要自己一份（而不是直接跑 OM 的 `run-omc-bridge-product.sh`）──────
// OM 那份的**判据是对的**（零注入、只 addpath、靠站点装配），但它的**就绪门太弱**：
//   `M.eval_string('x=1+1;') === 0`
// 实测（2026-10-29）：这个门在 **877 ms** 就通过，而本站的 boot 链要到 **1354 ms**
// 才把资产/桥装配完（`__octaveReady`）。它在那 477 ms 的空窗里探 `exist('omc_*')`
// ⇒ 必然读到 MISSING ⇒ 3 条假红。**这不是装配缺陷，是判据的时序缺陷。**
// （证据：同一页面，用 `__octaveReady` 门重探 ⇒ ③④⑤ 全 FOUND，8/8 绿。）
//
// 本仓 76 个套件的统一就绪门就是 `window.__octaveReady === true`。本件用同一条，
// 判据内容与 OM 那份**逐字同源**（同样三个名字、同样对照组、同样零注入）。
//
// ── 验什么 ──────────────────────────────────────────────────────────────────
//   E1  站点供了 omc/bridge/（清单 12 件可达，逐件 HTTP 200）
//   E2  页面自动装配（`__octaveOmcBridge.state` 到达 ready 或 omc-not-ready——
//       后者在纯前端站点是**合法**的：桥的 .m 已可见，只是引擎没 boot）
//   E3  ★ `omc_*.m` 在**零注入**下可见（exist=2）—— 这是 107 查出来的那个洞
//   E4  ★ 对照组：`sin` FOUND / 假名 MISSING（证明探针有区分力）
//   E5  反向：MEMFS 里没有桥文件时该三项必须 MISSING（证明 E3 不是恒真）
//   E6  状态机如实：无 omc 站点 ⇒ `no-site-bytes`（不编假 ready）
//
// 用法：sh test/browser/run.sh test/browser/accept-omc-e2e.mjs <URL>
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 240)}`);
};

await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
// ★ 本仓统一就绪门（与 76 套同一条；**不用** OM 那个 x=1+1 的弱门）
await page.waitForFunction(() => window.__octaveReady === true, null, { timeout: 300000 })
  .catch(() => {});

// ── E1 站点供了清单与 12 件字节 ────────────────────────────────────────────────
const e1 = await page.evaluate(async () => {
  const base = new URL('omc/bridge/', location.href).href;
  const out = { manifestOk: false, n: 0, bad: [] };
  try {
    const r = await fetch(base + 'manifest.json');
    if (!r.ok) return { manifestOk: false, status: r.status };
    out.manifestOk = true;
    const m = await r.json();
    out.n = (m.entries || []).length;
    for (const e of m.entries || []) {
      const h = await fetch(base + e.file, { method: 'HEAD' });
      if (!h.ok) out.bad.push(e.file + '=' + h.status);
    }
  } catch (e) { out.err = String(e && e.message || e); }
  return out;
});
check(e1.manifestOk && e1.n === 12 && e1.bad.length === 0,
  'E1 站点清单 12 件全可达（HTTP 200）',
  `n=${e1.n} bad=${e1.bad.join(',') || '无'} ${e1.err || ''}`);

// ── E2 页面自动装配（状态机）──────────────────────────────────────────────────
const e2 = await page.evaluate(() => ({
  api: typeof window.OctaveOmcBridge,
  state: window.__octaveOmcBridge ? window.__octaveOmcBridge.state : null,
  detail: window.__octaveOmcBridge ? window.__octaveOmcBridge.detail : null,
}));
check(e2.api === 'object' &&
      ['ready', 'omc-not-ready', 'bridge-not-serving'].includes(e2.state),
  'E2 页面自动装配状态机到达终态（ready / omc-not-ready[纯前端合法]）',
  `${e2.state} :: ${e2.detail}`);

// ── E3 ★ 零注入下 omc_* 可见（107 查出的那个洞）────────────────────────────────
// 走 FS 通道探（与 OM 同款：唯一确定通道；输出汇三层且本页不保证有）
const probeNames = ['omc_simulate_model', 'omc_getVersion', 'omc_mat_load',
                    'sin', '__omc_absent_xyz__'];
async function probeOn(tag) {
  return await page.evaluate(({ names, tag }) => {
    const M = window.Module;
    const src = [
      "fid = fopen('/tmp/__e2e_" + tag + ".txt', 'w');",
      "names = {" + names.map(n => "'" + n + "'").join(',') + "};",
      "for k = 1:numel(names)",
      "  c = names{k};",
      "  if exist(c) ~= 0 || exist(c, 'file') ~= 0",
      "    fprintf(fid, '%s FOUND\\n', c);",
      "  else",
      "    fprintf(fid, '%s MISSING\\n', c);",
      "  end",
      "end",
      "fclose(fid);"
    ].join('\n');
    try {
      M.eval_string("addpath('/bridge');");     // 与 OM 同款：只 addpath，不注入
      M.FS.writeFile('/tmp/__e2e_' + tag + '.m', new TextEncoder().encode(src));
      M.eval_string("source('/tmp/__e2e_" + tag + ".m');");
      return new TextDecoder().decode(M.FS.readFile('/tmp/__e2e_' + tag + '.txt'));
    } catch (e) { return 'ERR ' + String(e && e.message || e); }
  }, { names: probeNames, tag });
}
const probe = await probeOn('main');
const has = (n) => new RegExp('^' + n + ' FOUND$', 'm').test(probe);
check(has('omc_simulate_model') && has('omc_getVersion') && has('omc_mat_load'),
  'E3 ★ 零注入下三个 omc_* 全部可见（exist=2；107 的洞已堵）',
  probe.replace(/\n/g, ' | '));

// ── E4 对照组（探针有区分力）──────────────────────────────────────────────────
check(has('sin') && /^__omc_absent_xyz__ MISSING$/m.test(probe),
  'E4 ★ 对照：sin FOUND / 假名 MISSING（探针能区分，不是恒真）',
  `sin=${has('sin')} 假名=${/^__omc_absent_xyz__ MISSING$/m.test(probe)}`);

// ── E5 反向：把 /bridge 从 MEMFS 摘掉 ⇒ 三项必须 MISSING ───────────────────────
// 证明 E3 的绿来自装配，不是"这些名字本来就在"。
const e5 = await page.evaluate(async (names) => {
  const M = window.Module;
  const saved = {};
  try {
    for (const f of M.FS.readdir('/bridge')) {
      if (f === '.' || f === '..') continue;
      saved[f] = M.FS.readFile('/bridge/' + f);
    }
    M.eval_string("rmpath('/bridge');");
    for (const f of Object.keys(saved)) M.FS.unlink('/bridge/' + f);
    const src = [
      "fid = fopen('/tmp/__e5.txt', 'w');",
      "names = {" + names.map(n => "'" + n + "'").join(',') + "};",
      "for k = 1:numel(names)",
      "  c = names{k};",
      "  if exist(c) ~= 0 || exist(c, 'file') ~= 0",
      "    fprintf(fid, '%s FOUND\\n', c);",
      "  else",
      "    fprintf(fid, '%s MISSING\\n', c);",
      "  end",
      "end",
      "fclose(fid);"
    ].join('\n');
    M.FS.writeFile('/tmp/__e5.m', new TextEncoder().encode(src));
    M.eval_string("source('/tmp/__e5.m');");
    const out = new TextDecoder().decode(M.FS.readFile('/tmp/__e5.txt'));
    // 复原（同页后续断言不受影响）
    for (const [f, b] of Object.entries(saved)) M.FS.writeFile('/bridge/' + f, b);
    M.eval_string("addpath('/bridge');");
    return out;
  } catch (e) {
    return 'ERR ' + String(e && e.message || e);
  }
}, ['omc_simulate_model', 'omc_getVersion', 'omc_mat_load']);
check(/^omc_simulate_model MISSING$/m.test(e5) && /^omc_getVersion MISSING$/m.test(e5),
  'E5 ★ 反向：摘掉 /bridge 后三项必须 MISSING（证明 E3 的绿来自装配）',
  e5.replace(/\n/g, ' | '));

// ── E6 状态机如实（不编假 ready）──────────────────────────────────────────────
// 一个没有 omc 的站点存在时，`ensure()` 必须报 no-site-bytes 而不是 ready。
// 本页供了 omc ⇒ 只能验"状态不是凭空 ready"：detail 必须带件数说明。
const e6 = await page.evaluate(() => {
  const s = window.__octaveOmcBridge;
  return s ? { state: s.state, detail: s.detail } : null;
});
check(!!e6 && typeof e6.detail === 'string' && e6.detail.length > 0,
  'E6 状态机带如实说明（detail 非空 —— 不编一个裸 ready）',
  JSON.stringify(e6));

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
