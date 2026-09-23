// P5 验收：OSMesa 图形 toolkit（真渲染）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/accept-p5-osmesa.mjs [URL]
//
// ── 这一套在验什么 ──────────────────────────────────────────────────────────
// P5 步骤②③：让 Octave **自己的 `opengl_renderer`**（一字不改）跑在 **OSMesa**
// （Mesa 软件光栅化，渲进内存缓冲）上。做法与取舍见 `build/113/osmesa_toolkit.cc`
// 与 `build/113/NOTES-p5-osmesa.md`；外部团队在同一条路上的结论见
// `build/113/vendor-edge-tools/MILESTONE-2.md`（他们死在 WebGL 模拟，推荐 OSMesa）。
//
// **断言的是"真渲出了东西"**，不是"函数存在"：
//   · `redraw_figure` 之后 MEMFS 里出现一张合法 PNG（魔数 + 尺寸门槛）
//   · `getframe` 拿得到**真像素**（T2 的 web toolkit 在这里返回空 ⇒ 一直是失败的）
//   · 像素**不是一片同色**（证明确实光栅化了线条/坐标轴，而不是空白画布）
//   · `plot/plot3/surf/mesh/contour/bar/pie/errorbar/scatter3` 逐个出图
//   · **默认 toolkit 仍是 `web`**（P5 是实验线，不让整站默认换渲染器）
//   · plot 桥与 `print -dsvg` 不回归
//
// ⚠️ 三条写测试的坑（本项目踩过）：
//   ① 必须等 `window.__octaveReady`（资产没装完会假失败）；
//   ② 等待要在 JS 侧做（本构建 `pause()` 会阻塞页面，见 HANDOFF §5.10）；
//   ③ `p5osmesa` 是**按需资产**（`.oct` 10.8MB，不进首包）——先 `ensureAssets()`；
//      而且这个 `.oct` **超过 8MB**，靠资产加载器的**异步预加载**绕开 Chrome 的
//      "主线程同步编译 >8MB 被禁"限制（见 bridge/assets-loader.js 的 SYNC_COMPILE_LIMIT）。
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8763/';
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
const t2 = Date.now();
while (Date.now() - t2 < 300000) {
  const ready = await page.evaluate(() => !!window.__octaveReady).catch(() => false);
  if (ready) break; await new Promise(r => setTimeout(r, 500));
}
console.log(`URL=${URL} ready=${((Date.now() - t) / 1000).toFixed(1)}s`);

let pass = 0, fail = 0;
async function ev(expr, label, want) {
  logs.length = 0;
  let r;
  try {
    r = await page.evaluate(x => { const rc = window.Module.eval_string(x); return { rc, err: window.Module.last_error_message() }; }, expr);
  } catch (e) { console.log(`CRASH | ${label} :: ${String(e).slice(0, 170)}`); fail++; return; }
  await new Promise(rr => setTimeout(rr, 600));
  const out = [...logs].join(' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  const ok = r.rc === 0 && (!want || out.includes(want));
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${out || ('rc=' + r.rc + ' ' + r.err.slice(0, 150))}`);
}
function assert(cond, label, extra) {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'fail'} | ${label}${extra ? ' :: ' + extra : ''}`);
}

console.log('--- 一、基线不受影响（默认仍是 web toolkit）---');
await ev('disp(graphics_toolkit())', '★ 默认 toolkit = web', 'web');
assert(await page.evaluate(() => typeof (window.Module && window.Module.loadDynamicLibrary)) === 'function',
  '★ Module.loadDynamicLibrary 已暴露（post.js 钩子）');

console.log('--- 二、按需加载 OSMesa 资产（10.8MB，不进首包）---');
const loaded = await page.evaluate(async () => {
  try { return { ok: await window.OctaveP5.ensureAssets() }; } catch (e) { return { err: String(e).slice(0, 200) }; }
});
assert(loaded.ok === true, '★ OctaveP5.ensureAssets() 成功', JSON.stringify(loaded).slice(0, 160));
await ev('disp(exist("__init_osmesa__"))', '★ __init_osmesa__ 存在（.oct 已挂载）', '3');
await ev('disp(exist("__control_slicot_functions__"))', '对照：SLICOT 模块也在（未回归）', '3');

