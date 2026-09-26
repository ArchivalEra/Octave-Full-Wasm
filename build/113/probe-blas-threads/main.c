// Octave-Full-Wasm — 线程版 BLAS 的**缩放探针**（2026-09-26）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 回答的问题：**"线程档到底能让数学快多少"** —— 在**不**碰 Octave、不翻闸门③的前提下，
// 用一个最小 wasm 程序直接测 OpenBLAS（线程版）的 DGEMM 随线程数的缩放。
//
// 为什么必须单独立这个探针（而不是等 B6）：
//   · `E2`（OpenBLAS 链进 Octave）卡在 binaryen 的 76 个 `signature_mismatch` 悬案上 ——
//     那是**链进 Octave 主模块**这一步的问题，与"线程 BLAS 本身有多快"无关；
//   · 而"要不要为多线程翻闸门③"这个取舍，缺的正是这个数：
//     现在的 refblas/lapack 是 f2c 出来的**标量**代码 ⇒ 光有运行时线程**一分钱买不到**。
//
// 口径（别改，改了两边不可比）：
//   N ∈ {512, 1024, 2000}，T ∈ {1, 2, 4, 8}；列主序 CblasNoTrans（标准 BLAS 布局，无转置惩罚）；
//   每个 (N,T) 先跑 1 次热身、再取 **3 次里最快的**（wasm 里首次调用含惰性初始化）；
//   GFLOPS = 2N³/t。矩阵填 [0,1) 的确定性伪随机（避免次正规数拖慢）。
//
// 输出：每行 `BLAS N=<n> T=<t> ms=<..> gflops=<..>`，最后一行 `BLAS DONE`
//       （runner 按这个契约解析；也把同样的 JSON 放进 `window.__blasResult`）
#include <emscripten.h>
#include <stdio.h>
#include <stdlib.h>

/* OpenBLAS 的两个入口（自己声明，省掉头文件的版本差异）：
   · cblas_dgemm —— 干净的 C 接口（Fortran 接口在本容器里是 f2c 口径，字符长度参数易踩）
   · openblas_set_num_threads —— 控制线程数（**单线程版里它是无害空操作** ⇒ 同一份探针
     也能对非线程版跑出"T 变大但数字不动"的对照）*/
extern void cblas_dgemm(int Order, int TransA, int TransB, int M, int N, int K,
                        double alpha, const double* A, int lda,
                        const double* B, int ldb, double beta, double* C, int ldc);
extern void openblas_set_num_threads(int n);
extern int openblas_get_num_threads(void);

#define ORDER_COL 102  /* CblasColMajor */
#define NO_TRANS 111   /* CblasNoTrans  */

static double now_s(void) { return emscripten_get_now() / 1000.0; }

static void fill(double* p, size_t n, unsigned seed) {
  unsigned s = seed;
  for (size_t i = 0; i < n; i++) {
    s = s * 1103515245u + 12345u;
    p[i] = (double)((s >> 8) & 0xFFFF) / 65536.0;
  }
}

int main(void) {
  /* ★ 必须**在**任何 BLAS 调用之前把默认线程数压到 1（否则起不来，实测）：
     OpenBLAS 的默认线程数是编译期烘进去的 `-DMAX_CPU_NUMBER=<nproc>`（本机 24）⇒
     它一上来就要 24 个 pthread worker；池不够时 pthread_create 失败 ⇒ 走"起不来"分支
     ⇒ 整个程序 exit（实测报错：`blas_thread_init: pthread_create failed for thread 13 of 24`）。
     线程数随后由每个格子显式 `openblas_set_num_threads(T)` 拉起。
     ⚠️ 别用 `-sENV=...`：emcc 5.0.7 里**没有**这个设置项（实测报 "non-existent setting: 'ENV'"）。 */
  setenv("OPENBLAS_NUM_THREADS", "1", 1);
  const int Ns[] = {512, 1024, 2000};
  const int Ts[] = {1, 2, 4, 8};
  const int REP = 3;
  char buf[256];

  emscripten_run_script("console.log('BLAS START');");
  for (size_t ni = 0; ni < sizeof(Ns) / sizeof(Ns[0]); ni++) {
    int N = Ns[ni];
    double* a = (double*)malloc((size_t)N * N * sizeof(double));
    double* b = (double*)malloc((size_t)N * N * sizeof(double));
    double* c = (double*)malloc((size_t)N * N * sizeof(double));
    if (!a || !b || !c) { printf("BLAS FATAL malloc N=%d\n", N); return 1; }
    fill(a, (size_t)N * N, 12345u + (unsigned)N);
    fill(b, (size_t)N * N, 999u + (unsigned)N);
    for (size_t ti = 0; ti < sizeof(Ts) / sizeof(Ts[0]); ti++) {
      int T = Ts[ti];
      openblas_set_num_threads(T);
      /* 热身（首次调用含惰性初始化，不计入） */
      cblas_dgemm(ORDER_COL, NO_TRANS, NO_TRANS, N, N, N, 1.0, a, N, b, N, 0.0, c, N);
      double best = 1e30;
      for (int r = 0; r < REP; r++) {
        double t0 = now_s();
        cblas_dgemm(ORDER_COL, NO_TRANS, NO_TRANS, N, N, N, 1.0, a, N, b, N, 0.0, c, N);
        double ms = (now_s() - t0) * 1000.0;
        if (ms < best) best = ms;
      }
      double gflops = (2.0 * (double)N * N * N) / (best / 1000.0) / 1e9;
      int rc = snprintf(buf, sizeof buf, "BLAS N=%d T=%d ms=%.1f gflops=%.2f", N, T, best, gflops);
      printf("%s\n", buf);
      fflush(stdout);
    }
    free(a); free(b); free(c);
  }
  printf("BLAS DONE threads_report=%d\n", openblas_get_num_threads());
  fflush(stdout);
  emscripten_run_script("window.__blasDone = true;");
  return 0;
}
