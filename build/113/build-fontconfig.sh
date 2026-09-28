#!/bin/sh
# Octave-Full-Wasm — 建 wasm 版 fontconfig（静态、-fPIC），供 Octave 的字体匹配用
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# ── 为什么需要它（HISTORY §5.29 R3 / §5.30）─────────────────────────────────
# 批次 D 把 FreeType 编进来了，文字能画了 —— 但**没有 fontconfig**的两条代价是硬的：
#   ① `fontname` 属性**存得住、渲染时被忽略**（`ft-text-renderer.cc` 只有在 `HAVE_FONTCONFIG`
#      时才用 `FcFontMatch()` 去挑字体文件；没有它就走 FreeSans 回落）；
#   ② `listfonts()` / `get_system_fonts()` 报 `structure has no member 'family'`
#      （`do_get_system_fonts()` 在无 fontconfig 时构造的是空 `octave_map`）。
# 这两条**同一个根因**，所以修法只有一个：把 fontconfig 接上。外部审核明确反对
# "写个 fake `listfonts`" —— 那会让 ① 变成假绿（属性看起来能设、图没变）。
#
# ── 配方（先例：OpenSCAD-WASM 的静态 fontconfig 路线，见 §5.30 引用的依据）──
#   · 静态（`--disable-shared --enable-static`）+ `-fPIC`（本仓主链可重定位，非 PIC 会出问题）；
#   · `-fwasm-exceptions` 必须与整棵树一致（踩过：freetype 少了它就报
#     `invoke_ functions exported but exceptions and longjmp are both disabled`）；
#   · `--disable-cache-build`：**不在构建期**跑 fc-cache（运行期的 cache 由 wasm 内部自己建）；
#   · `--sysconfdir=/`：**关键** —— fontconfig 的编译期默认配置路径就是 `${sysconfdir}/fonts`，
#     于是配置文件落在 `/fonts/fonts.conf`（MEMFS 里挂在那儿，运行时零环境变量）；
#   · `--with-default-fonts=/fonts`：默认字体目录（我们的 fonts.conf 里会显式写 `<dir>`，
#     这条只是不给它留一个不存在的空目录语义）；
#   · XML 后端用 **expat**（比 libxml2 小得多；`--enable-libxml2` 是另一条路，本仓没走）。
#
# ── 依赖 ──────────────────────────────────────────────────────────────────
# expat（先建，静态 + PIC）。源码/产物都不在系统 sysroot 里 ⇒ 手写 `expat.pc`，
# 因为 fontconfig 是 `PKG_CHECK_MODULES(EXPAT, expat)` 找它的（2.14.2 的 configure.ac）。
#
# 用法（容器内）：sh build-fontconfig.sh
#   源包需要先放好（宿主下载 → docker cp）：
#     /src/libwork/expat-2.6.4.tar.gz       ← https://github.com/libexpat/libexpat/releases
#     /src/libwork/fontconfig-2.14.2.tar.gz ← https://www.freedesktop.org/software/fontconfig/release/
set -e

WORK="${WORK:-/src/libwork}"
PREFIX_EXPAT="${PREFIX_EXPAT:-/src/deps/expat}"
PREFIX_FC="${PREFIX_FC:-/src/deps/fontconfig}"
JOBS="${JOBS:-$(nproc 2>/dev/null || echo 8)}"

# 与 configure-113-full.sh / link-web.sh 的口径逐字一致（-O2 + wasm 异常 + PIC）
LANE_FLAGS="${LANE_FLAGS:-}"   # ★ 车道旗标（branch threads）：emconfigure 把 CC 钉成
                              #   绝对路径 ⇒ 影子管不到，必须拼进显式 CFLAGS
CFLAGS_BASE="-O2 -fPIC -fwasm-exceptions $LANE_FLAGS"

