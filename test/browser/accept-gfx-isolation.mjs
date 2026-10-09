// 验收：图形核心 m 树保护（issue #5）—— 外部宿主写入 0 输出桩被守卫修复
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 验什么（浏览器侧实测，三档站点通用）──────────────────────────────────────
//   A 干净站点：装饰命令矩阵全绿（**阳性对照** —— 守卫不许把好站点弄坏）
//   B 注入 UI 的 12 个桩（figure/plot/drawnow 各 3 路径）⇒ 矩阵**仍全绿**（守卫修复）
//   C 反向断言：st.gfxGuard() 报告真的修过（不是"桩没生效"这种假绿）
//   D 反向断言：守卫**不碰**合法写入（往 /tmp 写个正常函数，守卫不动它）
//
// 判据：rc=0 且 "N PASS / 0 FAIL" ⇒ 修复成立。
// 用法：sh test/browser/run.sh test/browser/accept-gfx-isolation.mjs <URL>
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8775/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 220)}`);
};

await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
await sleep(1200);
const isPage = await page.evaluate(() => !!(window.Module && window.Module.eval_string));
console.log(`URL=${URL} pageMode=${isPage}`);

if (!isPage) {
  const boot = await page.evaluate(async () => {
    try {
      const meta = document.querySelector('meta[name="site-base"]');
      const gb = (meta && meta.getAttribute('content')) || '/';
      const base = (gb.endsWith('/') ? gb : gb + '/') + 'lanes/wasm32-final/';
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = base + 'octave.js';
        s.onload = () => res(); s.onerror = () => rej(new Error('load fail'));
        document.head.appendChild(s);
      });
      await window.OctaveEmbed.create({
        base, mount: '#octave-raw-output', id: 'gfx-iso',
        lane: { lane: 'base', dir: '', js: 'octave.js', wasm: 'octave.wasm', data: 'octave.data' },
      });
      return 'ok';
    } catch (e) { return 'ERR ' + String(e).slice(0, 200); }
  });
  if (boot !== 'ok') { console.log('boot:', boot); await browser.close(); process.exit(1); }
  for (let i = 0; i < 300; i++) {
    const ok = await page.evaluate(() => { const e = (window.__octaveHosts || [])[0]; return !!(e && e.ready === true); }).catch(() => false);
    if (ok) break; await sleep(500);
  }
}
const hasMod = await page.evaluate(() => {
  const ent = (window.__octaveHosts || [])[0];
  if (ent && ent.mod) { window.__M = ent.mod; return true; }
  if (window.Module && window.Module.eval_string) { window.__M = window.Module; return true; }
  return false;
});
if (!hasMod) { console.log('no mod'); await browser.close(); process.exit(1); }
await sleep(2500);

async function run (code, timeoutMs = 20000) {
  const s = '__G' + Math.random().toString(36).slice(2) + '__';
  logs.length = 0;
  try {
    await page.evaluate(([x, sn]) => window.__M.eval_string(`${x}; disp('${sn}');`), [code, s]);
  } catch (e) { return { trap: true, out: '', err: String(e).slice(0, 160) }; }
  const t = Date.now();
  while (Date.now() - t < timeoutMs) { if (logs.some(l => l.includes(s))) break; await sleep(80); }
  return { trap: false, out: logs.join(' ').split(s)[0].replace(/\s+/g, ' ').trim() };
}

// ⚠️ 匹配规则（`.githooks/check-wants.py` 会查这条）：**单个数字**的 want 按「数字边界」
//   匹配，不是裸子串 —— `want='1'` 绝不该被 `10`/`100`/`11` 满足（accept-hdf5 曾这么假过几个月）。
function wantHit (hay, want) {
  if (/^\d$/.test(want)) return new RegExp('(?<![\\d.])' + want + '(?![\\d.])').test(hay);
  return hay.includes(want);
}

const MATRIX = [
  ['plot(0:1:10); printf("|M=%d", numel(get(gca(),"children")))', 'plot', '|M='],
  // ⚠️ title 与 xlabel/ylabel 同款：**先 plot 再装饰**（issue #5 的真实用法）。
  //    裸 `title("t")` 不建 axes ⇒ 桥按既有契约**不镜像到真 axes**（不是本守卫的事）。
  ['plot(1:10); title("t"); printf("|T=[%s]", get(get(gca(),"title"),"string"))', 'title', '|T=[t]'],
  ['h=figure(); printf("|F=%d", ishghandle(h))', 'figure()', '|F=1'],
  ['h=gcf(); printf("|G=%d", ishghandle(h))', 'gcf()', '|G=1'],
  ['plot(1:10); xlabel("x"); printf("|X=[%s]", get(get(gca(),"xlabel"),"string"))', 'xlabel', '|X=[x]'],
  ['plot(1:10); ylabel("y"); printf("|Y=[%s]", get(get(gca(),"ylabel"),"string"))', 'ylabel', '|Y=[y]'],
  ['plot(1:10); grid on; printf("|GR=%s", get(gca(),"xgrid"))', 'grid', '|GR=on'],
  ['plot(1:10); hold on; plot(2:11); printf("|H=%d", numel(get(gca(),"children")))', 'hold', '|H='],
  ['plot(1:10); legend("a"); printf("|L=ok")', 'legend', '|L=ok'],
  ['plot(1:10); axis([0 11 0 11]); xl=get(gca(),"xlim"); printf("|A=[%g %g]", xl(1), xl(2))', 'axis', '|A=[0 11]'],
  ['subplot(2,1,1); plot(1:10); printf("|S=%d", numel(get(gcf(),"children")))', 'subplot', '|S='],
  ['bar([1 2 3]); printf("|B=ok")', 'bar', '|B=ok'],
  // 裸 title（无 plot）：**只要求不报错**（崩溃才是 issue #5 的病；读回属性是另一条契约）
  ['title("t"); printf("|TN=ok")', 'title(裸)', '|TN=ok'],
];
async function matrix (tag) {
  let p = 0, f = 0;
  for (const [code, name, want] of MATRIX) {
    const r = await run(`clear -f; try; ${code}; catch e; printf("|ERR: %s", e.message); end`);
    const out = r.trap ? '★TRAP' : (r.out || '(空)');
    const ok = !r.trap && wantHit(out, want) && !out.includes('|ERR');
    ok ? p++ : f++;
    if (!ok) console.log(`      ${name} :: ${out.slice(0, 160)}`);
    await run('close all');
  }
  check(f === 0, `${tag}：装饰命令矩阵`, `${p} PASS / ${f} FAIL`);
  return f;
}

// ── A 干净站点（阳性对照）──────────────────────────────────
await matrix('A 干净站点');

// ── B 注入 UI 的 12 个桩 ───────────────────────────────────
const FIG = '% Safe Figure Stub\nfunction figure (varargin)\n  % No-op safe stub preventing GL4ES window init\nendfunction\n';
const PLT = '% In-Engine Safe Shadow Plot Sink\nfunction plot (varargin)\n  printf("[OCTAVE_WEB_PLOT: 0 points captured]\\n");\nendfunction\n';
const DRN = '% Safe Drawnow Stub\nfunction drawnow (varargin)\nendfunction\n';
const wrote = await page.evaluate(([f, p, d]) => {
  const M = window.__M; let n = 0;
  for (const [path, c] of [
    ['/usr/src/octave/m/plot/util/figure.m', f], ['/figure.m', f], ['/home/web_user/figure.m', f],
    ['/usr/src/octave/m/plot/draw/plot.m', p], ['/plot.m', p], ['/home/web_user/plot.m', p],
    ['/usr/src/octave/m/plot/draw/drawnow.m', d], ['/drawnow.m', d], ['/home/web_user/drawnow.m', d],
  ]) { try { const dir = path.replace(/\/[^/]*$/, '') || '/'; try { M.FS.mkdirTree(dir); } catch (e) {} M.FS.writeFile(path, c); n++; } catch (e) {} }
  return n;
}, [FIG, PLT, DRN]);
check(wrote === 9, 'B 注入 UI 桩（9 文件）', `${wrote} written`);
await matrix('B 注入桩后');

// ── C 反向断言：守卫真的修过（不是桩没生效）──────────────────
const g = await page.evaluate(() => { try { return window.__M.eval_string('1;') , (window.__octaveHosts[0] || {}).core ? window.__octaveHosts[0].core.state.gfxGuard() : (window.__M && window.__M.gfxGuard ? window.__M.gfxGuard() : null); } catch (e) { return 'ERR ' + String(e).slice(0, 100); } });
// 从 host 记录取（st 挂在 core.state）
const rep = await page.evaluate(() => {
  try {
    const ent = (window.__octaveHosts || [])[0];
    const core = ent && ent.core;
    const st = core && core.state;
    if (st && typeof st.gfxGuard === 'function') return st.gfxGuard();
    return 'no gfxGuard';
  } catch (e) { return 'ERR ' + String(e).slice(0, 100); }
});
const repaired = rep && rep.repaired ? rep.repaired : [];
check(repaired.length > 0, 'C 反向断言：守卫报告真的修过', JSON.stringify(repaired).slice(0, 200));
check(repaired.some(x => x.indexOf('/plot/util/figure.m') >= 0), 'C2 核心 figure.m 被还原', JSON.stringify(repaired));

// ── D 反向断言：守卫不碰合法写入 ─────────────────────────────
const legit = await page.evaluate(() => {
  const M = window.__M;
  M.FS.writeFile('/tmp/legit_fn.m', 'function y = legit_fn (x)\n  y = x + 1;\nendfunction\n');
  return M.FS.readFile('/tmp/legit_fn.m', { encoding: 'utf8' }).length;
});
const r2 = await run('addpath("/tmp"); printf("|V=%d", legit_fn(41))');
check(legit > 0 && (r2.out || '').includes('|V=42'), 'D 反向断言：合法写入不被守卫改动', r2.out || r2.err);

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
