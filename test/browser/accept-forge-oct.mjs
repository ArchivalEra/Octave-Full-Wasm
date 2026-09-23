// 批次 2B 验收：Forge 包的**编译件**（.oct side module）经懒加载车道生效
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 覆盖 5 个包的 19 个 .oct：struct(4) optim(5) statistics(7) geometry(1) miscellaneous(2)
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/accept-forge-oct.mjs [URL]
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

let pass = 0, fail = 0;
async function ev(expr, label, want) {
  logs.length = 0;
  let r;
  try {
    r = await page.evaluate(x => { const rc = window.Module.eval_string(x); return { rc, err: window.Module.last_error_message() }; }, expr);
  } catch (e) { console.log(`CRASH | ${label} :: ${String(e).slice(0, 120)}`); fail++; return; }
  await new Promise(rr => setTimeout(rr, 700));
  const out = [...logs].join(' ').replace(/\s+/g, ' ').trim().slice(0, 180);
  const ok = r.rc === 0 && (!want || out.includes(want));
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${out || ('rc=' + r.rc + ' ' + r.err.slice(0, 120))}`);
}

// 加载全部带编译件的包
const loaded = await page.evaluate(async () => {
  const names = ['struct', 'optim', 'statistics', 'geometry', 'miscellaneous'];
  const out = [];
  for (const n of names) {
    try { await window.OctaveAssets.load(n); out.push(n); } catch (e) { out.push(n + ':ERR'); }
  }
  return { loaded: out, all: window.OctaveAssets.loaded() };
});
console.log('加载:', loaded.loaded.join(' '));
console.log('全部已加载资产:', loaded.all.join(' '));

console.log('--- struct 编译件 ---');
await ev('disp(exist("fields2cell"))', 'fields2cell 已加载', '3');
await ev('s=struct("key","value"); disp(getfields(s,"key"))', '★ getfields 数值', 'value');
await ev('s=struct("hello",1,"world",2); [a,b]=getfields(s,"hello","world"); disp([a b])', '★ getfields 多输出', '1 2');

console.log('--- optim 编译件 ---');
await page.evaluate(() => { Module.FS.writeFile('/tmp/objfun.m', 'function y = objfun(x)\n  y = sum((x-[1;2]).^2);\nendfunction\n'); Module.eval_string('addpath("/tmp")'); });
await ev('[p,o]=bfgsmin("objfun",{[0;0]}); disp(round(p\'*1e6)/1e6)', '★ bfgsmin → [1 2]', '1 2');
await ev('disp(o<1e-10)', '★ 目标值收敛到 0', '1');
await ev('[x,f]=fminunc(@(x) (x-3).^2+1, 0); disp(round(x*1e4)/1e4)', '★ fminunc → 3', '3');

console.log('--- statistics 编译件（libsvm / fcnn / editDistance）---');
await ev('disp(exist("editDistance"))', 'editDistance 已加载', '3');
await ev('disp(editDistance("kitten","sitting"))', '★ Levenshtein("kitten","sitting")=3', '3');
await ev('disp(exist("svmtrain"))', 'svmtrain 已加载', '3');
await ev('disp(exist("svmpredict"))', 'svmpredict 已加载', '3');
await ev('disp(exist("fcnntrain"))', 'fcnntrain 已加载', '3');
// libsvm 最小往返：写标签+特征，训练线性 SVM，再预测
await page.evaluate(() => {
  Module.FS.writeFile('/tmp/lbl.txt', '1\n1\n-1\n-1\n');
  Module.FS.writeFile('/tmp/ftr.txt', '1 1:2 2:2\n2 1:2.1 2:1.9\n3 1:-2 2:-2\n4 1:-2.1 2:-1.9\n');
  Module.eval_string('addpath("/tmp")');
});
await ev('m=svmtrain([1;1;-1;-1],[2 2;2.1 1.9;-2 -2;-2.1 -1.9],"-s 0 -t 0 -q"); disp(numel(m))', 'svmtrain 训练出模型', null);

console.log('--- 其它包编译件 ---');
await ev('disp(exist("polybool_mrf"))', 'geometry: polybool_mrf 已加载', '3');
await ev('disp(exist("cell2cell"))', 'miscellaneous: cell2cell 已加载', '3');
await ev('disp(exist("partint"))', 'miscellaneous: partint 已加载', '3');

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
