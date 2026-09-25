// Q10 探针：嵌套 iframe 的 cross-origin isolation 语义（2026-09-25，branch Slay）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/probe-iframe-coi.mjs
//      （或 cp 到 harness 目录后 `node probe-iframe-coi.mjs`，需要 playwright-core 可解析）
//
// 为什么有这个探针：外部评审断言「iframe 自己带 COOP/COEP 也不能在未隔离的顶层里拿到 COI，
//   因为需要整条 ancestor chain 满足 + 父页通过 Permissions Policy 委派 cross-origin-isolated」。
//   这条断言决定"教材站嵌入形态能不能用线程"（C7 生死），所以必须实测而不是照抄。
//
// 待证伪的假设（每条都能被本探针翻面）：
//   H1 顶层无 COI + iframe 自带 COOP/COEP（同源）⇒ iframe 的 crossOriginIsolated === false
//   H2 顶层无 COI + iframe 自带 COOP/COEP（跨源）⇒ 同样 false（跨源不能绕过 ancestor 约束）
//   H3 iframe 上加 allow="cross-origin-isolated" 对 H1/H2 无帮助（该委派要么不存在、要么仍需祖先 COI）
//   H4 顶层 COI（require-corp）⇒ 同源 iframe 也 COI（继承）
//   H5 顶层 COI（credentialless）⇒ 同源 iframe 也 COI（credentialless 也算隔离）
//   H6 顶层 COI（require-corp）+ 跨源 iframe 无 CORP ⇒ iframe 被拦（不加载）
//
// 度量：每格记录 top.crossOriginIsolated / frame 是否存在 / frame.crossOriginIsolated /
//       frame 里 typeof SharedArrayBuffer 与能否真的 new 出来 / frame 里 blob worker 能否 new SAB
import http from 'node:http';
import { chromium } from 'playwright-core';

const PORT_A = 8811;   // 顶层站（含逐路径头：/coi/* 与 /credless/* 带隔离头）
const PORT_B = 8812;   // 跨源站（全部响应带隔离头）
const A = `http://127.0.0.1:${PORT_A}`;
const B = `http://127.0.0.1:${PORT_B}`;

const FRAME_HTML = `<!DOCTYPE html><meta charset="utf-8"><title>frame</title><body>frame</body>`;

const COI = { 'Cross-Origin-Opener-Policy': 'same-origin',
              'Cross-Origin-Embedder-Policy': 'require-corp' };
const CREDLESS = { 'Cross-Origin-Opener-Policy': 'same-origin',
                   'Cross-Origin-Embedder-Policy': 'credentialless' };

function topHtml(cases) {
  const body = cases.map(c =>
    `<div>${c.id}</div>` +
    `<iframe name="${c.id}" style="width:300px;height:60px" src="${c.frame}"` +
    (c.allow ? ` allow="cross-origin-isolated"` : ``) + `></iframe>`).join('\n');
  return `<!DOCTYPE html><meta charset="utf-8"><title>top</title><body>\n${body}\n</body>`;
}

// 每格：id / 顶层页（含该页要发的头）/ iframe src / 是否加 allow
const CASES = [
  { id: 'h1_plain_same_coi',      top: `${A}/top.html`,          topH: null,      frame: `${A}/coi/frame.html`,         allow: false },
  { id: 'h3_plain_same_allow',    top: `${A}/top.html`,          topH: null,      frame: `${A}/coi/frame.html`,         allow: true  },
  { id: 'h2_plain_cross_coi',     top: `${A}/top.html`,          topH: null,      frame: `${B}/frame.html`,             allow: false },
  { id: 'h3_plain_cross_allow',   top: `${A}/top.html`,          topH: null,      frame: `${B}/frame.html`,             allow: true  },
  { id: 'h5_credless_same_coi',   top: `${A}/credless/top.html`, topH: CREDLESS,  frame: `${A}/coi/frame.html`,         allow: false },
  { id: 'h4_coi_same_coi',        top: `${A}/coi/top.html`,      topH: COI,       frame: `${A}/coi/frame.html`,         allow: false },
  { id: 'h3_coi_same_allow',      top: `${A}/coi/top.html`,      topH: COI,       frame: `${A}/coi/frame.html`,         allow: true  },
  { id: 'coi_cross_corp',         top: `${A}/coi/top.html`,      topH: COI,       frame: `${B}/frame.html?corp=1`,      allow: true  },
  { id: 'h6_coi_cross_nocorp',    top: `${A}/coi/top.html`,      topH: COI,       frame: `${B}/frame.html`,             allow: true  },
];

