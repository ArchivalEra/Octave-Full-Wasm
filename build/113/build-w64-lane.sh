#!/bin/bash
# Octave-Full-Wasm — **wasm64 车道全量重编驱动**（2026-09-28，branch `wasm64`）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么要有它：memory64 是 **[compile+link]** 设置 ⇒ 对象必须同旗标重编 ⇒ 这是一整条
# **farm + Octave 树 + `.oct` 车道**的重编（形状与 B6 的车道重建同构）。把它写成一个脚本
# 而不是一串手敲命令的理由，与 `relink.sh` 一样：**口径搬进代码**，且失败时第一面墙留在日志里。
#
# 用法（**容器内**）：bash /src/bin/build-w64-lane.sh <阶段...>
#   阶段：shim  deps  libs  tree  link  oct
#   例如：`bash build-w64-lane.sh libs tree link oct`
#
# ⚠️ 与 B6 车道的区别，别混：
#   B6 = `/usr/local-threads` + `/src/deps-threads`（只多 `-pthread`）
#   本批 = `/usr/local-w64`     + `/src/deps-w64`（`-pthread` **和** `-sMEMORY64=1`）
#   **两套 prefix 必须并存，绝不覆盖现役** —— 8761/8768 的红线是"不许退化"。
set -u

FLAGS='-pthread -sMEMORY64=1 -fno-threadsafe-statics'      # ← 本批的全部新增（B6 只有 -pthread）
SHIM_DIR=/src/libwork/lane-shim-w64
PREFIX_W64=/usr/local-w64
DEPS_W64=/src/deps-w64
LOGD=/src/work/w64-logs
OCT_INSTALL_W64=/src/work/octave-install-w64
SRC="${SRC:-/src/work/octave-11.3.0}"
JOBS="${JOBS:-$(nproc 2>/dev/null || echo 12)}"
mkdir -p "$LOGD"

ensure_shim() {
  if [ ! -d "$SHIM_DIR" ] || [ ! -x "$SHIM_DIR/emcc" ]; then
    stage_shim || return 1
  fi
}

stage_shim() {
  echo "── [shim] 建 w64 影子（注入：$FLAGS）"
  export PATH=/src/bin:$PATH                    # emf77 在 /src/bin（lane-shim 要它）
  bash /src/bin/lane-shim.sh "$FLAGS" "$SHIM_DIR" >/dev/null || return 1
  # 自证：旗标**真的**进了命令行（不是只建了文件 —— 那是"赋值了却没人引用"的形状）
  grep -q -- 'MEMORY64' "$SHIM_DIR/emcc" || { echo "FATAL: 影子没注入 memory64"; return 1; }
  grep -q -- 'pthread'  "$SHIM_DIR/emcc" || { echo "FATAL: 影子没注入 pthread"; return 1; }
  grep -q -- 'fno-threadsafe-statics' "$SHIM_DIR/emcc" || { echo "FATAL: 影子没注入 fno-threadsafe-statics"; return 1; }
  echo "   ✅ 影子：$SHIM_DIR（自证：包装里有 MEMORY64、pthread 与 fno-threadsafe-statics）"
}

stage_deps() {
  ensure_shim || return 1
  echo "── [deps] libf2c / lapack / pcre2 → $PREFIX_W64"
  PATH="$SHIM_DIR:$PATH" LANE_FLAGS="$FLAGS" PREFIX="$PREFIX_W64" \
    bash /src/bin/build-deps.sh all
}

stage_libs() {
  ensure_shim || return 1
  echo "── [libs] 其余 farm → $DEPS_W64"
  rm -rf "$DEPS_W64/suitesparse"
  PATH="$SHIM_DIR:$PATH" LANE_FLAGS="$FLAGS" DEPS="$DEPS_W64" F2C_PREFIX="$PREFIX_W64" bash /src/bin/build-libs.sh all
}

