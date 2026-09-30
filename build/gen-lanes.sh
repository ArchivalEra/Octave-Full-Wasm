#!/bin/sh
# Octave-Full-Wasm — 生成站点的**档清单** `lanes.js`（工单 23，2026-09-30）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么有它：四格选档是**能力**上的最优，但站点可能只部署了几档（8761/8768 只有 base+threads）。
# 能力驱动的选择器在那种站点上会挑 `w64` 并 **404** —— 而"站点少一档"没有闸门会拦。
# 这份文件把"**磁盘上真有哪几档**"变成页面能**同步**读到的清单（`global.__octaveLanes`），
# 由 `bridge/lane.js` 在选档时与能力判据取交集。
#
# ⚠️ 它是**生成物**：不要手改（手抄清单今天已经漂过两份资产）。判定完全来自磁盘：
#   base      ⇐ 根目录有 octave.js + octave.wasm
#   threads   ⇐ threads/ 目录里有那三件
#   w64       ⇐ w64/ 目录里有那三件
#   w64-base  ⇐ w64-base/ 目录里有那三件
#
# 用法：sh build/gen-lanes.sh <站点目录>   ⇒ 写 <站点>/lanes.js 并打印清单
set -eu
# ── F1 自证：三类用例（正常 / 该报的必须报 / 空输入必须报）──────────────────────
if [ "${1:-}" = "--selftest" ]; then
  bad=0; n=0; tmp="$(mktemp -d)"
  mk () { mkdir -p "$1"; for f in octave.js octave.wasm octave.data; do : > "$1/$f"; done; }
  # ① 只有 base ⇒ 正常，清单 = ["base"]
  n=$((n+1)); mk "$tmp/s1"
  if sh "$0" "$tmp/s1" >/dev/null 2>&1 && grep -q '__octaveLanes = \["base"\]' "$tmp/s1/lanes.js"; then
    echo "PASS | gen-lanes/只有 base ⇒ 清单 [\"base\"]"; else echo "fail | gen-lanes/只有 base 竟然红"; bad=1; fi
  # ② 四格齐 ⇒ 四格都写进去
  n=$((n+1)); mk "$tmp/s2"; mk "$tmp/s2/threads"; mk "$tmp/s2/w64"; mk "$tmp/s2/w64-base"
  if sh "$0" "$tmp/s2" >/dev/null 2>&1 && grep -q 'w64-base' "$tmp/s2/lanes.js"; then
    echo "PASS | gen-lanes/四格齐 ⇒ 清单含 w64-base"; else echo "fail | gen-lanes/四格齐却漏了档"; bad=1; fi
  # ③ **没有 base** ⇒ 必须红（base 是红线：任何静态托管的底线）
  n=$((n+1)); mkdir -p "$tmp/s3/w64"; for f in octave.js octave.wasm octave.data; do : > "$tmp/s3/w64/$f"; done
  if sh "$0" "$tmp/s3" >/dev/null 2>&1; then echo "fail | gen-lanes/**没有 base 竟没报**（红线失效）"; bad=1
  else echo "PASS | ★ 没有 base ⇒ 必须红（红线）"; fi
  # ④ 目录不存在 ⇒ 必须红
  n=$((n+1)); if sh "$0" "$tmp/nonexistent" >/dev/null 2>&1; then echo "fail | gen-lanes/空输入竟没报"; bad=1
  else echo "PASS | ★ 站点目录不存在 ⇒ 必须红"; fi
  rm -rf "$tmp"
  echo "=== gen-lanes 自证：$((n-bad)) PASS / $bad fail ==="
  exit "$bad"
fi

SITE="${1:?用法: sh build/gen-lanes.sh <站点目录>}"
[ -d "$SITE" ] || { echo "FATAL: 站点目录不存在：$SITE" >&2; exit 2; }

has3 () {  # $1=目录前缀（'' 表示根）  ⇒ 三件齐才算有
  _d="$1"; [ -n "$_d" ] && _d="$_d/"
  [ -f "$SITE/${_d}octave.js" ] && [ -f "$SITE/${_d}octave.wasm" ] && [ -f "$SITE/${_d}octave.data" ]
}

LANES=""
add () { LANES="${LANES:+$LANES,}\"$1\""; }

has3 ""          && add base
has3 threads     && add threads
has3 w64         && add w64
has3 w64-base    && add w64-base

# 零值守卫：**base 必须在**（它是"任何静态托管都能跑"的红线）。
# 没有 base 的站点是一个**残缺部署**，这里必须红 —— 不许生成一份"没有底线档"的清单。
has3 "" || { echo "FATAL: $SITE 里没有基础档三大件（base 是红线，任何站点都必须有）" >&2; exit 1; }

cat > "$SITE/lanes.js" <<EOF
// ⚠️ 生成物，不要手改 —— 由 build/gen-lanes.sh 按磁盘上真实存在的档写出（工单 23）。
// 改了它 = 选档器会挑一个不存在的档并 404；要加档请部署那一档再重新生成。
(function (g) { g.__octaveLanes = [$LANES]; })(typeof window !== 'undefined' ? window : self);
EOF

echo "✅ $SITE/lanes.js：[$(printf '%s' "$LANES" | tr -d '"')]"
