#!/bin/sh
# Octave-Full-Wasm — 打交付包（站点 → 可直接 rsync 上静态托管的目录 + .tar.zst）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
#   sh build/make-dist.sh [站点目录] [输出目录] [包名]
#   默认：/mnt/hdd/octave-wasm-build/site → /mnt/hdd/octave-wasm-build/dist → octave-full-wasm-site-<date>
#
# 包内容（照 2026-09-20 那版的结构，另加本轮的 dldfcn/webaudio/webnet 资产）：
#   * 站点全部文件（含 assets/ 懒加载资产）
#   * 每个文本资源预压一份 .gz（nginx gzip_static 直接发，服务器零压缩成本）
#   * MANIFEST.sha256（未压缩源文件的校验和）
#   * serve.py（本地预览：wasm MIME + gzip_static 语义）、DEPLOY.md
#
# 注意：**不要**把 .gz 也算进 MANIFEST —— 校验的是源文件，.gz 是可再生的派生品。
set -e
REPO=/mnt/hdd/zcode-projects/Octave-Full-Wasm
SITE=${1:-/mnt/hdd/octave-wasm-build/site}
DIST=${2:-/mnt/hdd/octave-wasm-build/dist}
NAME=${3:-octave-full-wasm-site-$(date +%Y%m%d)}
OUT=$DIST/$NAME

echo "== 打包 $SITE → $OUT =="
rm -rf "$OUT"
mkdir -p "$OUT"
# 站点内容（排除上一版留下的临时/派生文件）
cd "$SITE"
tar cf - --exclude='*.gz' --exclude='__pycache__' --exclude='*.pyc' . | (cd "$OUT" && tar xf -)

echo "== 预压缩（gzip -9，nginx gzip_static 用）=="
# 只压文本型资源；.oct/.wasm 也压（wasm 压缩率很高）
cd "$OUT"
find . -type f \( -name '*.js' -o -name '*.html' -o -name '*.css' -o -name '*.json' \
  -o -name '*.m' -o -name '*.svg' -o -name '*.wasm' -o -name '*.data' -o -name '*.oct' \) \
  -exec gzip -9 -k -f {} \;
# 预压完删掉源文件里的 .gz 之外的临时件
echo "  预压文件数: $(find . -name '*.gz' | wc -l)"

echo "== 清单（未压缩源文件）=="
cd "$OUT"
: > MANIFEST.sha256
find . -type f ! -name '*.gz' ! -name 'MANIFEST.sha256' | sed 's|^\./||' | sort | while read -r f; do
  sha256sum "$f" >> MANIFEST.sha256
done
{
  echo "# Octave-Full-Wasm 站点包清单（$(date +%Y-%m-%d)）"
  echo "# 校验：sha256sum -c MANIFEST.sha256   （以下为未压缩源文件）"
  echo "#"
  cat MANIFEST.sha256
} > MANIFEST.sha256.new
mv MANIFEST.sha256.new MANIFEST.sha256
cp "$REPO/dist/DEPLOY.md" "$OUT/DEPLOY.md" 2>/dev/null || true
cp "$REPO/dist/serve.py" "$OUT/serve.py" 2>/dev/null || true

echo "== 统计 =="
du -sh "$OUT"
echo "  文件数: $(find . -type f | wc -l)（含 $(find . -name '*.gz' | wc -l) 个预压件）"
for f in octave.wasm octave.js octave.data; do
  raw=$(stat -c%s "$f" 2>/dev/null || echo 0)
  gz=$(stat -c%s "$f.gz" 2>/dev/null || echo 0)
  printf "  %-14s raw %6.2f MB   gz %5.2f MB\n" "$f" "$(echo "$raw/1048576" | bc -l)" "$(echo "$gz/1048576" | bc -l)"
done
echo "  懒加载资产: $(find assets -type f ! -name '*.gz' | wc -l) 个（$(du -sh assets | cut -f1)，不进首包）"

echo "== 归档 =="
cd "$DIST"
# -f 覆盖已有归档（重打同一包名是常见操作，默认行为会静默保留旧档）
rm -f "$NAME.tar.zst"
tar -cf - "$NAME" | zstd -19 -T24 -q -f -o "$NAME.tar.zst"
sha256sum "$NAME.tar.zst" > "$NAME.tar.zst.sha256"
ls -la "$NAME.tar.zst" "$NAME.tar.zst.sha256"
echo "DIST DONE: $OUT"
