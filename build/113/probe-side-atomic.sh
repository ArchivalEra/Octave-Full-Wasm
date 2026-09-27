#!/bin/sh
# Octave-Full-Wasm — 实验：side module（`.oct` 的形态）**必须**带线程旗标吗？（2026-09-27，branch threads）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# ## 为什么做它（这条断言从没被反向测过）
#
# `build/113/probe-threads/side.c` 的注释与 `PLAN-threads.md` 都写着"side module **也必须**带
# `-pthread`（内存模型必须匹配）"，但 E3 探针**两档都带了** `-pthread` ⇒ 这句话只有正向证据。
# 而它决定的是**整条 `.oct` 车道的重编代价**：本站有 49 条资产（13 个包 + 核心 dldfcn），
# 如果"非 atomics 编的 side module 载不进 shared-memory 主模块"成立，那这 49 条**全部**得重编。
#
# 三档（**只变 side 的旗标**，主模块一律线程档 ⇒ 变量单一）：
#   threads  带 `-pthread -sSHARED_MEMORY`（E3 基线，已知绿）
#   plain    **不带任何线程旗标** —— 就是现役 `.oct` 资产的编法
#   atomics  只带 `-matomics -mbulk-memory`（若 plain 失败，这就是最便宜的那个修法）
#
# 判据（三档各跑一遍 `test/browser/probe-threads.mjs`，同一份主模块）：
#   绿 = `ok=100`（100 轮 dlopen/dlsym/dlclose 全部成功）+ `missing=0`（反证档：dlopen 不存在的模块必须失败）
#         + `busy>0`（期间 2 个 pthread 真在跑）
#   红 = 任一轮 dlopen 失败 / 死锁 / LinkError（`dlerror` 原文由探针打出来）
#
# 用法（容器内）：sh probe-side-atomic.sh [基目录，默认 /src/libwork/side-atomic]
set -e
BASE="${1:-/src/libwork/side-atomic}"
# ⚠️ **不许静默回退**到容器里那份旧源码（第一版就是 `|| SRC=/src/probe-threads`，
#    而那份 `run.html` 是 preload 时代的旧件、**没有 fetch/writeFile** ⇒ 三档全部因
#    "dlopen 找不到 /side.wasm（fetch 没发生）"而红，看起来像"side 旗标不兼容"——
#    差一点就把一个**假结论**写进结论表。找不到源码就 FATAL。
SRC="${SRC:-$(cd "$(dirname "$0")" && pwd)/probe-threads}"
[ -f "$SRC/run.html" ] || { echo "FATAL: 找不到探针源码 $SRC（别用容器里的旧拷贝）" >&2; exit 2; }
grep -q "writeFile" "$SRC/run.html" || {
  echo "FATAL: $SRC/run.html 里没有 writeFile ⇒ 这是 preload 时代的旧件（会假红）" >&2; exit 2; }

COMMON="-O2 -fwasm-exceptions"
THREADS="-pthread -sSHARED_MEMORY"
MAINMOD="-sMAIN_MODULE=2 -sALLOW_TABLE_GROWTH=1 -sERROR_ON_UNDEFINED_SYMBOLS=0"
POOL="-sPTHREAD_POOL_SIZE=2 -sPTHREAD_POOL_SIZE_STRICT=2"   # 池不够就硬失败（不静默起 worker）
EFUNCS="_e3_run,_e3_busy_counter,_e3_dlopen_missing"

build_side () {   # $1=目录 $2=旗标 $3=说明
  emcc $COMMON $2 -fPIC -sSIDE_MODULE=2 -sERROR_ON_UNDEFINED_SYMBOLS=0 \
    -sEXPORTED_FUNCTIONS=_side_add -Wl,--export=side_add \
    "$SRC/side.c" -o "$1/side.wasm" >/dev/null 2>&1 \
    || { echo "  ✗ $3：side 编不过（旗标组合被拒）"; return 1; }
  echo "  ✓ $3：side.wasm=$(stat -c%s "$1/side.wasm") 字节"
}

for v in threads plain atomics; do
  OUT="$BASE/$v"
  rm -rf "$OUT"; mkdir -p "$OUT"
  cp -a "$SRC/main.c" "$SRC/run.html" "$OUT"/
  echo "== 档 $v"
  emcc $COMMON $THREADS $MAINMOD $POOL \
    -sEXPORTED_FUNCTIONS=$EFUNCS \
    -sEXPORTED_RUNTIME_METHODS=FS,ccall,cwrap \
    "$OUT/main.c" -o "$OUT/main.js" >/dev/null 2>&1
  echo "   主模块（线程档，三档共用）：main.wasm=$(stat -c%s "$OUT/main.wasm") 字节"
  case "$v" in
    threads) build_side "$OUT" "$THREADS" "side 带 -pthread（E3 基线）" ;;
    plain)   build_side "$OUT" ""        "side **不带**线程旗标（.oct 现役形态）" ;;
    atomics) build_side "$OUT" "-matomics -mbulk-memory" "side 只带 atomics（最小修补）" ;;
  esac
done

echo
echo "产物就绪：$BASE/{threads,plain,atomics}"
echo "跑法（宿主，从仓库原路径）："
echo "  cd /mnt/hdd/octave-wasm-build/harness && \\"
echo "    PROBE_DIR=/mnt/hdd/octave-wasm-build/side-atomic/<档> sh run.sh \\"
echo "      /mnt/hdd/zcode-projects/Octave-Full-Wasm/test/browser/probe-threads.mjs"
