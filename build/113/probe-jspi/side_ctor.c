/* Octave-Full-Wasm — JSPI 探针（A2 判据 2/3）：带全局构造函数的 side module
 * Copyright (C) 2026 ArchivalEra
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 用途（第三轮外部复审 §2 判据 2/3）：dlopen 它时，构造函数会执行一次
 * **与挂起完全无关**的间接调用。若这一步炸 SuspendError，说明 JSPI/binaryen
 * 把不该包装的路径也包了（VTK 案例复现）⇒ 收窄口径不干净。
 * ctor_ping 必须经**函数指针**调用（间接调用才是要测的形状）。
 */
static int (*fp) (void);

static int
target (void)
{
  return 7;
}

__attribute__((constructor))
static void
ctor_init (void)
{
  fp = &target;
}

int
ctor_ping (void)
{
  return fp ? fp () : -9;   /* 7 = 构造函数跑过 + 间接调用没炸 */
}
