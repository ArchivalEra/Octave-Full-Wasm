// Octave-Full-Wasm — P5 步骤②：OSMesa 图形 toolkit（真渲染，不是句柄半真化）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 这个文件解决什么 ────────────────────────────────────────────────────────
// T2 的 `web` toolkit（`build/113/web_graphics_toolkit.cc`）只救活了**图形对象句柄**
// 语义，`redraw_figure()` 是 no-op —— 图能出来是因为另有 plot 桥在出 SVG。本文件
// 把渲染接上：让 Octave **自己的 `opengl_renderer`**（`gl-render.cc`，一字不改）
// 跑在 **OSMesa**（Mesa 的软件光栅化，渲到内存缓冲）上。
//
// 为什么是 OSMesa 而不是 WebGL（外部团队 Edge-Tools 撞过的那面墙）：
//   Octave 的渲染器写的是**固定管线 + 立即模式**（`glBegin/glVertex/glEnd`、矩阵栈、
//   `glLight`），而 WebGL/GLES 根本没有固定管线；emscripten 的
//   `LEGACY_GL_EMULATION` 是"一套有限的变通"，他们实测死在
//   `numVertices must be an integer` at `glEnd`（详见
//   `build/113/vendor-edge-tools/MILESTONE-2.md`，与本项目独立得到同一结论）。
//   OSMesa 是**完整的 OpenGL**，只是渲进内存 —— 这一类 bug 从根上不存在。
//
// ── 这条线最终走的是"主 wasm 带 GL"（B 档），不是资产自包含（A 档）────────────
// 先把 A 档（Mesa 全打进 `.oct`）试到底了，**三道墙都有实测记录**，最后放弃：
//   ① Chrome 禁止主线程**同步编译 >8MB** 的 wasm（`WebAssembly.Compile is disallowed
//      on the main thread, if the buffer size is larger than 8MB`）——`dlopen` 恒走同步路径；
//      解法是页面侧**异步预加载**（`bridge/assets-loader.js` 的 `SYNC_COMPILE_LIMIT`
//      + `build/post.js` 暴露 `Module.loadDynamicLibrary`）。
//   ② `.oct` 需要主模块胶水里的 JS 库函数（`emscripten_longjmp`），而资产车道的
//      `.oct` 不在主链命令行上 ⇒ 不会被自动收进来。解法见 `link-web.sh` 的 `LIB_FUNCS`
//      与 Mesa/GLU 的 SjLj 模式重建（见下）。
//   ③ 即使①②都解决，**10.8MB / 数据段 4.5MB / `dylink.0` tableSize=12543** 的
//      side module 在装载期仍会读到**错位的字符串**（实测：Octave 的 API 版本检查
//      把 `__init_osmesa__` 错读成紧邻的 `__VERSION__`、把 `api-v61` 错读成 Mesa 的
//      `VARYING_SLOT_*` 串）⇒ 判定为"这个体量超出 side module 那条路能干净处理的范围"。
// ⇒ **改为主 wasm 带 GL**：主树 `WITH_OPENGL=1` 重配重编 + 主链加 `-lGL -lGLU`
//   （`glshim` 把 OSMesa 冒充成 GL）。于是 `opengl_renderer` 与 OSMesa 的
//   `OSMesa*` 入口都在**主模块**里（MAIN_MODULE=1 全导出），本文件就退化成
//   **一个薄 toolkit**：不内嵌任何 Mesa 代码，只 import 主模块的符号。
//   代价：主 wasm 变大（OSMesa 20MB 归档里被引用到的部分）；收益：装载干净、
//   `print -dpng` / `getframe` 也能走官方那条路。
//
// ── 骨架来自哪（**不是从零写的**）──────────────────────────────────────────
//   · 骨架 / 生命周期 / `figure_pixsize` / `get_canvas_size` / 登记装载：
//     Edge-Tools `octave-patches/webgl-graphics-toolkit.cc`（GPL-3.0-or-later，
//     见 `build/113/vendor-edge-tools/` 与 `NOTES-p5-osmesa.md` 的"现成实现清单"）。
//     **去掉**了他们那批 GL 垫片（`glColor3dv`/`glVertex3d`/`glMultMatrixd`/
//     `glClipPlane`/显示列表/选择/光栅 那 ~30 个空实现）—— 那是为 WebGL 补的，
//     OSMesa 全都有。
//   · 渲染三件套（`set_viewport` → `draw` → `get_pixels`）：Octave 官方
//     `libgui/graphics/GLCanvas.cc:66-133`（`GLWidget::draw` / `do_getPixels` /
//     `do_print`）—— 这是**官方**的最小配方。
//   · context 创建与像素读回：本仓 `build/113/osmesa-smoke.c`（步骤① 验证过）。
//   · `.oct` → 页面 的通道：本仓 `build/webnet.cc` —— **`EM_ASM` 在 side module 里
//     不可用**（emscripten 明确拒绝），只能用 `emscripten_run_script` + MEMFS
//     （见 HANDOFF §4.13）。
//   · PNG 编码：`stb_image_write.h`（本仓 `build/webimage.cc` 已在用）。
//
// ── 与 plot 桥的关系（两者共存，不冲突）────────────────────────────────────
//   本 toolkit 管"真对象 + 真渲染"；plot 桥（`build/plotbridge/`）仍管它自己那套
//   屏幕显示与 `print -dsvg`。`figure.m` 里两边都建（见该文件注释）。回退方案始终在：
//   `graphics_toolkit('web')` 或干脆不加载本资产。
//
// 构建（容器内；**主树须已 `WITH_OPENGL=1` 重配重编**，且主链已带 `-lGL -lGLU`）：
//   cd /src/bin && OUT=/src/octs-p5 OCT_INCS="-I/src/work/octave-11.3.0 -I/src/deps/glshim/include" \
//     CC_SRCS="__init_osmesa__:/src/websrc/osmesa_toolkit.cc" bash build-oct.sh --cc
//   （不链任何库 —— OSMesa/GLU/renderer 全由主模块在 dlopen 时解析，与 dldfcn 同一套路）
// 产物 `__init_osmesa__.oct` → 站点 `assets/oct/`，由 `p5osmesa` 资产在装载时登记 + 装载。
//
// ⚠️ 函数名与文件名必须一致（Octave 按 `<函数名>.oct` 找模块）：DEFUN_DLD(__init_osmesa__)
//    ↔ `__init_osmesa__.oct`，所以**不需要**建别名符号链接。

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include <GL/osmesa.h>
#include <GL/gl.h>

