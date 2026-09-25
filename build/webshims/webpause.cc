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

extern "C" void web_pause_ms (int ms);

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
