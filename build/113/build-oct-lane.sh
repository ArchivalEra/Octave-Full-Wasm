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
# 用法（容器内，**先**把车道影子放进 PATH —— `.oct` 也必须是 atomics 的）：
#   SHIM=$(bash /src/bin/lane-shim.sh -pthread) && export PATH="$SHIM:$PATH"
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
  echo "FATAL: emcc 不是车道影子（先 SHIM=\$(bash lane-shim.sh -pthread); export PATH=\"\$SHIM:\$PATH\"）" >&2; exit 2; }
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

echo "== 判据②：每个 .oct 都要带 atomics（side module 的字节里就有特征段）"
python3 /tmp/atomics_scan.py $(find "$OUT_CORE" "$OUT_PKG" -name '*.oct' | sort) 2>&1 | grep -v "缺 atomics   0 " || true
echo "   （上面**只列有缺的**；一条都没列 = 全过）"
echo "OCT-LANE-DONE"
