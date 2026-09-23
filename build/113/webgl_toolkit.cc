// Octave-Full-Wasm — 图形线 WebGL：真 WebGL2 图形 toolkit（GPU，替代 OSMesa 软件光栅化）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 这个文件与 osmesa_toolkit.cc 的关系 ──────────────────────────────────────
// **同一个骨架，只把"渲染目标"换掉**。OSMesa 那条线（步骤①②③ 已打通，
// 见 build/113/NOTES-p5-osmesa.md）用 Mesa 的 **纯软件光栅化**；这条线要 **GPU**，
// 于是：
//
//     后端        创建"当前 GL 上下文"的方式
//   ------------  ------------------------------------------------------------
//      OSMesa     OSMesaCreateContextExt() + OSMesaMakeCurrent()（渲进 calloc 的内存）
//      WebGL2     emscripten_webgl_create_context() + emscripten_webgl_make_context_current()
//                 + initialize_gl4es()          ← gl4es 的 COMPILE.md 要求：必须在任何 GL 调用之前
//
// `figure_pixsize` / 三件套 `set_viewport→draw→finish→get_pixels` / `write_png` /
// `publish_png` / `print_figure` **一字不改照搬** —— 那些与后端无关（OSMesa 那轮验证过）。
//
// ── 为什么需要 gl4es ───────────────────────────────────────────────────────
// Octave 的 `opengl_renderer` 要的是**固定管线 + 立即模式**（`glBegin/glVertex/glEnd`、
// 矩阵栈、`glLight`…），而 **WebGL2/GLES 没有固定管线**。emscripten 自带的
// `LEGACY_GL_EMULATION` 走这条路是**实测失败**的（Edge-Tools 死在
// `numVertices must be an integer` at `glEnd`，见 vendor-edge-tools/MILESTONE-2.md）。
// **gl4es**（ptitSeb，OpenGL 1.5/2.1 → GLES2 翻译库，官方带 Emscripten 目标）自己实现
// 立即模式，本仓已实测通过：`build/113/gl4es-smoke.c` 在真 Chromium 里 16/16
// （立即模式绿三角，逐像素断言）。
//
// ── ★ 本文件必须用 gl4es 的 include 编译 ────────────────────────────────────
// gl4es 在 `__EMSCRIPTEN__` 下把自己的导出**全部 mangle 成 `gl4es_gl*`**
// （`include/GL/gl.h:30` 的 `MANGLE(x) = gl4es_gl##x` + `gl_mangle.h`）。
// 本文件是**唯一**实例化 `octave::opengl_functions` 的 TU（它那几百个 inline 虚函数
// 体里写的是 `::glBegin(...)`），所以 `link-web.sh` 必须把 gl4es 的 `include/`
// 放在所有 GL 头之前：
//   · 不这么做 → 那些 `::glXxx` 变成**裸名**，gl4es 不提供裸名 ⇒ 链接期一片 undefined；
//   · 这么做   → 全部变成 `gl4es_glXxx` ⇒ 走 gl4es → GLES2 → WebGL2(GPU)。
// （`gl-render.cc` 直接引用的 11 个符号是另一回事：`glGetIntegerv` + 10 个 `glu*`，
//  见 NOTES-webgl.md §3.4 与 build-glu-webgl.sh。）
//
// ── ⚠️ 与 OSMesa 的形态差异：WebGL **必须有一个 canvas** 当绘制目标 ───────────
// OSMesa 渲进我们自己的内存，**不需要 DOM**（那才是它能在 node 里跑的原因）。
// WebGL 必须有 canvas ⇒ 本 toolkit **自己把 canvas 建出来**（见 ensure_canvas() 的
// `EM_ASM`，它在**主模块**里可用），不依赖页面 index.html 加东西。
// canvas 是**隐藏的**：给页面看的仍然是 `publish_png()` 落下的那张 PNG，
// 这样 `bridge/p5canvas.js` 与页面显示逻辑与后端完全解耦、一行不用改。
//
// 构建：见 link-web.sh 的 `GL_BACKEND=webgl`（include 路径 + gl4es/GLU 绝对路径 + -sFULL_ES2=1）。

