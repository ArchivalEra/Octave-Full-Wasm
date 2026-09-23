#!/usr/bin/env bash
#
# 图形线：把 **gl2ps** 编成 wasm 静态库 —— 这是"让 toolkit 自己扛 print"的前提
#
# ── 为什么需要它（2026-09-23 实测）──────────────────────────────────────────
# Octave 的 `print` 管线 `m/plot/util/private/__opengl_print__.m` 是**围绕 gl2ps 写的**
# （全程 `gl2ps_device`），它**从不调用 toolkit 的 `print_figure`**。这个构建里
# `config.h` 的 `HAVE_GL2PS_H` 是 **undef**，configure 原文：
#
#     checking for gl2ps.h... no
#     configure: WARNING: gl2ps library not found.  Printing of OpenGL graphics will be disabled.
#
# 后果（实测 8768，`print` 用 `__pb_mirror__` 绕开桥直接调核心实现）：
#
#     print -dpng   rc=2   err: __ghostscript__: 'gs' ... required ... not available
#     print -dsvg   rc=2   err: gl2ps_print: support for gl2ps was unavailable or disabled
#     print -dpdf   rc=2   err: __ghostscript__: 'gs' ...
#     print -dps    rc=2   同上
#     print -deps   rc=2   同上
#
# ⚠️ 别被"看起来成功了"骗到：查产物时**不要**用 `all(b(:) == magic)` —— 文件不存在时
#    `fread` 返回空，而 `all([]) == 1`（真）。本项目为此误判过一次（"PNG 魔数=1"）。
#    要用 `isfile`/`dir` 的 bytes，或者页面侧 `Module.FS.readFile` 直接读。
#
# 所以：**`print -dsvg` 一直是 plot 桥自己那份 SVG 在扛**，桥的数据管线是**承载能力**。
# 想让它变成冗余（从而能让桥跳过整条管线，实测 1686 → 439 ms），就得先把 gl2ps 补上。
#
# ── 源码从哪来 ─────────────────────────────────────────────────────────────
# 上游 geuz.org 已连不上、github.com 被拦；**Debian pool 可达**：
#   https://deb.debian.org/debian/pool/main/g/gl2ps/gl2ps_1.4.2+dfsg1.orig.tar.xz
#
# 用法（容器内）：bash build-gl2ps.sh [源码目录] [输出前缀]
set -euo pipefail

SRC="${1:-/src/vendor/gl2ps-1.4.2}"
PREFIX="${2:-/src/deps/gl2ps}"

[ -f "$SRC/gl2ps.c" ] || { echo "FATAL: 缺 $SRC/gl2ps.c" >&2; exit 2; }
[ -f "$SRC/gl2ps.h" ] || { echo "FATAL: 缺 $SRC/gl2ps.h" >&2; exit 2; }

mkdir -p "$PREFIX/lib" "$PREFIX/include"
WORK="$PREFIX/obj"; rm -rf "$WORK"; mkdir -p "$WORK"

echo "== 编 gl2ps.c → $PREFIX/lib/libgl2ps.a"
# 不开 GL2PS_HAVE_ZLIB：多一个依赖、少一点压缩率，不值得。
# （要开的话：-DGL2PS_HAVE_ZLIB -I<zlib>/include 且链 -lz。Octave 那边不要求。）
# ⚠️ `-fPIC` 必须加：主链是 PIC/动态链接（`--experimental-pic`），
#    非 PIC 的归档会在链接期报 `relocation R_WASM_TABLE_INDEX_SLEB … recompile with -fPIC`
#    —— 本项目在 GLU 上已经踩过一次（`NOTES-p5-osmesa.md` §7.2 第 2 条）。
emcc -O2 -DNDEBUG -fPIC -I"$SRC" -c "$SRC/gl2ps.c" -o "$WORK/gl2ps.o"
emar rcs "$PREFIX/lib/libgl2ps.a" "$WORK/gl2ps.o"
cp "$SRC/gl2ps.h" "$PREFIX/include/gl2ps.h"

echo "== 自检 =="
# ⚠️ gl2ps **没有** `gl2psPrintSVG` 这种"按格式命名"的入口 —— SVG 是
#    `gl2psBeginPage(..., GL2PS_SVG, ...)` 的一个**格式参数**。第一版自检写错了名字，
#    误报"没有 gl2psPrintSVG"。这里认真正的 API（顺带确认 configure 会探测的
#    `gl2psLineJoin`/`gl2psLineCap` 也在，那是 `HAVE_GL2PSLINEJOIN` 的来源）。
for sym in gl2psBeginPage gl2psEndPage gl2psLineJoin gl2psLineCap gl2psText; do
  /emsdk/upstream/bin/llvm-nm --defined-only "$PREFIX/lib/libgl2ps.a" | grep -q " $sym\$" \
    || { echo "FATAL: libgl2ps.a 里没有 $sym" >&2; exit 3; }
done
echo "  gl2psBeginPage/EndPage/LineJoin/LineCap/Text 都在 ✔"
ls -la "$PREFIX/lib/libgl2ps.a" "$PREFIX/include/gl2ps.h"
echo
echo "接下来要把 include/lib 接进 Octave 的 configure（configure-113-full.sh）并**重跑 configure**，"
echo "让 config.h 出现 #define HAVE_GL2PS_H 1；config.h 一变 libinterp/liboctave 要**大重建**。"
