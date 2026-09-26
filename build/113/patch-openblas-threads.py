#!/usr/bin/env python3
# Octave-Full-Wasm — **线程版 OpenBLAS 在 Emscripten 下的可移植性补丁**（2026-09-26）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 背景：`USE_THREAD=1` 编 OpenBLAS 到 wasm 时，`driver/others/blas_server.c` 过不去 ——
# Emscripten libc 没有这几个 POSIX 东西（实测三条编译错）：
#     error: variable has incomplete type 'struct rlimit'
#     error: call to undeclared function 'raise'
#     error: use of undeclared identifier 'SIGINT'
# 而那段代码**只在 `pthread_create` 失败后的诊断分支里**（打印 rlimit 限制 + `raise(SIGINT)`）
# ⇒ 在 wasm 里它没有语义（没有进程内信号、没有 rlimit）⇒ 打补丁跳过，失败路径直接 exit。
#
# ★ 为什么这个补丁重要：不补它，**整个线程版 OpenBLAS 编不出来** ⇒ 就没法回答
#   "多线程到底能让数学快多少"（实测补上之后：N=2000 上 T=8 = **7.2×**，Firefox/Chromium 一致，
#   见 `build/113/NOTES-threads.md` 的"线程版 BLAS 缩放"节）。
#
# 用法（容器内，源码树任意位置）：
#   python3 patch-openblas-threads.py /src/work/OpenBLAS-thr
# 幂等：已经打过就什么都不做（报 0 处命中）。
import sys


def main(argv):
    if len(argv) < 2:
        print("用法: patch-openblas-threads.py <OpenBLAS 源码树>", file=sys.stderr)
        return 2
    root = argv[1].rstrip("/")
    p = root + "/driver/others/blas_server.c"
    try:
        s = open(p, encoding="utf-8").read()
    except OSError as e:
        print("FATAL: 读不到 %s（%s）" % (p, e), file=sys.stderr)
        return 2

    n = 0
    # ① <sys/resource.h> 不存在（Emscripten 里 struct rlimit 都不完整）
    if "#include <sys/resource.h>" in s and "#ifndef __EMSCRIPTEN__\n#include <sys/resource.h>" not in s:
        s = s.replace("#include <sys/resource.h>",
                      "#ifndef __EMSCRIPTEN__\n#include <sys/resource.h>\n#endif", 1)
        n += 1

    # ② pthread_create 失败后的诊断分支：跳过 rlimit 报告与 raise(SIGINT)
    i = s.find("      if(ret!=0){\n\tstruct rlimit rlim;\n")
    if i >= 0:
        j = s.index("\n      }\n", i) + len("\n      }\n")
        new = '''      if(ret!=0){
        const char *msg = strerror(ret);
        fprintf(STDERR, "OpenBLAS blas_thread_init: pthread_create failed for thread %ld of %d: %s\\n", i+1,blas_num_threads,msg);
        fprintf(STDERR, "OpenBLAS blas_thread_init: ensure that your address space and process count limits are big enough (ulimit -a)\\n");
        fprintf(STDERR, "OpenBLAS blas_thread_init: or set a smaller OPENBLAS_NUM_THREADS to fit into what you have available\\n");
#ifndef __EMSCRIPTEN__
        struct rlimit rlim;
#ifdef RLIMIT_NPROC
        if(0 == getrlimit(RLIMIT_NPROC, &rlim)) {
          fprintf(STDERR, "OpenBLAS blas_thread_init: RLIMIT_NPROC "
                  "%ld current, %ld max\\n", (long)(rlim.rlim_cur), (long)(rlim.rlim_max));
        }
#endif
        if(0 != raise(SIGINT)) {
          fprintf(STDERR, "OpenBLAS blas_thread_init: calling exit(3)\\n");
          exit(EXIT_FAILURE);
        }
#else
        /* ★ __EMSCRIPTEN__：见本文件头。失败路径直接 exit（与上面 raise 失败的分支一致）。 */
        exit(EXIT_FAILURE);
#endif
      }
'''
        s = s[:i] + new + s[j:]
        n += 1

    if n == 0:
        print("已经打过补丁（0 处命中）—— 幂等，不改动")
        return 0
    open(p, "w", encoding="utf-8").write(s)
    print("补丁点命中 %d 处 ⇒ %s" % (n, p))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
