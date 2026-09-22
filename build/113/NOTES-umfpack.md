# UMFPACK 稀疏 lu 整页 trap —— 调查记录（**根因已查明**，附一个被证伪的假设）

> **✅ 根因（2026-09-22 查明）：少传了 `-DNBLAS` / `-DNSUPERNODAL`，于是 UMFPACK
> 去调 f2c 版 BLAS，ABI 错位踩内存 → trap。**
> 修法已落进 `build/113/build-libs.sh`（`UMFPACK_CONFIG="-DNBLAS"`、
> `CHOLMOD_CONFIG="-DNPARTITION -DNSUPERNODAL"`），并带"改了 config 就必须先删 .o"
> 的守卫。验证见下面「根因」一节。
>
> ⚠️ 本文件下半部分那个"索引宽度"的假设**仍然是被实测证伪的** —— 别照它修。
> 下面「现象 / 处置 / 下一步」几节保留为**当时的过程记录**，最后加一节写真相。

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
- 稀疏 `lu` 三个以上输出：**当时不可用，属已知回退**（换基线因此被卡住）——
  **已在下一节修好**。

---

## ✅ 根因与修法（2026-09-22 查明；本节推翻上面「下一步」里的方向 1/2）

### 一句话
**11.3.0 建 SuiteSparse 时漏传了 `-DNBLAS`（和 CHOLMOD 的 `-DNSUPERNODAL`），
于是 UMFPACK 去调本仓那套 f2c 转出来的 BLAS，ABI 错位踩内存 → wasm trap。**

### 为什么现象对得上
- `-DNBLAS` 的语义就是"**别用外部 BLAS**，UMFPACK 用它自带的内部实现"（会慢）。
- 只有 **3 输出/4 输出**的稀疏 `lu` 才真正走数值分解 → 才会碰 BLAS → 才炸；
  1/2 输出不分解，所以正常。
- 实测 `chol(s)`/`qr(s)`/`s\b` 都正常 —— 它们不走 UMFPACK 这条。
- **本仓的 BLAS 是 f2c 转的**（`BLAS="-lrefblas"`，lapack-3.4.2 经 emf77）。
  UMFPACK 的 C 代码按"标准 BLAS"的约定调 `dgemm_`/`dger_`/`dtrsv_`/`dtrsm_`，
  而 f2c 版这些例程用的是 f2c 的**隐藏长度（`ftnlen`）**约定 → 形参错位 →
  踩内存 → `unreachable`。这是"能编能链、一调就炸"的典型。

### 证据（不是推测，是跟 7.2 的成品源码树逐行 diff 出来的）
本仓 vendored 的 7.2 SuiteSparse 树
（`/mnt/hdd/octave-wasm-build/octave-wasm/third_party/suitesparse-5.4.0/`
`SuiteSparse_config/SuiteSparse_config.mk`）与干净 tar 包
（`suitesparse-full-5.4.0.tar.gz`）相比，**只有 3 处人工改动**：

| 行 | 7.2 vendored | 干净 tar 包 | 作用 |
|---|---|---|---|
| :269 | `UMFPACK_CONFIG ?= -DNBLAS` | `UMFPACK_CONFIG ?=`（空） | 别用外部 BLAS |
| :313 | `CHOLMOD_CONFIG ?= $(GPU_CONFIG) -DNPARTITION -DNSUPERNODAL` | `… $(GPU_CONFIG)`（只有空） | 别用 BLAS/LAPACK 的 supernodal 模块 |
| :476 | `SO_OPTS += -shared -Wl,-soname -Wl,$(SO_MAIN)` | 同前 + `-Wl,--no-undefined` | 编 `.so` 别要求符号全定义 |

⇒ **7.2 能用，正是因为它带着前两个补丁**；11.3.0 用了干净 tar 包，
只照抄了 `-DNPARTITION`，于是踩了 7.2 早就踩过、并且早已修掉的**同一个坑**。

### 库层面的验证（改完立刻可测，不用等全量重编）
重建 UMFPACK/CHOLMOD 后对比 `libumfpack.a` 的**未定义**符号集：

| | 未定义符号总数 | 其中 BLAS 族 |
|---|---|---|
| 11.3.0 **改之前** | 258 | **10**（`dgemm_ dgemv_ dger_ dtrsm_ dtrsv_ zgemm_ zgemv_ zgeru_ ztrsm_ ztrsv_`）|
| 11.3.0 **改之后** | 248 | **0** |
| 7.2 成品（对照） | 248 | 0 |

改后与 7.2 的差集只剩 `__indirect_function_table`（我们 `-fPIC` 才有）与
`log10`（我们由 libm 解析）—— 都是与本次问题无关的差异。

### 落地的改动
`build/113/build-libs.sh` 的 `do_suitesparse()`：
`UMFPACK_CONFIG="-DNBLAS"`、`CHOLMOD_CONFIG="-DNPARTITION -DNSUPERNODAL"`，
并在构建前 `rm -f UMFPACK/Lib/*.o CHOLMOD/Lib/*.o`（**改了 config 宏就必须先删旧对象**
—— SuiteSparse 的 make 不会因为"命令行多了个 -D"就重编，与 HANDOFF §10.3 坑 2 同源）。

