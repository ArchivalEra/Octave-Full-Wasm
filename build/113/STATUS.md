# build/113 · P0 阶段记录（Octave 11.3.0 → wasm）

> ⚠️ **这是 P0 阶段的历史记录，不是当前状态。** 当前状态看 **`HANDOFF.md` §10**
> （第四轮已全部落地：8761 已服务 11.3.0，26 套 646 项全绿）。
>
> 保留它的理由是里面有几条**至今仍有用的一手实测结论**：libf2c 的 `QINT` 组为何必须
> 排除、LAPACK 被 f2c 拒编的 30 个文件为何可接受、以及 `emconfigure` 下 `PKG_CONFIG`
> 为空导致 pcre2 探测假失败的根因。
> **下面"未验证 / P0 续 / 下一步"三节已改成结果对照，别再当待办执行。**

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

## 当年"未验证"的 5 条 —— **结果对照（已全部有答案）**

| # | 当年标记 | 结果 |
|---|---|---|
| 1 | Octave 11.3.0 还没 configure / make 过 | ✅ 已 configure + make + 重链，8761 现在跑的就是它 |
| 2 | 补丁 → configure 只是参数备好、未执行 | ✅ `apply-platform-patches.sh` 的 4 处改动 + configure 均已跑通 |
| 3 | `.oct` side module 在 emsdk 5.0.7 上能否装载（**最大不确定性**） | ✅ **能**。`probe-side-module.sh` 得 43；dldfcn 也走官方 dlopen，`exist=3` |
| 4 | freetype 未构建 | ⏳ **仍缺**。数值/plot 桥不受影响；但它让 `axes` 创建时打一次 FreeType 警告、`help`/`print` 的文本路径受限。**图形线（`graphics-osmesa` 分支）要处理** |
| 5 | 三条闸门一条未过 | ✅ **三条全过**（能编能跑数值对 / `.oct` 可用 / **免 COI**，`shared:true` 1→0） |

## P0 续：configure 卡在 pcre2 —— 根因已定位（2026-09-21 收尾时）


### 已走到的步骤

解包 `/src/work/octave-11.3.0` → 跑 `apply-platform-patches.sh`（**改动 4 处，容器内复核
4/4 落地**）→ 跑 `configure-113.sh`。configure 走完全程，只在最后一步失败。

### 确切错误（原文）

```
checking for pcre2.h... yes
checking for pcre2_compile_8 in -lpcre2... no
checking for pcre.h... no
checking for pcre/pcre.h... no
configure: error: to build Octave, you must have the PCRE or PCRE2 library and header files installed
```

**有迷惑性**：头文件明明找到了（`pcre2.h... yes`），错误却说「缺库和头」。

### 根因（读 `configure` 源码 + 实测确认）

`configure` 第 94136 行起那段的分支是：

```sh
yes | "")
  ac_octave_pcre2_pkg_check=yes
  PCRE2_LIBS="-lpcre2"          # ← 默认先给 -lpcre2
...
if test $ac_octave_pcre2_pkg_check = yes; then
  if test -n "$PKG_CONFIG" && \
     $PKG_CONFIG --exists --print-errors "libpcre2-8"; then    # ← 关键
```

**`emconfigure` 之下 `$PKG_CONFIG` 是空的**（实测：`emconfigure bash -c 'echo $PKG_CONFIG'`
输出空行）→ `test -n "$PKG_CONFIG"` 为**假** → 整个 pkg-config 分支被跳过 →
落到 `-lpcre2` 回退 → 我们装的是 `libpcre2-8.a`，没有 `libpcre2.a` → 失败。

所以**不是 pcre2 没装好**：pkg-config 手工查得到（`pkg-config --libs libpcre2-8` →
`-L/usr/local/lib -lpcre2-8`），`libpcre2-8.pc` 也在 `/usr/local/lib/pkgconfig/`。
**唯一的缺口是 `PKG_CONFIG` 变量没被设上。**

（Edge-Tools 的 Dockerfile 设了 `PKG_CONFIG_PATH` 与 `EM_PKG_CONFIG_PATH` 两个，
但那是给 pkg-config 找 `.pc` 用的；`PKG_CONFIG` 这个变量本身他们也没显式设——
他们能过是因为用的**不是** emconfigure 包装过的 pkg-config，或者他们的
`PKG_CONFIG` 非空。我们这边实测是空的。）

### 修法（**两条都已实施**，见 `configure-113-full.sh`）

在 `configure-113.sh` 里加一行：

```sh
export PKG_CONFIG=/usr/bin/pkg-config
```

若仍不过，次选：显式传库名，绕开探测——
`--with-pcre2=-lpcre2-8`（`configure` 里 `-*` 分支会把它直接当 `PCRE2_LIBS`）。

**结果**：`configure-113-full.sh` 现在**两条都在**（`export PKG_CONFIG=/usr/bin/pkg-config`
+ `--with-pcre2=-lpcre2-8`），configure 已多次跑通。**这条坑的通用教训**：
`emconfigure` 下 `$PKG_CONFIG` 是空的 → 所有"先试 pkg-config、失败再回退"的探测
都会走错分支。遇到"头文件明明找到了却报缺库"这类自相矛盾的报错，先查 `PKG_CONFIG`。

## 下一步（P0 续）—— 已被后续轮次取代

```bash
# 容器内
export PATH=/src/bin:$PATH
# 1) 先验证 pcre2 的修法
export PKG_CONFIG=/usr/bin/pkg-config
bash /src/bin/configure-113.sh
# 2) configure 过了再 make（Edge-Tools 用 emmake make EXEEXT=.mjs）
```

> **上面的流程已被 11.3.0 车道的正式配方取代**：重配/重链是
> `build/113/configure-113-full.sh` + `build/113/link-web.sh`。
> 断电恢复一条命令：`sh build/recover.sh`（8761）/ `sh build/recover-113.sh`（8762）。

**注意两条**：
- 构建目录路径必须逐字固定（绝对 `-I` 进 ccache 的 hash；实测见 `BASELINE-11.3.md` §7.1），
  否则缓存整片失效。
- `make` 之后才轮到三条闸门；`DLDFCN_LIBS=` 与 `MAIN_MODULE=1` 是闸门二（`.oct` 车道）
  的关键，Edge-Tools 那条路线**没有**这部分，要我们自己接。

