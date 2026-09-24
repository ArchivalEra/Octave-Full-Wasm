#!/bin/sh
# Octave-Full-Wasm — fontconfig 机制闸门（30 秒，不碰 Octave 源码）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 目的：在**付全量重编的代价之前**，先证明"静态 fontconfig + MEMFS 配置/字体"这条路走得通。
# 详见 probe-fontconfig.c 的文件头（要验的 5 件事）。
#
# 用法（容器内）：sh probe-fontconfig.sh
set -e

WORK="${WORK:-/src/libwork/fontconfig-probe}"
FC="${FC:-/src/deps/fontconfig}"
EXPAT="${EXPAT:-/src/deps/expat}"
FT="${FT:-/src/deps/freetype}"
FONTS_DIR="${FONTS_DIR:-/src/work/octave-install/share/octave/11.3.0/fonts}"

[ -s "$FC/lib/libfontconfig.a" ] || { echo "FATAL: 先跑 build-fontconfig.sh" >&2; exit 2; }
[ -d "$FONTS_DIR" ] || { echo "FATAL: 字体目录不存在：$FONTS_DIR" >&2; exit 2; }

rm -rf "$WORK"; mkdir -p "$WORK/conf"
# 把字体与配置摆成"站点里的样子"：字体目录用 octfontsdir，配置放 /fonts/fonts.conf
cp -a "$FONTS_DIR"/FreeSans*.otf "$WORK/conf/" 2>/dev/null || true
ls "$WORK/conf"/*.otf >/dev/null 2>&1 || { echo "FATAL: $FONTS_DIR 里没有 FreeSans*.otf" >&2; exit 2; }
cp /src/probe-fontconfig.c "$WORK/probe.c"

# ⚠️ `<dir>` 必须是**预载进 wasm FS 的路径**，不是容器里的源路径（第一版写成了 $FONTS_DIR
#    ⇒ FcFontList 恒为 0 个 face，而且**一声不响** —— 正是"看着像字体没装、其实是路径不对"）。
#    站点里的真实情形：字体预载在 octfontsdir，所以那里 `<dir>` 就写 octfontsdir。
cat > "$WORK/fonts.conf" <<EOF
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <dir>/probe-fonts</dir>
  <cachedir>/tmp/fontconfig-cache</cachedir>
</fontconfig>
EOF

echo "== 编译探针（-fwasm-exceptions，与主链口径一致）"
emcc -O2 -fwasm-exceptions "$WORK/probe.c" \
  -I"$FC/include" -L"$FC/lib" -lfontconfig \
  -I"$FT/include" -I"$FT/include/freetype2" -L"$FT/lib" -lfreetype \
  -L"$EXPAT/lib" -lexpat -lz \
  -o "$WORK/probe.js" \
  --preload-file "$WORK/conf@/probe-fonts" \
  --preload-file "$WORK/fonts.conf@/fonts/fonts.conf" \
  -sEXIT_RUNTIME=0 -sALLOW_MEMORY_GROWTH=1 2>&1 | tail -8

echo "== 跑（node）"
cd "$WORK"
echo "---- ①  默认 family（FreeSans）"
node probe.js || echo "（退出码非 0 —— 见上面的 PROBE FAIL）"
echo "---- ②  要 FreeSans Bold（Octave 的 fontname='FreeSans Bold' 就走这条）"
node probe.js FreeSans Bold || echo "（退出码非 0）"
echo "---- ③  要一个**不存在**的 family（应当落到某个真实文件，而不是空）"
node probe.js NoSuchFamilyXX || echo "（退出码非 0）"
echo "---- ④  反证：把 FONTCONFIG_FILE 指到不存在的路径（应当 0 个 face —— 证明①不是假绿）"
node probe.js FreeSans "" /nonexistent/fonts.conf || true
