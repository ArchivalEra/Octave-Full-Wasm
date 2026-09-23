// 批次 13 验收：dldfcn 回归官方 dlopen 装载路径
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/accept-dldfcn.mjs [URL]
//
// 背景：这 11 个函数原先由 build/main.cc 的 STATIC_DLD_FCNS 表**手工注册成内建**
// （`symtab.install_built_in_function`），于是 `exist()` 返回 5、`which()` 报
// "built-in function" —— 与桌面版语义不符（桌面版是运行时 dlopen 的 `.oct`，
// exist=3、which() 返回文件路径）。本批把它们改成站点资产、走官方装载。
//
// 验收判据：
//   * 官方语义 —— exist=3、which() 指向 `.oct` 文件
//   * 真数值 —— convhulln/delaunay/glpk/fftw/音频/压缩都真算一遍
//   * 覆盖 11 个函数名（7 个 .oct 模块，其中 2 个是"一个模块导出多个函数"，
//     靠 aliases 符号链接补齐）
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

// index.html 会在清单就绪后自动装 dldfcn 核心组，等它落定
await new Promise(r => setTimeout(r, 3000));

let pass = 0, fail = 0;
async function ev(expr, label, want) {
  logs.length = 0;
  let r;
  try {
    r = await page.evaluate(x => { const rc = window.Module.eval_string(x); return { rc, err: window.Module.last_error_message() }; }, expr);
  } catch (e) { console.log(`CRASH | ${label} :: ${String(e).slice(0, 130)}`); fail++; return; }
  await new Promise(rr => setTimeout(rr, 650));
  // ⚠️ **匹配用完整输出，只有显示才截断**。原来两边都用 `slice(0, 200)`，于是"要匹配的东西
  //    落在前 200 字符之外"就会假红。2026-09-23 就这么红过一次：默认 toolkit 换成 `webgl`
  //    之后，会话里**第一次建 axes** 会打一条 FreeType warning **带 6 行调用栈**
  //    （`opengl_renderer::render_text`，既有偏差、不是本次引入），它一条就把 200 字符占满，
  //    于是 `plot/print 仍可用`（want='2'）在这里与 accept-forge2 里各假红一次。
  const full = [...logs].join(' ').replace(/\s+/g, ' ').trim();
  const ok = r.rc === 0 && (!want || full.includes(want));
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${(full || ('rc=' + r.rc + ' ' + r.err)).slice(0, 200)}`);
}

console.log('--- 自动装载（页面加载即装，保持开箱可用）---');
console.log('  已加载:', await page.evaluate(() => window.OctaveAssets.loaded().join(' ')));

console.log('--- ★ 官方语义：exist=3 + which 指向 .oct（不是 built-in）---');
const NAMES = ['convhulln', '__delaunayn__', '__voronoi__', '__glpk__', 'fftw',
               'gzip', 'bzip2', 'audioread', 'audiowrite', 'audioinfo', 'audioformats'];
for (const f of NAMES) {
  await ev(`disp([num2str(exist("${f}")) "|" which("${f}")])`, `${f}`, `3|`);
}
// 逐项确认 which 指向 .oct 文件（上面的 "3|" 只验证了 exist 码）
for (const f of NAMES) {
  await ev(`disp(!isempty(strfind(which("${f}"), ".oct")))`, `★ ${f} 来自 .oct 文件`, '1');
}
// 反向断言：不再是内置
await ev('disp(!isempty(strfind(which("convhulln"),"built-in")))', 'convhulln 不再是 built-in（应为 0）', '0');

console.log('--- ★ 覆盖完整性：11 个函数名全部可用 ---');
await ev(`n=0; for f={"${NAMES.join('","')}"}, n += (exist(f{1})==3); endfor; disp(n)`, '★ 11 个函数名 exist=3', '11');

console.log('--- convhulln / delaunayn / voronoi（qhull 后端）---');
await ev('disp(convhulln([0 0;1 0;0 1])(:)\')', '★ convhulln 三角形', '1 3 2');
await ev('V=convhulln(rand(20,3)); disp(size(V,2))', 'convhulln 3D 返回索引矩阵', '3');
await ev('disp(size(delaunay([0;1;0],[0;0;1]),1))', 'delaunay 三角形数', '1');
await ev('X=rand(30,2); T=delaunay(X); disp(size(T,2))', '★ delaunay 2D 三角剖分列数', '3');
// voronoi 的**两输出形式**是纯计算（可用）；**单输出形式**会去画图（走 gca），
// 本构建无图形句柄，故只能测两输出形式。这不是 .oct 的问题。
await ev('[vx,vy]=voronoi(rand(8,1),rand(8,1)); disp(numel(vx)>0)', '★ voronoi 出顶点（两输出）', '1');
// voronoin 至少 4 点（3 点构不出初始单纯形，qhull 会报错）
await ev('[C,F]=voronoin(rand(12,2)); disp(numel(C)>0)', '★ voronoin 出顶点', '1');

console.log('--- glpk（线性规划）---');
await ev("[x,f]=glpk([-1;-1],[1 1],[10],[0;0],[3;3],'U','CC',1); disp([x' abs(f)])", '★ glpk 最优解 x=(3,3) f=-6', '3 3 6');
await ev("[x,f]=glpk([1;1],[1 1],[1],[0;0],[1;1],'U','CC',1); disp(abs(f)<1e-12)", '★ 最小化时最优值为 0', '1');
await ev("[x,f]=glpk([-1;-1],[1 1],[1],[0;0],[1;1],'U','CC',1); disp(abs(f-(-1))<1e-12)", '★ 最大化时最优值为 -1（=min c 的负）', '1');
await ev("[x,f]=glpk([1;1;1],[1 1 1],2,[0;0;0],[1;1;1],'U','CCC',1); disp(sum(x)<=2+1e-9)", '★ 三维变量约束成立', '1');

console.log('--- fftw（规划器入口；核心 fft 另测）---');
await ev('disp(fftw("planner"))', 'fftw planner 可读', 'estimate');
await ev('fftw("planner","measure"); disp(fftw("planner"))', '★ planner 可设置', 'measure');
await ev('fftw("planner","estimate"); s=fftw("dwisdom"); disp(ischar(s))', 'dwisdom 返回字符串', '1');
await ev('disp(sum(fft([1 0 0 0])))', '★ 核心 fft 不受影响', '4');
await ev('disp(isequal(size(fft(rand(4,4))),[4 4]))', 'fft 2D 正常', '1');

console.log('--- gzip / bzip2（zlib + bz2）---');
// 解压侧（gunzip/bunzip2）走的是批次 4 的 webshell 覆写——核心那份调 system()
// 在本构建必失败。这里加载它，同时也验证"dldfcn 的压缩 + webio 的解压"能协同。
console.log('  webshell:', await page.evaluate(async () => {
  try { await window.OctaveAssets.load('webshell'); return 'ok'; }
  catch (e) { return 'ERR ' + String(e).slice(0, 120); }
}));
// gzip 返回的是 cell（每个输出文件一条），且**源文件必须存在**——
// 源文件用 Octave 的 fopen/fprintf 写（eval_string 里没有 JS 的 Module）
await ev('fid=fopen("/tmp/d_alpha.txt","w"); fprintf(fid,"alpha payload\\n"); fclose(fid); disp(exist("/tmp/d_alpha.txt"))', '准备源文件', '2');
await ev('n=gzip("/tmp/d_alpha.txt"); disp(n{1})', '★ gzip 返回输出路径', '.gz');
await ev('disp(exist("/tmp/d_alpha.txt.gz"))', '★ gzip 生成 .gz', '2');
await ev('r=gunzip("/tmp/d_alpha.txt.gz"); disp(exist("/tmp/d_alpha.txt"))', 'gunzip 还原', '2');
await ev('s=fileread("/tmp/d_alpha.txt"); disp(!isempty(strfind(s,"alpha payload")))', '★ 压缩往返内容一致', '1');
await ev('fid=fopen("/tmp/d_beta.txt","w"); fprintf(fid,"beta payload\\n"); fclose(fid); n2=bzip2("/tmp/d_beta.txt"); disp(exist("/tmp/d_beta.txt.bz2"))', '★ bzip2 生成 .bz2（别名生效）', '2');
await ev('bunzip2("/tmp/d_beta.txt.bz2"); s2=fileread("/tmp/d_beta.txt"); disp(!isempty(strfind(s2,"beta payload")))', '★ bunzip2 往返内容一致', '1');

console.log('--- audioread 系列（libsndfile 后端，一个模块四个函数）---');
await ev('fs=8000; t=(0:fs-1)/fs; y=sin(2*pi*440*t); audiowrite("/tmp/d_440.wav", y, fs); disp(1)', 'audiowrite 写 wav');
await ev('[y2,fs2]=audioread("/tmp/d_440.wav"); disp(fs2)', '★ audioread 采样率', '8000');
await ev('disp(numel(y2))', '★ audioread 样本数', '8000');
await ev('disp(abs(max(abs(y2))-1)<1e-3)', '★ 峰值保住', '1');
await ev('i=audioinfo("/tmp/d_440.wav"); disp(i.SampleRate)', '★ audioinfo 元数据', '8000');
// audioformats() 把格式表**直接打印**出来（无输出参数时），返回值为空——
// 所以断言要抓 console 输出而不是返回值。第一次跑时我用返回值数元素，必然失败。
// audioformats() 直接打印（不接受输出参数），无法重定向到文件。
// 用 evOut() 拿完整 console 输出做子串检查——ev() 为了保持日志可读会把输出
// 截到 200 字符，而格式表有 23 条、远超这个长度。
async function evOut(expr, label, want) {
  logs.length = 0;
  let r;
  try {
    r = await page.evaluate(x => { const rc = window.Module.eval_string(x); return { rc, err: window.Module.last_error_message() }; }, expr);
  } catch (e) { console.log(`CRASH | ${label} :: ${String(e).slice(0, 130)}`); fail++; return; }
  await new Promise(rr => setTimeout(rr, 900));
  const full = [...logs].join(' ');
  const ok = r.rc === 0 && full.includes(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${ok ? '命中' : ('未见 "' + want + '"（输出 ' + full.length + ' 字符）')}`);
}
await evOut('audioformats()', '★ 格式表含 AIFF（Apple/SGI）', 'AIFF');
await evOut('audioformats()', '★ 格式表含 WAVE（Microsoft WAV）', 'WAVE');
await evOut('audioformats()', '★ 格式表含 PCM', 'PCM');
await evOut('audioformats()', '★ 格式表含 MAT5（Matlab 5.0）', 'MAT5');
await evOut('audioformats()', '★ 格式表含 AU（Sun/NeXT）', 'AU');