stage_facts() {
  # ★ 台账的 **w64 组**按这里写出的两份文件量（`build/facts.py`）。为什么要有这一步：
  #   "导出数 / i64 密度 / 44 个 .oct 有几个是 64 位"这些数字**本来只活在 NOTES 与工单的散文里**
  #   —— 那正是本仓事实系统要消灭的形状（散文会腐烂，且没有闸门拦得住）。
  #   ⚠️ 量的对象是**产物**；宿主侧再 docker cp 到 `/mnt/hdd/octave-wasm-build/w64-{artifacts,logs}/`。
  ensure_shim || return 1
  echo "── [facts] 写两份可量的日志"
  RO=/emsdk/upstream/bin/llvm-readobj      # ⚠️ 容器 PATH 里**没有**它，必须绝对路径（踩过）
  O=/emsdk/upstream/bin/llvm-objdump
  OUT="${OUT:-/src/websrc/w64-out}"
  [ -f "$OUT/octave.wasm" ] || { echo "FATAL: 缺 $OUT/octave.wasm"; return 1; }
  $O -d "$OUT/octave.wasm" 2>/dev/null | grep -c 'i64' > "$LOGD/i64.txt" || true
  echo "  i64 指令数：$(cat "$LOGD/i64.txt")"
  local n=0 w=0 f
  while IFS= read -r f; do
    n=$((n + 1))
    $RO -h "$f" 2>/dev/null | grep -q 'wasm64' && w=$((w + 1))
  done < <(find /src/libwork/octs-w64 /src/libwork/octs-w64-pkg -name '*.oct' 2>/dev/null)
  printf '%s %s\n' "$w" "$n" > "$LOGD/oct-wasm64.txt"
  echo "  .oct：$w / $n 是 wasm64"
  # 零值守卫：计数为 0 ⇒ 收集逻辑坏了，**不是**"全合格"
  { [ "${w:-0}" -gt 0 ] && [ "${n:-0}" -gt 0 ]; } || {
    echo "FATAL: .oct 计数为 0 —— 收集逻辑坏了，这不是「全部合格」"; return 1; }
  echo "  ✅ 已写出 $LOGD/{i64.txt,oct-wasm64.txt}"
}

stage_tree() {
  ensure_shim || return 1
  echo "── [tree] Octave 树：configure + make + install → $OCT_INSTALL_W64"
  [ -d "$SRC" ] || { echo "FATAL: 找不到源码树 $SRC" >&2; return 1; }
  for d in "$PREFIX_W64/lib" "$DEPS_W64"; do
    [ -d "$d" ] || { echo "FATAL: 车道依赖不在 $d（先跑 build-w64-lane.sh shim deps libs）" >&2; return 1; }
  done

  echo "   ① configure（WITH_THREADS=1 + 车道 DEPS/prefix）"
  cd /src/bin
  PATH="$SHIM_DIR:$PATH" \
  DEPS="$PREFIX_W64" D="$DEPS_W64" \
    WITH_OPENGL=1 WITH_FREETYPE=1 WITH_FONTCONFIG=1 WITH_THREADS=1 SKIP= \
    TARGET_HOST="${TARGET_HOST:-wasm64-unknown-emscripten}" \
    bash /src/bin/configure-113-full.sh "$SRC" "$OCT_INSTALL_W64" || return 1

  cd "$SRC"
  echo "   ② 判据：-pthread 必须真的进了编译旗标"
  local n; n=$(grep -c -- "-pthread" Makefile || true)
  [ "$n" -gt 0 ] || { echo "FATAL: Makefile 里没有 -pthread ⇒ 线程档没配上" >&2; return 1; }
  echo "      ✅ -pthread 消费点 $n 处"

  echo "   ③ make clean（旗标变了必须全量）"
  PATH="$SHIM_DIR:$PATH" emmake make clean >/dev/null 2>&1 || true

  echo "   ④ make -k -j$JOBS（日志：$LOGD/tree-make.log）"
  set +e
  PATH="$SHIM_DIR:$PATH" emmake make -k -j"$JOBS" > "$LOGD/tree-make.log" 2>&1
  local mkr=$?
  set -e
  echo "      make rc=$mkr（预期 ≠0：树内 .oct / octave-cli 失败）"

  echo "   ⑤ make install → $OCT_INSTALL_W64"
  set +e
  PATH="$SHIM_DIR:$PATH" emmake make install > "$LOGD/tree-install.log" 2>&1
  local ikr=$?
  set -e
  echo "      install rc=$ikr（预期 ≠0：树内 cli 符号缺失；见 PLAN-threads §6）"
  if [ ! -d "$OCT_INSTALL_W64/include" ]; then
    echo "   ★ make install 受阻 ⇒ 执行 install-nodist_octincludeHEADERS install-octincludeHEADERS"
    PATH="$SHIM_DIR:$PATH" emmake make install-nodist_octincludeHEADERS install-octincludeHEADERS >> "$LOGD/tree-install.log" 2>&1 || true
    if [ ! -d "$OCT_INSTALL_W64/include" ]; then
      cp -a /src/work/octave-install/include "$OCT_INSTALL_W64/"
    fi
  fi
  [ -d "$OCT_INSTALL_W64/share" ] || cp -a /src/work/octave-install/share "$OCT_INSTALL_W64/"
  mkdir -p "$OCT_INSTALL_W64/lib/octave/11.3.0"
  cp -a "$SRC/liboctave/.libs/liboctave.a" "$OCT_INSTALL_W64/lib/octave/11.3.0/"
  cp -a "$SRC/libinterp/.libs/liboctinterp.a" "$OCT_INSTALL_W64/lib/octave/11.3.0/"
  cp -a "$SRC/libmex/.libs/liboctmex.a" "$OCT_INSTALL_W64/lib/octave/11.3.0/"
  cp "$SRC/config.h" "$OCT_INSTALL_W64/include/octave-11.3.0/octave/config.h"
  [ -d "$OCT_INSTALL_W64/include" ] || { echo "FATAL: 缺 $OCT_INSTALL_W64/include" >&2; return 1; }
  echo "   ✅ Octave 树重编完成 → $OCT_INSTALL_W64"
}

