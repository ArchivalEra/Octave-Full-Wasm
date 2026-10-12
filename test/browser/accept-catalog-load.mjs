// 验收（T4）：`pkg load <货架上的包>` 自动从货架装载（2026-10-12）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 这一套验的是哪条路（先读，否则绿了也不知道绿的是什么）──────────────────────
// 包有**两个来源**，点火方式不同：
//   · 随站清单（`assets/pkg/*.js`，字节已随站）⇒ `OctaveAssets.load(名)`
//   · 货架（`assets/forge-catalog.json`）      ⇒ `OctaveAssets.install(名)`
//     （fetch 同源 tarball + sha256 + 引擎内建 gunzip/untar —— 设计稿 §3）
// 老 shim 只认第一个来源 ⇒ 货架上的包敲 `pkg load` 只得到误导人的 "is not installed"。
//
// ★ **前提（不成立就响亮地失败，别给假绿）**：本套件跑在
//   `build/113/prep-catalog-accept-site.sh` 造出的副本上 —— 那份副本把 `splines`
//   从随站清单里摘掉、只留在货架上。判据 A0 直接验这个前提；前提不成立时后面全是假绿。
//
// ── 断言（每条都配了"反面对着红"的形态）────────────────────────────────────
//   A0 前提：splines 不在随站清单/目录里，但在货架上（且 tarball 在磁盘上）
//   A1 机制在位：`which('pkg')` 指向 webshims 的 shim；判定函数可调用
//   B1 来源判定：`__webpackage_source__('splines')` = ship='shelf'
//   B2 ★ **端到端**：`pkg load splines`（eval_async）⇒ 真连上网络拉 tarball ⇒ 落盘
//   B3 真装上：`exist('splines')` 可见、`pkg list` 看得见、`which('csaps')` 在包目录里
//   B4 ★ **真算**：`csaps` 出一个**已知值**（与宿主 Octave 算的逐位比 —— 不许只看"没报错"）
//   C1 幂等：再敲一次 `pkg load splines` ⇒ 成功且**不再发生网络下载**（计数为 0）
//   D1 反向：`pkg load zzznope_xyz` ⇒ 明确失败（不许静默）
//   D2 反向：网络**只发生在装那一刻**（读 catalog 那次不算）—— 由请求计数证明
//   D3 反向：装完的包**从待装名单里消失**（`__webassets_pending__` 不再含它）
//
// 用法：SITE_DIR=<prep 造出的目录> node test/browser/accept-catalog-load.mjs
//   （SITE_DIR 不给 ⇒ 默认 /mnt/hdd/octave-wasm-build/site-catalog-accept）
//   本套件**自托管**（注入 COOP/COEP ⇒ 页面走 w64 档），不看外部 8761/8768。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const DIR = process.env.SITE_DIR || '/mnt/hdd/octave-wasm-build/site-catalog-accept';
const PKG = 'splines';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
               '.wasm': 'application/wasm', '.json': 'application/json',
               '.data': 'application/octet-stream', '.oct': 'application/octet-stream',
               '.gz': 'application/gzip' };
// 四格站点带头 ⇒ 页面跑 w64/。COI 必须在**顶层页**上（探针实测：iframe 自带无效）。
const COI = { 'Cross-Origin-Opener-Policy': 'same-origin',
              'Cross-Origin-Embedder-Policy': 'require-corp' };
const server = createServer(async (req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel.endsWith('/')) rel += 'index.html';   // ⚠️ 目录索引要自己映射：Node 的 http 不代劳
  const p = normalize(join(DIR, rel));
  if (!p.startsWith(normalize(DIR))) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(p);
    res.writeHead(200, Object.assign({ 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }, COI));
    res.end(body);
  } catch { res.writeHead(404).end('nope'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL = `http://127.0.0.1:${server.address().port}/`;

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 230)}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
const net = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 200)));
page.on('request', r => net.push(r.url()));

await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
await page.waitForFunction(() => window.__octaveReady === true, null, { timeout: 300000 })
  .catch(() => {});
await sleep(1500);
console.log(`URL=${URL}\nSITE_DIR=${DIR} PKG=${PKG}`);

