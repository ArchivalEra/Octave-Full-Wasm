// 探针：**内部属性表**——我们的 wasm 与宿主真 Octave 的差分（2026-09-24）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 为什么有它：工作令 §3.1 曾把「`isprop (gca,'__legend_handle__')` == 0」判成
// **我们的 toolkit 缺属性**，并据此要"补齐 22 个"。实测翻了案（见 fixtures 里那份
// 共用脚本的头部注释）：那是**核心自己的惰性 `addproperty` + try/catch 读法**，
// 宿主真 Octave 11.3.0（qt/fltk/gnuplot）与我们的 wasm **逐格相同**。
//
// ★ 这条探针的价值在"**两个方向都亮**"：
//   · 将来谁动 toolkit / reconfigure 把某个属性弄丢 → 这里当场红（差分看得见）；
//   · 谁再把这类 `isprop == 0` 误判成缺口 → 文件头就是那次翻案的证据。
//
// 做法：**宿主与浏览器跑同一份 `.m`**（fixtures/internal-props-probe.m），
// 再逐格差分。参考表**不落盘**——每次现从宿主的真 Octave 现算，所以它随宿主版本自更新
// （前提：宿主 Octave 与构建同为 11.3.0；脚本会核对 `version()`，不一致直接红）。
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/probe-internal-props.mjs [URL]
// 退出码：0 = 与宿主逐格一致且下列契约都成立；1 = 有差异（打印前 15 处）
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = '/mnt/hdd/zcode-projects/Octave-Full-Wasm';
// run.sh 会把本脚本拷到 harness 再跑 ⇒ 先看同级，再回落到仓库绝对路径
const SCRIPT_PATH = [join(HERE, 'fixtures', 'internal-props-probe.m'),
                     join(REPO, 'test/browser/fixtures', 'internal-props-probe.m')]
  .find(p => existsSync(p));
if (!SCRIPT_PATH) { console.error('找不到 fixtures/internal-props-probe.m'); process.exit(1); }
const SCRIPT = readFileSync(SCRIPT_PATH, 'utf8');

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const CELL = /^(P\d\w+) (\S+) fig=(\d) ax=(\d) line=(\d) root=(\d)$/;

function parse (text) {
  const t = new Map(); let ver = null;
  for (const line of String(text).split('\n')) {
    const v = line.match(/^OCTVER (\S+)$/);
    if (v) { ver = v[1]; continue; }
    const m = line.match(CELL);
    if (m) t.set(`${m[1]} ${m[2]}`, `${m[3]}${m[4]}${m[5]}${m[6]}`);
  }
  return { t, ver };
}

// ── 参考：宿主的真 Octave。qt 是上游推荐的口径，gnuplot 是"最不一样"的那个 ──
function hostTable (toolkit) {
  const out = execFileSync('octave',
    ['--no-gui', '--quiet', '--eval', `graphics_toolkit('${toolkit}'); run('${SCRIPT_PATH}')`],
    { encoding: 'utf8', timeout: 300000, maxBuffer: 8 * 1024 * 1024 });
  return parse(out);
}

