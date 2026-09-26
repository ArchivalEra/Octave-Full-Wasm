#!/usr/bin/env bash
# Octave-Full-Wasm — 构建**线程版 BLAS 缩放探针**（2026-09-26）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 做什么：把 `build/113/probe-blas-threads/{main.c,run.html}` 与**线程版 OpenBLAS**
# （`USE_THREAD=1`，产物名带 `p`：`libopenblas_wasm128p-r0.3.34.a`）编成一个最小 wasm 程序，
# 用来测 DGEMM 随线程数的缩放。
#
# 为什么要单独立它：`E2`（OpenBLAS **链进 Octave**）卡在 binaryen 的 76 个
# `signature_mismatch` 悬案上 —— 那是"进 Octave 主模块"这一步的问题；
# 而"要不要为多线程翻闸门③"缺的是**这个数**（线程版到底快多少）。
# 本探针不碰 Octave、不翻闸门、不动现役产物。
#
# 前置（只做一次，容器内）：
#   rm -rf /src/work/OpenBLAS-thr && mkdir -p /src/work/OpenBLAS-thr
#   tar -C /src/work/OpenBLAS-0.3.34 --exclude='*.o' --exclude='*.a' --exclude='*.so' -cf - . \
#     | tar -C /src/work/OpenBLAS-thr -xf -          # ★ 干净副本：改 make 变量不会让旧对象失效
#   cd /src/work/OpenBLAS-thr && make TARGET=WASM128_GENERIC USE_THREAD=1 \
#        NO_LAPACK=1 NO_SHARED=1 CC="ccache emcc -pthread" FC="/src/bin/emf77 -pthread" \
#        HOSTCC=gcc -j12                             # ≈ 1–2 分钟 ⇒ libopenblas_wasm128p-r0.3.34.a
#
# ⚠️ 两个必须的旗标（实测踩过，别删）：
#   · 默认线程数由 **main.c 里的 `setenv("OPENBLAS_NUM_THREADS","1",1)`** 压到 1
#     （OpenBLAS 的默认是编译期烘进去的 `-DMAX_CPU_NUMBER=<nproc>` = 本机 24 ⇒ 一上来就要
#     24 个 worker，池不够时 `pthread_create` 失败 → 走"起不来"分支 → **整个程序 exit**；
#     实测报 `blas_thread_init: pthread_create failed for thread 13 of 24: Resource temporarily unavailable`）。
#     ⚠️ 别用 `-sENV=...`：emcc 5.0.7 **没有**这个设置项（实测报 non-existent setting）。
#   · `-sPTHREAD_POOL_SIZE_STRICT=1`（不是 2）：池不够时**允许按需起**（首次会慢一点，
#     被热身吃掉）。=2 是"池耗尽必须硬失败"——那是**探针**要的语义，不是基准要的。
#
# 用法（宿主）：bash build/113/probe-blas-threads.sh
# 产物：/mnt/hdd/octave-wasm-build/blas-threads-probe/{main.js,main.wasm,run.html}
# 跑法：cd /mnt/hdd/octave-wasm-build/harness && \
#         sh run.sh <repo>/test/browser/probe-blas-threads.mjs
set -euo pipefail

REPO=/mnt/hdd/zcode-projects/Octave-Full-Wasm
CT=o113
IN_CT=/src/work/blas-thr-probe
OUT=/mnt/hdd/octave-wasm-build/blas-threads-probe
OBLIB=/src/work/OpenBLAS-thr/libopenblas_wasm128p-r0.3.34.a

echo "== 0) 前置：线程版 OpenBLAS 在吗"
sudo docker exec $CT test -s "$OBLIB" || {
  echo "FATAL: 缺 $OBLIB —— 先按本脚本头部的配方编线程版 OpenBLAS" >&2; exit 2; }
sudo docker exec $CT sh -c "emnm $OBLIB | grep -q ' T cblas_dgemm\$' && echo '   libopenblas(线程版) 有 cblas_dgemm ✓'"
sudo docker exec $CT sh -c "printf '   pthread/exec_blas 符号数: '; emnm $OBLIB | grep -cE 'pthread_create|exec_blas' || true"

echo "== 1) 源码进容器（$IN_CT）"
sudo docker exec $CT rm -rf "$IN_CT"
sudo docker exec $CT mkdir -p "$IN_CT"
sudo docker cp "$REPO/build/113/probe-blas-threads/main.c"   "$CT:$IN_CT/main.c"
sudo docker cp "$REPO/build/113/probe-blas-threads/run.html" "$CT:$IN_CT/run.html"

echo "== 2) 编（-pthread + SHARED_MEMORY + 预起线程池）"
sudo docker exec $CT bash -lc "
  set -e
  export PATH=/src/bin:/emsdk/upstream/emscripten:\$PATH
  cd $IN_CT && emcc main.c $OBLIB \
    -I/src/work/OpenBLAS-thr \
    -O2 -pthread -sSHARED_MEMORY=1 \
    -sPTHREAD_POOL_SIZE=12 -sPTHREAD_POOL_SIZE_STRICT=1 \
    -sDEFAULT_PTHREAD_STACK_SIZE=2MB \
    -sINITIAL_MEMORY=512MB -sALLOW_MEMORY_GROWTH=1 \
    -sEXIT_RUNTIME=0 -sINVOKE_RUN=1 \
    -o main.js
  ls -la main.js main.wasm
"
# ⚠️ 显式查产物（`set -e` 抓不到管道里的失败，这条规矩踩过）
sudo docker exec $CT test -s "$IN_CT/main.wasm" || { echo "FATAL: 没编出 main.wasm" >&2; exit 2; }

echo "== 3) 取回宿主"
mkdir -p "$OUT"
for f in main.js main.wasm run.html; do
  sudo docker cp "$CT:$IN_CT/$f" "$OUT/$f"
done
# 自检：产物里必须真的有线程痕迹（否则拿到的是"假线程版"）
grep -q 'PThread\|pthread' "$OUT/main.js" || { echo "FATAL: main.js 里没有 pthread 痕迹" >&2; exit 3; }
echo "   ✓ 产物：$OUT（$(du -sh "$OUT" | cut -f1)），胶水里有 pthread 痕迹"
echo "   跑：cd /mnt/hdd/octave-wasm-build/harness && sh run.sh $REPO/test/browser/probe-blas-threads.mjs"
