# build/113 · P0 进展与结论（Octave 11.3.0 → wasm）

> 只记**实测**结果；未跑完的明确写"未验证"。
> 事实依据与出处见 `build/BASELINE-11.3.md`。

## 环境（已完成）

- 容器 **`o113`**：基底 `emscripten/emsdk:5.0.7`（Ubuntu 24.04）
  - **emcc 5.0.7**、node v22.16.0、cmake 3.28.3
  - **ccache 4.9.1**、**meson 1.3.2**、ninja 1.11.1、**f2c 20200916**、gcc/g++ 13.3.0
  - 挂载：`/ccache`（宿主持久缓存）、`/src/third_party:ro`（复用 7.2 的源码）、
    `/src/probe11:ro`（11.3.0 tarball）
  - 检查点镜像：**`octave-build:o113-base`**
- 宿主（Debian sid）：meson 1.12.0 / ccache 4.13.6 / ninja 1.13.2

## 脚本（已提交，均离线实测过）

| 脚本 | 作用 | 实测 |
|---|---|---|
| `build/113/apply-platform-patches.sh` | Edge-Tools 那 5 处平台补丁 | 干净树改动 4 处、幂等、图形可选、失败路径 rc=2 且树未污染 |
| `build/113/emf77` | `.f --f2c--> .c --emcc--> wasm` | 经它编出 libf2c/BLAS/LAPACK |
| `build/113/build-deps.sh` | libf2c / pcre2 / BLAS / LAPACK | libf2c ✅、pcre2 ✅、BLAS ✅、LAPACK ✅（见下） |

## 依赖构建结果（已完成）

在 `o113` 内跑 `build-deps.sh`，装到 `/usr/local`：

| 产物 | 体积 | 符号自检 |
|---|---|---|
| `libf2c.a` | 190 KB | 1354 符号；`s_cat`/`s_copy`/`pow_dd`/`d_lg10` 在；**QINT 组按预期排除** |
| `librefblas.a` | 557 KB | `dgemm_` 在（BLAS 149 个 `.f`） |
| `liblapack.a` | 9.5 MB | `dgesv_` / `dlamch_` 在（SRC 1660 个 `.f`） |
| `libpcre2-8.a` | 416 KB | `pcre2_compile_8` 在 |

**整数 ABI**：`typedef int integer`（4 字节）。与 7.2 一致——
odld 里生成的 `f2c.h` 就是 `f2c.h0` 的逐字节副本，且 `INTEGER_STAR_8`
只出现在 `#ifdef` 与文档里，未启用。**不做 INTEGER_STAR_8。**

### 坑：`longint` 未定义导致 4 个文件编不过

`ftell64_.c` 用 `longint`，而 `longint` 只在 `#ifdef INTEGER_STAR_8` 下才
typedef → 默认配置下编不过。`pow_qq.c`/`qbitbits.c`/`qbitshft.c` 同组（libf2c 的
`QINT` 组，见其 `makefile.u:56`）。

**依据（实测，非推断）**：7.2 的 `libf2c.so` 里 `ftell64_`/`fseek64_`/`pow_qq_`/
`qbit_clear`/`qbit_set` **一个都没有**（源码 167 个 `.c` 只编了 156 个）——
当时就是跳过的。**不能靠 `-DINTEGER_STAR_8` 硬塞**：那会把它们的 ABI 变成
8 字节整数，与调用方 4 字节不一致，数值会静默错。

处置：显式跳过该组，并加**反向自检**——若这些符号意外出现就 FATAL
（意味着整数 ABI 可能不一致）。

### LAPACK 有 30 个文件被 f2c 拒编 —— 已核实为**可接受**，不是回归

被拒的是 `?rfsx`（专家驱动）×20、`?geqrt3` ×4、`?bbcsd`/`?orcsd`/`?uncsd`/`?gesdd` 家族。

**逐符号对照 7.2（`emnm` 读 odld 的 `libclapack.wasm`；注意 `nm` 读不了 wasm 对象，会全返 0）**：

| 符号 | 7.2 | 我们新构建 |
|---|---|---|
| `dgesdd_` `dgesv_` `dlamch_` | **T（已定义）** | **T** |
| `dgeqrt3_` | **U（仅引用）** | U |
| `dbbcsd_` `dorcsd_` `duncsd_` `dgerfsx_` | **不存在** | 不存在 |

**缺口完全一致。** 7.2 是能跑、19 套全绿的构建 → 这些缺失不构成问题。
机制：静态归档里**未被引用的成员不会被拉进链接**，其内部的未定义引用自然不参与解析。

## 未验证（不许当成已完成）

1. **Octave 11.3.0 本身还没 configure / make 过**——这是 P0 真正的闸门。
2. 打补丁 → configure 只是**参数已备好**，未执行。
3. `.oct` side module 在 emsdk 5.0.7 上能否装载（P0 闸门之二，最大不确定性）。
4. freetype 未构建（无头数值阶段可能不需要；P5 图形再说）。
5. 三条闸门一条未过。

## 下一步（P0 续）

```bash
# 容器内
export PATH=/src/bin:$PATH
tar xf /src/probe11/octave-11.3.0.tar.xz -C /src/work
bash /src/bin/apply-platform-patches.sh /src/work/octave-11.3.0
cd /src/work/octave-11.3.0   # 然后按 Edge-Tools 的开关 configure，
                             # 去掉 --without-x、加 --disable-threads
```

**注意 ccache**：构建目录路径必须逐字固定（绝对 `-I` 进 hash；实测见
`BASELINE-11.3.md` §7.1），否则缓存整片失效。