// ── config.h 必须先于任何 Octave 头（这不是"风格"，是**正确性**）──────────────
// **这是 OSMesa 那条线卡了两轮的根因**（`NOTES-p5-osmesa.md` §8.1）：
// `oct-opengl.h` 里 `class opengl_functions` 的整份虚函数表被
// `#if defined (HAVE_OPENGL)` 包着，而 `HAVE_OPENGL` / `HAVE_GLBLENDFUNCSEPARATE`
// **只来自 autoconf 的 config.h**（`octave-config.h` / `oct-conf-post-public.h` 里都没有）。
// 少了这一句，本 TU 里 `opengl_functions` 会退化成"只有虚析构"的空类（虚表 2 槽），
// 而 `gl-render.o` 的 `set_viewport` 要取第 77 槽 ⇒ `table index is out of bounds`。
//
// ⚠️ **位置同样是正确性的一部分**：必须排在**任何 Octave 头之前**。
//    放到 Octave 头之后不只失去上面那个作用，还会撞上 `oct-conf-post-public.h` 的
//    **重复定义**（`redefinition of 'octave_unused_parameter'`）—— 因为
//    `config.h` 自己也 include 那个头（`config.h:4442`），而 `octave-config.h` 那一侧
//    在 `OCTAVE_AUTOCONFIG_H_INCLUDED` 尚未定义时已经先吃过它一遍了。
//    （本文件第一版就把它放错了位置，实测报的就是这个错。）
#if defined (HAVE_CONFIG_H)
#  include "config.h"
#endif

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include <emscripten/emscripten.h>
#include <emscripten/html5.h>

// 先吃 gl4es 的 GL 头（见上面"★ 本文件必须用 gl4es 的 include 编译"）
#include <GL/gl.h>

// `initialize_gl4es()` 的声明（gl4es 的 COMPILE.md 要求显式调用它）
#include <gl4esinit.h>

#include "graphics.h"
#include "graphics-toolkit.h"
#include "gtk-manager.h"
#include "gl-render.h"
#include "gl2ps-print.h"
#include "oct-opengl.h"
#include "interpreter.h"
#include "error.h"
#include "defun-dld.h"
#include "ovl.h"

#define STB_IMAGE_WRITE_IMPLEMENTATION
#define STBI_WRITE_NO_STDIO
#include "stb_image_write.h"

// P5TK_DEBUG=1：把每次虚函数调用打到 octave_stdout（诊断用；默认关，零开销）。
#ifdef P5TK_DEBUG
#  define P5TK_LOG(...) do { octave_stdout << "P5TK "; octave_stdout << __VA_ARGS__; octave_stdout << std::flush; } while (0)
#else
#  define P5TK_LOG(...) do { } while (0)
#endif

// P5_TRACE=1：**逐步**追踪 `render()` 走到哪一步（诊断用；默认关，零开销）。
// `octave_stdout` 是带缓冲的流，wasm 一 trap 那几行就整个丢 —— 所以同时写
// `console.error`（不经 C 缓冲）与 MEMFS 的 `/tmp/p5trace.txt`（页面侧读文件最稳）。
// 这条通道是 OSMesa 那轮拿到的教训（NOTES-p5-osmesa.md §7.5 的两处更正）。
#ifdef P5TK_TRACE
static void
p5_trace_write (const std::string& line)
{
  std::FILE *f = std::fopen ("/tmp/p5trace.txt", "a");
  if (f)
    {
      std::fputs (line.c_str (), f);
      std::fputc ('\n', f);
      std::fclose (f);
    }

  std::string js = std::string ("console.error('P5TK ") + line + "');";
  emscripten_run_script (js.c_str ());
}
#  define P5TK_TRACE_MSG(s) do { p5_trace_write (std::string ("") + (s)); } while (0)
#else
#  define P5TK_TRACE_MSG(s) do { } while (0)
#endif

// 渲染结果落点：页面侧 `bridge/p5canvas.js` 从这个路径读图显示
static const char *P5_PNG_PATH = "/tmp/p5_fig.png";

// 隐藏 canvas：元素 id + CSS 选择器（本 toolkit 自己建，不依赖页面里预先写好 —— 见文件头）
static const char *P5_CANVAS_ID = "octave-gl-canvas";
static const char *P5_CANVAS_SEL = "#octave-gl-canvas";

