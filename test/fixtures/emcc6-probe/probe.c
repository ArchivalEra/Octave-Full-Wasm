/* emcc 5.0.7 vs 6.0.10 纯工具链对比探针（IllegalPerformance 线，2026-10-04）
 * 面：① dgemm_naive 384³（纯 codegen/依赖链）② qsort 2^20（libc 排序）
 * ③ memcpy 32MB×8（mem 路径）④ 字节求和 64KB×64（byte-loop codegen）
 * 变体差异只在编译器，源两版共用。node 计时，交错 3 轮。 */
#include <math.h>
#include <stdlib.h>
#include <string.h>

#define K 384
#define SN (1 << 20)
#define BUFB (1 << 16)
static double A[K * K], B[K * K], C[K * K];
static double S[SN];
static char sb1[BUFB], sb2[BUFB];

static int cmp_dbl(const void *a, const void *b) {
  double x = *(const double *)a, y = *(const double *)b;
  return (x > y) - (x < y);
}

__attribute__((export_name("init"))) void init(void) {
  for (int i = 0; i < K * K; i++) { A[i] = (i % 7) * 0.5 - 1.0; B[i] = (i % 11) * 0.25; }
  for (int i = 0; i < SN; i++) S[i] = (double)((i * 2654435761u) & 0xFFFFF) / 8.0;
  for (int i = 0; i < BUFB - 1; i++) sb1[i] = (char)('a' + (i * 7) % 26);
  memcpy(sb2, sb1, BUFB);
}

__attribute__((export_name("dgemm"))) double dgemm(int reps) {
  double s = 0;
  for (int r = 0; r < reps; r++)
    for (int i = 0; i < K; i++)
      for (int j = 0; j < K; j++) {
        double acc = 0;
        for (int k = 0; k < K; k++) acc += A[i * K + k] * B[k * K + j];
        C[i * K + j] = acc; s += acc;
      }
  return s;
}

__attribute__((export_name("sortit"))) double sortit(int reps) {
  double s = 0;
  for (int r = 0; r < reps; r++) {
    qsort(S, SN, sizeof(double), cmp_dbl);
    s += S[0] + S[SN - 1];
  }
  return s;
}

__attribute__((export_name("memcpyb"))) double memcpyb(int reps) {
  static char *dst;
  double s = 0;
  if (!dst) dst = (char *)malloc(32u << 20);
  for (int r = 0; r < reps * 8; r++) { memcpy(dst, sb1, BUFB); s += dst[0]; }
  (void)sizeof(sb2);
  return s;
}

__attribute__((export_name("bytesum"))) double bytesum(int reps) {
  double s = 0;
  for (int r = 0; r < reps * 64; r++)
    for (int i = 0; i < BUFB; i++) s += (unsigned char)sb1[i];
  return s;
}
