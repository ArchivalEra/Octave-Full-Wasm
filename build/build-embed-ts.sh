#!/bin/sh
# Octave-Full-Wasm — **页面适配器 TS 构建**（工单 48）
# Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
#
# bridge/octave-page.ts  →  bridge/octave-page.js（页面 <script src> 引的就是这份）
#
# 为什么 TS 但编译成**单文件全局脚本**：页面用 <script src="octave-page.js"> 直引（无打包器），
# 所以产物必须是**无模块、无依赖、全局脚本**；类型只在源码里（编译后全擦除）。
#
# ★ 目标档 = ES2020（2026-11-01，工单 72）：原先是 `--target ES5`，那是**没有依据的保守**——
#   用户已把浏览器下限定在 **Chrome 123**（ES5 兼容不再是要求）。代价很具体：ES5 会把源码里
#   每一条 `const`/`let` **降级成 `var`**，于是产物里 29 条 `var` 全是**编译目标造的**，不是
#   源码要的（源码一直是 `const`）。GitRoll 那 363 条 `var` 里有一部分就是这种"工具链替你
#   造出来的债"。改档后产物里 `const`/`let` 原样保留，`var` 只剩源码真的写了的那些。
#   ⚠️ 别手动编辑 `bridge/octave-page.js`——它是**产物**。上次（`cb127c2`）我直接改产物把
#   29 条 `var` 手改成 `let`，结果下一跑本脚本就被打回（源码与产物漂移）。改这里，或改 `.ts`。
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
  --target ES2020 --lib DOM,ES2020 --module none \
  --strict --alwaysStrict false --noImplicitAny --removeComments false \
  --outFile bridge/octave-page.js
echo "✅ bridge/octave-page.js 已生成（$(wc -c < bridge/octave-page.js) B）"
