/* Octave-Full-Wasm — E4 探针 side module（worker 里 dlopen 的对象）
 * Copyright (C) 2026 ArchivalEra
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * side_add：最简跨模块调用（41→42）。
 * side_chain：**经 dlopen 的模块回调主模块的 worker_wait（挂起 import）** ——
 * 这是 C3 的完整机制（worker + dlopen + FS + JSPI）：side_chain(50) = worker_wait(50)+1 = 52。
 * 注意：本模块**不带** --js-library；worker_wait 由主模块在 dlopen 时解析。
 */
#include <emscripten.h>

extern int worker_wait (int ms);

EMSCRIPTEN_KEEPALIVE int
side_add (int x)
{
  return x + 1;
}

EMSCRIPTEN_KEEPALIVE int
side_chain (int ms)
{
  return worker_wait (ms) + 1;
}