stage_link() {
  ensure_shim || return 1
  if [ ! -f /src/libwork/keep-w64.txt ] && [ -d /src/libwork/octs-w64 ]; then
    echo "   补生成 wasm64 保活清单（/src/libwork/keep-w64.txt）"
    bash /src/bin/gen-keep-list.sh /src/libwork/octs-w64 /src/libwork/octs-w64-pkg > /src/libwork/keep-w64.txt.tmp
    cat /src/libwork/keep.txt /src/libwork/keep-w64.txt.tmp | sort -u > /src/libwork/keep-w64.txt
    rm -f /src/libwork/keep-w64.txt.tmp
  fi
  echo "── [link] 重链 w64 模式（relink.sh link w64）"
  export PATH="$SHIM_DIR:$PATH"
  bash /src/bin/relink.sh link w64
}

stage_oct() {
  ensure_shim || return 1
  echo "── [oct] .oct side modules 车道重编"
  [ -d "$OCT_INSTALL_W64/include" ] || { echo "FATAL: 缺 $OCT_INSTALL_W64/include（先跑 tree）" >&2; return 1; }

  local lapack_pic="$DEPS_W64/lapack-pic"
  if [ ! -s "$lapack_pic/lib/libf2c-subset.a" ]; then
    echo "   ① 编译 wasm64 PIC 版 BLAS/LAPACK → $lapack_pic"
    PATH="$SHIM_DIR:$PATH" PREFIX="$lapack_pic" bash /src/bin/rebuild-pic-blas.sh || return 1
    cd /src/work/libf2c2-pic
    emar rcs "$lapack_pic/lib/libf2c-subset.a" \
      $(ls *.pic.o | grep -vE "^(backspac|close|dfe|dolio|dtime_|due|endfile|etime_|fmt|fmtlib|ftell_|getarg_|getenv_|iargc_|iio|ilnw|inquire|lread|lwrite|open|rdfmt|rewind|rsfe|rsli|rsne|s_paus|sfe|sue|system_|uio|wref|wrtfmt|wsfe|wsle|wsne|xwsne)\.pic\.o$")
    echo "   ✅ $lapack_pic/lib/libf2c-subset.a 就绪"
  fi
  cd "$SRC"

  echo "   ② 编 .oct side modules（车道路径：/src/libwork/octs-w64）"
  OUT_CORE=/src/libwork/octs-w64 \
  OUT_PKG=/src/libwork/octs-w64-pkg \
  OCT_INSTALL="$OCT_INSTALL_W64" \
  DEPS_ROOT="$DEPS_W64" \
  DEPS="$PREFIX_W64" \
  SUNDIALS_PREFIX="$DEPS_W64/sundials" \
  SLICOT_OBJ="/src/libwork-w64/slicot-obj" \
  SLICOT_LIB="/src/libwork-w64/slicotlibrary.a" \
  SLICOT_NODUP="/src/libwork-w64/slicotlibrary-nodup.a" \
  LAPACK_PIC="$lapack_pic/lib" \
  PATH="$SHIM_DIR:$PATH" \
  bash /src/bin/build-oct-lane.sh || return 1

  echo "   ③ 生成 wasm64 保活清单（/src/libwork/keep-w64.txt）"
  bash /src/bin/gen-keep-list.sh /src/libwork/octs-w64 /src/libwork/octs-w64-pkg > /src/libwork/keep-w64.txt.tmp
  cat /src/libwork/keep.txt /src/libwork/keep-w64.txt.tmp | sort -u > /src/libwork/keep-w64.txt
  rm -f /src/libwork/keep-w64.txt.tmp
  echo "   ✅ wasm64 保活清单就绪（$(wc -l < /src/libwork/keep-w64.txt) 条）"

  echo "   ✅ .oct 车道构建完成"
}

rc=0
for s in "$@"; do
  log="$LOGD/$s.log"
  case "$s" in
    shim|deps|libs|tree|link|oct|facts)
      # 直接调函数（**不要**写成 `"$(echo stage_$s)"`：命令替换会开子壳、状态全丢）
      "stage_$s" 2>&1 | tee "$log"
      st=${PIPESTATUS[0]}
      if [ "$st" != "0" ]; then
        echo ""
        echo "❌ 阶段 $s 失败（rc=$st）。**第一面墙**在：$log"
        echo "   把它原文记进交接材料 —— 别让接手方重撞。"
        rc=$st; break
      fi
      ;;
    *) echo "未知阶段：$s"; rc=2; break ;;
  esac
done
[ "$rc" = "0" ] && echo "✅ 已完成阶段：$*（日志在 $LOGD/）"
exit "$rc"