static void
png_collect (void *ctx, void *data, int size)
{
  std::vector<unsigned char> *out = static_cast<std::vector<unsigned char> *> (ctx);
  const unsigned char *p = static_cast<const unsigned char *> (data);
  out->insert (out->end (), p, p + size);
}

OCTAVE_BEGIN_NAMESPACE (octave)

class webgl_graphics_toolkit : public base_graphics_toolkit
{
public:

  webgl_graphics_toolkit (interpreter& interp)
    : base_graphics_toolkit ("webgl"),
      m_interpreter (interp),
      m_glfcns (),
      m_renderer (m_glfcns),
      m_ctx (0),
      m_w (0), m_h (0),
      m_last_pixels ()
  {
    P5TK_LOG ("ctor\n");
  }

  OCTAVE_DISABLE_CONSTRUCT_COPY_MOVE (webgl_graphics_toolkit)

  ~webgl_graphics_toolkit () override { destroy_context (); }

  bool is_valid () const override { return true; }

  bool initialize (const graphics_object& go) override
  {
    P5TK_LOG ("initialize(" << go.type () << ")\n");
    return go.isa ("figure");
  }

  void finalize (const graphics_object& go) override
  {
    P5TK_LOG ("finalize(" << go.type () << ")\n");
  }

  void update (const graphics_object& go, int id) override
  {
    P5TK_LOG ("update(" << go.type () << ", " << id << ")\n");
  }

  void redraw_figure (const graphics_object& go) const override
  {
    int w = 0, h = 0;
    figure_pixsize (go, w, h);

    P5TK_TRACE_MSG ("redraw_figure ENTER " + describe (go) + " pixsize="
                    + std::to_string (w) + "x" + std::to_string (h));

    if (render (go, w, h))
      publish_png (w, h);
  }

  void show_figure (const graphics_object& go) const override
  {
    redraw_figure (go);
  }

  uint8NDArray get_pixels (const graphics_object& go) const override
  {
    int w = 0, h = 0;
    figure_pixsize (go, w, h);
    P5TK_TRACE_MSG ("get_pixels ENTER " + describe (go) + " " + std::to_string (w) + "x" + std::to_string (h));
    if (render (go, w, h))
      return m_last_pixels;
    return uint8NDArray ();
  }

  void print_figure (const graphics_object& go, const std::string& term,
                     const std::string& file_cmd,
                     const std::string& = "") const override
  {
    P5TK_LOG ("print_figure(term=" << term << ", cmd=" << file_cmd << ")\n");

    std::string path = extract_output_file (file_cmd);
    if (path.empty ())
      {
        warning_with_id ("Octave:p5-no-output-file",
                         "webgl toolkit: cannot parse output file from '%s'",
                         file_cmd.c_str ());
        return;
      }

    if (term == "png" || term == "pngcairo")
      {
        int w = 0, h = 0;
        figure_pixsize (go, w, h);
        if (render (go, w, h))
          write_png (path, w, h);
        return;
      }

    graphics_object fig = go.get_ancestor ("figure");
    gl2ps_print (m_glfcns, fig, file_cmd, term);
  }

  Matrix get_canvas_size (const graphics_handle& fh) const override
  {
    gh_manager& gh_mgr = m_interpreter.get_gh_manager ();
    graphics_object go = gh_mgr.get_object (fh);

    int w = 0, h = 0;
    figure_pixsize (go, w, h);

    Matrix sz (1, 2, 0.0);
    sz(0) = w;
    sz(1) = h;
    return sz;
  }

  double get_screen_resolution () const override { return 96.0; }

  Matrix get_screen_size () const override
  {
    Matrix sz (1, 2, 0.0);
    sz(0) = 1920;
    sz(1) = 1080;
    return sz;
  }

  // 没有 freetype ⇒ 文本度量给空矩阵（上游会退回自己的估算）。
  // 这是本构建的**已知缺口**（`--without-freetype`）：刻度/title 空白但不崩。
  Matrix get_text_extent (const graphics_object&) const override
  {
    return Matrix ();
  }

  void close () override { P5TK_LOG ("close\n"); }

private:

