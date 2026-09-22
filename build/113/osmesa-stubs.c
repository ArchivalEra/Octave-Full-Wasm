/*
 * P5 第一步的少量垫片：补 emscripten 不提供的几个 POSIX 符号
 * Copyright (C) 2026 ArchivalEra
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 只有三个符号，全部来自 Mesa 的 `src/util/u_thread.c`（线程工具的装饰性功能）：
 *
 *   sched_getcpu        —— 取当前 CPU 号（只用于线程命名/亲和性显示）。
 *                          emscripten 没有；返回 0 即可（"第 0 个核"）。
 *   pthread_setname_np  —— 给线程起名（调试用）。emscripten 没有；
 *                          假装成功返回 0。
 *
 * 两个都**不影响光栅化**，也不会改变任何数值结果 —— 纯粹是链接期需要有个实体。
 * （链接期实测：不补这两个就只能拿到
 *   `undefined symbol: sched_getcpu` / `pthread_setname_np`，其余 2 万多个未定义
 *   符号都由 libc/libm 解决。）
 *
 * 注意签名要与 Linux 上的 glibc 一致，否则 wasm 的类型检查会拒绝：
 *   int sched_getcpu (void);
 *   int pthread_setname_np (pthread_t thread, const char *name);
 */
#include <pthread.h>

int
sched_getcpu (void)
{
  return 0;   /* 单核语义：wasm 里没有"哪个核"这回事 */
}

int
pthread_setname_np (pthread_t thread, const char *name)
{
  (void) thread;
  (void) name;
  return 0;   /* 命名只是调试用途，假装成功 */
}
