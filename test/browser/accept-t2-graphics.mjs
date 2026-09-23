// T2/A1 验收：图形句柄半真化（`web` graphics toolkit）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 这一批解决什么 ──────────────────────────────────────────────────────────
// 本构建原本**没编任何 graphics toolkit**（`--without-opengl`，也没有 gnuplot/fltk/qt），
// 于是 `figure` 建不出图形对象，`gcf/gca/get/set/title` 这些**句柄语义全废**：
//   figure(1) → 1，但 ishandle(1)=0、get(1,'type') → "get: invalid handle"
// （改动前的实测记录见 test/browser/probe-t2-graphics.mjs）。
// T2 挂上一个最小的 `web` toolkit，让**图形对象真的存在**；渲染仍归 plot 桥。
//
// ── 实现要点（详见 HANDOFF §5.5 与 build/113/web_graphics_toolkit.cc）────────
//   · toolkit 本体是**资产车道的 side module**（`__init_web__.oct`），**主 wasm 零改动** ——
//     关键发现：`available_graphics_toolkits()` 返回的是**运行时注册表**
//     （`gtk_manager::available_toolkits_list()`），不是编译期清单，且有内建
//     `register_graphics_toolkit()` 可以登记。原计划记的 "Lane B（重链）" 因此不需要。
//   · 登记+装载由 `build/webgraphics/PKG_ADD` 完成（Octave 在 addpath 时自动执行）。
//   · `plotbridge/figure.m` 以前只记"当前图号"、**不建真对象**，现在补上
//     `__go_figure__` 调用（try/catch 兜底，拿不到 toolkit 时退回老行为）。
//
// ── 半真化的边界（**如实写进断言注释，别当成 bug**）──────────────────────────
//   真对象存在、属性可读写；但**序列数据仍在 plot 桥自己的状态里**（渲染走桥），
//   所以 `get(gca,'children')` 不会列出 plot 画的那条线，`xlim` 也不会自动跟随数据。
//   这是计划里"只救活句柄语义、不碰绘图重构"的直接后果。
//
// ⚠️ 2026-09-23：站点默认 toolkit 改成 `webgl`（真渲染器）之后，本套件在开头**显式切回
//    `web`** —— 它验的就是这一套 `web` 的句柄语义，与默认是谁无关。
//
// 用法：harness/run.sh test/browser/accept-t2-graphics.mjs [URL]
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
  const s = '__T' + Math.random().toString(36).slice(2) + '__';
  logs.length = 0;
  let rc;
  try {
    rc = await page.evaluate(([x, sn]) => window.Module.eval_string(`${x}; disp('${sn}');`), [code, s]);
  } catch (e) { return { rc: 'TRAP', out: '', trap: true, err: String(e).slice(0, 150) }; }
  const t = Date.now();
  while (Date.now() - t < timeoutMs) { if (logs.some(l => l.includes(s))) break; await sleep(80); }
  return { rc, out: logs.join(' ').split(s)[0].replace(/\s+/g, ' ').trim(), trap: false,
           err: await page.evaluate(() => window.Module.last_error_message()).catch(() => '') };
}

let pass = 0, fail = 0;
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

