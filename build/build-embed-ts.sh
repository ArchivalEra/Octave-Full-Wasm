#!/bin/sh
# Octave-Full-Wasm — **页面适配器 TS 构建**（工单 48）
# Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
#
# bridge/octave-page.ts  →  bridge/octave-page.js（页面 <script src> 引的就是这份）
#
# 为什么 TS 但要编译成 ES5 单文件：页面用 <script src="octave-page.js"> 直引（无打包器），
# 所以产物必须是**无模块、无依赖、全局脚本**；类型只在源码里（编译后全擦除）。
#
# tsc 从哪来：仓库外（不污染白名单）。装一次：
#   npm install --prefix /mnt/hdd/crossbuild-tools/npm-ts typescript@5
# 覆盖：TS_TSC=/path/to/tsc sh build/build-embed-ts.sh
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
TSC="${TS_TSC:-/mnt/hdd/crossbuild-tools/npm-ts/node_modules/.bin/tsc}"
[ -x "$TSC" ] || { echo "FATAL: 找不到 tsc（$TSC）。装法见本脚本头。" >&2; exit 2; }

cd "$REPO"
"$TSC" bridge/octave-page.ts \
  --target ES5 --lib DOM,ES2015 --module none \
  --strict --alwaysStrict false --noImplicitAny --removeComments false \
  --outFile bridge/octave-page.js
echo "✅ bridge/octave-page.js 已生成（$(wc -c < bridge/octave-page.js) B）"
