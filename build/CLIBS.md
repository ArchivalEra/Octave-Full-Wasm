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
