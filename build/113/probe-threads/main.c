/* Octave-Full-Wasm — E3 探针：pthread × 运行期 dlopen（主模块侧）
 * Copyright (C) 2026 ArchivalEra
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 要回答的唯一问题（第四轮外部评审 Q1/Q3 的判据）：
 *   **`-pthread -sSHARED_MEMORY` 的主模块，在"已经有 pthread 在跑"的状态下
 *   反复 `dlopen/dlsym/dlclose` 一个 side module，会不会死锁/炸？**
 *   （emscripten#9582 记的是"历史互斥"，现代官方说"能工作但仍 experimental"，
 *     5.0.7 + 本项目组合没人验过 ⇒ 自证。）
 *
 * 形态故意贴产品：**所有 dlopen 都发生在解释器/主线程**，pthread 只在旁边忙
 * （BLAS 线程的样子），不让 pthread 自己去 dlopen（那是另一个变量）。
 *
 * 判据：
 *   ① 100 轮 dlopen/dlsym/调用/dlclose 全部成功（返回值 = 41+1 = 42）；
 *   ② 期间两个 pthread 真的在跑（busy 计数 > 0）；
 *   ③ **无 hang**（外部 runner 40s 硬超时兜底；超时本身就是"死锁"这个数据点）；
 *   ④ 反向断言：dlopen 一个不存在的路径必须失败（证明这条路真的在跑，不是替身）。
 */

#include <emscripten.h>
#include <emscripten/threading.h>
#include <dlfcn.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdio.h>

static atomic_int g_run = 0;
static atomic_int g_busy = 0;

/* 两个"BLAS 风格"的忙线程：一直转，直到主线程收工。
 * 用 emscripten_thread_sleep 让它们周期性让出，但仍保持存活 —— 这样主线程
 * 做 dlopen 时，loader 的跨线程同步真的被触发（而不是"没有别的线程"的假绿）。 */
static void *e3_worker (void *arg)
{
  (void) arg;
  while (atomic_load (&g_run))
    {
      atomic_fetch_add (&g_busy, 1);
      emscripten_thread_sleep (1);
    }
  return NULL;
}

EMSCRIPTEN_KEEPALIVE int
e3_busy_counter (void)
{
  return atomic_load (&g_busy);
}

/* 主入口：起 2 个线程 → 反复 dlopen/dlsym/dlclose → 收线程。返回成功轮数。 */
EMSCRIPTEN_KEEPALIVE int
e3_run (int iters)
{
  pthread_t t[2];
  atomic_store (&g_run, 1);
  for (int i = 0; i < 2; i++)
    {
      int rc = pthread_create (&t[i], NULL, e3_worker, NULL);
      if (rc != 0)
        {
          printf ("[e3] pthread_create #%d 失败 rc=%d\n", i, rc);
          atomic_store (&g_run, 0);
          return -10 - i;
        }
    }
  emscripten_thread_sleep (20);   /* 让两个线程先真的跑起来 */

  int ok = 0;
  for (int i = 0; i < iters; i++)
    {
      void *h = dlopen ("/side.wasm", RTLD_NOW);
      if (! h)
        {
          printf ("[e3] 第 %d 轮 dlopen 失败：%s\n", i, dlerror ());
          break;
        }
      int (*fn) (int) = (int (*) (int)) dlsym (h, "side_add");
      if (! fn)
        fn = (int (*) (int)) dlsym (h, "_side_add");   /* 前导下划线两种写法都试 */
      if (! fn)
        {
          printf ("[e3] 第 %d 轮 dlsym 失败：%s\n", i, dlerror ());
          dlclose (h);
          break;
        }
      if (fn (41) == 42)
        ok++;
      else
        {
          printf ("[e3] 第 %d 轮返回值错：%d\n", i, fn (41));
          dlclose (h);
          break;
        }
      dlclose (h);
    }

  atomic_store (&g_run, 0);
  for (int i = 0; i < 2; i++)
    pthread_join (t[i], NULL);
  printf ("[e3] ok=%d/%d busy=%d\n", ok, iters, atomic_load (&g_busy));
  return ok;
}

/* 反向断言：不存在的模块必须 dlopen 失败（0）。若这里返回 1，说明整条
 * dlopen 路根本没被走到（替身/桩），那么"100 轮成功"就没有证据力。 */
EMSCRIPTEN_KEEPALIVE int
e3_dlopen_missing (void)
{
  void *h = dlopen ("/definitely-not-here.wasm", RTLD_NOW);
  return h ? 1 : 0;
}
