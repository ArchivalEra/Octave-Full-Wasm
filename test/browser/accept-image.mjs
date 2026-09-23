// 批次 5 验收：R4 图像 I/O（stb_image 后端，经 imformats 注册进 imread/imwrite/imfinfo）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/accept-image.mjs [URL]
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

let pass = 0, fail = 0;
async function ev(expr, label, want) {
  logs.length = 0;
  let r;
  try {
    r = await page.evaluate(x => { const rc = window.Module.eval_string(x); return { rc, err: window.Module.last_error_message() }; }, expr);
  } catch (e) { console.log(`CRASH | ${label} :: ${String(e).slice(0, 120)}`); fail++; return; }
  await new Promise(rr => setTimeout(rr, 700));
  const out = [...logs].join(' ').replace(/\s+/g, ' ').trim().slice(0, 180);
  const ok = r.rc === 0 && (!want || out.includes(want));
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${out || ('rc=' + r.rc + ' ' + r.err.slice(0, 120))}`);
}

console.log('--- 加载前：无 magick，格式表为空 ---');
await ev('disp(numel(imformats()))', '未加载 → imformats 为空（magick 已关）', '0');
await ev('disp(exist("__web_imread__"))', '未加载 → stb 后端不在', '0');

console.log('--- 懒加载 webimage ---');
console.log('  已加载:', await page.evaluate(async () => {
  try { await window.OctaveAssets.load('webimage'); return window.OctaveAssets.loaded().join(' '); }
  catch (e) { return 'ERR ' + String(e).slice(0, 130); }
}));
await ev('disp(exist("__web_imread__"))', 'stb 后端已装载', '3');
await ev('disp(numel(imformats()))', '注册了 8 种格式', '8');
await ev('disp(imformats("png").coder)', 'imformats("png") 唯一命中', 'PNG');
await ev('disp(numel(imformats("png")))', '★ 不重复注册（返回 1 条）', '1');

console.log('--- PNG 无损往返 ---');
await ev('A=uint8(reshape(mod(0:255,256),16,16)); imwrite(A,"/tmp/t.png"); disp(exist("/tmp/t.png"))', 'imwrite 写 PNG', '2');
await ev('B=imread("/tmp/t.png"); disp(size(B))', 'imread 读回尺寸', '16 16');
await ev('disp(isequal(A,B))', '★ 灰度像素级一致', '1');
await ev('info=imfinfo("/tmp/t.png"); disp([info.Width info.Height info.NumberOfChannels])', 'imfinfo 元数据', '16 16 1');
await ev('C=uint8(randi([0 255],8,8,3)); imwrite(C,"/tmp/c.png"); D=imread("/tmp/c.png"); disp(isequal(C,D))', '★ 彩色三通道往返一致', '1');
await ev('disp(size(imread("/tmp/c.png")))', '彩色尺寸', '8 8 3');

console.log('--- 其它格式 ---');
await ev('imwrite(C,"/tmp/c.jpg"); E=imread("/tmp/c.jpg"); disp(size(E))', 'JPEG 有损往返', '8 8 3');
await ev('imwrite(C,"/tmp/c.bmp"); F=imread("/tmp/c.bmp"); disp(isequal(C,F))', '★ BMP 无损往返', '1');
await ev('imwrite(C,"/tmp/c.tga"); G=imread("/tmp/c.tga"); disp(isequal(C,G))', '★ TGA 无损往返', '1');

console.log('--- 与数值计算联动（典型教学用法）---');
await ev('I=imread("/tmp/t.png"); disp(double(max(I(:))))', '读回的图能参与运算', '255');
await ev('J=uint8(255-double(I)); imwrite(J,"/tmp/inv.png"); disp(isequal(double(imread("/tmp/inv.png")), double(J)))', '处理后写回也对', '1');

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