# ── `--host` 要不要给？看它自带的 `config.sub` 认不认识 emscripten（实测的坑）────────
# expat 2.6.4 的 config.sub 是旧的 ⇒ `--host=wasm32-unknown-emscripten` 直接报
#   `Invalid configuration ... system 'emscripten' not recognized`。
# 不给 `--host` 也**能**编对：`emconfigure` 已经把 CC/CXX 换成 emcc/em++，交叉这件事由它负责
# （本仓 zlib/fftw 的配方就是这么走的）。所以这里按 config.sub 的能力自动决定。
host_opt () {
  if [ -n "${TARGET_HOST:-}" ]; then
    echo "--host=$TARGET_HOST"
  elif [ -f config.sub ] && grep -q emscripten config.sub; then
    echo "--host=wasm32-unknown-emscripten"
  else
    echo "（config.sub 不认识 emscripten ⇒ 不带 --host，靠 emconfigure 换 CC）" >&2
    echo ""
  fi
}

# ---------------------------------------------------------------------------
# ① expat
# ---------------------------------------------------------------------------
if [ ! -s "$PREFIX_EXPAT/lib/libexpat.a" ]; then
  echo "== expat 2.6.4 → $PREFIX_EXPAT"
  [ -f "$WORK/expat-2.6.4.tar.gz" ] || { echo "FATAL: 缺 $WORK/expat-2.6.4.tar.gz" >&2; exit 2; }
  cd "$WORK" && rm -rf expat-2.6.4 && tar xf expat-2.6.4.tar.gz
  cd "$WORK/expat-2.6.4"
  # 只要库本体：xmlwf（工具）/docbook/examples/tests 全关 —— 它们会引入额外的宿主工具依赖
  HOST_OPT=$(host_opt)
  emconfigure ./configure $HOST_OPT --prefix="$PREFIX_EXPAT" \
      --disable-shared --enable-static \
      --without-xmlwf --without-docbook --without-examples --without-tests \
      CFLAGS="$CFLAGS_BASE" > "$WORK/expat-conf.log" 2>&1 \
    || { echo "FATAL: expat configure 失败，见 $WORK/expat-conf.log"; tail -20 "$WORK/expat-conf.log" >&2; exit 3; }
  emmake make -j"$JOBS" > "$WORK/expat-make.log" 2>&1 \
    || { echo "FATAL: expat make 失败，见 $WORK/expat-make.log"; tail -20 "$WORK/expat-make.log" >&2; exit 3; }
  emmake make install > "$WORK/expat-inst.log" 2>&1 \
    || { echo "FATAL: expat install 失败"; tail -20 "$WORK/expat-inst.log" >&2; exit 3; }
else
  echo "== expat 已有：$PREFIX_EXPAT/lib/libexpat.a（跳过）"
fi

# 手写 expat.pc（fontconfig 靠 pkg-config 找它；我们自己编的库不会自动有 .pc）
mkdir -p "$PREFIX_EXPAT/lib/pkgconfig"
cat > "$PREFIX_EXPAT/lib/pkgconfig/expat.pc" <<EOF
prefix=$PREFIX_EXPAT
exec_prefix=\${prefix}
libdir=\${exec_prefix}/lib
includedir=\${prefix}/include

Name: expat
Description: Expat XML parser (wasm, built for Octave-Full-Wasm with -fPIC)
Version: 2.6.4
Requires:
Libs: -L\${libdir} -lexpat
Libs.private:
Cflags: -I\${includedir}
EOF

