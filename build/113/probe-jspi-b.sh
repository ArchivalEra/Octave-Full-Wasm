#!/bin/sh
# Octave-Full-Wasm — B 方案（手搓 JSPI）探针：与 A2 同一份 C 代码，**唯一变量 = 包装方式**
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 依据：第三轮外部复审 §3（B 的可证伪判据与"平行验证"定位）+ A2 实验的根因发现
#（5.0.7 里 -sJSPI 使 dlopen 无条件成为挂起点，见 NOTES-jspi「A2 最小实验」）。
# B 不加 -sJSPI ⇒ ASYNCIFY 假 ⇒ dlopen 走同步分支 ⇒ 不再是挂起点；
# 挂起能力完全来自 run-b.html 的 instantiateWasm 钩子（Suspending 包 import）
# 与 JS 侧的 WebAssembly.promising（包谁不包谁由页面决定）。
# 用法（容器内）：sh probe-jspi-b.sh [输出目录]
set -e
OUT="${1:-/src/libwork/jspi-b}"
SRC="$(cd "$(dirname "$0")" && pwd)"
[ -f "$SRC/main.c" ] || SRC=/src/probe-jspi-b
mkdir -p "$OUT"
cp -a "$SRC"/main.c "$SRC"/side.c "$SRC"/side_ctor.c "$SRC"/jslib.js "$SRC"/run-b.html "$OUT/"
cd "$OUT"

COMMON="-O2 -fwasm-exceptions"
MAINMOD="-sMAIN_MODULE=2 -sALLOW_TABLE_GROWTH=1 -sERROR_ON_UNDEFINED_SYMBOLS=0"

echo "== B：主模块（**无 -sJSPI**；wasm EH + MAIN_MODULE=2 不变）"
emcc $COMMON $MAINMOD \
  -sEXPORTED_FUNCTIONS=_main_wait,_run_side,_main_wait_unmarked,_run_ctor_unmarked,_run_ctor_marked \
  -sEXPORTED_RUNTIME_METHODS=FS,ccall,cwrap \
  main.c --js-library jslib.js -o main.js 2>&1 | tail -5
echo "   main.js=$(stat -c%s main.js) main.wasm=$(stat -c%s main.wasm)"
echo "   胶水里 Suspending 出现次数（应为 0 —— 全部包装在页面里）：$(grep -c Suspending main.js || true)"

echo "== B：side module × 2（与 A2 同源）"
emcc $COMMON -fPIC -sSIDE_MODULE=2 -sERROR_ON_UNDEFINED_SYMBOLS=0 \
  -sEXPORTED_FUNCTIONS=_side_wait -Wl,--export=side_wait \
  side.c -o side.wasm 2>&1 | tail -3
emcc $COMMON -fPIC -sSIDE_MODULE=2 -sERROR_ON_UNDEFINED_SYMBOLS=0 \
  -sEXPORTED_FUNCTIONS=_ctor_ping -Wl,--export=ctor_ping \
  side_ctor.c -o side_ctor.wasm 2>&1 | tail -3
echo "   side.wasm=$(stat -c%s side.wasm) side_ctor.wasm=$(stat -c%s side_ctor.wasm)"
echo "== 产物就绪：$OUT"
