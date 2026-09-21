# 11.3 基线：实测事实（2026-09-21）

> 本文只记**实测 / 实读**得到的事实，支撑「换基线到 Octave 11.3.0」的决策。
> 不写推断；每条都给出可取回的位置。
> 前一份（10.3 方向）见 `BASELINE-10.3.md`，保留作为「当时怎么判断」的记录。
>
> 所有离线材料在 `/mnt/hdd/octave-wasm-build/probe11/`（两个上游 tarball、19 个 patch、
> 两棵已解包并 `git init` 的源码树，可随时 `git reset --hard` 复位）。

---

## 1. 为什么是 11.x（用户的动因，已核实成立）

来源：**本机** `/usr/share/doc/octave/NEWS.gz`（原生包 11.3.0，节标题
`Summary of important user-visible changes for version 11 (2026-02-18)`）。

**性能**（NEWS 原文口径）：

| 项 | 幅度 |
|---|---|
| 短宽数组（尤其行向量）的卷积 | 快 **10% – 150×**（此前要转置才有好性能） |
| `randi` | **4.5×** 更快，内存少 3.5× |
| `sum`/`cumsum`/`sumsq` 对 logical 输入 | 最高 **6×** |
| 打印 PDF | 快约 **25%** |

**MATLAB 兼容**（NEWS 有一整节 `### Matlab compatibility`，是 11 的改动大头）：

- broadcasting 扩展到**稀疏矩阵**运算、稀疏与满混合运算、**对角矩阵**运算；
- 一大批函数补齐 `"all"` / `"vecdim"` / `nanflag`：`all` `any` `cumprod` `cumsum`
  `min` `max` `cummin` `cummax` `prod` `sum` `sumsq` `bounds` `center` `meansq`
  `range` `statistics` `zscore` `kurtosis` `mode` `moment` `prctile` `quantile`
  `skewness` `iqr`（`iqr` 另加第二输出 `q`）；
- `min`/`max` 支持配对参数 `"ComparisonMethod"`（`"real"`/`"abs"`/`"auto"`）与
  `"linear"` 索引标志；
- `mean` 接受 `"Weights"`；`Speye` 可零参调用；`qr` 稠密单输出**只返回 R**（与 MATLAB 一致）；
- `strncmp`/`strncmpi` 在 `N=0` 时返回 true；`cellfun` 类型不匹配时改为报错；
- 图形：刻度标签不再被去掉首尾空格（**NEWS 明确标注 "This change is Matlab-compatible"**）、
  `fill`/`fill3` 顶点与颜色组合、`image` 的 x/y 向量校验、`ind2rgb`/`ind2gray` 的
  NaN/Inf 裁剪、`colorbar` 参数顺序、`newplot` 重写；
- 新增函数：`_Exit` `assert_equal` `corrcov` `dither` `funm` `mape` `rms` `rmse`
  `trexc` `xline` `yline`。

**另一条独立理由（本项目特有）**：**本机参照版 Octave 就是 11.3.0**
（`octave --version` → `11.3.0`）。`build/render-docstrings.py`、`build/check_m.py`
以及全部验收断言都跑在这台宿主上；目标定 10.3.0 则验证器自带版本差，
定 11.3.0 则**浏览器产物与宿主参照逐位同版**。

---

## 2. 两份公开的 wasm 配方（都实读原文）

### 2.1 emscripten-forge：`recipes/recipes_emscripten/octave`（**10.3.0**）

> 注意路径是 `recipes/recipes_emscripten/octave/`（`recipes_emscripten/octave/` 会 404）。

- `recipe.yaml`：`version: 10.3.0`，`build: number: 3`，19 个 patch。
- 最后改动 **2026-03-23**（`octave trigger rebuild to ioncoorporate new imagemagick build`）——
  **没有 11.x 版本**。所以「10.3 更成熟」不成立，它只是没人 bump。
- 工具链：定制 **LLVM/Flang 20.1.7**（`IsabelParedes/llvm-project` release
  `v20.1.7_emscripten-wasm32`，最新 release 就这一档，**与 Octave 版本无关**）。
- 链接模型与我们相同：`-sMAIN_MODULE=1` + `.oct` 走 `-sSIDE_MODULE=1`。
- 能力面窄：`--without-glpk/qhull_r/fftw3/fftw3f/qrupdate/hdf5/cxsparse/curl` +
  SuiteSparse 全家 + `--without-opengl`。

### 2.2 Edge-Tools/octave-wasm：edgetools.io 的 GPL 对应源码（**11.1.0**）