# ---------------------------------------------------------------------------
# ② fontconfig
# ---------------------------------------------------------------------------
echo "== fontconfig 2.14.2 → $PREFIX_FC"
[ -f "$WORK/fontconfig-2.14.2.tar.gz" ] || { echo "FATAL: 缺 $WORK/fontconfig-2.14.2.tar.gz" >&2; exit 2; }
cd "$WORK" && rm -rf fontconfig-2.14.2 && tar xf fontconfig-2.14.2.tar.gz
cd "$WORK/fontconfig-2.14.2"
# ⚠️ PKG_CONFIG_PATH 与 EM_PKG_CONFIG_PATH **都要给**：emconfigure 会把 emscripten 的 sysroot
#    排在前面，只给前者时它找不到我们这份 expat（批次 D 在 freetype 上踩过同一个坑）。
export PKG_CONFIG_PATH="$PREFIX_EXPAT/lib/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
export EM_PKG_CONFIG_PATH="$PREFIX_EXPAT/lib/pkgconfig${EM_PKG_CONFIG_PATH:+:$EM_PKG_CONFIG_PATH}"
# ⚠️ 坑（实测）：fontconfig 的 configure 有 **emscripten 分支**，它会把 FREETYPE_CFLAGS /
#    FREETYPE_LIBS 直接写成 `-sUSE_FREETYPE` —— 那是"让 emcc 去建 emscripten 官方端口"的意思，
#    而官方端口是**非 PIC** 的（本项目主链要 PIC，见 build-freetype.sh 的开头）。库本体（静态归档）
#    无所谓，但 fc-cache/fc-list 这些**工具**会在链接期炸：
#      wasm-ld: error: libfontconfig.a(fcfreetype.o): undefined symbol: FT_Load_Sfnt_Table …
#    处置：把 freetype 指向**我们自己的** PIC 那份（configure 期给 CFLAGS，make 期覆盖 FREETYPE_*，
#    因为 configure 的 emscripten 分支会盖掉环境变量）。工具照样编，但从此只当"能过链接的附带产物"。
FT_PREFIX="${FT_PREFIX:-/src/deps/freetype}"
[ -s "$FT_PREFIX/lib/libfreetype.a" ] || {
  echo "FATAL: 缺 $FT_PREFIX/lib/libfreetype.a（先跑 build-freetype.sh）" >&2; exit 2; }
FT_CFLAGS="-I$FT_PREFIX/include -I$FT_PREFIX/include/freetype2"
ZLIB_PREFIX="${ZLIB_PREFIX:-${PREFIX_FC%/fontconfig}/zlibbz2}"
ZLIB_FLAG=""
[ -d "$ZLIB_PREFIX/lib" ] && ZLIB_FLAG="-L$ZLIB_PREFIX/lib"
FT_LIBS="-L$FT_PREFIX/lib -lfreetype $ZLIB_FLAG -lz"

HOST_OPT_FC=$(host_opt)
emconfigure ./configure $HOST_OPT_FC --prefix="$PREFIX_FC" \
    --disable-shared --enable-static \
    --disable-docs --disable-docbook --disable-nls --disable-cache-build \
    --disable-libxml2 --with-expat="$PREFIX_EXPAT" \
    --sysconfdir=/ --localstatedir=/ --with-default-fonts=/fonts \
    CFLAGS="$CFLAGS_BASE $FT_CFLAGS" FREETYPE_CFLAGS="$FT_CFLAGS" FREETYPE_LIBS="$FT_LIBS" \
    > "$WORK/fontconfig-conf.log" 2>&1 \
  || { echo "FATAL: fontconfig configure 失败，见 $WORK/fontconfig-conf.log"; tail -30 "$WORK/fontconfig-conf.log" >&2; exit 3; }
# configure 的三条结论要显式看：expat 没接上 / cache 没关 / 默认字体目录不对，都是"静默坏"
grep -E "^EXPAT_|fontconfig|checking for expat|checking for XML_Parser" "$WORK/fontconfig-conf.log" | tail -8 || true
emmake make -j"$JOBS" FREETYPE_CFLAGS="$FT_CFLAGS" FREETYPE_LIBS="$FT_LIBS" \
  > "$WORK/fontconfig-make.log" 2>&1 \
  || { echo "FATAL: fontconfig make 失败，见 $WORK/fontconfig-make.log"; tail -30 "$WORK/fontconfig-make.log" >&2; exit 3; }
emmake make install > "$WORK/fontconfig-inst.log" 2>&1 \
  || { echo "FATAL: fontconfig install 失败"; tail -20 "$WORK/fontconfig-inst.log" >&2; exit 3; }

