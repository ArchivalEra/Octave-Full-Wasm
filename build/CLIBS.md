# C 库长尾状态（2026-09-20 关机前）

构建机：`obuild` 容器（Emscripten 3.1.24），快照镜像见下。
配方执行记录，Dockerfile 化待 C 库全收敛后做。

## 已编过（在 `target/lib` + `target/include` 里，符号验过）

| 库 | 版本/来源 | 产物 | 关键符号 | 许可 |
|---|---|---|---|---|
| qrupdate | 1.1.2（Debian 源） | libqrupdate.a 370KB | `sqr1up_` | GPLv3+（COPYING 原文；SF 页标 GPLv2 是错的） |
| ARPACK | wo80/vs-arpack（F2C C 源，66 个） | libarpack.a 323KB | `dseupd_` 等 4 个 | BSD-3 |
| FFTW | 3.3.10 官方 tarball（GitHub 只有生成器） | libfftw3.a + libfftw3f.a + fftw3.h | 520 个 `fftw_*` | GPLv2+（源码头 or-later） |
| Qhull | 8.0.2（GitHub tag v8.0.2） | libqhull_r.a（由 libqhullstatic_r.a 改名）+ 头 | reentrant API | 宽松（permissive） |
| GLPK | 5.0（ftp.gnu.org） | libglpk.a 4.1MB | `glp_simplex`（239 符号） | GPLv3+ |

## 编译要点（血泪）

1. Fortran 链：`emmake make FC=fort77 FFLAGS="-O0 [-fcommon] -I$INCDIR"`；
   qrupdate 的 `ar` 是宿主版，归档一律改用 `emar rcs` + `emranlib`。
2. **F2C COMMON 重复符号**：ARPACK 的 `debug_/timing_` 在每个 `.c` 里定义一份，
   wasm-ld 报 duplicate symbol——两个 Fortran 系库（arpack、qrupdate）全部加
   `-fcommon` 重编。 symptom：`duplicate symbol: debug_`。
3. FFTW 按 Essentia 配方：`emconfigure` ×2（第二遍 `make distclean` +
   `--enable-single`），`--disable-fortran --disable-threads --disable-openmp
   --disable-shared --enable-static`。
4. Qhull：`emcmake` 静态编，产物改名 `libqhullstatic_r.a → libqhull_r.a`
  （Octave 认 reentrant 名）。

## Octave 重编状态：完成（第四轮 configure 全绿）

- `build/reconf.sh`：与 Dockerfile 同 flag，去掉 5 个 `--without`，
  外加 `octave_cv_lib_arpack_ok_1=yes` 预置。
- 预置原因：ARPACK 的“C++ 跑起来 crash 否”测试在容器 Node 14 下挂
  （`unexpected section <Exception>`，环境老旧非库问题）；链接测试本身已过。
- **ARPACK 三连坑**（全部修完，见下）。
- **FFTW 线程桩**：`build/fftw_threads_stub.c`（`init_threads→1`，
  Octave 把返回 0 当 fatal；`plan_with_nthreads` 空实现，照样串行跑）。
  真 FFTW 已验：`fft([1 0 0 0])=[1 1 1 1]`，正弦谱峰 32 正确。
- **dldfcn 静态直装**：`__delaunayn__/__glpk__/__voronoi__` 三个 `.cc`
  手工编进终链（见下），`delaunay/voronoi/glpk` 全通。
- `build/normalize_arpack.py`：arpack-ng 源码 F77 净化器（`!` 注释→`c`，
  `&` 续行→定式续行）。

### ARPACK 三连坑

1. `duplicate symbol: debug_/timing_`：F2C 公共块多文件重复定义，
   wasm-ld 严格拒收。**注意反直觉结论**：`emcc -fcommon` 在此工具链下把
   定义直接变 `U`（未定义）而不是合并——禁用，只能单定义。
2. vs-arpack 是 MKL 口味 ABI（`dlacpy("A",...)` 前导字符参数），与
   reference LAPACK 不兼容 → 弃用，改 arpack-ng 3.7.0 Fortran 源
   （3.9.x 有 f2c-2016 啃不动的语法；3.7.0 经净化器后 66/66 一次过）。
3. 最终方案：**全源 cat 进单个 TU 编译**（公共块天然单定义），
   `second()` 桩返回 0（计时统计无人在意），`emar` 重建 `libarpack.a`。
   `eigs` 对 `eig` 残差 1e-14/1e-15，`svds` 正确。

### dldfcn 静态直装（delaunay/glpk/voronoi）

- 背景：dldfcn=`.oct` 动态模块，wasm 无 dlopen 从未建成；
  `__delaunayn__.cc` 等躺在源码树里从没进包。
- 路径：`em++` 手工编译（FLAGS 照搬 liboctinterp CPPFLAGS）→ `.o` 直挂终链。
- 坑：显式 `.o` 会被链接器 GC 整件扫掉（strings 验证 0 残留）。
  解：`main.cc` Phase 3 直接调三者的 `G_ installer`
  （`octave_dld_function::create` + `install_built_in_function`），
  机制见 `libinterp/corefcn/dynamic-ld.cc` 的 `load_oct`。
- `exist("__delaunayn__")=5`，`delaunay/glpk/voronoi` 全通。
- 附带：`figure.m` 垫片改为返回假句柄 1（`voronoi` 内部 `hf=figure()` 不再炸）。

## 批次 0（2026-09-20）：dldfcn 注册表 + convhulln + fftw()

- **D3 表驱动注册表**：`main.cc` 顶部 `STATIC_DLD_FCNS(X)` 一行一个模块，
  Phase 3 用同一宏生成声明与安装表。新增模块 = 加一行 + 编一个 `.o` +
  在 `Makefile` EM_LDFLAGS 挂 `.o`。已登 5 个：
  `__delaunayn__ / __glpk__ / __voronoi__ / convhulln / fftw`。
- **A1 convhulln**：`build/build_dldfcn.sh convhulln fftw` 编 `.o`；
  实测 `convhulln([0 0;1 0;0 1])` → `1 2 3`，四点方 → 4×2（正确）。
- **A2 fftw()**：`planner`→`estimate`，`swisdom`/`dwisdom` 可用。
- **已知偏差**：`fftw('threads',N)` 静默 no-op 而非报错——`fftw_init_threads`
  桩必须返回成功（否则核心 `fft` 直接崩，见"FFTW 线程桩"节），Octave 因此
  认为线程可用；数值不受影响。
- wasm raw 19.75MB（批次 0 后）。

## 容器/镜像

- `owasm`：线上旧构建（8757），别动。
- `obuild`：构建容器（`sleep infinity`，重启 docker 后 `docker start obuild`）。
- 镜像：`octave-wasm`（原始）、`octave-build:full`（工具链检查点）、
  `octave-build:libs`（5 库编完）、`octave-build:shutdown`（关机快照）、
  `octave-build:final`（C 库长尾收官）、后续批次另打。

## 批次 1a（2026-09-20）：zlib / libbz2 / RapidJSON / CCOLAMD

- **zlib + libbz2**：用 Emscripten ports（`embuilder build zlib bzip2`），
  免源码；头/库进 sysroot（`zlib.h`/`bzlib.h`/`libz.a`/`libbz2.a`）。
- **RapidJSON 1.1.0**：header-only，vendor 到 `target/include/rapidjson/`。
- **CCOLAMD**：SuiteSparse 已编（`libccolamd.so`），configure 去掉
  `--without-ccolamd` 并**在终链补 `-lccolamd`**（否则 undefined ccolamd/csymamd）。
- **CXSparse 暂缓**：去掉 `--without-cxsparse` 触发 configure 报
  "CXSparse library is too old (< 2.2)"（安装头版本宏不匹配）→ 本批保持
  `--without-cxsparse`，留批次 1b 处理。
- **gzip/bzip2** 是 dldfcn（`gzip.cc` 一个 .o 出 `Ggzip`+`Gbzip2`），
  经 STATIC_DLD_FCNS 注册后可用：`gzip("f")`/`bzip2("f")` 走进程内压缩。