  static void figure_pixsize (const graphics_object& go, int& w, int& h)
  {
    w = h = 0;

    if (! (go && go.isa ("figure")))
      return;

    Matrix pos = go.get ("position").matrix_value ();
    double dpr = 1.0;
    try { dpr = go.get ("__device_pixel_ratio__").double_value (); } catch (...) { }

    if (pos.numel () >= 4)
      {
        w = std::max (1, static_cast<int> (pos(2) * dpr + 0.5));
        h = std::max (1, static_cast<int> (pos(3) * dpr + 0.5));
      }
  }

  // 页面侧建一个**隐藏 canvas** 当绘制目标。用 EM_ASM 而不是要求页面先写好 ——
  // `EM_ASM` 在 **side module** 里不可用，但本文件是编进**主模块**的（见文件尾），所以能用。
  // 用 `left:-9999px` 而不是 `display:none`：后者在部分实现里会让 canvas 不参与合成，
  // 徒增风险；离屏摆放最稳。
  static void ensure_canvas ()
  {
    EM_ASM ({
      var id = UTF8ToString ($0);
      if (! document.getElementById (id))
        {
          var c = document.createElement ('canvas');
          c.id = id;
          c.width = 16;
          c.height = 16;
          c.style.cssText = 'position:absolute;left:-9999px;top:0;width:16px;height:16px';
          (document.body || document.documentElement).appendChild (c);
        }
    }, P5_CANVAS_ID);
  }

  // WebGL2 上下文 + gl4es（尺寸变了就重设 canvas）
  bool ensure_context (int w, int h) const
  {
    P5TK_TRACE_MSG ("ensure_context(" + std::to_string (w) + "x" + std::to_string (h) + ")");

    if (w <= 0 || h <= 0)
      return false;

    if (m_ctx && w == m_w && h == m_h)
      return true;

    if (! m_ctx)
      {
        ensure_canvas ();

        // ── 属性**逐级退让**，不要一次定死 ──────────────────────────────────
        // 实测（2026-09-23，Android 15 模拟器里的 Android WebView）：
        // 我们原来那套组合（alpha=0 / antialias=1 / depth=1 / preserveDrawingBuffer=1）
        // 在模拟器的 GL 栈上**建不出上下文** —— 底下的报错是
        //     E EGL_emulation: tid …: eglCreateContext(1830): error 0x3005 (EGL_BAD_CONFIG)
        // 也就是它的 EGL config 表里没有匹配项；而**默认属性**是能的
        // （同一个页面里 `canvas.getContext('webgl2')` 成功，renderer =
        //  "Android Emulator OpenGL ES Translator (NVIDIA GeForce RTX 4060)"）。
        // 症状会伪装成"渲染器不工作"：`getframe` 报
        //     failed to capture frame data, potentially due to insufficient graphics capabilities
        //
        // 真机也有 config 受限的机型 ⇒ 这不是"模拟器专属保险"，是**该有的健壮性**。
        // 顺序：理想 → 关抗锯齿 → 不保绘制缓冲 → emscripten 默认值（-1 = 不改这一项）。
        const int NTRY = 4;
        const int set_alpha[NTRY]    = { 0, 0, 0, -1 };
        const int set_aa[NTRY]       = { 1, 0, 0, -1 };
        const int set_depth[NTRY]    = { 1, 1, 1, -1 };
        const int set_preserve[NTRY] = { 1, 1, 0, -1 };
        const char *set_name[NTRY] = { "ideal(a0,aa1,d1,p1)", "no-aa", "no-preserve", "emscripten-defaults" };

        for (int i = 0; i < NTRY && ! m_ctx; i++)
          {
            EmscriptenWebGLContextAttributes attrs;
            emscripten_webgl_init_context_attributes (&attrs);
            attrs.majorVersion = 2;   // 一定要 WebGL2：gl4es 走 GLES2 路径需要它
            attrs.minorVersion = 0;
            // 不透明（alpha=0）时读回来是纯 RGB，不受 canvas 与页面的 alpha 合成影响；
            // depth 必须有（3D 靠深度测试）；preserveDrawingBuffer 只是为了不依赖
            // "同一任务内读回"这个前提（我们其实是同一任务，但留着更稳）。
            if (set_alpha[i] >= 0)    attrs.alpha = set_alpha[i];
            if (set_aa[i] >= 0)       attrs.antialias = set_aa[i];
            if (set_depth[i] >= 0)    attrs.depth = set_depth[i];
            if (set_preserve[i] >= 0) attrs.preserveDrawingBuffer = set_preserve[i];
            if (set_aa[i] >= 0)       attrs.stencil = 0;

            m_ctx = emscripten_webgl_create_context (P5_CANVAS_SEL, &attrs);
            if (m_ctx <= 0)
              {
                P5TK_TRACE_MSG (std::string ("webgl ctx create FAILED (") + set_name[i]
                                + ") code=" + std::to_string (m_ctx));
                m_ctx = 0;
              }
            else
              P5TK_TRACE_MSG (std::string ("webgl ctx create OK (") + set_name[i] + ")");
          }

        if (! m_ctx)
          {
            P5TK_TRACE_MSG ("emscripten_webgl_create_context FAILED for all attribute sets");
            return false;
          }

        if (emscripten_webgl_make_context_current (m_ctx) != EMSCRIPTEN_RESULT_SUCCESS)
          {
            P5TK_TRACE_MSG ("emscripten_webgl_make_context_current FAILED");
            emscripten_webgl_destroy_context (m_ctx);
            m_ctx = 0;
            return false;
          }

        // ★ 必须在**任何 GL 调用之前**（gl4es 的 COMPILE.md 明确要求）。
        //   它内部通过 emscripten_GetProcAddress() 取真 GLES2 入口并建自己的状态机。
        initialize_gl4es ();

        const GLubyte *ver = ::glGetString (GL_VERSION);
        P5TK_TRACE_MSG (std::string ("gl4es ready, GL_VERSION=")
                        + (ver ? (const char *) ver : "(null)"));
      }

    // canvas 的**像素**尺寸 = 图的像素尺寸（DPR 已经在 figure_pixsize 里算进 w/h 了）
    emscripten_set_canvas_element_size (P5_CANVAS_SEL, w, h);

    if (emscripten_webgl_make_context_current (m_ctx) != EMSCRIPTEN_RESULT_SUCCESS)
      {
        P5TK_TRACE_MSG ("re-make-current FAILED");
        return false;
      }

    m_w = w;
    m_h = h;
    P5TK_TRACE_MSG ("context " + std::to_string (w) + "x" + std::to_string (h) + " ready");
    return true;
  }

