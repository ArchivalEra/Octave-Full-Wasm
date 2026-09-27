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
OUT="$OUT_CORE" SUNDIALS_PREFIX="$SUNDIALS_PREFIX" bash /src/bin/build-ode15.sh > /tmp/oct-lane-ode15.log 2>&1 \
  || { echo "FATAL: __ode15__ 失败（见 /tmp/oct-lane-ode15.log）" >&2; tail -20 /tmp/oct-lane-ode15.log >&2; exit 1; }

echo "== ④ Forge 包（含 control 的 slicot 调度模块）→ $OUT_PKG"
OUTROOT="$OUT_PKG" PREFIX="$OCT_INSTALL" bash /src/bin/build-pkg-oct.sh all > /tmp/oct-lane-pkg.log 2>&1 \
  || { echo "FATAL: 包车道失败（见 /tmp/oct-lane-pkg.log）" >&2; tail -20 /tmp/oct-lane-pkg.log >&2; exit 1; }

echo "== ④b slicot 调度模块（唯一需要**静态链库**的那个 .oct）"
# 为什么单列：`build-pkg-oct.sh` 明确**不建** slicot（见它的注释），调度模块是独立一步
# （`build/113/NOTES-slicot.md` 有配方）。而它 `OCT_LIBS=` 静态链 slicot ⇒ **slicot 库也得是车道版**
# （否则模块里混着非 atomics 对象；本轮判据①先抓到"整块缺失"，判据②会抓"对象不干净"）。
SLICOT_C_SRC="${SLICOT_C_SRC:-/src/libwork/f2c-probe}"     # 已由 f2c 翻译好的 .c（613 个）
SLICOT_OBJ="${SLICOT_OBJ:-/src/libwork-threads/slicot-obj}"
SLICOT_LIB="${SLICOT_LIB:-/src/libwork-threads/slicotlibrary.a}"
CTRL_SRC="${CTRL_SRC:-/src/libwork/forge/control-4.1.3/src}"
if [ -d "$SLICOT_C_SRC" ] && [ ! -s "$SLICOT_LIB" ]; then
  mkdir -p "$SLICOT_OBJ"
  ls "$SLICOT_C_SRC"/*.c | xargs -P "$(nproc)" -I{} sh -c '
    f="$1"; o="'"$SLICOT_OBJ"'/$(basename "${f%.c}").o"
    [ -s "$o" ] || emcc -O1 -fPIC -fwasm-exceptions -I/usr/local/include -w -c "$f" -o "$o"
  ' _ {}
  emar rcs "$SLICOT_LIB" "$SLICOT_OBJ"/*.o
  echo "   ✅ 车道 slicotlibrary.a（$(stat -c%s "$SLICOT_LIB") 字节）"
fi
if [ -s "$SLICOT_LIB" ]; then
  OUT="$OUT_CORE" OCT_INCS="-I$CTRL_SRC" OCT_LIBS="$SLICOT_LIB" \
    CC_SRCS="__control_slicot_functions__:$CTRL_SRC/__control_slicot_functions__.cc" \
    bash /src/bin/build-oct.sh --cc || { echo "FATAL: slicot 调度模块构建失败" >&2; exit 1; }
  echo "   ✅ __control_slicot_functions__.oct"
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