- **gunzip/bunzip2**（`.m` 包装）调 `system("gzip -d …")` → wasm 无 shell，
  清晰报 `system: unable to start subprocess`；符合"宿主专属=明确报错"口径。
- 实测：`jsonencode`/`jsondecode`、`gzip`/`bzip2`、`save -v7`、稀疏均通；
  convhulln/fftw/eigs/delaunay/plot 桥无回归。
- wasm raw 19.9MB（gzip 4.52MB）。
- 配方：`build/reconf-batch1.sh`（去掉 z/bz2/ccolamd/rapidjson 的 without）。

## 批次 1b（2026-09-20）：libsndfile → audioread/audiowrite/audioinfo/audioformats

- **libsndfile 1.2.2**：`emcmake cmake` 静态构建，`-DENABLE_EXTERNAL_LIBS=OFF
  -DENABLE_MPEG=OFF`（只要内置 WAV 等编解码，免 flac/ogg/vorbis）。
- **audioread.cc** 是 dldfcn，出 4 个 installer：
  `Gaudioread/Gaudiowrite/Gaudioinfo/Gaudioformats`，经 STATIC_DLD_FCNS 注册。
- **坑（重要）**：dldfcn 的 `.o` 必须在 **config.h 反映该 feature 之后**再编，
  否则 `#if defined(HAVE_SNDFILE)` 走 else 分支，函数装上却报
  "support ... was unavailable or disabled"。本批踩过一次：先用旧 config.h
  编了 audioread.o → 报 disabled → 新 config.h 下重编 + 重链即通。
- 实测：`audiowrite("/tmp/t.wav", y, 8000)` → 文件生成；
  `audioinfo` SampleRate=8000；`audioread` → [8000 样点, 峰值 1]；`audioformats` 出表。
- 终链补 `-lsndfile`。
- 配方：`build/reconf-batch1b.sh`（去掉 `--without-sndfile`）。
- wasm raw 19.98MB。

## 批次 13（2026-09-20）：dldfcn **回归官方装载路径**（摘掉静态注册）

**背景**：批次 0–1b 期间，`.oct` 看起来在 wasm 里不可能装载（fork 掏空了
`oct-shlib.cc`、且 `libinterp/module.mk:115` 的 dldfcn include 被注释、从不产出 .oct），
于是发明了 `main.cc` 的 `STATIC_DLD_FCNS`：手工驱动每个模块的 `G_` installer、
用 `symtab.install_built_in_function` **装成内建**。

**问题**：批次 1d 之后真 dlopen 已经做通，但这 11 个没跟着搬。结果是**语义偏离**——
`exist()` 返回 5、`which()` 报 "built-in function"，而桌面版是 3 + 文件路径。
（这也是为什么当时 `pkg`/`autoload` 类机制看到的行为与桌面版不一致。）

**已改**：11 个函数 → 7 个 `.oct` 资产，走与 Forge 包/自研模块同一条官方车道。

| | 原先 | 现在 |
|---|---|---|
| 装载 | `main.cc` 静态表 + `install_built_in_function` | 运行时 dlopen（`assets/oct/*.oct`） |
| `exist()` | 5 | **3** |
| `which()` | `built-in function` | **`/usr/src/octave/m/oct/<name>.oct`** |
| 加新模块 | 改 main.cc + 重链 46MB 主 wasm | 编 `.oct` + 加 manifest 条目 |
| wasm/js 体积 | — | **−120KB / −80KB**（少了 7 个模块的代码） |

模块与函数名的对应（**一个模块导出多个函数时，必须靠 `aliases` 符号链接**，
否则 Octave 按文件名找不到——见 §4.11）：

| .oct | 导出函数 | aliases |
|---|---|---|
| `gzip.oct` | gzip | `bzip2` |
| `audioread.oct` | audioread | `audiowrite` `audioinfo` `audioformats` |
| `convhulln.oct` | convhulln | —（文件名即函数名） |
| `__delaunayn__.oct` / `__voronoi__.oct` / `__glpk__.oct` / `fftw.oct` | 同名 | — |

**两条不可删的东西**（摘静态表时最容易误删）：
1. **`-lqhull_r -lglpk -lsndfile -lz -lbz2 -lfftw3 -lfftw3f` 全部保留** ——
   `.oct` 不链任何库，它们的 qhull/glpk/sndfile/zlib 符号要**从主模块解析**。
2. **`fftw_threads_stub.o` 保留** —— 它是给**核心 `fft`/`ifft`** 用的
   （`liboctave/numeric/oct-fftw.cc` 的 `fftw_planner` 要 `fftw_init_threads`），
   与 dldfcn 的 `fftw()` 模块**无关**。FFTW 是 `--disable-threads` 编的、不提供
   这个符号，而 Octave 把它当致命错误 → 删了任何 `fft` 调用都会崩。

**为什么阶段化做**（这是本次能低风险落地的原因）：Octave 的函数查找顺序是
autoload → **path 上的函数** → package → builtin（`fcn-info.cc:811-834`）。
所以先把 `.oct` 资产铺好，**path 就自动压过了静态注册的 builtin**；
确认全绿之后再摘表，摘表那一步就只是删死代码，没有行为变化。

**验收**：`test/browser/accept-dldfcn.mjs` 68/68（官方语义 11 项 ×2 + 真数值 +
核心 .m 包装层协同 + 回归）；8761 全量 **14 套 400 项**全绿。

---

## 真 .oct 动态装载（2026-09-20）：MAIN_MODULE=1 + wasm side module

结论：**`.oct` 能用**，但代价明确。实验在独立容器 `odld`（镜像 `octave-build:pre-dldfcn`，
= 批次 1b 快照）里做完，`obuild`/8761 全程未动。实验构建在 **8763**。

### 四件事缺一不可
1. **恢复 `oct-shlib.cc`**：fork 把 `octave_dlopen_shlib` 的 `dlopen`/`dlsym`/`dlclose`
   全删了（详见 HANDOFF §4.1）。用上游同名文件覆盖即可，diff 只有 3 处 hunk：
   `m_library = dlopen (m_file.c_str (), flags);` + 失败报错、析构里的 `dlclose`、
   `search()` 里的 `dlsym (m_library, …)`。取法：
   `curl -sSL https://raw.githubusercontent.com/gnu-octave/octave/release-7-2-0/liboctave/util/oct-shlib.cc`
   （`dynamic-ld.cc` 与上游**逐字节相同**，不用动。）
2. **全树 `-fPIC`**：`build/reconf-pic.sh`（= reconf-batch1b.sh + 三个 `-fPIC`）
   + **5 个静态库** `build/rebuild-pic-libs.sh`（glpk/arpack/sndfile/qhull/fftw3+3f）。
   重编前务必 `emmake make clean`。
3. **主链加 `-s MAIN_MODULE=1 -s ALLOW_TABLE_GROWTH=1`**（`src/Makefile` 的 `EM_SFLAGS`），
   `EM_CFLAGS` 加 `-fPIC`，`octave.o`/dldfcn `.o`/`fftw_threads_stub.o` 也要 `-fPIC`。
   另需 `embuilder build --pic zlib bzip2`（PIC sysroot 里没有这两个端口库）。
4. **`.oct` 编成 side module**：`build/build_oct.sh <name>`，链接用 `-sSIDE_MODULE=1`，
   **不链任何库**——符号由主模块在 dlopen 时解析。

### 实测（浏览器，8763）
- `Module._dlopen`/`_dlsym` 是 function；`dldprobe.oct`（自写探针）→ `dldprobe()` = 42。
- 把 `gzip`/`convhulln` **从 STATIC_DLD_FCNS 摘掉**后：`exist` 从 5 变 0；
  放入 `.oct` + `addpath` → `exist` = 3，`gzip`/`convhulln` 功能正常。
- **数值与静态注册逐位一致**：`convhulln` 三角形/正方形两种输入，8763(.oct) 与
  8761(静态) 输出字符串完全相同（`3 2 1 3 2 2 1 3` / `4 2 1 2 3 4 1 2 3 4`）。
