# 差距审计与需求书（2026-09-20）

> 本文有两个用途：
> 1. **审计**：离"完整版 Octave"还有多远——全部结论都带实测证据，不凭印象。
> 2. **需求单**：第 3 节的每条需求可直接交给外部检索模型（GPT 等）去搜罗方案，
>    每条自带背景、现状证据、硬约束、要搜的问题、验收标准。
>
> 读者不需要本仓上下文。

---

## 1. 现状（全部实测）

### 1.1 解释器核心：与上游 7.2.0 对齐

| 项 | 结果 | 证据 |
|---|---|---|
| 核心 `.m` 脚本 | **1029/1029，无缺口** | 上游 `release-7-2-0` 的 `scripts/**/*.m` = 1029（GitHub API 全树），本树 1030（多出的 1 个是自研 plot 桥垫片） |
| 内建函数源码 | 未见裁剪 | 本树 `libinterp/**/*.cc` = 427（上游 410；本地含构建期生成件），`DOCSTRINGS` 933 条 |
| **classdef** | **可用** | `inputParser()`（含 `Results` 属性）、`containers.Map()`、`matlab.lang.makeValidName("1 x")` 全部实跑通过 |
| 手册函数索引覆盖 | **1477/1512 = 97.7%** | 分母 = 官方 `docs.octave.org/v7.2.0/Function-Index.html` 抽出的 1512 个名字；在浏览器里逐个 `exist()` 实测 |

**那 35 个"缺失"里大部分不是缺口**：
- 13 个是 `exist()` 对 `pkg.Class` 点号形式的**假阴性**（`matlab.lang.*`、`containers.Map` 实测都能跑）；
- 9 个是手册把示例名当索引条目（`foo`/`elem`/`dims`/`ascii`/`operator` …）；
- 真正的缺口只有**音频播放族**与 **ftp**（见 2 节）。

### 1.2 已经具备的能力

- **真 `.oct` 动态装载**（2026-09-20 采用）：主链 `-s MAIN_MODULE=1`，`.oct` 编译成
  wasm side module 后运行时 `dlopen`。**加模块不必重链主 wasm**。
- C 库：qrupdate / ARPACK(arpack-ng 3.7.0) / FFTW 3.3.10(双+单) / Qhull 8.0.2 /
  GLPK 5.0 / zlib / libbz2 / RapidJSON / SuiteSparse 系 / libsndfile 1.2.2
- dldfcn 已注册 11 个函数名（7 个模块）：`__delaunayn__ / __glpk__ / __voronoi__ /
  convhulln / fftw / gzip / bzip2 / audioread / audiowrite / audioinfo / audioformats`
- plot 桥 v1（Octave 算 → spec → gnuplot-wasm → SVG）
- 交付体积：整站 gzip **10.96MB**（wasm 7.98 + js 1.80 + data 1.18）

### 1.3 `config.h` 关掉的 12 项

`CURL  CXSPARSE  FLTK  FONTCONFIG  HDF5  JAVA  MAGICK  OPENGL  PORTAUDIO  QT  SPQR  SUNDIALS`

其它已开：`AMD BZ2 CCOLAMD CHOLMOD FFTW3 GLPK QHULL RAPIDJSON SNDFILE UMFPACK Z`

### 1.4 dldfcn 12 个模块，建了 7 个，缺 5 个

| 模块 | 状态 | 依赖 |
|---|---|---|
| `__delaunayn__` `__glpk__` `__voronoi__` `convhulln` `fftw` `gzip` `audioread` | ✅ 已建 | — |
| **`__ode15__`** | ❌ | SUNDIALS（IDA） |
| `audiodevinfo` | ❌ | PortAudio |
| `__init_fltk__` `__fltk_uigetfile__` | ❌ | FLTK（GUI，见 R11） |
| `__init_gnuplot__` | ❌ | **无外部依赖**，可立即编译 |

---

## 2. 能力级缺口（不看"名字在不在"，看"能不能用"）

全部为浏览器实测，错误信息为原文。

