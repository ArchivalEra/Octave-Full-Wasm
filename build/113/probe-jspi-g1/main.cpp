// Octave-Full-Wasm — 工单 05 结算件：G1 "页面起不来" 的**永久复现探针**（v13 结晶，2026-09-29）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 背景（NOTES-jspi「v11/v12/v13」节，2026-09-24 深夜实测）：带 -sJSPI 的产物里，
// **只要链里有 dlopen/dlsym，它上游的整条入口都变成"可能挂起"**；
// **启动期（静态初始化器）就碰同步 dlopen** ⇒ 模块初始化期间抛
// `SuspendError: trying to suspend without WebAssembly.promising` ⇒ **页面永远到不了 ready**
// —— 这就是 G1 那类"页面看起来卡死"的机制现场。
//
// 一份源码、两个变体（编译期宏切换，**唯一变量 = 启动期是否碰 dlopen**）：
//   · 控制组（默认编）：同样的 embind 面（sync/async/callSide），启动期**不**碰 dlopen
//     ⇒ 页面必须 ready（证明 harness 与旗标本身没坏 —— 反向断言的锚）；
//   · 实验组（-DG1_STARTUP_DLOPEN=1）：静态初始化器里走同步 dlopen ⇒ 页面必须**起不来**
//     （pageerror = SuspendError）。哪天这个不红了，说明 V8/emsdk 行为变了 ⇒ 翻面重写判据。
//
// 注意：本探针是 **A 姿势**（-sJSPI 在链接期打开）—— 它复现的就是 A 姿势下的墙；
// 现役产品走 B 姿势（页面侧包装，见 CONTEXT.md），不受此墙影响。
#include <emscripten.h>
#include <emscripten/bind.h>
#include <dlfcn.h>
#include <string>
using namespace emscripten;

static int f (std::string s) { return (int) s.size (); }

static int call_side (int x) {
  void *h = dlopen ("/side.wasm", RTLD_NOW);
  if (! h) return -1;
  typedef int (*fn) (int);
  fn g = (fn) dlsym (h, "side_add");
  return g ? g (x) : -2;
}

#ifdef G1_STARTUP_DLOPEN
struct Warm {                 // ★ 实验组：静态初始化器 —— 在任何 promising 入口之前跑
  Warm () { volatile int r = call_side (10); (void) r; }
};
static Warm warm;
#endif

EMSCRIPTEN_BINDINGS (repro) {
  function ("sync_f",  &f);
  function ("async_f", &f, async());
  function ("callSide", &call_side);
}
int main () { return 0; }