- 回归对照（8761 vs 8763）：`det`/`delaunay`/`eigs`/`fft`/`glpk`/`save -v7`/`class(1i)`/
  `jsonencode` 全部一致；`disp(bzip2)` 的 `built-in-docstrings` 报错**两边都有**，
  是既有的，与本次改动无关。
- `gunzip` 仍报 `system: unable to start subprocess`（§批次 1a 已知偏差，与 .oct 无关）。

### 代价（必须权衡）
| | 基线 8761 | MAIN_MODULE 8763 |
|---|---|---|
| octave.wasm | 20.5MB / gzip 4.94MB | 37.9MB / gzip 8.05MB |
| octave.js | 230KB / gzip 51KB | 29.8MB / gzip 1.81MB |
| octave.data | 6.17MB / gzip 1.19MB | 同 |
| 合计 gzip | **6.18MB** | **11.05MB**（+79%） |
- 体积来源：`MAIN_MODULE=1` 不做 DCE（所有符号保留并导出）；那 29.8MB 的 JS 是
  dylink 符号表，几乎全是 C++ mangled 名，压缩率极高（→1.81MB）。
- 首帧 ready：863ms → 1136ms。
- **可选优化（未做）**：`MAIN_MODULE=2`（DCE 版）+ 显式 `EXPORTED_FUNCTIONS` 只留
  .oct 需要的符号，应能同时压缩两份；代价是要维护导出清单。

### 已采用（2026-09-20 拍板）
用户决定采用：**贴近原版 Octave 的插件模型优先于体积**，整站 gzip 后交付。
基线 8761 已换成该构建（实测 **20/20**），交付包见 HANDOFF §2.1.1。
主链 flag 已同步进 `build/Makefile`（`MAIN_MODULE=1` + `-fPIC`，含回退说明）。

直接后果：**新 dldfcn 模块可以只编 `.oct` 运行时加载，不必重链那 38MB 主 wasm**
（`build/build_oct.sh` 一条命令），这正是采用它的主要理由。
反向约束：重编 Octave 本体或静态库必须走 `build/reconf-pic.sh` +
`build/rebuild-pic-libs.sh`，否则非 PIC 对象会让主链链接失败。

### 附：MAIN_MODULE=2（DCE 版）实测 —— 体积能压回来，但会崩

`-s MAIN_MODULE=1` 换成 `-s MAIN_MODULE=2` 重链，体积立刻回到基线水平：

| | MAIN_MODULE=1 | MAIN_MODULE=2 | 基线(非 LINKABLE) |
|---|---|---|---|
| octave.wasm | 37.9MB | **22.8MB** | 20.5MB |
| octave.js | 29.8MB | **248KB** | 230KB |

**但跑不起来**：浏览器里 `Starting GNU Octave interpreter...` 之后直接
`RuntimeError: null function`，主线程随后卡死（`page.evaluate` 不再返回）。
原因就是 M2 的定义——正常做 DCE，不在导出清单里的函数被删掉，dylink 解析到空槽。

**要让它可用**：得给主链显式 `-sEXPORTED_FUNCTIONS`，把 `.oct` 会 import 的符号
全部列进去。可自动生成：编完所有 `.oct` 后从其 `dylink.0` 段读出 imported symbols，
去重加下划线前缀喂给主链。**这是一份需要维护的清单**（每加一个 dldfcn 模块都要重生成），
所以这是「用维护成本换 15MB 体积」的取舍，本轮未做。

## 批次 1（2026-09-20）：HDF5 → `save/load -hdf5`，并顺带解决 CXSparse「too old」

一批两个成果。主链：wasm 37.9→45.1MB、js 29.8→30.8MB；8761 验收 19/19 回归 + 16/16 专项。

### HDF5 1.14.2（静态 PIC，zlib 支持）

- 取包：`https://support.hdfgroup.org/ftp/HDF5/releases/hdf5-1.14/hdf5-1.14.2/src/hdf5-1.14.2.tar.gz`
  （**GitHub releases 的命名是 `hdf5-1_14_3.tar.gz` 下划线风格且没有 1.14.2**；官方 FTP 才有 1.14.2。
  1.14.5+ 有 `FE_INVALID` 破坏 wasm 浮点环境的问题，故钉 1.14.2。）
- **坑 1：cmake ≥ 3.18**。发行版自带 3.16.3，HDF5 1.14 直接拒。
  装法：cmake.org 官方包 → `/opt/cmake-3.27.9-linux-x86_64` + `/usr/local/bin/cmake` 软链（**已烘进镜像 `pic-oct2`**）。
- **坑 2（最关键）：`H5Tinit.c` / `H5lib_settings.c` 是构建期"运行程序"生成的**，
  而 emscripten 的 node 运行时用 **MEMFS**——`H5detect.js H5Tinit.c` 退出码 0、却什么都没留下。
  现象是 `make` 报 `No rule to make target 'src/H5Tinit.c'`。
  **解**：这两个程序**不带参数时写 stdout**，所以先手工预生成，cmake 的
  `if (NOT EXISTS "${HDF5_GENERATED_SOURCE_DIR}/H5Tinit.c")` 就会跳过生成分支：
  ```sh
  cd /tmp/h5build/src
  node /tmp/h5build/bin/H5detect.js           > H5Tinit.c          # 8327 字节 / 244 行
  node /tmp/h5build/bin/H5make_libsettings.js > H5lib_settings.c   # 1320 字节
  # 然后重跑一次 cmake（让 EXISTS 检查生效）再 make
  ```
- 配置（`emcmake cmake`）：`BUILD_SHARED_LIBS=OFF`、`HDF5_ENABLE_Z_LIB_SUPPORT=ON`、
  `BUILD_TESTING/HDF5_BUILD_TOOLS/HDF5_BUILD_EXAMPLES/HDF5_BUILD_CPP_LIB/HDF5_BUILD_FORTRAN=OFF`、
  `CMAKE_C_FLAGS=-fPIC`、`CMAKE_CROSSCOMPILING_EMULATOR=<node>`。
  zlib 自动从 emsdk sysroot 找到（`libz.a` 1.2.12）。
- 终链：`build/Makefile` 的 `EM_LDFLAGS` 加 **`-lhdf5`**；产物 `libhdf5.a`(23.5MB) + `libhdf5_hl.a`。
- 验收实据：`save -hdf5` 往返（矩阵/字符串/struct）、`whos -file`、带 `-z` 压缩的 100×100、
  且**文件头是真 HDF5 魔数 `89 48 44 46 0d 0a 1a 0a`**。
- ⚠️ 能力边界（写进需求书修订）：这是 **Octave 原生 HDF5**，**不等于 MATLAB v7.3 `.mat` 互操作**——
  Octave 7.2 本身就没实现 v7.3。

### CXSparse：configure 的「too old」是假失败，一行修好

- 现象：`--with-cxsparse` 时报 `CXSparse library is too old (< version 2.2)`，
  而 `target/include/cs.h` 明明是 `CS_VER=3 / CS_SUBVER=1`、`target/lib/libcxsparse.so.3.2.0` 也在。
- 真因：`m4/acinclude.m4` 的 `OCTAVE_CHECK_CXSPARSE_VERSION_OK` 用 **`AC_PREPROC_IFELSE`（纯预处理）**，
  而它只吃 **`CPPFLAGS`**；本仓的 `-I target/include` 一直只写在 `CFLAGS/CXXFLAGS` 里 →
  预处理时 `#include <cs.h>` 找不到头 → 判为"版本太老"。
- 修：`build/reconf-pic.sh` 里加一行 **`CPPFLAGS="-I$INCDIR"`**，并恢复
  `--with-cxsparse --with-cxsparse-includedir/-libdir`。**一次 configure 即过**
  （`HAVE_CS_H` / `HAVE_CXSPARSE` / `HAVE_CXSPARSE_VERSION_OK` 全部 define）。
