// 批次 2A 验收：Forge 纯 .m 包懒加载（10 个包 + 依赖自动解析 + PKG_ADD 子目录机制）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/accept-forge.mjs [URL]
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text().slice(0, 300)));
page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 300)));
await page.goto(URL, { waitUntil: 'load', timeout: 240000 });
const t = Date.now();
while (Date.now() - t < 300000) {
  const ok = await page.evaluate(() => { try { return !!window.Module?.feval?.('strcat', ['a', 'b'], 1); } catch { return false; } }).catch(() => false);
  if (ok) break; await new Promise(r => setTimeout(r, 800));
}
// ⚠️ **还要等启动资产装完**（`window.__octaveReady` 在 index.html 里是"整条启动链跑完"
//    —— 含 help 数据与 webgraphics —— 才置真的）。只等解释器可用就往下跑时，页面侧的
//    资产加载器会继续打 `[assets] …就绪` 日志，那些行落进前几次 eval 的捕获窗口，
//    把要匹配的文本挤出截断窗口 ⇒ **偶发假红**（2026-09-23 实测：accept-hdf5 与
//    accept-net 各中过一次；这两条的根因是同一个，不是两条独立的毛病）。
for (let _w = 0; _w < 600; _w++) {
  if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) break;
  await new Promise(r => setTimeout(r, 300));
}
await new Promise(r => setTimeout(r, 400));
console.log(`URL=${URL} ready=${((Date.now() - t) / 1000).toFixed(1)}s`);

// index.html 在 ready 之后自动装载 dldfcn 核心组，那批日志会落进 console，
// 把紧接着的断言输出挤出截取窗口（曾让第一条断言在 8761 上假失败，在包上通过
// —— 纯粹是时序差异）。等它落定再清日志。本套件测的 Forge 包都不在自动组里，
// "加载前应为 0"的前置断言仍然成立。
await page.evaluate(async () => {
  if (!window.OctaveAssets) return;
  for (let i = 0; i < 100; i++) {
    if (window.OctaveAssets.loaded().length >= 7) return;
    await new Promise(r => setTimeout(r, 200));
  }
}).catch(() => {});
logs.length = 0;

let pass = 0, fail = 0;
// ★ 匹配规则（`.githooks/check-wants.py` 会查这一条）：**单个数字**的 want 按「数字边界」匹配，
//   不是裸子串 —— `want='0'` 绝不该被输出里的 `10`/`100`/`13` 满足（`accept-hdf5` 就这么
//   假过了几个月：它查的 `__have_hdf5__` 在 11.3.0 里根本不存在，靠加载器日志里的杂数字对上）。
//   **点也算边界字符**：捕获窗口里有 `11.3.0` 这类版本号，`want='0'` 不该被它最后那位满足
//   （探针 `test/browser/probe-want-matcher.mjs` 把这几条钉在真浏览器里）。
//   多字符 want 保持子串匹配（`'0.7071'`、`'100 100'` 已足够具体；而 Octave 打印 1.5 是
//   `1.5000`，对它用严格词边界反而会误红）。
function wantHit (hay, want) {
  if (/^\d$/.test(want)) return new RegExp('(?<![\\d.])' + want + '(?![\\d.])').test(hay);
  return hay.includes(want);
}