| 能力 | 实测结果 | 根因 |
|---|---|---|
| **HDF5** | `save("-hdf5",…)` → `support for HDF5 was unavailable or disabled when Octave was built` | `HAVE_HDF5` off |
| **图像读写** | `imwrite(A,"/tmp/t.png")` → `imwrite: support for ImageMagick was unavailable or disabled` | `HAVE_MAGICK` off |
| **网络** | `urlread(…)` → `support for URL transfers was disabled when Octave was built` | `HAVE_CURL` off |
| **FTP** | `exist("ftp")` = 0 | 同上（curl） |
| **音频播放** | `audioplayer(y,8000)` → `'__player_audioplayer__' undefined` | `HAVE_PORTAUDIO` off；`audiorecorder` 类存在但播放/录制内建缺失 |
| **图形导出** | `print("/tmp/p.png","-dpng")` → `print: 'gs' (Ghostscript) binary is not available` | 无 Ghostscript/gl2ps，且 `figure` 是 plot 桥垫片（假句柄） |
| **包管理** | `pkg list` → `no packages installed.` | **0 个 Forge 包** |
| **子进程** | `system("echo hi")` → 返回 `-1` | 无 shell（本质不可，见 R11） |
| **`unzip`/`untar` 等** | 包装函数存在（`exist`=2）但调 `system(...)` → 必失败 | 全 .m 树里有 **34 个** 文件调 `system(` |
| **OpenGL 绘图** | `__opengl_plot__` = 0 | `HAVE_OPENGL` off（浏览器端由 plot 桥替代） |

---

## 3. 需求单（交给检索模型）

### 全局约束（判断任何方案可行性的前提）

1. 工具链：**Emscripten 3.1.24 + clang 16**，`emconfigure` / `emmake` / `emcmake`。
2. **Fortran 走 f2c（fort77 包装器），不是 gfortran**。Fortran 源的语法必须 f2c 能啃
   （已知 arpack-ng 3.9.x 就啃不动，退到 3.7.0）。
3. 主链：`-s MAIN_MODULE=1 -s ALLOW_TABLE_GROWTH=1`（为 dlopen `.oct`），
   **所有入链对象必须 `-fPIC`**，否则 wasm-ld 报 `recompile with -fPIC`。
4. **无 shell、无子进程**：`system`/`popen` 恒失败。任何依赖外部命令的方案直接出局。
5. **无真线程**（`--disable-threads`）、**无 OpenMP**；pthread API 头在但缺递归互斥等。
6. **32 位索引**（`OCTAVE_ENABLE_64` off）。
7. **纯客户端**：不得引入任何服务端执行代码的端点。
8. **体积敏感**：当前 gzip 10.96MB，任何新增都要给出体积增量估计。
9. Octave 本体以 `-O0 -fPIC` 编译（见 R10）。

---

### R1 · SUNDIALS → `ode15s` / `ode15i` 【最高优先，纯计算能力】

- **目标**：补齐唯一的非 GUI 计算型 dldfcn 模块 `__ode15__`。
- **现状证据**：`exist("__ode15__")` = 0；`ode15s` 不存在。Octave 源码
  `libinterp/dldfcn/__ode15__.cc` 内含 `HAVE_SUNDIALS_SUNCONTEXT` 分支（支持 6.x 新 API），
  说明 6.x 是被支持的。
- **要搜的问题**：
  1. SUNDIALS **6.1.x**（或 5.8.x）在 Emscripten 下的**既有成功先例**（哪个版本、哪些 cmake 旗标）。
  2. 静态构建所需的最小配置：`SUNDIALS_PRECISION=double`、`SUNDIALS_INDEX_SIZE=32`、
     关掉 examples/tests、`KLU_ENABLE` 是否必须（我们已有 SuiteSparse KLU 的 `.so`）。
  3. 是否需要 `-fPIC` 重编 SUNDIALS 自身才能进 MAIN_MODULE=1 主链（应该是必须）。
  4. 与 f2c Fortran 链的冲突（SUNDIALS 含 Fortran 接口，需确认可关）。
- **验收标准**：`ode15s` 跑刚性方程（Van der Pol、`y'=-1000(y-cos t)-sin t`）结果与
  参考实现一致；`exist("__ode15__")=5`；`ode15i` 可用。