- 实测：稀疏反斜杠、稀疏 LU、稀疏 QR 全部工作。两个**行为边界**（非缺陷，桌面版同）：
  1. `qr(s,0)` 经济模式在 CXSparse 后端不支持（报 `sparse-qr: economy mode with CXSparse not supported`）；
  2. `[Q,R,P]=qr(s)` 的 `P` 返回空——但恒等式 **`s = Q*R` 成立（残差 7e-15）**，这才是实质判据。

## 批次 2B（2026-09-20）：Forge 包的**编译件** → wasm side module

19 个 `.oct` 进入懒加载车道，5 个包因此完整可用；验收 15/15（含真数值）。

| 包 | 编出 | 关键函数 |
|---|---|---|
| struct | 4 | fields2cell/fieldempty/structcat/cell2fields → `getfields` 可用 |
| optim | 5 | __bfgsmin 等 → `bfgsmin`/`fminunc` 真收敛（实测到 [1 2] 与 3） |
| statistics | 7 | libsvmread/write、svmtrain/predict、fcnntrain/predict、editDistance |
| geometry | 1 | polybool_mrf |
| miscellaneous | 2 | cell2cell、partint |
| tsa / nan | 0 | 源是 **MEX**（`mexFunction`），需 mex 运行时 → 明确不做 |

工具：`build/build_pkg_oct.sh <包目录> <输出目录>`（容器内跑），产物由
`assets.py` 收成 `kind=octdir` 资产，并**自动成为该包的依赖**（`load("struct")` 会先装 `struct-oct`）。

### 七个坑（挨个踩过，照抄别再踩）

1. **autoconf 在容器里跑不了编译器自检**：包的 configure 会编译并**运行**一个探针，
   wasm 产物在 Node 14 下跑不动 → `C++ compiler cannot create executables`。
   `--host=` 无效（这些包的 `configure.ac` 没有 `AC_CANONICAL_HOST`），
   `EMCONFIGURE_JS` 在 emsdk 3.1.24 已废弃 → 给生成的 `configure` 打一行补丁：
   `cross_compiling=${CROSS_COMPILING:-no}`，再用 `CROSS_COMPILING=yes` 跑。交叉模式下 autoconf 跳过所有 run-test。
2. **emcc 不带 `-o` 时产出 `a.out.js`**，而 autoconf 找的是 `a.out` → 加 CXX 包装器
   `emxx`（跑完 em++ 后补一个 `a.out` 壳脚本）。
3. **包的 configure 会用 `mkoctfile -p CXX` 覆盖你传的 CXX** → `mkoctfile` 垫片必须
   返回**包装器路径**而不是 `em++`，否则坑 1 复发。
4. **包 configure 要 `mkoctfile`/`octave-config`**，而我们装出来的那两个是坏脚本
   （变量没替换，跑起来 `//: Is a directory`）→ 垫片只回答 `-p` 查询。
   `miscellaneous` 还要宿主 `units` 程序（走代理 `apt-get install units` 真装上了）。
5. **交叉模式下版本自适应宏全判错**：包的 `config.h` 里 `OCTAVE__*`/`OV_*` 会选到老式符号。
   按本仓头文件实测纠正（附行号证据）：`feval`→`octave::interpreter::the_interpreter ()->feval`
   （interpreter.h:381-400）、`isnan`→`octave::math::isnan`（lo-mappers.h:178-182）、
   `identity_matrix`→`octave::identity_matrix`（utils.h）、
   `symbol_table::find_function`→`...->get_symbol_table ().find_function`（symtab.h:105-115）、
   `is_cell/is_map/is_numeric`→`iscell/isstruct/isnumeric`、`rand_uniform`→`octave::rand_uniform`。
   configure 仍失败时按这套值**合成 config.h**（兜底已内建在脚本里）。
6. **别把 `src/` 里所有非 DEFUN 源都当 helper**：`statistics` 的 `svm.cpp` 只能并进
   `svmtrain/svmpredict` 两个模块，无脑并进所有模块会 `duplicate symbol`。
   解：**优先读包自带的 `src/Makefile` 的分组**（`$(MKOCTFILE) a.cc b.cc` 那一行就是作者的意图），
   读不到才退化为启发式。
7. **`.oct` 必须挂到 path 上**：`kind=octdir` 资产把文件写进 `<包根>/oct/` 并 `addpath` 它；
   包自身的 `PKG_ADD`（含 `## PKG_ADD:` 抽取）负责子目录。

## 批次 3（2026-09-20）：SUNDIALS 6.1.1 → `ode15s`/`ode15i`（R1）

**主 wasm 一个字节没动**——这是"`.oct` 架构"最漂亮的一次兑现：SUNDIALS 的静态码
全部打进 `.oct` 内部，主模块零增长、零重链。

- 取包：`https://github.com/LLNL/sundials/releases/download/v6.1.1/sundials-6.1.1.tar.gz`（81.8MB，走代理）
- 构建：`emcmake cmake` + `SUNDIALS_PRECISION=double`、`SUNDIALS_INDEX_SIZE=32`、
  `BUILD_IDA=ON`/`BUILD_IDAS=OFF`、`BUILD_SHARED_LIBS=OFF`、`EXAMPLES_ENABLE_*=OFF`、
  `BUILD_TESTING=OFF`、**`BUILD_FORTRAN_MODULE_INTERFACE=OFF`**（f2c 约束在这里天然绕开）、`CMAKE_C_FLAGS=-fPIC`
- **坑 1：`check_type_size` 在交叉编译下全空** → 报 `No integer type of size 4 was found`。
  解：直接预置它的判据缓存变量 `-DHAS_int32_t=4 -DHAS_int=4 -DHAS_long=4`
  （源码 `cmake/SundialsIndexSize.cmake` 正是读 `HAS_<type> EQUAL 4`）。
- **坑 2：`-lsundials_ida` 已自带全部依赖**（35 个成员含 nvector/sunlinsol/sunmatrix/generic）——
  再叠加 `-lsundials_nvecserial` 会 `duplicate symbol: N_VGetVectorID_Serial`。**只链 ida 一个库**。
- **不开 configure 也能编 `__ode15__.cc`**：它的门禁宏在 `config.h` 里全是 `/* #undef */`（纯注释），
  所以编译时用命令行 `-D` 打开即可：
  `HAVE_SUNDIALS{, _IDA, _NVECSERIAL, _SUNCONTEXT, _SUNLINSOL_DENSE}` +
  头门禁 `HAVE_{NVECTOR_NVECTOR_SERIAL_H, IDA_IDA_H, IDA_IDA_DIRECT_H, SUNLINSOL_SUNLINSOL_DENSE_H}` +
  新 API shim `HAVE_IDASETJACFN`/`HAVE_IDASETLINEARSOLVER`/`HAVE_SUNLINSOL_DENSE`
  （**不要**定义 `HAVE_SUNDIALS_SUNLINSOL_KLU`/`HAVE_SUNKLU`，KLU 第一版关掉）。
- 产物 `__ode15__.oct` 568KB（自包含），作为 `kind=oct` 资产懒加载。

**实测（浏览器）**：装载前 `exist("__ode15__")=0`、装载后 `=3`；
- `y' = -1000(y-cos t) - sin t`（**精确解 y=cos t**）：默认容差 max 误差 9.2e-05，
  收紧到 RelTol=1e-8 后 **1.1e-08**；
- Van der Pol μ=1000 跑通且解有界；
- `ode15i` 隐式求解误差 1.75e-04（默认）/ <1e-6（收紧）；
- `ode45`/`ode23`/`lsode` 无回归。
验收 14/14：`test/browser/accept-ode15.mjs`。

## 批次 4（2026-09-20）：R6 压缩/归档，无 shell 化

原来 `zip/unzip/tar/untar/gunzip/bunzip2` 全是 `.m` 包装，最终调 `system("unzip …")` ——
wasm 里必失败。现在换成**进程内实现**：`build/webio.cc` 编成 `webio.oct`（44KB，
自包含，只用 zlib/libbz2 的符号——由主模块在 dlopen 时解析），上层的 6 个 `.m` 覆写
（`webshell` 资产）保持原接口契约。

