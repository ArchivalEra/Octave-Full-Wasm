// 探针：issue #5 修复形状决策（path 顺序 / 句柄语义 / 前位覆盖）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 三个决策实验（决定修复怎么做）：
//   E1 addpath('-begin') 能不能排到 `.` 前面？（`path()` 头部实测）
//   E2 函数句柄是"创建时绑定内容"还是"调用时重读文件"？（决定能否用 boot 快照）
//   E3 plotbridge 置于 path 前部时，`. 里的 stub` 还能不能遮蔽它？矩阵是否全绿？
//
// 用法：sh test/browser/run.sh test/browser/probe-fix-shape.mjs [URL]
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
const sleep = ms => new Promise(r => setTimeout(r, ms));

await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
for (let i = 0; i < 300; i++) {
  const ok = await page.evaluate(() => window.__octaveReady === true).catch(() => false);
  if (ok) break; await sleep(500);
}
await sleep(1500);

async function run (code, timeoutMs = 20000) {
  const s = '__F' + Math.random().toString(36).slice(2) + '__';
  logs.length = 0;
  try {
    await page.evaluate(([x, sn]) => window.Module.eval_string(`${x}; disp('${sn}');`), [code, s]);
  } catch (e) { return { trap: true, out: '', err: String(e).slice(0, 180) }; }
  const t = Date.now();
  while (Date.now() - t < timeoutMs) { if (logs.some(l => l.includes(s))) break; await sleep(80); }
  return { trap: false, out: logs.join(' ').split(s)[0].replace(/\s+/g, ' ').trim() };
}
async function fs (op, args) {
  return page.evaluate(([op, args]) => {
    try {
      if (op === 'write') { window.Module.FS.writeFile(args[0], args[1]); return 'ok'; }
      if (op === 'read') return window.Module.FS.readFile(args[0], { encoding: 'utf8' }).slice(0, 80);
      if (op === 'unlink') { window.Module.FS.unlink(args[0]); return 'ok'; }
    } catch (e) { return 'ERR ' + String(e).slice(0, 100); }
  }, [op, args]);
}
const head = (o, n = 150) => (o || '').slice(0, n);

console.log(`URL=${URL}`);

console.log('\n── E0 现状 ─────────────────────────────');
let r = await run('p=path(); printf("HEAD=[%s]\\n", p(1:min(120,end)))');
console.log('path head:', head(r.out, 200));
r = await run('printf("wf=[%s] wp=[%s]\\n", which("figure"), which("plot"))');
console.log(r.out);

console.log('\n── E1 addpath -begin vs `.` ────────────');
r = await run('try; addpath("/usr/src/octave/m/plotbridge", "-begin"); catch e; printf("ADDPATH-ERR %s\\n", e.message); end; p=path(); printf("HEAD2=[%s]\\n", p(1:min(140,end)))');
console.log('after -begin:', head(r.out, 240));

console.log('\n── E2 句柄语义（创建后覆写文件，句柄读旧还是读新？）──────');
r = await run('try; fh__ = str2func("gca"); printf("handle ok cls=%s\\n", class(fh__)); catch e; printf("MKERR %s\\n", e.message); end');
console.log('mk handle:', head(r.out, 160));
// 覆写 core gca.m（真文件被换掉）
const gcaNew = 'function h = gca ()\n  error ("GCA-NEW-CONTENT");\nendfunction\n';
console.log('overwrite core gca.m:', await fs('write', ['/usr/src/octave/m/plot/util/gca.m', gcaNew]));
r = await run('try; v = fh__(); printf("HANDLE-CALL-OK %g\\n", v); catch e; printf("HANDLE-CALL-ERR: %s\\n", e.message); end');
console.log('handle() after overwrite:', head(r.out, 200));
r = await run('clear -f; try; v = fh__(); printf("AFTER-CLEAR OK %g\\n", v); catch e; printf("AFTER-CLEAR ERR: %s\\n", e.message); end');
console.log('after clear -f:', head(r.out, 200));
r = await run('clear -f; rehash; try; v = fh__(); printf("AFTER-REHASH OK %g\\n", v); catch e; printf("AFTER-REHASH ERR: %s\\n", e.message); end');
console.log('after clear -f; rehash:', head(r.out, 200));
r = await run('try; v = gca(); printf("DIRECT-CALL OK %g\\n", v); catch e; printf("DIRECT-CALL ERR: %s\\n", e.message); end');
console.log('direct gca() (应跑新内容或报错):', head(r.out, 200));
r = await run('which("gca")');
console.log('which(gca):', head(r.out, 120));

console.log('\n── E3 写 /figure.m stub 后（当前路径序）────────');
const figStub = '% Safe Figure Stub\nfunction figure (varargin)\nendfunction\n';
console.log('write /figure.m:', await fs('write', ['/figure.m', figStub]));
r = await run('clear -f; rehash; printf("wf2=[%s]\\n", which("figure"))');
console.log('which(figure) after rehash:', head(r.out, 240));
r = await run('try; title("t"); printf("T1-OK\\n"); catch e; printf("T1-ERR: %s\\n", e.message); end');
console.log('title(未前置 plotbridge):', head(r.out, 200));

console.log('\n── E4 plotbridge -begin + stub 并存 ─────');
r = await run('addpath("/usr/src/octave/m/plotbridge", "-begin"); clear -f; rehash; printf("wf3=[%s] wp3=[%s]\\n", which("figure"), which("plot"))');
console.log('which after -begin+rehash:', head(r.out, 260));
const MATRIX = [
  ['plot(0:1:10)', 'plot'],
  ['title("t")', 'title'],
  ['h = gcf()', 'gcf'],
  ['clf; plot(1:10); xlabel("x")', 'xlabel'],
  ['clf; plot(1:10); grid on', 'grid'],
  ['clf; plot(1:10); legend("a")', 'legend'],
  ['clf; plot(1:10); axis([0 11 0 11])', 'axis'],
  ['clf; plot(1:10); hold on; plot(2:11)', 'hold'],
  ['subplot(2,1,1); plot(1:10)', 'subplot'],
  ['bar([1 2 3])', 'bar'],
];
for (const [code, name] of MATRIX) {
  const rr = await run(`try; ${code}; printf("OK %s\\n", '${name}'); catch e; printf("ERR %s: %s\\n", '${name}', e.message); end`);
  console.log(`  ${name.padEnd(8)} :: ${rr.trap ? '★TRAP' : head(rr.out, 170)}`);
  await run('close all');
}

console.log('\n── E5 镜子（__pb_core__）在 stub 存在时能不能拿到核心实现 ──');
r = await run('__pb_core__("--reset"); try; h = __pb_core__("plot", 1:10); printf("MIRROR-OK %g\\n", h); catch e; printf("MIRROR-ERR: %s\\n", e.message); end');
console.log('mirror plot:', head(r.out, 220));
r = await run('clf; try; plot(1:10); printf("PLOT-OK\\n"); catch e; printf("PLOT-ERR: %s\\n", e.message); end');
console.log('plot via shim:', head(r.out, 220));

console.log('\n=== 探针结束 ===');
await browser.close();
