#!/bin/sh
# Octave-Full-Wasm — E3 探针：pthread × 运行期 dlopen（第四轮评审 Q1/Q3）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 与既有探针的唯一差别：**主模块带 -pthread -sSHARED_MEMORY**（⇒ 需要 COI 环境），
# side module 也必须带 -pthread（内存模型必须匹配）。
# ⚠️ PTHREAD_POOL_SIZE_STRICT=2：池不够就**硬失败**，不许静默起新 worker
#    （默认值 1 只会在 console 告警 —— 那样"绿"就没有证据力）。
# 用法（容器内）：sh probe-threads.sh [输出目录]
set -e
OUT="${1:-/src/libwork/threads}"
SRC="$(cd "$(dirname "$0")" && pwd)"
[ -f "$SRC/main.c" ] || SRC=/src/probe-threads
mkdir -p "$OUT"
cp -a "$SRC"/main.c "$SRC"/side.c "$SRC"/run.html "$OUT/"
cd "$OUT"

COMMON="-O2 -fwasm-exceptions"
THREADS="-pthread -sSHARED_MEMORY"
MAINMOD="-sMAIN_MODULE=2 -sALLOW_TABLE_GROWTH=1 -sERROR_ON_UNDEFINED_SYMBOLS=0"
POOL="-sPTHREAD_POOL_SIZE=2 -sPTHREAD_POOL_SIZE_STRICT=2"

echo "== E3：主模块（pthread + SHARED_MEMORY + MAIN_MODULE=2）"
emcc $COMMON $THREADS $MAINMOD $POOL \
  -sEXPORTED_FUNCTIONS=_e3_run,_e3_busy_counter,_e3_dlopen_missing \
  -sEXPORTED_RUNTIME_METHODS=FS,ccall,cwrap \
  main.c -o main.js 2>&1 | tail -8
echo "   main.js=$(stat -c%s main.js) main.wasm=$(stat -c%s main.wasm) main.worker.js=$(stat -c%s main.worker.js 2>/dev/null || echo -)"
echo "   胶水里 pthread 痕迹：$(grep -c 'PThread\|pthread' main.js || true) 处；SHARED_MEMORY 迹象：$(grep -c 'shared' main.js || true) 处"

echo "== E3：side module（必须同样带 -pthread）"
emcc $COMMON $THREADS -fPIC -sSIDE_MODULE=2 -sERROR_ON_UNDEFINED_SYMBOLS=0 \
  -sEXPORTED_FUNCTIONS=_side_add -Wl,--export=side_add \
  side.c -o side.wasm 2>&1 | tail -3
echo "   side.wasm=$(stat -c%s side.wasm)"
echo "== 产物就绪：$OUT"
