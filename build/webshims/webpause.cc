// Octave-Full-Wasm — `__web_pause_ms__`：网页版 `pause` 的挂起原语（G2，2026-09-25）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 这是一个**真 .oct**（side module，运行期 dlopen），被 `build/webshims/pause.m`
// 调用，把 Octave 的 `pause` 变成"真让出主线程"：
//
//   pause.m  ──调用──▶ __web_pause_ms__(毫秒)     ← 本模块（DEFUN_DLD）
//                          │ 调主模块导出 web_pause_ms(int)
//                          ▼
//                    main.cc 的 web_pause_ms ──▶ JS import web_sleep_ms（返回 Promise）
//                          │ 页面钩子把它包成 WebAssembly.Suspending
//                          ▼
//                    在 promising 栈（eval_wait）上 ⇒ 整个 wasm 栈挂起，
//                    页面定时器/动画照常跑，Promise 落地后同一条栈继续。
//
// 编译（容器内，旗标照抄 build/113/build-oct.sh 的 11.3.0 口径）：
//   em++ -DHAVE_CONFIG_H -I<OCT> -I<OCT>/liboctave -I<OCT>/libinterp \
//        -I<OCT>/libinterp/corefcn -I<OCT>/libinterp/octave-value \
//        -I$INST/include/octave-11.3.0 -I$INST/include/octave-11.3.0/octave \
//        -std=c++17 -O2 -fwasm-exceptions -fPIC -c webpause.cc -o webpause.oct.o
//   em++ -sSIDE_MODULE=1 -fPIC -O2 -shared -o __web_pause_ms__.oct webpause.oct.o
// ⚠️ 不链任何库：`web_pause_ms` 由主模块导出表在 dlopen 时解析
//    （WITH_JSPI=1 的产物才有这个导出，见 link-web.sh JSPI_EXPORT_FUNCS）。
// ⚠️ 异常模型必须 -fwasm-exceptions 与主模块一致（build-oct.sh 头部的三条实测）。

#include <octave/oct.h>

// web_pause_ms 的**定义在 main.cc**（那里查中断旗标、抛 interrupt_exception —— G4
// 的可靠投递点）。本模块只做声明，符号由主模块导出表在 dlopen 时解析。
// ⚠️ 千万别把定义搬进 .oct：那会引入 web_sleep_ms / octave_interrupt_state 两个
//    side module 解析不到的符号 ⇒ 整个模块 dlopen 失败（实测 2026-09-25）。
extern "C" void web_pause_ms (int ms);
extern "C" int web_suspend_ok_impl (void);
extern "C" int web_ginput_arm_impl (void);
extern "C" int web_ginput_pending_impl (void);
extern "C" int web_ginput_pop_impl (double *v);
extern "C" void emscripten_run_script (const char *s);   // JS 库符号（LIB_FUNCS）

DEFUN_DLD (__web_pause_ms__, args, nargout,
           "__web_pause_ms__ (MS)\n"
           "\n"
           "网页版内部原语：把 wasm 栈挂起 MS 毫秒（页面事件循环照常跑）。\n"
           "由 webshims/pause.m 调用；不建议直接使用。")
{
  int nargin = args.length ();
  double ms = 0.0;
  if (nargin > 0)
    {
      if (! args(0).isnumeric () || args(0).isempty ())
        error ("__web_pause_ms__: 参数必须是数值毫秒数");
      else
        ms = args(0).double_value ();   // ★ 参数就是**毫秒**（秒→毫秒的换算归 pause.m）
    }
  if (ms < 0.0)
    ms = 0.0;
  web_pause_ms (static_cast<int> (ms));
  return octave_value_list ();
}

// ── 批次 3（2026-09-25）：D9 门槛 + G3 取点原语 ─────────────────────────────
// 全部转发到主模块导出（webjslib.js 实现）。等待**不**在这里挂起：取点的轮询循环
// 靠 __web_pause_ms__ 让出，arm/pending/pop 是即返原语。

DEFUN_DLD (__web_suspend_ok__, args, nargout,
           "__web_suspend_ok__ ()\n"
           "\n"
           "D9 门槛：页面钩子是否真的包上了 Suspending（无 JSPI API 的浏览器 = 0）。\n"
           "pause/ginput/keyboard 等能力 shim 先问它，不可用就清晰报错（不静默降级）。")
{
  return octave_value (web_suspend_ok_impl () == 1);
}

// pop 返回一行向量 [x, y, rectW, rectH, button]（画布 CSS px，y 向下）；队列空 = []
DEFUN_DLD (__web_ginput_arm__, args, nargout,
           "__web_ginput_arm__ ()\n"
           "\n"
           "清空点击队列并开始收点（G3：先 arm 再收，第二次点击不会误触发下一次 ginput）。")
{
  web_ginput_arm_impl ();
  return octave_value_list ();
}

DEFUN_DLD (__web_ginput_pending__, args, nargout,
           "__web_ginput_pending__ (): 队列里的未取点数。")
{
  return octave_value (web_ginput_pending_impl ());
}

DEFUN_DLD (__web_run_js__, args, nargout,
           "__web_run_js__ (JS_CODE)\n"
           "\n"
           "在页面里同步执行一段 JS（D6：触发 OctaveAssets.load 等页面侧能力）。")
{
  if (args.length () != 1 || ! args(0).is_string ())
    error ("__web_run_js__: 需要一个字符串参数");
  emscripten_run_script (args(0).string_value ().c_str ());
  return octave_value_list ();
}

DEFUN_DLD (__web_ginput_pop__, args, nargout,
           "__web_ginput_pop__ (): 弹一个点击，返回 [x, y, rectW, rectH, button]；空 = []。")
{
  double v[4];
  int b = web_ginput_pop_impl (v);
  if (b < 0)
    return octave_value (Matrix ());
  Matrix m (1, 5);
  m(0) = v[0]; m(1) = v[1]; m(2) = v[2]; m(3) = v[3]; m(4) = static_cast<double> (b);
  return octave_value (m);
}
