#!/bin/sh
# Octave-Full-Wasm — Q4 探针：JSPI × DedicatedWorker（B 姿势，不加 -sJSPI）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 唯一变量相对 probe-jspi-b.sh：**环境是 worker**（-sENVIRONMENT=worker），
# 宿主页换成 run.html + worker.js。旗标组与 B 探针逐字一致（wasm EH + MAIN_MODULE=2，
# **没有** -sJSPI / -sJSPI_EXPORTS / -sJSPI_IMPORTS）。
# 用法（容器内）：sh probe-jspi-worker.sh [输出目录]
set -e
OUT="${1:-/src/libwork/jspi-worker}"
SRC="$(cd "$(dirname "$0")" && pwd)"
[ -f "$SRC/main.c" ] || SRC=/src/probe-jspi-worker
mkdir -p "$OUT"
cp -a "$SRC"/main.c "$SRC"/jslib.js "$SRC"/worker.js "$SRC"/run.html "$SRC"/run-page.html "$OUT/"
cd "$OUT"

COMMON="-O2 -fwasm-exceptions"
MAINMOD="-sMAIN_MODULE=2 -sALLOW_TABLE_GROWTH=1 -sERROR_ON_UNDEFINED_SYMBOLS=0"

echo "== Q4：主模块（**无 -sJSPI**；环境用默认 web,worker —— 见下）"
# ⚠️ 实测（2026-09-25）：`-sENVIRONMENT=worker` **单独指定会把开机打坏** ——
#    initRuntime → wasm 起函数 → `_environ_get` 抛
#    `RangeError: Maximum call stack size exceeded`（页面里同样复现 ⇒ 与 worker 无关）。
#    默认环境（web,worker,node）下同源代码正常。所以这里**不加** ENVIRONMENT 旗标。
emcc $COMMON $MAINMOD \
  -sEXPORTED_FUNCTIONS=_worker_wait,_worker_ping \
  main.c --js-library jslib.js -o main.js 2>&1 | tail -5
echo "   main.js=$(stat -c%s main.js) main.wasm=$(stat -c%s main.wasm)"
echo "   胶水里 Suspending 出现次数（应为 0 —— 包装在 worker.js 里）：$(grep -c Suspending main.js || true)"
echo "   参考：胶水里 document. 出现 $(grep -c 'document\.' main.js || true) 处（默认环境下允许有，运行时按环境检测）"
echo "== 产物就绪：$OUT"
