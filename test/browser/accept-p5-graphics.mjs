// P5 验收：真图形 toolkit（webgl：gl4es → GLES2 → WebGL2）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/accept-p5-graphics.mjs [URL]
//
// ── 这一套在验什么 ──────────────────────────────────────────────────────────
// 让 Octave **自己的 `opengl_renderer`**（一字不改）真的渲出像素。
// 后端只有一个：`webgl` = gl4es 把 GL 1.x 翻译到 GLES2 → **WebGL2（GPU）**
// （`build/113/webgl_toolkit.cc`）。`osmesa` 后端 2026-09-23 已退役（软件光栅化，
// 速度/体积都吃亏；脚本与配方留在 git 历史的 graphics-osmesa 分支）。
//
// **后端由站点自己决定**：脚本先查 `available_graphics_toolkits()`，没有 `webgl` 就
// **明确 SKIP**（不带 GL 的主 wasm 就是这样：跑这套只会全红，而那不是回归）。
//
// **断言的是"真渲出了东西"**，不是"函数存在"：
//   · `redraw_figure` 之后 MEMFS 里出现一张合法 PNG（魔数 + **解码后数颜色**）
//   · `getframe` 拿得到**真像素**（T2 的 web toolkit 在这里返回空 ⇒ 一直是失败的）
//   · 页面侧 `<img>` 真的贴上了那张 PNG（blob: URL）
//   · `plot/plot3/semilogy/loglog/stairs/stem/area/bar/pie/contour/errorbar/scatter/scatter3/mesh/surf`
//     逐个出图且**非空白**
//   · **默认 toolkit = `webgl`**（2026-09-23 用户拍板的 "A"：开箱即真渲染）
//   · **显式切到 `web` 时 plot 桥不建真对象**（T2 的老语义仍要成立）
//   · 镜像层里"核心内部按名字调被挡函数"那三个坑（pie/contour 的 `axis(h,…)`、
//     `legend(gca(),…)`）与"深度计数在错误路径上归零"—— 见 §五之二
//   · plot 桥与 `print -dsvg` 不回归
//
// ── 历史（别再按老前提改）─────────────────────────────────────────────────
//  · 原版假设 OSMesa 打进一个自包含 `.oct` 资产（A 档）⇒ 断言 `exist("__init_osmesa__")==3`。
//    **A 档撞三道墙被放弃**，改成"编进主模块"（B 档）⇒ 没有那个 `.oct`，`exist(...)` 是 0。
//  · 本文件原叫 `accept-p5-osmesa.mjs`；WebGL 后端加进来之后**参数化**成现在这样
//    （harness 把单文件拷成 `_run.mjs` 跑 ⇒ **测试必须是自包含的单文件**，
//     不能拆成 import 共享模块，这就是没有拆文件的原因）。
//
// ⚠️ 三条写测试的坑（本项目踩过）：
//   ① 必须等 `window.__octaveReady`（资产没装完会假失败）；
//   ② 等待要在 JS 侧做（本构建 `pause()` 会阻塞页面，见 HANDOFF §5.10）；
//   ③ 断言"非空白"要**解码 PNG 数颜色**，不能只看文件大小 —— 一张纯白图也有 7KB。
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

// ── 门禁 + 后端自动识别 ─────────────────────────────────────────────────────
// 只装了 `web` toolkit 的构建**没有**真渲染器，跑这套只会全红，而那不是回归。
// 所以先查 `available_graphics_toolkits()`；没有真渲染器就**明确 SKIP**（汇总行仍是
// `0 PASS / 0 FAIL`，`sweep.sh` 对那种站点保持全绿，同时把这行 SKIP 打出来，
// 避免"静默跳过"变成掩盖）。
// 后端清单里现在**只有 `webgl`**（gl4es → WebGL2）：`osmesa` 后端 2026-09-23 已退役。
logs.length = 0;
try { await page.evaluate(() => { window.Module.eval_string('disp(strjoin(available_graphics_toolkits(), ","))'); }); } catch (e) {}
await new Promise(r => setTimeout(r, 400));
const availStr = logs.join(' ');
const TK = ['webgl'].find(k => new RegExp(`(^|[, ])${k}([, ]|$)`).test(availStr)) || null;

