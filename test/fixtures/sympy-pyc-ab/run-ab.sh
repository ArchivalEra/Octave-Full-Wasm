#!/usr/bin/env bash
# A/B 夹具：SymPy **预编译字节码（.pyc）** vs 源码轮子（2026-10-14）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 用户问题："transcript 预编译 python 是不是更好的路径，性能能快几倍吧"
#   · "Transcrypt（静态编译成 JS）"那一半 —— 判据 = SymPy 源码 eval/exec 计数
#     （探针会报；实测 eval( 340 / exec( 61，去 benchmarks/testing）⇒ 不可行，不靠本夹具。
#   · "预编译字节码"那一半 —— 本夹具量（**唯一变量 = 轮子里有没有 __pycache__**）。
#
# ⚠️ 三条纪律（少一条 A/B 就是假的）：
#   ① .pyc 必须用 **Pyodide 自己的 CPython** 编（magic 版本要匹配）；
#   ② 必须 **hash 校验模式**（timestamp 模式的 mtime 在浏览器 FS 里对不上 ⇒ CPython
#      静默拒绝 .pyc 回落到现编 ⇒ 看起来"没差别"）；
#   ③ 仪器 = `SourceFileLoader.source_to_code` 调用次数 + **被编文件名清单**
#      （B 档若仍有编译，要点名是谁，不许含糊）。
set -euo pipefail
REPO=${REPO:-$(cd "$(dirname "$0")/../../.." && pwd)}
SERVE=${SERVE:-/mnt/hdd/octave-wasm-build/symprobe/serve}
CACHE=${CACHE:-/mnt/hdd/octave-wasm-build/symprobe/cache}
BUILD=${BUILD:-/tmp/sympy-pycbuild}

# 0) 前置：上游探针已经备好 serve/（Pyodide 运行时 + sympy/mpmath 轮子）
[ -d "$SERVE/pyodide" ] || {
  echo "FATAL: 缺 $SERVE/pyodide —— 先跑 sh test/browser/run.sh test/browser/probe-pyodide-sympy.mjs" >&2
  exit 3; }
for w in sympy-1.14.0-py3-none-any.whl mpmath-1.4.1-py3-none-any.whl; do
  [ -f "$CACHE/$w" ] || { echo "FATAL: 缺 $w（$CACHE）" >&2; exit 3; }
done

# 1-3) 预编 + 重打包（**共用脚本**：sympy-perf 的 WHEELS=pyc 档走同一份，别两处各写一遍）
sh "$(dirname "$0")/prepare-pyc-wheels.sh"

# 4) 跑浏览器 A/B
cd "$REPO"
sh test/browser/run.sh test/fixtures/sympy-pyc-ab/probe-sympy-pyc-ab.mjs