- **可复用资产**：`build/build_oct.sh`（可直接把 `__ode15__.cc` 编成 `.oct`，**不必重链主 wasm**）；
  `build/reconf-pic.sh` + `build/rebuild-pic-libs.sh`（PIC 重编链）。

### R2 · Octave Forge 包体系 【影响面最大】

- **目标**：让 `pkg install` / `pkg load` 在浏览器场景可用，或至少把主流包注入进来。
- **现状证据**：`pkg list` → `no packages installed.`；当前只有 16 个 forge `.m`
  是手工 vendor 进 `octave.data` 的（statistics 的一小部分）。
- **要搜的问题**：
  1. 把 Forge 包**按构建需求分三类**给出清单：
     (a) **纯 `.m`**（可直接注入，零编译）——如 `geometry/matlab/nan/struct/splines/tsa/quaternion/financial/queueing/general/miscellaneous/optim`；
     (b) **需要编译但只用 BLAS/LAPACK**（我们现在能编 `.oct`）——如 `control/signal/statistics` 的 C++ 部分；
     (c) **需要额外 C 库**——列出库名与 wasm 可行性（`io`→zlib、`netcdf`→libnetcdf、
         `image`→libpng/jpeg/tiff、`database`→libpq/mysql、`mapping`→GDAL、`dicom`→GDCM、
         `instrument-control`→串口、`zeromq`、`ltfat`、`stk`、`fem-fenics`、`symbolic`→sympy）。
  2. 每个 (b) 类包：能否用 `build/build_oct.sh` 的模式编成 side module？包的构建系统
     （多为 `pkg install` 调 `mkoctfile`）在 emscripten 下如何改写？
  3. 包依赖的**纯 .m 注入**路线：哪些包可以不装、直接 `addpath` 其全部 `.m`（含
     `inst/` 目录）就能用？
- **验收标准**：给出一张「包名 → 类别(a/b/c) → 构建方式 → 前置库 → 体积增量」的表；
  至少 `statistics`（完整版）、`optim`、`signal`、`control` 四个能通过冒烟测试。
- **可复用资产**：`.oct` 装载已验证；zlib/bz2/sndfile/qhull/glpk/fftw/arpack/suitesparse
  的符号已在主 wasm 里（`.oct` 可直接 import）。

### R3 · HDF5 → `save/load -hdf5`

- **目标**：`save -hdf5` / `load -hdf5` 可用（与 MATLAB `.mat` v7.3 互操作的关键）。
- **现状证据**：`save("-hdf5",…)` → `support for HDF5 was unavailable or disabled`。
- **要搜的问题**：
  1. 有 wasm/Emscripten 先例的 HDF5 版本（1.10.x / 1.12.x / 1.14.x）。
  2. 已知冲突：Emscripten 下 HDF5 的 `FE_INVALID` / 浮点异常陷阱处理；是否需要补丁。
  3. 最小配置旗标（`-DHDF5_ENABLE_Z_LIB_SUPPORT`、关 tools/tests/examples、
     `H5_HAVE_...` 探测在交叉编译下的预设）。
  4. 与 zlib 的链接关系（我们已有 zlib）。
- **验收标准**：`A=magic(3); save("-hdf5","/tmp/a.h5","A"); clear A; load("/tmp/a.h5")` 往返正确。

### R4 · 图像 I/O → `imread` / `imwrite` / `imfinfo`

- **目标**：能读写 PNG/JPEG（教学场景最常见的需求）。
- **现状证据**：`imwrite` → `support for ImageMagick was unavailable or disabled`。
- **要搜的问题**：
  1. **ImageMagick 太重**，是否有更轻的 wasm 先例：libpng + libjpeg-turbo + libtiff 直接编？
     `imread`/`imwrite` 在 Octave 里是走 `__magick_read__` 的，有没有绕过 ImageMagick 的
     官方路径（matlab-compatible 的 `imread` 实现是否有非 magick 分支）？
  2. 备选：**stb_image / stb_image_write**（单头文件、MIT）自写 `.oct` 出
     `__imread__`/`__imwrite__` 内建？可行性与许可。
  3. 体积估计（libpng+zlib ≈ ?，libjpeg-turbo ≈ ?）。