async function ev (code, name, want) {
  const r = await run(code);
  const ok = !r.trap && r.rc === 0 && !/^error/i.test(r.out) && (want === undefined || wantHit(r.out, want));
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${name.padEnd(40)} :: ${r.trap ? '★TRAP' : (r.out || r.err || '(空)').slice(0, 100)}`);
  return r;
}

console.log(`URL=${URL}`);
await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
for (let i = 0; i < 300; i++) {
  const ok = await page.evaluate(() => window.__octaveReady === true).catch(() => false);
  if (ok) break; await sleep(500);
}
await sleep(800);
console.log(`ready`);

// ⚠️ 本套件测的是 **`web` toolkit 的句柄语义**（"序列数据仍在桥里、不建真对象"那套老语义），
//    而 **2026-09-23 起站点的默认 toolkit 是 `webgl`**（真渲染器，会开镜像层 ⇒
//    `findall(gcf,"type","line")` 不再是 0）。所以这里必须**显式切回 `web`**，
//    否则下面一半断言会因为"默认换了"而假红（踩过：默认换成 webgl 后 `def=web` 那条直接红）。
//    `web` 永远注册得到（本套件依赖的 webgraphics 资产在启动清单里），所以这里不做兜底判断。
await run('graphics_toolkit("web")');
console.log(`已显式切到 web（站点默认是 webgl）`);

console.log('\n--- 一、toolkit 已注册并被设为默认 ---');
await ev('printf("avail={%s}\\n", strjoin(available_graphics_toolkits(),","))', 'available_graphics_toolkits 含 web', 'web');
await ev('printf("loaded={%s}\\n", strjoin(loaded_graphics_toolkits(),","))', 'loaded_graphics_toolkits 含 web', 'web');
await ev('printf("def=%s\\n", graphics_toolkit())', '默认 toolkit = web', 'def=web');
await ev('disp(exist("__init_web__"))', '__init_web__.oct 已装载（exist=3）', '3');

console.log('\n--- 二、figure：真对象（改动前这里是 invalid handle）---');
await ev('h=figure(1); printf("n=%g type=%s ish=%d\\n", h, get(h,"type"), ishandle(h))',
  '★ figure(1) 是**真的** figure 对象', 'type=figure');
await ev('printf("ish=%d\\n", ishandle(1))', '★ ishandle(1)=1', 'ish=1');
await ev('printf("nchild=%d\\n", numel(get(0,"children")))', '根对象的 children 列得出 figure', 'nchild=1');
await ev('printf("cf=%g\\n", get(0,"currentfigure"))', 'currentfigure 已设置', 'cf=1');
await ev('hf2=figure(2); printf("gcf=%g\\n", gcf())', 'gcf() 跟随 figure(2)', 'gcf=2');
await ev('printf("t2=%s\\n", get(2,"__graphics_toolkit__"))', 'figure 的 toolkit 是 web', 't2=web');

console.log('\n--- 三、gca + 属性读写（T2 的核心目标）---');
await ev('figure(3); a=gca(); printf("a=%.3f type=%s ish=%d\\n", a, get(a,"type"), ishandle(a))',
  '★ gca() 返回真 axes', 'type=axes');
await ev('set(gca(),"xlim",[0 5]); printf("xlim=[%g %g]\\n", get(gca(),"xlim")(1), get(gca(),"xlim")(2))',
  '★ set/get(gca,xlim) 往返一致', 'xlim=[0 5]');
await ev('set(gca(),"yscale","log"); printf("ys=%s\\n", get(gca(),"yscale"))', 'set/get 其它属性也可用', 'ys=log');
await ev('printf("vis=%s\\n", get(gca(),"visible"))', '默认属性读得回来', 'vis=on');
await ev('l=line("parent",gca(),"xdata",[1 2 3],"ydata",[1 4 9]); printf("l_is=%d n=%d\\n", ishandle(l), numel(get(gca(),"children")))',
  '★ line() 建出真 line 对象（axes 有 1 个子对象）', 'n=1');
// ⚠️ `get(ax,'title')` 返回的是**文本对象句柄**，不是字符串 —— 要再取一层
//    `get(...,'string')`。第一版直接 printf 句柄，打出空串，误判成"镜像没生效"。
await ev('title("hello"); printf("title=[%s]\\n", get(get(gca(),"title"),"string"))',
  '★ title() 写进了真 axes 属性（读得回来）', 'title=[hello]');
await ev('xlabel("xx"); printf("xl=[%s]\\n", get(get(gca(),"xlabel"),"string"))', 'xlabel 同样可读回', 'xl=[xx]');
await ev('set(gca(),"title","直接设"); printf("t=[%s]\\n", get(get(gca(),"title"),"string"))', '直接用 set 设标题也可读回', 't=[直接设]');

console.log('\n--- 四、allchild / findall / close（句柄遍历与生命周期）---');
// 只断言"不报错且至少列出一个后代"—— 具体个数取决于此刻 figure 上有几个 axes/text，
// 写死数字会让断言跟前面的用例顺序耦合（第一版就写死了 2，结果随 title 镜像引入的
// text 对象而变）。
await ev('n=numel(allchild(gcf())); printf("n_allchild_ge1=%d\\n", n>=1)', '★ allchild 不再报 invalid handle',
  'n_allchild_ge1=1');
await ev('printf("n_findall=%d\\n", numel(findall(gcf(),"type","axes")))', 'findall 能按类型找', 'n_findall=1');
await ev('close(3); printf("closed ish=%d\\n", ishandle(3))', '★ close(3) 关得掉', 'closed ish=0');
await ev('printf("nchild=%d\\n", numel(get(0,"children")))', '关掉后 children 减少', 'nchild=2');

console.log('\n--- 五、与 plot 桥共存（渲染仍归桥）---');
// ⚠️ 半真化边界：plot 的**序列数据在桥的状态里**，不会变成真 line 对象，
//    所以这里断言的是"坐标轴存在 + 能出 SVG"，**不是** children 里有线条。
await ev('figure(9); clf; plot(1:10); printf("gcf=%g gca_ish=%d\\n", gcf(), ishandle(gca()))',
  'plot 之后 gcf/gca 都活着', 'gca_ish=1');
await ev('print("/tmp/t2.svg","-dsvg"); d=dir("/tmp/t2.svg"); printf("bytes>2000: %d\\n", d.bytes>2000)',
  '★ print -dsvg 仍正常（桥没被破坏）', 'bytes>2000: 1');
await ev('s=fileread("/tmp/t2.svg"); printf("has_poly=%d\\n", !isempty(strfind(s,"<polyline")))',
  'SVG 里有折线（序列数据来自桥）', 'has_poly=1');

console.log('\n--- 六、无 trap ---');
{
  const bad = /RuntimeError: unreachable|\[pageerror\]/.test(logs.join(' '));
  bad ? fail++ : pass++;
  console.log(`${bad ? 'fail' : 'PASS'} | ${'无整页 trap'.padEnd(40)} :: ${bad ? '见日志' : '干净'}`);
}

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