  void destroy_context () const
  {
    if (m_ctx)
      {
        emscripten_webgl_destroy_context (m_ctx);
        m_ctx = 0;
      }
    m_w = m_h = 0;
  }

  bool render (const graphics_object& go, int w, int h) const
  {
    P5TK_TRACE_MSG ("render enter " + describe (go) + " " + std::to_string (w)
                    + "x" + std::to_string (h));

    if (! ensure_context (w, h))
      {
        static bool warned = false;
        if (! warned)
          {
            warning_with_id ("Octave:p5-no-context",
                             "webgl toolkit: cannot create a WebGL2 context");
            warned = true;
          }
        return false;
      }

#if defined (P5TK_GLPROBE)
    {
      const GLubyte *ver = ::glGetString (GL_VERSION);
      const GLubyte *ren = ::glGetString (GL_RENDERER);
      P5TK_TRACE_MSG (std::string ("direct glGetString GL_VERSION=")
                      + (ver ? (const char *) ver : "(null)")
                      + " GL_RENDERER=" + (ren ? (const char *) ren : "(null)"));
      ::glClearColor (1.0f, 1.0f, 1.0f, 1.0f);
      ::glClear (GL_COLOR_BUFFER_BIT);
      ::glFinish ();
      P5TK_TRACE_MSG ("direct glClear/glFinish ok");
    }
#endif

    m_renderer.set_viewport (w, h);
    m_renderer.set_device_pixel_ratio (1.0);
    m_renderer.draw (go);
    m_renderer.finish ();

    m_last_pixels = m_renderer.get_pixels (w, h);

    P5TK_TRACE_MSG ("get_pixels -> " + std::to_string (m_last_pixels.numel ())
                    + " values, nonwhite=" + std::to_string (count_nonwhite ()));

    return m_last_pixels.numel () > 0;
  }

  std::size_t count_nonwhite () const
  {
    if (m_last_pixels.numel () == 0)
      return 0;

    std::size_t n = 0;
    const octave_uint8 white (255);
    for (octave_idx_type i = 0; i < m_last_pixels.numel (); i++)
      if (m_last_pixels(i) != white)
        n++;
    return n;
  }

