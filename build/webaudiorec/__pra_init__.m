## WebAudio **录音** 侧的 Octave 底座（T7 / 缺口清单 B1）
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## ── 架构（与播放侧的 build/webaudio/ 刻意对称）────────────────────────────────
## `@audiorecorder` 那 19 个方法调的是 19 个 `__recorder_*` builtin，本构建里
## 它们一个都不存在（`audiodevinfo.cc` 里那批全被 `#if defined (HAVE_PORTAUDIO)`
## 编掉了），所以 `audiorecorder(8000,8,1)` 直接报 `'__recorder_audiorecorder__'
## undefined`。这里用**纯 .m** 把它们补齐，零编译。
##
## 句柄：`@audiorecorder` 的构造是
##     recorder.recorder = __recorder_audiorecorder__ (...)
## 之后每个方法拿 `struct (recorder).recorder` 传回来。**传回来的是副本**，
## 所以可变状态不能放在句柄里 —— 与播放侧同一个理由，句柄只是一个整数 id，
## 真状态在全局表里：
##     __pra__.items{id}   该录音机的属性（Fs/Nbits/Channels/DevID/Tag/UserData）
##     __pra__.next        下一个空闲 id
## 取值/写值一律走 `__pra_new__`/`__pra_get__`/`__pra_put__` —— 直接返回全局表的
## 函数会把**副本**交出去，之后所有写入都会静默丢失（这条播放侧已经踩过）。
##
## ── 真正的录音在页面侧 ──────────────────────────────────────────────────────
## Octave 无法同步调用 JS，所以这里只**记录意图**：动作追加到
## `/tmp/pra_queue.txt`，由 `bridge/webaudiorec.js` 轮询后落实。音频数据由页面写回
## `/tmp/pra_<id>.f64`（交织的 little-endian double），进度/错误写
## `/tmp/pra_<id>.txt`（`key<TAB>value` 若干行，见 `__pra_progress__`）。
##
## ── 为什么用 MediaRecorder 而不是 ScriptProcessorNode ────────────────────────
## 实测：wasm 里 Octave 的 `pause(1)` **不是完全阻塞**主线程，但让出的机会很稀疏
## （1 秒里 JS 定时器只跑了约 5 次）。按主线程回调取样的 ScriptProcessorNode
## 在这个节奏下会大面积丢样本，而 MediaRecorder 的采集/编码不走主线程，
## 因此是这条架构下唯一可靠的选择（代价：**只有解码完成后才知道样本数**）。
##
## 与播放侧一致的口径：`playblocking` 那种"真阻塞"语义本构建做不到，
## 录音侧 `recordblocking` 改成**轮询等待**（见 `__recorder_recordblocking__`）。

function __pra_init__ ()

  global __pra__;
  if (isempty (__pra__))
    __pra__ = struct ();
    __pra__.items = {};
    __pra__.next = 1;
  endif

endfunction
