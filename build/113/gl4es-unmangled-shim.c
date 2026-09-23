// Octave-Full-Wasm — 图形线 WebGL：把 Octave **未 mangle** 的 GL 调用转发到 gl4es
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 为什么需要这个文件 ──────────────────────────────────────────────────────
// gl4es 在 Emscripten 下把自己的导出**全部 mangle 成 `gl4es_gl*`**（见
// `NOTES-webgl.md` §3.2）。而 Octave 的库里**只有一处**是直接调 GL、
// 没有走 `opengl_functions` 虚表的：`gl-render.cc` 里的 `glGetIntegerv`。
// 那个 TU 是用 **Octave 自己的头**编的（不是 gl4es 的），所以它引用的是**裸名**
// `glGetIntegerv`。裸名不会被 mangle ⇒ 链接时落到 **emscripten 提供的真 GLES2** 上。
//
// **实测后果**（8768，`accept-p5-graphics.mjs`）：`getframe` 报
//
//     WebGL: INVALID_ENUM: getParameter: invalid parameter name
//     opengl_renderer: Error 'invalid enumerant' (1280) occurred drawing 'text' object
//
// 因为 `gl-render.cc` 用它去查**固定管线**的状态枚举
//（`GL_CURRENT_RASTER_POSITION` / `GL_MATRIX_MODE` 之类），而 WebGL2/GLES2
// 压根不认识这些枚举 —— gl4es 认识（它自己维护着那份状态）。
// 所以这一处必须**回到 gl4es**。
//
// ── 覆盖范围是**量过的**，不是猜的 ──────────────────────────────────────────
// 把 Octave 三个归档里所有**未 mangle** 的 GL/GLU 未定义符号列出来：
//
//   for a in libinterp.a liboctave.a libgnu.a; do llvm-nm "$a"; done \
//     | awk '$1=="U"{print $NF}' | grep -E '^(gl|glu)[A-Z]' | sort -u
//
// 输出共 **11** 个：**`glGetIntegerv` × 1** + **`glu*` × 10**。
// 10 个 `glu*`（`gluNewTess`/`gluTessVertex`/…）由我们自己的 GLU 提供
//（`build/113/build-glu-webgl.sh` 特意让 GLU **保持原名**，就是为了对得上）。
// 剩下**只有 `glGetIntegerv` 这一个**需要转发 —— 也就是本文件。
//
// ⇒ 以后若 Octave 又新增一处直接调 GL（升版本时可能），上面那条命令的输出会变多，
//   链接期就会出现"裸名未定义"（或在运行期报 INVALID_ENUM）；**照那条命令补本文件**即可。

#include <emscripten/emscripten.h>

// gl4es 的实现（带前缀）。原型取自 gl4es 的 <GL/gl.h>（`glGetIntegerv(GLenum, GLint*)`）。
extern void gl4es_glGetIntegerv (unsigned int pname, int *params);

// 裸名转发。签名与 GL 的 `void glGetIntegerv(GLenum pname, GLint *params)` 一致。
//
// ⚠️ 为什么用"再写一个函数"而不是 `__attribute__((alias(...)))`：
//    alias 要求目标在同一 TU 里有定义，而 `gl4es_glGetIntegerv` 在 `libGL.a` 里，
//    编译器会直接报 "alias target must be defined"。转发函数没有这个限制，
//    代价只是一次调用（而且这个符号只在画文字时被调，热路径上不在）。
EMSCRIPTEN_KEEPALIVE void
glGetIntegerv (unsigned int pname, int *params)
{
  gl4es_glGetIntegerv (pname, params);
}
