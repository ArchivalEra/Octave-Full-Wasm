#!/bin/sh
# Octave-Full-Wasm — Forge 包「纯 .m 车道」一键构建（取包 → 打包 → 出资产清单）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 用法：
#   build/forge-build.sh [站点目录] [包名…]      # 默认站点 /mnt/hdd/octave-wasm-build/site
#
# 做的事（每一步都可单独重跑）：
#   1) build/forge-fetch.py  —— 按 Octave 版本过滤 + 依赖递归，下载并校验 sha256
#   2) 解包到 third_party/forge/src
#   3) build/assets.py bundle-pkg —— 打成 JS 资产包（inst/ 上提、PKG_ADD 抽取）
#   4) build/assets.py gen-manifest —— 出资产清单
#
# 版本为什么不能取最新：Forge 新版常要求更新的 Octave（statistics 1.7.7 要 ≥8.1，
# 而本项目是 7.2）——过滤逻辑在 forge-fetch.py 里，按 DESCRIPTION 的 depends 判。
set -e
REPO=/mnt/hdd/zcode-projects/Octave-Full-Wasm
SITE=${1:-/mnt/hdd/octave-wasm-build/site}
shift 2>/dev/null || true
PKGS=${*:-"struct nan splines geometry quaternion tsa miscellaneous optim statistics"}
FORGE=/mnt/hdd/octave-wasm-build/third_party/forge
OCTAVE_VER=${OCTAVE_VER:-7.2.0}
PREFIX=/usr/src/octave/m/forge

mkdir -p "$SITE/assets/pkg" "$FORGE/src"

echo "== 1) 取包（Octave $OCTAVE_VER 兼容版 + 依赖闭包）=="
python3 "$REPO/build/forge-fetch.py" --octave "$OCTAVE_VER" --dest "$FORGE" $PKGS

echo "== 2) 解包 =="
for t in "$FORGE"/*.tar.gz; do
  [ -f "$t" ] || continue
  tar xzf "$t" -C "$FORGE/src" 2>/dev/null || true
done

echo "== 3) 打包成资产 =="
# 目录名 → 包名（tarball 解出来的名字带版本号，statistics 的 GitHub 包还带 release- 前缀）
for d in "$FORGE"/src/*/; do
  base=$(basename "$d")
  name=$(echo "$base" | sed -E 's/-release-[0-9].*$//; s/-[0-9]+\.[0-9]+.*$//')
  [ -f "$d/DESCRIPTION" ] || continue
  python3 "$REPO/build/assets.py" bundle-pkg "$name" "$d" "$PREFIX/$name" "$SITE/assets/pkg/$name.js"
done

echo "== 4) 资产清单 =="
python3 "$REPO/build/assets.py" gen-manifest "$SITE"
echo "FORGE BUILD DONE（浏览器加载：await OctaveAssets.load('<包名>')）"
