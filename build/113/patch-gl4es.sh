#!/usr/bin/env bash
#
# 图形线 WebGL：给 gl4es 打的两个小补丁 —— 让它的 `glGet*` 自己回答两个
# **WebGL 不接受的固定管线枚举**
#
# ── 为什么需要（两个都是实测出来的）────────────────────────────────────────
# 这一类问题的根源：gl4es 的 getter 对**不认识的枚举**会把枚举**原样转发**给真 GLES2，
# 而浏览器的 `getParameter` 只接受 WebGL 那套枚举 —— 遇到固定管线专属的枚举就报
#
#     WebGL: INVALID_ENUM: getParameter: invalid parameter name
#
# 并留下一个 1280 挂起错误；Octave 的 `draw()` 每画完一个对象就查一次 `glGetError`，
# 于是刷屏 `opengl_renderer: Error 'invalid enumerant' (1280) occurred drawing 'X' object`。
#
# **补丁 1 · GL_SAMPLE_BUFFERS / GL_SAMPLES**（`src/gl/getter.c`）
#   `gl-render.cc:868` 拿它判断有没有多重采样。WebGL 的 `getParameter` 不接受
#   `SAMPLE_BUFFERS`。gl4es 的固定管线路径不维护多重采样状态 ⇒ 如实回答 `0`，
#   调用方会走线平滑回退（这正是它设计好的分支）。
#
# **补丁 2 · GL_LINE_SMOOTH**（`src/gl/wrap/gles.c`）
#   `gl-render.cc:2167`（`draw_axes_grids`）拿它判断"线平滑是不是开着"。
#   麻烦在于 gl4es 的 `gl4es_glGetBooleanv` 是个**纯转发**（wrap 层，不做任何枚举翻译），
#   而 gl4es **确实跟踪**着这个开关（`glstate->enable.line_smooth`）⇒ 从状态里如实回答。
#
# ── 其余查询**不用打**（已逐个核过，别再重复排查）────────────────────────────
# Octave 里全部的 `glGet*` 枚举就这几个：
#   GL_MAX_TEXTURE_SIZE ✅ GLES2 就有（而且 gl-render.o 直接调的那一个已被
#                          `build/113/gl4es-unmangled-shim.c` 转回 gl4es）
#   GL_VIEWPORT ✅ GLES2 就有
#   GL_MAX_LIGHTS ✅ gl4es 在 `gl4es_commonGet` 里就答了（`hardext.maxlights`）
#   GL_ZOOM_X / GL_ZOOM_Y ✅ 同上（`gl4es_commonGet`）
#   GL_SAMPLE_BUFFERS / GL_SAMPLES → 补丁 1
#   GL_LINE_SMOOTH → 补丁 2
#
# 幂等（已打过就跳过），带自检。用法：
#   bash patch-gl4es.sh [gl4es源码目录]
# 打完要**重编 gl4es**：
#   cd /src/libwork/gl4es-build && PATH=/emsdk/upstream/emscripten:$PATH make -j24
set -euo pipefail

SRC="${1:-/src/libwork/gl4es-src}"
GETTER="$SRC/src/gl/getter.c"
WRAP="$SRC/src/gl/wrap/gles.c"

[ -f "$GETTER" ] || { echo "FATAL: 缺 $GETTER" >&2; exit 2; }
[ -f "$WRAP" ]   || { echo "FATAL: 缺 $WRAP" >&2; exit 2; }

python3 - "$GETTER" "$WRAP" <<'PY'
import sys

getter, wrap = sys.argv[1], sys.argv[2]

# ── 补丁 1：gl4es_glGetIntegerv 的 switch 尾部，GL_DEPTH_RANGE 之后 ──────────
M1 = "GL4ES_PATCH_SAMPLE_QUERY"
anchor1 = """        case GL_DEPTH_RANGE:
            params[0] = glstate->depth.Near*2147483647l;
            params[1] = glstate->depth.Far*2147483647l;
            break;
        default:
            errorGL();
            gles_glGetIntegerv(pname, params);
"""
patch1 = """        case GL_SAMPLE_BUFFERS:
        case GL_SAMPLES:
            /* %s
             *
             * GL_SAMPLE_BUFFERS / GL_SAMPLES 是 GL 1.3 的枚举，但 **WebGL 的
             * getParameter 不接受 SAMPLE_BUFFERS** —— 转发下去浏览器会报
             *   WebGL: INVALID_ENUM: getParameter: invalid parameter name
             * 并留下挂起的 1280 错误（Octave 的 draw 会在画完每个对象后查
             * glGetError，于是刷屏 "Error 'invalid enumerant' occurred drawing ..."）。
             *
             * gl4es 的固定管线路径不维护多重采样状态，所以如实回答"没有"：
             * 调用方（gl-render.cc）会据此走线平滑回退，这是正确行为。 */
            params[0] = 0;
            break;
""" % M1

