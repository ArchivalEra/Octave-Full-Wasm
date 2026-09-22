// 批次 6 验收：R9 print -dsvg（纯 .m SVG 生成器）+ plot 桥 marker 修复
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/accept-print.mjs [URL]
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text().slice(0, 400)));
page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 300)));
await page.goto(URL, { waitUntil: 'load', timeout: 240000 });
const t = Date.now();
while (Date.now() - t < 300000) {
  const ok = await page.evaluate(() => { try { return !!window.Module?.feval?.('strcat', ['a', 'b'], 1); } catch { return false; } }).catch(() => false);
  if (ok) break; await new Promise(r => setTimeout(r, 800));
}
// ⚠️ 光等解释器能 eval 是**不够**的：`plotbridge` 是**页面启动装载清单**里的资产，
//    在它挂上之前，`plot`/`figure` 走的是核心路径 → 报 "no graphics toolkits are
//    available!"，`which('print')` 也会指到核心的 plot/util/print.m。
//    这会让最前面几条断言假失败（实测：8762 上 4 条 FAIL 全是这个原因，
//    而同一套后面那些断言全过 —— 因为那时资产已经装好了）。
//    所以这里必须等到站点自己置的 ready 标志。
await page.evaluate(async () => {
  for (let i = 0; i < 300; i++) {
    if (window.__octaveReady === true) return;
    await new Promise(r => setTimeout(r, 200));
  }
}).catch(() => {});
await new Promise(r => setTimeout(r, 500));
console.log(`URL=${URL} ready=${((Date.now() - t) / 1000).toFixed(1)}s`);

let pass = 0, fail = 0;
async function ev(expr, label, want) {
  logs.length = 0;
  let r;
  try {
    r = await page.evaluate(x => { const rc = window.Module.eval_string(x); return { rc, err: window.Module.last_error_message() }; }, expr);
  } catch (e) { console.log(`CRASH | ${label} :: ${String(e).slice(0, 120)}`); fail++; return; }
  await new Promise(rr => setTimeout(rr, 600));
  const out = [...logs].join(' ').replace(/\s+/g, ' ').trim().slice(0, 220);
  const ok = r.rc === 0 && (!want || out.includes(want));
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${out || ('rc=' + r.rc + ' ' + r.err.slice(0, 140))}`);
}

// 取表达式的值（不靠 console 输出，避免被页面噪声挤掉）。
// 注意 which() 是命令式函数：要写成 [p, ...] = which ("print") 才有返回值。
async function evVal(expr, label, want) {
  let r;
  try {
    r = await page.evaluate((x) => {
      try { window.Module.FS.unlink('/tmp/__v__.txt'); } catch (e) {}
      window.Module.eval_string('clear __v__');
      const rc = window.Module.eval_string(x);
      let v = '';
      try {
        v = new TextDecoder().decode(window.Module.FS.readFile('/tmp/__v__.txt'));
      } catch (e) { v = ''; }
      return { rc, v: v.trim(), err: window.Module.last_error_message() };
    }, expr);
  } catch (e) { console.log(`CRASH | ${label} :: ${String(e).slice(0, 120)}`); fail++; return; }
  const ok = r.rc === 0 && r.v.includes(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${r.v.slice(0, 140) || ('rc=' + r.rc + ' ' + r.err.slice(0, 120))}`);
}

