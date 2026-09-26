// 验收：C6 去单例嵌入契约 —— 同页两实例（E6 判据，2026-09-26）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/accept-embed-multi.mjs [URL]
// 判据：
//   A ★ 前置：默认实例照常（window.__octaveReady === true 是布尔；window.Module 是默认实例）
//   B ★ 反向：挂点不存在时 createOctaveHost 必须 throw（不许静默）
//   C ★ 第二实例独立 boot（mount:#host2 + home:/home/web_user/i2），ready 且带自己的输出区
//   D ★ 状态隔离：交替 100 次 eval（默认 x=1 / i2 x=2），rc 全 0，两边各自读到自己的值
//   E ★ FS 隔离：两边各自写的文件互相不可见（readFile 必须 throw）
//   F ★ 资产进对实例：i2 的 /tmp/webassets.json 存在且 loaded 含 plotbridge；i2 里 audioread 存在
//   G 别名不被覆盖：window.Module / __octaveReady / OctaveAssets 在 i2 建立后仍指默认实例
//   H ★ 已知边界（记档）：window.OctaveP5 容器仍是单个 #p5figure —— 非默认实例无图形上屏
//     （wasm 侧 publish_png 硬编码 window.OctaveP5，分派要与下一次重链合并，PLAN-threads §0.5）
import { chromium } from 'playwright-core';
const URL = process.argv[2] || 'http://127.0.0.1:8761/';

