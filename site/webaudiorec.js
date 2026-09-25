// WebAudio recording bridge for octave-wasm. Own code, repo license.
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Octave half is build/webaudiorec/*.m: pure-.m implementations of the 19
// __recorder_* builtins that @audiorecorder calls.  They only *record intent*
// (append to /tmp/pra_queue.txt) because Octave cannot call into JS.  This
// module is the other half: it drains that queue into a real microphone capture
// and writes the samples back where Octave can read them.
//
//   await OctaveRec.init()    — start polling (call after Octave is ready)
//   await OctaveRec.drain()   — process queued actions once
//   OctaveRec.status()        — { recordings, drained, lastError }
//
// ── 为什么用 MediaRecorder ───────────────────────────────────────────────────
// 实测：wasm 里 Octave 的 `pause(1)` 期间 JS 定时器只跑了约 5 次 —— 主线程**不是**
// 完全阻塞，但让出的机会很稀疏。靠主线程回调取样的 ScriptProcessorNode 会大面积
// 丢样本；AudioWorklet 想无锁攒样本需要 SharedArrayBuffer，而本构建**刻意不要求
// COI**（HANDOFF §10.2 闸门③），拿不到 SAB。MediaRecorder 的采集与编码不走主线程，
// 是这条架构下唯一可靠的选择。
// **代价（如实）**：只有 stop 之后解码完才知道真实样本数，所以录音中的 frames 是
// 按时间估算的，且 `getaudiodata` 要等状态变成 done 才有数据。
//
// ── 权限三态 ────────────────────────────────────────────────────────────────
// 没有 mediaDevices → insecure；getUserMedia 被拒 → denied；其余 → error。
// 三种都带原文写进状态文件，由 __recorder_getaudiodata__ 译成 Octave 的清晰报错。
// **绝不假装麦克风永远存在。**

(function () {
  const QUEUE = '/tmp/pra_queue.txt';
  const SAMPLES = '/tmp/pra_%d.f64';
  const STATUS = '/tmp/pra_%d.txt';

  const S = {
    recs: new Map(),     // id -> { mr, stream, ctx, startedAt, rate, chans, seconds, state, err, timer }
    lastError: null,
    drained: 0,
    pollTimer: null,
  };

  // 共享 primitive（bridge/queue.js）：守卫/清空/切分只此一份
  const Q = window.OctaveQueue;

  // ── 本协议的行格式（**唯一声明**，页面侧）────────────────────────────────
  //   <id>\t<action>[\t<arg>…]     例：`1\trecord\t8000\t16\t1\t2`
  //   生产侧：build/webaudiorec/__pra_enqueue__.m
  function parseLine(line) {
    const p = Q.split(line);
    return { id: Number(p[0]), action: p[1], args: p.slice(2).map(Number) };
  }

  function readQueue() {
    return Q.drain(QUEUE).map(parseLine);
  }

  function writeStatus(id, rec) {
    const frames = rec.frames | 0;
    const lines = [
      'state\t' + rec.state,
      'frames\t' + frames,
      'actualChans\t' + (rec.actualChans | 0),
      'err\t' + (rec.err || ''),
    ];
    try {
      Q.fs().writeFile(STATUS.replace('%d', id), new TextEncoder().encode(lines.join('\n') + '\n'));
    } catch (e) {
      S.lastError = '写状态文件失败: ' + e.message;
    }
  }

  // 线性插值重采样。只有在 AudioContext 没能按请求采样率建立时才用得上。
  function resample(channel, inRate, outRate, framesOut) {
    const out = new Float32Array(framesOut);
    for (let i = 0; i < framesOut; i++) {
      const p = i * inRate / outRate;
      const i0 = Math.floor(p);
      const i1 = Math.min(i0 + 1, channel.length - 1);
      const f = p - i0;
      out[i] = channel[i0] * (1 - f) + channel[i1] * f;
    }
    return out;
  }

  function stopCapture(rec) {
    try { if (rec.timer) clearTimeout(rec.timer); } catch (e) {}
    rec.timer = null;
    try {
      if (rec.mr && rec.mr.state !== 'inactive') rec.mr.stop();
    } catch (e) {}
  }

  function releaseStream(rec) {
    try { rec.stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
  }

  async function doRecord(id, args) {
    const [rate, nbits, chans, seconds] = args;
    const wantChans = Math.max(1, Math.round(chans || 1));
    const wantRate = Math.max(1, Math.round(rate || 8000));

    // 同一 id 重复 record：先把上一次收掉，免得两路 MediaRecorder 同时活着
    const prev = S.recs.get(id);
    if (prev) { stopCapture(prev); releaseStream(prev); S.recs.delete(id); }

    const rec = {
      mr: null, stream: null, ctx: null,
      startedAt: 0, rate: wantRate, chans: wantChans, seconds: seconds || 0,
      state: 'idle', frames: 0, actualChans: 0, err: '', timer: null,
      // getUserMedia 是异步的：这期间来的 stop 必须记下来。
      // 不记的话会出现这种坏情况 —— record(r) 之后马上 stop(r)，
      // stop 被丢弃、随后 getUserMedia 才 resolve 并开始**无限**录音。
      stopRequested: false,
    };
    S.recs.set(id, rec);
    writeStatus(id, rec);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      rec.state = 'insecure';
      rec.err = 'navigator.mediaDevices.getUserMedia 不存在（需要安全上下文）';
      writeStatus(id, rec);
      return;
    }

    let stream;
    try {
      // 先按请求的声道数要；被 OverconstrainedError 拒了就退回默认设备
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: wantChans } });
      } catch (e) {
        if (e && e.name === 'OverconstrainedError') {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } else {
          throw e;
        }
      }
    } catch (e) {
      const name = (e && e.name) || '';
      if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
        rec.state = 'denied';
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        rec.state = 'error';
        rec.err = '没有可用的输入设备（' + name + '）';
      } else {
        rec.state = 'error';
      }
      if (!rec.err) rec.err = name + ': ' + ((e && e.message) || 'getUserMedia 失败');
      writeStatus(id, rec);
      return;
    }

    rec.stream = stream;

    let mr;
    try {
      mr = new MediaRecorder(stream);
    } catch (e) {
      rec.state = 'error';
      rec.err = 'MediaRecorder 不可用: ' + e.message;
      releaseStream(rec);
      writeStatus(id, rec);
      return;
    }
    rec.mr = mr;

    const chunks = [];
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

    mr.onstop = async () => {
      rec.state = 'decoding';
      writeStatus(id, rec);
      try {
        const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
        // 空 blob（start 后立刻 stop）不用送进解码器：那只会得到一句难懂的
        // "解码失败"，而事实是"这段时间没采到样本" —— 如实记 done/0 帧。
        if (!blob.size) {
          rec.frames = 0;
          rec.state = 'done';
          writeStatus(id, rec);
          return;
        }
        const buf = await blob.arrayBuffer();

        // 尽量让 AudioContext 直接工作在请求的采样率上，这样解码时会顺带重采样
        if (!rec.ctx) {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          if (!Ctx) throw new Error('浏览器没有 AudioContext');
          try {
            rec.ctx = new Ctx({ sampleRate: wantRate });
          } catch (e) {
            rec.ctx = new Ctx();
          }
        }
        const decoded = await rec.ctx.decodeAudioData(buf);
        const srcChans = decoded.numberOfChannels;
        rec.actualChans = srcChans;

        const framesOut = Math.max(1, Math.round(decoded.length * wantRate / decoded.sampleRate));
        const chans = wantChans;
        const out = new Float64Array(framesOut * chans);

        for (let c = 0; c < chans; c++) {
          // 声道不足就复制第一路补到请求的路数（如实记进 actualChans）
          const src = decoded.getChannelData(Math.min(c, srcChans - 1));
          const line = (decoded.sampleRate === wantRate)
            ? src
            : resample(src, decoded.sampleRate, wantRate, framesOut);
          for (let i = 0; i < framesOut; i++) out[i * chans + c] = line[i];
        }

        Q.fs().writeFile(SAMPLES.replace('%d', id), new Uint8Array(out.buffer));
        rec.frames = framesOut;
        rec.state = 'done';
        writeStatus(id, rec);
      } catch (e) {
        rec.state = 'error';
        rec.err = '解码失败: ' + ((e && e.message) || String(e));
        writeStatus(id, rec);
      } finally {
        releaseStream(rec);
      }
    };

    try {
      mr.start();
    } catch (e) {
      rec.state = 'error';
      rec.err = 'MediaRecorder.start() 失败: ' + e.message;
      releaseStream(rec);
      writeStatus(id, rec);
      return;
    }

    rec.startedAt = Date.now();
    rec.state = 'recording';
    writeStatus(id, rec);

    // stop 在授权/启动之前就来了：录一瞬就收（数据可能为 0 帧，那也如实）
    if (rec.stopRequested) {
      stopCapture(rec);
      return;
    }

    if (rec.seconds > 0) {
      rec.timer = setTimeout(() => { stopCapture(rec); }, rec.seconds * 1000);
    }
  }

  function doStop(id) {
    const rec = S.recs.get(id);
    if (!rec) return;
    // 还没拿到流/还没开始：记下意图，别让后续的 start 变成无限录音
    if (rec.state === 'idle') { rec.stopRequested = true; return; }
    if (rec.state === 'recording' || rec.state === 'paused') stopCapture(rec);
  }

  function doPause(id) {
    const rec = S.recs.get(id);
    if (!rec || !rec.mr) return;
    try {
      if (rec.mr.state === 'recording') { rec.mr.pause(); rec.state = 'paused'; writeStatus(id, rec); }
    } catch (e) { S.lastError = 'pause 失败: ' + e.message; }
  }

  function doResume(id) {
    const rec = S.recs.get(id);
    if (!rec || !rec.mr) return;
    try {
      if (rec.mr.state === 'paused') { rec.mr.resume(); rec.state = 'recording'; writeStatus(id, rec); }
    } catch (e) { S.lastError = 'resume 失败: ' + e.message; }
  }

  const HANDLERS = { record: doRecord, stop: doStop, pause: doPause, resume: doResume };

  async function drain() {
    let acts;
    try {
      acts = readQueue();
    } catch (e) {
      S.lastError = String(e.message || e);
      return { done: 0 };
    }
    let done = 0;
    for (const a of acts) {
      const h = HANDLERS[a.action];
      if (!h) continue;
      try { await h(a.id, a.args); done++; } catch (e) { S.lastError = `${a.action} 失败: ${e.message}`; }
    }
    // 录音中的 frames 估算（真值要等 stop 后解码；见文件头）
    for (const [id, rec] of S.recs) {
      if (rec.state === 'recording' && rec.startedAt) {
        rec.frames = Math.floor((Date.now() - rec.startedAt) / 1000 * rec.rate);
        writeStatus(id, rec);
      }
    }
    S.drained += done;
    return { done, recordings: S.recs.size };
  }

  async function init(opts) {
    const o = opts || {};
    if (S.pollTimer) clearInterval(S.pollTimer);
    S.pollTimer = setInterval(() => { drain().catch(() => {}); }, o.intervalMs || 250);
    await drain().catch(() => {});
    return true;
  }

  function status() {
    const out = {};
    for (const [id, rec] of S.recs) {
      out[id] = { state: rec.state, frames: rec.frames, actualChans: rec.actualChans, err: rec.err };
    }
    return { recordings: out, drained: S.drained, lastError: S.lastError };
  }

  window.OctaveRec = { init, drain, status, _parseLine: parseLine, _state: S };
})();
