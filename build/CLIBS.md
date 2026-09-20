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
