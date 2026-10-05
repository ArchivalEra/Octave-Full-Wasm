// xpow 驱动 spike 驱动（wasm64 模块）：同一模块内交错计时 base（octave 形状）vs cand（Rust 紧循环），
// 两者调同一个 libm pow。再测 G6 延迟（batched 每 E 元素查一次 quit）。
#include <cstdio>
#include <cstdlib>
#include <chrono>

extern "C" void     xpow_base(const double*, double*, long long, double);
extern "C" long long xpow_base_batched(const double*, double*, long long, double, long long);
extern "C" void     xpow_cand(const double*, double*, long long, double);
extern "C" long long xpow_cand_batched(const double*, double*, long long, double, const unsigned char*, long long);
extern "C" void     xs_set_quit(int);
extern "C" double   xpow_driver_only(const double*, double*, long long);

static double now_ms() {
  using namespace std::chrono;
  return duration<double, std::milli>(steady_clock::now().time_since_epoch()).count();
}

int main() {
  long long N = 2000000;           // 2e6，与 hotpath 负载一致
  double b = 0.7;
  double *a = (double*)malloc(sizeof(double)*N);
  double *o = (double*)malloc(sizeof(double)*N);
  if (!a || !o) { printf("OOM\n"); return 1; }
  for (long long i = 0; i < N; i++) a[i] = (double)i/N + 0.1;

  int R = 20;
  double tb = 1e18, tc = 1e18;
  // 交错 3 轮取 min（本机方差纪律）
  for (int r = 0; r < 3; r++) {
    double t0 = now_ms(); for (int k = 0; k < R; k++) xpow_base(a, o, N, b); double t1 = now_ms();
    double t2 = now_ms(); for (int k = 0; k < R; k++) xpow_cand(a, o, N, b); double t3 = now_ms();
    if (t1-t0 < tb) tb = t1-t0;
    if (t3-t2 < tc) tc = t3-t2;
  }
  printf("base=%.1fms cand=%.1fms ratio=%.3f\n", tb, tc, tc/tb);

  // G6：延迟上界测量（候选 = Rust batched）
  // quit 标志置位后，返回「看到标志时已处理到的索引」= 最大延迟元素数。
  unsigned char flag = 0;
  for (long long E : {1LL, 64LL, 256LL, 1024LL, 4096LL}) {
    flag = 0;
    // 先跑一段再置位：这里直接一次性调用，flag 从 0 开始 ⇒ 不会提前返回。
    // 测「从置位到看到」的上界：把 flag 置位后从 i=0 跑，期望返回 E-1（第一次检查点）。
    flag = 1;
    long long seen = xpow_cand_batched(a, o, N, b, &flag, E);
    printf("G6 cand every=%lld first_seen_index=%lld (latency<=%lld elems)\n", E, seen, E);
  }
  // base 的对比：base 每元素查 ⇒ 上界 1
  xs_set_quit(1);
  long long seenb = xpow_base_batched(a, o, N, b, 1);
  printf("G6 base every=1 first_seen_index=%lld\n", seenb);
  xs_set_quit(0);

  // 纯驱动成本（无 pow）：候选④能省的绝对上限
  double td = 1e18;
  for (int r = 0; r < 3; r++) {
    double t0 = now_ms(); for (int k = 0; k < R; k++) xpow_driver_only(a, o, N); double t1 = now_ms();
    if (t1-t0 < td) td = t1-t0;
  }
  printf("driver_only=%.1fms (base=%.1fms) => driver is %.1f%% of base, saving<=%.1f%%\n",
         td, tb, td*100.0/tb, td*100.0/tb);

  free(a); free(o);
  return 0;
}