#include <emscripten/emscripten.h>

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

// PNG 编码器（stb_image_write 是单头文件；路径由 build-oct.sh 的 `-I/src/vendor/stb` 提供）。
// ⚠️ 与 `build/webimage.cc` 同口径：`STBI_WRITE_NO_STDIO` ⇒ 没有 `stbi_write_png(FILE*)`，
//    要用 `stbi_write_png_to_func` 走回调（先把字节收进内存，再一次性 `fwrite` 落盘）。
#define STB_IMAGE_WRITE_IMPLEMENTATION
#define STBI_WRITE_NO_STDIO
#include "stb_image_write.h"

// P5TK_DEBUG=1：把每次虚函数调用打到 octave_stdout（诊断用；默认关，零开销）。
// 注意 side module 里 `fprintf(stderr, …)` **打不出来**（T2 踩过），要用 octave_stdout。
#ifdef P5TK_DEBUG
#  define P5TK_LOG(...) do { octave_stdout << "P5TK "; octave_stdout << __VA_ARGS__; octave_stdout << std::flush; } while (0)
#else
#  define P5TK_LOG(...) do { } while (0)
#endif

// 渲染结果落点：页面侧 `bridge/p5canvas.js` 从这个路径读图显示
static const char *P5_PNG_PATH = "/tmp/p5_fig.png";

// stb 的写回调：把编码出的字节收进 vector（与 `build/webimage.cc` 同法）
static void
png_collect (void *ctx, void *data, int size)
{
  std::vector<unsigned char> *out = static_cast<std::vector<unsigned char> *> (ctx);
  const unsigned char *p = static_cast<const unsigned char *> (data);
  out->insert (out->end (), p, p + size);
}

OCTAVE_BEGIN_NAMESPACE (octave)

class osmesa_graphics_toolkit : public base_graphics_toolkit
{
public:

  osmesa_graphics_toolkit (interpreter& interp)
    : base_graphics_toolkit ("osmesa"),
      m_interpreter (interp),
      m_glfcns (),
      m_renderer (m_glfcns),
      m_ctx (nullptr),
      m_buf (nullptr),
      m_w (0), m_h (0),
      m_last_pixels ()
  {
    P5TK_LOG ("ctor\n");
  }

  OCTAVE_DISABLE_CONSTRUCT_COPY_MOVE (osmesa_graphics_toolkit)

  ~osmesa_graphics_toolkit () override { destroy_context (); }

  // 基类默认 false；返回 true 才让所有默认实现"不报错"（见 T2 的记录）
  bool is_valid () const override { return true; }

  // ★ 只有返回 true 才允许创建图形对象（figure/axes/line）
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

