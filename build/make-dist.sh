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
#    ⚠️ 但 `*.tar.gz`（Forge 包字节）**是**源文件，必须进（2026-10-10 修，见下面 stage 段）。
set -e
REPO=/mnt/hdd/zcode-projects/Octave-Full-Wasm

# ── F1 自证：三类用例（正常不报 / 该报的必须报 / 空输入必须报）───────────────
# 为什么要有它（2026-10-10 实测）：本脚本的排除面曾用一条 `--exclude='*.gz'`，把
# `assets/forge/*.tar.gz`（客户端装包的**下载源**）一起从交付包里静默删掉 —— 页面照开、
# 装包时才 404。这条自证就是把那个形状焊死在夹具里：派生 .gz 必须被排除，
# 包字节必须留下，而"只进了一半"必须红。
if [ "${1:-}" = "--selftest" ]; then
  tmp="$(mktemp -d)"; bad=0; n=0
  mk() {  # 造夹具站点：$1=目录 $2=forge 包数
    mkdir -p "$1/assets/forge"
    printf 'w' > "$1/octave.wasm"; printf 'g' > "$1/octave.js.gz"; printf 'h' > "$1/index.html"
    printf '{}' > "$1/assets/forge-catalog.json"
    i=0; while [ "$i" -lt "$2" ]; do printf 'p' > "$1/assets/forge/pkg$i-1.0.tar.gz"; i=$((i+1)); done
  }
  # ① 正常：3 个包字节 + 1 个派生 .gz ⇒ 不报，且包字节全进、派生件被排除
  n=$((n+1)); mk "$tmp/s1" 3
  if sh "$0" "$tmp/s1" "$tmp/d1" t1 >/dev/null 2>&1 \
     && [ "$(find "$tmp/d1/t1" -name '*.tar.gz' | wc -l)" = 3 ] \
     && [ "$(find "$tmp/d1/t1" -name 'octave.js.gz' | wc -l)" = 0 ]; then
    echo "PASS | make-dist/正常：包字节全进（3）+ 派生 .gz 被排除"
  else echo "fail | make-dist/正常夹具竟然红（或排除面错了）"; bad=1; fi
  # ② 空输入：站点不存在 ⇒ 必须红
  n=$((n+1))
  if sh "$0" "$tmp/definitely-missing-site" "$tmp/d2" t2 >/dev/null 2>&1; then
    echo "fail | make-dist/**空输入（站点不存在）竟没报**"; bad=1
  else echo "PASS | ★ 站点不存在 ⇒ 必须红"; fi
  # ③ 零值守卫：站点有 assets/forge 目录但 0 个包字节 ⇒ 明说不查（不假装查过）、不报错
  n=$((n+1)); mk "$tmp/s3" 0
  if out=$(sh "$0" "$tmp/s3" "$tmp/d3" t3 2>&1); then
    if printf '%s' "$out" | grep -q 'Forge 包字节'; then
      echo "fail | make-dist/0 个包字节却打了 Forge 计数行（零值不该冒充查过）"; bad=1
    else echo "PASS | 站点无 Forge 包 ⇒ 该判据明说不适用（不空转）"; fi
  else echo "fail | make-dist/无 Forge 包竟红了"; bad=1; fi
  rm -rf "$tmp"
  echo "=== make-dist 自证：$((n-bad)) PASS / $bad fail ==="
  exit "$bad"
fi

SITE=${1:-/mnt/hdd/octave-wasm-build/site}
DIST=${2:-/mnt/hdd/octave-wasm-build/dist}
NAME=${3:-octave-full-wasm-site-$(date +%Y%m%d)}
OUT=$DIST/$NAME

echo "== 打包 $SITE → $OUT =="
rm -rf "$OUT"
mkdir -p "$OUT"
# 站点内容（排除上一版留下的临时/派生文件）
# ⚠️ **不许**用 `--exclude='*.gz'`（2026-10-10 实测到的坑）：Forge 的包字节就是
#    `assets/forge/*.tar.gz` —— 那是**源资产**（客户端 `install()` 的下载源），不是本脚本
#    预压出来的派生件；一条通配会在交付包里**静默**删掉 10 个包（装包时 404，页面照开）。
#    排除面 = 本脚本自己产出的那些**派生** .gz（与下面预压缩那行的 `-name` 清单同一张表）。
cd "$SITE"
SITE_ABS=$(pwd)
OUT_ABS=$(cd "$OUT" && pwd)
EXCL=""
for p in '*.js.gz' '*.html.gz' '*.css.gz' '*.json.gz' '*.m.gz' '*.svg.gz' '*.wasm.gz' '*.data.gz' '*.oct.gz'; do
  EXCL="$EXCL --exclude=$p"
done
# `set -f`：$EXCL 是拼出来的字符串，禁掉通配展开（否则 `--exclude=*.js.gz` 这种词
# 会被 shell 再当 glob 试一遍 —— 现在没这形状的文件，但别留这个坑）。
set -f
# shellcheck disable=SC2086
tar cf - --exclude='__pycache__' --exclude='*.pyc' $EXCL . | (cd "$OUT_ABS" && tar xf -)
set +f

# ★ fail-closed（2026-10-10）：站点上有 Forge 包字节时，交付包里必须**一个不少** ——
#   它们是 `install()` 的下载源；少一个的表现是"页面能开、装包时才 404"（静默降级，
#   正是本仓点名的退化形状）。计数对着**站点原目录**核，不对清单自我循环。
if [ -d "$SITE_ABS/assets/forge" ]; then
  want=$(find "$SITE_ABS/assets/forge" -name '*.tar.gz' | wc -l)
  got=$(find "$OUT_ABS/assets/forge" -name '*.tar.gz' 2>/dev/null | wc -l)
  if [ "$want" -gt 0 ] && [ "$want" != "$got" ]; then
    echo "FATAL: Forge 包字节只进了 $got/$want 个（tar 的排除面吃掉了？）——交付包会装不了包" >&2
    exit 3
  fi
  [ "$want" -gt 0 ] && echo "  Forge 包字节: $got 个（与站点逐数一致）"
fi

echo "== 预压缩（gzip -9，nginx gzip_static 用）=="
# 只压文本型资源；.oct/.wasm 也压（wasm 压缩率很高）
cd "$OUT_ABS"
find . -type f \( -name '*.js' -o -name '*.html' -o -name '*.css' -o -name '*.json' \
  -o -name '*.m' -o -name '*.svg' -o -name '*.wasm' -o -name '*.data' -o -name '*.oct' \) \
  -exec gzip -9 -k -f {} \;
# 预压完删掉源文件里的 .gz 之外的临时件
# （只数**派生**件：`*.tar.gz` 是源资产，混进来会让这个数看着像"多压了 10 个东西"）
echo "  预压文件数: $(find . -type f | grep -cE '\.(js|html|css|json|m|svg|wasm|data|oct)\.gz$' || true)"

echo "== 清单（未压缩源文件）=="
cd "$OUT_ABS"
: > MANIFEST.sha256
# ⚠️ 排除面同上面那条：**派生** .gz 不进清单（可再生），但 `*.tar.gz`（Forge 源资产）
#    必须进（校验的是"交付了什么源件"）。
find . -type f ! -name 'MANIFEST.sha256' | grep -vE '\.(js|html|css|json|m|svg|wasm|data|oct)\.gz$' \
  | sed 's|^\./||' | sort | while read -r f; do
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
