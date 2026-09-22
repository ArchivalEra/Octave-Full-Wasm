// Octave-Full-Wasm — T2/A1：`web` 图形 toolkit（图形句柄半真化）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 这个文件解决什么 ────────────────────────────────────────────────────────
// 本构建**没有编任何图形 toolkit**（`--without-opengl`，也没有 gnuplot/fltk/qt）。
// 后果（探针实测，见 `test/browser/probe-t2-graphics.mjs`）：
//     available_graphics_toolkits()  → {}          （空）
//     graphics_toolkit()             → 空
//     figure(1)                      → get: invalid handle (= 1)   ← 建不出 figure
//     gcf / gca / get / set          → 同一个 invalid handle
//     plot(...)                      → plot 桥能画（SVG），但 gca/get 这些**句柄语义全废**
// 也就是说：图能出来，但**图对象不存在**，`title/set/get/xlim/legend` 这些一概不可用。
//
// ── 做法（**不是**重链主 wasm，而是资产车道的 side module）────────────────────
// 计划里 T2 原本记为 "Lane B（重链）"，但探针 + 读源码发现**不需要**：
//   · `available_graphics_toolkits()` 返回的是 **运行时注册表**，不是编译期清单：
//       DEFMETHOD (available_graphics_toolkits, …) { return gtk_mgr.available_toolkits_list (); }
//   · `gtk_manager::register_toolkit(const std::string&)`（只登记名字，且**默认库为空时
//     会顺手把它设成默认库**）与 `load_toolkit(const graphics_toolkit&)`（inline）
//     都在**已安装头文件**里可达，符号由 MAIN_MODULE=1 的主模块导出。
//   · `graphics_toolkit.m:86` 那道门禁只要求"名字在 available 列表里"，
//     所以登记 + 装载两步做完，`graphics_toolkit('web')` 就通了。
// ⇒ 于是 T2 变成"写一个 `.oct` 资产"，**主 wasm 零改动**，与 R1/R4/R5/R8 同一套路子。
//
// ── `base_graphics_toolkit` 的契约（读 graphics-toolkit.h 得到的）───────────
//   基类的每个 virtual **默认实现都会 `gripe_if_tkit_invalid()`**，而它只在
//   `is_valid()` 为真时才不报错；基类 `is_valid()` 默认返回 **false**。
//   所以一个能用的 toolkit 至少要：`is_valid()` 返回 true、`initialize()` 返回 true
//   （否则 figure 建不出来）、`redraw_figure()` 不做事（渲染继续交给 plot 桥）。
//   其余给稳妥的默认值即可 —— 这正是计划里说的"半真化"：**只救活句柄语义，不碰绘图重构**。
//
// 构建（容器内，side module，**不链任何库**）：
//   OUT=/src/octs CC_SRCS="__init_web__:/src/websrc/web_graphics_toolkit.cc" \
//     bash /src/bin/build-oct.sh --cc
// 产物 `__init_web__.oct` 放到站点 `assets/oct/`，并由 `webgraphics` 资产负责
// 在启动时登记 + 装载（见 build/webgraphics/）。
//
// ⚠️ 函数名与文件名必须一致：Octave 按 `<函数名>.oct` 找模块，这里
//    DEFUN_DLD(__init_web__, …) ↔ `__init_web__.oct`，所以**不需要**建别名符号链接。

#include <string>
#include <iostream>

// WEBTK_DEBUG=1：把 toolkit 的每次虚函数调用打到 stderr，用来查"图形对象建没建出来"。
//   诊断完请用不带该宏的方式重编（默认关闭，零开销）。
#ifdef WEBTK_DEBUG
#  define WEBTK_LOG(...) do { octave_stdout << "WEBTK "; octave_stdout << __VA_ARGS__; octave_stdout << std::flush; } while (0)
#else
#  define WEBTK_LOG(...) do { } while (0)
#endif

#include "graphics.h"
#include "graphics-toolkit.h"
#include "gtk-manager.h"
#include "interpreter.h"
#include "defun-dld.h"
#include "error.h"
#include "ovl.h"

// ⚠️ 命名空间（实测）：`graphics_object` 在 `octave::` 里，而
//    `Matrix` / `uint8NDArray` / `graphics_handle` 在**全局** —— 写 `octave::Matrix` 编不过。

// ── 最小 toolkit ────────────────────────────────────────────────────────────
class web_graphics_toolkit : public octave::base_graphics_toolkit
{
public:

  web_graphics_toolkit (const std::string& nm = "web")
    : octave::base_graphics_toolkit (nm)
  { WEBTK_LOG ("ctor(%s)\n", nm.c_str ()); }

