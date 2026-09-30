#!/bin/bash
# Octave-Full-Wasm — **E2 车道（USE_THREAD=1 的 OpenBLAS）重建驱动**（工单 27，2026-09-30）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么要有它：工单 19 把"`USE_THREAD=1` 的产物上 dlopen 挂死"修好了（补丁
# `patch-openblas-idle-exit.py`），但那条路原来只活在 NOTES 的**手敲命令**里 —— 与
# `relink.sh` / `build-w64-lane.sh` 一样，口径必须**搬进代码**，否则下一次重建就会漏掉
# 某个补丁或某个旗标（本仓已踩过：`JSPI_FLAGS` 赋值了却没人引用，全绿但功能不在）。
#
# 用法（**容器内**）：bash /src/bin/build-e2-lane.sh <阶段...>
#   阶段：src  patch  build  pack   all
#   例：  `bash build-e2-lane.sh all`（等价于 src + patch + build + pack）
# 产物：$OUTLIB/librefblas.a（默认 /src/work/e2-openblas-lib-idleexit）
# 之后重链（**车道影子由 relink.sh 入口自己挂** —— 工单 26）：
#   E2_OPENBLAS=$OUTLIB bash /src/bin/relink.sh link threads --out <目录> [--diag]
#
# 判据（工单 19 用的四条，重建后照跑）：
#   CELLS=C,D,H sh test/browser/run.sh test/browser/probe-e2-threads.mjs <该产物站点>   # 全返回
#   矩阵乘 500x500 中位数 ≈ 0.006 s（与补丁前相同 ⇒ 6.7× 收益未丢）
set -u

# ── 宿主直跑：自动委托给容器（与 probe-wasm64-link.sh 同款）──────────────────────
if [ ! -f /src/bin/relink.sh ]; then
  C="${C:-o113}"
  sudo docker start "$C" >/dev/null 2>&1 || true
  exec sudo docker exec "$C" bash /src/bin/build-e2-lane.sh "$@"
fi

SRC_OPENBLAS="${SRC_OPENBLAS:-/src/work/OpenBLAS-0.3.34}"   # 干净来源
WORKDIR="${WORKDIR:-/src/work/OpenBLAS-e2}"                 # 车道工作树
OUTLIB="${OUTLIB:-/src/work/e2-openblas-lib-idleexit}"      # 打包产物目录
LOGD="${LOGD:-/src/work/e2-lane-logs}"
WRAPPERS="${WRAPPERS:-/src/work/e2-f77-wrappers.o}"         # f77 包装对象（gen-f77-wrappers.py 产）
JOBS="${JOBS:-$(nproc 2>/dev/null || echo 12)}"
mkdir -p "$LOGD" "$OUTLIB"

say () { echo; echo "── $*"; }

stage_src () {
  say "[src] 干净副本 $SRC_OPENBLAS → $WORKDIR（排除构建产物）"
  [ -d "$SRC_OPENBLAS" ] || { echo "FATAL: 找不到干净来源 $SRC_OPENBLAS" >&2; return 1; }
  tar -C "$SRC_OPENBLAS" --exclude='*.o' --exclude='*.a' --exclude='*.so' \
      --exclude='config.h' --exclude='Makefile.conf' -cf - . \
    | tar -C "$WORKDIR" -xf - || return 1
  # 零值守卫：抄完得真有源码（空目录不是"干净"，是"抄错了"）
  local n; n=$(find "$WORKDIR" -maxdepth 1 -name '*.c' -o -maxdepth 1 -name 'Makefile*' | wc -l)
  [ "$n" -gt 0 ] || { echo "FATAL: $WORKDIR 里没有源码（拷贝失败？）" >&2; return 1; }
  echo "   ✅ $WORKDIR 就绪（顶层源码条目 $n）"
}

# ★ 补丁阶段的形状（工单 27 第①步的核心）：**用 `--check` 的退出码当契约，不解析话术**。
#   为什么：四个补丁的 `--check` 各说各的（"待改 0 行"/"patched"/"0 处待改"/"已打"），
#   解析文本必然脆（第一版就写死成"已打/可打"两种词，当场 FATAL 误报）。
#   退出码才是机器可读的：rc=0 ⇒ 目标已是"已打补丁"状态。
#   注意"可打"也用 rc=0（idle-exit 的 `--check` 两种状态都返 0）⇒ **不能只看 rc 决定要不要 apply**，
#   所以这里 apply 之后**再跑一次 --check 必须仍 rc=0** —— 那才是"最终处于已打状态"的证据。
PATCHES="patch-openblas-symbol-prefix.py:ob_ patch-openblas-emscripten.py: patch-openblas-f77-ret.py: patch-openblas-idle-exit.py:"

check_one () {  # $1=补丁名  $2=附加参数（可空）⇒ 打印末行并把 rc 放进 $?
  local f="$1" extra="$2" out
  if [ -n "$extra" ]; then out=$(python3 "/src/bin/$f" --check "$WORKDIR" "$extra" 2>&1); else out=$(python3 "/src/bin/$f" --check "$WORKDIR" 2>&1); fi
  local rc=$?
  echo "      $f --check（rc=$rc）：$(printf '%s' "$out" | tail -1)" >&2
  return "$rc"
}

