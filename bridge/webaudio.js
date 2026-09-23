// WebAudio playback bridge for octave-wasm. Own code, repo license.
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Octave side (build/webaudio/*.m) implements the 18 __player_* builtins in
// pure .m and appends playback actions to /tmp/pba_queue.txt.  This module is
// the other half: it drains that queue into an AudioContext.
//
// Why the split: Octave cannot call into JS synchronously (no Asyncify in this
// build), so the wasm side can only *record* intent.  The page owns the actual
// AudioContext, and browsers require a user gesture before one may start — so
// creation is deferred to the first drain that has work to do, never at import.
//
//   await OctaveAudio.init()             — start polling after Octave is ready
//   await OctaveAudio.drain()            — process queued actions once
//   OctaveAudio.resume()                 — call from a click handler to unlock
//   OctaveAudio.status()                 — { contexts, playing, lastError }
//
// AudioBufferSourceNode only (no AudioWorklet): this build has no real threads,
// and a worklet with no audio-thread guarantees buys nothing but complexity.

(function () {
  const QUEUE = '/tmp/pba_queue.txt';
  const SAMPLES = '/tmp/pba_%d.f64';

  const S = {
    ctx: null,
    nodes: new Map(),        // id -> { src, gain, started, offset, duration }
    playing: new Set(),      // ids currently sounding
    lastError: null,
    drained: 0,
    pollTimer: null,
  };

  // 取 fs / 读走并清空 / 按制表符切分：共享实现在 bridge/queue.js（守卫只此一份）
  const Q = window.OctaveQueue;

  // ── 本协议的行格式（**唯一声明**，页面侧）────────────────────────────────
  //   <id>\t<action>[\t<arg>…]     例：`1\tplay\t0\t8000\t44100\t2`
  //   生产侧：build/webaudio/__pba_enqueue__.m（`.m` 与页面之间唯一的接口）
  function parseLine(line) {
    const p = Q.split(line);
    return { id: Number(p[0]), action: p[1], args: p.slice(2).map(Number) };
  }

  function readQueue() {
    return Q.drain(QUEUE).map(parseLine);
  }

  function ensureContext() {
    if (S.ctx) return S.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      S.lastError = '浏览器没有 AudioContext';
      return null;
    }
    try {
      S.ctx = new Ctx();
    } catch (e) {
      S.lastError = 'AudioContext 创建失败: ' + e.message;
      return null;
    }
    return S.ctx;
  }

  // /tmp/pba_<id>.f64 is interleaved doubles; de-interleave into channel arrays.
  function loadChannels(id, channels, from, to) {
    const raw = Q.fs().readFile(SAMPLES.replace('%d', id));
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const total = Math.floor(raw.byteLength / 8 / Math.max(1, channels));
    const start = Math.max(0, from | 0);
    const end = Math.min(total, to > 0 ? to : total);
    const n = Math.max(0, end - start);
    const out = [];
    for (let c = 0; c < channels; c++) out.push(new Float32Array(n));
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < channels; c++) {
        out[c][i] = dv.getFloat64((start + i) * channels * 8 + c * 8, true);
      }
    }
    return { channels: out, frames: n, total };
  }

  function stopNode(id) {
    const e = S.nodes.get(id);
    if (!e) return;
    try { e.src.stop(); } catch (err) {}
    try { e.src.disconnect(); } catch (err) {}
    S.nodes.delete(id);
    S.playing.delete(id);
  }

  function doPlay(a) {
    const ctx = ensureContext();
    if (!ctx) return;
    // queue line: play \t <from> \t <to> \t <rate> \t <channels>
    const [from, to, rate, nch] = a.args;
    const channels = Math.max(1, Math.round(nch || 1));

    let data;
    try {
      data = loadChannels(a.id, channels, from, to);
    } catch (e) {
      S.lastError = `读不到 /tmp/pba_${a.id}.f64（${e.message}）`;
      return;
    }
    if (!data.frames) return;

    stopNode(a.id);

    const buf = ctx.createBuffer(channels, data.frames, rate || 8000);
    for (let c = 0; c < channels; c++) buf.copyToChannel(data.channels[c], c);

    const src = ctx.createBufferSource();
    src.buffer = buf;

    // route through a gain node so stop/pause can fade instead of clicking
    const gain = ctx.createGain();
    gain.gain.value = 1;
    src.connect(gain).connect(ctx.destination);

    src.onended = () => {
      // only clear if this is still the active node for that id
      const cur = S.nodes.get(a.id);
      if (cur && cur.src === src) {
        S.nodes.delete(a.id);
        S.playing.delete(a.id);
      }
    };

    try {
      src.start();
    } catch (e) {
      S.lastError = 'src.start() 失败: ' + e.message + '（浏览器可能仍要求用户手势）';
      return;
    }
    S.nodes.set(a.id, { src, gain, rate: rate || 8000 });
    S.playing.add(a.id);
    window.__pba_playing = Array.from(S.playing);
  }

  function doStop(a) { stopNode(a.id); window.__pba_playing = Array.from(S.playing); }

  function doPause(a) {
    const e = S.nodes.get(a.id);
    if (!e) return;
    try { e.src.stop(); } catch (err) {}
    S.nodes.delete(a.id);
    S.playing.delete(a.id);
    window.__pba_playing = Array.from(S.playing);
  }

  function doResume(a) {
    // 参数原样转发给 doPlay：`.m` 侧现在按 play 的同一条形状入队
    // `[from, to, rate, nch]`（以前这里写死 8000/单声道，于是 44100 立体声一 resume
    // 就变成 8k 单声道 —— 见 build/webaudio/__player_resume__.m 的注释）。
    if (!S.nodes.has(a.id)) doPlay({ id: a.id, args: a.args });
  }

  const HANDLERS = { play: doPlay, stop: doStop, pause: doPause, resume: doResume };

  async function drain() {
    let acts;
    try { acts = readQueue(); } catch (e) {
      S.lastError = String(e.message || e);
      return { done: 0 };
    }
    let done = 0;
    for (const a of acts) {
      const h = HANDLERS[a.action];
      if (!h) continue;
      try { h(a); done++; } catch (e) { S.lastError = `${a.action} 失败: ${e.message}`; }
    }
    S.drained += done;
    return { done, playing: Array.from(S.playing) };
  }

  async function init(opts) {
    const o = opts || {};
    if (S.pollTimer) clearInterval(S.pollTimer);
    S.pollTimer = setInterval(() => { drain().catch(() => {}); }, o.intervalMs || 250);
    // once immediately, in case actions were queued before the page loaded
    await drain().catch(() => {});
    return true;
  }

  // A user gesture unlocks audio in every current browser.  Pages should call
  // this from a click handler; init() alone cannot legally start playback.
  function resume() {
    if (!S.ctx) return Promise.resolve(false);
    if (S.ctx.state === 'running') return Promise.resolve(true);
    return S.ctx.resume().then(() => true).catch(() => false);
  }

  function status() {
    return {
      contexts: S.ctx ? 1 : 0,
      state: S.ctx ? S.ctx.state : 'none',
      playing: Array.from(S.playing),
      drained: S.drained,
      lastError: S.lastError,
    };
  }

  // `_parseLine` 暴露给漂移测试：让'生产侧写的行'与'读侧解析的行'能被同一条断言串起来
  window.OctaveAudio = { init, drain, resume, status, _parseLine: parseLine, _state: S };
})();