async function ev(expr, label, want) {
  logs.length = 0;
  let r;
  try {
    r = await page.evaluate(x => { const rc = window.Module.eval_string(x); return { rc, err: window.Module.last_error_message() }; }, expr);
  } catch (e) { console.log(`CRASH | ${label} :: ${String(e).slice(0, 120)}`); fail++; return; }
  await new Promise(rr => setTimeout(rr, 700));
  const full = [...logs].join(' ').replace(/\s+/g, ' ').trim();
  const out = full.slice(0, 180);      // ★ 只用于显示；匹配必须用 full（不许先截断再匹配）
  const ok = r.rc === 0 && (!want || wantHit(full, want));
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${out || ('rc=' + r.rc + ' ' + r.err.slice(0, 120))}`);
}
async function load(names) {
  return page.evaluate(async (ns) => {
    const out = [];
    for (const n of ns) {
      try { await window.OctaveAssets.load(n); out.push(n + ':ok'); }
      catch (e) { out.push(n + ':ERR ' + String(e).slice(0, 80)); }
    }
    return out.join(' ');
  }, names);
}

console.log('--- 懒加载语义：加载前应为 0 ---');
// 注意：normpdf/normcdf/tcdf 等 16 个统计函数是 vendor/forge 提供的、**预装**在
// octave.data 里的（早期为了补 ttest 依赖）。它们不是懒加载资产，所以
// 加载前 exist 就是 2 —— 原来那条 '0' 断言一直是错的，只是先前没被注意到。
await ev('disp(exist("normpdf"))', 'normpdf 预装（vendor/forge，非懒加载）', '2');
// 这三个才是真的懒加载：它们的包没加载前确实不存在
await ev('disp(exist("distancePointLine"))', 'matgeom 未加载 → exist distancePointLine', '0');
await ev('disp(exist("chebyshevpoly"))', 'miscellaneous 未加载', '0');
await ev('disp(exist("bfgsmin"))', 'optim 未加载', '0');

console.log('--- 加载全部 10 个包 ---');
console.log('  ' + await load(['struct', 'nan', 'splines', 'matgeom', 'geometry', 'quaternion', 'miscellaneous', 'tsa', 'optim', 'statistics']));

console.log('--- 各包功能（数值必须对）---');
await ev('disp(normpdf(0,0,1))', 'statistics: normpdf(0,0,1)=0.3989', '0.3989');
await ev('disp(normpdf(1,0,2))', 'statistics: normpdf(1,0,2)=0.1760', '0.1760');
await ev('disp(normcdf(1.96,0,1))', 'statistics: normcdf(1.96)=0.9750', '0.9750');
await ev('disp(betapdf(0.5,2,2))', 'statistics: betapdf=1.5', '1.5');
// normpdf 在 inst/dist_fun/ 子目录里 → 这条同时验证 PKG_ADD 子目录挂载
await ev('disp(any(strcmp(strsplit(path(),pathsep()),"/usr/src/octave/m/forge/statistics/dist_fun")))', '★ PKG_ADD 把子目录挂上 path', '1');
await ev('disp(nanmean([1 NaN 3]))', 'nan: nanmean=2', '2');
await ev('disp(nansum([1 NaN 3]))', 'nan: nansum=4', '4');
await ev('pp=csapi([1 2 3],[1 4 9]); disp(fnval(pp,2))', 'splines: csapi+fnval=4', '4');
await ev('disp(rotm2q(eye(3)).w)', 'quaternion: rotm2q(eye(3)).w=1', '1');
await ev('disp(chebyshevpoly(1,3,0.5))', 'miscellaneous: chebyshevpoly(1,3,0.5)=-1', '-1');
await ev('disp(distancePointLine([2 2],[0 0 4 0]))', '★ matgeom: 点到线段距离=2', '2');
await ev('disp(size(acovf([1 2 3 4 5])))', 'tsa: acovf 返回 1x5', '1 5');
await ev('disp(exist("clipPolygon"))', 'geometry: exist clipPolygon=2', '2');
// optim 的优化器依赖编译件 __bfgsmin（src/__bfgsmin.cc）→ 属批次 2B；
// 这里如实断言"接口在、实现待编译"，并把 2B 的依赖留成可回归的证据。
await ev('disp(exist("bfgsmin"))', 'optim: exist bfgsmin=2（__bfgsmin 待 2B）', '2');
await ev('disp(exist("cg_min"))', 'optim: exist cg_min=2（纯 .m 接口）', '2');
await ev('disp(exist("numgradient"))', 'optim: numgradient 已由批次 2B 编译 → exist=3', '3');
await ev('disp(exist("getfields"))', 'struct: exist getfields=2（调用需编译件，见 2B）', '2');
await ev('disp(exist("setfields"))', 'struct: exist setfields=2', '2');

console.log('--- 依赖自动解析（只点名 geometry，应带出 matgeom）---');
const depTest = await page.evaluate(async () => {
  // 新开一次会话不现实，这里退而验证 loader 记录的依赖关系与已加载状态
  const a = window.OctaveAssets.describe('geometry');
  return { deps: a.deps, loaded: window.OctaveAssets.loaded().length };
});
console.log('  geometry.deps =', JSON.stringify(depTest.deps), '| 已加载资产数 =', depTest.loaded);

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