stage_patch () {
  say "[patch] 四个补丁（`--check` 退出码当契约 + apply 后复查）"
  local spec f extra out
  for spec in $PATCHES; do
    f="${spec%%:*}"; extra="${spec#*:}"
    [ -f "/src/bin/$f" ] || { echo "FATAL: 缺补丁脚本 /src/bin/$f" >&2; return 1; }
    # 契约（idle-exit 的 `--check` 已把退出码做成契约）：0=已打 ⇒ 跳过；1=可打 ⇒ apply 后复查；3=不可打 ⇒ FATAL。
    # ⚠️ 第一版踩过的坑：idle-exit 的 `--check` 曾**两种状态都返 0** ⇒ "rc=0 就跳过"会漏打；
    #    而"一律 apply"又会撞上 f77-ret（它按需用，已打状态下 apply 会失败）。
    #    ⇒ 退出码必须是真契约（已在 idle-exit 里改正 + 自证），驱动只按它分支。
    check_one "$f" "$extra"; crc=$?
    case "$crc" in
      0) echo "   = $f：已打（幂等，跳过）" ;;
      1) if [ -n "$extra" ]; then python3 "/src/bin/$f" --apply "$WORKDIR" "$extra" >/dev/null; else python3 "/src/bin/$f" --apply "$WORKDIR" >/dev/null; fi \
           || { echo "FATAL: $f --apply 失败" >&2; return 1; }
         echo "   + $f：已 apply"
         check_one "$f" "$extra" || { echo "FATAL: $f apply 后 --check 仍非 0" >&2; return 1; } ;;
      *) echo "FATAL: $f --check 说『不可打』（rc=$crc）—— 源码版本变了？先人工核，别硬打" >&2; return 1 ;;
    esac
  done
  # 自证：idle-exit 的标记必须在源码里（"打了但没生效"是本仓最贵的坑形状）
  grep -q "OCTAVE-WASM-IDLE-EXIT" "$WORKDIR/driver/others/blas_server.c" \
    || { echo "FATAL: idle-exit 标记不在 blas_server.c 里 ⇒ 补丁没落地" >&2; return 1; }
  echo "   ✅ 四补丁就位（含 OCTAVE-WASM-IDLE-EXIT 自证）"
}

stage_build () {
  say "[build] make（USE_THREAD=1 + SIMD，-j$JOBS）→ 日志 $LOGD/make.log"
  cd "$WORKDIR" || return 1
  set +e
  make TARGET=WASM128_GENERIC USE_THREAD=1 NO_LAPACK=1 NO_SHARED=1 \
       NUM_THREADS=4 E2PREFIX=ob_ CC="ccache emcc -pthread" FC="/src/bin/emf77 -pthread" \
       HOSTCC=gcc -j"$JOBS" > "$LOGD/make.log" 2>&1
  local rc=$?
  set -e
  # ⚠️ `tests`（utest/*.exe）失败是**已知无妨**（我们不需要测试程序），但**库本体必须有**
  local lib; lib=$(ls -1 libopenblas_*r0.3.34.a 2>/dev/null | head -1)
  if [ -z "$lib" ]; then
    echo "FATAL: make rc=$rc 且**没有产出 libopenblas_*.a** —— 这不是'只有 utest 失败'。第一面墙在 $LOGD/make.log" >&2
    tail -12 "$LOGD/make.log" >&2; return 1
  fi
  echo "   make rc=$rc（utest 失败无妨）；库：$lib"
  echo "   ✅ 库本体就绪"
}

stage_pack () {
  say "[pack] 组装 librefblas.a（摘 c_abs.o + 挂 f77 包装对象）→ $OUTLIB"
  cd "$WORKDIR" || return 1
  local lib; lib=$(ls -1 libopenblas_*r0.3.34.a 2>/dev/null | head -1)
  [ -n "$lib" ] || { echo "FATAL: 没有 libopenblas_*.a（先跑 build）" >&2; return 1; }
  [ -f "$WRAPPERS" ] || { echo "FATAL: 缺 f77 包装对象 $WRAPPERS（先跑 gen-f77-wrappers.py）" >&2; return 1; }
  cp -f "$lib" "$OUTLIB/librefblas.a" || return 1
  cd "$OUTLIB" || return 1
  emar d librefblas.a c_abs.o >/dev/null 2>&1 || true
  emar r librefblas.a "$WRAPPERS" || return 1
  # 零值守卫：打包完得**有**符号（空归档 = 打错了，不是"干净"）
  local n; n=$(emnm librefblas.a 2>/dev/null | grep -c ' T \| t ' || true)
  [ "${n:-0}" -gt 0 ] || { echo "FATAL: $OUTLIB/librefblas.a 里量不到符号" >&2; return 1; }
  echo "   ✅ $OUTLIB/librefblas.a（$(stat -c%s librefblas.a) 字节，符号 $n 条）"
  echo "   下一步（车道影子由入口自己挂）：E2_OPENBLAS=$OUTLIB bash /src/bin/relink.sh link threads --out <目录> [--diag]"
}

rc=0
for s in "$@"; do
  case "$s" in
    src|patch|build|pack) "stage_$s" || { rc=$?; echo "❌ 阶段 $s 失败（rc=$rc）"; break; } ;;
    all) for t in src patch build pack; do "stage_$t" || { rc=$?; echo "❌ 阶段 $t 失败（rc=$rc）"; break 2; }; done ;;
    *) echo "未知阶段：$s（可用：src patch build pack all）" >&2; rc=2; break ;;
  esac
done
[ "$rc" = 0 ] && echo "✅ 完成阶段：$*（日志在 $LOGD/）"
exit "$rc"
