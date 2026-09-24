#!/bin/sh
# Octave-Full-Wasm — 建 wasm 版 FreeType（带 -fPIC），供 Octave 的 GL 文字渲染用
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# ── 为什么需要它（HANDOFF §8 待办 2）────────────────────────────────────────
# 图形线的刻度/title/legend 文字全部来自 Octave 的 `opengl_renderer::render_text` →
# `ft-text-renderer.cc`，而 configure 一直带 `--without-freetype` ⇒ `HAVE_FREETYPE` 未定义
# ⇒ `text_to_pixels()` 返回空 ⇒ **文字整块空白**（不崩，但图上没字）。
#
# ★ 关键事实：**不需要 fontconfig**。`ft-text-renderer.cc:303-320` 在无 fontconfig 时的
#   回落路径是：`OCTAVE_FONTS_DIR`（环境变量）→ `SYSTEM_FREEFONT_DIR`（编译期）→
#   `config::oct_fonts_dir()`，然后在里面找 **`FreeSans[Bold][Oblique].otf`**。而 Octave
#   **自带**这几个字体（`etc/fonts/`，`make install` 装到 `<datadir>/octave/<ver>/fonts`）。
#   所以只要 FreeType + 把字体预载到那个目录即可（挂载点见 link-web.sh 的 PRELOAD_FONTS）。
#   代价（如实）：没有 fontconfig ⇒ `fontname` 属性被忽略（任何字体名都落到 FreeSans）、
#   `listfonts` 返回空。
#
# ── 为什么自己编而不吃 emscripten 的端口 ────────────────────────────────────
# `emcc -sUSE_FREETYPE=1` 能自动建端口（实测 10 秒、`cache/sysroot/lib/.../libfreetype.a`），
# 但它建的是**非 PIC** 库；本项目的主链是 `MAIN_MODULE=1`（可重定位）、**全树 -fPIC**，
# 混进非 PIC 归档会在 dylink 那层出问题（7.2 时代为 zlib/bzip2 专门要过 `--pic`）。
# 所以这里按**端口自己的源文件清单**用 `-fPIC` 编一遍 —— 清单与开关抄自
# `tools/ports/freetype.py`（那份是被长期验证过的"无外部依赖"集合）。
#
# 依赖：zlib（`-DFT_CONFIG_OPTION_SYSTEM_ZLIB`；主链本来就有 `-lz`，见 link-web.sh）。
# 不建：png/bzip2/harfbuzz/brotli（字体渲染用不到）。
#
# 用法（容器内）：sh build-freetype.sh
set -e

PREFIX="${PREFIX:-/src/deps/freetype}"
SRC="${SRC:-/src/libwork/freetype-src}"
# 源从哪来：emsdk 的端口缓存里已经解包着一份（跑一次 `emcc -sUSE_FREETYPE=1` 就会取下来）。
PORT_SRC="${PORT_SRC:-/emsdk/upstream/emscripten/cache/ports/freetype/freetype-VER-2-13-3}"
OBJ="$PREFIX/obj"

if [ ! -d "$SRC" ]; then
  [ -d "$PORT_SRC" ] || {
    echo "FATAL: 找不到 freetype 源码。先在容器里跑一次：" >&2
    echo "  printf '#include <ft2build.h>\\n#include FT_FREETYPE_H\\nint main(){FT_Library l;return FT_Init_FreeType(&l);}\\n' > /tmp/ft.c && emcc -sUSE_FREETYPE=1 /tmp/ft.c -o /tmp/ft.js" >&2
    echo "（那会让 emscripten 把源码取到 $PORT_SRC）" >&2
    exit 2
  }
  cp -a "$PORT_SRC" "$SRC"
fi
# 端口缓存里的文件没有可执行位（configure 跑不动），但我们**不跑 configure** ⇒ 无所谓。
mkdir -p "$OBJ" "$PREFIX/lib" "$PREFIX/include" "$PREFIX/lib/pkgconfig"

SRCS="builds/unix/ftsystem.c
src/autofit/autofit.c
src/base/ftbase.c
src/base/ftbbox.c
src/base/ftbdf.c
src/base/ftbitmap.c
src/base/ftcid.c
src/base/ftdebug.c
src/base/ftfstype.c
src/base/ftgasp.c
src/base/ftglyph.c
src/base/ftgxval.c
src/base/ftinit.c
src/base/ftmm.c
src/base/ftotval.c
src/base/ftpatent.c
src/base/ftpfr.c
src/base/ftstroke.c
src/base/ftsynth.c
src/base/fttype1.c
src/base/ftwinfnt.c
src/bdf/bdf.c
src/bzip2/ftbzip2.c
src/cache/ftcache.c
src/cff/cff.c
src/cid/type1cid.c
src/gzip/ftgzip.c
src/lzw/ftlzw.c
src/pcf/pcf.c
src/pfr/pfr.c
src/psaux/psaux.c
src/pshinter/pshinter.c
src/psnames/psnames.c
src/raster/raster.c
src/sdf/sdf.c
src/sfnt/sfnt.c
src/smooth/smooth.c
src/svg/svg.c
src/truetype/truetype.c
src/type1/type1.c
src/type42/type42.c
src/winfonts/winfnt.c"

