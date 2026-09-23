#!/usr/bin/env bash
# Octave-Full-Wasm — 把**编译期 GL 头**从 Mesa/glshim 换成 gl4es + GLU 的（own code）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# ── 为什么需要它（2026-09-23，OSMesa 退役之后剩下的最后一处隐藏依赖）──────────
# `build/113/configure-113-full.sh` 的 `WITH_OPENGL=1` 给整棵树加的是
#     -I/src/deps/glshim/include
# 那是**Mesa 的头**（glshim 是"把 OSMesa 冒充成 -lGL"那一层）。OSMesa 退役后，这个
# include 目录成了唯一的残留：树还在按 Mesa 的头编译 `gl-render.cc` 等 TU。
#
# ── 做法：**保持编译命令行逐字不变**，只换那个目录的内容 ──────────────────────
# 为什么不直接把路径改到新目录：`-I` 是 ccache 哈希的一部分，换路径 = **整片缓存失效**
# = 一次 -O2 全树重建；而 automake 的 .d 依赖文件记的是**绝对路径**，路径一改也会
# 牵动更多目标。所以这里反过来：**新目录**装 gl4es+GLU 的头，然后把老路径
# `/src/deps/glshim/include` 变成指向它的**软链** ⇒ 命令行不变、ccache 命中照旧、
# 只有真正 include 了 GL 头的少数 TU 因为**文件内容变了**而重编（automake 的依赖
# 跟踪就够）。这就是本脚本存在的全部理由。
#
# ── 头怎么组（顺序/内容都有讲究，抄 build/113/build-glu-webgl.sh 的结论）─────
#   · gl4es 的 `GL/gl.h` **会把 `glBegin` 之类 mangle 成 `gl4es_glBegin`**
#     （`#define MANGLE(x) gl4es_gl##x` + `gl_mangle.h`）——这是"谁 include 它、
#     谁的 GL 调用就走 gl4es"的机制，NOTES-webgl.md §3.2。所以 gl.h 必须用 gl4es 的。
#   · `GL/glu.h` 必须用 **GLU 自己那份（不改名）**：`gl-render.o` 引用的是裸
#     `gluNewTess`/`gluTessCallback`，那些由 `glu-webgl/lib/libGLU.a` 提供。
#     （gl4es 也带一份 glu.h+glu_mangle.h，用错那份就会变成 gl4es_glu*，与归档对不上。）
#
# 用法（容器内）：
#   bash /src/bin/gl-headers-webgl.sh            # 组装 + 换软链
#   bash /src/bin/gl-headers-webgl.sh --revert   # 还原 Mesa 那份
#
# 之后：`cd /src/work/octave-11.3.0 && emmake make -k -j24`（增量，只重编 GL 那几个 TU）
#       → 重链 → 复跑 `accept-p5-graphics`（61 项）与全量回归。
set -euo pipefail

GL4ES_SRC="${GL4ES_SRC:-/src/libwork/gl4es-src}"
GLU_SRC="${GLU_SRC:-/src/libwork/glu-9.0.3}"
PREFIX="${PREFIX:-/src/deps/glheaders-webgl}"
SHIM_INC="/src/deps/glshim/include"
BAK="/src/deps/glshim/include.mesa-bak"

if [ "${1:-}" = "--revert" ]; then
  if [ -L "$SHIM_INC" ]; then
    rm -f "$SHIM_INC"
    [ -d "$BAK" ] && mv "$BAK" "$SHIM_INC"
    echo "已还原：$SHIM_INC 重新指向 Mesa 的头（备份 $BAK → 原位）"
  else
    echo "无需还原：$SHIM_INC 不是软链（已经是真目录）"
  fi
  exit 0
fi

[ -f "$GL4ES_SRC/include/GL/gl.h" ] || { echo "FATAL: 缺 $GL4ES_SRC/include/GL/gl.h" >&2; exit 2; }
[ -f "$GLU_SRC/include/GL/glu.h" ]  || { echo "FATAL: 缺 $GLU_SRC/include/GL/glu.h" >&2; exit 2; }

# ── ① 组装新头目录 ───────────────────────────────────────────────────────────
mkdir -p "$PREFIX/include"
rm -rf "$PREFIX/include/GL"
cp -a "$GL4ES_SRC/include/GL" "$PREFIX/include/GL"          # gl.h（mangle）/glext/glx…
cp -f "$GLU_SRC/include/GL/glu.h" "$PREFIX/include/GL/glu.h" # ★ 覆盖成 GLU 自己的（不改名）

# ── ② 自检（内容对不对，比"拷过去了"重要）─────────────────────────────────────
grep -q 'gl4es_gl##x' "$PREFIX/include/GL/gl.h" \
  || { echo "FATAL: 组出来的 GL/gl.h 不是 gl4es 那份（找不到 MANGLE(x) gl4es_gl##x）" >&2; exit 3; }
grep -q 'gluNewTess' "$PREFIX/include/GL/glu.h" \
  || { echo "FATAL: GL/glu.h 里没有 gluNewTess" >&2; exit 3; }
if grep -q 'gl4es_gl##x' "$PREFIX/include/GL/glu.h"; then
  echo "FATAL: GL/glu.h 是 gl4es 那份（会把 glu* 也 mangle 成 gl4es_glu*，与 libGLU.a 对不上）" >&2
  exit 3
fi
[ -f "$PREFIX/include/GL/glext.h" ] || { echo "FATAL: 缺 GL/glext.h（树里 HAVE_GL_GLEXT_H 会变 0）" >&2; exit 3; }
echo "== 新头目录就绪：$PREFIX/include/GL（$(ls "$PREFIX/include/GL" | tr '\n' ' ')）"

# ── ③ 把老路径变成软链（命令行逐字不变）──────────────────────────────────────
if [ -L "$SHIM_INC" ]; then
  echo "== $SHIM_INC 已经是软链 → $(readlink "$SHIM_INC")（跳过）"
else
  [ -d "$SHIM_INC" ] || { echo "FATAL: $SHIM_INC 不存在，无法备份" >&2; exit 4; }
  [ -e "$BAK" ] && { echo "FATAL: 备份 $BAK 已存在（先人工确认再动）" >&2; exit 4; }
  mv "$SHIM_INC" "$BAK"
  ln -s "$PREFIX/include" "$SHIM_INC"
  echo "== $SHIM_INC 原 Mesa 头 → $BAK；新建软链 → $PREFIX/include"
fi

echo
echo "下一步（容器内）："
echo "  cd /src/work/octave-11.3.0 && export PATH=/usr/src/emsdk:/usr/src/emsdk/upstream/emscripten:\$PATH"
echo "  emmake make -k -j24            # 增量：只重编 include 了 GL 头的少数 TU"
echo "  # 再重链（见 build/113/link-web.sh 的头注释）并复跑 accept-p5-graphics"
echo "还原：bash /src/bin/gl-headers-webgl.sh --revert"
