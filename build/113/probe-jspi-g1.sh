#!/bin/bash
# Octave-Full-Wasm — 工单 05 结算件：G1 "页面起不来" 的永久复现探针（构建侧，容器内跑）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 一份源码、两个变体，**唯一变量 = 启动期是否碰同步 dlopen**（-DG1_STARTUP_DLOPEN=1）：
#   control/ —— 同样的 embind 面，启动期不碰 dlopen ⇒ 页面必须 ready（锚：harness 没坏）
#   startup/ —— 静态初始化器里同步 dlopen ⇒ 页面必须**起不来**（pageerror=SuspendError）
# 判据在 test/browser/probe-jspi-g1.mjs。机制与 v1–v13 阶梯见 NOTES-jspi。
#
# 用法（容器内）：bash /src/bin/probe-jspi-g1.sh [输出根目录]
#   默认 /mnt/hdd/octave-wasm-build/g1-probe（宿主侧）；容器内跑时传 /src/libwork/g1-probe
set -e
OUT="${1:-/mnt/hdd/octave-wasm-build/g1-probe}"
SRC="$(cd "$(dirname "$0")" && pwd)"
[ -f "$SRC/main.cpp" ] || SRC=/src/probe-jspi-g1
mkdir -p "$OUT/control" "$OUT/startup"
cp -a "$SRC"/side.c "$SRC"/page.html "$OUT/"

COMMON="-O2 -lembind -sJSPI -sMODULARIZE=1 -sEXPORT_NAME=M -sENVIRONMENT=web -sALLOW_MEMORY_GROWTH=1 -sMAIN_MODULE=2 -sALLOW_TABLE_GROWTH=1 -sERROR_ON_UNDEFINED_SYMBOLS=0"

echo "== side module（side_add，KEEPALIVE 防 DCE）"
emcc -O2 -fPIC -sSIDE_MODULE=2 -sERROR_ON_UNDEFINED_SYMBOLS=0 \
  -sEXPORTED_FUNCTIONS=_side_add -Wl,--export=side_add \
  "$SRC/side.c" -o "$OUT/side.wasm" 2>&1 | tail -2
echo "   side.wasm=$(stat -c%s "$OUT/side.wasm")"

echo "== control（启动期不碰 dlopen）"
em++ $COMMON "$SRC/main.cpp" -o "$OUT/control/main.js" 2>&1 | tail -2
echo "== startup（-DG1_STARTUP_DLOPEN=1：静态初始化器里同步 dlopen）"
em++ $COMMON -DG1_STARTUP_DLOPEN=1 "$SRC/main.cpp" -o "$OUT/startup/main.js" 2>&1 | tail -2
cp "$OUT/page.html" "$OUT/control/index.html"
cp "$OUT/page.html" "$OUT/startup/index.html"
# 两个变体都要能 dlopen 到 /side.wasm（相对页面根）⇒ side.wasm 放各变体目录里
cp "$OUT/side.wasm" "$OUT/control/side.wasm"
cp "$OUT/side.wasm" "$OUT/startup/side.wasm"

echo "== 产物自证：A 姿势 ⇒ 胶水里必须出现 promising（旗标真进了链接，别再拿没生效的旗标跑测试）"
for v in control startup; do
  n=$(grep -c 'WebAssembly\.promising' "$OUT/$v/main.js" || true)
  [ "$n" -ge 1 ] || { echo "FATAL: $v/main.js 里没有 promising —— -sJSPI 没进链接，测的是不存在的东西"; exit 1; }
  echo "   $v: promising ×$n ✓"
done
echo "== 产物就绪：$OUT/{control,startup}"