公开仓 26 个文件；`README.txt` 声明这是 **edgetools.io 产品所用 wasm Octave 的对应源码**
（GPL-3.0-or-later，与 Octave 同许可）。**`upstream/octave.tar.xz` 是 `octave-11.1.0.tar.xz`**
（`8b3e2d0e…cb6a`）。

仓库结构：`build/Dockerfile`（7.1KB）+ `build/scripts/{emf77,build-lapack.sh,build-glu.sh}`
+ `build/octave-patches/webgl-graphics-toolkit.cc` + `build/js/post.js`
+ `build/demo/{index,check}.html` + `serve.mjs` + `upstream/*.tgz`。

**他们的 `test/`（`package.json` 里引用 `test/test.mjs` / `test/render-test.mjs`）没有公开**
（`/contents/test` 返回 404），所以无法复用他们的验证。

---

## 3. patch 漂移实测：19 个 patch 对 10.3.0（对照）与 11.3.0

**方法**：patch 是**顺序叠加**的，`--dry-run` 每个都打在裸树上没有意义（第一次这么测过，
结果不可信，已废弃）。改为：解包源码树 → `git init` + 提交 → 按 recipe 顺序**逐个真打** →
`git reset --hard` 复位。`--fuzz=5 -l` 作为补充判定。

**对照（10.3.0）：19/19 全部干净应用** —— 方法自洽性得到验证。

**11.3.0：16/19 干净应用，3 个失败。**

| patch | 失败情况 | 定性 |
|---|---|---|
| **0009** `Fix-Fortran-calling-convention` | 8/8 hunk 全失败（`ordschur.cc` 4 + `lo-lapack-proto.h` 4） | **已经进上游，直接删除** |
| **0010** `Remove-redundant-headers` | 18 个 hunk；失败集中在**生成物** `libgnu/Makefile.in`；源文件 `Makefile.am` 的改动在 fuzz 下可套上（带 101 行偏移） | 在 `Makefile.am` 层重做即可 |
| **0016** `Disable-gui-calls-and-threading` | 5 个 hunk 中**仅第 1 个**失败（行 487 区：`putenv LC_*` + `thread::init()`）；其余 4 个带偏移套上 | 补 1 处 |

**0009 的定性依据（实读 11.3.0 源码）**：11.3.0 的
`libinterp/corefcn/ordschur.cc:138,153,170,185` **已经带**
`F77_CHAR_ARG_LEN (1) F77_CHAR_ARG_LEN (1)`；且 `liboctave/numeric/lo-lapack-proto.h`
里 `ctrsen`/`dtrsen` 的声明**已不存在**（该头已换掉，全文 `F77_CHAR_ARG_LEN_DECL` 出现 **0** 次）。
即 11.3.0 **不需要**这个补丁。

**结论：换 11.3.0 的 patch 代价不是「19 个全部重推」，而是「16 个直接用 + 1 个删除 +
2 个局部重做」**——涉及 4 个文件、不到 25 个 hunk。

---

## 4. Edge-Tools 配方全貌（11.1.0，实读原文）

### 4.1 他们对 Octave 源码的全部改动 = **5 处 sed**

| # | 文件 | 改动 |
|---|---|---|
| 1 | `configure` | 删掉 `Building shared libraries is required` 检查 |
| 2 | `libgnu/getlocalename_l-unsafe.c` | 把 gnulib 的 `#error "Please port…"` 换成硬编码返回 `"C"` locale |
| 3 | `liboctave/wrappers/cxx-signal-helpers.cc` | `#if ! defined (__WIN32__)` → 追加 `&& ! defined (__EMSCRIPTEN__)` |
| 4 | `configure` | 把 qt/fltk toolkit 判定强改成 `if false; then` |
| 5 | `libinterp/corefcn/interpreter.cc` | 在 `initialize_load_path ();` 后注入 `install_webgl_graphics_toolkit (*this)` |
| — | `libinterp/corefcn/gl-render.cc` | 把 toolkit 的 `.cc` 直接 **append** 进去 |

**每一处后面都跟 `! grep -q …` 守卫**：模式对不上就 `exit 1` 让构建**明确失败**，
不会静默改错。这比 patch 更好的性质（patch 会留 `.rej` 而你未必看）。

### 4.2 工具链：emsdk 5.0.7 + **f2c**（不是 Flang）

