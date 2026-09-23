// T7 验收：audiorecorder（19 个 __recorder_* 纯 .m + getUserMedia/MediaRecorder 桥）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/accept-t7-recorder.mjs [URL]
//
// 确定性：用 Chromium 的**假麦克风**（`--use-fake-device-for-media-stream` 给一路合成
// 音频，`--use-fake-ui-for-media-stream` 自动授予权限），所以不依赖真实硬件、不弹框。
// 权限三态里的"拒绝"与"没有安全上下文"两条用**注入**造：我们测的是"错误有没有被
// 如实报出来"，不是测浏览器会不会拒绝。
//
// ⚠️ 三条**实测**出来的边界（写在这里免得下次重走）：
//   1. **`pause()` 会完全阻塞浏览器事件循环**。精确测法：记录每个 tick 的时刻，只数
//      落在 eval 区间内的 —— `pause(1)` / `pause(2)` / `for k=1:10,pause(0.1)` 三种写法
//      区间内 tick **都是 0**。（早先只看"总 tick 数"的那次测量把 eval 前后的 tick 也
//      算进去了，据此得出过"pause 会让出主线程"，是**错的**。）
//   2. 于是**等待必须发生在 JS 侧**：`record(r,1)` 返回后 Octave 不再占用主线程，页面
//      才有机会调 getUserMedia / 采集 / 解码。测试因此用 JS 侧的 setTimeout 等，而不是
//      Octave 的 pause。这也正是真人用 REPL 的节奏：命令返回 → 页面自由 → 下条命令读数据。
//   3. 推论：**`recordblocking` 需要 Asyncify**（要等页面跑完，而 Octave 一阻塞页面就停），
//      本构建**如实报错**而不是静默降级；`uigetfile` 同病。
import { chromium } from 'playwright-core';

const TARGET = process.argv[2] || 'http://127.0.0.1:8761/';
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage',
         '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
         '--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext();
await context.grantPermissions(['microphone'], { origin: new URL(TARGET).origin }).catch(() => {});
const page = await context.newPage();
const logs = [];
page.on('console', m => logs.push(m.text().slice(0, 700)));
page.on('pageerror', e => logs.push('[pageerror] ' + String(e).slice(0, 400)));
await page.goto(TARGET, { waitUntil: 'load', timeout: 240000 });
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
console.log(`URL=${TARGET} ready=${((Date.now() - t) / 1000).toFixed(1)}s`);
console.log(`录音桥: ${await page.evaluate(() => typeof window.OctaveRec)}`);
await page.evaluate(async () => {
  if (!window.OctaveAssets) return;
  for (let i = 0; i < 100; i++) {
    if (window.OctaveAssets.loaded().length >= 7) return;
    await new Promise(r => setTimeout(r, 200));
  }
}).catch(() => {});
logs.length = 0;

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

async function ev (label, expr, want) {
  logs.length = 0;
  let r;
  try {
    r = await page.evaluate(x => { const rc = window.Module.eval_string(x); return { rc, err: window.Module.last_error_message() }; }, expr);
  } catch (e) { console.log(`CRASH | ${label} :: ${String(e).slice(0, 130)}`); fail++; return; }
  await new Promise(rr => setTimeout(rr, 400));
  const full = [...logs].join(' ').replace(/\s+/g, ' ').trim();
  const out = full.slice(0, 220);      // ★ 只用于显示；匹配必须用 full（不许先截断再匹配）
  const ok = r.rc === 0 && (!want || wantHit(full, want));
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${out || ('rc=' + r.rc + ' ' + r.err.slice(0, 160))}`);
}
async function evErr (label, expr, want) {
  logs.length = 0;
  let r;
  try {
    r = await page.evaluate(x => { const rc = window.Module.eval_string(x); return { rc, err: window.Module.last_error_message() }; }, expr);
  } catch (e) { console.log(`CRASH | ${label} :: ${String(e).slice(0, 130)}`); fail++; return; }
  await new Promise(rr => setTimeout(rr, 400));
  const full = [...logs].join(' ').replace(/\s+/g, ' ').trim();
  const out = full.slice(0, 520);      // ★ 只用于显示；匹配必须用 full
  const ok = r.rc !== 0 && wantHit(full, want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${out || ('rc=' + r.rc + ' ' + r.err.slice(0, 160))}`);
}
// **JS 侧**等页面把这一轮录音跑完（不能用 Octave 的 pause：那会把页面冻住，见文件头）
async function waitRecDone (label) {
  const r = await page.evaluate(async () => {
    const busyStates = ['idle', 'recording', 'paused', 'decoding'];
    const busy = () => Object.values(window.OctaveRec.status().recordings).some(x => busyStates.includes(x.state));
    for (let i = 0; i < 120; i++) {
      if (!busy()) return { ok: true, n: i, status: window.OctaveRec.status() };
      await new Promise(rr => setTimeout(rr, 150));
    }
    return { ok: false, status: window.OctaveRec.status() };
  });
  r.ok ? pass++ : fail++;
  console.log(`${r.ok ? 'PASS' : 'fail'} | ${label} :: ${JSON.stringify(r.status).slice(0, 240)}`);
}

