/*
 * P5 步骤② 的前置验证：**GLU 的多边形剖分在 OSMesa 上真的能用**
 * Copyright (C) 2026 ArchivalEra
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 为什么要单独验这一条：Octave 的 `gl-render.cc` 用 GLU **只为一件事** ——
 * 把填充多边形剖分成三角形（实测 grep 到的 GLU 调用全是这一族）：
 *     gluNewTess / gluTessBeginPolygon / gluTessBeginContour / gluTessVertex /
 *     gluTessEndContour / gluTessEndPolygon / gluTessCallback / gluTessProperty /
 *     gluDeleteTess / gluErrorString
 * 所以「GLU 剖分能跑」= 步骤② 的最后一个**库层面**未知被消掉。
 *
 * 验证方式（硬断言，不是"没崩就算过"）：
 *   1. 拿一个**凹多边形**（L 形）去剖分 —— 凹形才需要真剖分，凸形不需要
 *   2. 数剖分回调吐出来的**顶点个数**，必须 > 0 且是 3 的倍数（三角形列表）
 *   3. 把剖分结果**真的画进 OSMesa 缓冲**，然后读像素：
 *        · 落在 L 形内部 → 必须是填充色
 *        · 落在**凹口里**（L 形缺的那块）→ 必须是背景色 ← 这一条才证明剖分是对的
 *
 * 构建与运行见 build/113/osmesa-glu-smoke.sh。
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <GL/osmesa.h>
#include <GL/gl.h>
#include <GL/glu.h>

#define W 32
#define H 32

static int failures = 0;

/* ── 剖分回调：把 GLU 吐出的顶点收起来（GLU_TESS_VERTEX 回调收到的是我们传进去的
      指针，所以这里直接存 double[2] 的值） ───────────────────────────────── */
static double tess_verts[4096][2];
static int tess_nverts = 0;

/* GLU 剖分**默认吐的是 GL_TRIANGLE_FAN**（实测 type=6），不是 GL_TRIANGLES。
   必须按它给的类型重画，否则顶点会被当成互不相连的三角形 —— 第一版就是直接把
   FAN 的顶点按 GL_TRIANGLES 画的（碰巧这几个顶点两两凑成正确的两块，像素断言
   居然全过），但那只是运气好，换个形状就错。这里存下类型、按类型重画。 */
static GLenum tess_prim = GL_TRIANGLES;
static int tess_prim_count = 0;

static void
cb_begin (GLenum type)
{
  tess_prim = type;
  tess_prim_count++;
}

static const char *
prim_name (GLenum t)
{
  switch (t)
    {
    case GL_TRIANGLES:      return "GL_TRIANGLES";
    case GL_TRIANGLE_FAN:   return "GL_TRIANGLE_FAN";
    case GL_TRIANGLE_STRIP: return "GL_TRIANGLE_STRIP";
    default:                return "其它";
    }
}

static void
cb_vertex (void *data)
{
  double *v = (double *) data;
  if (tess_nverts < 4096)
    {
      tess_verts[tess_nverts][0] = v[0];
      tess_verts[tess_nverts][1] = v[1];
      tess_nverts++;
    }
}

static void
cb_error (GLenum err)
{
  printf ("  GLU 剖分报错: %s\n", gluErrorString (err));
  failures++;
}

/* L 形（凹）的轮廓，逆时针；凹口在右上角那块。
   顶点：(0.1,0.1) (0.9,0.1) (0.9,0.4) (0.4,0.4) (0.4,0.9) (0.1,0.9) */
static double outline[6][2] = {
  { 0.1, 0.1 }, { 0.9, 0.1 }, { 0.9, 0.4 },
  { 0.4, 0.4 }, { 0.4, 0.9 }, { 0.1, 0.9 }
};

static void
expect_px (const char *what, unsigned char *buf, int x, int y,
           int r, int g, int b, int a)
{
  unsigned char *p = buf + (y * W + x) * 4;
  int ok = (p[0] == r && p[1] == g && p[2] == b && p[3] == a);
  printf ("  %-30s (%2d,%2d) = %3d %3d %3d %3d  期望 %3d %3d %3d %3d  %s\n",
          what, x, y, p[0], p[1], p[2], p[3], r, g, b, a, ok ? "PASS" : "**FAIL**");
  if (! ok)
    failures++;
}