- `FROM emscripten/emsdk:5.0.7`，`CFLAGS="-O2"`，`CXXFLAGS="-O2 -fexceptions"`。
- **Fortran 走 f2c**：`--enable-fortran-calling-convention=f2c`，`F77=emf77`，
  `FLIBS="-L$PREFIX/lib -lf2c"`，libf2c 取自 **CLAPACK** 的 `F2CLIBS/libf2c`。
- `emf77` 就是 `.f --f2c--> .c --emcc--> wasm` 的包装，`f2c` 跑在构建宿主上（只改文本）。
- **他们的 COMMON 块结论与我们 `CLIBS.md` 4.4 完全一致**：
  > `-fcommon` **不能用**（wasm-ld 没有 common symbol linkage）
  他们的修法比我们更通用：**终链 `-Wl,--allow-multiple-definition`**（配
  `-Wno-implicit-function-declaration -Wno-implicit-int`），而不是我们「把 ARPACK
  全源 cat 进单个 TU」的回避。→ **这条可以拿来解掉我们 ARPACK 的单 TU 技巧。**
- 他们命中 libf2c 的 `s_cat`/`s_copy`「声明 `int`、实现 `void`」不匹配
  （改名 + 加 int 包装垫片）。我们**没有**此问题（我们用的是
  `libf2c2-20130926`，见 `BASELINE-10.3.md` §3），因为 libf2c 来源不同。
- 构建守卫值得抄：`emnm` 后断言 `dgemm_`（libblas）、`dgesv_`/`dlamch_`（liblapack）存在，
  f2c 拒编文件数 `> 20` 即 FATAL。

### 4.3 浏览器接口形态（与我们不同）

- 产物：`octave.mjs` + `octave.wasm` + `octave-runtime.tar`（内含 `share` + `libexec`）。
- `MODULARIZE=1 EXPORT_ES6=1 INVOKE_RUN=0 EXIT_RUNTIME=1 FORCE_FILESYSTEM=1
  WASM_BIGINT=1 ALLOW_MEMORY_GROWTH=1 INITIAL_MEMORY=128MB STACK_SIZE=8MB`。
- 页面侧：`preRun` 里把 `octave-runtime.tar` 解开到 MEMFS 的 `/octave`，
  设 `ENV.OCTAVE_HOME = '/octave'`，然后
  **`mod.callMain(['--norc','--quiet','--eval', script])`** —— 一次性 CLI 调用，
  **不是** `Module.eval_string`。他们的 `demo/index.html` 自己写了个 ustar 解包器。
- `js/post.js` 只是把 `FS.*` 子方法 `Object.assign` 出去（emsdk 5.x 不再默认暴露）。

### 4.4 图形：toolkit 能用，GL 撞墙（**与我们的独立结论一致**）

`MILESTONE-2.md` 原文要点：

- **Milestone 1（无头数值）已完成并上线**；解释器 + `.m` 库 + Fortran 线性代数
  **通过全部测试**。
- `webgl-graphics-toolkit.cc`（约 320 行）是真 `base_graphics_toolkit` 子类：
  注册为 toolkit 名 `"webgl"`（`gtk_manager::register_toolkit` + `load_toolkit`），
  `initialize()` 放行 figure，`redraw_figure()` 走
  `figure_pixsize` → `make_context_current` → `opengl_renderer::set_viewport/draw/finish`
  → `get_pixels()`；并提供 `get_canvas_size` / `get_screen_resolution`(96) /
  `get_screen_size`(1920×1080)。另含约 30 个 GL 垫片（`glColor3dv`、`glVertex3d`、
  `glMultMatrixd`、`glGetDoublev`，以及选择/属性栈/显示列表/光栅那批 no-op；
  **注意 `glClipPlane` 是空实现**）。
- **Milestone 2 阻塞**，死在 `numVertices must be an integer` at `glEnd`，
  即 emscripten `LEGACY_GL_EMULATION` 无法复现 Octave 的 `glBegin/glVertex/glEnd`
  （`GL_UNSAFE_OPTS=0` 无效）。**与我们 `BASELINE-10.3.md` 记的撞墙点完全相同。**
- 他们给的推荐就是 **OSMesa**，并写明了接缝：加 Mesa→wasm 构建阶段、去掉
  `LEGACY_GL_EMULATION`/`-lGL`/GL 垫片，把 `make_context_current` 换成
  `OSMesaCreateContext`/`OSMesaMakeCurrent`。

→ **`§5.5 T2` 那个「薄 toolkit」已经是既成事实**（公共、许可兼容 GPL-3.0-or-later，
需注明出处），P5 只剩 OSMesa 一件事。

### 4.5 两个必须如实说的代价

