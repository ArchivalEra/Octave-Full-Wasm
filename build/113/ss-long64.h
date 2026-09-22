/* 强制 SuiteSparse_long 为 64 位（wasm32 修正）
 *
 * 为什么需要：
 *   SuiteSparse_config.h 在非 Windows 上把 SuiteSparse_long 定义成 `long`，
 *   而 **wasm32 上 `long` 是 32 位**（x86-64 上是 64 位），
 *   与 Octave 的 octave_idx_type（64 位）尺寸不一致 → 稀疏 lu 调 UMFPACK 时
 *   ABI 错配 → 运行时 `RuntimeError: unreachable`（整个页面 trap）。
 *   证据：Octave 的 config.h 里
 *     "SuiteSparse_long and octave_idx_type have same size" 未被定义。
 *
 * 为什么做成 `-include` 的小头文件而不是 `-D`：
 *   `-DSuiteSparse_long=long long` 里的**空格会被 shell 按词拆开**，
 *   clang 会把 `long` 当成文件名（实测报 "no such file or directory: 'long'"）。
 *   用 -include 就没有引号/空格问题。
 *
 * 注意必须**四个名字都给**：SuiteSparse_config.h 里那个 `#ifndef SuiteSparse_long`
 * 块一旦被我们抢先定义就整块跳过，而它同时定义 _max/_idd/_id。
 * 漏 _id 时 CCOLAMD 的 `#define ID SuiteSparse_long_id` 展开为空 → "expected ')'"。
 */
#define SuiteSparse_long long long
#define SuiteSparse_long_max 9223372036854775801LL
#define SuiteSparse_long_idd "lld"
#define SuiteSparse_long_id "%lld"