int
main (void)
{
  printf ("=== P5 步骤② 前置：GLU 剖分在 OSMesa（%dx%d）上可用吗 ===\n", W, H);

  unsigned char *buf = calloc ((size_t) W * H * 4, 1);
  OSMesaContext ctx = OSMesaCreateContextExt (OSMESA_RGBA, 0, 0, 0, NULL);
  if (! ctx) { printf ("FAIL: 建上下文失败\n"); return 2; }
  if (! OSMesaMakeCurrent (ctx, buf, GL_UNSIGNED_BYTE, W, H))
    { printf ("FAIL: make current 失败\n"); return 2; }
  printf ("OK: OSMesa 上下文就绪（GL_RENDERER=%s）\n", (const char *) glGetString (GL_RENDERER));

  /* ---- 1) 剖分凹多边形 ---- */
  printf ("\n[1] 用 GLU 剖分 L 形（凹）多边形\n");
  GLUtesselator *tess = gluNewTess ();
  if (! tess) { printf ("FAIL: gluNewTess 返回 NULL\n"); return 2; }

  gluTessCallback (tess, GLU_TESS_BEGIN, (void (*)(void)) cb_begin);
  gluTessCallback (tess, GLU_TESS_VERTEX, (void (*)(void)) cb_vertex);
  gluTessCallback (tess, GLU_TESS_ERROR, (void (*)(void)) cb_error);
  gluTessProperty (tess, GLU_TESS_WINDING_RULE, GLU_TESS_WINDING_ODD);

  gluTessBeginPolygon (tess, NULL);
  gluTessBeginContour (tess);
  for (int i = 0; i < 6; i++)
    gluTessVertex (tess, outline[i], outline[i]);
  gluTessEndContour (tess);
  gluTessEndPolygon (tess);
  gluDeleteTess (tess);

  printf ("  剖分输出：图元类型 %s（%u）、顶点数 %d、begin 回调 %d 次\n",
          prim_name (tess_prim), (unsigned) tess_prim, tess_nverts, tess_prim_count);
  {
    int ok = (tess_nverts > 0 && (tess_nverts % 3) == 0);
    printf ("  %-30s %s（应为 3 的倍数且 > 0）\n", "顶点数是三角形列表",
            ok ? "PASS" : "**FAIL**");
    if (! ok) failures++;
  }

  /* ---- 2) 把剖分结果画进缓冲 ---- */
  printf ("\n[2] 把剖分出的三角形画进 OSMesa 缓冲\n");
  glClearColor (0.0f, 0.0f, 0.0f, 1.0f);
  glClear (GL_COLOR_BUFFER_BIT);
  glViewport (0, 0, W, H);
  glMatrixMode (GL_PROJECTION); glLoadIdentity ();
  glOrtho (0.0, 1.0, 0.0, 1.0, -1.0, 1.0);
  glMatrixMode (GL_MODELVIEW); glLoadIdentity ();

  /* 直接拿剖分回调收到的**原始坐标**重画一边（这样这一步测的是"剖分结果对不对"，
     而不是"再调一次 GLU"）。 */
  glColor3f (1.0f, 1.0f, 0.0f);   /* 黄 */
  glBegin (tess_prim);            /* ← 按 GLU 给的类型画（通常是 FAN），不是猜的 */
  for (int i = 0; i < tess_nverts; i++)
    glVertex2dv (tess_verts[i]);
  glEnd ();
  glFinish ();

  /* L 形覆盖的区域（归一化坐标）：
       · 内部取样：x=0.6,y=0.25（下方那条横杠里）→ 应该是黄的
       · 凹口取样：x=0.7,y=0.7（右上缺的那块）→ 应该是黑的 */
  expect_px ("L 形内部（横杠内）", buf, (int) (0.6 * W), (int) (0.25 * H), 255, 255, 0, 255);
  expect_px ("凹口内部（应为黑底）", buf, (int) (0.7 * W), (int) (0.7 * H), 0, 0, 0, 255);
  expect_px ("L 形内部（竖杠内）", buf, (int) (0.25 * W), (int) (0.7 * H), 255, 255, 0, 255);
  expect_px ("左下角外（应为黑底）", buf, 0, 0, 0, 0, 0, 255);

  OSMesaDestroyContext (ctx);
  free (buf);

  printf ("\n=== %s（失败 %d 项）===\n",
          failures ? "**GLU 剖分未通过**" : "GLU 剖分在 OSMesa 上可用（步骤② 的库层面未知已消掉）",
          failures);
  return failures ? 1 : 0;
}
