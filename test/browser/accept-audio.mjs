// 批次 8 验收：R8 WebAudio 播放侧（18 个 __player_* 纯 .m + AudioBufferSourceNode 桥）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用法：/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/accept-audio.mjs [URL]
//
// 现实边界（如实）：浏览器 autoplay 策略要求用户手势才能出声，无头浏览器靠
// --autoplay-policy=no-user-gesture-required 绕过。因此本套件断言的是
// "无错 + 状态正确 + 真的建了 AudioContext 并调度了等长 buffer"，
// 不试图验证"耳朵听到了声音"。
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://127.0.0.1:8761/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage',
         '--autoplay-policy=no-user-gesture-required'] });
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
console.log(`URL=${URL} ready=${((Date.now() - t) / 1000).toFixed(1)}s`);
console.log(`OctaveAudio 桥: ${await page.evaluate(() => typeof window.OctaveAudio)}`);

let pass = 0, fail = 0;
async function ev(expr, label, want) {
  logs.length = 0;
  let r;
  try {
    r = await page.evaluate(x => { const rc = window.Module.eval_string(x); return { rc, err: window.Module.last_error_message() }; }, expr);
  } catch (e) { console.log(`CRASH | ${label} :: ${String(e).slice(0, 120)}`); fail++; return; }
  await new Promise(rr => setTimeout(rr, 550));
  const out = [...logs].join(' ').replace(/\s+/g, ' ').trim().slice(0, 190);
  const ok = r.rc === 0 && (!want || out.includes(want));
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'fail'} | ${label} :: ${out || ('rc=' + r.rc + ' ' + r.err.slice(0, 140))}`);
}

console.log('--- 懒加载前：符号不在 ---');
await ev('disp(exist("__player_audioplayer__"))', '未加载 → 构造器不存在', '0');
await ev('disp(exist("__player_play__"))', '未加载 → play 不存在', '0');

console.log('--- 懒加载 webaudio ---');
console.log('  已加载:', await page.evaluate(async () => {
  try { await window.OctaveAssets.load('webaudio'); return window.OctaveAssets.loaded().slice(-3).join(' '); }
  catch (e) { return 'ERR ' + String(e).slice(0, 130); }
}));
await ev('disp(exist("__player_audioplayer__"))', '★ 构造器已装载', '2');
await ev('disp(which("__player_play__"))', 'play 来自资产目录', 'webaudio');
await ev('n=0; s={"__player_audioplayer__","__player_get_channels__","__player_get_fs__","__player_get_id__","__player_get_nbits__","__player_get_sample_number__","__player_get_tag__","__player_get_total_samples__","__player_get_userdata__","__player_isplaying__","__player_pause__","__player_playblocking__","__player_play__","__player_resume__","__player_set_fs__","__player_set_tag__","__player_set_userdata__","__player_stop__"}; for k=1:numel(s), n += (exist(s{k})>0); endfor; disp(n)', '★ 18 个 __player_* 全部在', '18');

console.log('--- 构造与属性 ---');
await ev('y=sin(2*pi*440*(0:7999)/8000); p=audioplayer(y,8000); disp(class(p))', 'audioplayer(y,8000)', 'audioplayer');
await ev('disp(p.SampleRate)', 'SampleRate', '8000');
await ev('disp(p.TotalSamples)', 'TotalSamples', '8000');
await ev('disp(p.NumberOfChannels)', 'NumberOfChannels', '1');
await ev('disp(p.BitsPerSample)', 'BitsPerSample', '16');
await ev('disp(p.Running)', '初始 Running=off', 'off');
await ev('disp(p.Type)', 'Type', 'audioplayer');
await ev('disp(isempty(p.Tag) && isempty(p.UserData))', 'Tag/UserData 初始为空', '1');
await ev('disp(isfield(get(p), "SampleRate"))', 'get(p) 返回属性结构体', '1');

console.log('--- 立体声与多 player ---');
await ev("ys=[sin(2*pi*440*(0:7999)/8000); sin(2*pi*660*(0:7999)/8000)]'; q=audioplayer(ys,44100); disp(q.NumberOfChannels)", '★ 立体声 2 通道', '2');
await ev('disp(q.SampleRate)', '立体声采样率', '44100');
await ev("d=dir('/tmp/pba_*.f64'); disp(d(end).bytes)", '★ 样本文件落盘（2ch×8000×8B）', '128000');
await ev('r=audioplayer(sin(1:4000), 8000); disp(r.TotalSamples)', '第三个 player 独立', '4000');

console.log('--- 播放状态机 ---');
// 状态机用 10 秒素材：否则几次 eval 的间隔（各 550ms）就足够让 1 秒的音频播完，
// isplaying 会（正确地）返回 0，测的就不是暂停/恢复而是"播完了"。
await ev('lp=audioplayer(sin(2*pi*220*(0:79999)/8000), 8000); disp(floor(lp.TotalSamples/8000))', '10 秒素材就绪', '10');
await ev('fid=fopen("/tmp/pba_queue.txt","w"); fclose(fid); play(p); fid=fopen("/tmp/pba_queue.txt"); L=fgetl(fid); fclose(fid); s=strsplit(L,char(9)); disp([str2double(s{3}) str2double(s{4}) str2double(s{5}) str2double(s{6})])', '★ 队列含 起止/采样率/通道数', '0 8000 8000 1');
await ev('disp(p.Running)', '★ play 后 Running=on', 'on');
// 用 10 秒素材测 isplaying：1 秒素材在若干次 eval（各 550ms）之后已经播完，
// 那时 isplaying 返回 0 是正确行为，不是缺陷。
await ev('play(lp); disp(isplaying(lp))', '★ isplaying 为真（长素材）', '1');
await ev('play(lp); pause(lp); disp(isplaying(lp))', '★ pause 后不再 isplaying', '0');
await ev('id=__pba_id__(struct(lp).player); disp(__pba_get__(id,"Running"))', '内部状态 paused', 'paused');
await ev('resume(lp); disp(isplaying(lp))', '★ resume 后恢复 isplaying', '1');
await ev('stop(lp); disp(lp.CurrentSample)', 'stop 后归零', '0');
await ev('disp(isplaying(lp))', 'stop 后不 isplaying', '0');
await ev('disp(isempty(__pba_get__(__pba_id__(struct(lp).player),"StartTime")))', 'stop 清掉调度区间', '1');

console.log('--- play 的范围参数 ---');
await ev('fid=fopen("/tmp/pba_queue.txt","w"); fclose(fid); play(p, 100); fid=fopen("/tmp/pba_queue.txt"); L=fgetl(fid); fclose(fid); s=strsplit(L,char(9)); disp(str2double(s{3}))', '★ play(p,start) 起点生效', '100');
await ev('fid=fopen("/tmp/pba_queue.txt","w"); fclose(fid); play(p, [10 100]); fid=fopen("/tmp/pba_queue.txt"); L=fgetl(fid); fclose(fid); s=strsplit(L,char(9)); disp([str2double(s{3}) str2double(s{4})])', '★ play(p,[s e]) 两端生效', '10 100');

console.log('--- 属性读写 ---');
await ev('p.Tag="mytag"; disp(p.Tag)', 'set/get Tag', 'mytag');
await ev('p.UserData=magic(2); disp(numel(p.UserData))', 'set/get UserData', '4');
await ev('set(p,"Tag","x2"); disp(get(p,"Tag"))', 'set()/get() 函数形式', 'x2');
await ev('disp(numel(fieldnames(set(p))))', 'set(p) 列出 3 个可写属性', '3');
await ev('disp(class(p))', '写属性后仍是 audioplayer', 'audioplayer');

console.log('--- sound() 与 playblocking ---');
await ev('t0=tic; sound(sin(2*pi*440*(0:1599)/8000), 8000); el=toc(t0); disp(el>0.15)', '★ sound() 阻塞了约 0.2s', '1');
await ev('disp(which("sound"))', 'sound 仍是核心 .m', 'audio/sound.m');
await ev('p2=audioplayer(sin(1:8000), 8000); playblocking(p2); disp(p2.Running)', '★ playblocking 后状态回 off', 'off');

console.log('--- 页面侧：真实 AudioContext ---');
// 停掉 init() 起的 250ms 轮询：本套件要精确控制"什么时候 drain"，
// 否则后台轮询会在断言之前把队列消费掉（表现为节点表忽空忽满）。
await page.evaluate(() => { clearInterval(window.OctaveAudio._state.pollTimer); window.OctaveAudio._state.pollTimer = null; });
await ev('play(p); disp(1)', '排一次播放');
const d1 = await page.evaluate(async () => {
  const r = await window.OctaveAudio.drain();
  return { r, st: window.OctaveAudio.status() };
});
console.log(`  drain: ${JSON.stringify(d1.r)}`);
let ok = d1.st.contexts === 1 && d1.st.state === 'running';
ok ? pass++ : fail++;
console.log(`${ok ? 'PASS' : 'fail'} | ★ AudioContext 已创建且 running :: state=${d1.st.state}`);
ok = d1.st.playing.length >= 1;
ok ? pass++ : fail++;
console.log(`${ok ? 'PASS' : 'fail'} | ★ 有 buffer 正在播放 :: [${d1.st.playing.join(',')}]`);
ok = !d1.st.lastError;
ok ? pass++ : fail++;
console.log(`${ok ? 'PASS' : 'fail'} | 无调度错误 :: ${d1.st.lastError || 'none'}`);

// buffer 长度必须等于请求的样本数（真去读了 .f64 并重建了 AudioBuffer）
const len = await page.evaluate(() => {
  const S = window.OctaveAudio._state;
  for (const [, e] of S.nodes) return { dur: e.src.buffer.duration, rate: e.src.buffer.sampleRate, ch: e.src.buffer.numberOfChannels, len: e.src.buffer.length };
  return null;
});
if (len) {
  const good = Math.abs(len.dur - 1.0) < 0.01 && len.ch === 1;
  good ? pass++ : fail++;
  console.log(`${good ? 'PASS' : 'fail'} | ★ AudioBuffer 时长 1.0s / 1 通道 :: dur=${len.dur.toFixed(3)} ch=${len.ch} len=${len.len} rate=${len.rate}`);
} else { console.log('fail | 读不到 AudioBuffer'); fail++; }

// stop 必须真的让节点停下来
await ev('stop(p); disp(1)', 'stop');
const d2 = await page.evaluate(async () => { await window.OctaveAudio.drain(); return window.OctaveAudio.status(); });
ok = !d2.playing.includes(1);
ok ? pass++ : fail++;
console.log(`${ok ? 'PASS' : 'fail'} | ★ stop 之后页面侧不再播放该 player :: [${d2.playing.join(',')}]`);

console.log('--- 立体声 buffer 通道数 ---');
// 先把之前 stop 掉的节点清干净，再单独排立体声，避免读到别的 id 的 buffer
await page.evaluate(() => { window.OctaveAudio._state.nodes.forEach((e) => { try { e.src.stop(); } catch (x) {} }); window.OctaveAudio._state.nodes.clear(); window.OctaveAudio._state.playing.clear(); });
const qid = await page.evaluate(() => {
  // 取 q 的 id：走文件而不是 eval_string 的返回值（后者是退出码，不是值）
  window.Module.eval_string('fid=fopen("/tmp/qid.txt","w"); fprintf(fid,"%d",__pba_id__(struct(q).player)); fclose(fid)');
  try {
    return Number(new TextDecoder().decode(window.Module.FS.readFile('/tmp/qid.txt')));
  } catch (e) { return 0; }
});
console.log(`  q 的 id=${qid}`);
// 清空队列：前面各段留下的 play 动作若一起 drain，节点表里就不止 q 一个，
// 断言会读到别人的 buffer（这正是上一次失败的原因）。
await ev('fid=fopen("/tmp/pba_queue.txt","w"); fclose(fid); play(q); disp(1)', '播放立体声');
// 不按 id 取：节点表在清空之后只应剩下本次调度的那一个（id 分配顺序
// 取决于此前建了多少 player，硬编码 id 是脆的）。
const d3 = await page.evaluate(async () => {
  await window.OctaveAudio.drain();
  const S = window.OctaveAudio._state;
  for (const [id, e] of S.nodes) {
    return { id, ch: e.src.buffer.numberOfChannels, dur: e.src.buffer.duration, len: e.src.buffer.length };
  }
  return null;
});
if (d3) {
  // q 是 8000 样本 @ 44100Hz → 时长 8000/44100 ≈ 0.1814s（不是 1 秒：
  // 1 秒那条是 p，8000 样本 @ 8000Hz）。这里断言的是"采样率真被用上了"。
  const wantDur = 8000 / 44100;
  const good = d3.ch === 2 && Math.abs(d3.dur - wantDur) < 0.005 && d3.len === 8000;
  good ? pass++ : fail++;
  console.log(`${good ? 'PASS' : 'fail'} | ★ 立体声 → 2 通道 / 采样率 44100 生效 :: ch=${d3.ch} dur=${d3.dur.toFixed(4)}s (期望 ${wantDur.toFixed(4)}) len=${d3.len}`);
} else { console.log('fail | 立体声 buffer 未找到'); fail++; }

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await browser.close();
process.exit(fail ? 1 : 0);