# ── 补丁 2：gl4es_glGetBooleanv（wrap 层的纯转发）────────────────────────────
M2 = "GL4ES_PATCH_LINE_SMOOTH_QUERY"
anchor2 = """void APIENTRY_GL4ES gl4es_glGetBooleanv(GLenum pname, GLboolean * params) {
    void gles_glGetBooleanv(glGetBooleanv_ARG_EXPAND); //LOAD_GLES(glGetBooleanv);
#ifndef direct_glGetBooleanv
    PUSH_IF_COMPILING(glGetBooleanv)
#endif
    gles_glGetBooleanv(pname, params);
}
"""
patch2 = """#include "../glstate.h"   /* %s：下面要读 glstate->enable.line_smooth */

void APIENTRY_GL4ES gl4es_glGetBooleanv(GLenum pname, GLboolean * params) {
    void gles_glGetBooleanv(glGetBooleanv_ARG_EXPAND); //LOAD_GLES(glGetBooleanv);
#ifndef direct_glGetBooleanv
    PUSH_IF_COMPILING(glGetBooleanv)
#endif
    /* %s
     *
     * 本函数在 wrap 层是**纯转发**（不做任何枚举翻译），而 GL_LINE_SMOOTH 是
     * 固定管线枚举，**WebGL 的 getParameter 不接受** —— 转发下去浏览器报
     *   WebGL: INVALID_ENUM: getParameter: invalid parameter name
     * 并留下挂起的 1280 错误（Octave 的 draw_axes_grids 会查它）。
     *
     * gl4es **确实跟踪**着这个开关（enable.c 的 proxy_GOFPE(GL_LINE_SMOOTH, line_smooth)），
     * 所以从自己的状态里如实回答，不转发。 */
    if (pname == GL_LINE_SMOOTH) {
        noerrorShim();
        params[0] = glstate->enable.line_smooth ? GL_TRUE : GL_FALSE;
        return;
    }
    gles_glGetBooleanv(pname, params);
}
""" % (M2, M2)

def apply(path, marker, anchor, patch, label, mode):
    s = open(path, encoding='utf-8').read()
    if marker in s:
        print("  已打过（%s），跳过" % label)
        return
    if anchor not in s:
        sys.exit("FATAL: %s 里找不到锚点（上游改过？）" % label)
    if s.count(anchor) != 1:
        sys.exit("FATAL: %s 的锚点不唯一（%d 次）" % (label, s.count(anchor)))
    # mode 必须显式：
    #   "before" —— patch 是**新增**的片段，插在 anchor 前面（补丁 1：给 switch 加 case）
    #   "replace"—— patch 是 anchor 的**替代品**（补丁 2：整段函数替换）
    # ⚠️ 本脚本第一版把两者都写成 "before"，于是补丁 2 把同一个函数**写了两份**，
    #    编出来是 `redefinition of 'gl4es_glGetBooleanv'`。别省这个参数。
    out = s.replace(anchor, patch, 1) if mode == "replace" else s.replace(anchor, patch + anchor, 1)
    open(path, 'w', encoding='utf-8').write(out)
    print("  已打补丁：%s（mode=%s）" % (label, mode))

apply(getter, M1, anchor1, patch1, "glGetIntegerv 的 SAMPLE_BUFFERS/SAMPLES", "before")
apply(wrap,   M2, anchor2, patch2, "glGetBooleanv 的 LINE_SMOOTH", "replace")
PY

echo "== 自检 =="
grep -q "GL4ES_PATCH_SAMPLE_QUERY" "$GETTER" || { echo "FATAL: 补丁 1 没写进去" >&2; exit 3; }
grep -q "GL4ES_PATCH_LINE_SMOOTH_QUERY" "$WRAP" || { echo "FATAL: 补丁 2 没写进去" >&2; exit 3; }
n1=$(grep -c "case GL_SAMPLE_BUFFERS:" "$GETTER")
n2=$(grep -c "pname == GL_LINE_SMOOTH" "$WRAP")
echo "  getter.c  GL_SAMPLE_BUFFERS case 数 = $n1（应为 1）"
echo "  gles.c    GL_LINE_SMOOTH 判断数   = $n2（应为 1）"
[ "$n1" = "1" ] && [ "$n2" = "1" ] || { echo "FATAL: 自检不过" >&2; exit 4; }
echo "  两个补丁都 OK"
echo
echo "接下来要**重编 gl4es**（补丁改的是源码）："
echo "  cd /src/libwork/gl4es-build && PATH=/emsdk/upstream/emscripten:\$PATH make -j24"
