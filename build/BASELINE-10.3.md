# 10.3 基线：外部事实核查（2026-09-21）

> 本文只记**实测/实读**得到的事实，用来支撑「换基线」的决策。
> 不写推断；每条都给出可取回的原始位置。

---

## 1. GNU 官方有没有 wasm？

| 查证项 | 结果 |
|---|---|
| octave.org 主页 / 下载页 / news | **无任何 wasm / WebAssembly 字样** |
| upstream `release-10-3-0` 的 `configure.ac`（116885 字节） | `wasm` / `emscripten` / `WebAssembly` **出现 0 次** |
| `octave.org/wasm`、`octave.org/web`、`wasm.octave.org` | 404 / 不可达 |
| 最新稳定版 | **11.3.0** |

**结论：GNU 官方主体没有 wasm 构建，也没有 wasm 支持代码。**
10.3.0 的 wasm 能力来自**社区封装**（emscripten-forge recipe + 定制 LLVM），不是 GNU 发布物。

## 2. 真正可用的 10.3.0 wasm recipe（**这是我们要的东西**）

位置：`github.com/emscripten-forge/recipes` → `recipes/recipes_emscripten/octave/`

- `recipe.yaml`：`version: 10.3.0`，源 `https://ftp.gnu.org/gnu/octave/octave-10.3.0.tar.gz`
  （sha256 `2fcb38dc062e440f1e06c069bbca840ed46dcc8f983e473e1558fcc38384ee6b`）
- **19 个 patch**（`patches/0001..0019`），名字本身就是一张"踩坑地图"：
  ```
  0001 Add-emscripten-platform-support
  0002 Fix-weird-nesting
  0003 Disable-threads
  0004 Custom-link-octave-cli
  0005 Remove-rpath
  0006 Assume-little-endian
  0007 MAYBE-Set-SIDE_MODULE-to-1
  0008 Set-octave-cli-flags
  0009 Fix-Fortran-calling-convention
  0010 Remove-redundant-headers
  0011 Fix-duplicate-convert_enum-error
  0012 Return-void-from-xerbla
  0013 Add-emscripten-mutex
  0014 Disable-path-modifications
  0015 Disable-multithreading
  0016 Disable-gui-calls-and-threading
  0017 Adapt-signal-wrappers
  0018 FIXME-abort-calls-native-code-failure
  0019 FIXME-memory-leaks
  ```

### 工具链（`build.sh`）

```sh
# 定制 LLVM 20.1.7（含 Fortran common symbol 补丁），从 GitHub release 取 tar
LLVM_PKG="llvm_emscripten-wasm32-20.1.7-h2e33cc4_5.tar.bz2"
#   github.com/IsabelParedes/llvm-project/releases/download/v20.1.7_emscripten-wasm32/
export FC=F77=F90=F95=F18=flang
export FFLAGS="-fPIC --target=wasm32-unknown-emscripten"
export FLIBS="-lFortranRuntime"
export CFLAGS="-O2 -g0 -fPIC -fwasm-exceptions"
export LDFLAGS="-fPIC -L$PREFIX/lib -fwasm-exceptions"
```

**要点：Fortran 走真的 Flang，不是 f2c。** 本项目 7.2 用的是 f2c 翻译路线
（`libf2c2-20130926` + `normalize_arpack.py`），那条路的整类问题（f2c 的
`void`/`int` 声明不匹配、公共块重复定义）在 Flang 下不存在。

### 链接模型（**与我们一致**）

```sh
export SH_LDFLAGS="-sSIDE_MODULE=1"
export DL_LDFLAGS="-sSIDE_MODULE=1"
export MKOCTFILE_DL_LDFLAGS="-sSIDE_MODULE=1"
export OCTAVE_CLI_LTLDFLAGS="-sMAIN_MODULE=1 -sALLOW_MEMORY_GROWTH=1 \
    -lFortranRuntime -lFortranDecimal -lpcre2-8 -lblas -llapack -lfreetype"
```

→ **主模块 `MAIN_MODULE=1`、`.oct` 走 `SIDE_MODULE=1`**，与本项目批次 1d/13
建立的架构**相同**。这意味着我们的 `.oct` 资产懒加载车道在 10.3 上大概率可直接续用
（`.oct` 本身要按 10.3 头文件重编）。

### **他们关掉了哪些库（最关键的一节）**

```
--without-amd --without-camd --without-colamd --without-ccolamd
--without-cholmod --without-klu --without-umfpack --without-spqr
--without-suitesparseconfig --without-cxsparse
--without-fftw3 --without-fftw3f
--without-glpk --without-hdf5 --without-curl --without-qhull_r
--without-qrupdate --without-opengl
--disable-threads --disable-readline --disable-docs
--without-qt --without-framework-carbon --without-framework-opengl
```

**他们保留的**：`libblas`/`liblapack`(≥3.12)、`pcre2`(≥10.43)、`freetype`、
**`imagemagick < 7.0.0`**、`bzip2`/`libtiff`/`libpng`/`zlib`/`libjpeg-turbo`/`libxml2`/`openjpeg`。

**这对我们意味着什么（决策枢纽）**：