console.log('--- 与核心 .m 包装层协同（这些才是用户真正调的）---');
await ev('disp(size(convhull(rand(10,2)),1)>0)', 'convhull（.m 包装）', '1');
await ev('K=convhull(rand(10,2)); disp(size(K,2))', '★ convhull 返回顶点索引', '1');
await ev('T=delaunayn(rand(20,3)); disp(size(T,2))', '★ delaunayn（.m 包装）', '4');
// voronoi 的单输出形式要画图（gca），本构建无图形 —— 只测两输出形式
await ev('[vx,vy]=voronoi(rand(8,1),rand(8,1)); disp(numel(vx)>0)', 'voronoi（.m 包装，两输出）', '1');
await ev('[C,F]=voronoin(rand(12,2)); disp(numel(C)>0)', 'voronoin（.m 包装）', '1');
// importdata 在音频文件上走 audioread（它的返回是结构体或 (data, fs) 两输出）
await ev('d=importdata("/tmp/d_440.wav"); disp(isstruct(d) || isscalar(d))', '★ importdata 走 audioread 不报错', '1');

console.log('--- 回归：不相关功能未受影响 ---');
await ev('disp(numel(eigs([2 0;0 3])))', 'eigs 仍可用', '2');
await ev('A=magic(3); save("-v7","/tmp/d.mat","A"); clear A; load("/tmp/d.mat"); disp(A(1,1))', 'save/load -v7 仍可用', '8');
await ev('A=magic(3); save("-hdf5","/tmp/d.h5","A"); clear A; load("/tmp/d.h5"); disp(A(1,1))', 'save/load -hdf5 仍可用', '8');
await ev('disp(numel(ode45(@(t,y) -y, [0 1], 1)))', 'ode45 仍可用', '1');
await ev('clf; plot(1:10); print("/tmp/d.svg","-dsvg"); disp(exist("/tmp/d.svg"))', 'plot/print 仍可用', '2');
// 避免在 JS 模板串里嵌套转义的双引号：让 Octave 自己比较
await ev("s=jsonencode(struct('a',1)); disp(isequal(s,'{\"a\":1}'))", '★ jsonencode 仍可用（内容比对）', '1');

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
