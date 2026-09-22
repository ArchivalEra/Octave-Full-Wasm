/*
 * P5 第一步的最小验证：**OSMesa 在 wasm 里把一张图渲进内存缓冲**
 * Copyright (C) 2026 ArchivalEra
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 计划里 P5 的闸门 ① 原文就是：「OSMesa 在 wasm 里渲出一张纯色/三角到内存缓冲（最小验证）」。
 * 这个程序干的正是那件事，而且**断言是硬的**（读回像素比颜色，不是"没崩就算过"）：
 *   1. 建 OSMesa 上下文、make current（软件光栅化，无窗口系统）
 *   2. `glClear` 成红色 → 读中心像素必须是 (255,0,0,255)
 *   3. 用**立即模式**画一个绿三角 → 中心是绿、角落仍是黑（证明确实光栅化了三角形，
 *      而不是整屏刷了一个颜色）
 *   4. 顺带打印 GL_VERSION / GL_RENDERER（看是不是 softpipe）
 *
 * ⚠️ 立即模式（glBegin/glEnd）在这里**是必须的**：Octave 自己的 `opengl_renderer`
 *    就走立即模式；如果 OSMesa 的立即模式坏掉（外部团队在 emscripten 的
 *    LEGACY_GL_EMULATION 上就死在 `glEnd: numVertices must be an integer`），
 *    那 P5 后面两步都不用谈。所以这条路必须由这个小程序先证伪/证实。
 *
 * 构建与运行见 build/113/osmesa-smoke.sh。
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <GL/osmesa.h>
#include <GL/gl.h>

#define W 32
#define H 32

static int failures = 0;

static void
expect_px (const char *what, unsigned char *buf, int x, int y,
           int r, int g, int b, int a)
{
  /* 注意：glReadPixels 的行序是从下往上，但这里 buffer 是 OSMesa 自己的内存布局，
     直接按 (y*W + x) 取即可 —— 我们两边用的是同一套约定（OpenGL 原点在左下），
     所以下面 x/y 都按"左下原点"给。 */
  unsigned char *p = buf + (y * W + x) * 4;
  int ok = (p[0] == r && p[1] == g && p[2] == b && p[3] == a);
  printf ("  %-28s (%2d,%2d) = %3d %3d %3d %3d   期望 %3d %3d %3d %3d   %s\n",
          what, x, y, p[0], p[1], p[2], p[3], r, g, b, a, ok ? "PASS" : "**FAIL**");
  if (! ok)
    failures++;
}

int
main (void)
{
  printf ("=== P5 步骤①：OSMesa 渲到内存缓冲（%dx%d）===\n", W, H);

  unsigned char *buf = calloc ((size_t) W * H * 4, 1);
  if (! buf) { printf ("FAIL: 分配缓冲失败\n"); return 2; }

  /* 无窗口系统：OSMesa 自己管内存，这正是我们能要的东西
     （emscripten 的 WebGL 路线必须有 canvas，且立即模式不可靠）。 */
  OSMesaContext ctx = OSMesaCreateContextExt (OSMESA_RGBA, 0, 0, 0, NULL);
  if (! ctx) { printf ("FAIL: OSMesaCreateContextExt 返回 NULL\n"); return 2; }
  printf ("OK: 上下文已建\n");

  if (! OSMesaMakeCurrent (ctx, buf, GL_UNSIGNED_BYTE, W, H))
    { printf ("FAIL: OSMesaMakeCurrent 失败\n"); return 2; }
  printf ("OK: make current\n");

  printf ("  GL_VERSION  = %s\n", (const char *) glGetString (GL_VERSION));
  printf ("  GL_RENDERER = %s\n", (const char *) glGetString (GL_RENDERER));
  printf ("  GL_VENDOR   = %s\n", (const char *) glGetString (GL_VENDOR));

  /* ---- 1) 纯色 ---- */
  printf ("\n[1] glClear 成红色，读中心像素\n");
  glClearColor (1.0f, 0.0f, 0.0f, 1.0f);
  glClear (GL_COLOR_BUFFER_BIT);
  glFinish ();
  expect_px ("清屏后中心", buf, W / 2, H / 2, 255, 0, 0, 255);

  /* ---- 2) 立即模式三角 ---- */
  printf ("\n[2] 立即模式（glBegin/glEnd）画绿三角\n");
  glClearColor (0.0f, 0.0f, 0.0f, 1.0f);
  glClear (GL_COLOR_BUFFER_BIT);

  glViewport (0, 0, W, H);
  glMatrixMode (GL_PROJECTION);
  glLoadIdentity ();
  glOrtho (0.0, 1.0, 0.0, 1.0, -1.0, 1.0);
  glMatrixMode (GL_MODELVIEW);
  glLoadIdentity ();

  glColor3f (0.0f, 1.0f, 0.0f);
  glBegin (GL_TRIANGLES);
  glVertex2f (0.1f, 0.1f);
  glVertex2f (0.9f, 0.1f);
  glVertex2f (0.5f, 0.9f);
  glEnd ();
  glFinish ();

  /* 三角形重心附近应为绿；左下角与右上角应为黑底 */
  expect_px ("三角形内部（重心）", buf, W / 2, H / 3, 0, 255, 0, 255);
  expect_px ("左下角（应为黑底）", buf, 0, 0, 0, 0, 0, 255);
  expect_px ("右上角（应为黑底）", buf, W - 1, H - 1, 0, 0, 0, 255);

  OSMesaDestroyContext (ctx);
  free (buf);

  printf ("\n=== %s（失败 %d 项）===\n",
          failures ? "**P5 步骤① 未通过**" : "P5 步骤① 通过：OSMesa 能在 wasm 里渲进内存缓冲",
          failures);
  return failures ? 1 : 0;
}
