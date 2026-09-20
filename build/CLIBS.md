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

## Octave 重编状态：未完成（关机中断）

- `build/reconf.sh`：与 Dockerfile 同 flag，去掉 5 个 `--without`，
  外加 `octave_cv_lib_arpack_ok_1=yes` 预置。
- 预置原因：ARPACK 的“C++ 跑起来 crash 否”测试在容器 Node 14 下挂
  （`unexpected section <Exception>`，环境老旧非库问题）；链接测试本身已过。
  数值正确性以后用 `eigs` 对 `eig` 逐项比数证明（比冒烟测试更强）。
- 第一轮 configure 结果：FFTW/GLPK/QHULL/QRUPDATE 已 `HAVE_*=1`，
  ARPACK 当时因第 2 条挂掉；`-fcommon` 修好后开了第三轮，中断于 configure 阶段。
- **开机后：直接重跑 `/tmp/reconf.sh`（configure+make+install 全套约 50 分钟），
  不要续跑 make**。参考日志：容器内 `/tmp/reconf-full*.log`（快照里有）。

## 容器/镜像

- `owasm`：线上旧构建（8757），别动。
- `obuild`：构建容器（`sleep infinity`，重启 docker 后 `docker start obuild`）。
- 镜像：`octave-wasm`（原始）、`octave-build:full`（工具链检查点）、
  `octave-build:libs`（5 库编完）、`octave-build:shutdown`（关机快照，最新）。
