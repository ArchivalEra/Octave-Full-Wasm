/* Octave-Full-Wasm — E3 探针 side module（扮演 .oct）
 * Copyright (C) 2026 ArchivalEra
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 与 probe-jspi/side.c 同形：side_add(41) = 42（证明真的跨了模块边界）。
 * 必须用与主模块**匹配**的线程旗标编译（-pthread），否则 ABI/内存模型不一致。
 */
#include <emscripten.h>

EMSCRIPTEN_KEEPALIVE int
side_add (int x)
{
  return x + 1;
}