- zip/tar 格式**自己实现**：zip 走 zlib 的 raw deflate/inflate + 中央目录 + EOCD；
  tar 走 ustar（含 prefix 分裂与 GNU long name）。
- gzip/bzip2 内建本来就可用（进程内），坏的只是 gunzip/bunzip2 包装。

### 两个坑

1. **Octave 按文件名找 `.oct` 模块**：一个模块里导出的函数若与文件名不同名，
   必须像桌面版那样建**符号链接**（桌面版 `bzip2.oct -> gzip.oct`）。
   `webio.oct` 里 6 个内建第一次全部失联就是这个原因。loader 已支持 `aliases`
   （manifest 里声明 → 加载时 `FS.symlink`）。
2. **`octave_value(string_vector)` 得到的是字符矩阵**（等长填充），不是 cellstr；
   上层 .m 契约要 cellstr（`numel == 文件数`）→ 必须显式构造 `Cell`。

**实测**（浏览器 20/20）：gzip/gunzip、bzip2/bunzip2 内容往返正确；
zip/unzip 与 tar/untar 的**二进制文件字节级一致**（`isequal(fileread(…))` 为 1）；
目录递归打包可用。验收：`test/browser/accept-archive.mjs`。

## 批次 5（2026-09-20）：R4 图像 I/O（stb_image 后端）

`imread`/`imwrite`/`imfinfo` 在本构建里原本走到 ImageMagick 分支直接报
"support for ImageMagick was unavailable"。现在换成 **stb_image / stb_image_write**
（单头文件，public domain/MIT）：`build/webimage.cc` → `webimage-oct.oct`（151KB，
stb 编进去，自包含），经 **`imformats("add", …)` 注册**进正常分派链——这是关键，
不改 `imread.m`/`imwrite.m` 一行，`imageIO` 会照常按扩展名找到我们的 read/write/info 句柄。

- 支持：PNG/JPEG/BMP/TGA/GIF/PNM/HDR/PSD 读，PNG/JPEG/BMP/TGA 写。
- **坑 1（通用，影响所有 PKG_ADD 型资产）**：Octave 在 `addpath` 时会**自己执行**目录里的
  `PKG_ADD`；loader 起初又手动 `run()` 了一遍 → 注册两次 → `imformats("png")` 返回两条 →
  `imwrite` 里 `fmt.write(varargin{:})` 报 `a cs-list cannot be further indexed`。
  **解**：loader 不再手动 run（Octave 本来就会跑），且注册写成幂等。
- **坑 2**：`imwrite` 的分派是 `fmt.write (varargin{:})`，即 **(图像, 文件名, …)** 顺序——
  与 `imread` 的 (文件名, …) 相反。写句柄里按类型自适应最省事。
- **坑 3**：本构建 `__magick_formats__` 返回空表，所以默认格式表本来就是空的，
  我们注册的就是唯一后端（这也是为什么注册路径这么干净）。

**实测**（浏览器 17/17）：PNG 灰度/彩色**像素级一致**、BMP/TGA 无损一致、JPEG 有损往返、
`imfinfo` 出 Width/Height/NumberOfChannels、读回的图能参与数值运算再写回。
验收：`test/browser/accept-image.mjs`。

---

## 批次 6（2026-09-20）：R9 `print -dsvg` + plot 桥 marker 修复

`print`/`saveas` 由 `build/plotbridge/{print,saveas,__svg_render__}.m` 接管
（plotbridge 在 path 最后 addpath，优先级高于 `m/plot/util/print.m`）。
核心 `print.m` 在本构建必死：要么没有真 graphics handle，要么走
`__gnuplot_print__` → `system(pipeline)`（无 shell）。**不引入 gnuplot、不引入 Asyncify**：
`__svg_render__.m` 直接读全局 `__pb__` 状态与 `/tmp/pbN.dat`，同步产出完整 SVG 文档。

- 支持：坐标框/刻度/网格、title/xlabel/ylabel、legend（18 个 Location）、
  lines / linespoints / points / stem / boxes、8 色字母+RGB、dt 1–4 线型、
  完整 marker 表（`.`/`o`/`s`/`d`/`^`/`v`/`>`/`<`/`p`/`h`/`+`/`x`/`*`）、
  logx/logy（10 的幂刻度）、xlim/ylim、viewBox + 白底。
- **CJK 无需字体资产**：SVG 的 `font-family` 交给浏览器解析（gnuplot 路线的字体短板在这里不存在）。
- `-dpng/-dpdf/-deps` 等给**可操作报错**（不再是无从下手的 `'gs' binary is not available`），
  并提示 `-dsvg` + 页面 canvas 转位图。
- 验收：`test/browser/accept-print.mjs`（用浏览器自己的 `DOMParser` 严格解析，数图元）。

### 坑 1（**Octave 语言级，值得单独记牢**）：方括号拼接里 `f (args)` 被当索引
```octave
out = [out, __svg_series__ (s, args...)];   # ← 解析失败：syntax error
```
在 `[ ]` 拼接上下文里，**标识符后带空格再接 `(`** 被 Octave 解析为**索引**而非函数调用；
函数名不能被索引 → 整个文件 parse error。报错定位极具误导性（caret 指向实参中间，
且位置随无关编辑漂移）。**解**：先绑定再拼接
```octave
frag = __svg_series__ (s, args...);
out = [out, frag];
```
或去掉空格写 `f(args)`。已在 `__svg_render__.m` 注释里标记。

### 坑 2：单引号与双引号字符串**不能**相邻拼接
`x = '<g>' "\n";` 是 C 的写法，Octave 里是 parse error。用 `sprintf` 或 `[...]` 拼接。

### 顺带修复：plot 桥 marker 从未传到 JS
`__pb_emit__.m` 的 series JSON 漏了 `marker` 字段，而 `bridge/plotbridge.js` 读 `sr.marker`
→ `ptOf(undefined)` 恒为 6 → **所有 `'s'/'d'/'^'/...` 静默退化成空心圆**（`'--ro'` 恰好是 `o`
所以一直没暴露）。现在 emit 补上 `"marker":%s`，gnuplot 路线与 SVG 路线同时受益。

---

## 批次 7a（2026-09-20）：plot 桥 v2 —— 2D 图型 + subplot/figure(n)/axis

新增 `build/plotbridge/{barh,stairs,area,errorbar,pie,subplot,axis}.m`，
`figure.m`/`clf.m` 重写为真多图，`__svg_render__.m` 重写为支持 panel 网格。
验收：`test/browser/accept-plotv2.mjs`（54 项，含 v1 全图型回归）。

- **barh/stairs/area/pie 在 Octave 侧把几何算好**（水平条=矩形、阶梯=折线、
  面积=闭合多边形、饼图=扇形多边形），下游两个渲染器（gnuplot SVG、纯 .m SVG）
  都不用加新图元——**能在一侧归一化的，就不要在两个渲染器里各实现一遍**。
- **errorbar** 走三元组约定：(x,ylo) (x,y) (x,yhi) 三个连续点 = 一根带帽的竖线，
  分组信息藏在点序里，省掉 JSON schema 变更。
- **subplot/figure(n) 用"活动项镜像在平铺字段、非活动项存 panels{}/figs{}"**：
  所有既有垫片照旧读写平铺字段，无需知道 panel 的存在。
  坑：`panels{active}` 只在切换时写入，**画完就过期** → emit/render 前必须先
  `__pb_panel_fields__` 刷新一次（否则活动 panel 画的还是上一次的内容）。

### 坑 3（**Octave 语言级，与坑 1 同源但更隐蔽**）：`{}`/`[]` 字面量内的带空格调用
```octave
boxes{k} = {round (p(1) * W), round (p(3) * W)};   # ← 运行时报错，不是 parse error
```
和坑 1 是同一条规则（字面量里 `f (x)` 被当索引），但在 `{}` 里表现为**运行时**
失败，且错误信息指向 `print_usage`/docstrings 一类完全无关的地方：
```
failed to open docstrings file: …/etc/built-in-docstrings
error: called from print_usage at line 62 → __svg_panel_boxes__ at line 27
```
定位花了很久。**规则**：`[]`/`{}` 字面量里出现的每一个函数调用，要么去掉空格
（`round(x)`），要么先绑定到临时变量。已在 `__svg_panel_boxes__.m` 里注释标记。

