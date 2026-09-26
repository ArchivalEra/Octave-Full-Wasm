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

/* ── E4（PLAN-threads §0.5 第 2 条）：worker 里 dlopen × 两种 FS 来源 ─────────
 * C3 的最后未知数：worker 侧 dlopen 看不看得到 FS？两种来源分开测：
 *   /side_rt.wasm  = worker 运行时 fetch → FS.writeFile 写进来的（产品资产装载形态）
 *   /side_pre.wasm = --preload-file 烘进 .data 的（产品 octave.data 形态）
 * side.c 的 side_chain 会**经 dlopen 的模块回调主模块的 worker_wait**（挂起 import）
 * ⇒ 这正是 C3 的完整机制：worker + dlopen + FS + JSPI 挂起。
 * 预期：side_chain(50) = worker_wait(50)+1 = 52，等待期间 tick 递增；
 * 若整条链任何一环不挂起/不可见，这里会抛 SuspendError 或 dlopen 失败。 */
#include <dlfcn.h>

#define Q4_RT_PATH  "/side_rt.wasm"
#define Q4_PRE_PATH "/side_pre.wasm"

static int
q4_dlopen_call (const char *path, int ms)
{
  void *h = dlopen (path, RTLD_NOW);
  if (! h)
    {
      printf ("[q4] dlopen(%s) 失败：%s\n", path, dlerror ());
      return -1;
    }
  int (*fn) (int) = (int (*) (int)) dlsym (h, "side_chain");
  if (! fn)
    fn = (int (*) (int)) dlsym (h, "_side_chain");   /* 两种符号写法都试 */
  if (! fn)
    {
      printf ("[q4] dlsym(side_chain) 失败：%s\n", dlerror ());
      dlclose (h);
      return -2;
    }
  int r = fn (ms);
  dlclose (h);
  return r;
}

EMSCRIPTEN_KEEPALIVE int
worker_dlopen_rt (int ms)
{
  return q4_dlopen_call (Q4_RT_PATH, ms);
}

EMSCRIPTEN_KEEPALIVE int
worker_dlopen_pre (int ms)
{
  return q4_dlopen_call (Q4_PRE_PATH, ms);
}