| 能力 | 本项目 7.2（已实测通过） | emscripten-forge 10.3 |
|---|---|---|
| `eigs`（ARPACK） | ✅ 残差 1e-14 | ❌ 未涉及 |
| `glpk` 线性规划 | ✅ | ❌ `--without-glpk` |
| `delaunay`/`convhulln`（Qhull） | ✅ | ❌ `--without-qhull_r` |
| `fft` 走 FFTW | ✅（双+单精度） | ❌ `--without-fftw3` |
| `qr` 稀疏 / CXSparse | ✅ | ❌ `--without-cxsparse` |
| SuiteSparse 系 | 部分 | ❌ 全关 |
| `save/load -hdf5` | ✅ | ❌ `--without-hdf5` |
| `urlread`/`webread` | ✅（同步 XHR） | ❌ `--without-curl` |
| 图像 I/O | ✅ stb_image | ✅ ImageMagick |
| 多线程 | 单线程 | 单线程 |

**结论：我们补的 C 库长尾，正是他们没有的。换基线的价值不在"白拿一个 10.3"，
而在于"把他们的 10.3 工具链 + 我们的长尾拼起来"。**

### 产物形态

`tests.package_contents` 要求：
```
lib/octave/10.3.0/liboctave.so
lib/octave/10.3.0/liboctinterp.so
lib/octave/10.3.0/liboctmex.so
bin/octave-cli.wasm
```
并以 `node ${PREFIX}/bin/octave-cli --version` 做冒烟。

**注意：它是 `octave-cli` 形态（Node/CLI），不是给静态站点直接 `Module.eval_string` 的
`octave.wasm + octave.js`。** 浏览器侧他们走 Xeus-Octave（JupyterLite 的 WebWorker kernel）。
所以：

- **值得拿的是 recipe / patch / 工具链**；
- **不必跟着换成 JupyterLite**——我们的静态站点 + `Module.eval_string` 接口是自己的资产。

---

## 3. 另一条独立证据：`Edge-Tools/octave-wasm`（edgetools.io）

`github.com/Edge-Tools/octave-wasm`，描述 *"Corresponding Source for octave
(GPL-3.0-or-later)"* —— 是 **edgetools.io** 那个产品的 GPL 合规源镜像。
它构建的是 **Octave 11.1.0**（`ftp.gnu.org/gnu/octave/octave-11.1.0.tar.xz`），
依赖 CLAPACK/LAPACK 3.1.1、PCRE2 10.45、FreeType 2.14.3、GLU 9.0.3。

其 `build/MILESTONE-2.md`（**读原文**）明确记录了图形路线的结局：

- **Milestone 1（headless 数值）已完成并上线。**
- **Milestone 2（浏览器画图）阻塞**。他们走的是"用 Octave 自己的
  `opengl_renderer`（`gl-render.cc`）+ Emscripten `LEGACY_GL_EMULATION`"，
  在真 `<canvas>` 里死在：
  > `numVertices must be an integer` at `glEnd` —— emscripten 的立即模式模拟
  > 无法复现 Octave 的 `glBegin/glVertex/glEnd` 顶点模式

  并引用了 emscripten 自己的运行期警告：
  > *"a collection of limited workarounds, do not expect it to work."*
- 他们给的推荐路线是 **OSMesa**（Mesa 软件光栅化，把完整 OpenGL 渲进内存缓冲）。

### 他们踩到、而我们**没有**中招的一个静默 bug

`build/scripts/build-lapack.sh`：libf2c 的 `s_cat`/`s_copy` 在 `f2c.h` 里声明返回
`int`、实现是 `void`；wasm 严格类型在这种不匹配调用上 trap。**这曾静默破坏 `inv()`。**
他们的修法是把真实现改名（`-Ds_cat=octave_wasm_s_cat_impl`）+ 加 int 包装垫片。

**本项目核对结果（已实测）**：我们的 `libf2c2-20130926/s_cat.c` 定义**没有显式返回类型**
（隐式 int），与调用方期待一致 → **不存在该不匹配**。数值对照（本机 Octave 11.3 为基准）：

| 检查 | 浏览器 | 本机 |
|---|---|---|
| `inv` 残差 | **5.139e-16** | 5.139e-16（逐位相同）|
| `det` / `eig` | 1 | 1 |
| `norm(x,'inf')` CHARACTER 参数 | 5 | 5 |
| `lu(...,'vector')` / `qr(...,0)` | 1 | 1 |

---

## 4. 结论（三条，供决策）

1. **没有"官方 wasm Octave"**。10.3.0 的 wasm 是社区封装；`octave.org` 与 upstream
   源码均无 wasm。**我们不会被官方版本取代。**
2. **10.3.0 的 wasm recipe 真实可用**（19 patch + 定制 Flang），且**架构与我们兼容**
   （MAIN_MODULE=1 + SIDE_MODULE=1）。它是**换基线的抓手**。
3. **它的能力面比我们窄**（长尾库几乎全关、图形为零）。所以换基线**不是**"换成别人的东西"，
   而是"取它的工具链与平台 patch，叠加我们的长尾与宿主层"。

**图形路线的独立结论**：两支外部团队（edgetools、emscripten-forge）都**没有**做出
浏览器内图形——edgetools 明确撞墙并推荐 OSMesa。**OSMesa 是"真正完整"的唯一可信路径**，
我们的 plot 桥是过渡期的可靠方案。