const serverA = http.createServer((req, res) => {
  const u = new URL(req.url, A);
  const p = u.pathname;
  const headers = { 'Content-Type': 'text/html; charset=utf-8' };
  let extra = null;
  if (p.startsWith('/coi/')) extra = COI;
  if (p.startsWith('/credless/')) extra = CREDLESS;
  Object.assign(headers, extra || {});
  if (p.endsWith('/frame.html')) { res.writeHead(200, headers); res.end(FRAME_HTML); return; }
  if (p.endsWith('/libtop.html')) {
    // 阶段 2：顶层自己去拉一个「跨源、无 CORP、无 crossorigin」的脚本（模拟教材站的 CDN 依赖）
    res.writeHead(200, headers);
    res.end(`<!DOCTYPE html><meta charset="utf-8"><title>libtop</title>
      <script src="${B}/lib.js"></script><body>libtop</body>`);
    return;
  }
  if (p.endsWith('/top.html')) { res.writeHead(200, headers); res.end(topHtml(CASES)); return; }
  res.writeHead(404, headers); res.end('nope');
});

const serverB = http.createServer((req, res) => {
  const u = new URL(req.url, B);
  const headers = { 'Content-Type': 'text/html; charset=utf-8', ...COI };
  if (u.searchParams.get('corp') === '1') headers['Cross-Origin-Resource-Policy'] = 'cross-origin';
  if (u.pathname.endsWith('/frame.html')) { res.writeHead(200, headers); res.end(FRAME_HTML); return; }
  if (u.pathname.endsWith('/lib.js')) {
    // 故意不带 CORP / crossorigin —— 就是 CDN 脚本的形态
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end('window.__cdnOK = true;');
    return;
  }
  res.writeHead(404, headers); res.end('nope');
});

await new Promise(r => serverA.listen(PORT_A, '127.0.0.1', r));
await new Promise(r => serverB.listen(PORT_B, '127.0.0.1', r));

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });

// 在给定 frame 里测能力（SAB + blob worker 里再试一次）
// 传函数而不是字符串：避免内层 worker 源码的引号/换行被 JS 字符串字面量吃掉（上一版踩过）
const frameProbe = async () => {
  const out = { coi: self.crossOriginIsolated, sabType: typeof SharedArrayBuffer,
                sabNew: null, workerSab: null, origin: location.origin };
  try { new SharedArrayBuffer(8); out.sabNew = 'ok'; } catch (e) { out.sabNew = 'throw:' + e.name; }
  try {
    const src = 'self.postMessage((()=>{try{new SharedArrayBuffer(8);return "ok"}catch(e){return "throw:"+e.name}})())';
    const w = new Worker(URL.createObjectURL(new Blob([src])));
    out.workerSab = await new Promise(res => {
      w.onmessage = e => res(e.data);
      w.onerror = () => res('worker-error');
      setTimeout(() => res('timeout'), 2000);
    });
  } catch (e) { out.workerSab = 'spawn-fail:' + e.name; }
  return out;
};

