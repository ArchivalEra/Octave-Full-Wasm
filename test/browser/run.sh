#!/bin/sh
# Octave-Full-Wasm — 测试运行器（A3 起**进仓库**；原先在仓库外的 harness 目录里）
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么在仓库里：`sweep.sh` 与 `check-boot.sh` 都调它，而它过去只存在于
# `/mnt/hdd/octave-wasm-build/harness/run.sh`（还由 `recover.sh` 用 printf **重新生成**一份）
# ⇒ 测试契约的另一半也在仓库外。现在仓库这份是唯一真相源，仓库外那个目录只剩 `node_modules`。
#
# 用法：sh test/browser/run.sh <套件路径> [参数…]
# 环境：HARNESS=<harness 目录>（默认 /mnt/hdd/octave-wasm-build/harness，只为了 node_modules）
#
# ⚠️ 为什么要 `cp` 到 harness 再跑：套件里是 `import { chromium } from 'playwright-core'`，
#    而 playwright-core 只装在 harness 的 node_modules 里（ESM 的解析看**脚本所在目录**，
#    看 cwd 没用）。所以把脚本拷过去执行 —— **每次现拷**，不是"拷一份留着的副本"：
#    改完仓库用旧副本跑，断言的红绿会整体错位（实测踩过两次，别改成缓存）。
#
# ★ 2026-10-05：临时副本改用**每次调用唯一**的文件名（`_run.<pid>.mjs`）——
#   旧的固定 `_run.mjs` 让两个 run.sh 并发时**互相覆盖**（HISTORY §5.14 的假失败真身），
#   是 sweep 并行化的**硬前提**。不能用 `exec node`：trap 要能在退出时删掉这次副本。
set -e
H="${HARNESS:-/mnt/hdd/octave-wasm-build/harness}"
[ -n "${1:-}" ] || { echo "用法: sh test/browser/run.sh <套件路径> [参数…]" >&2; exit 2; }
[ -d "$H/node_modules" ] || {
  echo "FATAL: harness 缺 node_modules（$H）—— playwright-core 装在那里" >&2; exit 2; }
RUNF="$H/_run.$$.mjs"
trap 'rm -f "$RUNF"' EXIT INT TERM
cp "$1" "$RUNF"
shift
cd "$H" && node "$RUNF" "$@"