if (!TK) {
  console.log('================================================');
  console.log('SKIP：这个站点没有真渲染器（available_graphics_toolkits 里没有 webgl）。');
  console.log('      available = ' + availStr.trim().slice(0, 120));
  console.log('      本套件只对**带 GL 的主 wasm**有意义（8768；8761 基线是不带 GL 的那份）；');
  console.log('      见 build/113/GRAPHICS-BRANCH.md、NOTES-webgl.md。');
  console.log('================================================');
  console.log('\n=== 0 PASS / 0 FAIL ===');
  await browser.close();
  process.exit(0);
}
console.log(`后端 = ${TK}（available = ${availStr.trim().slice(0, 80)}）`);

let pass = 0, fail = 0;
async function ev(expr, label, want) {
  logs.length = 0;
  let r;
  try {
    r = await page.evaluate(x => { const rc = window.Module.eval_string(x); return { rc, err: window.Module.last_error_message() }; }, expr);
  } catch (e) { console.log(`CRASH | ${label} :: ${String(e).slice(0, 170)}`); fail++; return ''; }
  await new Promise(rr => setTimeout(rr, 500));
  const out = [...logs].join(' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  const ok = r.rc === 0 && (!want || out.includes(want));
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${out || ('rc=' + r.rc + ' ' + r.err.slice(0, 150))}`);
  return out;
}
function assert(cond, label, extra) {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'fail'} | ${label}${extra ? ' :: ' + extra : ''}`);
}

// 页面侧 PNG 解码器：数"颜色种类数 / 非白像素数"。纯白图会得到 1 / 0。
await page.evaluate(() => {
  window.__pngStats = (bytes) => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const seen = new Set(); let nonWhite = 0;
      for (let i = 0; i < d.length; i += 4) {
        seen.add((d[i] << 16) | (d[i+1] << 8) | d[i+2]);
        if (d[i] !== 255 || d[i+1] !== 255 || d[i+2] !== 255) nonWhite++;
      }
      res({ w: c.width, h: c.height, colors: seen.size, nonWhite, total: d.length / 4 });
    };
    img.onerror = () => rej(new Error('decode failed'));
    img.src = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  });
});
async function pngStats() {
  return await page.evaluate(async () => {
    try { const b = window.Module.FS.readFile('/tmp/p5_fig.png'); return { n: b.length, ...(await window.__pngStats(b)) }; }
    catch (e) { return { err: String(e).slice(0, 120) }; }
  });
}

console.log('--- 一、默认渲染器 = webgl（`build/webgraphics/PKG_ADD` 装资产时就选定）---');
await ev('disp(graphics_toolkit())', '★ 默认 toolkit = webgl（开箱就是真渲染，不用点任何 API）', 'webgl');
await ev('figure(50); clf; plot(1:10, (1:10).^2); drawnow; disp(numel(findall(gcf, "type", "line")))',
  '★ 开箱 plot 就建出真 line 对象（默认已带镜像层）', '1');
await ev('close(50); disp("closed")', '收尾关掉 50 号图', 'closed');

console.log('--- 一之二、`web` toolkit 的老语义仍要成立（显式切过去）---');
await ev('graphics_toolkit("web"); disp(graphics_toolkit())', '★ 显式切到 web', 'web');
await ev('figure(50); clf; plot(1:10, (1:10).^2); drawnow; disp(numel(findall(gcf, "type", "line")))',
  '★ web 模式下 plot 桥**不**建真 line 对象（T2 老语义：镜像层由 __pb_real_renderer__ 关掉）', '0');
await ev('close(50); disp("closed")', '收尾关掉 50 号图', 'closed');

console.log(`--- 二、切到 ${TK}（B 档：toolkit 编在主 wasm 里，无需加载 .oct 资产）---`);
assert(await page.evaluate(async () => { try { return (await window.OctaveP5.ensureAssets()) === true; } catch (e) { return false; } }),
  '★ OctaveP5.ensureAssets() 成功（B 档下是空操作）');
await ev(`graphics_toolkit("${TK}"); disp(graphics_toolkit())`, `★ graphics_toolkit("${TK}") 装载成功`, TK);
await ev(`disp(any(strcmp(loaded_graphics_toolkits(), "${TK}")))`, `loaded 列表含 ${TK}`, '1');