# ⚠️ `-fwasm-exceptions` 必须与整棵树一致（configure-113-full.sh 的 CFLAGS/CXXFLAGS）。
#    踩过：只写 `-O2 -fPIC` 时，链接期直接断言失败 ——
#      `AssertionError: invoke_ functions exported but exceptions and longjmp are both disabled`
#    （非异常模式的目标文件会把 `invoke_*` 胶水带进链接，而主链是 wasm 异常模式。）
FLAGS="-O2 -fPIC -fwasm-exceptions -DFT2_BUILD_LIBRARY -DFT_CONFIG_OPTION_SYSTEM_ZLIB -DHAVE_UNISTD_H -DHAVE_FCNTL_H
       -I$SRC/include -I$SRC/truetype -I$SRC/sfnt -I$SRC/autofit -I$SRC/smooth -I$SRC/raster
       -I$SRC/psaux -I$SRC/psnames"

echo "== 编 freetype（$(echo "$SRCS" | wc -l) 个 TU，-fPIC）"
i=0
for s in $SRCS; do
  i=$((i + 1))
  # shellcheck disable=SC2086
  emcc $FLAGS -c "$SRC/$s" -o "$OBJ/$(echo "$s" | tr '/' '_').o" || {
    echo "FATAL: 编不过 $s" >&2; exit 3; }
done
echo "   编译完成：$i 个目标文件"

emar rcs "$PREFIX/lib/libfreetype.a" "$OBJ"/*.o
[ -s "$PREFIX/lib/libfreetype.a" ] || { echo "FATAL: 归档没产出" >&2; exit 3; }

cp -a "$SRC/include/." "$PREFIX/include/"

# 手写 freetype2.pc：configure 走 `PKG_CHECK_MODULES([FT2],[freetype2])` +
# `--atleast-version=9.03`。**版本号必须是 libtool 式**（26.2.20 对应 freetype 2.13.x；
# 端口那份 .pc 也是这么写的）—— 写成语义版本 2.13.3 会是 2.13.3 ≥ 9.03 也过，
# 但两头不一致容易让人误会，照端口来。
cat > "$PREFIX/lib/pkgconfig/freetype2.pc" <<EOF
prefix=$PREFIX
exec_prefix=\${prefix}
libdir=\${exec_prefix}/lib
includedir=\${prefix}/include

Name: freetype2
Description: FreeType (wasm, built for Octave-Full-Wasm with -fPIC)
Version: 26.2.20
Requires:
Libs: -L\${libdir} -lfreetype
Libs.private: -lz
Cflags: -I\${includedir} -I\${includedir}/freetype2
EOF

# ---- 符号自检（照抄本项目其它库的习惯：归档里该有的必须有）----------------------
need="FT_Init_FreeType FT_Done_FreeType FT_New_Face FT_Reference_Face FT_Set_Pixel_Sizes"
miss=""
for s in $need; do
  emnm "$PREFIX/lib/libfreetype.a" 2>/dev/null | grep -q " T $s$" || miss="$miss $s"
done
[ -z "$miss" ] || { echo "FATAL: 归档里缺符号：$miss" >&2; exit 4; }

# 未定义符号：**归档口径要小心**。`emnm -u <归档>` 列的是**每个成员各自的**未定义符号，
# 里面天然包含"本成员没定义、但别的成员定义了"的跨成员引用（freetype 的 base 目录就是
# `ftbase.c` 把 `ftobjs.c`/`ftstream.c`… 用 `#include` 收进一个 TU 的）。
# 所以正确的判据是：**每个未定义的自家符号，必须在归档的某个成员里有定义**。
# （第一版直接拿 `-u` 的表当"缺符号"，于是误报了 `FT_Activate_Size`。）
ALIB="$PREFIX/lib/libfreetype.a"
defined=$(emnm "$ALIB" 2>/dev/null | awk '$2 ~ /^[TtDdRrWwBb]$/ {print $NF}' | sort -u || true)
# ⚠️ 比对前要把换行**压成空格**：`case` 的 `*" $s "*` 匹配的是"空格分隔"的串，
#    而命令替换出来的多行串分隔符是**换行** —— 直接比会"明明在表里却判成缺"（实测踩过）。
defined_flat=" $(echo "$defined" | tr '\n' ' ') "
selfundef=$(emnm -u "$ALIB" 2>/dev/null | awk '{print $NF}' | \
            grep -E '^(FT_|TT_|T1_|CFF_|PS_|AF_|CF2_|pcf_|bdf_|sdf_|svg_|af_|cf2_)' | sort -u || true)
really_missing=""
for s in $selfundef; do
  case "$defined_flat" in
    *" $s "*) ;;
    *) really_missing="$really_missing $s" ;;
  esac
done
[ -z "$really_missing" ] || {
  echo "FATAL: 这些 freetype 自家符号在归档里**没有任何成员定义**（漏编 TU？）：$really_missing" >&2
  exit 4; }

zlibundef=$(emnm -u "$ALIB" 2>/dev/null | awk '{print $NF}' | \
            grep -E '^(inflate|deflate|crc32|adler32|zlibVersion|compress|uncompress|gz)' | sort -u || true)
echo "   自家未定义符号：$(echo "$selfundef" | wc -w) 个，全部由归档内其它成员定义 ✔"
echo "   zlib 未定义符号（由主链 -lz 提供）：$(echo "$zlibundef" | tr '\n' ' ')"

echo "== 产物：$PREFIX/lib/libfreetype.a $(stat -c%s "$PREFIX/lib/libfreetype.a") 字节"
echo "   pkg-config：PKG_CONFIG_PATH=$PREFIX/lib/pkgconfig pkg-config --modversion freetype2"