### 坑 4：Octave 只按文件名解析**第一个**函数
一个 `.m` 文件里写多个 `function`，**只有第一个能被外部按文件名调用**，其余是
文件私有子函数。把 `__pb_stash_panel__` 之类的辅助函数和主函数写在同一个文件里，
调用方会得到 `'xxx' undefined`。**规则**：所有需要跨文件调用的函数各占一个文件，
文件名 = 函数名。`__svg_render__.m` 里的 15 个内部子函数（`__svg_mapx__` 等）
保持私有是有意的——它们只在该文件内用。

### 坑 5（旧 bug，v2 顺手修）：`plot (Y, SPEC)` 解析错
四个 shim（plot/semilogx/semilogy/loglog）各有一份手写的参数循环，都写成
"倒数第二个参数是 X、最后一个是 Y"，于是 `plot (y, "-r")` 变成 `x=y, y='-r'`
→ `horizontal dimensions mismatch (5x1 vs 2x1)`。现在统一走
`__pb_parse_series__.m`：**尾随字符串是它前面那条曲线的 line spec，绝不是数据**。

---

## 批次 7b（2026-09-20）：plot 桥 v2 —— 3D（plot3/scatter3/mesh/surf/contour）

**3D 在 Octave 侧投影成 2D**（`__pb_project3__`，固定方位角 -37.5°/仰角 30°，
即 Octave 默认视角），下游两个渲染器（gnuplot SVG、纯 .m SVG）**一行都不用改**，
`print -dsvg` 对 3D 天然可用。这是 v2 最省事的一步：能在一侧归一化的几何，
不要在两个渲染器里各实现一遍。

- **mesh/surf**：每格投影成一个闭合多边形；用**画家算法**（按视深排序）近似消隐，
  远的先画。够教学用；不是 z-buffer，互相穿插的面片仍会看错。
- **contour**：per-cell marching squares（找边交点连成线段），
  `contour(Z)` / `contour(Z,N)` / `contour(Z,V)` / `contour(X,Y,Z,…)` 全支持。
  默认 8 层，每层一个循环色（`__pb_cycle_color__`）。
- **scatter3**：`SIZE`/`COLOR` 向量接受但只用首个（一条 series 一个标记尺寸）。
- 验收：`test/browser/accept-plot3d.mjs`（34 项）。

## 批次 8（2026-09-20）：R8 WebAudio 播放侧（**零编译**，纯 .m 资产）

`audioplayer` 原本在 `libinterp/dldfcn/audiodevinfo.cc` 里（要 PortAudio），本构建关掉了。
**18 个 `__player_*` 全部用纯 `.m` 重写**（`build/webaudio/*.m`，一个函数一个文件），
打包成懒加载资产 `assets/m/webaudio.js`（22KB / 26 个 .m）——
**不动主 wasm、不编 .oct、不引入 PortAudio**。

为什么纯 .m 就够：这 18 个"内建"全都只是收一个**不透明句柄**再读写属性。
句柄做成 `struct("Id", k)`（k 是全局表下标），Octave 的 `@audioplayer` classdef
原样工作，`__get_properties__.m` 那 8 个 getter / `set.m` 那 3 个 setter 一次满足。

- **播放交给页面**：`play` 把动作追加到 `/tmp/pba_queue.txt`（制表符分隔：
  `id  action  from  to  rate  channels`），样本预先以**行交错 double** 落到
  `/tmp/pba_<id>.f64`；`bridge/webaudio.js` 轮询队列 → `AudioContext` +
  `AudioBufferSourceNode`（**不用 AudioWorklet**：本构建无真线程）。
- **AudioContext 推迟到首次 drain**：浏览器要求用户手势，且原版构造期要求设备数 ≥1。
- 通道数必须**随队列一起传**：页面只读得到裸 `.f64`，没有别的途径知道一帧几个值。

### 坑 7：`Running` 属性只有 on/off，没有 paused
`__get_properties__.m` 是 `if (__player_isplaying__ (…)) "on" else "off"`，
所以暂停后 `p.Running` 显示 **off** 是**正确的**（与桌面版一致）。
`"paused"` 只是内部状态（供 `resume` 判断），不要拿它去断言 `Running`。

### 坑 8：短素材测状态机 = 测"播完了"
验收里用 1 秒素材测 `isplaying`，而每次 `eval_string` 之间隔 550ms，
跑到断言时音频早播完 —— `isplaying` 正确地返回 0。**状态机类断言要用长素材**
（本套件用 10 秒），否则测的是别的东西。同理：验收要先 `clearInterval` 掉
`OctaveAudio.init()` 的轮询，否则后台 drain 会抢在断言之前消费队列。

## 批次 9（2026-09-20）：R5 —— **真·同步 urlread/urlwrite/webread/websave（无 Asyncify）**

原计划分两步：R5-A 只做页面侧异步 fetch 桥，R5-B 才去试 Asyncify 换同步。
**实际一步到位**：同步 XHR 在 wasm 里就能做，Asyncify 用不上了。

- **后端** `build/webnet.cc` → `webnet-oct.oct`（9.4KB side module，零主链改动）：
  `__web_fetch_sync__` 用 `XMLHttpRequest` 的**同步模式**（`open(..., false)`），
  响应体写进 MEMFS（`/tmp/webnet_last`），状态码/Content-Type/错误各写一个文件。
- **前端** `build/webnet/*.m`（9 个）：`urlread`/`urlwrite`/`webread`/`websave`
  **压过 builtin**——Octave 的查找顺序是 autoload → **path 上的函数** → package →
  builtin（`fcn-info.cc:811-834`），所以同名 `.m` 放在 path 上就接管了，
  与 plot 桥压 `print` 同一机制。
- **页面侧** `bridge/webnet.js`：`OctaveNet.prefetch/get/getBytes` 走原生 `fetch`，
  写进**同一组 MEMFS 路径**，所以 prefetch 过的 URL 之后被 `urlread` 命中暖数据。
- 验收：`test/browser/accept-net.mjs` 30/30（同源硬断言 + 1MB 二进制字节完整 +
  POST + 404 路径 + JSON 解码）；外网访问只作信息性检查（跨域取决于对方 CORS）。

### 坑 9：`EM_ASM` 在 side module 里**不可用**
```
error: EM_ASM is not supported in side modules
```
原因：EM_ASM 的 JS 体会在**链接期**被拼进主模块的胶水，而 side module 没有那个阶段。
**替代**：`emscripten_run_script()` 是主模块导出的普通库函数，从 side module 可调用；
JS 以字符串传入。参数传递用**写 MEMFS + JS 读回**（一个 `const char*` 装不下
URL+method+body 三样，硬塞进 JS 字面量还要做转义）。

### 坑 10：同步 XHR **不能设 `responseType`**
```
InvalidAccessError: Failed to set the 'responseType' property on 'XMLHttpRequest':
The response type cannot be changed for synchronous requests made from a document
```
要拿字节就用 `overrideMimeType('text/plain; charset=x-user-defined')` +
`responseText`，再 `charCodeAt(i) & 0xFF` 逐字节还原。这样二进制（wasm 魔数等）
完整无损——已用 1MB 的 `octave.wasm` 实测。

### 坑 6：循环边界变量被内层分支覆盖
`plot3 (Y)` 单参数分支里写了 `n = numel (z);` —— 而 `n` 正是驱动外层
`while (i <= n)` 的参数个数。赋值后循环跑过数组尾端，报
`args(2): out of bound 1 (dimensions are 1x1)`。
**规则**：参数解析循环里的循环上界变量，永不在循环体内复用同名。

---