console.log('--- 懒加载前：recorder 符号不存在（这就是改动前的报错来源）---');
await ev('未加载 → __recorder_record__ 不存在', 'disp(exist("__recorder_record__"))', '0');
await evErr('未加载 → 构造即报 undefined', 'r0=audiorecorder(8000,8,1)', "'__recorder_audiorecorder__' undefined");

console.log('--- 懒加载 webaudiorec（+ webaudio 提供 audiodevinfo）---');
await page.evaluate(async () => {
  await window.OctaveAssets.load('webaudio');
  await window.OctaveAssets.load('webaudiorec');
});
logs.length = 0;
await ev('加载后 → 19 个 __recorder_* 全部就位',
  'nn=0; for f={"audiorecorder","getaudiodata","get_channels","get_fs","get_id","get_nbits","get_sample_number","get_tag","get_total_samples","get_userdata","isrecording","pause","recordblocking","record","resume","set_fs","set_tag","set_userdata","stop"}; nn=nn+min(exist(["__recorder_" f{1} "__"]),1); endfor; disp(num2str(nn))', '19');
await ev('which 指向 webaudiorec 资产', 'disp(!isempty(strfind(which("__recorder_record__"), "webaudiorec")))', '1');
await ev('audiorecorder 现在可以构造', 'disp(num2str(exist("audiorecorder")))', '2');

console.log('--- 构造与属性（@audiorecorder 的 10 个属性全部走我们的 getter）---');
await ev('audiorecorder(8000,8,1) 属性正确',
  'r=audiorecorder(8000,8,1); disp([num2str(get(r,"SampleRate")) " " num2str(get(r,"BitsPerSample")) " " num2str(get(r,"NumberOfChannels"))])', '8000 8 1');
await ev('Type', 'disp(get(r,"Type"))', 'audiorecorder');
await ev('默认参数 = 8000/8/1',
  'rd=audiorecorder(); disp([num2str(get(rd,"SampleRate")) " " num2str(get(rd,"BitsPerSample")) " " num2str(get(rd,"NumberOfChannels"))])', '8000 8 1');
await ev('未开始录时 Running=off', 'disp(get(r,"Running"))', 'off');
await ev('Tag/UserData 可写可读', 'set(r,"Tag","t1"); set(r,"UserData",[1 2 3]); disp([get(r,"Tag") " " num2str(get(r,"UserData"))])', 't1 1 2 3');

console.log('--- ① record/stop/getaudiodata（非阻塞；数据由页面写回 MEMFS）---');
await ev('★record(r,1) 后 Running=on', 'record(r,1); disp(get(r,"Running"))', 'on');
await waitRecDone('页面跑完（1 秒录音 + 解码）');
await ev('★getaudiodata 非空且是单声道', 'd=getaudiodata(r); disp([num2str(rows(d)) "x" num2str(columns(d))])', 'x1');
await ev('★数据不是全零（假麦克风有信号）', 'd=getaudiodata(r); disp(num2str(max(abs(d))>0))', '1');
await ev('样本数在合理量级（8000Hz 录约 1 秒 → 约 8000 帧）',
  'd=getaudiodata(r); disp(num2str(rows(d)>6000 && rows(d)<10000))', '1');
await ev('TotalSamples 与数据长度一致', 'd=getaudiodata(r); disp(num2str(abs(get(r,"TotalSamples")-rows(d))<2))', '1');
await ev('跑完后 Running=off', 'disp(get(r,"Running"))', 'off');

