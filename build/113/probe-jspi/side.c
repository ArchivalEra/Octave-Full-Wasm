/* Octave-Full-Wasm — JSPI 组合探针（R5）：side module 侧
 * Copyright (C) 2026 ArchivalEra
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 这个模块扮演的就是 `.oct`：以 `-fPIC -sSIDE_MODULE=2` 编成独立 wasm，
 * 由主模块 **运行时 dlopen** 装载、dlsym 取指针后直接调用。
 * 它自己**没有** JS 环境（side module 里 EM_ASM 不可用，见 HANDOFF §4.13），
 * 只能调主模块导出的符号 —— 所以"能不能等浏览器"最终取决于这条跨模块调用链。
 */
extern int main_wait (int ms);

int
side_wait (int ms)
{
  return main_wait (ms) + 1;   /* 42 + 1 —— 用来确认返回值真的跨过了两层模块边界 */
}
