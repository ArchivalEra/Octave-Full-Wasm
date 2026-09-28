#!/usr/bin/env bash
# Octave-Full-Wasm — 线程车道的 `.oct` 资产（B6，2026-09-27）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么单独一个脚本：`.oct` 车道是**三批 + 两个特殊依赖**拼出来的（清单见 `PLAN-threads.md` §6
# 的表，那是从现役站点 `assets/manifest.json` 的 16 条 `kind:oct` 反查来的），手拼必漏；
# 而漏一个的后果是**功能静默缺失**（资产没登记 ⇒ 那个函数就是不存在），只有对照清单才看得见。
#
# 判据（三条，都要绿）：
#   ① 文件名清单与现役站点 manifest 的 16 条**逐字一致**；
#   ② 每个 `.oct` 都带 `atomics`（它是 wasm side module，直接扫字节）；
#   ③ 产物落在**车道目录**（`/src/libwork/octs-threads*`），现役那几份一字不动。
#
# 用法（容器内，**先**把车道影子放进 PATH —— `.oct` 必须是 atomics 的，且**必须**带上
# `-fno-threadsafe-statics`，理由见下面第 ⑧ 条判据）：
#   SHIM=$(PATH=/src/bin:$PATH bash /src/bin/lane-shim.sh "-pthread -fno-threadsafe-statics") \
#     && export PATH="$SHIM:$PATH"
#   bash /src/bin/build-oct-lane.sh
set -euo pipefail

SRC="${SRC:-/src/work/octave-11.3.0}"
OCT_INSTALL="${OCT_INSTALL:-/src/work/octave-install-threads}"   # 线程档的头/库
OUT_CORE="${OUT_CORE:-/src/libwork/octs-threads}"
OUT_PKG="${OUT_PKG:-/src/libwork/octs-threads-pkg}"
SUNDIALS_PREFIX="${SUNDIALS_PREFIX:-/src/deps-threads/sundials}"
SITE_MANIFEST="${SITE_MANIFEST:-/mnt/hdd/octave-wasm-build/site/assets/manifest.json}"
FORGE="${FORGE:-/src/forge}"

TREE_MODS="__delaunayn__ __glpk__ __voronoi__ audioread convhulln fftw gzip __init_fltk__ __init_gnuplot__"
CC_SRCS="webio:/src/websrc/webio.cc __init_web__:/src/websrc/web_graphics_toolkit.cc \
         __web_pause_ms__:/src/websrc/webpause.cc __fltk_uigetfile__:/src/websrc/webfilepick.cc \
         webimage-oct:/src/websrc/webimage.cc webnet-oct:/src/websrc/webnet.cc"

command -v emcc >/dev/null || { echo "FATAL: PATH 里没有 emcc" >&2; exit 2; }
head -3 "$(command -v emcc)" | grep -q "车道影子" || {
  echo "FATAL: emcc 不是车道影子（先 SHIM=\$(bash lane-shim.sh -pthread -fno-threadsafe-statics); export PATH=\"\$SHIM:\$PATH\"）" >&2; exit 2; }
# ★ 判据 ⑧（2026-09-27，实测事故）：影子的旗标里**必须**有 `-fno-threadsafe-statics`。
# 为什么（三行实测，容器里可复跑）：
#   · `em++ -O2 -c g2.cpp`（有动态 static 初始化）⇒ `__cxa_guard` 出现 **0** 次（emcc 默认就关）；
#   · 加 `-pthread` ⇒ **3** 次（clang 改回线程安全静态）；
#   · 再加 `-fno-threadsafe-statics` ⇒ **0** 次。
#   而两档的**主模块都不提供** `__cxa_guard_acquire/release`（实测 `llvm-nm --defined-only
#   --extern-only` 在基础/线程两份 wasm 里都没有）⇒ 线程档里那个引用了守卫的 `.oct` 在第一次
#   动态静态初始化时崩：`TypeError: resolved is not a function`（accept-dldfcn 的 audiowrite，
#   实测；基础档同套件 71/0 绿）。⇒ 车道 `.oct` 与基础档保持**同一套静态初始化语义**（都关）。
head -3 "$(command -v emcc)" | grep -q -- "-fno-threadsafe-statics" || {
  echo "FATAL: 车道影子缺 -fno-threadsafe-statics ⇒ 编出来的 .oct 会引用两档主模块都不提供的" >&2
  echo "       __cxa_guard_acquire/release（第一次动态静态初始化就 TypeError: resolved is not a function）" >&2
  echo "       重做影子：SHIM=\$(PATH=/src/bin:\$PATH bash /src/bin/lane-shim.sh \"-pthread -fno-threadsafe-statics\")" >&2
  exit 2; }
