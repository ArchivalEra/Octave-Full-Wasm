// Octave-Full-Wasm — dlopen 自检探针（dldprobe）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 为什么有这个文件：`dldprobe.oct` 一直是**自写探针**，但**源码从没进过仓库** ——
// 盘上只剩一个 7.2 时代编出来的 .oct。换到 11.3.0 后它加载即失败：
//   could not load dynamic lib: /oct/dldprobe.oct
//   TypeError: Cannot read properties of undefined (reading 'value')
// 这正是 HANDOFF §10.3 坑 1 的签名：7.2 用 JS 式异常编的 side module，
// 里面的 `invoke_*`/`__cxa_*` 只在 7.2 的 JS 胶水里有；11.3.0 用的是
// **wasm 原生异常**，导出表里没有它们 → 一装就炸。
// ⇒ 必须按 11.3.0 重编。所以把源码补进仓库（与 post.js、build/webshell/*.m
//    同一类"补可复现性缺口"的动作）。
//
// 契约（accept-full.mjs 依赖，别改返回值）：`dldprobe()` 返回 **42**；
//   `exist("dldprobe")` 为 3（.oct）。
// 它只做一件事：证明「一个由本树头文件编出的真 .oct，能被主模块 dlopen 装载并调用」。
//
// 构建（容器内）：
//   OUT=/src/octs CC_SRCS="dldprobe:/src/websrc/dldprobe.cc" bash /src/bin/build-oct.sh --cc
// 产物 → 站点根的 dldprobe.oct（accept-full 先找 ./dldprobe.oct，再找 ./oct/dldprobe.oct）

#include <octave/oct.h>

DEFUN_DLD (dldprobe, args, ,
  "-*- texinfo -*-\n\
@deftypefn {Loadable Function} {@var{v} =} dldprobe ()\n\
Self-written probe used by the acceptance suite: returns 42 to prove that a\n\
real @file{.oct} side module built from this tree's headers can be dlopen'ed\n\
by the main module and called.\n\
@end deftypefn")
{
  if (args.length () != 0)
    print_usage ();

  return octave_value (42);
}
