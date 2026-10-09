// 探针：**UI 侧 SafePlotSinkPolyfill 共存性**（issue #5 复现 + 修法候选验证）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 复现对象（issue #5 的报错链）──────────────────────────────────────────────
//   title/xlabel/grid/legend/axis/hold/subplot/bar → 「figure: function called with
//   too many outputs」，而裸 plot 可用。
//
// 假设（本探针验）：UI 仓库 `SafePlotSinkPolyfill.install()` 在每次运行前向 MEMFS 写
//   4 个 m 文件（plot/figure/drawnow/__get_plot_data__），其中 **figure stub 声明 0 个
//   输出**；核心 gcf.m:57 `h = figure ()` 要 1 个输出 ⇒ 输出个数检查在函数体前抛错。
//
// 步骤：
//   ① 记录干净站点的 path() 与 which(…)（解析顺序是本探针的核心数据）；
//   ② 按 UI 源码逐字写入 4 个 stub（模拟 polyfill.install）；
//   ③ 重跑装饰命令矩阵，抓崩溃；
//   ④ 打印 which() 变化 —— 证明哪个 figure 在生效。
//
// 用法：sh test/browser/run.sh test/browser/probe-gfx-ui-compat.mjs [URL]
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run (code, timeoutMs = 25000) {
  const s = '__G' + Math.random().toString(36).slice(2) + '__';
  logs.length = 0;
  let rc;
  try {
    rc = await page.evaluate(([x, sn]) => window.Module.eval_string(`${x}; disp('${sn}');`), [code, s]);
  } catch (e) { return { rc: 'TRAP', out: '', err: String(e).slice(0, 200), trap: true }; }
  const t = Date.now();
  while (Date.now() - t < timeoutMs) { if (logs.some(l => l.includes(s))) break; await sleep(80); }
  const out = logs.join(' ').split(s)[0].replace(/\s+/g, ' ').trim();
  return { rc, out, err: await page.evaluate(() => window.Module.last_error_message()).catch(() => '') };
}

// ── UI 仓库 SafePlotSinkPolyfill.ts 的逐字内容（副本；改了 UI 那份这里也要动）──
const FILE_FIGURE = `/usr/src/octave/m/plot/util/figure.m`;
const FILE_PLOT   = `/usr/src/octave/m/plot/draw/plot.m`;
const FILE_DRAWNOW= `/usr/src/octave/m/plot/draw/drawnow.m`;
const FILE_HELPER = `/usr/src/octave/m/plot/draw/__get_plot_data__.m`;

const FIGURE_SCRIPT = `% Safe Figure Stub
function figure (varargin)
  % No-op safe stub preventing GL4ES window init
endfunction
`;
const PLOT_SCRIPT = `% In-Engine Safe Shadow Plot Sink
function plot (varargin)
  x = [];
  y = [];
  if nargin == 1
    val = varargin{1};
    if isnumeric(val)
      y = double(val(:)');
      x = 1:length(y);
    endif
  elseif nargin >= 2
    v1 = varargin{1};
    v2 = varargin{2};
    if isnumeric(v1) && isnumeric(v2)
      x = double(v1(:)');
      y = double(v2(:)');
    endif
  endif
  s = struct('x', x, 'y', y, 'count', length(x));
  assignin('base', '__octave_web_plot__', s);
  printf("[OCTAVE_WEB_PLOT: %d points captured]\\n", length(x));
endfunction
`;

await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
for (let i = 0; i < 300; i++) {
  const ok = await page.evaluate(() => window.__octaveReady === true).catch(() => false);
  if (ok) break; await sleep(500);
}
await sleep(600);
console.log(`URL=${URL}`);

console.log('\n── ① 干净站点：解析顺序 ────────────────────────────────────────────');
let r = await run(`disp(path())`);
console.log('path():', (r.out || '').slice(0, 700));
for (const n of ['figure', 'plot', 'title', 'gcf', 'gca', 'drawnow', 'axes', 'hold', 'subplot', 'bar']) {
  r = await run(`printf("%s -> %s\\n", '${n}', which('${n}'))`);
  console.log(`which(${n}):`, (r.out || r.err || '').slice(0, 200));
}

console.log('\n── ② 干净站点：装饰命令矩阵（基线）────────────────────────────────');
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
  console.log(`  ${name.padEnd(8)} :: ${rr.trap ? '★TRAP 整页崩' : (rr.out || rr.err || '(空)').slice(0, 160)}`);
  await run('close all; clear -f');   // 每条独立
}

console.log('\n── ③ 装 UI polyfill（4 个 stub 写入 MEMFS）────────────────────────');
r = await run(`try;
  d="/usr/src/octave/m/plot/util"; f=fopen(fullfile(d,"figure.m"),"w"); fputs(f, ${JSON.stringify(FIGURE_SCRIPT)}); fclose(f);
  d2="/usr/src/octave/m/plot/draw"; f=fopen(fullfile(d2,"plot.m"),"w"); fputs(f, ${JSON.stringify(PLOT_SCRIPT)}); fclose(f);
  f=fopen(fullfile(d2,"drawnow.m"),"w"); fputs(f, "function drawnow (varargin)\nendfunction\n"); fclose(f);
  printf("stubs written\\n");
catch e; printf("STUB-WRITE ERR: %s\\n", e.message); end`);
console.log('写入结果:', r.trap ? '★TRAP' : (r.out || r.err || '(空)').slice(0, 220));

// 读回确认真的写进去了 + Octave 看到的文件尺寸
for (const f of [FILE_FIGURE, FILE_PLOT, FILE_DRAWNOW]) {
  const rr = await run(`st=stat('${f}'); printf("size=%d\\n", st.size)`);
  console.log(`  stat ${f} ::`, (rr.out || rr.err || '').slice(0, 120));
}

console.log('\n── ④ polyfill 生效后重跑矩阵（预期：复现 issue #5）────────────────');
for (const [code, name] of MATRIX) {
  const rr = await run(`try; ${code}; printf("OK %s\\n", '${name}'); catch e; printf("ERR %s: %s\\n", '${name}', e.message); end`);
  console.log(`  ${name.padEnd(8)} :: ${rr.trap ? '★TRAP 整页崩' : (rr.out || rr.err || '(空)').slice(0, 200)}`);
  await run('close all; clear -f; rehash');
}

console.log('\n── ⑤ polyfill 生效后 which() 变化 ────────────────────────────────');
for (const n of ['figure', 'plot', 'title', 'gcf', 'gca']) {
  r = await run(`printf("%s -> %s\\n", '${n}', which('${n}'))`);
  console.log(`which(${n}):`, (r.out || r.err || '').slice(0, 200));
}

console.log('\n=== 探针结束 ===');
await browser.close();