1. **需要 COOP/COEP**：`demo/serve.mjs` 明确设
   `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`
   → SharedArrayBuffer → **pthread 构建**。他们的 configure **没有** `--disable-threads`
   （emscripten-forge 的 10.3 有）。我们现有 7.2 构建是单线程、不需要 COI。
   **走 11.x 不强制要线程**，但照抄他们的配置会继承 COI 托管前提。
2. **能力面是三方里最窄**：`--without-qhull/glpk/arpack/qrupdate/curl/hdf5/fftw3/fftw3f/
   magick/sndfile/portaudio/bz2/fontconfig` + SuiteSparse 全关，**且 `DLDFCN_LIBS=` 传空
   → 没有 `.oct` 动态装载车道**。比 emscripten-forge 10.3 还窄，比我们窄得多。

---

## 5. Edge-Tools 的 5 条 sed 对 **11.3.0** 的命中实测

把上面 5 条模式逐条拿 `octave-11.3.0` 源码树验（离线）：

| 模式 | 11.3.0 结果 |
|---|---|
| `Building shared libraries is required` in `configure` | ✅ 1 处 |
| `libgnu/getlocalename_l-unsafe.c` 的 `#error "Please port gnulib getlocalename_l-unsafe.c…"` | ✅ 第 **659** 行（**同一个 gnulib 问题仍在**） |
| `^#if ! defined (__WIN32__)$` in `cxx-signal-helpers.cc` | ✅ 第 **195** 行，唯一匹配 |
| `build_qt_gui = no && test` in `configure` | ✅ 1 处 |
| `^  initialize_load_path ();` in `interpreter.cc` | ✅ 第 **756** 行 |

→ **5/5 全中。**

另：他们的 configure 开关 **23/24 在 11.3.0 仍有效**，唯一失效的是 `--without-x`
（11.3.0 已移除该选项，丢掉即可）。`--enable-fortran-calling-convention=f2c` **仍在**。

---

## 6. vanilla 11.3.0 的三个关键点核对（**都是利好**）

我们 7.2 的很多坑来自上游 fork `rwl/octave-wasm` 自己的改动。**11.3.0 走的是 vanilla
上游源码**（`ftp.gnu.org` 的 tarball，27919604 字节），那些坑**大部分不存在**：

| 核对 | 11.3.0 结果 | 对我们的影响 |
|---|---|---|
| `liboctave/util/oct-shlib.cc` 是否真调 `dlopen` | ✅ 第 **246** 行 `m_library = dlopen (m_file.c_str (), flags);` | **`§4.1` 的根因（fork 掏空 `dlopen`）不存在** → 不需要「用上游文件覆盖」这一步；`.oct` 车道只需 `MAIN_MODULE=1` + `SIDE_MODULE=1` + `-fPIC` |
| `libinterp/corefcn/help.cc` 的 `looks_like_texinfo` | ✅ 第 **141** 行，仍 `find ("-*- texinfo -*-")`（第 150 行） | **T1 的机制原样成立**：构建期预渲染 + 去标记 → 走 plain text 分支 |
| `scripts/pkg/private/installed_packages.m` | ✅ 167 行，第 35 行 `load (local_list).local_packages`、第 41 行 `expand_rel_paths` **都在** | **`§5.8` 的「fork 删掉读库代码」不存在** → `build/pkgrestore/` 不需要；只需 `build/pkgfix/`（从磁盘生成数据库）那一半 |

---

## 7. 构建环境实测

| | 宿主 | obuild / odld / obench | Edge-Tools | emscripten-forge |
|---|---|---|---|---|
| 基底 | Debian **sid** | Ubuntu **20.04** | `emscripten/emsdk:5.0.7` | conda-forge |
| emscripten | — | **3.1.24** | **5.0.7** | 定制 LLVM 20.1.7 |
| meson | **1.12.0**（已装） | 候选仅 **0.53.2**（太旧） | — | — |
| ninja | **1.13.2**（已装） | 候选 1.10.0 | — | — |
| ccache | **4.13.6**（已装） | 候选 **3.7.7** | — | — |

- `emscripten/emsdk:5.0.7` 镜像在 Docker Hub 存在：最后更新 **2026-04-30**，
  压缩体积 **1622 MB**。
- **结论：11.3.0 必须建新容器**（现有三个在 emsdk 版本上就不是同一回事），
  且现有容器**装不了能用的 meson**（0.53.2 距 Mesa 要的 1.x 差得远）——
  `emsdk:5.0.7` 那个较新的基底能把 ccache 4.x + 可用 meson 一起带进来。

