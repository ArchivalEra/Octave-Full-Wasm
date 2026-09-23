// MEMFS 队列的**漂移测试**：生产侧写出的行，读侧必须解析出同样的东西
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：harness/run.sh test/browser/accept-queue-drift.mjs [URL]
//
// ── 为什么有这一套（2026-09-23 胶水层审计候选 2）─────────────────────────────
// 本构建的宿主桥只有一条通道：Octave 往 MEMFS 文件里追加一行，页面读走并清空。
// 这套形状被抄了四遍，而**没有任何一处声明过行格式** —— 生产侧（`.m`/`.cc`）与读侧
// （`bridge/*.js`）各自把格式写在注释里，于是漂移是静默的，而且已经发生两次：
//   · `/tmp/pra_*` 的 `actualChans` **写了没人解析**（本轮改成明确不写）
//   · `/tmp/pba_*` 同一行格式两处注释说法不一致（本轮统一）
//
// 修法不是上生成器（那会把每种协议的字节布局从它的生产者旁边搬走 = 拿 locality 换行数），
// 而是**让两侧在同一断言里相遇**：从 Octave 侧用**真的生产函数**入队一条规范行，
// 再用页面侧**真的解析函数**去读它，比对字段。
// 于是"换个字段名"这种改动会让这条测试红，而不是安静地少一个值。
//
// ── 覆盖口径（如实）────────────────────────────────────────────────────────
//   · pba（音频播放）✅ 两个动作：play 与 resume（resume 就是本轮修过 bug 的那个形状）
//   · pra（录音）    ✅ record
//   · ufp（文件选择）✅ 走**真的 C++ 生产者** `__fltk_uigetfile__`（两边是两种语言，最该测）
//   · webnet        ⭕ 它不是"行 + 制表符"，而是四个单值文件 ⇒ 这里只断言页面侧声明的
//                      路径名；它的行为由 `accept-net` 30 项端到端覆盖（两边路径不一致时
//                      同步 XHR 会直接失败）。
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8768/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext()).newPage();
const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(ok, label, detail) {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label.padEnd(48)} :: ${detail ?? ''}`);
}
async function ev(code, wait = 400) {
  logs.length = 0;
  let rc = 'TRAP';
  try { rc = await page.evaluate(x => window.Module.eval_string(x), code); } catch (e) { rc = 'TRAP'; }
  await sleep(wait);
  return { rc, out: logs.join(' ').replace(/\s+/g, ' ').trim() };
}
// 从 Octave 侧入队一条规范行 → 用**页面侧的真解析函数**读回来
async function roundTrip(enqueueExpr, parseFn) {
  await page.evaluate(() => {
    try { window.Module.FS.writeFile('/tmp/pba_queue.txt', new Uint8Array(0)); } catch (e) {}
    try { window.Module.FS.writeFile('/tmp/pra_queue.txt', new Uint8Array(0)); } catch (e) {}
    try { window.Module.FS.writeFile('/tmp/ufp_queue.txt', new Uint8Array(0)); } catch (e) {}
  });
  await ev(enqueueExpr, 120);
  return await page.evaluate((fn) => {
    const M = window.Module;
    const read = (p) => { try { return new TextDecoder().decode(M.FS.readFile(p)); } catch (e) { return ''; } };
    const q = read('/tmp/pba_queue.txt') || read('/tmp/pra_queue.txt') || read('/tmp/ufp_queue.txt');
    const line = q.split('\n').filter(Boolean)[0] || '';
    const api = { pba: window.OctaveAudio, pra: window.OctaveRec, ufp: window.OctaveFilePick }[fn];
    if (!api || !api._parseLine) return { error: fn + ' 没暴露 _parseLine' };
    return { line: line, parsed: api._parseLine(line), raw: q };
  }, parseFn);
}

console.log(`URL=${URL}`);
await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
for (let i = 0; i < 300; i++) {
  const ok = await page.evaluate(() => window.__octaveReady === true).catch(() => false);
  if (ok) break; await sleep(500);
}
await sleep(500);

// 前提：共享 primitive 在，而且四个桥都用了它
check(await page.evaluate(() => !!(window.OctaveQueue && window.OctaveQueue.drain)), '★ window.OctaveQueue 存在（共享 primitive）', 'ok');
check(await page.evaluate(() => typeof window.OctaveAudio._parseLine === 'function' &&
  typeof window.OctaveRec._parseLine === 'function' && typeof window.OctaveFilePick._parseLine === 'function'),
  '★ 三个桥都暴露了行格式的解析函数（声明可执行）', 'ok');

// ⚠️ **先停掉页面自己的轮询器**：否则它们会在 250ms 内把队列读走并清空，
//    于是本套件读到的是空行（第一版就是这么假的）。这里要的是"生产侧写出的原始字节"，
//    所以把 drain 关掉再读 —— 这不改变被测代码，只是拿掉另一个消费者。
const stopped = await page.evaluate(() => {
  const n = [];
  for (const k of ['OctaveAudio', 'OctaveRec', 'OctaveFilePick']) {
    const st = window[k] && window[k]._state;
    if (st && st.pollTimer) { clearInterval(st.pollTimer); st.pollTimer = null; n.push(k); }
  }
  return n;
});
check(stopped.length === 3, '★ 已暂停页面侧轮询器（否则队列会被抢先读走）', stopped.join('/'));
console.log(`  （webnet: typeof window.OctaveNet = ${typeof (await page.evaluate(() => window.OctaveNet))}）`);

for (const a of ['webaudio', 'webaudiorec', '__fltk_uigetfile__']) {
  const r = await page.evaluate(async (n) => {
    try { await window.OctaveAssets.load(n); return 'ok'; } catch (e) { return 'ERR ' + String(e); }
  }, a);
  check(r === 'ok', `★ 资产 ${a} 装载`, r);
}

// ── pba：play（4 个参数）────────────────────────────────────────────────────
let r = await roundTrip('__pba_enqueue__(1, "play", 0, 8000, 44100, 2)', 'pba');
check(r.parsed && r.parsed.id === 1 && r.parsed.action === 'play' &&
  JSON.stringify(r.parsed.args) === '[0,8000,44100,2]',
  '★ pba/play：生产行与读侧解析一致', `${JSON.stringify(r.parsed)} ← ${JSON.stringify(r.line)}`);

// ── pba：resume（本轮修过的形状：必须带 to/rate/nch）────────────────────────
r = await roundTrip('__pba_enqueue__(1, "resume", 3, 0, 44100, 2)', 'pba');
check(r.parsed && r.parsed.action === 'resume' && JSON.stringify(r.parsed.args) === '[3,0,44100,2]',
  '★ pba/resume：采样率与通道数在行里（resume bug 的护栏）', `${JSON.stringify(r.parsed)}`);

// ── pra：record ────────────────────────────────────────────────────────────
r = await roundTrip('__pra_enqueue__(2, "record", 8000, 16, 2, 3)', 'pra');
check(r.parsed && r.parsed.id === 2 && r.parsed.action === 'record' &&
  JSON.stringify(r.parsed.args) === '[8000,16,2,3]',
  '★ pra/record：生产行与读侧解析一致', `${JSON.stringify(r.parsed)}`);

// ── ufp：走**真的 C++ 生产者**（两种语言之间最该测的一条）────────────────────
// `__fltk_uigetfile__` 的 pending 分支会明确报错（"选好后再跑一次"），这里只要它写出请求行
await page.evaluate(() => {
  try { window.Module.FS.writeFile('/tmp/ufp_queue.txt', new Uint8Array(0)); } catch (e) {}
});
r = await roundTrip('try, __fltk_uigetfile__("*.m"); catch, end', 'ufp');
check(r.parsed && r.parsed.accept === '*.m' && r.parsed.multiple === false &&
  typeof r.parsed.title === 'string' && r.parsed.title.length > 0,
  '★ ufp：C++ 写出的请求行能被 JS 读侧解析（跨语言）',
  `${JSON.stringify(r.parsed)} ← ${JSON.stringify(r.line)}`);

// ── webnet：不是行协议，只钉页面侧声明的四个路径名 ────────────────────────────
const paths = await page.evaluate(() => window.OctaveNet && window.OctaveNet._paths);
check(paths && paths.LAST === '/tmp/webnet_last' && paths.STATUS === '/tmp/webnet_status' &&
  paths.ERROR === '/tmp/webnet_error' && paths.CTYPE === '/tmp/webnet_ctype',
  '★ webnet：页面侧声明的四个路径与 C++ 侧一致（行为由 accept-net 覆盖）',
  JSON.stringify(paths));

// 收尾：把测试造的请求清掉，别让页面轮询真的去播/去录
await ev('fid=fopen("/tmp/pba_queue.txt","w"); fclose(fid); fid=fopen("/tmp/pra_queue.txt","w"); fclose(fid); fid=fopen("/tmp/ufp_queue.txt","w"); fclose(fid); disp("cleared")', 300);
check(!/\[pageerror\]|RuntimeError: unreachable/.test(logs.join(' ')), '无整页 trap', 'ok');

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
