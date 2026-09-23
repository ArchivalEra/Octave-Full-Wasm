// Octave-Full-Wasm — 图形线 WebGL 步骤①：gl4es + WebGL2 能不能跑 Octave 要的那套固定管线
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 这个文件在验什么 ────────────────────────────────────────────────────────
// 与 `build/113/osmesa-smoke.c` 同一套路，但换到 **WebGL** 那条路：
// 建一个**真的 WebGL2 上下文**、把 gl4es 初始化好，然后用**立即模式**
//（`glBegin/glVertex/glEnd`）画一个三角形、`glReadPixels` 读回、逐像素断言。
//
// 为什么非要有这一步：整条 WebGL 线的**唯一真未知**就是"gl4es 在 WebGL2 上到底能不能
// 把立即模式跑对"。外部团队 Edge-Tools 用 emscripten 自带的
// `LEGACY_GL_EMULATION` 模拟固定管线，**死在 `numVertices must be an integer` at `glEnd`**
//（见 `build/113/vendor-edge-tools/MILESTONE-2.md`）。gl4es 是自己实现立即模式
//（顶点先缓冲、`glEnd` 时一次性提交），理论上完全不同 —— 但**理论不算数，这里要实测**。
//
// ── 与 OSMesa 那版的形态差异（重要）────────────────────────────────────────
//   · OSMesa：渲进我们自己 `calloc` 的内存 → **不需要 canvas、不需要 DOM**（能在 node 里跑）。
//   · WebGL：**必须有一个 `<canvas>` 作为绘制目标** —— 所以本 smoke 只能在**浏览器**里跑，
//     不能像 osmesa-smoke 那样用 node。
//   · 上下文创建：`emscripten_webgl_create_context()` + `emscripten_webgl_make_context_current()`。
//   · gl4es 要求：**在调用任何 GL 函数之前**先 `initialize_gl4es()`（见其 COMPILE.md）。
//
// ── 符号为什么是 `gl4es_gl*` ────────────────────────────────────────────────
// gl4es 在 `__EMSCRIPTEN__` 下定义 `MANGLE(x) = gl4es_gl##x` 并引入 `gl_mangle.h`，
// 于是**本文件写的 `glBegin(...)` 实际链接到 `gl4es_glBegin`**，与 emscripten 提供的
// 真 GLES2 `glBegin`（不存在）互不干扰。前提：**include 路径必须指向 gl4es 的
// `include/`**，否则拿到的是 Mesa/emscripten 的头、名字不会 mangle。
//
// 构建/运行：`bash build/113/gl4es-smoke.sh`（容器内），再用
// `test/browser/probe-gl4es-smoke.mjs` 在 headless Chromium 里跑并断言。

#include <stdio.h>
#include <string.h>

#include <emscripten/emscripten.h>
#include <emscripten/html5.h>

#include <GL/gl.h>
#include <gl4esinit.h>

#define W 64
#define H 64

static int failures = 0;

// 结果同时打到 console（emscripten 的 printf 会进 console）和 window 上，
// 页面探针两处都能取（printf 在浏览器里是异步落到 console 的，window 上更稳）。
static void
report (const char *key, const char *val)
{
  printf ("GL4ES-SMOKE %s = %s\n", key, val);
  EM_ASM ({
    window.__gl4es_smoke = window.__gl4es_smoke || {};
    window.__gl4es_smoke[UTF8ToString ($0)] = UTF8ToString ($1);
  }, key, val);
}

static void
check (const char *label, int ok)
{
  printf ("[%s] %s\n", ok ? "PASS" : "FAIL", label);
  EM_ASM ({
    window.__gl4es_smoke = window.__gl4es_smoke || {};
    (window.__gl4es_smoke.checks = window.__gl4es_smoke.checks || []).push ({
      label: UTF8ToString ($0), ok: $1
    });
  }, label, ok);
  if (! ok)
    failures++;
}

