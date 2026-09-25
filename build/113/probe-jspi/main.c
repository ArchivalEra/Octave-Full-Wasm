/* Octave-Full-Wasm — JSPI 组合探针（R5）：主模块侧
 * Copyright (C) 2026 ArchivalEra
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 这个探针要回答的唯一问题（外部审核 R5 的原话）：
 *   "`-fwasm-exceptions` + `-sJSPI` + `MAIN_MODULE=2` + `SIDE_MODULE`/dlopen 这个组合，
 *    在你这个工程里到底成不成立？"
 * 规范层面 JSPI 与 wasm EH 是兼容的（Promise reject 会按 wasm EH 的 JS API 传播），
 * 但**没有找到公开的大型项目先例** ⇒ 必须自证，不许"理论上应该行"。
 *
 * 三段链路在这里一次编出来（`probe-jspi.sh` 分别产出 p0/p1/p2）：
 *   P0  主模块只有"导出即挂起"的函数      —— 验 `-sJSPI` 与 `-fwasm-exceptions` 能不能共存
 *   P1  主模块一个**普通**导出内部去等      —— 验"主模块 helper"（将来 pause() 要的形态）
 *   P2  **side module**（dlopen 装载）调主模块 helper 再等
 *                                          —— 验我们真正需要的架构（.oct → 主模块 → JS）
 *
 * 判据（三段共用）：`browser_wait_ms()` 里的 Promise 会在等待期间让出事件循环
 * ⇒ ① 墙上时间 ≥ 请求的毫秒数；② 等待期间 JS 的 tick 计数**必须增加**
 *   （busy-loop 不增加；Asyncify 那种"重写整个栈"也不是我们要的答案）。
 */

#include <emscripten.h>
#include <dlfcn.h>
#include <stdio.h>

/* 由 --js-library 提供（见 jslib.js）：它返回一个 **Promise** ⇒ 会挂起 wasm 栈 */
extern void browser_wait_ms (int ms);

/* P0/P1 用：主模块的 helper。JSPI_EXPORTS 让 emscripten 在 JS 侧把它包成
 * `WebAssembly.promising(...)` ⇒ 从 JS 调 `Module._main_wait(ms)` 拿到 Promise。 */
EMSCRIPTEN_KEEPALIVE int
main_wait (int ms)
{
  printf ("[wasm] main_wait(%d) 进入\n", ms);
  browser_wait_ms (ms);
  printf ("[wasm] main_wait(%d) 返回\n", ms);
  return 42;
}

/* P2 用：在主模块里 dlopen 一个 side module，取符号并**在 C 里直接调用**它 ——
 * 这正是 Octave 走 `.oct` 的路径（dlsym 拿函数指针 → 调用），而调用链会一路
 * 回到主模块的 main_wait → JS 的挂起 import。中途任何一环不支持挂起，这里就会炸。 */
/* ⚠️ **不要给 JSPI 导出传字符串**（实测踩过，而且症状极具误导性）：
 *    `Module._run_side("/side.wasm", 200)` 里的 JS 字符串**不会**被 marshal 成 C 指针
 *    （那需要 `ccall`/`cwrap` 或 `allocateUTF8`），wasm 收到的是 `NULL` ⇒
 *    `dlopen(NULL)` 返回**主模块自己的句柄** ⇒ 于是 dlsym 报
 *      `Tried to lookup unknown symbol "side_wait" in dynamic lib: __main__`
 *    —— 看起来像"side module 没导出符号"，其实是"路径根本没传进去"。
 *    所以这里把路径**写死在 C 里**（真实链路里路径也是 C/C++ 侧自己解析的，
 *    JS 只需要触发一个带数字参数的入口）。
 */
#define SIDE_PATH "/side.wasm"

EMSCRIPTEN_KEEPALIVE int
run_side (int ms)
{
  const char *path = SIDE_PATH;
  void *h = dlopen (path, RTLD_NOW);
  if (! h)
    {
      printf ("[wasm] dlopen 失败：%s\n", dlerror ());
      return -1;
    }

  /* ⚠️ 符号名的两种写法都试（实测踩过）：Emscripten 的 dlsym 在不同版本里对
   * "带不带前导下划线"的处理不完全一致（C 侧符号在 wasm 里是 `side_wait`，
   * 而某些路径会去找 `_side_wait`）。这里**显式两边都试**并把 dlerror 打出来，
   * 免得"找不到符号"变成一个看不出根因的 -2。 */
  int (*fn) (int) = (int (*) (int)) dlsym (h, "side_wait");
  if (! fn)
    {
      printf ("[wasm] dlsym(side_wait) 失败：%s\n", dlerror ());
      fn = (int (*) (int)) dlsym (h, "_side_wait");
      if (fn)
        printf ("[wasm] 但 dlsym(_side_wait) 成功 ⇒ 该 emscripten 版本要带前导下划线\n");
    }
  if (! fn)
    {
      printf ("[wasm] 两种写法都失败：%s\n", dlerror ());
      return -2;
    }

  printf ("[wasm] 调用 side_wait(%d)（经 dlopen/dlsym 指针）\n", ms);
  int r = fn (ms);
  printf ("[wasm] side_wait 返回 %d\n", r);
  dlclose (h);
  return r;
}

