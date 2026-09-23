// 胶水层审计候选 1：**没有 WebGL2 的设备上，图必须还能看见**（SVG 显示回落）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：harness/run.sh test/browser/accept-p5-fallback.mjs [URL]
//
// ── 为什么有这一套 ──────────────────────────────────────────────────────────
// 实测（2026-09-23）：在 `--disable-webgl` 的 Chromium 里 —— 也就是**旧浏览器、GPU 被
// blocklist、或关掉了 3D 的设备**那种情形 —— `plot(...); drawnow` **不报错、MEMFS 里也
// 没有 PNG、页面一片空白**。用户看到的是"命令成功、什么也没发生"。
//
// 修法不是"让 toolkit 硬撑"（建不出上下文就是建不出），而是承认它出不了像素：
//   ① toolkit 落一个信号文件 `/tmp/p5_nogl.txt`（`build/113/webgl_toolkit.cc`）；
//   ② 桥据此判定"没有真渲染器"（`__pb_real_renderer__`）；
//   ③ 于是桥把当前图渲成 **SVG**（`__pb_publish__` → `__svg_render__`，就是 `print -dsvg`
//      那个渲染器）落进 MEMFS，页面（`bridge/p5canvas.js`）发现后贴成 `<img>`。
//
// 这一套就是"③ 真的发生了"的硬断言，而**触发方式是可复现的浏览器旗标**（不用改代码）。
//
// ── 与 accept-p5-graphics 的关系 ────────────────────────────────────────────
// 那套验"有 GL 时真渲出像素"（默认浏览器）；这套验"没有 GL 时也不能是空白"。
// 两者一起才说明"换任何设备都能看见图"。
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8768/';
// 关掉 WebGL：`--disable-webgl` 实测能让 webgl2/webgl 都拿不到上下文
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage', '--disable-webgl'],
});
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(ok, label, detail) {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label.padEnd(50)} :: ${detail ?? ''}`);
}
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

async function ev(code, wait = 400) {
  logs.length = 0;
  let rc = 'TRAP';
  try { rc = await page.evaluate(x => window.Module.eval_string(x), code); } catch (e) { rc = 'TRAP ' + String(e).slice(0, 80); }
  await sleep(wait);
  return { rc, out: logs.join(' ').replace(/\s+/g, ' ').trim() };
}
async function fsRead(path) {
  return await page.evaluate((p) => {
    try { return new TextDecoder().decode(window.Module.FS.readFile(p)); } catch (e) { return null; }
  }, path);
}
async function fsSize(path) {
  return await page.evaluate((p) => {
    try { return window.Module.FS.readFile(p).length; } catch (e) { return -1; }
  }, path);
}

console.log(`URL=${URL}（Chromium 带 --disable-webgl）`);
await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
for (let i = 0; i < 300; i++) {
  const ok = await page.evaluate(() => window.__octaveReady === true).catch(() => false);
  if (ok) break; await sleep(500);
}
await sleep(500);

// ── 前提：这台浏览器真的没有 WebGL2（否则这套毫无意义）────────────────────────
const caps = await page.evaluate(() => {
  const c = document.createElement('canvas');
  return { webgl2: !!c.getContext('webgl2'), webgl1: !!c.getContext('webgl') };
});
check(caps.webgl2 === false && caps.webgl1 === false, '★ 前提：本机拿不到 WebGL 上下文',
  `webgl2=${caps.webgl2} webgl1=${caps.webgl1}`);

// ── 画一张图：以前这里"成功但什么都不显示" ────────────────────────────────────
const r1 = await ev('figure(1); clf; plot(1:10, (1:10).^2); title("回落测试"); drawnow; disp("drawn")', 1200);
check(r1.rc === 0 && r1.out.includes('drawn'), '★ plot+drawnow 不报错（与以前一致）', `rc=${r1.rc}`);
check(/no-context|WebGL2 context/i.test(r1.out), '★ toolkit 明确报了"建不出上下文"',
  r1.out.replace(/\s+/g, ' ').slice(0, 90) || '(静默)');

// ── ①②：信号文件 + 桥的判定 ──────────────────────────────────────────────────
const nogl = await fsRead('/tmp/p5_nogl.txt');
check(!!nogl && nogl.length > 0, '★ toolkit 落了 /tmp/p5_nogl.txt 信号', nogl ? nogl.trim().slice(0, 60) : '(没有)');
check(wantHit((await ev('disp(__pb_real_renderer__())')).out, '0'),
  '★ 桥判定"没有真渲染器"（__pb_real_renderer__ 为假）', '0');

// ── ③：桥出了 SVG，页面贴上去了 ──────────────────────────────────────────────
const svgSize = await fsSize('/tmp/p5_fallback.svg');
const svg = await fsRead('/tmp/p5_fallback.svg');
// 注意：合法的 SVG 常以 `<?xml …?>` 开头（本渲染器就是），所以断言"含 <svg"而不是"以 <svg 开头"
check(svgSize > 500 && svg && /<svg[\s>]/.test(svg), '★ 回落 SVG 已生成',
  `${svgSize} 字节，开头 ${(svg || '').slice(0, 24)}`);
check(/<polyline|<polygon|<line/.test(svg || ''), '★ SVG 里真有图元（不是空壳）',
  `polyline=${(svg || '').split('<polyline').length - 1} polygon=${(svg || '').split('<polygon').length - 1}`);
check(/<text/.test(svg || ''), '★ SVG 里有文字（GL 那条无 FreeType，回落反而更全）',
  `text=${(svg || '').split('<text').length - 1}`);
check(/回落测试/.test(svg || ''), '★ 标题文字进了 SVG（刻度/title 不丢）', 'ok');

const shown = await page.evaluate(() => {
  const i = document.querySelector('#p5figure img');
  return { has: !!i, src: i ? (i.src || '').slice(0, 5) : '', last: window.__p5_last || null };
});
check(shown.has && shown.src === 'blob:', '★ 页面贴上了 <img>（blob: URL）', JSON.stringify(shown).slice(0, 90));
check(shown.last && shown.last.type === 'image/svg+xml',
  '★ MIME 是 image/svg+xml（show() 按扩展名定，不再写死 png）', shown.last ? shown.last.type : '(无)');

// ── 对照：GL 确实没工作（没有 PNG），所以 SVG 是唯一的显示路径 ─────────────────
check((await fsSize('/tmp/p5_fig.png')) < 0, '★ 确实没有 PNG（GL 没工作，回落是唯一路径）', 'ok');

// ── 稳态：第二条命令画的图也要更新（由 __pstate__ 自动渲，不只靠页面那一下）────
const before = svgSize;
await ev('clf; bar([3 1 4 1 5]); drawnow; disp("bar")', 1200);
const svg2 = await fsRead('/tmp/p5_fallback.svg');
check(!!svg2 && svg2.length !== before && /<rect/.test(svg2),
  '★ 第二次绘图后 SVG 跟着更新（bar → rect）',
  `${before} → ${svg2 ? svg2.length : -1} 字节，rect=${svg2 ? svg2.split('<rect').length - 1 : 0}`);

// ── 矢量导出这条路不受影响 ───────────────────────────────────────────────────
const rp = await ev('print("/tmp/fb.svg","-dsvg"); d=dir("/tmp/fb.svg"); disp(d.bytes>500)', 600);
check(rp.rc === 0 && wantHit(rp.out, '1'), '★ print -dsvg 仍可用（导出路径没被牵连）', rp.out.slice(-40));

check(!/RuntimeError: unreachable|\[pageerror\]/.test(logs.join(' ') + r1.out), '无整页 trap', 'ok');

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
