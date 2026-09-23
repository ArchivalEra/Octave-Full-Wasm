// T6 验收：audiodevinfo 最小 shim + doc 的浏览器实现 + 输出落点（DOM 镜像）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/accept-t6-audio-doc.mjs [URL]
//
// 这一套验三件（都属"非图形"收尾）：
//   ① audiodevinfo shim（缺口 B2）：语义照抄官方 audiodevinfo.cc 的分支。
//      关键点：`audiodevinfo(io)` 返回的是**设备个数**，不是结构体数组。
//   ② doc 的浏览器实现（缺口 D2a）：官方 doc.m 末路是起 info 浏览器进程
//      （两次 system()），本构建无 shell → 覆写成"取文本并显示"。
//   ③ 输出落点：上游骨架的 <pre id="output"> **从来没人往里写**（实测 disp 之后
//      body.innerText 仍是空串），所以 ② 的"显示到页面"原本无处可显示。
//      断言 DOM 里真的出现了文档正文 —— 这是"可读"这条验收的硬证据。
//
// 注意：能力大多走**懒加载车道**，所以先断言"未加载时不存在"，再装，再断言。
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text().slice(0, 400)));
page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 400)));
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

// 等 index.html 的启动装载清单落定（内含 webdoc），再清日志窗口
await page.evaluate(async () => {
  if (!window.OctaveAssets) return;
  for (let i = 0; i < 150; i++) {
    const l = window.OctaveAssets.loaded();
    if (l.includes('webdoc') && l.includes('webgraphics')) return;
    await new Promise(r => setTimeout(r, 200));
  }
}).catch(() => {});
logs.length = 0;

let pass = 0, fail = 0;
// 期望成功：rc==0 且输出含 want
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

async function ev (label, expr, want) {
  logs.length = 0;
  let r;
  try {
    r = await page.evaluate(x => { const rc = window.Module.eval_string(x); return { rc, err: window.Module.last_error_message() }; }, expr);
  } catch (e) { console.log(`CRASH | ${label} :: ${String(e).slice(0, 130)}`); fail++; return; }
  await new Promise(rr => setTimeout(rr, 500));
  const full = [...logs].join(' ').replace(/\s+/g, ' ').trim();
  const out = full.slice(0, 200);      // ★ 只用于显示；匹配必须用 full（不许先截断再匹配）
  const ok = r.rc === 0 && (!want || wantHit(full, want));
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${out || ('rc=' + r.rc + ' ' + r.err.slice(0, 150))}`);
}
// 期望失败：rc!=0 且错误信息含 want（用于"清晰报错"类断言）
async function evErr (label, expr, want) {
  logs.length = 0;
  let r;
  try {
    r = await page.evaluate(x => { const rc = window.Module.eval_string(x); return { rc, err: window.Module.last_error_message() }; }, expr);
  } catch (e) { console.log(`CRASH | ${label} :: ${String(e).slice(0, 130)}`); fail++; return; }
  await new Promise(rr => setTimeout(rr, 500));
  const full = [...logs].join(' ').replace(/\s+/g, ' ').trim();
  const out = full.slice(0, 200);      // ★ 只用于显示；匹配必须用 full
  const ok = r.rc !== 0 && wantHit(full, want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${out || ('rc=' + r.rc + ' ' + r.err.slice(0, 150))}`);
}

console.log('--- ① audiodevinfo：懒加载前不存在 ---');
await ev('未加载 → audiodevinfo 不存在', 'disp(exist("audiodevinfo"))', '0');

console.log('--- 懒加载 webaudio（含 T6 的 audiodevinfo）---');
await page.evaluate(async () => { await window.OctaveAssets.load('webaudio'); });
logs.length = 0;
await ev('加载后 → exist = 2', 'disp(exist("audiodevinfo"))', '2');
await ev('which 指向 webaudio 资产', 'disp(!isempty(strfind(which("audiodevinfo"), "webaudio")))', '1');