[ -d "$OCT_INSTALL/include" ] || { echo "FATAL: 缺线程档安装头 $OCT_INSTALL（先配线程档并 make install）" >&2; exit 2; }

mkdir -p "$OUT_CORE" "$OUT_PKG"

echo "== ① 树内 dldfcn（$TREE_MODS）→ $OUT_CORE"
OUT="$OUT_CORE" PREFIX="$OCT_INSTALL" bash /src/bin/build-oct.sh $TREE_MODS

echo "== ② --cc 批（websrc 那 6 个）→ $OUT_CORE"
# shellcheck disable=SC2086
OUT="$OUT_CORE" PREFIX="$OCT_INSTALL" CC_SRCS="$CC_SRCS" bash /src/bin/build-oct.sh --cc

echo "== ③ __ode15__（要车道版 sundials；build-ode15.sh 自己建 sundials 到 SUNDIALS_PREFIX）"
# ⚠️ build-ode15.sh 的用法是**无参数**：输出目录走 `OUT` 环境变量（实测踩过：传位置参数被忽略）
OUT="$OUT_CORE" PREFIX="$OCT_INSTALL" INST="$OCT_INSTALL" SUNDIALS_PREFIX="$SUNDIALS_PREFIX" bash /src/bin/build-ode15.sh > /tmp/oct-lane-ode15.log 2>&1 \
  || { echo "FATAL: __ode15__ 失败（见 /tmp/oct-lane-ode15.log）" >&2; tail -20 /tmp/oct-lane-ode15.log >&2; exit 1; }

echo "== ④ Forge 包（含 control 的 slicot 调度模块）→ $OUT_PKG"
OUTROOT="$OUT_PKG" PREFIX="$OCT_INSTALL" DEPS="${DEPS:-/usr/local}" bash /src/bin/build-pkg-oct.sh all > /tmp/oct-lane-pkg.log 2>&1 \
  || { echo "FATAL: 包车道失败（见 /tmp/oct-lane-pkg.log）" >&2; tail -20 /tmp/oct-lane-pkg.log >&2; exit 1; }

