#!/bin/sh
# Octave-Full-Wasm — 胶水层自带测试的**宿主**跑法（秒级；浏览器那条在 accept-selftest.mjs）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么值得有：这些 `%!test` 断言本来就是写好的，只是从来没人跑。宿主跑一遍只要一两秒，
# 而浏览器那条要下 36MB wasm —— 所以改胶水 `.m` 时先跑这个，过了再谈端到端。
#
# 用法：sh build/glue-selftest.sh          # 有失败则 exit 1（给本地/CI 用）
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
OCTAVE="${OCTAVE:-octave-cli}"
OUT=/tmp/glue-selftest.out

# 前置条件：把胶水目录放进 path（浏览器侧由资产加载器做同样的事）
"$OCTAVE" --norc --quiet --no-window-system --eval "
addpath ('$REPO/build/webfile');
addpath ('$REPO/build/pkgfix');
source ('$REPO/build/glue-selftest.m');
" 2>&1 | grep -v "shadows a core library function\|^warning: called from\|^ *[a-z_]* at line\|^$" > "$OUT" || true

cat "$OUT"
# ⚠️ 不能用 `... | grep | tee` 的退出码：那会取到 tee 的 0。自己解析 TOTAL 判成败。
total_line=$(grep '^TOTAL ' "$OUT" | tail -1 || true)
if [ -z "$total_line" ]; then
  echo "★ 没有拿到 TOTAL 行 —— 驱动没跑起来（先看上面的输出）" >&2
  exit 2
fi
pass=$(printf '%s' "$total_line" | sed -n 's/.*pass=\([0-9]*\).*/\1/p')
all=$(printf '%s' "$total_line"  | sed -n 's/.*total=\([0-9]*\).*/\1/p')
bad=$(printf '%s' "$total_line"  | sed -n 's/.*badfiles=\([0-9]*\).*/\1/p')
if [ "$bad" != "0" ] || [ "$pass" != "$all" ]; then
  echo "★ 胶水自带测试有失败：pass=$pass total=$all badfiles=$bad（明细见 $OUT）" >&2
  exit 1
fi
echo "胶水自带测试：$pass/$all 全过（badfiles=0）"
