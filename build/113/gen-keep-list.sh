#!/bin/sh
# Octave-Full-Wasm — 生成 MAIN_MODULE=2 的"保活清单"（G1 / §8 待办 3）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# ── 它治什么病 ──────────────────────────────────────────────────────────────
# `MAIN_MODULE=1` 不做 DCE ⇒ 主模块把所有符号都导出去，`.oct`（side module）随便解析。
# 代价是 wasm 35.97MB 里一大半是没人用的代码（体积账见 NOTES-main-module-2.md：
# M2 实测 27.73MB / 三大件 gzip −1.81MB）。
#
# `MAIN_MODULE=2` 会 DCE ⇒ **只有列进导出表的符号才活着**。我们的 `.oct` 走**资产车道**
# （不在主链命令行上），所以拿不到 Emscripten "自动收集 side module 导入"的待遇
# （`tools/link.py:2876` 只对命令行上的 side module 做这件事）⇒ 必须**自己把保活集算出来**，
# 用 `-Wl,--export-if-defined=<sym>` 喂给主链（未定义的静默忽略，这是关键：候选集里
# 绝大多数符号在某个 `.oct` 里引用、但**未必**在主模块里有定义）。
#
# ── 符号从哪读（一个被文档写错过的地方）────────────────────────────────────
# `.oct` 的导入符号在 **IMPORT 段**里。`CLIBS.md` 里那句"从 `dylink.0` 段读 imported
# symbols"**是错的** —— 实测 `dylink.0` 段只有 7 字节、不含符号名（见
# NOTES-main-module-2.md 的"文档更正"）。能读 IMPORT 段的工具是 **`wasm-dis`**
# （Binaryen 自带）：`emnm -u` 报 "no dynamic symbol table"，`wasm-objdump` 容器里没有。
#
# 用法（容器内）：
#   sh gen-keep-list.sh <oct 目录> [更多目录…] > /src/libwork/keep.txt
# 输出：一行一个符号名（LC_ALL=C 去重排序）。统计信息走 stderr。
set -e

WASM_DIS="${WASM_DIS:-/emsdk/upstream/bin/wasm-dis}"
[ -x "$WASM_DIS" ] || { echo "FATAL: 找不到 wasm-dis（$WASM_DIS）" >&2; exit 2; }
[ $# -ge 1 ] || { echo "用法：gen-keep-list.sh <oct 目录> [更多目录…]" >&2; exit 2; }

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
n_oct=0

for d in "$@"; do
  [ -d "$d" ] || { echo "FATAL: 不是目录：$d" >&2; exit 2; }
  # ⚠️ 必须**递归**：`assets/octdir/<包>/*.oct` 在子目录里（只扫顶层会漏掉 27 个包编译件，
  #    而漏掉它们意味着 M2 下那些包的函数在装载期报"缺符号"）。
  find "$d" -name '*.oct' | LC_ALL=C sort | while read -r f; do
    "$WASM_DIS" "$f" 2>/dev/null
  done
done | grep -oE '^ \(import "(env|GOT\.mem|GOT\.func)" "[^"]+"' | sed -E 's/.*"([^"]+)"$/\1/' >> "$TMP" || true
n_oct=$(find "$@" -name '*.oct' 2>/dev/null | wc -l)

# 剔掉两类名字（它们**不是** can't-be-exported 的主模块符号）：
#   · dylink 机制名（memory/__stack_pointer/__memory_base/__table_base/__indirect_function_table）
#     —— 由加载器按 side module 约定提供，不来自主模块导出表；
#   · **JS 库函数**名（emscripten_run_script / exit / __assert_fail …）—— 它们不是 wasm 导出，
#     喂给 `--export-if-defined` 是静默忽略，但喂给 `EXPORTED_FUNCTIONS` 是**硬错误**
#     （实测 `undefined exported symbol`）。M2 下 `.oct` 需要 JS 库函数时，正确做法是
#     **由主模块包一个 wasm 导出**（见 `build/main.cc` 的 `oct_js_run` + `webnet.cc`）。
FILTER='^(memory|__indirect_function_table|__stack_pointer|__memory_base|__table_base|emscripten_run_script|exit|__assert_fail)$'
grep -vE "$FILTER" "$TMP" | LC_ALL=C sort -u

n_all=$(wc -l < "$TMP")
n_keep=$(grep -vE "$FILTER" "$TMP" | LC_ALL=C sort -u | wc -l)
echo "gen-keep-list: 扫了 $n_oct 个 .oct；导入行 $n_all 条（含重复），去重去机制/JS 名后 **$n_keep** 个保活符号" >&2