// ── 工具：跑一段 .m 并收集 stdout（同 accept-pkgview 的通道）──────────────────
const clean = l => l.filter(x => !/^LIBGL:/.test(x) && !/^\[\.WebGL/.test(x)
  && !/^WebGL: INVALID/.test(x)).join(' ').replace(/\s+/g, ' ').trim();
async function ev (code, label, want, ms = 60000) {
  const sn = '__T4' + Math.random().toString(36).slice(2) + '__';
  logs.length = 0;
  let r;
  try {
    r = await Promise.race([
      page.evaluate(([x, s]) => ({ rc: window.Module.eval_string(`${x}\ndisp('${s}');`), err: window.Module.last_error_message() }), [code, sn]),
      new Promise((_, rej) => setTimeout(() => rej(new Error('__HANG__')), ms)),
    ]);
  } catch (e) { console.log(`CRASH | ${label} :: ${String(e).slice(0, 140)}`); fail++; return ''; }
  const t = Date.now();
  while (want && Date.now() - t < 12000 && !want.test(clean(logs))) { await sleep(150); }
  const out = clean(logs);
  const ok = r.rc === 0 && (!want || want.test(out));
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${out.slice(0, 190) || ('rc=' + r.rc + ' ' + String(r.err).slice(0, 130))}`);
  return out;
}

// ── 工具：在**挂起**上下文里跑 .m（`pkg load` 必须走 eval_async）──────────────────
//   ⚠️ 错误**不会**让 eval_async 的 promise reject（实测：`pkg load 不存在的包` 时它照常
//      resolve，只是后面的语句没执行）⇒ 判据必须把 try/catch 写在 **Octave 代码里**，
//      与 `accept-pkg.mjs` 的既有做法一致。靠 JS 侧 catch 会得到一个假绿。
async function evAsync (code, label, want, ms = 120000) {
  logs.length = 0;
  let threw = '';
  try {
    await Promise.race([
      page.evaluate(x => window.Module.eval_async(x),
        `try\n${code}\ncatch e\n  disp(['__T4ERR__: ' e.message]);\nend`),
      new Promise((_, rej) => setTimeout(() => rej(new Error('__HANG__')), ms)),
    ]);
  } catch (e) { threw = String(e).slice(0, 200); }
  const t = Date.now();
  while (want && Date.now() - t < 15000 && !want.test(clean(logs))) { await sleep(150); }
  const out = clean(logs);
  const ok = !threw && (!want || want.test(out));
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${out.slice(0, 200) || threw}`);
  return out;
}

// ── A0 前提（★ 最重要的那条：前提不成立 ⇒ 后面全是假绿）────────────────────────
const premise = await page.evaluate(async (pkg) => {
  try {
    const man = await (await fetch('assets/manifest.json')).json();
    const cat = await (await fetch('assets/forge-catalog.json')).json();
    const loaded = await (await fetch('assets-loader.js')).text();
    return {
      ok: true,
      shipped: (man.assets || []).some(a => a.name === pkg),
      onShelf: (cat.packs || []).some(p => p.name === pkg),
      api: typeof window.OctaveAssets?.install === 'function',
      // ★ 站点上的加载器必须是**本批**那份（它才落 catalog_state/catalog_packs 进账本）。
      //   旧加载器 ⇒ 货架字段缺席 ⇒ 判定恒为 unknown ⇒ 测的根本不是新路径（我第一次就栽在这）。
      loaderNew: /catalog_state/.test(loaded),
    };
  } catch (e) { return { ok: false, err: String(e).slice(0, 160) }; }
}, PKG);
check(premise.ok && premise.shipped === false && premise.onShelf === true,
  `A0 前提：${PKG} **不在**随站清单、在货架上（否则验的不是货架路径）`,
  `shipped=${premise.shipped} onShelf=${premise.onShelf}`);
check(premise.api, 'A0b `OctaveAssets.install()` 在（货架装载的接口）', String(premise.api));
check(premise.loaderNew,
  '★ A0c 站点加载器是**本批**那份（账本里会落 catalog_state ⇒ 否则判定恒 unknown，测的不是新路）',
  `assets-loader.js 含 catalog_state: ${premise.loaderNew}`);

