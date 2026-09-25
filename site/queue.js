// Octave-Full-Wasm — MEMFS 队列的**协议无关部分**（唯一的实现）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 为什么有这个文件（2026-09-23 胶水层审计候选 2）──────────────────────────
// 本构建里"Octave 侧请页面干活"只能靠 MEMFS 文件（`.m`/`.cc` 不能直接调 JS：
// `EM_ASM` 在 side module 里不可用，`emscripten_run_script` 只有 C++ 那边能调）。
// 于是四个桥各自实现了同一套形状：**追加一行请求 → 页面读走并清空 → 把结果写回文件**。
//
// 审计查出：那段形状被抄了四遍，"取 fs 并在没有时明确报错"的守卫抄了**五遍**
// （assets-loader/webaudio/webaudiorec/webfilepick/webnet），`readQueue` 抄了三遍，
// 而**没有任何一处声明过某套协议的行格式是什么** —— 两边靠注释维持，已经漂移了
// （`actualChans` 写了没人解析；同一行 pba 格式两处注释说法不一致）。
//
// 这里只放**协议无关**的三件事：取 fs、读并清空、按行/制表切分。
// **各协议的行格式仍然留在各自的 bridge 里**（紧挨着它自己的生产者），因为那才是
// "知道这份字节布局"的地方 —— 把四种 codec 合成一个 options 对象只会把格式从生产者
// 旁边搬走，用 locality 换行数，不划算（审计里的结论）。
//
// 协议清单（四条，各自的格式声明见对应的 producer 与 bridge）：
//   /tmp/pba_queue.txt  play|pause|resume|stop  ← build/webaudio/__pba_enqueue__.m
//   /tmp/pra_queue.txt  record|stop|progress…   ← build/webaudiorec/__pra_enqueue__.m
//   /tmp/ufp_queue.txt  <accept>\t<multiple>\t<title>  ← build/webfilepick.cc
//   /tmp/webnet_*       四个单值文件（不以"行 + 制表符"成形）← build/webnet.cc
//
// 用法（在 bridge/*.js 里）：
//     const lines = OctaveQueue.drain(QUEUE);       // 读走并清空，返回非空行
//     const p = OctaveQueue.split(lines[0]);        // 按制表符切分
(function () {
  'use strict';

  function fs() {
    // 唯一一份守卫：五个桥以前各写一遍同样的东西（连报错文案都不一样）
    const M = window.Module;
    if (!M || !M.FS) throw new Error('OctaveQueue: Module.FS 还没就绪');
    return M.FS;
  }

  function readText(path) {
    try { return new TextDecoder().decode(fs().readFile(path)); } catch (e) { return ''; }
  }

  function clear(path) {
    try { fs().writeFile(path, new Uint8Array(0)); } catch (e) { /* 文件还不存在：无妨 */ }
  }

  // 读走 + 清空，返回按行切分后的非空行（**不清空就会重复执行**，这是本形状的核心约定）
  function drain(path) {
    const text = readText(path);
    if (!text) return [];
    clear(path);
    return text.split('\n').filter(Boolean);
  }

  function split(line) { return String(line).split('\t'); }

  window.OctaveQueue = { fs: fs, readText: readText, clear: clear, drain: drain, split: split };
})();