console.log('--- 三、渲染：真出图（PNG + 页面）---');
const demo = await page.evaluate(async () => {
  try { return { r: await window.OctaveP5.demo() }; } catch (e) { return { err: String(e).slice(0, 200) }; }
});
assert(demo.r && demo.r.rc === 0, '★ OctaveP5.demo()（figure+plot+drawnow）无错', JSON.stringify(demo).slice(0, 200));
if (demo.r && demo.r.err && /unknown axes property/.test(demo.r.err))
  console.log('  （demo 尾巴上的 `__legend_handle__` 提示是桥的老毛病，rc=0，不影响判定）');
await new Promise(r => setTimeout(r, 1200));
const st = await page.evaluate(() => window.__p5_last || null);
assert(st && st.count > 0 && st.bytes > 1000, '★ toolkit 把 PNG 交到了页面（OctaveP5.show 被调用）', JSON.stringify(st));
assert(await page.evaluate(() => { const i = document.querySelector('#p5figure img'); return !!(i && i.src && i.src.startsWith('blob:')); }),
  '★ 页面上出现了 blob: 图片元素');
await ev('d = dir("/tmp/p5_fig.png"); disp(d.bytes > 1000)', '★ MEMFS 里的 PNG 有内容', '1');
await ev('fid = fopen("/tmp/p5_fig.png","r"); b = fread(fid, 8, "uint8"); fclose(fid); disp(all(b(:) == [137;80;78;71;13;10;26;10]))',
  '★ PNG 魔数正确（真 PNG，不是空文件）', '1');
{
  const s = await pngStats();
  assert(s.colors > 2 && s.nonWhite > 200, '★ PNG **不是空白**（解码后数颜色/非白像素）',
    `色数=${s.colors} 非白=${s.nonWhite}/${s.total} 宽高=${s.w}x${s.h}`);
}

console.log('--- 四、getframe：真像素（T2 的 web toolkit 在这里返回空）---');
await ev('p = getframe(gcf); disp(size(p.cdata, 3))', '★ getframe 返回 3 通道 cdata', '3');
await ev('p = getframe(gcf); disp(all(size(p.cdata)(1:2) > 100))', '★ 图像尺寸合理（>100×100）', '1');
await ev('p = getframe(gcf); v = p.cdata(:); disp(numel(unique(v)) > 2)', '★ 像素**不是一片同色**（确实画了东西）', '1');

console.log(`--- 五、镜像层：plot 桥在 ${TK} 下**同时**建出真图形对象 ---`);
await ev('figure(51); clf; plot(1:10, (1:10).^2); drawnow; disp(numel(findall(gcf, "type", "line")))',
  '★ plot 建出真 line 对象', '1');
await ev('figure(52); clf; surf(peaks(13)); drawnow; disp(numel(findall(gcf, "type", "surface")))',
  '★ surf 建出真 surface 对象', '1');
await ev('close([51 52]); disp("closed")', '收尾关掉 51/52 号图', 'closed');

// ── 五之二：镜像层改"一次性句柄缓存"之后**专门钉住**当年炸过的那个坑 ──────────────
// 背景（build/plotbridge/__pb_core__.m 的文件头有全文）：镜像层以前每次做两次 `path()`
// 手术（实测各 ~62 ms ⇒ 每图 ~300 ms）。2026-09-23 改成一次性 `str2func` 取核心句柄 +
// 深度计数转发。而**只缓存句柄、不做转发**的版本当年炸在这里：
//   核心 `__pie__.m:157/160` 里是 `axis (h, […], "square", "off")`（**首参是句柄**），
//   而桥的 `axis.m` 只认"2/4 元素向量" ⇒ `axis: limits must be a 2- or 4-element vector`。
// 所以下面这几条**必须**留在套件里：它们是"转发那段还在不在"的唯一硬证据。
// ⚠️ 这几条**不要**用 `warning("off"/"on", "all")` 去"清屏"：实测 `warning("on","all")`
//    会把页面本来关着的 `Octave language extension used` 重新打开，污染后面所有断言
//    （踩过：§七 因此假红）。`pie` 这条干脆**不要 want 串** —— 它要钉的就是"不报
//    `axis: limits must be a 2- or 4-element vector`"（rc/错误判据已经覆盖），
//    而 drawnow 带来的渲染器 warning 会刷屏，任何 want 串都可能被挤出捕获窗口（也踩过）。
await ev('figure(53); clf; pie([1 2 3 4]); drawnow; disp("pie_done")',
  '★ pie：核心内部的 `axis(h,…)` 走得通（走不通就报 limits must be 2/4-element）');