// ── A1 机制在位 ────────────────────────────────────────────────────────────
await page.evaluate(() => Module.eval_async(
  "fid=fopen('/tmp/t4w.txt','w'); fprintf(fid,'%s',which('pkg')); fclose(fid); 0"));
const whichPkg = await page.evaluate(() => Module.FS.readFile('/tmp/t4w.txt', { encoding: 'utf8' }));
check(/webshims\/pkg\.m/.test(whichPkg), 'A1 `which(pkg)` 指向 webshims 的 shim（本批的 shim 在位）', whichPkg);
const hasFn = await ev("printf('|%d', exist('__webpackage_source__') == 2)",
  'A1b 来源判定函数在（`__webpackage_source__`）', /\|1/);
check(/\|1/.test(hasFn), 'A1b `__webpackage_source__` 可调用（本批新增的纯函数随包发了）', hasFn);

// ── B1 来源判定（货架在**开机**就读好了 ⇒ 这里同步可答，不需要等）────────────────
//   ★ 为什么是开机读（实测教训，别改回"按需读"）：`pkg load` 的 shim 要回答"这包从哪来"，
//     而答案在货架目录里。若现读就得**等**（`__web_pause_ms__`）⇒ **同步入口**
//     （页面队列外的 `eval_string`）当场抛 `SuspendError`，且那个抛错在 Octave 侧
//     try/catch **抓不住**（直接穿到 JS）⇒ 打错个包名就炸掉调用方（accept-pkg 当场变 CRASH）。
const srcShelf = await ev(
  `[s,w,st] = __webpackage_source__('${PKG}'); printf('|src=%s state=%s', s, st)`,
  `★ B1 货架包被正确归类（该走 install 那条火）`, /\|src=shelf/);
check(/\|src=shelf/.test(srcShelf),
  `★ B1 \`__webpackage_source__('${PKG}')\` = shelf（开机读好了货架 ⇒ 同步可答）`, srcShelf);

// ── B2 ★ 端到端：`pkg load` 自动从货架装上（在**挂起**上下文里跑）────────────
net.length = 0;
const t0 = Date.now();
const b2out = await evAsync(`pkg load ${PKG}; disp('LOADED-OK');`,
  `★ B2 \`pkg load ${PKG}\` 成功（自动从货架装载）`, /LOADED-OK/, 180000);
const loadMs = Date.now() - t0;
check(/LOADED-OK/.test(b2out) && !/__T4ERR__/.test(b2out),
  `B2b 且**没有**报错（\`pkg load\` 真走完了装配 + 核心 load）`,
  `${(loadMs / 1000).toFixed(1)}s :: ${b2out.slice(0, 160)}`);
const tarHits = net.filter(u => /\/assets\/forge\/.*\.tar\.gz/.test(u));
check(tarHits.length >= 1, '★ B2c 装载时**真的发生了**货架下载（按需性的正向证据）',
  `${tarHits.length} 个 tarball 请求：${tarHits.map(u => u.split('/').pop()).join(', ')}`);

// ── B3 真装上 ──────────────────────────────────────────────────────────────
await ev(`printf('|n=%d', numel(dir('/usr/src/octave/m/forge/${PKG}')) - 2)`,
  'B3 包根真的落盘（文件数 > 0）', /\|n=[1-9]/);
const listed = await ev(`L = pkg('list'); printf('|has=%d n=%d', any(strcmp({L{:}.name}, '${PKG}')), numel(L))`,
  'B3b 核心 `pkg list` 看得见它（pkgfix 重扫生效）', /\|has=1/);
check(/\|has=1/.test(listed), '★ B3b `pkg list` 里有它', listed);
const whichF = await ev(`printf('|%s', which('csaps'))`, 'B3c 包内函数可解析（`which csaps`）', /\|.*csaps/);
check(/forge\/splines.*csaps\.m/.test(whichF), '★ B3c `which csaps` 指向包目录（不是空、不是别处）', whichF);

// ── B4 ★ 真算（与宿主 Octave 的已知值逐位比）──────────────────────────────────
const csapsOut = await ev("printf('|v=%.10f|w1=%.10f|w2=%.10f', csaps([0 1 2],[0 1 0],1,1), "
  + "csaps([0 1 2],[0 1 0],1,0.5), csaps([0 1 2],[0 1 0],1,1.5))",
  '★ B4 `csaps` 真算（不是"函数存在"而已）', /v=1\.0000000000/);