/* ── A2 最小实验（第三轮外部复审的判据 1，2026-09-25）────────────────────────
 * **不进 JSPI_EXPORTS** 的同步导出，内部直达挂起 import。
 * 预期：从 JS 调它 = **红**（抛 SuspendError: trying to suspend without
 * WebAssembly.promising）—— 这条量化"漏标入口"的代价：不是优雅降级，是当场炸。
 * 对照组是上面的 main_wait（列了表的 ⇒ 从 JS 调拿到 Promise）。 */
EMSCRIPTEN_KEEPALIVE int
main_wait_unmarked (int ms)
{
  browser_wait_ms (ms);
  return 43;
}

/* ── A2 判据 2/3：dlopen 一个**带全局构造函数**的 side module ─────────────────
 * 构造函数里做一次**与挂起完全无关**的间接调用（函数指针）。它有两个用途：
 * · 判据 2（预期**绿**）：若 dlopen 它就炸 SuspendError ⇒ binaryen 的 JSPI pass
 *   把不该包的也包了（外部复审引的 VTK 案例在我们的布局下复现）。
 * · 判据 3：它**不碰**挂起 import ⇒ 若未标记的同步 dlopen 一直绿，则"必须先热身"
 *   （机制②）在收窄口径下不成立/不需要依赖。
 * 故意**不列进 JSPI_EXPORTS**：同一段代码在"未标记同步"语境下测。 */
EMSCRIPTEN_KEEPALIVE int
run_ctor_unmarked (void)
{
  const char *path = "/side_ctor.wasm";
  void *h = dlopen (path, RTLD_NOW);
  if (! h)
    {
      printf ("[wasm] dlopen(%s) 失败：%s\n", path, dlerror ());
      return -1;
    }
  int (*fn) (void) = (int (*) (void)) dlsym (h, "ctor_ping");
  if (! fn)
    {
      printf ("[wasm] dlsym(ctor_ping) 失败：%s\n", dlerror ());
      return -2;
    }
  printf ("[wasm] 调 ctor_ping()（构造函数已跑过间接调用）\n");
  int r = fn ();
  printf ("[wasm] ctor_ping 返回 %d\n", r);
  return r;
}

/* ── A2 补测（根因确认后的 2×2 矩阵收尾，2026-09-25）────────────────────────
 * 根因：5.0.7 胶水 `instrumentWasmImports` 里 `original.isAsync || importPattern.test(x)`
 * 且 `-sJSPI`(=ASYNCIFY=2) 使 `__dlopen_js.isAsync=true` ⇒ **dlopen 无条件是挂起点**，
 * `-sJSPI_IMPORTS` 收窄管不住。⇒ 2×2 矩阵：
 *   plain 栈 × 新模块   = 红（判据2 实测）；
 *   plain 栈 × 已装载   = 绿（"机制②"的真身：只是不再走 __dlopen_js）；
 *   promising 栈 × 新模块 = **本函数测这个**（预期绿）—— 这正是产品侧
 *     "所有可能 dlopen 的解释器入口都必须走 promising"这条架构规则的直接依据。 */
EMSCRIPTEN_KEEPALIVE int
run_ctor_marked (void)
{
  const char *path = "/side_ctor.wasm";
  void *h = dlopen (path, RTLD_NOW);
  if (! h)
    {
      printf ("[wasm] dlopen(%s) 失败：%s\n", path, dlerror ());
      return -1;
    }
  int (*fn) (void) = (int (*) (void)) dlsym (h, "ctor_ping");
  if (! fn)
    {
      printf ("[wasm] dlsym(ctor_ping) 失败：%s\n", dlerror ());
      return -2;
    }
  int r = fn ();
  printf ("[wasm] ctor_ping(marked) 返回 %d\n", r);
  return r;
}
