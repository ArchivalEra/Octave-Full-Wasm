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
# ★ **车道参数 `E2_LANE`（2026-10-01，工单 31）**：`threads`（默认）| `w64`。
#   为什么要它：用户点名的目标是 **`w64` + 线程版 OpenBLAS**（memory64 与 USE_THREAD=1 的组合），
#   而这两个参数**在编译期**（`-sMEMORY64=1`）就分岔 ⇒ 必须**分别建库**，不能共用：
#     · `threads`：`WORKDIR=…/OpenBLAS-e2`、`OUTLIB=…/e2-openblas-lib-idleexit`、旗标 `-pthread`
#     · `w64`    ：`WORKDIR=…/OpenBLAS-e2-w64`、`OUTLIB=…/e2-openblas-lib-w64`、旗标 `-pthread -sMEMORY64=1`
#   ⚠️ 架构断言是**硬判据**：w64 车道的库里每个成员都必须是 wasm64（side module 的指针宽度
#      必须与主模块一致；本仓踩过"换旗标不清树 ⇒ make 零重编 ⇒ 静默 wasm32"，见 HISTORY §5.71/gplk 悬案）。
#
# 判据（工单 19 用的四条，重建后照跑）：
#   CELLS=C,D,H sh test/browser/run.sh test/browser/probe-e2-threads.mjs <该产物站点>   # 全返回
#   矩阵乘 500x500 中位数 ≈ 0.006 s（与补丁前相同 ⇒ 6.7× 收益未丢）
set -u

# ── 车道表（口径进代码；不设 = threads，与历史行为一致）────────────────────────
E2_LANE="${E2_LANE:-threads}"
case "$E2_LANE" in
  threads) LANE_FLAGS="-pthread" ;;
  w64)     LANE_FLAGS="-pthread -sMEMORY64=1" ;;
  *) echo "FATAL: 未知 E2_LANE='$E2_LANE'（可用 threads|w64）" >&2; exit 2 ;;
esac

# ── 宿主直跑：自动委托给容器（与 probe-wasm64-link.sh 同款）──────────────────────
if [ ! -f /src/bin/relink.sh ]; then
  C="${C:-o113}"
  sudo docker start "$C" >/dev/null 2>&1 || true
  exec sudo docker exec -e "E2_LANE=$E2_LANE" "$C" bash /src/bin/build-e2-lane.sh "$@"
fi

SRC_OPENBLAS="${SRC_OPENBLAS:-/src/work/OpenBLAS-0.3.34}"   # 干净来源
if [ "$E2_LANE" = w64 ]; then
  WORKDIR="${WORKDIR:-/src/work/OpenBLAS-e2-w64}"           # 车道工作树
  OUTLIB="${OUTLIB:-/src/work/e2-openblas-lib-w64}"         # 打包产物目录
  LOGD="${LOGD:-/src/work/e2-lane-logs/w64}"
  # E2_CC_EXTRA：额外的内核编译定义（如 -DARCH_WASM 点亮 intrin.h 的 V_SIMD wasm 后端，
  #   票 39/L1 —— intrin_wasm.h 一直在树上，缺的只是这个宏；配合 -msimd128 使用）。
  # ★ 默认 = **merged3 合并版**（76 包装 + 23 透传壳，工单 36）：裸 76 版缺透传壳 ⇒
  #   `lsame_` 等无人定义 ⇒ 链接落空自引用 ⇒ 页面爆栈（2026-10-02 票 04 L4 实测抓到）。
  #   换 WORKDIR/OUTLIB 做实验时**这个默认就是护栏**。
  WRAPPERS="${WRAPPERS:-/src/work/e2-f77-wrappers-w64-merged3.o}"   # f77 包装对象（**必须也是 wasm64**）
