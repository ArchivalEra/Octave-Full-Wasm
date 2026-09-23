#!/usr/bin/env bash
#
# 图形线 WebGL：把 GLU（glu-9.0.3）重编一份，让它的 `gl*` 调用走 gl4es
#
# ── 为什么必须重编 ─────────────────────────────────────────────────────────
# OSMesa 那份 GLU（`/src/libwork/glu-build/src/libGLU.a`）是**对着 Mesa 的头**编的，
# 里面的 `glBegin/glVertex/...` 都是**未 mangle** 的符号，由 libOSMesa 提供。
# 换成 gl4es 之后：
#   · gl4es 只导出 **`gl4es_glBegin`** 这类带前缀的名字（见 NOTES-webgl.md §3.2），
#     所以 GLU 里那些未 mangle 的 `glBegin` **会变成未定义符号**；
#   · 但 GLU 自己的 `gluNewTess` 等**必须保持未 mangle** —— 因为 `gl-render.o`
#     （Octave 的渲染器，不是我们用 gl4es 头编的）引用的就是未 mangle 的 `gluNewTess`。
# ⇒ 需要一份"**gl 走 gl4es、glu 保持原名**"的 GLU。
#
# ── 怎么做到（关键就是 include 顺序）─────────────────────────────────────────
#   -I<glu-9.0.3>/include     ← 它下面**只有** GL/glu.h（无 gl.h）
#   -I<gl4es>/include         ← 它下面有 GL/gl.h（会 mangle）与 GL/glu.h（会 mangle!)
# 于是：
#   `<GL/glu.h>` 解析到 **GLU 自己那份**（未 mangle）✔
#   `<GL/gl.h>`  解析到 **gl4es 那份**（`glBegin` → `gl4es_glBegin`）✔
#   （GLU 的 glu.h 第 34 行 `#include <GL/gl.h>`，正好吃到 gl4es 的）
# ⚠️ 顺序反过来就会拿到 gl4es 的 glu.h → `gluNewTess` 被 mangle 成
#    `gl4es_gluNewTess`，而 gl4es **不提供 GLU 实现**（它只带 glu.h）⇒ 链接期全空。
#
# 用法（容器内）：bash build-glu-webgl.sh [glu源码] [gl4es源码] [输出前缀]
set -euo pipefail

GLU_SRC="${1:-/src/libwork/glu-9.0.3}"
GL4ES_SRC="${2:-/src/libwork/gl4es-src}"
PREFIX="${3:-/src/libwork/glu-webgl}"

[ -f "$GLU_SRC/include/GL/glu.h" ] || { echo "FATAL: 缺 $GLU_SRC/include/GL/glu.h" >&2; exit 2; }
[ -f "$GL4ES_SRC/include/GL/gl.h" ] || { echo "FATAL: 缺 $GL4ES_SRC/include/GL/gl.h" >&2; exit 2; }

mkdir -p "$PREFIX/lib" "$PREFIX/include/GL"
WORK="$PREFIX/obj"
rm -rf "$WORK"; mkdir -p "$WORK"

cd "$GLU_SRC"

objs=()
for c in src/libtess/*.c src/libutil/*.c; do
  o="$WORK/$(echo "$c" | tr / _)"; o="${o%.c}.o"
  # -include limits.h：emscripten 的 sysroot 里 limits.h 的包含顺序会让 GLU 少个 INT_MAX
  # （Edge-Tools 的 build-glu.sh 也这么处理，见 vendor-edge-tools/build-glu.sh）
  #
  # ★ wasm-SjLj 三项：**必须加**。`src/libtess/tess.c` 用 `setjmp/longjmp` 做错误恢复，
  #   默认模式下 `longjmp` 会落到 emscripten 的 **JS 库函数 `emscripten_longjmp`**；
  #   而主链是 PIC/动态链接（`--experimental-pic`），JS 库函数**不能**当
  #   `R_WASM_TABLE_INDEX_SLEB` 的目标 ⇒ 链接期直接失败：
  #     relocation R_WASM_TABLE_INDEX_SLEB cannot be used against symbol
  #     `emscripten_longjmp`; recompile with -fPIC
  #   加这三项之后 `longjmp` 会降到**主模块已导出**的 `__wasm_longjmp`（真 wasm 函数）。
  #   这与 OSMesa 那条线给 Mesa/GLU 重编 SjLj 版是同一个坑、同一个修法
  #   （见 NOTES-p5-osmesa.md §7.2 第 2 条与 CLIBS.md 坑 2）。
  emcc -O2 -DNDEBUG -include limits.h \
    -fwasm-exceptions -mllvm -wasm-enable-sjlj -mllvm -wasm-use-legacy-eh \
    -I"$GLU_SRC/include" -I"$GLU_SRC/src/include" \
    -I"$GL4ES_SRC/include" \
    -c "$c" -o "$o"
  objs+=("$o")
done

emar rcs "$PREFIX/lib/libGLU.a" "${objs[@]}"
cp "$GLU_SRC/include/GL/glu.h" "$PREFIX/include/GL/glu.h"

echo "== 自检：符号该"gl 走 gl4es、glu 保持原名" =="
NM=/emsdk/upstream/bin/llvm-nm
$NM --defined-only "$PREFIX/lib/libGLU.a" > "$PREFIX/symbols.txt" 2>/dev/null || true
for s in gluNewTess gluTessVertex gluErrorString gluDeleteTess; do
  grep -q " $s\$" "$PREFIX/symbols.txt" || { echo "FATAL: 缺 $s（glu 应保持原名）" >&2; exit 3; }
done
echo "  glu* 原名在 ✔"

# gl* 必须是**未定义**的（留给 gl4es 解析），且名字要带 gl4es_ 前缀
undef_gl4es=$($NM "$PREFIX/lib/libGLU.a" 2>/dev/null | awk '$1=="U"{print $NF}' | grep -c '^gl4es_gl' || true)
undef_plain=$($NM "$PREFIX/lib/libGLU.a" 2>/dev/null | awk '$1=="U"{print $NF}' | grep -E '^gl[A-Z]' | grep -vc '^gl4es_' || true)
echo "  未定义的 gl4es_gl*  : $undef_gl4es（应 > 0）"
echo "  未定义的裸 gl*       : $undef_plain（应 = 0）"
[ "$undef_gl4es" -gt 0 ] || { echo "FATAL: GLU 没有引用到 gl4es_gl*，说明 include 顺序错了" >&2; exit 4; }
[ "$undef_plain" = "0" ] || { echo "FATAL: GLU 还在引用裸 gl*（$undef_plain 个），gl4es 不提供这些名字" >&2; exit 5; }

# longjmp 必须已经降成 __wasm_longjmp（不能是 JS 库函数 emscripten_longjmp）
if $NM "$PREFIX/lib/libGLU.a" 2>/dev/null | awk '$1=="U"{print $NF}' | grep -q '^emscripten_longjmp$'; then
  echo "FATAL: GLU 还在引用 emscripten_longjmp（JS 库函数）—— SjLj 旗标没生效" >&2; exit 6
fi
echo "  longjmp 已降到 __wasm_longjmp ✔"

ls -la "$PREFIX/lib/libGLU.a"
echo "产物：$PREFIX/lib/libGLU.a"