## 批次 12（2026-09-20）：signal + control 包（R2 补完），以及 **SLICOT side module 崩溃**

R2 的验收标准点名 statistics / optim / **signal** / **control** 四个包冒烟通过。
前两个批次 2A/2B 已做，这里补后两个。

- **signal 1.4.6**（181 个 .m，纯脚本）：**完全可用**。`butter`/`cheby1`/`fir1`/
  `freqz`/`filtfilt`/`hilbert`/`kaiser` 等真算通，低通直流增益 = 1、高通 = 0
  这类数值都对。
- **control 4.1.3**：314 个 .m **可用**；56 个 SLICOT 编译件编出来了，但
  **一调用就崩**（见下）。
- 打包：`build/assets.py bundle-pkg`（signal 913KB / control 1.37MB js），
  编译件走 `octdir`（`build/build_pkg_oct.sh`）。依赖链
  `signal → control → control-oct` 由 gen-manifest 自动串起。

### 坑 11：control 的 SLICOT `.oct` 在 `MAIN_MODULE=1` 下是**地雷**（架构级）

现象：`ss(G)` / `step(G)` / `tf2ss(...)` 一调用，wasm 直接抛
```
TypeError: Cannot read properties of undefined (reading 'apply')
    at stubs.<computed> (octave.js:9:127611)
    at wasm://wasm/...:wasm-function[43]
```
整个页面死掉，后续 eval 全部不可用。

根因链：
1. 这些 `.oct` 链接时 `-sSIDE_MODULE=1` 且**不链库**（本项目的既定做法），
   它们对主模块 Fortran 符号的引用按**自己的声明**编成了导入。
2. 主模块里那些符号（`zdotu_` 等）的**实际签名不同** —— 这一点 `wasm-ld`
   在每次主链链接时都警告过：`function signature mismatch: zdotu_`
   `>>> defined as (i32,...) -> f64 in libqrupdate.a` vs
   `>>> defined as (...) -> void in librefblas.so`。
3. 静态注册表（`STATIC_DLD_FCNS`）那条路不受影响，因为它把 `.o` 编进主链、
   走同一次链接——签名由链接器统一。**side module 这条路没有这个统一过程。**
4. `emscripten` 的 dylink 对不匹配的导入不做保护，直接跳进错误签名 → `stubs.apply`
   取到 undefined。

**结论（不做什么）**：不试图修。要修得给 side module 链一份符号签名表，
或让所有 Fortran 库的签名在主链里统一（那会动到已验证的 PIC 基线）。
代价与收益不成比例。

**已做的处置**：
- signal 全量发布（纯 .m，无此问题）。
- control 只发布**纯 .m 部分**（tf/tfdata/dcgain/pole/zero/feedback/bode/... 全都
  正常）；**56 个 SLICOT `.oct` 不上线**，免得用户一调 `step` 就把页面弄崩。
- 验收 `accept-forge2.mjs` 覆盖 signal 全量 + control 的可用面，
  并把"哪些 control 函数不可用"写成断言（防止将来误以为好了）。

**将来若要修**：先做一次最小实验——把某个 SLICOT `.oct` 改成**静态注册**
（进 `STATIC_DLD_FCNS`）看是否可用。若可用，说明结论是"side module 的符号签名
不可靠"，那么所有需要主链 Fortran 符号的包都要走静态注册（要重链主 wasm）。

---

## 批次 T1（2026-09-21）：`help` 可读 —— 构建期 makeinfo 预渲染（第三轮）

**需求**：`help NAME` 要能看。这是学生第一个会打的命令。

**问题**：`help NAME` 对所有走 texinfo 渲染的输入都报
`system: unable to start subprocess for 'makeinfo …'`。上游 `__makeinfo__.m:155`
最后一步是 `system()` 起 makeinfo 子进程，而本构建**没有 shell**（有意为之，
见 HANDOFF §7）。只有 `.m` 文件的 plain-text docstring 能看（`help plot`）；
内建函数的 docstring 在 C++ `DOCSTRINGS` 表里、标记为 texinfo，全部失败。

### 关键认识：makeinfo 不该被"替代"，而该被"提前调用"

**`help` 的文本就是 makeinfo 的输出** —— 这是官方行为，不是实现细节：

- `scripts/help/help.m:100-115`：docstring 格式为 `texinfo` 就调 `__makeinfo__`
- `scripts/help/__makeinfo__.m:155`：执行
  `makeinfo --no-headers --no-warn --no-validate --plaintext --output=- FILE`

makeinfo 是 **Perl 程序**，wasm 里没有 Perl，也没有那个可执行文件 —— 但**它的输出是
确定性的**：同一份 docstring + 同一份 `macros.texi`，在任何机器上渲染结果一致
（实测宿主 texi2any 7.3 与容器 6.7 输出**逐字相同**）。所以渲染挪到**构建期**用真
GNU makeinfo 做，运行时只读结果。

**这不是本项目发明的招数**：Octave 自己就这么干。`doc/interpreter/mk-doc-cache.pl:102`
在构建期调 makeinfo，把渲染好的纯文本写进 `doc-cache`。本批次是同一技术用在
`built-in-docstrings` 上。

### 怎么让 `help` 用上它：不加一行运行时代码

不改 `.m`、不覆写任何函数，靠的是 Octave **自己的格式判定**：
`libinterp/corefcn/help.cc:141` 的 `looks_like_texinfo()` **只检查第一行是否含
`-*- texinfo -*-`**：

```cpp
std::size_t p2 = t.find ("-*- texinfo -*-");
return (p2 != std::string::npos);
```

把这行标记去掉，格式（`help.cc:400`）就判成 `plain text` → `help` **直接打印、
根本不调 makeinfo**。也就是说：**渲染由 makeinfo 做（官方产物），只是提前做了**。

### 产物与工具

- **`build/render-docstrings.py`**（新，进仓库）：宿主侧构建期渲染。
  与上游 `__makeinfo__.m:130-132` 同序：`\input texinfo` → macros → 正文 → `@bye`
  （顺序错了 makeinfo 会把 `\input texinfo` 当普通文本印出来），
  渲染后做与上游 `:161-174` 相同的收尾（`" -- : "` → `" -- "`、去尾部空行）。
  失败的条目**保留原文并去标记**（宁可印得难看，也不能让函数没 help），并报数。
- **实测**：**894/896 条**渲染成功，2 条失败的是 `methods`/`properties`
  —— 它们在源文件里就是 `@c #` 注释状态（被真正的同名函数 docstring 覆盖），
  桌面版也拿不到，保留原文是正确行为。
- 体积 641321 → 577573 字节。

### 让它在浏览器里生效

`built-in-docstrings` 原本是**按需**懒加载资产；而 `help` 属于"开箱就该能用"，
所以 `bridge/index.html` 的启动序列里加了一组随页面装载
（`built-in-docstrings` + `doc-cache`，约 2.5MB）。装不上不算致命（有清晰告警）。

### 验收

`test/browser/accept-help.mjs`（**12 项，12/12 绿**），关键几条：

- `which("__makeinfo__")` **必须**指向核心文件 —— 证明没有覆写（官方性护栏）
- `help sin` 出正文且**不含** `@deftypefn`/`@var{`/`@seealso` 原始标记
- `help disp` 的 `@example` 块变成正文（`the value of pi is` 可见），无 `@print{}`
- `help("sin")` 返回字符串、`help 未知函数` 清晰报错
- 回归护栏：`help plot`（.m 路径）、`lookfor`、`get_first_help_sentence`、`disp(@sin)`

### 走的弯路的记录（**下个会话别重试**）

**先试过"自研 texinfo→纯文本渲染器"**（覆写 `__makeinfo__.m`，7 个 `.m` 文件、约
700 行）。**这条路是错的，已全部删除**。错在：把"宿主组件不可用"当成"要重新实现
宿主组件"，而不是"把它挪到构建期"。官方 `mk-doc-cache.pl` 就在仓库里示范了后一条。