echo "== ④b slicot 调度模块（唯一需要**静态链库**的那个 .oct）"
# ⚠️ 这一段的**顺序有讲究**：配方（`NOTES-slicot.md` §5.8）是
#   `common.oct.o` → `slicotlibrary-nodup.a` → `liblapack.a` → `librefblas.a` → `libf2c-subset.a`
#   → `f2c-io-shim.c`。第二版漏了**第一段** `common.oct.o`（= 编译 `control/src/common.cc`），
#   后果：模块比基础档多导入 8 个助手符号（`_Z3maxii`/`_Z3minii`/`error_msg`/`warning_msg`…），
#   而主模块两档都不导出它们 ⇒ `step` 首次调用崩 `TypeError: resolved is not a function`
#   （accept-forge2 43/1、accept-slicot 13/12 实测）。判据见本步末尾 + `check-oct-lane.py` 判据③。
# 为什么单列：`build-pkg-oct.sh` 明确**不建** slicot（见它的注释），调度模块是独立一步
# （`build/113/NOTES-slicot.md` 的 §5.8 是配方）。它靠 `OCT_LIBS=` **把整条链静态打进 .oct**。
#
# ★ 2026-09-27 实测事故（accept-forge2 的 `step` 崩 `TypeError: resolved is not a function`）：
#   第一版只链了 `slicotlibrary.a` ⇒ 模块 2.97MB、`dgemm_/dlamch_/dggev_` 等 **226 个符号成了
#   导入**（基础档同模块 8.1MB、这些符号**都在模块里**）：主模块**不导出**它们（`llvm-nm
#   --defined-only --extern-only` 两档都没有）⇒ 第一次 BLAS 调用就崩。判据必须看**产物**：
#   模块体积 + "这些符号是定义还是导入"（见本步末尾的第⑨条判据）。
SLICOT_C_SRC="${SLICOT_C_SRC:-/src/libwork/f2c-probe}"     # 已由 f2c 翻译好的 .c（613 个）
SLICOT_OBJ="${SLICOT_OBJ:-/src/libwork-threads/slicot-obj}"
SLICOT_LIB="${SLICOT_LIB:-/src/libwork-threads/slicotlibrary.a}"
SLICOT_NODUP="${SLICOT_NODUP:-/src/libwork-threads/slicotlibrary-nodup.a}"
# ⚠️ BLAS/LAPACK 用**基础档的 PIC 版**（`/src/deps/lapack-pic/`），不用车道那套 `lapack-simd`：
#   车道那套**不是 PIC** ⇒ side module 链接直接报
#   `relocation R_WASM_MEMORY_ADDR_LEB cannot be used against symbol ...; recompile with -fPIC`
#   （实测）。基础档的 slicot 模块用的也是这份 PIC 归档 ⇒ 两档的 slicot 路径**算得完全一样**
#   （行为对齐，也省掉一次 PIC BLAS 重编）。side module 里带自己的 BLAS 副本是**设计使然**：
#   主模块不导出 BLAS（两档都不导出），所以每个需要 BLAS 的 `.oct` 自带一份。
LAPACK_PIC="${LAPACK_PIC:-/src/deps/lapack-pic/lib}"
F2C_SHIM="${F2C_SHIM:-/src/bin/f2c-io-shim.c}"             # libf2c 的两个数据符号垫片（NOTES-slicot §5.8）
CTRL_SRC="${CTRL_SRC:-/src/libwork/forge/control-4.1.3/src}"
if [ -d "$SLICOT_C_SRC" ] && [ ! -s "$SLICOT_LIB" ]; then
  mkdir -p "$SLICOT_OBJ"
  ls "$SLICOT_C_SRC"/*.c | xargs -P "$(nproc)" -I{} sh -c '
    f="$1"; o="'"$SLICOT_OBJ"'/$(basename "${f%.c}").o"
    [ -s "$o" ] || emcc -O1 -fPIC -fwasm-exceptions -I'"${DEPS:-/usr/local}"'/include -w -c "$f" -o "$o"
  ' _ {}
  emar rcs "$SLICOT_LIB" "$SLICOT_OBJ"/*.o
  echo "   ✅ 车道 slicotlibrary.a（$(stat -c%s "$SLICOT_LIB") 字节）"
fi
# nodup：去掉与 liblapack 重复的三个成员（否则 `--allow-multiple-definition` 会静默吞掉重复定义）
if [ -s "$SLICOT_LIB" ]; then
  cp -f "$SLICOT_LIB" "$SLICOT_NODUP"
  emar d "$SLICOT_NODUP" dgegs.o dlatzm.o zlatzm.o 2>/dev/null || true
  echo "   nodup 成员 $(ar t "$SLICOT_NODUP" | wc -l)（全量 $(ar t "$SLICOT_LIB" | wc -l)）"
fi
[ -s "$F2C_SHIM" ] || { echo "FATAL: 缺 $F2C_SHIM（宿主上：sudo docker cp build/113/f2c-io-shim.c o113:/src/bin/）" >&2; exit 2; }
# common.cc → common.oct.o（拿 build-oct.sh 自己的 FLAGS 编，省得手抄 20 个 -I）
COMMON_OBJ="${COMMON_OBJ:-$OUT_CORE/common.oct.o}"
if [ ! -s "$COMMON_OBJ" ]; then
  rm -rf /tmp/oct-lane-common && mkdir -p /tmp/oct-lane-common
  OUT=/tmp/oct-lane-common PREFIX="$OCT_INSTALL" \
    CC_SRCS="common:$CTRL_SRC/common.cc" bash /src/bin/build-oct.sh --cc > /tmp/oct-lane-common.log 2>&1 || true
  [ -s /tmp/oct-lane-common/common.oct.o ] || {
    echo "FATAL: common.oct.o 没编出来（见 /tmp/oct-lane-common.log）" >&2; tail -12 /tmp/oct-lane-common.log >&2; exit 1; }
  cp /tmp/oct-lane-common/common.oct.o "$COMMON_OBJ"
fi
echo "   common.oct.o: $(stat -c%s "$COMMON_OBJ") 字节"
if [ -s "$SLICOT_NODUP" ]; then
  OUT="$OUT_CORE" OCT_INCS="-I$CTRL_SRC" PREFIX="$OCT_INSTALL" \
    OCT_LIBS="$COMMON_OBJ $SLICOT_NODUP $LAPACK_PIC/liblapack.a $LAPACK_PIC/librefblas.a $LAPACK_PIC/libf2c-subset.a $F2C_SHIM" \
    CC_SRCS="__control_slicot_functions__:$CTRL_SRC/__control_slicot_functions__.cc" \
    bash /src/bin/build-oct.sh --cc || { echo "FATAL: slicot 调度模块构建失败" >&2; exit 1; }
  echo "   ✅ __control_slicot_functions__.oct"
  # 判据⑨（产物侧）：BLAS/LAPACK 入口必须是**定义**在模块里，不是导入 —— 这正是上面那次事故的形状
  OCT_SLICOT="$OUT_CORE/__control_slicot_functions__.oct"
  NM="$(command -v llvm-nm || echo /emsdk/upstream/bin/llvm-nm)"
  if [ -x "$NM" ]; then
    ndef="$("$NM" --defined-only "$OCT_SLICOT" | grep -cE ' (dgemm_|dlamch_|lsame_|dggev_)$' || true)"
    if [ "${ndef:-0}" -lt 3 ]; then
      echo "FATAL: slicot 模块里只定义了 $ndef 个 BLAS/LAPACK 入口（应 ≥3）⇒ 静态库没链进去，" >&2
      echo "       这些符号会变成导入，而主模块**不导出**它们 ⇒ 第一次调用就" >&2
      echo "       \`TypeError: resolved is not a function\`（accept-forge2 的 step 实测崩过）" >&2
      exit 1
    fi
    echo "   判据⑨：模块内定义 BLAS/LAPACK 入口 $ndef 个（非导入），体积 $(stat -c%s "$OCT_SLICOT") 字节 ✓"
  else
    echo "   ⚠️ 找不到 llvm-nm ⇒ 判据⑨**没做**（不是通过）"
  fi
fi

echo "== ⑤ 判据①：文件名清单 vs 现役站点 manifest 的 kind:oct 条目"
python3 - "$SITE_MANIFEST" "$OUT_CORE" "$OUT_PKG" <<'PY'
import json, os, sys
man, core, pkg = sys.argv[1], sys.argv[2], sys.argv[3]
want = []
try:
    m = json.load(open(man, encoding="utf-8"))
    want = sorted(a["url"].rsplit("/", 1)[-1] for a in m.get("assets", []) if a.get("kind") == "oct")
    want += sorted(f for a in m.get("assets", []) if a.get("kind") == "octdir"
                   for f in (a.get("files") or []) if f.endswith(".oct"))
except OSError:
    print("   （读不到现役 manifest：%s ⇒ **这条判据没做**）" % man)
got = sorted(f for d in (core, pkg) for _r, _d, fs in os.walk(d) for f in fs if f.endswith(".oct"))
miss = [f for f in want if f not in got]
extra = [f for f in got if f not in want]
print("   现役 %d 个 / 车道 %d 个；缺 %s；多 %s"
      % (len(want), len(got), miss or "无", extra or "无"))
sys.exit(1 if miss else 0)
PY

echo "== 判据②：每个 .oct 必须含 **TLS 初始化入口**（-pthread 编出来的才有）"
# ⚠️ 不能用 atomics_scan 判 .oct：.oct 是链接后的 side module、不带 target_features 段
#    ⇒ 那样会把全部 44 个（含正确编出来的）都判成「缺 atomics」（实测踩到）。
#    正确判据来自 B5 的失败原文（TypeError: tlsInitFunc is not a function）；
#    反向断言（基础档不该有入口）在宿主侧做 —— 见 build/113/stage-lane-assets.sh。
if [ -d "${BASE_OCT_DIR:-/tmp/base-oct}" ]; then
  python3 /src/bin/check-oct-lane.py "$OUT_CORE" "$OUT_PKG" --base "${BASE_OCT_DIR:-/tmp/base-oct}"
else
  python3 /src/bin/check-oct-lane.py "$OUT_CORE" "$OUT_PKG"
fi
echo "OCT-LANE-DONE"
