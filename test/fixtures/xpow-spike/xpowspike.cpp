// xpow-driver spike（工单 63 收口 / 候选④）：模型化 Octave elem_xpow 的**驱动循环形状**
// ——每元素 octave_quit()（noinline、读 volatile 标志）+ 逐元素访问，对照 Rust 紧循环。
// 两者调**同一个 libm pow**（wasm64 下都是 Emscripten libm），差 = 驱动开销。
#include <cmath>
#include <cstdint>

// 模型化 octave_interrupt_state（volatile 读，非原子是刻意的——octave_quit 就是这形状）
static volatile int g_quit = 0;

extern "C" void xs_set_quit(int v) { g_quit = v; }
extern "C" int  xs_get_quit(void)    { return g_quit; }

// octave_quit()：noinline 调用 + volatile 读 + 分支（真实版非零则调 handler 抛异常）
__attribute__((noinline)) static int quit_check(void) { return g_quit != 0; }

// base：**忠实**模型 elem_xpow(Matrix,double)，含前置的 any_element_is_negative 全扫
//   （真实源码：先判负决定走实数/复数路径，再逐元素 octave_quit()+std::pow）。
extern "C" void __attribute__((used))
xpow_base(const double *a, double *out, long long n, double b)
{
  int neg = 0;
  for (long long i = 0; i < n; i++)
    if (a[i] < 0.0) { neg = 1; break; }     // any_element_is_negative
  if (neg) return;                           // 复数路径（本负载不会走）
  for (long long i = 0; i < n; i++)
    {
      if (quit_check ()) return;             // octave_quit()
      out[i] = std::pow (a[i], b);
    }
}

// 纯驱动成本探针（无 pow）：量「octave_quit + 逐元素索引」的绝对上限——
// 这是候选④能省的**全部**（pow 换成什么都不变）。
extern "C" double __attribute__((used))
xpow_driver_only(const double *a, double *out, long long n)
{
  double s = 0.0;
  for (long long i = 0; i < n; i++)
    {
      if (quit_check ()) break;              // octave_quit()
      out[i] = a[i];                         // 索引写（无 pow）
      s += a[i];
    }
  return s;
}

// G6 原型：base 的 batched 变体——每 `every` 元素查一次 quit 标志；
// 返回「看到标志时已处理到的索引」（= 延迟上界，元素数）。
extern "C" long long __attribute__((used))
xpow_base_batched(const double *a, double *out, long long n, double b, long long every)
{
  long long cnt = 0;
  for (long long i = 0; i < n; i++)
    {
      if (every > 0 && ++cnt >= every)
        {
          cnt = 0;
          if (quit_check ()) return i;
        }
      out[i] = std::pow (a[i], b);
    }
  return n;
}