const results = {};
for (const c of CASES) {
  const page = await browser.newPage();
  const warnings = [];
  page.on('console', m => { if (/allow|cross-origin/i.test(m.text())) warnings.push(m.text().slice(0, 120)); });
  // 顶层页自身带的头由服务器决定；同一个 URL 走不同头，靠路径区分
  await page.goto(c.top, { waitUntil: 'load' });
  const top = await page.evaluate(() => ({ coi: self.crossOriginIsolated, sab: typeof SharedArrayBuffer }));
  const fr = page.frames().find(f => f.name() === c.id);
  let frame = { present: !!fr };
  if (fr) {
    try {
      frame = { present: true, url: fr.url(), ...(await fr.evaluate(frameProbe)) };
    } catch (e) { frame = { present: true, eval: 'fail:' + String(e).slice(0, 120) }; }
  }
  results[c.id] = { top, frame, warnings: [...new Set(warnings)] };
  await page.close();
}
// ── 阶段 2：顶层自己去拉「跨源、无 CORP、无 crossorigin」的脚本（教材站 CDN 的形态）──
// 决定"宿主站被 COI 后，它的 CDN 依赖还活不活"——credentialless 路径的前提。
const cdn = {};
for (const [name, path] of [['require_corp', '/coi/libtop.html'], ['credentialless', '/credless/libtop.html'],
                            ['plain(对照)', '/libtop.html']]) {
  const page = await browser.newPage();
  const blocked = [];
  page.on('requestfailed', r => blocked.push(`${r.url().slice(-8)}:${r.failure()?.errorText}`));
  await page.goto(A + path, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  cdn[name] = { loaded: await page.evaluate(() => window.__cdnOK === true), blocked };
  await page.close();
}
await browser.close();
serverA.close(); serverB.close();

console.log('\n══════ 阶段 2 · 宿主站 COI 之后它的 CDN 脚本还活不活 ══════');
for (const [k, v] of Object.entries(cdn)) {
  console.log(`  ${k.padEnd(15)} 脚本加载=${v.loaded ? '✓ 成功' : '✗ 被拦'}${v.blocked.length ? '  ' + v.blocked.join(',') : ''}`);
}

console.log('\n══════ Q10 四格矩阵（实测）══════');
console.log('格                        | top.COI | frame 存在 | frame.COI | SAB(type/new) | worker里SAB');
for (const c of CASES) {
  const r = results[c.id];
  const f = r.frame;
  console.log(`${c.id.padEnd(25)} | ${String(r.top.coi).padEnd(7)} | ${String(f.present).padEnd(10)} | ` +
    `${String(f.coi).padEnd(9)} | ${String(f.sabType)}/${String(f.sabNew)} | ${String(f.workerSab)}` +
    (f.eval ? `   ← ${f.eval}` : ''));
}
console.log('\nconsole 里的 allow 相关告警：');
for (const c of CASES) if (results[c.id].warnings.length) console.log(`  ${c.id}: ${results[c.id].warnings.join(' | ')}`);

// ── 假设判定（可证伪） ──
let pass = 0, fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} —— 实测：${got}`); }
}
console.log('\n──── 假设判定 ────');
const R = results;
check('H1 顶层无 COI + 同源 iframe 带头 ⇒ frame 不 COI',
  R.h1_plain_same_coi.frame.coi === false, `frame.coi=${R.h1_plain_same_coi.frame.coi}`);
check('H2 顶层无 COI + 跨源 iframe 带头 ⇒ frame 不 COI',
  R.h2_plain_cross_coi.frame.coi === false, `frame.coi=${R.h2_plain_cross_coi.frame.coi}`);
check('H4 顶层 COI ⇒ 同源 iframe 也 COI（继承）',
  R.h4_coi_same_coi.frame.coi === true, `frame.coi=${R.h4_coi_same_coi.frame.coi}`);
check('H5 顶层 credentialless ⇒ 同源 iframe 也 COI',
  R.h5_credless_same_coi.frame.coi === true, `frame.coi=${R.h5_credless_same_coi.frame.coi}`);
check('H6 顶层 require-corp + 跨源 iframe 无 CORP ⇒ 被拦/不加载',
  R.h6_coi_cross_nocorp.frame.present === false || R.h6_coi_cross_nocorp.frame.coi !== true,
  `present=${R.h6_coi_cross_nocorp.frame.present} coi=${R.h6_coi_cross_nocorp.frame.coi}`);
const allowHelps = (R.h3_plain_same_allow.frame.coi === true) || (R.h3_plain_cross_allow.frame.coi === true);
check('H3 allow="cross-origin-isolated" 无帮助（顶层未隔离时）', !allowHelps,
  `same=${R.h3_plain_same_allow.frame.coi} cross=${R.h3_plain_cross_allow.frame.coi}`);

console.log(`\n结果：${pass} PASS / ${fail} FAIL（9 格矩阵见上表）`);
process.exit(0);