  // ★ 渲染接缝：OSMesa 上下文 → 官方 opengl_renderer → 像素 → PNG → 页面
  void redraw_figure (const graphics_object& go) const override
  {
    int w = 0, h = 0;
    figure_pixsize (go, w, h);

    // 页面上"没有窗口"的等价物：把图写到 MEMFS 并通知页面（`drawnow` 之后能看到）
    if (render (go, w, h))
      publish_png (w, h);
  }

  void show_figure (const graphics_object& go) const override
  {
    redraw_figure (go);
  }

  // `getframe` 要的就是它：真像素（T2 的 web toolkit 在这里返回空数组，
  // 于是 getframe 报 "failed to capture frame data"）
  uint8NDArray get_pixels (const graphics_object& go) const override
  {
    int w = 0, h = 0;
    figure_pixsize (go, w, h);
    if (render (go, w, h))
      return m_last_pixels;
    return uint8NDArray ();
  }

  // 打印：位图（png）自己渲；矢量（pdf/ps/eps/svg）交给主模块里官方的 gl2ps_print
  void print_figure (const graphics_object& go, const std::string& term,
                     const std::string& file_cmd,
                     const std::string& = "") const override
  {
    P5TK_LOG ("print_figure(term=" << term << ", cmd=" << file_cmd << ")\n");

    std::string path = extract_output_file (file_cmd);
    if (path.empty ())
      {
        warning_with_id ("Octave:p5-no-output-file",
                         "osmesa toolkit: cannot parse output file from '%s'",
                         file_cmd.c_str ());
        return;
      }

    // 位图：自己渲（gl2ps 只做矢量）
    if (term == "png" || term == "pngcairo")
      {
        int w = 0, h = 0;
        figure_pixsize (go, w, h);
        if (render (go, w, h))
          write_png (path, w, h);
        return;
      }

    // 矢量：转给官方的 gl2ps_print（它是主模块导出的符号）
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

  // 无光栅器 → 文本度量给空矩阵（上游会退回到自己的估算）。
  // ⚠️ 本构建**没有 freetype**（`--without-freetype`）⇒ 文字渲不出来（刻度/title 空白
  //    但不崩）。这是如实记录的已知缺口，见 NOTES-p5-osmesa.md。
  Matrix get_text_extent (const graphics_object&) const override
  {
    return Matrix ();
  }

  void close () override { P5TK_LOG ("close\n"); }

private:

  // 官方 GLCanvas 的算法：figure 的 `position`（像素）× `__device_pixel_ratio__`
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

  // OSMesa 上下文 + 帧缓冲（尺寸变了就重建）
  bool ensure_context (int w, int h) const
  {
    if (w <= 0 || h <= 0)
      return false;

    if (m_ctx && w == m_w && h == m_h)
      return true;

    destroy_context ();

    m_buf = static_cast<unsigned char *> (std::calloc (static_cast<size_t> (w) * h * 4, 1));
    if (! m_buf)
      return false;

    // OSMESA_RGBA + 无深度/模板/累加缓冲：本渲染器只用颜色缓冲
    //（渲染器内部自己 `glEnable(GL_DEPTH_TEST)` 也无妨，softpipe 会给默认深度）
    m_ctx = OSMesaCreateContextExt (OSMESA_RGBA, 24, 0, 0, nullptr);
    if (! m_ctx)
      {
        std::free (m_buf);
        m_buf = nullptr;
        return false;
      }

    if (! OSMesaMakeCurrent (m_ctx, m_buf, GL_UNSIGNED_BYTE, w, h))
      {
        destroy_context ();
        return false;
      }

    m_w = w;
    m_h = h;
    P5TK_LOG ("context " << w << "x" << h << "\n");
    return true;
  }

  void destroy_context () const
  {
    if (m_ctx)
      {
        OSMesaDestroyContext (m_ctx);
        m_ctx = nullptr;
      }
    if (m_buf)
      {
        std::free (m_buf);
        m_buf = nullptr;
      }
    m_w = m_h = 0;
  }

  // 渲染并读回像素（三件套：set_viewport → draw → get_pixels）
  bool render (const graphics_object& go, int w, int h) const
  {
    if (! ensure_context (w, h))
      {
        static bool warned = false;
        if (! warned)
          {
            warning_with_id ("Octave:p5-no-context",
                             "osmesa toolkit: cannot create OSMesa context");
            warned = true;
          }
        return false;
      }

#if defined (P5TK_GLPROBE)
    // 诊断：直接调 GL 入口（不经 opengl_functions 虚表）。用来区分"GL 入口本身不可用"
    // 与"经虚表的间接调用表槽不对"这两件事。
    {
      const GLubyte *ver = ::glGetString (GL_VERSION);
      const GLubyte *ren = ::glGetString (GL_RENDERER);
      octave_stdout << "P5TK GL_VERSION=" << (ver ? (const char *) ver : "(null)")
                    << " GL_RENDERER=" << (ren ? (const char *) ren : "(null)")
                    << std::endl;
      ::glClearColor (1.0f, 1.0f, 1.0f, 1.0f);
      ::glClear (GL_COLOR_BUFFER_BIT);
      ::glFinish ();
      octave_stdout << "P5TK direct glClear ok" << std::endl;
    }
#endif
    m_renderer.set_viewport (w, h);
    m_renderer.set_device_pixel_ratio (1.0);
    m_renderer.draw (go);
    m_renderer.finish ();

    m_last_pixels = m_renderer.get_pixels (w, h);
    return m_last_pixels.numel () > 0;
  }

  // 把渲染结果写成 PNG 落到 MEMFS（给 `print -dpng` 和页面显示共用）
  void write_png (const std::string& path, int w, int h) const
  {
    // get_pixels 返回的是 (h, w, 3)、行序已翻成上到下；但 Octave 的列优先存储
    // ⇒ 内存里不是交错的 RGB 行，必须自己摊平（否则图会花）
    std::vector<unsigned char> rgb (static_cast<size_t> (w) * h * 3);
    for (int i = 0; i < h; i++)
      for (int j = 0; j < w; j++)
        for (int k = 0; k < 3; k++)
          rgb[(static_cast<size_t> (i) * w + j) * 3 + k]
            = static_cast<unsigned char> (m_last_pixels (i, j, k));

    // 回调版（`STBI_WRITE_NO_STDIO` 下没有 stbi_write_png(FILE*)），与 webimage.cc 同法：
    // 先收进内存，再一次性写文件
    std::vector<unsigned char> png;
    int rc = stbi_write_png_to_func (png_collect, &png, w, h, 3, rgb.data (), w * 3);
    if (! rc)
      {
        warning_with_id ("Octave:p5-png-encode",
                         "osmesa toolkit: PNG encoding failed for '%s'", path.c_str ());
        return;
      }

    std::FILE *f = std::fopen (path.c_str (), "wb");
    if (! f)
      {
        warning_with_id ("Octave:p5-png-write",
                         "osmesa toolkit: cannot open '%s' for writing", path.c_str ());
        return;
      }
    std::fwrite (png.data (), 1, png.size (), f);
    std::fclose (f);
  }

  // 写 PNG + 通知页面贴上（EM_ASM 在 side module 不可用 ⇒ emscripten_run_script + MEMFS）
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

  // `file_cmd` 形如 `-dpng "/tmp/out.png"`；取最后一个引号串，退化时取最后一个词
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
  mutable OSMesaContext m_ctx;
  mutable unsigned char *m_buf;
  mutable int m_w, m_h;
  mutable uint8NDArray m_last_pixels;
};

// ⚠️ **这个文件被编进主模块**（不是 `.oct`）：`main.cc` 在 addpath 之后调用
//    `p5_install_osmesa_graphics_toolkit()` 登记 + 装载（见 link-web.sh 的 `P5_TOOLKIT=1`）。
//    为什么不走 `.oct`：**`opengl_functions` 的虚表会跨模块** —— `opengl_renderer`
//    （`gl-render.cc`，opengl-on 后编在主模块里）会通过 `m_glfcns.xxx()` 回调，
//    而对象若由 side module 创建，那个间接调用就会在**主模块的调用点**打到不属于它的
//    表槽上（实测：`RuntimeError: table index is out of bounds`,
//    栈顶正是 `octave::opengl_renderer::set_viewport(int, int)`）。
//    Edge-Tools 的参考实现也是把 toolkit **编进主模块**（他们追加到 `gl-render.cc`
//    并从 `interpreter::initialize()` 调 installer）—— 这里沿用同一个形态。
void
p5_install_osmesa_graphics_toolkit (interpreter& interp)
{
  P5TK_LOG ("__init_osmesa__ called\n");

  gtk_manager& gtk_mgr = interp.get_gtk_manager ();

  gtk_mgr.register_toolkit ("osmesa");

  graphics_toolkit tk (new osmesa_graphics_toolkit (interp));
  gtk_mgr.load_toolkit (tk);
}

OCTAVE_END_NAMESPACE (octave)

// 给 `main.cc` 用的 C 链接入口（避免在 main.cc 里写命名空间）
extern "C" void
p5_install_osmesa_graphics_toolkit (octave::interpreter& interp)
{
  octave::p5_install_osmesa_graphics_toolkit (interp);
}