// 期望失败：rc!=0 且消息里含子串
async function evErr(expr, label, want) {
  logs.length = 0;
  let r;
  try {
    r = await page.evaluate(x => { const rc = window.Module.eval_string(x); return { rc, err: window.Module.last_error_message() }; }, expr);
  } catch (e) { console.log(`CRASH | ${label} :: ${String(e).slice(0, 120)}`); fail++; return; }
  await new Promise(rr => setTimeout(rr, 600));
  const out = [...logs].join(' ').replace(/\s+/g, ' ').trim();
  const ok = r.rc !== 0 && (out + ' ' + r.err).includes(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${(out || r.err).slice(0, 150)}`);
}

// 解析 SVG 并统计图元（用浏览器自己的 XML 解析器，最严格）
async function svgCheck(path, label, opts = {}) {
  const r = await page.evaluate((p) => {
    try {
      const txt = new TextDecoder().decode(window.Module.FS.readFile(p));
      const doc = new DOMParser().parseFromString(txt, 'image/svg+xml');
      const err = doc.querySelector('parsererror');
      const q = (sel) => doc.querySelectorAll(sel).length;
      return { ok: true, len: txt.length, head: txt.slice(0, 40),
        parseErr: err ? err.textContent.slice(0, 100) : null,
        polyline: q('polyline'), circle: q('circle'), line: q('line'),
        rect: q('rect'), polygon: q('polygon'), text: q('text'),
        texts: [...doc.querySelectorAll('text')].map(e => e.textContent),
        svg: q('svg') };
    } catch (e) { return { ok: false, err: String(e).slice(0, 160) }; }
  }, path);
  let ok = r.ok && !r.parseErr && r.len > 300 && r.svg === 1;
  const notes = [];
  if (!r.ok) notes.push('读取/解析失败:' + (r.err || '?'));
  if (opts.minPolyline != null) { const c = r.polyline >= opts.minPolyline; ok = ok && c; notes.push(`poly=${r.polyline}${c ? '' : '!=' + opts.minPolyline}`); }
  if (opts.minCircle != null) { const c = r.circle >= opts.minCircle; ok = ok && c; notes.push(`circ=${r.circle}`); }
  if (opts.minRect != null) { const c = r.rect >= opts.minRect; ok = ok && c; notes.push(`rect=${r.rect}`); }
  if (opts.minPolygon != null) { const c = r.polygon >= opts.minPolygon; ok = ok && c; notes.push(`polyg=${r.polygon}`); }
  if (opts.minLine != null) { const c = r.line >= opts.minLine; ok = ok && c; notes.push(`line=${r.line}`); }
  if (opts.minText != null) { const c = r.text >= opts.minText; ok = ok && c; notes.push(`text=${r.text}`); }
  // ⚠️ 必须先确认 r.texts 存在：上面 page.evaluate 的 try 一旦失败，返回的是
  //    `{ok:false, err}`（**没有 texts 字段**），旧代码直接 `r.texts.some(...)`
  //    就抛 TypeError: r.texts is undefined —— 整页没崩、但测试自己崩了，
  //    把真正的失败原因（读取/解析失败）盖掉了。这就是「accept-print 的测试
  //    自身有病」那条待办的根因。
  if (opts.hasText) {
    const found = Array.isArray(r.texts) && r.texts.some(s => s.includes(opts.hasText));
    ok = ok && found;
    if (!found) notes.push(Array.isArray(r.texts) ? `缺文本"${opts.hasText}"` : `无文本可查（r.texts 缺失）`);
  }
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: len=${r.len} parseErr=${r.parseErr} ${notes.join(' ')} ${r.ok ? '' : r.err || ''}`);
  return r;
}

console.log('--- print/saveas 已接管（plotbridge 在 path 前面）---');
await evVal('p = which("print"); fid = fopen("/tmp/__v__.txt","w"); fprintf(fid, "%s", p); fclose(fid);', 'which print', 'plotbridge');
await evVal('p = which("saveas"); fid = fopen("/tmp/__v__.txt","w"); fprintf(fid, "%s", p); fclose(fid);', 'which saveas', 'plotbridge');

console.log('--- 基本 lines ---');
await ev("clf; x=(0:0.5:10)'; plot(x,x.^2)", 'plot');
await ev('print("/tmp/b.svg","-dsvg")', 'print -dsvg');
await ev('disp(exist("/tmp/b.svg"))', '文件落盘', '2');
await svgCheck('/tmp/b.svg', 'SVG 结构（polyline+刻度文本）', { minPolyline: 1, minText: 6, minLine: 6 });

console.log('--- 标题/标签/legend/grid + 中文 ---');
await ev("clf; x=(0:0.1:2*pi)'; plot(x,sin(x),'-r'); hold on; plot(x,cos(x),'--b'); hold off", '两条曲线');
await ev("title('正弦与余弦'); xlabel('时间 t/s'); ylabel('幅度'); legend('sin','cos','Location','NorthWest'); grid on", '中文标题+legend+grid');
await ev('print("/tmp/lab.svg","-dsvg")', 'print');
await svgCheck('/tmp/lab.svg', '中文 + 双曲线 + legend', { minPolyline: 2, hasText: '正弦与余弦', minText: 8 });
await svgCheck('/tmp/lab.svg', '中文轴标签', { hasText: '时间 t/s' });