  ~web_graphics_toolkit () = default;

  // 基类默认 false；返回 true 才让 `operator bool` 与所有默认实现"不报错"。
  bool is_valid () const override { WEBTK_LOG ("is_valid -> true\n"); return true; }

  // ★ 关键：返回 true 才允许创建图形对象（figure/axes/line）。
  //   基类默认返回 false → 那就会退化成我们现在看到的 "invalid handle"。
  bool initialize (const octave::graphics_object& go) override
  {
#ifdef WEBTK_TEST_INIT_FALSE
    // 诊断用：若我们的 override **真的被调用**，返回 false 会让 figure 建不出来。
    WEBTK_LOG ("initialize(%s) -> FALSE(诊断)\n", go.type ().c_str ());
    return false;
#else
    WEBTK_LOG ("initialize(%s) -> true\n", go.type ().c_str ());
    return true;
#endif
  }

  // ── 以下全部 no-op：**渲染不归 toolkit 管** ──────────────────────────────
  // 图的产出继续走已验证的两条桥：
  //   · 屏幕显示 / `print -dsvg` → `build/plotbridge/`（纯 .m 生成 SVG）
  //   · `print` 的接管点        → `print.m` / `saveas.m` 覆写
  void redraw_figure (const octave::graphics_object& go) const override
  { WEBTK_LOG ("redraw_figure(%s)\n", go.type ().c_str ()); }
  void show_figure (const octave::graphics_object& go) const override
  { WEBTK_LOG ("show_figure(%s)\n", go.type ().c_str ()); }
  void print_figure (const octave::graphics_object&, const std::string&,
                     const std::string&,
                     const std::string& = "") const override { }
  void update (const octave::graphics_object& go, int id) override
  { WEBTK_LOG ("update(%s, id=%d)\n", go.type ().c_str (), id); }
  void finalize (const octave::graphics_object& go) override
  { WEBTK_LOG ("finalize(%s)\n", go.type ().c_str ()); }
  void close () override { WEBTK_LOG ("close()\n"); }

  // ── 尺寸/分辨率：给"看起来合理"的默认值，别让上游拿到 0 ────────────────
  // 560x420 是 Octave figure 的默认尺寸，也是 gnuplot toolkit 的默认画布。
  Matrix get_canvas_size (const graphics_handle&) const override
  {
    Matrix m (1, 2, 0.0);
    m(0) = 560.0;
    m(1) = 420.0;
    return m;
  }

  double get_screen_resolution () const override { WEBTK_LOG ("get_screen_resolution()\n"); return 72.0; }

  Matrix get_screen_size () const override
  {
    Matrix m (1, 2, 0.0);
    m(0) = 1024.0;
    m(1) = 768.0;
    return m;
  }

  // 无光栅器 → 文本度量给空矩阵（上游会退回到自己的估算）。
  Matrix get_text_extent (const octave::graphics_object&) const override
  {
    return Matrix ();
  }

  uint8NDArray get_pixels (const octave::graphics_object&) const override
  {
    return uint8NDArray ();
  }
};

DEFUN_DLD (__init_web__, args, nargout,
           "-*- texinfo -*-\n\
@deftypefn {Loadable Function} {} __init_web__ ()\n\
Register and load the @code{web} graphics toolkit: a minimal toolkit that only\n\
brings up the graphics-object handles (@code{figure}, @code{gcf}, @code{gca},\n\
@code{get}, @code{set}, @code{title}, ...).  Rendering is deliberately left to\n\
the pure-@code{.m} plot/print bridges, so every rendering virtual is a no-op.\n\
@end deftypefn")
{
  // 未使用的形参：显式吃掉，免得 -Wunused 报警
  (void) args;
  (void) nargout;

  WEBTK_LOG ("__init_web__ called\n");

  octave::interpreter& interp = *octave::interpreter::the_interpreter ();

  octave::gtk_manager& gtk_mgr = interp.get_gtk_manager ();

  // ① 登记名字：让它出现在 `available_graphics_toolkits()` 里，
  //    并且**在默认库为空时顺带被设为默认库**（gtk-manager.cc:66 的 register_toolkit）。
  gtk_mgr.register_toolkit ("web");

  // ② 装载实例：`graphics_toolkit.m` 装载后会检查 `loaded_graphics_toolkits()`，
  //    这里不做的话它会报 "web toolkit was not correctly loaded"。
  octave::graphics_toolkit tk (new web_graphics_toolkit ("web"));
  gtk_mgr.load_toolkit (tk);

  return octave_value_list ();
}