# 手写 fontconfig.pc（Octave 的 OCTAVE_CHECK_LIB 走 pkg-config）
# ⚠️ **传递依赖必须写进 `Libs:`（不是 `Libs.private:`）** —— 实测踩过：
#    Octave 的探测是 `AC_LINK_IFELSE(AC_LANG_CALL([], [FcInit]))`，链接行是
#    `$FONTCONFIG_LIBS $LIBS`，而 `FONTCONFIG_LIBS` = `pkg-config --libs-only-l fontconfig`
#    （**不带 --static**，所以 `Libs.private` 根本不参与）。只写 `-lfontconfig` 时，
#    探测因 `XML_ParserCreate`/`FT_*` 未定义而判 no ⇒ configure 只打一句
#      WARNING: Fontconfig library not found. OpenGL graphics will not be fully functional.
#    然后**照常把整棵树编完**（config.h 里 `HAVE_FONTCONFIG` 是 `#undef`）——
#    第一版就是这么白跑了一次全量重编，最后才发现"编过了但功能没开"。
mkdir -p "$PREFIX_FC/lib/pkgconfig"
cat > "$PREFIX_FC/lib/pkgconfig/fontconfig.pc" <<EOF
prefix=$PREFIX_FC
exec_prefix=\${prefix}
libdir=\${exec_prefix}/lib
includedir=\${prefix}/include

Name: fontconfig
Description: Font configuration and customization library (wasm, built for Octave-Full-Wasm with -fPIC)
Version: 2.14.2
Requires:
Libs: -L\${libdir} -L$FT_PREFIX/lib -L$PREFIX_EXPAT/lib $ZLIB_FLAG -lfontconfig -lfreetype -lexpat -lz
Cflags: -I\${includedir} -I$FT_PREFIX/include -I$FT_PREFIX/include/freetype2
EOF

# ---- 符号自检 ---------------------------------------------------------------
FLIB="$PREFIX_FC/lib/libfontconfig.a"
[ -s "$FLIB" ] || { echo "FATAL: $FLIB 没产出" >&2; exit 4; }
need="FcInit FcFini FcConfigGetCurrent FcConfigCreate FcPatternCreate FcPatternAddString
FcConfigSubstitute FcDefaultSubstitute FcFontMatch FcFontList FcFontSort FcNameParse
FcPatternGetString FcFontSetDestroy FcPatternDestroy FcConfigDestroy FcConfigGetFonts"
miss=""
for s in $need; do
  emnm "$FLIB" 2>/dev/null | grep -q " T $s$" || miss="$miss $s"
done
[ -z "$miss" ] || { echo "FATAL: libfontconfig.a 缺符号：$miss" >&2; exit 4; }

ELIB="$PREFIX_EXPAT/lib/libexpat.a"
[ -s "$ELIB" ] || { echo "FATAL: $ELIB 没产出" >&2; exit 4; }
emnm "$ELIB" 2>/dev/null | grep -q " T XML_ParserCreate$" \
  || { echo "FATAL: libexpat.a 里没有 XML_ParserCreate" >&2; exit 4; }

# ---- 编译期配置路径自检（"静默坏"的那一类：配置找不到 = 退回默认，看着像没装 fontconfig）----
# `--sysconfdir=/` 之后，fontconfig 里应当出现 `/fonts/fonts.conf` 这串路径模板。
hits=$(strings "$FLIB" 2>/dev/null | grep -c "fonts\.conf" || true)
echo "   libfontconfig.a 里含 'fonts.conf' 的字符串：$hits 条"
strings "$FLIB" 2>/dev/null | grep "fonts\.conf" | sort -u | head -5
[ "$hits" -gt 0 ] || { echo "FATAL: 归档里找不到 fonts.conf 路径（配置路径没编进去？）" >&2; exit 5; }

echo "== 产物："
echo "   $ELIB $(stat -c%s "$ELIB") 字节"
echo "   $FLIB $(stat -c%s "$FLIB") 字节"
echo "   pkg-config 自检："
echo "     PKG_CONFIG_PATH=$PREFIX_FC/lib/pkgconfig:$PREFIX_EXPAT/lib/pkgconfig pkg-config --modversion fontconfig expat"