### 7.1 ccache 实测（在临时容器里用真 emcc 跑，已删除该容器）

| 测的东西 | 结果 |
|---|---|
| `ccache emcc -c x.c` 编两次 | 第一次 miss、第二次 **direct hit** ✅ |
| **换目录**编同一份源（`hash_dir=false` 是否被读） | **direct hit** ✅（`ccache -p` 确认配置来自 `/ccache/ccache.conf`） |
| 绝对 `-I` 路径不同（`-IiX/inc` vs `-iY/inc`） | **两次都 miss** ⚠️ |

**⚠️ 第三条是要紧的**：绝对 include 路径会进 hash → **构建目录的路径必须逐字固定**，
容器重建时不能换名。现有约定 `/usr/src/octave-wasm/third_party/octave-<版本>`
本来就固定，正好满足。

**配置落盘**：`/mnt/hdd/octave-wasm-build/ccache/ccache.conf`（持久盘）。
挂载：`docker run -v /mnt/hdd/octave-wasm-build/ccache:/ccache -e CCACHE_DIR=/ccache`。
不进镜像，`docker commit` 不会把缓存塞进 image。已清空缓存并归零统计。

配置里对默认值做了一处**保守**决定并写明理由：**`depend_mode` 保持关闭**。
它靠编译器生成的 `.d` 推断依赖，更快，但 ccache 官方标注「略不安全」；
本项目正确性优先于编译速度，要开必须先做实测对照（同源开/关各编一遍，比对对象字节）。

---

## 8. 结论

**换到 11.3.0 的成本远低于原估**，因此 `HANDOFF §9.2` 原来的「先做 10.3.0、11.x 以后再说」
**不成立**（其理由是「19 个 patch 要全部重推」，已实测证伪：16/19 直接可用，1 个该删）。

**建议的取法：目标钉 11.3.0 + 补丁基线取 Edge-Tools 的 f2c 路线 + 链接模型与长尾用我们自己的。**

| 要素 | 取自 |
|---|---|
| Octave 版本 | **11.3.0**（vanilla `ftp.gnu.org`，与本机参照同版） |
| 工具链 | **emsdk 5.0.7** |
| Fortran | **f2c（`emf77` 那套）** → 我们 13 个批次的 f2c 经验（libf2c2、ARPACK 单 TU、5 个 PIC 库）**原样继承** |
| 平台补丁 | **Edge-Tools 的 5 处 sed**（已验 5/5 命中 11.3.0）；emscripten-forge 的 19 个 patch 留作**已知坑清单**参考 |
| 链接模型 | **我们自己的 `MAIN_MODULE=1` + `.oct` 走 `SIDE_MODULE=1`** + 资产懒加载 |
| C 库长尾 | **我们自己的**（glpk/qhull/fftw3/ARPACK/cxsparse/HDF5/SuiteSparse…） |
| 图形 | Edge-Tools 的 `webgl` toolkit + **OSMesa**（P5）；现有 plot 桥与 `print -dsvg` 作过渡与回退 |
| 宿主层 | 我们自己的 T1/T3/T4/T5 |

**明确不采用**：他们 `--without-*` 那一长串（那是他们的能力裁剪，**不是平台要求**）、
以及**照抄会继承的 pthread/COI 托管前提**（建议加 `--disable-threads`，需实测确认）。

---

## 9. 仍未验证 / 风险（不许含糊）

1. **`11.3.0` 实际 configure/make 是否通过，还没跑过。** 本文只证明「补丁可移植 +
   第三方已建成 11.x wasm」；真编译是 **P0 的闸门**。
2. **emsdk 5.0.7 与我们 `.oct` 车道是否兼容，未知。** 我们的批次 1d/13 是在 emsdk 3.1.24 上做的；
   换 emsdk 大版本后 `MAIN_MODULE=1` / `ALLOW_TABLE_GROWTH` 的行为**必须重验**。
   **这是新引入的最大不确定性**，建议在 P0 里单列一条闸门。
3. **线程/COI**：建议 `--disable-threads` 保持现在免 COI 的托管，但需实测确认在
   emsdk 5.0.7 + f2c 下可行。
4. **OSMesa 仍未验证**，依然是最大的一块（Edge-Tools 也只给到「建议」，没做）。
5. **11.3.0 的 `help` 对 `.m` 文件的剩余缺口**（`§5.6`）在 11.3.0 上是否仍旧存在，
   未核对——那要走运行时读 `.m` docstring 的路径。
