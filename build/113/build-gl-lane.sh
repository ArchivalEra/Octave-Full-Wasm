#!/usr/bin/env bash
# Octave-Full-Wasm — 线程车道的图形库：gl4es + GLU（B6，2026-09-27）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么单独一个脚本（而不是照抄 NOTES-webgl 的命令）：
#   ① **gl4es 的 CMake 把 `libGL.a` 写回源码树**（NOTES-webgl.md §坑 1）⇒ 原地重编会**覆盖现役**
#      那份，8761 的链接就跟着变 —— 所以必须**拷贝源码副本**（`gl4es-src-threads/`）；
#   ② 两份归档的路径由 `relink.sh` 的模式表填（`GL4ES_A` / `GLU_A`，见 `PLAN-threads.md` §6），
#      所以输出位置必须与模式表**逐字一致**；
#   ③ 判据不是"编过了"，而是 `atomics_scan`：**每个成员**都要带 atomics 特征
#      （wasm-ld 在 shared-memory 链接上就是这么要求的，实测原文见 PLAN-arch §2 B6）。
#
# 用法（容器内，**先**把车道影子放进 PATH）：
#   SHIM=$(bash /src/bin/lane-shim.sh -pthread) && export PATH="$SHIM:$PATH"
#   bash /src/bin/build-gl-lane.sh
set -euo pipefail

GL4ES_VENDOR="${GL4ES_VENDOR:-/src/vendor/gl4es-master}"
LANE_SRC="${LANE_SRC:-/src/libwork/gl4es-src-threads}"
BUILD="${BUILD:-/src/libwork/gl4es-build-threads}"
GLU_SRC="${GLU_SRC:-/src/libwork/glu-9.0.3}"
GLU_OUT="${GLU_OUT:-/src/libwork/glu-webgl-threads}"
JOBS="${JOBS:-$(nproc 2>/dev/null || echo 8)}"

command -v emcmake >/dev/null || { echo "FATAL: PATH 里没有 emcmake" >&2; exit 2; }
# 影子必须在 PATH 里（否则对象没有 atomics，链接期才炸 —— 那时已经白编一轮）
if ! head -3 "$(command -v emcc)" | grep -q "车道影子"; then
  echo "FATAL: PATH 里的 emcc 不是车道影子（先：SHIM=\$(bash lane-shim.sh -pthread); export PATH=\"\$SHIM:\$PATH\"）" >&2
  exit 2
fi

echo "== ① 拷贝 gl4es 源码副本（**绝不**原地重编，见文件头）"
if [ ! -d "$LANE_SRC" ]; then
  cp -a "$GL4ES_VENDOR" "$LANE_SRC"
  rm -rf "$LANE_SRC/lib"/*.a 2>/dev/null || true      # 别把现役那份 .a 带进来（判据会看它）
fi
echo "   $LANE_SRC"

echo "== ② gl4es（cmake，-DSTATICLIB=ON；输出写回源码树 lib/libGL.a）"
rm -rf "$BUILD"; mkdir -p "$BUILD"; cd "$BUILD"
# 显式给 -pthread（不依赖 PATH 解析：emcmake 可能把 CMAKE_C_COMPILER 记成绝对路径）
emcmake cmake "$LANE_SRC" -DCMAKE_BUILD_TYPE=RelWithDebInfo \
  -DNOX11=ON -DNOEGL=ON -DSTATICLIB=ON -DCMAKE_C_FLAGS="-pthread" > "$BUILD/cmake.log" 2>&1 \
  || { echo "FATAL: gl4es cmake 失败（见 $BUILD/cmake.log）" >&2; tail -20 "$BUILD/cmake.log" >&2; exit 1; }
make -j"$JOBS" > "$BUILD/make.log" 2>&1 \
  || { echo "FATAL: gl4es make 失败（见 $BUILD/make.log）" >&2; tail -20 "$BUILD/make.log" >&2; exit 1; }
GL4ES_A="$LANE_SRC/lib/libGL.a"
[ -s "$GL4ES_A" ] || { echo "FATAL: 没产出 $GL4ES_A" >&2; exit 1; }
echo "   $GL4ES_A（$(stat -c%s "$GL4ES_A") 字节）"

echo "== ③ GLU（对着车道 gl4es 的头编，输出 $GLU_OUT）"
bash /src/bin/build-glu-webgl.sh "$GLU_SRC" "$LANE_SRC" "$GLU_OUT" > "$BUILD/glu.log" 2>&1 \
  || { echo "FATAL: GLU 构建失败（见 $BUILD/glu.log）" >&2; tail -20 "$BUILD/glu.log" >&2; exit 1; }
GLU_A="$GLU_OUT/lib/libGLU.a"
[ -s "$GLU_A" ] || { echo "FATAL: 没产出 $GLU_A" >&2; exit 1; }
echo "   $GLU_A（$(stat -c%s "$GLU_A") 字节）"

echo "== ④ 判据：每个成员都必须带 atomics（缺一个，链接期就会被 wasm-ld 拒）"
python3 /tmp/atomics_scan.py "$GL4ES_A" "$GLU_A"
echo "（上面两行**缺 atomics 必须为 0**；非 0 ⇒ 影子没生效，别往下走）"