let pass = 0, fail = 0;
const check = (ok, label, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 240)}`); };

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await page.goto(URL, { waitUntil: 'load', timeout: 120000 });

// A：默认实例就绪
let ok = false;
for (let t = 0; t < 600; t++) {
  if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) { ok = true; break; }
  await new Promise(r => setTimeout(r, 250));
}
const pre = await page.evaluate(() => ({
  ready: window.__octaveReady, readyType: typeof window.__octaveReady,
  hosts: (window.__octaveHosts || []).length,
  modIsHost0: window.__octaveHosts && window.__octaveHosts[0] ? window.__octaveHosts[0].mod === window.Module : null,
}));
check(ok && pre.ready === true && pre.readyType === 'boolean' && pre.hosts === 1,
  '★ A 默认实例就绪且 __octaveReady 是布尔 true', JSON.stringify(pre));
check(pre.modIsHost0 === true, '★ A2 window.Module === 注册表[0].mod（默认实例）', `modIsHost0=${pre.modIsHost0}`);

// B：反向 —— 挂点不存在必须 throw
const badMount = await page.evaluate(() => {
  try { window.createOctaveHost({ mount: '#definitely-not-here', id: 'bad' }); return 'no-throw'; }
  catch (e) { return 'throw:' + String(e).slice(0, 80); }
});
check(/^throw/.test(badMount), '★ B 反向：挂点不存在必须 throw', badMount);

// C：第二实例 boot（在页面里加挂点 + 工厂 + OCTAVE()）
await page.evaluate(() => {
  var d = document.createElement('div');
  d.id = 'host2';
  document.body.appendChild(d);
});
const created = await page.evaluate(() => {
  try {
    var m2 = window.createOctaveHost({ mount: '#host2', home: '/home/web_user/i2', id: 'i2' });
    window.__mod2 = m2;
    OCTAVE(m2);
    return { ok: true, hosts: window.__octaveHosts.length };
  } catch (e) { return { ok: false, err: String(e).slice(0, 120) }; }
});
check(created.ok && created.hosts === 2, '★ C1 第二实例创建并 OCTAVE()（注册表 = 2）', JSON.stringify(created));

let i2Ready = false;
for (let t = 0; t < 900; t++) {
  if (await page.evaluate(() => {
    var h = (window.__octaveHosts || []).find(x => x.id === 'i2');
    return !!(h && h.ready === true);
  }).catch(() => false)) { i2Ready = true; break; }
  await new Promise(r => setTimeout(r, 250));
}
check(i2Ready, '★ C2 第二实例 ready（自己的资产链跑完）', `i2Ready=${i2Ready}`);
const out2 = await page.evaluate(() => {
  var el = document.querySelector('#host2 pre');
  return { has: !!el, len: el ? el.textContent.length : -1 };
});
check(out2.has, '★ C3 i2 有自己的输出区（#host2 pre）', JSON.stringify(out2));

// D：状态隔离 —— 交替 100 次 eval
const alt = await page.evaluate(async () => {
  var d = window.Module, m2 = window.__mod2;
  var bad = 0;
  for (var i = 0; i < 100; i++) {
    var rc1 = d.eval_string('x=1; fid=fopen("/tmp/multi_a.txt","w"); fprintf(fid,"%d",x); fclose(fid);');
    var rc2 = m2.eval_string('x=2; fid=fopen("/tmp/multi_b.txt","w"); fprintf(fid,"%d",x); fclose(fid);');
    if (rc1 !== 0 || rc2 !== 0) bad++;
  }
  function rd(M, p) { try { return new TextDecoder().decode(M.FS.readFile(p)); } catch (e) { return 'ERR:' + String(e).slice(0, 60); } }
  return { bad, a: rd(d, '/tmp/multi_a.txt'), b: rd(m2, '/tmp/multi_b.txt') };
});
check(alt.bad === 0 && alt.a === '1' && alt.b === '2',
  '★ D 状态隔离：交替 100 次 eval 全 rc=0，默认读到 1、i2 读到 2', JSON.stringify(alt));

// E：FS 隔离 —— 两边文件互相不可见
const fsIso = await page.evaluate(() => {
  function tryRead(M, p) { try { M.FS.readFile(p); return 'visible'; } catch (e) { return 'isolated'; } }
  return { dSeesB: tryRead(window.Module, '/tmp/multi_b.txt'), i2SeesA: tryRead(window.__mod2, '/tmp/multi_a.txt') };
});
check(fsIso.dSeesB === 'isolated' && fsIso.i2SeesA === 'isolated',
  '★ E FS 隔离：默认看不到 i2 的文件，反之亦然', JSON.stringify(fsIso));

// F：资产进对实例
const assets = await page.evaluate(() => {
  function ledger(M) {
    try { return JSON.parse(new TextDecoder().decode(M.FS.readFile('/tmp/webassets.json'))); }
    catch (e) { return null; }
  }
  var d = ledger(window.Module), m2 = ledger(window.__mod2);
  // ⚠️ eval_string 返回的是 **rc**，不是表达式值 —— exist() 的值要走 FS 写回读出
  var i2HasAudioread = -1;
  try {
    window.__mod2.eval_string("fid=fopen('/tmp/multi_exist.txt','w'); fprintf(fid,'%d', exist('audioread')); fclose(fid);");
    i2HasAudioread = Number(new TextDecoder().decode(window.__mod2.FS.readFile('/tmp/multi_exist.txt')));
  } catch (e) { i2HasAudioread = 'ERR:' + String(e).slice(0, 60); }
  return { dOk: !!(d && (d.loaded || []).indexOf('plotbridge') >= 0),
           m2Ok: !!(m2 && (m2.loaded || []).indexOf('plotbridge') >= 0),
           i2Audioread: i2HasAudioread };
});
check(assets.dOk, 'F 默认实例账本含 plotbridge', JSON.stringify(assets).slice(0, 160));
check(assets.m2Ok, '★ F2 i2 自己的账本含 plotbridge（资产写进了对的 FS）', JSON.stringify(assets).slice(0, 160));
check(assets.i2Audioread >= 2,
  '★ F3 i2 里 audioread 存在（dldfcn 核心组装进了 i2）', `exist=${assets.i2Audioread}`);

// G：别名不被覆盖
const alias = await page.evaluate(() => ({
  modIsHost0: window.__octaveHosts[0].mod === window.Module,
  ready: window.__octaveReady,
  assetsIsDefault: !!window.OctaveAssets && window.OctaveAssets.isLoaded('plotbridge'),
}));
check(alias.modIsHost0 && alias.ready === true && alias.assetsIsDefault,
  '★ G 别名不覆盖：window.Module/__octaveReady/OctaveAssets 仍指默认实例', JSON.stringify(alias));

// H：已知边界（记档）：第二实例无图形上屏
const p5 = await page.evaluate(() => ({
  containers: document.querySelectorAll('#p5figure').length,
  octP5: typeof window.OctaveP5,
}));
check(p5.containers <= 1 && p5.octP5 === 'object',
  '★ H 已知边界：#p5figure 至多一个（出图后才出现）、OctaveP5 仍是默认实例桥（非默认实例无图形上屏，wasm 侧分派待下次重链）',
  JSON.stringify(p5));

if (errs.length) console.log('   ⚠️ 页面报错：' + errs.slice(0, 3).join(' // '));
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