console.log('--- ② 开区间 record + stop ---');
await ev('record(r2) 开录（无限时长）', 'r2=audiorecorder(8000,8,1); record(r2); disp(get(r2,"Running"))', 'on');
await page.evaluate(() => new Promise(r => setTimeout(r, 1200)));
await ev('stop(r2)', 'stop(r2); disp("stopped")', 'stopped');
await waitRecDone('停止后页面收尾');
await ev('stop 之后拿到数据（非空、秒数也够）',
  'd2=getaudiodata(r2); disp([num2str(rows(d2)>8000) "x" num2str(columns(d2))])', '1x1');

console.log('--- ③ recordblocking：**需要 Asyncify，本构建如实报错**（不静默降级）---');
await evErr('★recordblocking 报明确错误', 'r3=audiorecorder(8000,8,1); recordblocking(r3,1)', 'recordblocking is not available in this build');
await evErr('错误里点明需要 Asyncify', 'recordblocking(r3,1)', 'needs Asyncify');
await evErr('错误里给出替代用法', 'recordblocking(r3,1)', 'Use record (r, len)');

// 实测：Chromium 的假设备给的是**双声道**（actualChans=2），不是单声道 —— 别照抄
// "假设备只有一路"这种想当然。写请求数 2 时它就用真的两路。
console.log('--- ④ 立体声请求（请求 2 声道）---');
await ev('audiorecorder(8000,16,2) 构造与属性',
  'rs=audiorecorder(8000,16,2); disp([num2str(get(rs,"SampleRate")) " " num2str(get(rs,"NumberOfChannels"))])', '8000 2');
await ev('record(rs,1)', 'record(rs,1); disp("rec")', 'rec');
await waitRecDone('立体声这一轮跑完');
await ev('形状 = N×2', 'ds=getaudiodata(rs); disp([num2str(rows(ds)>0) "x" num2str(columns(ds))])', '1x2');
// 实测：Chromium 的假设备给的是**双声道**（actualChans=2），所以两声道内容不同是正常的；
// "复制补齐"只在源声道数**少于**请求数时才发生。这里断言的是一般性质。
await ev('两声道都有信号', 'disp(num2str(all(max(abs(ds))>0)))', '1');
await ev('数据有限（没出 NaN/Inf）', 'disp(num2str(all(isfinite(ds(:)))))', '1');

console.log('--- ⑤ 权限被拒 → 明确报错（不返回 undefined，也不假装有麦克风）---');
await page.evaluate(() => {
  const real = navigator.mediaDevices;
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    get: () => ({ getUserMedia: () => Promise.reject(Object.assign(new Error('stub denied'), { name: 'NotAllowedError' })) }),
  });
  window.__restore1 = () => Object.defineProperty(navigator, 'mediaDevices', { configurable: true, get: () => real });
});
await ev('注入"拒绝"后录音', 'rden=audiorecorder(8000,8,1); record(rden,1); disp("queued")', 'queued');
await waitRecDone('被拒这一轮收尾');
await evErr('★被拒时 getaudiodata 报明确错误', 'getaudiodata(rden)', 'microphone access was denied');
await evErr('错误里带页面的原文', 'getaudiodata(rden)', 'NotAllowedError');
await page.evaluate(() => window.__restore1 && window.__restore1());

console.log('--- ⑥ 没有安全上下文 → 明确报错 ---');
await page.evaluate(() => {
  const real = navigator.mediaDevices;
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, get: () => undefined });
  window.__restore2 = () => Object.defineProperty(navigator, 'mediaDevices', { configurable: true, get: () => real });
});
await ev('注入"无 mediaDevices"后录音', 'rins=audiorecorder(8000,8,1); record(rins,1); disp("queued")', 'queued');
await waitRecDone('无安全上下文这一轮收尾');
await evErr('★无安全上下文时清晰报错', 'getaudiodata(rins)', 'secure context');
await page.evaluate(() => window.__restore2 && window.__restore2());

console.log('--- 回归护栏 ---');
await ev('audioplayer 播放侧不回归', 'p=audioplayer(sin(2*pi*440*(0:999)/8000),8000); disp(num2str(p.SampleRate))', '8000');
await ev('audiodevinfo 仍可用（T6）', 'disp(num2str(audiodevinfo(1)))', '1');
await ev('无整页 trap（还能继续 eval）', 'disp("alive")', 'alive');

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