- **验收标准**：`imwrite(uint8(rand(4,4,3)*255),"/tmp/t.png")` 生成文件；
  `imread("/tmp/t.png")` 读回尺寸一致。

### R5 · 网络 → `urlread` / `webread` / `websave`

- **目标**：`urlread("https://…")` 能取到数据。
- **现状证据**：`urlread` → `support for URL transfers was disabled when Octave was built`。
- **要搜的问题**：
  1. **Asyncify 路线**：把 Octave 编成 Asyncify 后，用 Emscripten 的同步 XHR/fetch 实现
     `urlread`。代价：体积 + 性能，是否有先例？Asyncify 与 `MAIN_MODULE=1`/`-fPIC`
     能否共存？
  2. **替代路线（可能更优）**：写一个自研 `urlread.m`，内部用 JS 侧注入的
     `fetch`（通过 `emscripten_run_script` 或自建 `__js_fetch__` 内建 + 事件循环）。
     浏览器端 `fetch` 本来就可用，问题只在"同步取回"。
  3. CORS 与代理的现实约束（纯静态托管下浏览器直连第三方 API）。
- **验收标准**：`s=urlread("https://example.com"); numel(s)>0`；且不引入服务端端点。

### R6 · 无 shell 的系统类函数重写

- **目标**：让 `unzip`/`untar`/`zip`/`tar`/`gunzip`/`bunzip2` 在浏览器里**真能用**。
- **现状证据**：全 `.m` 树里 **34 个**文件调 `system(`；`unzip` 存在但调
  `system("unzip …")` → `system: unable to start subprocess`。
- **要搜的问题**：
  1. Octave 的 `unzip`/`untar` 是否有**不依赖外部命令**的实现路径（内置 libarchive？）。
  2. 我们有 zlib/bz2 符号在 wasm 里（`gzopen`/`inflate`/`BZ2_bzCompressInit` 已确认存在）——
     自写 `.oct`（或纯 `.m` 调这些内建）实现 `gunzip`/`zip` 的可行性。
  3. `.zip` 解析的最小实现（miniz / minizip 单文件库的 wasm 构建）。
- **验收标准**：`zip("/tmp/a.zip",{"/tmp/a.txt"})` 与 `unzip("/tmp/a.zip","/tmp/out")` 往返成功；
  `gunzip` 不再走 `system`。

### R7 · CXSparse + SPQR（configure 门禁未解）

- **目标**：打开 `--with-cxsparse` 与 SPQR，补齐稀疏 QR / 迭代求解。
- **现状证据**：去掉 `--without-cxsparse` 后 configure 报
  `CXSparse library is too old (<version 2.2)`；而 `target/lib/libcxsparse.so.3.2.0` **已经编好**，
  `cs.h` 在 `target/include/cs.h`（`CS_VER=3, CS_SUBVER=1`）。判定逻辑是
  `m4/acinclude.m4` 的 `OCTAVE_CHECK_CXSPARSE_VERSION_OK`，依赖
  `HAVE_CS_H` / `HAVE_SUITESPARSE_CS_H` / `HAVE_CXSPARSE_CS_H` 之一被定义。**为何未定义需查清**。
- **要搜的问题**：
  1. Octave 7.2 的 `OCTAVE_CHECK_CXSPARSE_VERSION_OK` 具体探测路径与头文件命名期望；
     交叉编译下是否需要预置 `octave_cv_*` 缓存变量（本仓已有预置 ARPACK 的先例）。
  2. SPQR 从 `suitesparse-full-5.4.0.tar.gz` 单独编译的配方（含 `-fPIC`）。
- **验收标准**：configure 全绿（无 `--without-cxsparse`），稀疏 QR 数值与稠密对照一致。

### R8 · 音频播放 → WebAudio 桥