await ev('disp(numel(findall(gcf, "type", "patch")) > 0)',
  '★ pie 建出真 patch 对象', '1');
await ev('figure(54); clf; contour(peaks(15)); drawnow; disp("ok")',
  '★ contour：核心内部的 `axis(ax,…)` 走得通（同型嵌套）', 'ok');
await ev('figure(55); clf; plot(1:5); legend("a"); drawnow; disp("ok")',
  '★ legend：核心内部的 `legend(gca(),…)` 走得通（同型嵌套）', 'ok');
// ⚠️ 危险点：深度计数必须在**错误路径**上归零。否则一次失败的绘图会把 DEPTH 永久留在 >0，
//    此后所有桥函数都会静默转给核心 —— 表现为"图还能画，但桥的状态再也不更新"。
await ev('try, __pb_core__("surf", "junk"); catch err, disp("caught"); end; disp(__pb_core__("--depth"))',
  '★ 核心调用里出错后 DEPTH 归零（错误路径复位）', '0');
// 断言"增量"而不是绝对值：series 计数是跨图累计的，写死数字会跟前面的用例顺序耦合。
await ev('clf; n0 = __pstate__().n; plot(1:7); disp(__pstate__().n - n0)',
  '★ 出错之后桥的状态机仍在工作（plot 仍记 series）', '1');
await ev('close(53:55); disp("closed")', '收尾关掉 53..55 号图', 'closed');

console.log('--- 六、逐个图类型（plot/plot3/surf/mesh/contour/bar/pie/errorbar/scatter3/…）---');
let fi = 60;
for (const [cmd, name] of [
  ['plot(1:10, (1:10).^2)', 'plot'],
  ['plot3(cos(0:0.2:6), sin(0:0.2:6), 0:0.2:6)', 'plot3'],
  ['semilogy(1:10, 10.^(1:10))', 'semilogy'],
  ['loglog(1:10, 10.^(1:10))', 'loglog'],
  ['stairs(1:10, 1:10)', 'stairs'],
  ['stem(1:8, (1:8).^2)', 'stem'],
  ['area(1:8, 1:8)', 'area'],
  ['bar(1:5, [1 3 2 5 4])', 'bar'],
  ['pie([1 2 3 4])', 'pie'],
  ['contour(peaks(20))', 'contour'],
  ['errorbar(1:5, 1:5, 0.5*ones(1,5))', 'errorbar'],
  ['scatter(rand(20,1), rand(20,1))', 'scatter'],
  ['scatter3(rand(20,1), rand(20,1), rand(20,1))', 'scatter3'],
  ['mesh(peaks(20))', 'mesh'],
  ['surf(peaks(20))', 'surf'],
]) {
  const rc = await ev(`figure(${fi++}); clf; ${cmd}; drawnow; "ok"`, `${name} drawnow`);
  const s = await pngStats();
  assert(rc !== '' && s.colors > 2 && s.nonWhite > 200, `★ ${name} 出图且非空白`,
    `色数=${s.colors} 非白=${s.nonWhite}`);
}
await ev(`close(${60}:${fi - 1}); disp("closed")`, '收尾关掉本轮所有图', 'closed');

console.log('--- 七、与既有能力共存（不回归）---');
await ev('plot(1:10); print -dsvg /tmp/p5.svg; d = dir("/tmp/p5.svg"); disp(d.bytes > 500)',
  '★ plot 桥 + print -dsvg 未受影响', '1');
await ev('graphics_toolkit("web"); disp(graphics_toolkit())', '★ 能切回 web toolkit', 'web');
await ev('figure(70); clf; plot(1:5); drawnow; disp(numel(findall(gcf, "type", "line")))',
  '★ 切回 web 后镜像层**关闭**（真对象不再出现）', '0');
await ev('close(70); disp("closed")', '收尾关掉 70 号图', 'closed');
await ev('disp(42)', '末条：解释器还活着（没有整页 trap）', '42');

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