let pass = 0, fail = 0;
const check = (ok, label, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 180)}`); };

console.log(`fixture=${SCRIPT_PATH}`);
const refQt = hostTable('qt');
console.log(`host(qt)      version=${refQt.ver} cells=${refQt.t.size}`);
const refGp = hostTable('gnuplot');
console.log(`host(gnuplot) version=${refGp.ver} cells=${refGp.t.size}`);
check(refQt.t.size > 100 && refGp.t.size === refQt.t.size,
  '参照表可用（两个 toolkit 的格子数一致）', `qt=${refQt.t.size} gnuplot=${refGp.t.size}`);
check(refQt.t.size === refGp.t.size &&
      [...refQt.t].every(([k, v]) => refGp.t.get(k) === v),
  '前提：宿主上属性表**与 toolkit 无关**（qt == gnuplot）',
  `qt=${refQt.t.size} gnuplot=${refGp.t.size}`);

// ── 被测：浏览器里的 wasm ──────────────────────────────────────────────
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text().slice(0, 400)));
page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 200)));
await page.goto(URL, { waitUntil: 'load', timeout: 240000 });
const t0 = Date.now();
while (Date.now() - t0 < 300000) {
  if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) break;
  await new Promise(r => setTimeout(r, 300));
}
console.log(`URL=${URL} ready=${((Date.now() - t0) / 1000).toFixed(1)}s`);

async function run (code, ms = 900) {
  logs.length = 0;
  const r = await page.evaluate(x => {
    const rc = window.Module.eval_string(x);
    return { rc, err: window.Module.last_error_message() };
  }, code);
  await new Promise(rr => setTimeout(rr, ms));
  // gl4es 开场 banner 与 GPU stall 提示是噪音
  const out = logs.join(' ').replace(/LIBGL:[^|]*?(?=[A-Z]|$)/g, '').replace(/\s+/g, ' ').trim();
  return { rc: r.rc, err: r.err || '', out };
}

logs.length = 0;
const sentinel = '__INTPROPS' + Math.random().toString(36).slice(2) + '__';
let trap = null;
await page.evaluate(c => { window.Module.FS.writeFile('/tmp/intprops.m', c); }, SCRIPT);
try {
  await page.evaluate(sn => window.Module.eval_string(`run('/tmp/intprops.m'); printf('${sn}\\n');`), sentinel);
} catch (e) { trap = String(e); }
await new Promise(r => setTimeout(r, 1200));
const wasm = parse(logs.join('\n'));
if (trap) console.log('★TRAP: ' + trap.slice(0, 200));
console.log(`wasm          version=${wasm.ver} cells=${wasm.t.size}`);

check(wasm.t.size > 100, 'wasm 侧探针跑完（格子数 > 100）', `cells=${wasm.t.size}`);
check(!!wasm.ver && wasm.ver === refQt.ver,
  '前提：wasm 与宿主的 Octave 版本相同（差分才有意义）', `wasm=${wasm.ver} host=${refQt.ver}`);

// ── 逐格差分 ─────────────────────────────────────────────────────────
const keys = [...new Set([...refQt.t.keys(), ...wasm.t.keys()])].sort();
const diffs = keys.filter(k => refQt.t.get(k) !== wasm.t.get(k));
for (const k of diffs.slice(0, 15)) {
  console.log(`  DIFF ${k}: host(qt)=${refQt.t.get(k) ?? '<缺>'} wasm=${wasm.t.get(k) ?? '<缺>'}`);
}
check(diffs.length === 0,
  '★ 内部属性表与宿主真 Octave 逐格一致（67 名字 × 2 阶段）', `diffs=${diffs.length}`);

// ── 契约①：惰性 addproperty 的生命周期（这就是上游语义本身）──────────────
const life = [
  // legend 得有东西可标（空 axes 上 legend('a') 报 "no valid object to label" —— 宿主同）
  ['__legend_handle__', "clf; disp(['fresh=' num2str(isprop(gca,'__legend_handle__'))]); plot(1:3); legend('a'); disp(['after=' num2str(isprop(gca,'__legend_handle__'))])", /fresh=0/, /after=1/],
  ['__plotyy_axes__', "clf; disp(['fresh=' num2str(isprop(gca,'__plotyy_axes__'))]); plotyy(1:3,1:3,1:3,2*(1:3)); disp(['after=' num2str(isprop(gca,'__plotyy_axes__'))])", /fresh=0/, /after=1/],
  ['__colorbar_handle__', "clf; disp(['fresh=' num2str(isprop(gca,'__colorbar_handle__'))]); colorbar(); disp(['after=' num2str(isprop(gca,'__colorbar_handle__'))])", /fresh=0/, /after=1/],
];
for (const [name, code, before, after] of life) {
  const r = await run(code, 1100);
  check(r.rc === 0 && before.test(r.out) && after.test(r.out),
    `契约① 惰性 addproperty：${name} 建对象前=0 / 建后=1（上游语义）`, r.out);
}

// ── 契约②：核心"读不到"是预期路径 —— 读失败之后图仍要画得出来 ────────────
let r = await run("clf; try; get(gca,'__legend_handle__'); catch, end_try_catch; plot(1:3); drawnow; disp(sprintf('kids=%d',numel(get(gca,'children'))))", 1600);
check(r.rc === 0 && /kids=[1-9]\d*/.test(r.out),
  '契约② 无 legend 时读它报错、但被 try/catch 吞掉后 plot 照常（真渲染器下 children >= 1）', r.out);
r = await run("clf; plot(1:5); s = hdl2struct(gcf); disp(sprintf('type=%s', s.type))", 1200);
check(r.rc === 0 && /type=figure/.test(r.out), '契约② hdl2struct 走通（内部就是带 try/catch 读这些属性）', r.out);

// ── 契约③：`Module.last_error_message()` 会**粘连**（被 catch 的错误也留下）────
// 这不是缺陷（上游 `error_system::last_error_message()` 就是"最后一次错误"），
// 但**不许**拿它当"这次调用成功了没"的判据 —— 本会话被它骗过数次。
r = await run("try, error('lemsentinel'); catch, end_try_catch; z = 1+1;", 700);
check(r.rc === 0 && /lemsentinel/.test(r.err),
  '契约③ 被 try/catch 吞掉的错误仍留在 last_error_message()（粘连 ⇒ 判定别用它）', `LEM=[${r.err}]`);

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
console.log('（差分那一条若变红：先看是宿主换了版本，还是我们的 toolkit/reconfigure 真丢了属性）');
await browser.close();
process.exit(fail ? 1 : 0);
