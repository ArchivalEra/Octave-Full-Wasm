/* Octave-Full-Wasm — Q4 探针：JSPI × DedicatedWorker（主模块侧）
 * Copyright (C) 2026 ArchivalEra
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 要回答的唯一问题（第四轮外部评审 Q4 / C3 的最后未知数）：
 *   **B 姿势手搓 JSPI（Suspending 包 import + promising 包导出）在一个
 *   DedicatedWorker 里到底能不能挂起/恢复？** 解释器搬 Worker（C3）全靠它。
 *
 * 判据（与 probe-jspi-b 同一套仪器，只是换到 worker 里跑）：
 *   ① 100 次挂起/恢复全部完成（返回 ms+1）；
 *   ② 等待期间 worker 的 setTimeout tick **必须递增**（证明真让出，不是 busy-loop）；
 *   ③ 墙上时间 ≥ 请求毫秒数（下界校验）。
 * 反向断言：worker 里若没有 `WebAssembly.Suspending/promising`，如实报 api-missing，
 *   不当作失败（那是"环境没有这能力"，不是"我们姿势错"）。
 *
 * 形态与 probe-jspi/main.c 一致：唯一挂起 import 只声明不定义（定义在 jslib.js）。
 */

#include <emscripten.h>
#include <stdio.h>

/* 由 --js-library 提供（见 jslib.js）：返回 Promise ⇒ 在页面/worker 里被包成
 * `new WebAssembly.Suspending(...)` 后，wasm 一调它就挂起整条栈。 */
extern void browser_wait_ms (int ms);

/* 挂起入口：由 worker.js 用 `WebAssembly.promising()` 包，再从 worker 里 await。 */
EMSCRIPTEN_KEEPALIVE int
worker_wait (int ms)
{
  browser_wait_ms (ms);
  return ms + 1;
}

/* 对照组（反向断言）：**不碰**挂起 import 的同步入口，在 worker 里必须照常可用。
 * 若它也跟着坏掉，说明问题出在"worker 里跑 wasm"而不是 JSPI 本身。 */
EMSCRIPTEN_KEEPALIVE int
worker_ping (int x)
{
  return x + 7;
}
