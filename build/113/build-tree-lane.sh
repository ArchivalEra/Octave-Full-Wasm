#!/usr/bin/env bash
# Octave-Full-Wasm — 线程车道的 Octave 树：configure + make + install（B6，2026-09-27）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 三个"车道"要点（少一个都会得到"看着像线程档、其实不是"的树）：
#   ① `WITH_THREADS=1`：撤销 AX_PTHREAD 覆盖 + `--enable-threads`（状态由旗标**强制**）；
#   ② `DEPS=/usr/local-threads D=/src/deps-threads`：数学核与表驱动依赖都取**车道 prefix**
#      （现役 `/usr/local` + `/src/deps` 一字不动）；
#   ③ `--prefix=/src/work/octave-install-threads`：`make install` 也进**车道 prefix** ——
#      `.oct` 车道要拿线程档的头（`HAVE_PTHREAD`/`OCTAVE_USE_THREADS` 必须与主模块一致），
#      而现役 `/src/work/octave-install` 不能被覆盖。
#
# ⚠️ 代价（写清楚）：configure 一跑，**这棵树的 config.h 就变成线程档**，对象层随之变 atomics
#    ⇒ 这棵树暂时**不能再产出基础档产品**（要回退就 `cp config.h.pre-threads config.h` + 重编，
#    已实测可行且判决是"重链出的 sha 与部署件逐字节相同"）。部署件在站点上，不受影响。
#
# 用法（容器内）：bash build-tree-lane.sh [--no-clean]
#   `--no-clean`：增量重编（调试用）；默认 `make clean`（旗标变了必须全量，见 PLAN-threads §6 的静默失效）
set -euo pipefail

SRC="${SRC:-/src/work/octave-11.3.0}"
PREFIX="${PREFIX:-/src/work/octave-install-threads}"
JOBS="${JOBS:-$(nproc 2>/dev/null || echo 12)}"
CLEAN=1
[ "${1:-}" = "--no-clean" ] && CLEAN=0

command -v emmake >/dev/null || { echo "FATAL: PATH 里没有 emmake" >&2; exit 2; }
[ -d "$SRC" ] || { echo "FATAL: 找不到源码树 $SRC" >&2; exit 2; }
for d in /usr/local-threads/lib /src/deps-threads; do
  [ -d "$d" ] || { echo "FATAL: 车道依赖不在 $d（先跑 build-deps.sh / build-libs.sh 的车道版）" >&2; exit 2; }
done

echo "== ① configure（WITH_THREADS=1 + 车道 DEPS/prefix）"
cd /src/bin
DEPS=/usr/local-threads D=/src/deps-threads \
  WITH_OPENGL=1 WITH_FREETYPE=1 WITH_FONTCONFIG=1 WITH_THREADS=1 SKIP= \
  bash /src/bin/configure-113-full.sh "$SRC" "$PREFIX" > /tmp/lane-tree-cfg.log 2>&1 \
  || { echo "FATAL: configure 失败（见 /tmp/lane-tree-cfg.log）" >&2; tail -30 /tmp/lane-tree-cfg.log >&2; exit 1; }

cd "$SRC"
echo "== ② 判据：-pthread 必须真的进了编译旗标（「赋值了但没被引用」是历史血债）"
n=$(grep -c -- "-pthread" Makefile || true)
[ "$n" -gt 0 ] || { echo "FATAL: Makefile 里没有 -pthread ⇒ 线程档没配上" >&2; exit 1; }
grep -m2 -- "-pthread" Makefile | sed 's/^/   /'
echo "   ✅ -pthread 消费点 $n 处"

if [ "$CLEAN" = 1 ]; then
  echo "== ③ make clean（旗标变了必须全量：不 clean 的话 make 按 mtime 判定「无事可做」，"
  echo "      实测会得到一份**非 atomics** 的树却毫不报错 —— 见 PLAN-threads §6）"
  emmake make clean > /tmp/lane-tree-clean.log 2>&1 || true
fi

echo "== ④ make -k -j$JOBS（数小时；日志 /tmp/lane-tree-make.log）"
emmake make -k -j"$JOBS" > /tmp/lane-tree-make.log 2>&1; rc=$?
echo "make rc=$rc（⚠️ rc≠0 也可能正常：`octave-cli` 因 zgejsv_ 未定义**一贯失败**，web 链接容忍它）"
tail -5 /tmp/lane-tree-make.log
echo "--- atomics 违规（应为 0）: $(grep -c "shared-memory is disallowed" /tmp/lane-tree-make.log || true)"

echo "== ⑤ make install → $PREFIX（`.oct` 车道要用它的头/库）"
emmake make install > /tmp/lane-tree-install.log 2>&1; echo "install rc=$?"
ls -d "$PREFIX/include/octave-"* 2>/dev/null | head -3
echo "TREE-LANE-DONE"