  static std::string describe (const graphics_object& go)
  {
    std::string s = "obj=";
    try
      {
        if (go.isa ("figure"))
          {
            // ⚠️ 用 `double_value()`，**不要** `string_value()`：`number` 是 double 属性，
            //    `string_value()` 会触发 Octave 的 "implicit conversion from scalar to
            //    sq_string" 警告 —— 实测每个渲染步刷一遍，把真正的输出淹掉。
            s += "figure#" + std::to_string (static_cast<int> (go.get ("number").double_value ()));
          }
        else
          s += go.type ();
      }
    catch (...) { s += "?"; }
    return s;
  }

  void write_png (const std::string& path, int w, int h) const
  {
    std::vector<unsigned char> rgb (static_cast<size_t> (w) * h * 3);
    for (int i = 0; i < h; i++)
      for (int j = 0; j < w; j++)
        for (int k = 0; k < 3; k++)
          rgb[(static_cast<size_t> (i) * w + j) * 3 + k]
            = static_cast<unsigned char> (m_last_pixels (i, j, k));

    std::vector<unsigned char> png;
    int rc = stbi_write_png_to_func (png_collect, &png, w, h, 3, rgb.data (), w * 3);
    if (! rc)
      {
        warning_with_id ("Octave:p5-png-encode",
                         "webgl toolkit: PNG encoding failed for '%s'", path.c_str ());
        return;
      }

    std::FILE *f = std::fopen (path.c_str (), "wb");
    if (! f)
      {
        warning_with_id ("Octave:p5-png-write",
                         "webgl toolkit: cannot open '%s' for writing", path.c_str ());
        return;
      }
    std::fwrite (png.data (), 1, png.size (), f);
    std::fclose (f);
  }

  void publish_png (int w, int h) const
  {
    write_png (P5_PNG_PATH, w, h);

    emscripten_run_script (R"JS(
(function () {
  try {
    if (window.OctaveP5 && typeof window.OctaveP5.show === 'function')
      window.OctaveP5.show('/tmp/p5_fig.png');
  } catch (e) { try { console.warn('OctaveP5.show failed: ' + e); } catch (e2) {} }
})();
)JS");
  }

  static std::string extract_output_file (const std::string& cmd)
  {
    std::string::size_type last = cmd.rfind ('"');
    if (last != std::string::npos)
      {
        std::string::size_type first = (last == 0) ? std::string::npos : cmd.rfind ('"', last - 1);
        if (first != std::string::npos && last > first + 1)
          return cmd.substr (first + 1, last - first - 1);
      }

    std::string::size_type sp = cmd.find_last_of (" \t");
    return (sp == std::string::npos) ? cmd : cmd.substr (sp + 1);
  }

  interpreter& m_interpreter;

  mutable opengl_functions m_glfcns;
  mutable opengl_renderer m_renderer;
  mutable int m_ctx;              // EMSCRIPTEN_WEBGL_CONTEXT_HANDLE（0 = 没有）
  mutable int m_w, m_h;
  mutable uint8NDArray m_last_pixels;
};

// ⚠️ **这个文件被编进主模块**（不是 `.oct`）：`main.cc` 在 addpath 之后调用
//    `p5_install_webgl_graphics_toolkit()` 登记 + 装载（见 link-web.sh 的 `GL_BACKEND=webgl`）。
//    为什么不走 `.oct`：与 OSMesa 那条完全同理 —— `opengl_functions` 的虚表跨模块会失效，
//    而且**本 TU 是唯一实例化 `opengl_functions` 的地方**，它必须和 gl-render.o 在同一次链接里。
void
p5_install_webgl_graphics_toolkit (interpreter& interp)
{
  P5TK_LOG ("__init_webgl__ called\n");

  gtk_manager& gtk_mgr = interp.get_gtk_manager ();

  gtk_mgr.register_toolkit ("webgl");

  graphics_toolkit tk (new webgl_graphics_toolkit (interp));
  gtk_mgr.load_toolkit (tk);
}

OCTAVE_END_NAMESPACE (octave)

// 给 `main.cc` 用的 C 链接入口（避免在 main.cc 里写命名空间）
extern "C" void
p5_install_webgl_graphics_toolkit (octave::interpreter& interp)
{
  octave::p5_install_webgl_graphics_toolkit (interp);
}