check(/v=1\.0000000000\|w1=0\.6875000000\|w2=0\.6875000000/.test(csapsOut),
  '★ B4 `csaps` 数值与宿主 Octave 逐位一致（v=1, w1=w2=0.6875）', csapsOut);

// ── C1 幂等 + 不再下载 ─────────────────────────────────────────────────────
net.length = 0;
const c1out = await evAsync(`pkg load ${PKG}; disp('AGAIN-OK');`,
  'C1 再敲一次 `pkg load` 仍然成功（幂等）', /AGAIN-OK/, 60000);
check(/AGAIN-OK/.test(c1out) && !/__T4ERR__/.test(c1out), 'C1b 幂等且无错', c1out.slice(0, 150));
check(net.filter(u => /\.tar\.gz/.test(u)).length === 0,
  '★ C1c 第二次**不再下载**（已装 ⇒ 不发请求；这是幂等的真判据）',
  `tarball 请求数=${net.filter(u => /\.tar\.gz/.test(u)).length}`);

// ── D3 反向：装完从待装名单里消失 ───────────────────────────────────────────
const pend = await ev(`p = __webassets_pending__(); printf('|has=%d', any(strcmp(p, '${PKG}')))`,
  `D3 反向：装完后 ${PKG} 不再出现在待装名单里`, /\|has=0/);
check(/\|has=0/.test(pend), 'D3 待装名单里没有它了（两本账合流正确）', pend);

// ── D1 反向：不存在的包 ⇒ 明确失败（★ 判据在 Octave 代码里，不靠 JS 侧 catch）──
const t1 = Date.now();
const d1out = await evAsync('pkg load zzznope_xyz_9f; disp("UNEXPECTED-OK");',
  '★ D1 反向：装不存在的包 ⇒ **明确失败**（不许静默成功）', /__T4ERR__/, 60000);
const failMs = Date.now() - t1;
check(/__T4ERR__/.test(d1out) && /zzznope_xyz_9f/.test(d1out) && !/UNEXPECTED-OK/.test(d1out),
  'D1b 报错里点名了那个包，且**没有**出现 UNEXPECTED-OK', d1out.slice(0, 190));

// ── D4 反向（★ 实测回归）：**同步入口**敲一个不存在的包 ⇒ 不许把调用方炸掉 ─────────
//   现场：`eval_string("pkg load zzznope")`（页面命令队列外，非 promising 栈）。
//   第一版的 shim 在问来源前**等货架**（`__web_pause_ms__`）⇒ 同步栈上当场抛
//   `SuspendError: trying to suspend without WebAssembly.promising`，而它在 Octave 侧
//   try/catch **抓不住**（直接穿到 JS，accept-pkg 的"未安装的包 ⇒ 清晰报错"变 CRASH）。
//   ⇒ 判据两条：① 不抛 SuspendError；② 拿到的仍是核心那句可读的 "is not installed"。
const sync = await page.evaluate(() => {
  try {
    const rc = window.Module.eval_string(
      "try; pkg load zzznope_xyz_9f; disp('SYNC-NOTHROW'); "
      + "catch e; disp(['SYNC-CAUGHT: ' e.message]); end");
    return { ok: true, rc, err: window.Module.last_error_message() };
  } catch (e) { return { ok: false, err: String(e).slice(0, 200) }; }
});
check(sync.ok && !/SuspendError/.test(String(sync.err)),
  '★ D4 反向：**同步入口**敲不存在的包 ⇒ 不许抛 SuspendError（那是挂起原语用在错栈上）',
  JSON.stringify(sync).slice(0, 200));

// ── D2 反向：失败要**立刻**报，不许干等满 60 s 轮询上限 ────────────────────────
check(failMs < 15000, '★ D2 反向：**失败立刻返回**（老实现要干等满 60 s 轮询上限）',
  `${(failMs / 1000).toFixed(1)}s（阈值 15 s）`);

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
server.close();
process.exit(fail === 0 ? 0 : 1);
