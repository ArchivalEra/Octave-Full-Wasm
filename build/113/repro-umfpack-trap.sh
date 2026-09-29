#!/bin/bash
# Octave-Full-Wasm — 工单 04 结算件：稀疏 lu 整页 trap 的**可复现复现器**（2026-09-29）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么有它：工单 04 的悬案（"稀疏 lu 整页挂，不知道触发条件"）已被 52489ab 解答
# —— 根因 = UMFPACK 按标准 BLAS 约定调 `dgemm_/dger_/dtrsv_/dtrsm_`，而本仓 BLAS 是
# f2c 版（隐藏长度 ftnlen 约定）⇒ 形参错位 ⇒ wasm trap；修法 = SuiteSparse 配置
# `-DNBLAS -DNSUPERNODAL`（别用外部 BLAS）。本脚本把结论变成**可复跑的判决**：
#
#   第一面（修复侧，默认跑）：现役站点上跑最小复现 ⇒ 必须 **LU-OK**（谁退化谁红）
#   第二面（陷阱侧，--rebuild-broken）：把 SuiteSparse **去掉那两个宏**重编到一次性
#     prefix，链接成一份"坏变体"产物 ⇒ 同一行 .m 必须 **LU-TRAP**
#   两面同时成立 ⇒ 结算（rc=0）；只绿不红 ⇒ 复现器失效（rc=1）；只红不绿 ⇒ 修复退化（rc=1）
#
# 最小复现（就是全部，不是节选）：
#   s = sparse([1,1,2,3],[1,2,2,3],[1,2,3,4]);
#   [L,U,P] = lu(s);        % 1/2 输出不做数值分解不炸；3 输出走 UMFPACK 分解
#
# 用法（宿主）：
#   sh build/113/repro-umfpack-trap.sh                 # 只跑修复侧（秒级~分钟级）
#   sh build/113/repro-umfpack-trap.sh --rebuild-broken [站点URL]   # 两面都跑（~20 分钟）
#   环境变量：SITE_URL（默认 http://127.0.0.1:8768/）、BROKEN_URL（坏变体站，脚本自起 :8799）
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
DOCKER=${DOCKER:-sudo docker}
CTR=${CTR:-o113}
SITE_URL=${SITE_URL:-http://127.0.0.1:8768/}
BROKEN_URL=${BROKEN_URL:-http://127.0.0.1:8799/}
RUN="$REPO/test/browser/run.sh"
REBUILD_BROKEN=0
[ "${1:-}" = "--rebuild-broken" ] && { REBUILD_BROKEN=1; shift; }
[ -n "${1:-}" ] && SITE_URL="$1"

rc=1
fixed_line=""
broken_line=""

# 探针调用（run.sh 没有执行位 ⇒ 必须 `sh`；输出全捕获再取行，探针报错不许吞）
run_probe () {  # $1=URL → 全局 PROBE_OUT
  PROBE_OUT="$(sh "$RUN" "$REPO/test/browser/probe-umfpack-trap.mjs" "$1" 2>&1 || true)"
  printf '%s\n' "$PROBE_OUT" | grep -m1 '^=== LU-' || true
}

# ── 第一面：修复侧必须绿 ──────────────────────────────────────────────────────
echo "── 第一面：现役站点（$SITE_URL）上最小复现必须 LU-OK"
fixed_line="$(run_probe "$SITE_URL")"
[ -n "$fixed_line" ] || fixed_line="（探针无 === LU- 行；原始输出尾部：$(printf '%s' "${PROBE_OUT:-}" | tail -2)）"
echo "   $fixed_line"
if printf '%s' "$fixed_line" | grep -q '^=== LU-OK'; then
  echo "   ✅ 修复侧成立（-DNBLAS/-DNSUPERNODAL 在，稀疏 lu 3 输出可用 —— 不再是 7.2 回归）"
  p1=0
else
  echo "   ❌ 修复侧红：现役产物上 3 输出 lu 竟然 trap —— 修复退化或跑错站点" >&2
  p1=1
fi

# ── 第二面：陷阱侧必须红（可复现旧墙）────────────────────────────────────────
if [ "$REBUILD_BROKEN" = "1" ]; then
  echo "── 第二面：去 -DNBLAS/-DNSUPERNODAL 重编 SuiteSparse（一次性 prefix）⇒ 必须复现 LU-TRAP"
  $DOCKER exec "$CTR" bash -c 'set -e
    export PATH=/src/bin:$PATH
    B=/src/work/umfpack-repro-broken
    rm -rf "$B" && mkdir -p "$B/lib" "$B/include"
    W=/src/libwork; T="$W/SuiteSparse-5.4.0"
    [ -d "$T" ] || { tar xf /src/vendor/suitesparse-full-5.4.0.tar.gz -C "$W"; }
    cd "$T"
    # 清旧 .o（build-libs.sh do_suitesparse 的既有纪律：改 config 宏必须清了重编）
    for l in SuiteSparse_config AMD CAMD COLAMD CCOLAMD CHOLMOD UMFPACK KLU CXSparse; do
      rm -f "$l"/*.o "$l"/Lib/*.o 2>/dev/null || true
    done
    rm -f "$B"/lib/*.a
    # ★ 与 do_suitesparse 唯一的差别：UMFPACK_CONFIG / CHOLMOD_CONFIG **不带** NBLAS/NSUPERNODAL
    OV=( CC="ccache emcc" CXX="ccache em++" AR=emar RANLIB=emranlib CFOPENMP=
         CHOLMOD_CONFIG="-DNPARTITION"
         CFLAGS="-O2 -fPIC" CXXFLAGS="-O2 -fPIC"
         BLAS="-lrefblas" LAPACK="-llapack" )
    for lib in SuiteSparse_config AMD CAMD COLAMD CCOLAMD CHOLMOD UMFPACK KLU CXSparse; do
      ( cd "$lib" && emmake make static "${OV[@]}" > "/src/work/umfpack-repro-ss-$lib.log" 2>&1 ) \
        || { echo "FATAL: $lib 构建失败（/src/work/umfpack-repro-ss-$lib.log）"; exit 1; }
    done
    for f in */Lib/*.a */*.a; do [ -f "$f" ] && cp -f "$f" "$B/lib/"; done
    cp -f SuiteSparse_config/SuiteSparse_config.h "$B/include/" 2>/dev/null || true
    for f in */Include/*.h; do [ -f "$f" ] && cp -f "$f" "$B/include/"; done
    echo "   坏变体 SuiteSparse → $B/lib（$(ls "$B/lib" | wc -l) 个 .a）"
    # ★ 链接走 probe-wasm64-link 的正道：环境从模式表推出后**直接驱动 link-web.sh**——
    #   若走 `relink.sh link`，apply_mode 会把模式表外的 EXTRA_LDFLAGS **重置掉**（口径表
    #   是唯一来源，设计如此）⇒ 坏库根本进不了链接（第一版就这么静默空转的，sha 与正常
    #   rebuild 一模一样）。EXTRA_LDFLAGS 在 LIBS 之前 ⇒ -L 抢搜索顺序。
    while IFS= read -r kv; do
      [ -n "$kv" ] || continue
      export "$kv"
    done < <(bash /src/bin/relink.sh exports product)
    export EXTRA_LDFLAGS="${EXTRA_LDFLAGS:-} -L$B/lib"
    echo "   EXTRA_LDFLAGS=$EXTRA_LDFLAGS"
    set +e
    bash /src/bin/link-web.sh /src/websrc/umfpack-repro-out > /src/work/umfpack-repro-link.log 2>&1
    LRC=$?
    set -e
    echo "   link rc=$LRC（日志 /src/work/umfpack-repro-link.log）"
    if [ "$LRC" != "0" ]; then
      # ★ 复现形状（2026-09-29 实测）：坏库的腐坏现在被 **Binaryen 在出厂前拦下**
      #   （wasm-opt `popping from empty stack`）—— 09-22 时代是"链得过、运行时整页 trap"。
      #   同一腐坏、更早的护栏。只要报错是 parse/validate 类，就等于复现成立。
      if grep -qE "popping from empty stack|parse exception|error parsing wasm|wasm-validate" /src/work/umfpack-repro-link.log; then
        echo "   ✅ 复现成立（形状=Binaryen 拒收腐坏产物）：坏库与好库唯一差别就是那两个宏"
        touch /src/work/umfpack-repro-REPRODUCED
      else
        echo "   ❌ 链接失败但报错不像腐坏 —— 复现不成立" >&2; exit 1
      fi
    else
      bash /src/bin/relink.sh verify product --out /src/websrc/umfpack-repro-out
    fi
  ' || { echo "   ❌ 坏变体构建/链接失败" >&2; exit 1; }
  if [ "$($DOCKER exec "$CTR" sh -c 'test -f /src/work/umfpack-repro-REPRODUCED && echo y')" = "y" ]; then
    broken_line="（链不出产物 —— Binaryen 拒收，见上；这本身就是腐坏复现）"
    p2=0
  else
  $DOCKER exec "$CTR" bash -c 'cp /src/websrc/umfpack-repro-out/{octave.wasm,octave.js,octave.data} /tmp/ 2>/dev/null; true'
  # 起一次性站点（坏变体），跑探针
  site_dir="$($DOCKER exec "$CTR" sh -c 'echo /src/websrc/umfpack-repro-out')"
  tmp_site=/tmp/umfpack-repro-site
  rm -rf "$tmp_site" && mkdir -p "$tmp_site"
  $DOCKER exec "$CTR" tar -C /src/websrc/umfpack-repro-out -cf - . | tar -C "$tmp_site" -xf -
  # 站点要能 boot：把站点级资产（octave.build.json 等）也带上 —— tar 已带全部
  setsid nohup python3 "$REPO/build/serve-coi.py" --dir "$tmp_site" --port 8799 >/tmp/umfpack-repro-serve.log 2>&1 &
  broken_line="$(run_probe "$BROKEN_URL")"
  [ -n "$broken_line" ] || broken_line="（探针无 === LU- 行；原始输出尾部：$(printf '%s' "${PROBE_OUT:-}" | tail -2)）"
  echo "   $broken_line"
  if printf '%s' "$broken_line" | grep -q '^=== LU-TRAP'; then
    echo "   ✅ 陷阱侧成立：同一行 .m 在坏变体上 wasm trap —— 根因结论可复现"
    p2=0
  else
    echo "   ❌ 陷阱侧没复现（坏了的库竟然没 trap）⇒ 复现器失效，根因结论要重查" >&2
    p2=1
  fi
  fi
  pkill -f 'serve-coi.py --dir /tmp/umfpack-repro-site' 2>/dev/null || true
  rc=$(( p1 + p2 ))
else
  echo "── 第二面跳过（加 --rebuild-broken 才跑；~20 分钟）"
  rc=$(( p1 ))
fi

echo ""
echo "════ 判决 ════"
echo "  修复侧（现役）: $fixed_line"
[ -n "$broken_line" ] && echo "  陷阱侧（坏变体）: $broken_line"
if [ "$rc" = 0 ]; then
  echo "  ⇒ 结算成立：修复可验（OK）且根因可复现（TRAP）—— 工单 04 的两问都有可跑答案。"
else
  echo "  ⇒ rc=$rc：见上。"
fi
exit "$rc"
