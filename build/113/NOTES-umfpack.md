# UMFPACK 稀疏 lu 整页 trap —— 调查记录（含一个被实测证伪的假设）

> 诚实记录：本文件里的**假设已被证伪**，原因仍未查明。不要照着"索引宽度"那条去修。

## 现象（可复现）

| 调用 | 结果 |
|---|---|
| `lu(s)` 1 输出 / 2 输出 | OK |
| `lu(s)` 3 输出 / 4 输出 / 更大矩阵 / `lu(s,'vector')` | **`RuntimeError: unreachable`** —— wasm trap，**整个页面死掉** |

崩溃**特定于 UMFPACK** 路径（置换输出那条）。

## 处置（当前状态）

**关掉 UMFPACK**：`SKIP=umfpack bash build/113/configure-113-full.sh`，然后 clean 重编。
- 必须**显式 `--without-umfpack`**：仅仅不传 `--with-umfpack-*` 不够 ——
  SuiteSparse 的 prefix 已在 `CPPFLAGS/LDFLAGS` 的搜索路径里，configure 自己会找到它
  （实测：不传 `--with-umfpack-*` 时 `HAVE_UMFPACK` 仍是 1）。
- 关掉后错误变成：`error: support for UMFPACK was unavailable or disabled`。

**取舍**：带 UMFPACK → 整页 trap（不可接受）；不带 → 干净报错但功能没了。
当前选后者（**健壮性优先**），并如实记为一个**相对 7.2 的功能回退**
（7.2 的稀疏 lu 可用）—— **尚未解决**。

## ⚠️ 被证伪的假设（别再照它修）

**假设**：`SuiteSparse_long` 在 wasm32 上是 32 位（它被定义为 `long`），
而 Octave 的 `octave_idx_type` 是 64 位 → UMFPACK 调用的 ABI 错配 → trap。
"证据"看起来也很像：Octave 的 `config.h` 里两条
`SuiteSparse_long and octave_idx_type have same size` / `... and suitesparse_integer ...`
**都是 `#undef`**。

**实测证伪**：
```
$ grep OCTAVE_IDX_TYPE config.h
#define OCTAVE_IDX_TYPE int32_t          ← Octave 的索引是 **32 位**
```
而 **wasm32 上 `long` 就是 32 位** —— 所以两边**本来一致，没有错配**。
那两条 `#undef` 是**检测的假阴性**（测试程序编译失败即判 no），不是错配的证据。

**而且照着它改会真的制造出错配**：用 `-include ss-long64.h` 把
`SuiteSparse_long` 强改成 64 位后，重新 configure + 全量重编 + 重链，
`lu(3 输出)` **照样 trap**（此时两边反而真不一致了）。改动已全部撤回。

（顺带记下两个实测的小坑，将来若还要给 C 代码传带空格的宏定义：
`-DSuiteSparse_long=long long` 的空格会被 shell 拆词，clang 报
`no such file or directory: 'long'`；改用 `-include <小头文件>` 可绕开。
另外命令行定义 `SuiteSparse_long` 会让头里那个 `#ifndef` 整块跳过，
而该块同时定义 `_max`/`_idd`/`_id` 四个名字，漏一个就编不过 ——
漏 `_id` 时 CCOLAMD 报 `expected ')'`。）

## 下一步该往哪查（还没做）

不要再从"索引宽度"入手。几个更可能的方向：

1. **UMFPACK 5.4.0 自身在 wasm32/emsdk 5.0.7 上的已知问题**：例如它的
   内存对齐假设、`sizeof(size_t)` 相关代码、或 `SuiteSparse_long_id` 的 printf
   格式串在 wasm 下的行为。
2. **Octave 侧 `lo-umfpack.h` / `sparse-lu.cc` 的调用约定**：核对它调的是
   `umfpack_di_*`（32 位 int）还是 `umfpack_dl_*`（SuiteSparse_long），
   与我们 `libumfpack.a` 实际导出的符号是否一一对应。
3. **二分**：`SKIP=...` 已支持按选项名匹配，可以先只关 `cholmod` 或只关
   `umfpack` 观察崩溃是否随某库移动（注意 CHOLMOD 也依赖 UMFPACK 的部分符号）。
4. **最小复现**：在 wasm 里写一个只调 `umfpack_di_*` 的小程序，
   确认是"库本身在 wasm 上就不能用"还是"只有经由 Octave 才炸"。

## 对 baseline 的影响

- 其余 **11 条树内断言全部通过**（hdf5/fft/ifft/sparse qr/chol/inv/save -z/-v7/json/cholupdate）。
- `accept-113-boot` 10/10、`accept-113-oct` 8/8。
- **8761（7.2 基线）全程未动**。
- 稀疏 `lu` 三个以上输出：**当前不可用**，属已知回退。