代价：那一版踩了 4 个坑（下面两个新坑 + 括号失配 + 多函数同文件），
而且自研渲染器**永远是另一个需要维护的实现**——真 makeinfo 的输出才是标准。

**教训**：遇到"宿主能力在 wasm 里不可用"时，先问**这件事能不能提前做**，
再问"要不要自己写一个"。前者往往有官方先例。

### 坑 12：两个"静默不报错"的 Octave 语言特性

**12a. `case {...}` / 函数实参里的 cell 字面量不能跨行。**
```octave
case {"code", "qcode",          # ← 这行没有闭 }
      "key", "var"}             # ← 被当成**另一条语句**
```
不是 parse error：`case` 拿到的是**第一行那个不完整的 cell**，匹配失败后静默走
`otherwise`；若在 `strcmpi` 实参里，`any(strcmpi('x', {...跨行...}))` 会返回一个
**逻辑向量而不是标量**，于是 `if` 的行为错乱。症状是"处理结果莫名其妙不全"，
与括号无关，极难归因。**规则**：cell 字面量一律写成一行。

**12b. Octave 的 regexp 不支持 `\b`。**
```octave
regexp (line, '^@deftype(fn|fnx)\>')   # ✔ 词尾边界
regexp (line, '^@deftype(fn|fnx)\b')   # ✘ 恒不匹配，且不报错
```
`\b` 在这里**没有任何含义**（不报错、不匹配）。代价：`@deftypefn` 分支整块不触发，
docstring 原样吐出，而**当时的自测全过**——因为自测只断言了"不是 makeinfo 错误"，
没断言"正文对不对"。**教训：断言要检查正文内容，不能只检查"没报错"。**

### 顺手留下的工具：`build/check_m.py`

宿主 Octave 上做 `.m` 语法预检，含**括号平衡**检查与**多函数同文件**检查。
宿主 Octave 启动只要 0.6s，且报错**位置精确**——wasm 里那句
`syntax error near line N` 的行号经常指向块首而非真凶（本次在
`__tf_texinfo_to_plain__.m` 上为一行报错 bisect 了十几轮，最后靠括号计数一次定位：
`if (regexp(...)` 少了一个 `)`）。

**用法**：`python3 build/check_m.py <文件或目录>`
**注意**：宿主是 11.x、目标是 7.2，**通过不代表 7.2 通过；失败几乎一定是真失败**。
所以它是"过滤器"，验收仍以浏览器实测为准。

### 另一个实测坑：`built-in-docstrings` 的尾随分隔符会让 `help` 死循环

`built-in-docstrings` 用 `0x1d` 分隔条目。若输出比输入**多一个**分隔符（例如生成
脚本给最后一条也补了一个，产生一个空尾条目），`help.cc:626-660` 的解析循环会在空
条目上**不推进文件位置**，外层 `while (! file.eof())` 于是死循环——症状是
`help sin` 整个挂住、浏览器测试超时，**没有任何报错**。
**规则**：生成脚本必须断言"输出的分隔符数 == 输入的分隔符数"。
`render-docstrings.py` 已内建这条自检。

### 已知边界（如实）

- 只覆盖**内建**函数（`help sin` / `help sqrt` / `help disp`）。
- **`help ode45` 这类 `.m` 文件的 docstring 不走这条路**：它运行时从 `.m` 文件里读
  docstring（不是从 `built-in-docstrings`），格式为 texinfo 时仍会调 makeinfo。
  要覆盖它得预渲染 1010 个 `.m` 的 docstring（侵入性大得多），或另行处理。
  **这是剩余缺口，不是已解决项。**

---

## 批次 T3（2026-09-21）：`copyfile` / `movefile` / `ls` 进程内实现（第三轮）

**需求**：文件操作可用。原版实现全部**以 shell 命令收尾**，而本构建没有 shell：

| 函数 | 原版最后一步 |
|---|---|
| `copyfile` | `system('cp -r "%s" "%s"')`（`copyfile.m:152`） |
| `movefile` | `system('mv "%s" "%s"')`（`movefile.m:166`） |
| `ls` | `system('ls -C -1 %s')`（`ls.m:113`） |

浏览器里没有 `cp`/`mv`/`ls` 可执行文件，但**有 Octave 自己就能读写的文件系统**
（`fopen`/`fread`/`fwrite`/`dir`/`glob`/`mkdir`/`rename`/`unlink`/`rmdir`），
所以三个函数改成**进程内实现**，签名与返回约定完全照抄原版。

### 产物（`build/webfile/`，10 个文件，纯 `.m` 零编译）

- `copyfile.m` / `movefile.m` / `ls.m` —— 同名核心函数覆写（走已验证的覆写模式）
- `__wf_copy_file__.m`（分块二进制复制，1MiB 一块）
- `__wf_copy_dir__.m`（递归，`cp -r` 语义）
- `__wf_rmtree__.m`（递归删除）
- `__wf_try_rename__.m`（`rename` 的安全包装）
- `__wf_basename__.m` / `__wf_list_dir__.m` / `__wf_fail__.m`（叶子工具）

### 保真度（**照抄原版，不另创 API**）

- 三个返回值 `[status, msg, msgid]` 与"status 与 `system()` 相反"的口径一致
- 多源 + 非目录目标 → **同样的报错文本**（`when copying multiple files, F2 must be a directory`），
  好让匹配它的调用方行为不变
- 源不存在 → **返回 status=0 而不是抛异常**（原版在 `nargout>0` 时也是返回而非抛）
- 递归复制是 `cp -r` 语义：目标不存在 → 装**内容**；目标存在 → 装**同名子目录**
- `'f'`（force）标志**接受但无事可做**：这里不可能有交互提示，可观察行为相同

### 明确不做 / 明确不同（如实）

- **`ls` 的选项不支持**：原版把 `-l`/`-R` 传给 shell 的 `ls`，这里没有 shell。
  与其**静默忽略**选项、返回一个看起来正常但不是用户要的东西，不如**清晰报错**并说明。
- **`ls` 无输出参数时一行一个名字**，不是 shell `ls` 的多列布局（列布局是装饰性的，
  且本构建没有 pager；一行一个正是原版 `-1` 形式）。
- **不保留权限/时间戳**：浏览器文件系统里没有可保留的 POSIX mode，本项目与 Forge
  的流程也不依赖它。

### 实测踩到的坑（新）

1. **`unlink` 不能删目录**：即使空目录也报 `operation failed: 是一个目录`，
   要用 **`rmdir`**。第一版 `__wf_rmtree__` 全用 `unlink`，于是每个目录删除都失败——
   而 `movefile` 的"重命名失败 → 复制+删源"回退路径正好依赖它。
2. **`"\"` 是未终止字符串**：Windows 分隔符必须写 `"\\"`。`find (p == "/" | p == "\")`
   报的是**这一行**的语法错误，但看起来像别的问题。
3. **Octave 没有 `<<` 运算符**：`1 << 20` 要写 `2 ^ 20`。
4. **`error` 的跨行拼接要写 `...`**：`error ("a" "b")` 被当成两条语句。
5. **`ls` 的返回值是 char 矩阵**（`strvcat` 形状，与原版一致）：`strfind(r, "q1.txt")`
   会**按列**搜索，在 2×22 的矩阵上可能与预期不符。测试里先
   `strjoin(cellstr(r), " ")` 再断言。（这是**我自己的测试写错**，不是实现 bug——
   但值得记，因为下次还会踩。）

### 验收

`test/browser/accept-fileops.mjs`（**20 项，20/20 绿**）。每条断言都同时验证
(a) 功能对（字节/目录结构/状态码），(b) **没有走 shell**（负向匹配
`unable to start subprocess|cp -r|mv |ls -C`）。只有 (a) 不够——这个批次的意义
就是"不再依赖 shell"，所以要显式断言这一条。

含回归护栏：`dir`、`imread`/`imwrite`（依赖 `fopen` 路径）、`gzip`（webio 路径）。
**注意**：`imread` 需要先装载 `webimage` 资产（imformats 注册），否则会误报——
懒加载车道的能力测试必须先按需装载，这是既有约定。