console.log('--- marker（修复前全部退化成空心圆）---');
await ev("clf; x=1:5; plot(x,x,'s'); hold on; plot(x,x+2,'d'); plot(x,x+4,'^'); hold off", "s / d / ^ 三种 marker");
await ev('print("/tmp/mk.svg","-dsvg")', 'print');
// s → rect，d/^ → polygon
await svgCheck('/tmp/mk.svg', '★ marker 各自成图元（s=rect, d/^=polygon）', { minRect: 5, minPolygon: 8 });
await ev("clf; x=1:5; plot(x,x,'o'); plot(x,x,'+',''); ", 'o / + ');
await ev("clf; x=1:6; plot(x,x,'x'); hold on; plot(x,x+1,'+'); plot(x,x+2,'*'); hold off", 'x / + / *');
await ev('print("/tmp/mk2.svg","-dsvg")', 'print');
await svgCheck('/tmp/mk2.svg', 'x/+/* 三种线型 marker', { minLine: 12 });

console.log('--- log 轴 ---');
await ev("clf; x=logspace(0,3,50); semilogy(x,x.^2)", 'semilogy');
await ev('print("/tmp/log.svg","-dsvg")', 'print');
await svgCheck('/tmp/log.svg', 'log 轴刻度（10 的幂）', { hasText: '100', minText: 6 });

console.log('--- boxes / stem ---');
await ev('clf; [nn,xx]=hist(randn(1,500),11); bar(xx,nn)', 'bar');
await ev('print("/tmp/bar.svg","-dsvg")', 'print');
await svgCheck('/tmp/bar.svg', 'bar 矩形', { minRect: 11 });
await ev("clf; stem(1:10,(1:10).^2)", 'stem');
await ev('print("/tmp/stem.svg","-dsvg")', 'print');
await svgCheck('/tmp/stem.svg', 'stem 竖线+点', { minLine: 10, minCircle: 10 });

console.log('--- xlim/ylim ---');
await ev("clf; plot(1:10); xlim([2 8]); ylim([0 12])", 'xlim/ylim');
await ev('print("/tmp/lim.svg","-dsvg")', 'print');
await svgCheck('/tmp/lim.svg', '显式限度生效', { hasText: '2', minText: 6 });

console.log('--- saveas ---');
await ev("clf; plot(1:3); saveas(1,'/tmp/sa.svg')", 'saveas → svg');
await ev('disp(exist("/tmp/sa.svg"))', 'saveas 落盘', '2');
await svgCheck('/tmp/sa.svg', 'saveas 产物', { minPolyline: 1 });

console.log('--- 无参数 / 省略 -dsvg（按扩展名）---');
await ev('clf; plot(1:4); print("/tmp/ext.svg")', '省略 -dsvg，靠扩展名');
await svgCheck('/tmp/ext.svg', '扩展名推断格式', { minPolyline: 1 });

console.log('--- 不支持的格式：清晰报错（不是 gs 那种困惑信息）---');
await evErr('clf; plot(1:3); print("/tmp/a.png","-dpng")', '★ -dpng 给出可操作报错', 'raster output');
await evErr('clf; plot(1:3); print("/tmp/a.png","-dpng")', '-dpng 建议改用 -dsvg', '-dsvg');
await evErr('clf; plot(1:3); print("/tmp/a.pdf","-dpdf")', '★ -dpdf 指出 Ghostscript 缺失', 'Ghostscript');
await evErr('clf; plot(1:3); print("/tmp/a.xyz","-dxyz")', '未知格式也报错', 'unknown output format');

console.log('--- 与 plot 桥其它功能共存（回归）---');
await ev("clf; t=(0:0.01:1)'; plot(t,t.^2); ylabel('y'); ylim([0 1])", 'plot 状态更新');
await ev('print("/tmp/co.svg","-dsvg"); disp(1)', 'print 后再 plot 仍正常');
await ev("clf; scatter(1:10,rand(1,10)); print('/tmp/sc.svg','-dsvg'); disp(exist('/tmp/sc.svg'))", 'scatter + print', '2');
await svgCheck('/tmp/sc.svg', 'scatter 产出点', { minCircle: 10 });

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