int
main (void)
{
  printf ("=== 图形线 WebGL 步骤①：gl4es + WebGL2（%dx%d）===\n", W, H);

  // ── 1. 建真 WebGL2 上下文 ────────────────────────────────────────────────
  // antialias 关掉：下面要**逐像素精确断言**，抗锯齿会把边缘颜色混掉。
  // 不依赖 preserveDrawingBuffer：我们在**同一个任务里**画完立刻读回。
  EmscriptenWebGLContextAttributes attrs;
  emscripten_webgl_init_context_attributes (&attrs);
  attrs.majorVersion = 2;
  attrs.minorVersion = 0;
  attrs.alpha = 0;
  attrs.antialias = 0;
  attrs.depth = 1;
  attrs.stencil = 0;
  attrs.preserveDrawingBuffer = 0;

  EMSCRIPTEN_WEBGL_CONTEXT_HANDLE ctx =
    emscripten_webgl_create_context ("#canvas", &attrs);

  if (ctx <= 0)
    {
      report ("ctx", "FAIL(create)");
      printf ("FATAL: emscripten_webgl_create_context 失败（code=%d）\n", (int) ctx);
      return 1;
    }
  report ("ctx", "ok");

  if (emscripten_webgl_make_context_current (ctx) != EMSCRIPTEN_RESULT_SUCCESS)
    {
      report ("make_current", "FAIL");
      printf ("FATAL: make_context_current 失败\n");
      return 1;
    }
  report ("make_current", "ok");

  // ── 2. 初始化 gl4es（**必须在任何 GL 调用之前**，COMPILE.md 明确要求）──────
  initialize_gl4es ();
  report ("initialize_gl4es", "called");

  const GLubyte *ver = glGetString (GL_VERSION);
  const GLubyte *ren = glGetString (GL_RENDERER);
  report ("gl_version", ver ? (const char *) ver : "(null)");
  report ("gl_renderer", ren ? (const char *) ren : "(null)");
  printf ("  GL_VERSION  = %s\n", ver ? (const char *) ver : "(null)");
  printf ("  GL_RENDERER = %s\n", ren ? (const char *) ren : "(null)");

  GLenum e0 = glGetError ();
  check ("glGetString 之后 glGetError == 0", e0 == GL_NO_ERROR);

  // ── 3. 清屏成红 ─────────────────────────────────────────────────────────
  glViewport (0, 0, W, H);
  glClearColor (1.0f, 0.0f, 0.0f, 1.0f);
  glClear (GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
  check ("glClear 之后 glGetError == 0", glGetError () == GL_NO_ERROR);

  // ── 4. 立即模式画一个绿三角（★ 这就是 Edge-Tools 撞墙的那条路）────────────
  glMatrixMode (GL_PROJECTION);
  glLoadIdentity ();
  glMatrixMode (GL_MODELVIEW);
  glLoadIdentity ();

  glBegin (GL_TRIANGLES);
  glColor3f (0.0f, 1.0f, 0.0f);
  glVertex2f (-0.5f, -0.5f);
  glVertex2f ( 0.5f, -0.5f);
  glVertex2f ( 0.0f,  0.5f);
  glEnd ();

  GLenum e1 = glGetError ();
  check ("glBegin/glVertex/glEnd（立即模式）之后 glGetError == 0", e1 == GL_NO_ERROR);

  glFinish ();

  // ── 5. 读回像素 ─────────────────────────────────────────────────────────
  static unsigned char px[W * H * 4];
  memset (px, 0, sizeof (px));
  glReadPixels (0, 0, W, H, GL_RGBA, GL_UNSIGNED_BYTE, px);
  check ("glReadPixels 之后 glGetError == 0", glGetError () == GL_NO_ERROR);

  // 中心附近（三角形内部）应该是绿；左下/右上角应该是清屏的红
  unsigned char *c = &px[((H / 2) * W + (W / 2)) * 4];
  unsigned char *bl = &px[((2) * W + (2)) * 4];
  unsigned char *tr = &px[((H - 3) * W + (W - 3)) * 4];

  printf ("  中心 = %d %d %d %d\n", c[0], c[1], c[2], c[3]);
  printf ("  左下 = %d %d %d %d\n", bl[0], bl[1], bl[2], bl[3]);
  printf ("  右上 = %d %d %d %d\n", tr[0], tr[1], tr[2], tr[3]);

  char buf[64];
  snprintf (buf, sizeof (buf), "%d %d %d %d", c[0], c[1], c[2], c[3]);
  report ("center_rgba", buf);
  snprintf (buf, sizeof (buf), "%d %d %d %d", bl[0], bl[1], bl[2], bl[3]);
  report ("bottomleft_rgba", buf);
  snprintf (buf, sizeof (buf), "%d %d %d %d", tr[0], tr[1], tr[2], tr[3]);
  report ("topright_rgba", buf);

  check ("[1] 立即模式绿三角：中心是绿", c[1] > 200 && c[0] < 60 && c[2] < 60);
  check ("[2] 左下角是清屏红（三角没铺满）", bl[0] > 200 && bl[1] < 60 && bl[2] < 60);
  check ("[3] 右上角是清屏红", tr[0] > 200 && tr[1] < 60 && tr[2] < 60);

  // 三角内部的像素数应该接近一半面积 —— 证明是真光栅化，不是"整屏一个颜色"
  int green = 0;
  for (int i = 0; i < W * H; i++)
    if (px[i * 4 + 1] > 200 && px[i * 4 + 0] < 60 && px[i * 4 + 2] < 60)
      green++;
  printf ("  绿像素 = %d / %d\n", green, W * H);
  snprintf (buf, sizeof (buf), "%d", green);
  report ("green_pixels", buf);

  check ("[4] 绿像素数量合理（>10%% 且 <70%%）",
         green > (W * H) / 10 && green < (W * H) * 7 / 10);

  report ("failures", failures == 0 ? "0" : ">0");
  report ("done", "1");
  printf ("=== 步骤① %s（失败 %d 项）===\n", failures == 0 ? "通过" : "未通过", failures);
  return failures == 0 ? 0 : 1;
}
