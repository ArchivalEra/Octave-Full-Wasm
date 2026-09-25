#!/bin/sh
# Octave-Full-Wasm — **部署件 SHA 检查**（2026-09-25）—— 防"改完程序用旧产物跑测试"
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 三层判据（对应本会话踩过的三类事故，HISTORY §5.46/§5.47/§5.49）：
#   ① 磁盘层：<站点目录>/octave.wasm 的 sha256 == 期望 sha（promote 覆盖事故：8761 被
#      out-webgl 旧件盖掉，boot 照绿，唯一露馅是字体警告 —— 这条把"覆盖"当场拦下）；
#   ② HTTP 层：从被测 URL 下载 octave.wasm 算 sha == 磁盘层（服务/缓存漂移）；
#   ③ 页面层：留给 test/browser/probe-artifact-sha.mjs（页面实例化字节的自证）。
#
# 用法：
#   sh build/check-deploy-sha.sh <站点目录> <期望wasm sha> [URL]
#   例：sh build/check-deploy-sha.sh /mnt/hdd/octave-wasm-build/siteWebGL \
#         b40a2b14…  http://127.0.0.1:8768/
# 期望 sha 缺省取 <站点目录>/octave.wasm 自身（则①恒绿，只查②）；URL 缺省不打。
set -eu
SITE="${1:?用法: check-deploy-sha.sh <站点目录> <期望wasm sha> [URL]}"
EXPECT="${2:-}"
URL="${3:-}"

FILE_SHA=$(sha256sum "$SITE/octave.wasm" | cut -d' ' -f1)

if [ -n "$EXPECT" ]; then
  if [ "$FILE_SHA" != "$(printf '%s' "$EXPECT" | tr 'A-Z' 'a-z')" ]; then
    echo "FATAL ① 磁盘层: $SITE/octave.wasm sha=$FILE_SHA ≠ 期望 $EXPECT" >&2
    echo "       （站点上的不是刚构建的那份 —— 先重部署再跑测试）" >&2
    exit 3
  fi
  echo "① 磁盘层 ✓ $FILE_SHA"
else
  echo "① 磁盘层（无期望值，记录）$FILE_SHA"
fi

if [ -n "$URL" ]; then
  HTTP_SHA=$(curl -s --noproxy '*' --max-time 120 "$URL/octave.wasm" | sha256sum | cut -d' ' -f1)
  if [ "$HTTP_SHA" != "$FILE_SHA" ]; then
    echo "FATAL ② HTTP 层: URL 吐出的 wasm sha=$HTTP_SHA ≠ 磁盘 $FILE_SHA" >&2
    echo "       （服务在吐旧字节：缓存/另一个目录/另一个服务进程）" >&2
    exit 4
  fi
  echo "② HTTP 层 ✓ 与磁盘一致"
fi
echo "部署件 SHA 检查通过。页面层自证请跑: node test/browser/probe-artifact-sha.mjs <URL> $FILE_SHA"