else
  WORKDIR="${WORKDIR:-/src/work/OpenBLAS-e2}"
  OUTLIB="${OUTLIB:-/src/work/e2-openblas-lib-idleexit}"
  LOGD="${LOGD:-/src/work/e2-lane-logs}"
  WRAPPERS="${WRAPPERS:-/src/work/e2-f77-wrappers.o}"
fi
JOBS="${JOBS:-$(nproc 2>/dev/null || echo 12)}"
mkdir -p "$LOGD" "$OUTLIB"

say () { echo; echo "── $*"; }

stage_src () {
  say "[src] 干净副本 $SRC_OPENBLAS → $WORKDIR（排除构建产物）"
  [ -d "$SRC_OPENBLAS" ] || { echo "FATAL: 找不到干净来源 $SRC_OPENBLAS" >&2; return 1; }
  # ⚠️ 工作树目录得**先建**：`tar -C <不存在>` 直接报 "Cannot open"（实测：w64 车道首次跑就撞上；
  #    threads 车道那份是早先手工建过才一直没露馅）。
  mkdir -p "$WORKDIR" || return 1
  tar -C "$SRC_OPENBLAS" --exclude='*.o' --exclude='*.a' --exclude='*.so' \
      --exclude='config.h' --exclude='Makefile.conf' -cf - . \
    | tar -C "$WORKDIR" -xf - || return 1
  # 零值守卫：抄完得真有源码（空目录不是"干净"，是"抄错了"）
  local n; n=$(find "$WORKDIR" -maxdepth 1 -name '*.c' -o -maxdepth 1 -name 'Makefile*' | wc -l)
  [ "$n" -gt 0 ] || { echo "FATAL: $WORKDIR 里没有源码（拷贝失败？）" >&2; return 1; }
  echo "   ✅ $WORKDIR 就绪（顶层源码条目 $n）"

  # ★ E2_ARCH_WASM_INTRIN=1：点亮 intrin.h 的 V_SIMD wasm 后端（票 39/L1）。上游守卫
  #   `defined(ARCH_WASM) && defined(__wasm_simd128__)` 里 ARCH_WASM 从未被 Makefile 定义
  #   （死代码），而 -D 通路会泄漏进 getarch 宿主探测（实测 ARCH 变空 ⇒ Makefile.$(ARCH) 炸）
  #   ⇒ 正解 = src 阶段后直接改 WORKDIR 内核树的守卫（内核编译已有 -msimd128）。
  if [ "${E2_ARCH_WASM_INTRIN:-}" = "1" ]; then
    sed -i 's/#if defined(ARCH_WASM) && defined(__wasm_simd128__)/#if defined(__wasm_simd128__)/' "$WORKDIR/kernel/simd/intrin.h"
    sed -i 's/defined(ARCH_WASM)/1/' "$WORKDIR/kernel/arm/sum.c"
    # ★ 内核表改指：构建实际读的是 **kernel/wasm/KERNEL（默认表）**（getarch 的 ARCH=wasm
    #   决定 include 路径；KERNEL.WASM128_GENERIC 不被读 —— 实测编译行 = ../riscv64/dot.c）。
    #   DDOT 改指 generic/dot.c（唯一带 V_SIMD 分支的 dot 内核，已实证 46 f64x2）。
    sed -i 's|^DDOTKERNEL   = ../riscv64/dot.c|DDOTKERNEL   = ../generic/dot.c|' "$WORKDIR/kernel/wasm/KERNEL"
    say "[src] V_SIMD wasm 守卫点亮 + DDOTKERNEL→generic（E2_ARCH_WASM_INTRIN=1）"
  fi
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
  say "[patch] 四个补丁（--check 的退出码当契约 + apply 后复查）"
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
  say "[build] make（USE_THREAD=1 + SIMD，车道旗标：$LANE_FLAGS，-j$JOBS）→ 日志 $LOGD/make.log"
  cd "$WORKDIR" || return 1
  # ★ **先强制 clean**（2026-10-01 实测踩到）：`patch-openblas-symbol-prefix.py` 改的是
  #   `Makefile.system` 里的 `-DNAME=` —— **那不是文件依赖**，make 按 mtime 判"全部最新"
  #   ⇒ **零重编**，把没前缀的旧对象原样重打包（本仓对这条形状有专名：见 NOTES-wasm64 的
  #   glpk 悬案"换旗标不清树 ⇒ make 零重编 ⇒ 静默错误架构"）。症状离根因很远：链到 wasm-opt
  #   才炸（76 条 mismatch 一条没消）。
  set +e
  emmake make clean > "$LOGD/make-clean.log" 2>&1
  set -e
  set +e
  make TARGET=WASM128_GENERIC USE_THREAD=1 NO_LAPACK=1 NO_SHARED=1 \
       NUM_THREADS="${E2_NUM_THREADS:-4}" E2PREFIX=ob_ CC="ccache emcc $LANE_FLAGS ${E2_CC_EXTRA:-}" FC="/src/bin/emf77 $LANE_FLAGS" \
       HOSTCC=gcc COMMON_OPT="${E2_COMMON_OPT:--O3}" -j"$JOBS" > "$LOGD/make.log" 2>&1
  local rc=$?
  set -e
  # ⚠️ `tests`（utest/*.exe）失败是**已知无妨**（我们不需要测试程序），但**库本体必须有**
  local lib; lib=$(ls -1 libopenblas_*r0.3.34.a 2>/dev/null | head -1)
  if [ -z "$lib" ]; then
    echo "FATAL: make rc=$rc 且**没有产出 libopenblas_*.a** —— 这不是'只有 utest 失败'。第一面墙在 $LOGD/make.log" >&2
    tail -12 "$LOGD/make.log" >&2; return 1
  fi
  echo "   make rc=$rc（utest 失败无妨）；库：$lib"
  # ★ **"utest 失败无妨"不是"什么失败都无妨"**（2026-10-01 实测，第 6 条真缺陷）：
  #   符号前缀补丁没打上时，`blas_server.c` 在 wasm64 sysroot 下编不过 ⇒ 少了
  #   `blas_server.o`（它定义 `blas_cpu_number`）⇒ 库**缺成员**，而这里只看"库文件在不在"
  #   ⇒ 打包、链接**全过**（`verdict=ok`），**运行期页面崩**（`bad export type for
  #   'blas_cpu_number'`）。⇒ 判据必须落到**报错目标**上：utest/tests 之外的 `Error 1` 一律红。
  local bad_err
  #   判据落到**目标类型**上：`Error 1` 且目标**不是** `.exe`（utest 的测试程序是已知无妨的）
  #   ⇒ 才是"真有一块没编出来"。为什么不用 `utest|tests/` 过滤：实测那些测试程序**由顶层
  #   Makefile 构建**，报错行是 `Makefile:265: xscblat1.exe`（路径里根本没有 utest）⇒
  #   第一版把这批误判成致命（自己的判据先假红）。
  bad_err=$(grep -E "^make(\[[0-9]+\])?: \*\*\* .*Error 1" "$LOGD/make.log" \
            | grep -vE "\.exe($| |\])" | head -5 || true)
  if [ -n "$bad_err" ]; then
    echo "FATAL: make 里有 utest/tests 之外的失败 —— 库很可能是**缺成员**的（别打包）：" >&2
    printf '%s\n' "$bad_err" | sed 's/^/       /' >&2
    echo "       根因常是某个补丁没打上（补丁的 --check 退出码必须是契约）——先看 $LOGD/make.log" >&2
    return 1
  fi
  # ★ 架构断言（w64 车道硬判据）：与农场 `build-libs.sh:need_arch` **同一条判据** ——
  #   用 `llvm-readobj -h <归档>` 数 `Arch: wasm` vs `Arch: wasm64`，**逐成员**全绿才算过。
  #   ⚠️ 实测踩到的坑（2026-10-01，本单车库第一次跑就撞上）：**`Format:` 行恒为 `WASM`**，
  #      位数在 **`Arch:`** 行（`wasm64` / `AddressSize: 64bit`）⇒ 拿 `Format:` 当判据会
  #      把一份正确的 wasm64 库判成 wasm32（假红）；反过来若只看单个成员也漏（本仓 glpk 悬案
  #      就是"部分成员是旧架构"静默通过）。判据必须**逐成员计数**。
  if [ "$E2_LANE" = w64 ]; then
    local ro=/emsdk/upstream/bin/llvm-readobj total w64n
    [ -x "$ro" ] || ro=llvm-readobj
    local hdr; hdr=$("$ro" -h "$lib" 2>/dev/null)
    total=$(printf '%s\n' "$hdr" | grep -c 'Arch: wasm$' || true)
    w64n=$(printf '%s\n' "$hdr" | grep -c 'Arch: wasm64' || true)
    if [ "${total:-0}" -ne 0 ] || [ "${w64n:-0}" -eq 0 ]; then
      echo "FATAL: $lib 架构断言失败：$w64n 个 wasm64 / $total 个 wasm32（车道声明 MEMORY64，要求 wasm32=0）" >&2
      echo "       典型原因：旗标通道没进编译（影子没挂 / 树没清，make 零重编）——见 NOTES-wasm64.md" >&2
      return 1
    fi
    echo "   ✅ 架构断言：$w64n 个成员全是 wasm64（wasm32=0）"
  fi
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

stage_pack_raw () {
  # ★ **先打一份不含 f77 包装的归档**（2026-10-01，工单 31）：E2 的包装对象是**从链接器的
  #   `function signature mismatch` 报文生成**的 ⇒ 必须先用"裸库"链一次、把报文收下来。
  #   threads 车道当年是手工走这一步（wrappers 已存在），w64 车道从零开始 ⇒ 这一步要成阶段。
  say "[pack-raw] 裸归档（摘 c_abs.o，**不挂** f77 包装）→ $OUTLIB（供"第一次链接收 mismatch"）"
  cd "$WORKDIR" || return 1
  local lib; lib=$(ls -1 libopenblas_*r0.3.34.a 2>/dev/null | head -1)
  [ -n "$lib" ] || { echo "FATAL: 没有 libopenblas_*.a（先跑 build）" >&2; return 1; }
  cp -f "$lib" "$OUTLIB/librefblas.a" || return 1
  cd "$OUTLIB" || return 1
  emar d librefblas.a c_abs.o >/dev/null 2>&1 || true
  local n; n=$(emnm librefblas.a 2>/dev/null | grep -c ' T \| t ' || true)
  [ "${n:-0}" -gt 0 ] || { echo "FATAL: $OUTLIB/librefblas.a 里量不到符号" >&2; return 1; }
  echo "   ✅ $OUTLIB/librefblas.a（裸，符号 $n 条）⇒ 现在链一次收 mismatch，再 gen-f77-wrappers.py --from-log"
}

rc=0
for s in "$@"; do
  case "$s" in
    src|patch|build|pack|pack-raw)
      # 阶段名里的 `-` 换成 `_` 才是函数名（`stage_pack_raw`）—— 第一版直接 `stage_$s`
      # 会报 `stage_pack-raw: command not found`（实测）。
      "stage_$(printf '%s' "$s" | tr - _)" || { rc=$?; echo "❌ 阶段 $s 失败（rc=$rc）"; break; } ;;
    all) for t in src patch build pack; do "stage_$t" || { rc=$?; echo "❌ 阶段 $t 失败（rc=$rc）"; break 2; }; done ;;
    *) echo "未知阶段：$s（可用：src patch build pack all）" >&2; rc=2; break ;;
  esac
done
[ "$rc" = 0 ] && echo "✅ 完成阶段：$*（日志在 $LOGD/）"
exit "$rc"