console.log('--- ① 语义：结构体与计数（官方 API 的两个易错点）---');
await ev('audiodevinfo() 有 input/output', 's=audiodevinfo(); disp([num2str(isfield(s,"input")) num2str(isfield(s,"output"))])', '11');
await ev('output.Name', 's=audiodevinfo(); disp(s.output.Name)', 'Browser default output');
await ev('output.DriverVersion', 's=audiodevinfo(); disp(s.output.DriverVersion)', 'Web Audio');
await ev('input.Name', 's=audiodevinfo(); disp(s.input.Name)', 'Browser microphone');
await ev('input.DriverVersion', 's=audiodevinfo(); disp(s.input.DriverVersion)', 'Web MediaDevices');
await ev('output.ID = 0', 's=audiodevinfo(); disp(num2str(s.output.ID))', '0');
await ev('★audiodevinfo(0) 是**个数**=1', 'disp(num2str(audiodevinfo(0)))', '1');
await ev('★audiodevinfo(1) 是**个数**=1', 'disp(num2str(audiodevinfo(1)))', '1');
await ev('名字 → ID', 'disp(num2str(audiodevinfo(0,"Browser default output")))', '0');
await ev('ID → 名字', 'disp(audiodevinfo(0,0))', 'Browser default output');
await ev('DriverVersion 查询', 'disp(audiodevinfo(1,0,"DriverVersion"))', 'Web MediaDevices');
await ev('(io,rate,bits,chans) 支持 → 0', 'disp(num2str(audiodevinfo(0,48000,16,2)))', '0');
await ev('(io,rate,bits,chans) 不支持 → -1', 'disp(num2str(audiodevinfo(0,12345,16,2)))', '-1');
await ev('(io,id,rate,bits,chans) 支持 → true', 'disp(num2str(audiodevinfo(0,0,44100,16,2)))', '1');
await ev('(io,id,rate,bits,chans) 不支持 → false', 'disp(num2str(audiodevinfo(0,0,12345,16,2)))', '0');

console.log('--- ① 清晰报错（宁可报错，不要静默错值）---');
await evErr('io=2 → 官方那句报错', 'audiodevinfo(2)', 'specify 0 for output and 1 for input devices');
await evErr('不存在的设备 → 报错', 'audiodevinfo(0,123)', 'no device found for the specified criteria');
await evErr('第三参数只认 DriverVersion', 'audiodevinfo(0,0,"Name")', 'third argument must be');
await evErr('错误的名字 → 报错', 'audiodevinfo(0,"no such device")', 'no device found');

console.log('--- ② doc：加载后由 webdoc 接管 ---');
await ev('which("doc") 指向 webdoc 资产', 'disp(!isempty(strfind(which("doc"), "webdoc")))', '1');
await ev('doc sin 取到官方文档', 'doc("sin"); ', 'sine');
await ev('doc sqrt 取到官方文档', 'doc("sqrt"); ', 'square root');
await evErr('doc 无参 → 清晰报错', 'doc()', 'exactly one NAME is required');
await evErr('doc 传数字 → 清晰报错', 'doc(42)', 'NAME must be a string');

console.log('--- ③ 输出落点：正文真的出现在页面 DOM 里 ---');
const dom = await page.evaluate(() => {
  const el = document.getElementById('output');
  return el ? el.textContent : '';
});
const domHasSin = /sine/i.test(dom);
domHasSin ? pass++ : fail++;
console.log(`${domHasSin ? 'PASS' : 'fail'} | DOM #output 含文档正文（${dom.length} 字符） :: ${JSON.stringify(dom.replace(/\s+/g, ' ').slice(-160))}`);

console.log('--- 回归护栏（不许因为覆写 doc 而破坏 help）---');
await ev('help sin 仍可用', 'h=help("sin"); disp(!isempty(strfind(h,"sine")))', '1');
await ev('没有自研渲染器残留', 'disp(exist("__tf_texinfo_to_plain__"))', '0');
await ev('__makeinfo__ 仍是官方文件', 'disp(!isempty(strfind(which("__makeinfo__"), "m/help/__makeinfo__.m")))', '1');
await ev('lookfor 仍可用', 'disp(!isempty(lookfor("sine")))', '1');
await ev('audioplayer 不回归', 'p=audioplayer(sin(2*pi*440*(0:999)/8000),8000); disp(p.SampleRate)', '8000');

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
