/* libm-spike harness（工单 60）—— 与 Octave 元素循环同形态：对静态数组逐元素调
 * sin/exp/log/pow，返回校验和（防 DCE）。变体差异只在链接对象（覆盖与否），本文件
 * 两个变体共用。eval_* 供精度对拍（driver 拿 host 的 Math.* 当参考）。
 */
#include <math.h>

#define N (1 << 20)
static double A[N], B[N];   /* A ∈ [-3.1,3.1]（sin 域 / exp×100 / pow 指数扰动）；B ∈ (0,100]（log/pow 底） */

__attribute__((export_name("init"))) void init(void) {
  for (int i = 0; i < N; i++) {
    double u = (double)((i * 2654435761u) & 0xFFFFFF) / (double)0xFFFFFF;
    A[i] = -3.1 + 6.2 * u;
    B[i] = 0.01 + 99.99 * (double)((i * 40503u) & 0xFFFF) / 65535.0;
  }
}

__attribute__((export_name("bench_sin"))) double bench_sin(int reps) {
  double s = 0;
  for (int r = 0; r < reps; r++) for (int i = 0; i < N; i++) s += sin(A[i]);
  return s;
}
__attribute__((export_name("bench_exp"))) double bench_exp(int reps) {
  double s = 0;
  for (int r = 0; r < reps; r++) for (int i = 0; i < N; i++) s += exp(A[i] * 100.0); /* arg ∈ [-310,310] */
  return s;
}
__attribute__((export_name("bench_log"))) double bench_log(int reps) {
  double s = 0;
  for (int r = 0; r < reps; r++) for (int i = 0; i < N; i++) s += log(B[i]);
  return s;
}
__attribute__((export_name("bench_pow"))) double bench_pow(int reps) {
  double s = 0;
  for (int r = 0; r < reps; r++) for (int i = 0; i < N; i++) s += pow(B[i], 1.5 + A[i] / 10.0);
  return s;
}

/* 精度对拍用的单点求值（driver 对照 JS Math.*，跟踪最大相对误差） */
__attribute__((export_name("eval_sin"))) double eval_sin(double x) { return sin(x); }
__attribute__((export_name("eval_exp"))) double eval_exp(double x) { return exp(x); }
__attribute__((export_name("eval_log"))) double eval_log(double x) { return log(x); }
__attribute__((export_name("eval_pow"))) double eval_pow(double x, double y) { return pow(x, y); }
