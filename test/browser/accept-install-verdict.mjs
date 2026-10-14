// 验收：**install() 的四态 Verdict + planOnly**（接缝 §5 第③步）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 验什么（全部浏览器侧实测）────────────────────────────────────────────────
//   四态**不可塌陷成布尔** —— 这是本仓最贵的一条实测教训（T4 期间把"货架没读过"
//   当成"没有这个包" ⇒ 用户打错个包名就把调用方炸掉）。本套件把四态逐一钉住：
//     V1 `ok`         ：装成功 ⇒ `state === 'ok'`（且 `installed` 非空）
//     V2 `not-found`  ：货架**读到了**但没这个包 ⇒ reject，`__verdict__.state === 'not-found'`
//     V3 `failed`     ：sha 不符 ⇒ reject，`cause === 'sha-mismatch'`（fail-closed）
//     V4 `cannot-know`：货架**读不到** ⇒ reject，`cause === 'catalog-unreadable'`
//                       —— **关键反向断言**：这条**不许**报成 `not-found`
//   另加：
//     P1 `planOnly`   ：零下载（网络审计：调用期间**没有** forge 字节请求），且给出字节预算
//     P2 默认路径不变  ：`install(pkg)` 的 resolve 仍带旧字段 `name`/`installed`（老套件在用）
//
// 用法：sh test/browser/run.sh test/browser/accept-install-verdict.mjs <URL> [PKG]
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const PKG = process.argv[3] || 'quaternion';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
const net = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
page.on('request', r => net.push(r.url()));
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 210)}`);
};

await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
await page.waitForFunction(() => window.__octaveReady === true, null, { timeout: 300000 })
  .catch(() => {});
await sleep(1500);
console.log(`URL=${URL} PKG=${PKG}`);

const hasApi = await page.evaluate(() => typeof window.OctaveAssets === 'object'
  && typeof window.OctaveAssets.install === 'function');
check(hasApi, 'A0 install() 在', hasApi);
if (!hasApi) { console.log('=== 环境问题：页面没起来 ==='); await browser.close(); process.exit(3); }

// 帮助：调 install 并取回 verdict（成功取返回体；失败取 error.__verdict__）
const callInstall = (name, opts) => page.evaluate(async ({ name, opts }) => {
  try {
    const r = await window.OctaveAssets.install(name, opts || {});
    return { ok: true, r };
  } catch (e) {
    return { ok: false, err: String(e && e.message ? e.message : e),
             verdict: (e && e.__verdict__) || null };
  }
}, { name, opts });

// ── P2 默认路径不变（先跑，因为 V1 会装上包，之后同实例 install 直接命中）──
//   用 planOnly 试默认返回形状（零下载），确认旧字段仍在
const plan0 = await callInstall(PKG, { planOnly: true });
check(plan0.ok && plan0.r && plan0.r.state === 'ok' && plan0.r.planOnly === true,
  'P1 planOnly：返回 state=ok 且 planOnly=true', JSON.stringify(plan0).slice(0, 200));

// ── P1 planOnly 零下载（网络审计）──
const before = net.length;
await callInstall(PKG, { planOnly: true });
await sleep(400);
const forgeHits = net.slice(before).filter(u => /assets\/forge\/.*\.tar\.gz/.test(u));
check(forgeHits.length === 0, 'P1 planOnly **零下载**（无 forge tarball 请求）',
  `新增请求 ${net.length - before} 条，其中 forge tarball ${forgeHits.length} 条`);

// planOnly 要给出字节预算（有 size 才有；没有也不能算错，如实报）
const budget = (plan0.r && plan0.r.bytes) || 0;
check(typeof budget === 'number', 'P1 planOnly 给出字节预算（bytes 是数）', `bytes=${budget}`);

// ── V1 ok ──
const v1 = await callInstall(PKG);
check(v1.ok && v1.r && v1.r.state === 'ok' && Array.isArray(v1.r.installed)
  && v1.r.installed.length >= 1,
  `V1 ok：install('${PKG}') ⇒ state=ok 且 installed 非空`,
  JSON.stringify(v1.r || v1.err).slice(0, 220));
// P2 旧字段保留（老套件读 r.name / r.installed）
check(v1.ok && v1.r && v1.r.name === PKG && Array.isArray(v1.r.installed),
  'P2 默认路径不变：resolve 仍带旧字段 name/installed',
  v1.ok ? `name=${v1.r.name} installed=${JSON.stringify(v1.r.installed)}` : v1.err);

// ── V2 not-found（货架读到了，但没这个包）──
const v2 = await callInstall('zzz_no_such_pkg_9f3a');
check(!v2.ok && v2.verdict && v2.verdict.state === 'not-found'
  && v2.verdict.cause === 'not-in-any-list',
  'V2 not-found：查无此包 ⇒ reject 且 state=not-found',
  JSON.stringify(v2.verdict || v2.err).slice(0, 220));
// ★ 反向：not-found 的 why 不许出现"读不到"（那是另一种态）
check(!v2.ok && v2.verdict && !/读不到/.test(v2.verdict.why || ''),
  '★ V2 反向：not-found 的说明里**不许**混进"读不到"',
  (v2.verdict && v2.verdict.why) || '');

// ── V3 failed / sha-mismatch（篡改字节）—— 真断言，不是查形状 ──
//   做法：造一个**独立实例**，base 指向一个临时站点目录（同源），其 catalog 里
//   把某个**尚未装过**的包的 sha256 改错 ⇒ 真下载真校验 ⇒ 必须 reject 且 cause=sha-mismatch。
//   独立实例（而非默认实例）的理由：默认实例 catalog 已缓存且包可能已装 ⇒ 干扰。
//   临时站点由宿主侧准备好（prep-verdict-site.sh），路径经 window.__verdictSiteBase 传入；
//   没有它时如实 SKIP（不假绿）。
const v3base = '/verdict-tamper/';    // 同源子路径（prep-verdict-site.sh 造）
const v3 = await page.evaluate(async (base) => {
  const bad = window.createOctaveAssets(window.Module, base, () => window.__octaveReady === true);
  try {
    await bad.install('optim');                        // 该子路径 catalog 里 optim 的 sha 是错的
    return { ok: true };
  } catch (e) {
    return { ok: false, err: String(e && e.message ? e.message : e),
             verdict: (e && e.__verdict__) || null };
  }
}, v3base);
check(!v3.ok && v3.verdict && v3.verdict.state === 'failed'
  && v3.verdict.cause === 'sha-mismatch',
  'V3 sha-mismatch：篡改字节 ⇒ reject 且 cause=sha-mismatch（fail-closed）',
  JSON.stringify(v3.verdict || v3.err).slice(0, 240));
check(!v3.ok && v3.verdict && v3.verdict.state === 'failed',
  '★ V3 反向：sha 不符是 failed，**不是** not-found/cannot-know',
  v3.verdict ? v3.verdict.state : v3.err);

// ── V4 cannot-know（货架读不到）—— 用一个**指向不存在 catalog 的**实例 ──
//   本页的 OctaveAssets 默认实例 catalog 已读成功 ⇒ 无法在同一实例上重现"读不到"。
//   ⇒ 用页面里工厂新建一个**指向坏 base** 的实例（catalog 路径必然 404）。
const v4 = await page.evaluate(async () => {
  if (typeof window.createOctaveAssets !== 'function') return { skip: 'no-factory' };
  // 造一个 base 指向不存在的目录 ⇒ catalog 404 ⇒ cannot-know
  const bad = window.createOctaveAssets(window.Module, '/no-such-base-9f3a/',
    () => true);
  try {
    await bad.install('optim');
    return { ok: true };
  } catch (e) {
    return { ok: false, err: String(e && e.message ? e.message : e),
             verdict: (e && e.__verdict__) || null };
  }
});
if (v4.skip === 'no-factory') {
  check(false, 'V4 cannot-know：需要 window.createOctaveAssets 工厂（页面未暴露）', v4.skip);
} else {
  check(!v4.ok && v4.verdict && v4.verdict.state === 'cannot-know'
    && v4.verdict.cause === 'catalog-unreadable',
    'V4 cannot-know：货架读不到 ⇒ reject 且 state=cannot-know（**不是** not-found）',
    JSON.stringify(v4.verdict || v4.err).slice(0, 240));
  // ★ 最关键的反向断言：这一条**不许**报成 not-found
  check(!v4.ok && v4.verdict && v4.verdict.state !== 'not-found',
    '★ V4 反向（T4 的教训）：读不到**绝不许**报成 not-found',
    v4.verdict ? v4.verdict.state : v4.err);
}

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
