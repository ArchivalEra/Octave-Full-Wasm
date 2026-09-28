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
#   阶段：shim  deps  libs  [tree link oct —— 见"待补"一节]
#   `bash build-w64-lane.sh shim deps libs`
#
# ⚠️ 与 B6 车道的区别，别混：
#   B6 = `/usr/local-threads` + `/src/deps-threads`（只多 `-pthread`）
#   本批 = `/usr/local-w64`     + `/src/deps-w64`（`-pthread` **和** `-sMEMORY64=1`）
#   **两套 prefix 必须并存，绝不覆盖现役** —— 8761/8768 的红线是"不许退化"。
set -u

FLAGS='-pthread -sMEMORY64=1'      # ← 本批的全部新增（B6 只有 -pthread）
SHIM_DIR=/src/libwork/lane-shim-w64
PREFIX_W64=/usr/local-w64
DEPS_W64=/src/deps-w64
LOGD=/src/work/w64-logs
mkdir -p "$LOGD"

stage_shim() {
  echo "── [shim] 建 w64 影子（注入：$FLAGS）"
  export PATH=/src/bin:$PATH                    # emf77 在 /src/bin（lane-shim 要它）
  bash /src/bin/lane-shim.sh "$FLAGS" "$SHIM_DIR" >/dev/null || return 1
  # 自证：旗标**真的**进了命令行（不是只建了文件 —— 那是"赋值了却没人引用"的形状）
  grep -q -- 'MEMORY64' "$SHIM_DIR/emcc" || { echo "FATAL: 影子没注入 memory64"; return 1; }
  grep -q -- 'pthread'  "$SHIM_DIR/emcc" || { echo "FATAL: 影子没注入 pthread"; return 1; }
  echo "   ✅ 影子：$SHIM_DIR（自证：包装里有 MEMORY64 与 pthread）"
}

stage_deps() {
  echo "── [deps] libf2c / lapack / pcre2 → $PREFIX_W64"
  PATH="$SHIM_DIR:$PATH" LANE_FLAGS="$FLAGS" PREFIX="$PREFIX_W64" \
    bash /src/bin/build-deps.sh all
}

stage_libs() {
  echo "── [libs] 其余 farm → $DEPS_W64（这个脚本不认 LANE_FLAGS ⇒ 全靠影子）"
  PATH="$SHIM_DIR:$PATH" DEPS="$DEPS_W64" bash /src/bin/build-libs.sh all
}

# ── 待补（本批的下一段，别假装已经写好）────────────────────────────────────────
# tree：configure 加 WITH_THREADS=1（B6 那条：去掉 --disable-threads + 撤 AX_PTHREAD 覆盖）
#       并让整棵树带 -sMEMORY64=1（靠影子）→ 装到新 prefix（如 /usr/local-w64 或 /src/work/octave-install-w64）
# link：`relink.sh` 需要一个新的**模式**（表里加 w64：DEPS=$PREFIX_W64 / DEPS_ROOT=$DEPS_W64
#       + MEMORY64=1），否则就得手设变量 —— 那是本仓禁止的
# oct ：`.oct` 车道也要重编（side module 的指针宽度必须与主模块一致）
# 判据：全部绿之后 `bash /src/bin/probe-wasm64-link.sh` 应当 rc=0，且产物里量得到 i64 指令
#        （`llvm-objdump -d <wasm> | grep -c i64`）—— **别只看 rc**。
# ────────────────────────────────────────────────────────────────────────────

rc=0
for s in "$@"; do
  log="$LOGD/$s.log"
  case "$s" in
    shim|deps|libs)
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
    tree|link|oct)
      echo "⚠️ 阶段 $s 尚未实现（本批的下一段，见脚本里的「待补」与工单 17）"; rc=3; break ;;
    *) echo "未知阶段：$s"; rc=2; break ;;
  esac
done
[ "$rc" = "0" ] && echo "✅ 已完成阶段：$*（日志在 $LOGD/）"
exit "$rc"
