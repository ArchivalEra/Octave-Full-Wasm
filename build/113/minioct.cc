// miniprobe：验证「真 .oct」这条链的最小组件
//
// 为什么需要它（这一步的定位）：
//   之前只验证过「两个平凡 wasm 之间能 dlopen」，那证明的是 Emscripten 的机制。
//   没有验证过的是：**由本树头文件编译、导出 DEFUN_DLD、走 Octave 的真正 .oct
//   ABI** 的模块，能否被主模块装载并正确调用。
//   后续所有「按需加载的能力」都建立在后者之上，所以先用最小成本把它验掉。
//
// 做成"非平凡"是刻意的：
//   1. 用 DEFUN_DLD（Octave 的插件入口宏），而不是裸函数——这才走真正的注册路径；
//   2. 接受一个矩阵参数并调用 `Matrix::determinant()`——那会回调**主模块里的
//      LAPACK**（dgetrf/det 等），因此这一条同时验证了
//      「side module 能否解析到主模块导出的数值符号」；
//   3. 反复调用（由测试侧驱动）以验证不是"一次性侥幸"。
//
// 编译方式见 build/113/build-minioct.sh：-sSIDE_MODULE=1 -fPIC -shared，且
// **不链任何库**——所有符号都在装载时由主模块解析。
// 异常模式必须与主模块一致（本树用 -fexceptions，不是 -fwasm-exceptions）。

#include <octave/oct.h>

DEFUN_DLD (miniprobe, args, nargout,
           "miniprobe (A) - 最小真实 .oct 探针。\n"
           "\n"
           "返回 A 的行列式（要求 A 为方阵）。它的作用是验证 .oct 的装载与 ABI，\n"
           "而不是提供任何有用的功能。")
{
  if (args.length () != 1)
    error ("miniprobe: exactly one argument required");

  const octave_value& a = args(0);
  if (! a.is_matrix_type ())
    error ("miniprobe: argument must be a numeric matrix");

  Matrix m = a.matrix_value ();
  if (m.rows () != m.columns ())
    error ("miniprobe: matrix must be square");

  octave_value_list retval (nargout > 0 ? nargout : 0);
  if (nargout > 0)
    {
      // 这一行会走到主模块里的 LAPACK：是「side module → 主模块符号解析」的实证。
      // 注意 `Matrix::determinant()` 返回的是 `DET`（base_det<T>），
      // **不能直接 octave_value(det)**——那样是歧义转换（实测报
      // "ambiguous conversion for functional-style cast"），要显式取 .value()。
      DET d = m.determinant ();
      retval(0) = octave_value (d.value ());
    }
  return retval;
}
