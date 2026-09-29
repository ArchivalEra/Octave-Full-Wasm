/*
 * Octave-Full-Wasm — 工单 05 结算件：G1 复现探针的 side module 侧
 * Copyright (C) 2026 ArchivalEra
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 扮演 `.oct`：-fPIC -sSIDE_MODULE=2 编成独立 wasm，由主模块**运行时 dlopen**。
 * EMSCRIPTEN_KEEPALIVE 必须有 —— 否则 -O2 的 DCE 把它削成空壳（NOTES-jspi 记过的坑）。
 */
#include <emscripten.h>

EMSCRIPTEN_KEEPALIVE int side_add (int x) { return x + 1; }
