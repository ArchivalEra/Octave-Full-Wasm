#!/bin/bash
# Octave-Full-Wasm — **wasm64 链接探针**（2026-09-28）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 目的：在把 wasm64 交给任何人之前，**自己先撞一次墙** —— 记录"我们的项目拿 memory64 链接，
# 第一面墙在哪"。一个从没链过的配方不是配方，是猜想。
#
# 为什么这样构造（**一个变量都不手设**，遵守本仓的口径纪律）：
#   · 环境**从模式表推出来**（`relink.sh explain <模式>` 的输出就是文档，也是真值），
#     而不是把 20 多个变量抄一遍 —— 抄一遍就会漂；
#   · 只在最后追加 `-sMEMORY64=1`，其余照线程档（`-pthread` + 车道 OpenBLAS）；
#   · `-pthread` 的车道影子照 `relink.sh` 的做法挂上（否则 main.o 不带 atomics，第一面墙
#     会变成"atomics"而不是"memory64"，那是假墙）。
#
# 用法（容器内）：bash /src/bin/probe-wasm64-link.sh [模式]
# 判据：见结尾打印的判定 —— 它**不下结论说好坏**，只如实报第一面墙是什么。
set -u
MODE="${1:-threads}"
OUT="${OUT:-/src/websrc/w64-link-probe-out}"
LANE_SHIM="${LANE_SHIM:-/src/libwork/lane-shim}"

if [ -d "$LANE_SHIM" ]; then
  export PATH="$LANE_SHIM:$PATH"
  echo "== 车道影子：$LANE_SHIM（照 relink.sh 的做法挂上，免得第一面墙变成 atomics 那个假墙）"
fi

echo "== 从模式表推出环境（模式 $MODE）—— 不手设任何变量"
# ⚠️ 用 `exports`（机器可读），**不要**解析 `explain` —— 后者是给人看的，它把空值渲染成 `（空）`。
#    第一版就是解析 explain 的，结果每个空变量都变成字面量 `（空）`：
#    `-Wl,--export-if-defined=（空）`，而 `P5_GLPROBE=（空）` 更坏 —— `[ -n ]` 判真 ⇒ 悄加一个 -D。
#    （`relink.sh --selftest` 的第 ⑥ 条把这件事钉住了。）
while IFS= read -r kv; do
  [ -n "$kv" ] || continue
  export "$kv"
done < <(bash /src/bin/relink.sh exports "$MODE")

echo "  推出 $(env | grep -cE '^[A-Z][A-Z0-9_]*=') 个环境变量（含继承的）"
echo "  EXTRA_LDFLAGS（模式表给的）：${EXTRA_LDFLAGS:-（空）}"

# ★ 唯一的改动：追加 -sMEMORY64=1。它是 [compile+link] 设置 ⇒ **对象也必须用它编**，
#   否则就是"wasm32 对象 + wasm64 链接"的混编 —— 探针要量的正是这个会不会被拦、怎么被拦。
export EXTRA_LDFLAGS="${EXTRA_LDFLAGS:-} -sMEMORY64=1"
echo "  EXTRA_LDFLAGS（本次，追加了 memory64）：$EXTRA_LDFLAGS"
echo ""

mkdir -p "$OUT"
LOG=/tmp/w64-link-probe.log
set +e
bash /src/bin/link-web.sh "$OUT" >"$LOG" 2>&1
rc=$?
set -e

echo "════ 结果 ════"
echo "  link-web.sh rc=$rc   日志：$LOG（$(wc -l <"$LOG") 行）"
echo ""
echo "  ── 第一处「不像普通噪音」的报错（最多 4 行）──"
# ⚠️ 必须**排除 trace 行**：link-web.sh 带 `set -x`，日志里每条命令都有 `NN:+ …` 前缀，
#    而那条命令行本身就含 `-sMEMORY64=1` ⇒ 用 "memory64" 当模式会把命令行当成错误报出来
#    （第一版就这么错的）。所以只认真正的错误词，再滤掉 `+ ` 开头的 trace 行。
grep -E 'error:|Error:|FATAL|not compiled with|disallowed|object file can' "$LOG" \
  | grep -v ':[0-9]*:+ ' | head -4 | sed 's/^/    /'
echo ""
if [ "$rc" = "0" ] && [ -f "$OUT/octave.wasm" ]; then
  echo "  ⇒ **链过去了**。下一步立刻确认它是不是真的 64 位（别只看 rc）："
  echo "      python3 /mnt/hdd/zcode-projects/Octave-Full-Wasm/build/113/wasm_symbols.py exports $OUT/octave.wasm | head -1"
  echo "      llvm-objdump -d $OUT/octave.wasm | grep -c i64   # 量 i64 指令密度"
else
  echo "  ⇒ **链不过去**（rc=$rc）。上面那几行就是**第一面墙**：把它原样抄进交接材料，"
  echo "    不要让接手方自己去撞同一面墙。若是「对象没带 memory64」这一类，"
  echo "    说明需要一条 farm 全量重编（形状与 B6 的车道重建一样：把 lane-shim 的旗标换成"
  echo "    -sMEMORY64=1 → 重建依赖 → 重建 Octave 树 → 重链）。"
fi
exit "$rc"