- **目标**：`audioplayer` / `audiorecorder` 可用（浏览器里本来就有 WebAudio）。
- **现状证据**：`audioplayer(y,8000)` → `'__player_audioplayer__' undefined`。
- **要搜的问题**：
  1. PortAudio 在 Emscripten 下的替代（Emscripten 有 Web Audio 后端，
     但 Octave 的 PortAudio 用法是阻塞式回调，能否适配）。
  2. 更轻的路线：自写 `__player_audioplayer__` 内建（`.oct`）→ 调 JS `AudioContext`。
     需要搜索：Emscripten 里从 C 调 JS 的推荐姿势（`EM_JS` / `emscripten_run_script`）。
- **验收标准**：`p=audioplayer(sin(2*pi*440*(0:7999)/8000),8000); play(p)` 无错。

### R9 · 图形导出 `print -dpng/-dpdf/-dsvg`

- **目标**：`print`/`saveas` 能出位图或矢量文件。
- **现状证据**：`print(…,"-dpng")` → `'gs' (Ghostscript) binary is not available`；
  且 `figure()` 是 plot 桥垫片（假句柄），没有真实图对象。
- **要搜的问题**：
  1. 我们已有 **gnuplot-wasm**（渲染 SVG）——把 `print -dsvg` 接到它上面是否可行？
     gnuplot 的 SVG terminal 输出与 Octave 的 `print -dsvg` 语义差异。
  2. 位图：gl2ps + OSMesa 在 wasm 的先例（通常很重）；或 gnuplot-wasm 出 SVG 后
     在 JS 侧转 PNG（canvas）。
- **验收标准**：`plot(1:3); print("/tmp/p.svg","-dsvg")` 产出可解析 SVG。

### R10 · 性能与编译级别

- **目标**：评估把 Octave 从 `-O0` 提到 `-O1/-O2` 的收益与代价（当前编译行就是 `-O0 -fPIC`）。
- **要搜的问题**：
  1. `-O2` 对 wasm 体积与编译时间的经验值（当前全树重编 ≈ 12 分钟 @ 24 线程）。
  2. `-O2` 与 `-fPIC` + `MAIN_MODULE=1` 是否有已知冲突。
  3. 64 位索引（`OCTAVE_ENABLE_64`）在 wasm32 下是否可行（Emscripten 的
     `-sMEMORY64` 成熟度）。
- **验收标准**：给出 benchmark 对比（同一组脚本的墙钟时间）+ 体积差。

### R11 · 明确不做（写下来避免反复讨论）

| 项 | 理由 |
|---|---|
| FLTK / Qt GUI（`__init_fltk__`、`__fltk_uigetfile__`、`gui` 函数族） | 浏览器本身就是 GUI，UI 由网页层负责 |
| `system`/`popen`/`unix` | wasm 无子进程，且**有意**不做（纯客户端原则）。保持"清晰报错" |
| Java（`javaObject`、`usejava`） | 体积与收益不成比例；`usejava('jvm')` 已正确返回 0 |
| OpenGL（`__opengl_plot__`） | 绘图走 gnuplot-wasm 桥 |
| OpenMP | 无真线程 |

---

## 4. 已验证、可直接复用的资产（别重复造）

| 资产 | 位置 | 用途 |
|---|---|---|
| `.oct` side module 编译 | `build/build_oct.sh <name>` | 一条命令出新模块，**不必重链主 wasm** |
| PIC 重编链 | `build/reconf-pic.sh` + `build/rebuild-pic-libs.sh` | 任何"重编 Octave/静态库"的操作都必须走这条 |
| 主链 flag 与回退说明 | `build/Makefile` 的 EM_SFLAGS/EM_CFLAGS 注释 | `MAIN_MODULE=1` ↔ `-fPIC` 是一对 |
| 验收脚本 | 浏览器自动化（Node + playwright + chromium） | 20 项回归 + `.oct` 装载，可复用 |
| 交付打包 | `dist/…/serve.py`（wasm MIME + gzip_static）+ DEPLOY.md | 新构建照这个打包 |
| 已在主 wasm 内的可 import 符号 | zlib / bz2 / sndfile / qhull / glpk / fftw / arpack / SuiteSparse 系 | `.oct` 直接引用，无需再链库 |
| 渲染桥 | gnuplot-wasm（gnuplot 6.0.2） | R9 的基础 |