console.log('--- 三、切到 osmesa ---');
await ev('graphics_toolkit("osmesa"); disp(graphics_toolkit())', '★ graphics_toolkit("osmesa") 装载成功', 'osmesa');
await ev('disp(any(strcmp(loaded_graphics_toolkits(), "osmesa")))', 'loaded 列表含 osmesa', '1');

console.log('--- 四、渲染：真出图（PNG + 页面）---');
const demo = await page.evaluate(async () => {
  try { return { r: await window.OctaveP5.demo() }; } catch (e) { return { err: String(e).slice(0, 200) }; }
});
assert(demo.r && demo.r.rc === 0, '★ OctaveP5.demo()（figure+plot+drawnow）无错', JSON.stringify(demo).slice(0, 200));
await new Promise(r => setTimeout(r, 1200));
const st = await page.evaluate(() => window.__p5_last || null);
assert(st && st.count > 0 && st.bytes > 1000, '★ toolkit 把 PNG 交到了页面（OctaveP5.show 被调用）', JSON.stringify(st));
assert(await page.evaluate(() => { const i = document.querySelector('#p5figure img'); return !!(i && i.src && i.src.startsWith('blob:')); }),
  '★ 页面上出现了 blob: 图片元素');
await ev('d = dir("/tmp/p5_fig.png"); disp(d.bytes > 1000)', '★ MEMFS 里的 PNG 有内容', '1');
await ev('fid = fopen("/tmp/p5_fig.png","r"); b = fread(fid, 8, "uint8"); fclose(fid); disp(all(b(:) == [137;80;78;71;13;10;26;10]))',
  '★ PNG 魔数正确（真 PNG，不是空文件）', '1');

console.log('--- 五、getframe：真像素（T2 的 web toolkit 在这里返回空）---');
await ev('p = getframe(gcf); disp(size(p.cdata, 3))', '★ getframe 返回 3 通道 cdata', '3');
await ev('p = getframe(gcf); disp(all(size(p.cdata)(1:2) > 100))', '★ 图像尺寸合理（>100×100）', '1');
await ev('p = getframe(gcf); v = p.cdata(:); disp(any(v != v(1)))', '★ 像素**不是一片同色**（确实画了东西）', '1');

console.log('--- 六、逐个图类型（plot/plot3/surf/mesh/contour/bar/pie/errorbar/scatter3）---');
for (const [cmd, name] of [
  ['plot(1:10, (1:10).^2)', 'plot'],
  ['plot3(cos(0:0.2:6), sin(0:0.2:6), 0:0.2:6)', 'plot3'],
  ['surf(peaks(20))', 'surf'],
  ['mesh(peaks(20))', 'mesh'],
  ['contour(peaks(20))', 'contour'],
  ['bar(1:5, [1 3 2 5 4])', 'bar'],
  ['pie([1 2 3 4])', 'pie'],
  ['errorbar(1:5, 1:5, 0.5*ones(1,5))', 'errorbar'],
  ['scatter3(rand(20,1), rand(20,1), rand(20,1))', 'scatter3'],
]) {
  await ev(`figure(${1 + fail}); clf; ${cmd}; drawnow; p = getframe(gcf); disp(any(p.cdata(:) != p.cdata(1)))`,
    `★ ${name} 出图且非空白`, '1');
}

console.log('--- 七、与既有能力共存（不回归）---');
await ev('plot(1:10); print -dsvg /tmp/p5.svg; d = dir("/tmp/p5.svg"); disp(d.bytes > 500)',
  '★ plot 桥 + print -dsvg 未受影响', '1');
await ev('graphics_toolkit("web"); disp(graphics_toolkit())', '★ 能切回 web toolkit', 'web');
await ev('disp(42)', '末条：解释器还活着（没有整页 trap）', '42');

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
