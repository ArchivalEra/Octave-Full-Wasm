// 探针：FreeType 文字渲染到底"出来了没有"（批次 D，HANDOFF §5.26）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 为什么要这条：`--without-freetype` 时的现象是**文字整块空白但不崩** ——
// 光看"不报错"是分不清"没编 FreeType""没预载字体""字体路径不对"三件事的。
// 所以这里钉两条**可证伪**的证据：
//   ① 控制台里**不再**出现那条 `opengl_renderer::render_text: support for rendering
//      text (FreeType) was unavailable or disabled`（构建期开关的证据）；
//   ② **文字真的落了像素**：同样一条 `plot(1:10)`，加了 `title/xlabel/ylabel` 的那张，
//      `getframe` 的非白像素要显著多于没加的。这条是**判别性**的 —— 没有 FreeType 时
//      标题一个字都不画，两张图的墨水**一样多**；顺带排掉"字体没预载"（同样一个字不画）。
//   统计一律**在 Octave 里做**（`nnz(c<200)` 逐通道相加），不走 PNG 解码那套。
//   ⚠️ eval_string 进来的代码**不能带函数定义**（Octave 的脚本里定义函数会出问题），
//      所以下面全是一行行直算。
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/probe-text-render.mjs [URL]
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8768/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text().slice(0, 300)));
page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 300)));
await page.goto(URL, { waitUntil: 'load', timeout: 240000 });
const t0 = Date.now();
while (Date.now() - t0 < 300000) {
  if (await page.evaluate(() => window.__octaveReady === true).catch(() => false)) break;
  await new Promise(r => setTimeout(r, 300));
}
console.log(`URL=${URL} ready=${((Date.now() - t0) / 1000).toFixed(1)}s`);

let pass = 0, fail = 0;
function check (ok, label, detail) {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${String(detail).slice(0, 220)}`);
}
async function ev (code, ms = 1200) {
  logs.length = 0;
  const r = await page.evaluate(x => {
    const rc = window.Module.eval_string(x);
    return { rc, err: window.Module.last_error_message() };
  }, code);
  await new Promise(rr => setTimeout(rr, ms));
  return { rc: r.rc, err: r.err, out: [...logs].join(' ').replace(/\s+/g, ' ').trim() };
}

// 0) 渲染器得在线（不然本探针没有意义；无 GL 时明确跳过而不是假装通过）
const tk = await ev('disp(graphics_toolkit())');
if (!/\bwebgl\b/.test(tk.out)) {
  console.log('SKIP: 本站点的默认 toolkit 不是 webgl（' + tk.out + '）—— 本探针只对真渲染器有意义');
  await browser.close();
  process.exit(0);
}

// ① 那条 FreeType warning：本次会话（含"第一次建 axes"那次）都不该出现
const first = await ev('clf; plot(1:3); drawnow; disp("axes_ok")', 1500);
check(first.rc === 0 && first.out.includes('axes_ok'), '首次建 axes + drawnow 正常', first.out);
check(!/rendering text \(FreeType\)/.test(first.out),
  '★ 不再出现 "support for rendering text (FreeType) was unavailable or disabled"',
  first.out.includes('FreeType') ? first.out : '（无该警告）');

// ② 像素证据：文字有没有落墨
const INK = 'clf; plot(1:10); drawnow; c = getframe(gcf).cdata; ' +
  'a = nnz(c(:,:,1) < 200) + nnz(c(:,:,2) < 200) + nnz(c(:,:,3) < 200); ' +
  'clf; plot(1:10); title("TITLE TEXT"); xlabel("X AXIS THIS IS LONG"); ylabel("Y AXIS"); drawnow; ' +
  'c = getframe(gcf).cdata; ' +
  'b = nnz(c(:,:,1) < 200) + nnz(c(:,:,2) < 200) + nnz(c(:,:,3) < 200); ' +
  'disp(sprintf("ink=%d/%d", a, b))';
const ink = await ev(INK, 2500);
const m = ink.out.match(/ink=(\d+)\/(\d+)/);
check(!!m, '两张图都取到了像素统计（getframe + nnz）', ink.out);
if (m) {
  const a = Number(m[1]), b = Number(m[2]);
  check(a > 100, '基线图（无文字）确实画了东西（非白计数 > 100）', `a=${a}`);
  check(b - a > 50,
    '★ 加 title/xlabel/ylabel 后非白像素显著增加 ⇒ 文字真落了像素（无 FreeType 时两张一样多）',
    `a=${a} b=${b} 差=${b - a}`);
}

// ③ 刻度也有文字：把 x 轴刻度换成很长的数字（`set(gca,"xticklabel",…)`），墨水应再涨
const TICK = 'clf; plot(1:10); drawnow; c = getframe(gcf).cdata; ' +
  'a = nnz(c(:,:,1) < 200) + nnz(c(:,:,2) < 200) + nnz(c(:,:,3) < 200); ' +
  'set(gca, "xticklabel", {"AAAABBBB", "CCCCDDDD", "EEEEFFFF"}); drawnow; ' +
  'c = getframe(gcf).cdata; ' +
  'b = nnz(c(:,:,1) < 200) + nnz(c(:,:,2) < 200) + nnz(c(:,:,3) < 200); ' +
  'disp(sprintf("tick=%d/%d", a, b))';
const tick = await ev(TICK, 2500);
const m3 = tick.out.match(/tick=(\d+)\/(\d+)/);
if (m3) {
  const a = Number(m3[1]), b = Number(m3[2]);
  check(b > a + 50, '★ 刻度标签换成更长的文字后墨水增加 ⇒ 刻度文字也在渲染',
    `a=${a} b=${b} 差=${b - a}`);
} else {
  check(false, '刻度标签用例取到了统计', tick.out);
}

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
