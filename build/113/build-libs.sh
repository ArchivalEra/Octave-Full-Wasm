#!/usr/bin/env bash
#
# 逐库独立构建第三方 wasm 静态库（外部校对建议的策略）
#
# 原则（为什么这么组织）：
#   1. **每个库一个独立、干净、可重复的 prefix**（/src/deps/<lib>）——
#      而不是全塞进一个共享 /usr/local。这样"某个库把公共 CPPFLAGS/头文件/探测结果
#      改坏了"这类 configure-time 污染就不会发生，也让单个库失败时可以只重来它。
#   2. **逐库自检**：每个库建完立刻验它该有的符号（用 emnm）。
#      建库阶段是**可以**逐库隔离的正确粒度；主程序的 configure 则是一次全开、
#      失败后再按库集合二分（见 build/113/STATUS 里的策略）。
#   3. `-fPIC` 只给真正需要的库：7.2 用 `-Wl,--error-limit=0` 让链接器报全量错误后
#      统计出来的完整清单是 glpk / arpack / sndfile / qhull / fftw3+3f。
#
# 用法：bash build-libs.sh <lib|all|list>
#   lib ∈ zlibbz2 glpk fftw qhull sndfile rapidjson hdf5
#
set -euo pipefail

# 源码分布在两个目录（实测）：vendored 大件与 octave 自带的第三方分开放
SRC="${SRC:-/src/vendor}"
SRC2="${SRC2:-/src/third_party}"
DEPS="${DEPS:-/src/deps}"
WORK="${WORK:-/src/libwork}"
JOBS="${JOBS:-$(nproc)}"
export CCACHE_DIR="${CCACHE_DIR:-/ccache}"

# ccache 的正确接法（本项目实测过的教训）：emconfigure 会覆盖 CC/CXX 环境变量，
# 所以必须把它们作为 **configure 的命令行参数**传。
CCACHE_CC="ccache emcc"
CCACHE_CXX="ccache em++"
# ★ 车道旗标（branch `threads`）：默认空 = 现役口径。
#   ⚠️ 为什么有了影子还要它：`emcmake`/`emconfigure` 把编译器**钉成绝对路径**（toolchain 文件 /
#   emconfigure 的 CC）⇒ 影子的 PATH 包装**管不到**脚本自己写的旗标串。实测 qhull/sndfile 重编后
#   仍 100% 缺 atomics —— 凡是脚本**自己给 CFLAGS/CMAKE_C_FLAGS** 的地方都得拼 $LANE_FLAGS。
LANE_FLAGS="${LANE_FLAGS:-}"

# ★ emf77 找 f2c.h 依赖 $F2C_PREFIX：w64 车道必须指向 /usr/local-w64，否则会捡到 wasm32 的 f2c.h
if [[ "${DEPS:-}" == *"w64"* ]] || [[ "${LANE_FLAGS:-}" == *"MEMORY64"* ]]; then
  export F2C_PREFIX="${F2C_PREFIX:-/usr/local-w64}"
else
  export F2C_PREFIX="${F2C_PREFIX:-/usr/local}"
fi

say () { echo; echo "=== $*"; }
need () { [ -f "$1" ] || { echo "FATAL: 缺 $1" >&2; exit 2; }; }

unpack () {  # $1=tar 文件名（在 SRC/SRC2 里找）  $2=解包后目录名
  local f="$1" d="$2" t=""
  for dir in "$SRC" "$SRC2"; do
    if [ -f "$dir/$f" ]; then t="$dir/$f"; break; fi
  done
  [ -n "$t" ] || { echo "FATAL: 在两个源码目录里都找不到 $f（$SRC, $SRC2）" >&2; exit 2; }
  mkdir -p "$WORK"
  [ -d "$WORK/$d" ] || tar xf "$t" -C "$WORK"
}

# ---------------------------------------------------------------------------
# zlib / bzip2：不走源码构建，用 Emscripten 自带的 ports（PIC 版 sysroot）
#   7.2 的经验：`embuilder --pic build zlib bzip2`——PIC sysroot 里默认没有它们
# ---------------------------------------------------------------------------
do_zlibbz2 () {
  say "zlib + bzip2（从源码建；不用 Emscripten ports——容器内取代理不稳）"
  # ports 会从 GitHub 拉源码，而容器直连 GitHub 基本不可用（本项目已知问题）
  # → 自动取容器网关，走宿主上那个 HTTP 代理
  local P="$DEPS/zlibbz2"
  mkdir -p "$P"
  # zlib（自带 configure 脚本，非 autoconf）
  unpack "zlib-1.3.1.tar.gz" zlib-1.3.1
  cd "$WORK/zlib-1.3.1"
  # ⚠️ zlib 的 configure **不是 autoconf**，不接受 `CC=...` 之类的参数
  #   （实测报 "unknown option: CC=ccache emcc"）。CC 必须走**环境变量**。
  # ⚠️ **必须 -fPIC**（实测漏了会怎样）：zlib 的 configure 是靠**环境变量**收 CFLAGS 的
  #   （它不接受 CC=... 这种命令行参数），漏 -fPIC 时产物是非 PIC 对象 →
  #   ① 想把它链进任何 PIC 目标（含 .oct side module）会报
  #        relocation R_WASM_MEMORY_ADDR_LEB cannot be used against symbol
  #        'crc_table'; recompile with -fPIC
  #   ② 主模块是 PIC 构建，非 PIC 的 zlib 对象进不去，而 Octave 核心又没引用
  #        zlib 的流式接口（deflate/inflate/gzopen）→ 那些对象根本不会被拉进主模块
  #        → 依赖它们的 .oct（gzip/webio）导入解析不到 → **调用即整页 trap**。
  CC="$CCACHE_CC" CFLAGS="-O2 -fPIC $LANE_FLAGS" emconfigure ./configure --prefix="$P" --static > "$WORK/zlib-conf.log" 2>&1
  emmake make -j"$JOBS" CC="$CCACHE_CC" CFLAGS="-O2 -fPIC $LANE_FLAGS" > "$WORK/zlib-make.log" 2>&1
  emmake make install > "$WORK/zlib-inst.log" 2>&1
  grep -q ' deflate$' <(emnm "$P/lib/libz.a") || { echo "FATAL: libz.a 缺 deflate" >&2; exit 1; }
  # bzip2：**绕开它的 Makefile**。实测两轮都失败：其 Makefile 里 `CC=gcc` 是
  #   普通赋值，连 make 命令行传 CC 都没压住（日志里始终是宿主 gcc），于是产出
  #   x86 对象，链接时报
  #     archive member 'blocksort.o' is neither Wasm object file nor LLVM bitcode
  #   与其和它的 Makefile 纠缠，不如直接编那 7 个源文件——完全可控。
  unpack "bzip2-1.0.8.tar.gz" bzip2-1.0.8
  cd "$WORK/bzip2-1.0.8"
  local bzobjs=() c
  for c in blocksort huffman crctable randtable compress decompress bzlib; do
    $CCACHE_CC -O2 -fPIC $LANE_FLAGS -D_FILE_OFFSET_BITS=64 -c "$c.c" -o "$c.bz.o"
    bzobjs+=("$c.bz.o")
  done
  mkdir -p "$P/lib" "$P/include"
  emar rcs "$P/lib/libbz2.a" "${bzobjs[@]}"
  cp -f bzlib.h "$P/include/bzlib.h"
  grep -q ' BZ2_bzCompress$' <(emnm "$P/lib/libbz2.a") || { echo "FATAL: libbz2.a 缺 BZ2_bzCompress" >&2; exit 1; }
  echo "  ✅ zlib + bzip2 → $P"
}

# ---------------------------------------------------------------------------
# glpk（autotools，需要 -fPIC）
# ---------------------------------------------------------------------------
do_glpk () {
  say "glpk-5.0"
  unpack "glpk-5.0.tar.gz" glpk-5.0
  local P="$DEPS/glpk"
  cd "$WORK/glpk-5.0"
  # -fwasm-exceptions 必须与整棵树一致：glpk 用了 setjmp/longjmp，不统一就会带进
  # legacy 的 invoke_*/emscripten_longjmp（实测扫出 117 处），web 终链报
  #   invoke_ functions exported but exceptions and longjmp are both disabled
  emconfigure ./configure --host=none --prefix="$P" --disable-shared --enable-static \
      CC="$CCACHE_CC" CFLAGS="-O2 -fPIC -fwasm-exceptions $LANE_FLAGS" > "$WORK/glpk-conf.log" 2>&1 \
      || { echo "FATAL: glpk configure 失败，见 $WORK/glpk-conf.log" >&2; tail -20 "$WORK/glpk-conf.log" >&2; exit 1; }
  emmake make -j"$JOBS" > "$WORK/glpk-make.log" 2>&1 \
      || { echo "FATAL: glpk make 失败，见 $WORK/glpk-make.log" >&2; tail -20 "$WORK/glpk-make.log" >&2; exit 1; }
  emmake make install > "$WORK/glpk-inst.log" 2>&1 \
      || { echo "FATAL: glpk install 失败，见 $WORK/glpk-inst.log" >&2; tail -20 "$WORK/glpk-inst.log" >&2; exit 1; }
  local s; s="$(emnm "$P/lib/libglpk.a")"
  grep -q ' glp_simplex$' <<<"$s" || { echo "FATAL: libglpk.a 缺 glp_simplex" >&2; exit 1; }
  echo "  ✅ glpk → $P（glp_simplex 在）"
}

# ---------------------------------------------------------------------------
# fftw（autotools，双精度 + 单精度两份；需要 -fPIC）
# ---------------------------------------------------------------------------
do_fftw () {
  say "fftw-3.3.10（double + single）"
  unpack "fftw-3.3.10.tar.gz" fftw-3.3.10
  local P="$DEPS/fftw"
  cd "$WORK/fftw-3.3.10"
  for variant in "" "--enable-single"; do
    emmake make distclean >/dev/null 2>&1 || true
    emconfigure ./configure --host=none --prefix="$P" --disable-fortran --disable-threads \
        --disable-openmp --disable-shared --enable-static $variant \
        CC="$CCACHE_CC" CFLAGS="-O2 -fPIC $LANE_FLAGS" > "$WORK/fftw-conf.log" 2>&1 \
        || { echo "FATAL: fftw configure 失败，见 $WORK/fftw-conf.log" >&2; tail -20 "$WORK/fftw-conf.log" >&2; exit 1; }
    emmake make -j"$JOBS" > "$WORK/fftw-make.log" 2>&1 \
        || { echo "FATAL: fftw make 失败，见 $WORK/fftw-make.log" >&2; tail -20 "$WORK/fftw-make.log" >&2; exit 1; }
    emmake make install > "$WORK/fftw-inst.log" 2>&1 \
        || { echo "FATAL: fftw install 失败，见 $WORK/fftw-inst.log" >&2; tail -20 "$WORK/fftw-inst.log" >&2; exit 1; }
  done
  grep -q ' fftw_plan_dft_1d$'  <(emnm "$P/lib/libfftw3.a")  || { echo "FATAL: libfftw3.a 缺 fftw_plan_dft_1d" >&2; exit 1; }
  grep -q ' fftwf_plan_dft_1d$' <(emnm "$P/lib/libfftw3f.a") || { echo "FATAL: libfftw3f.a 缺 fftwf_plan_dft_1d" >&2; exit 1; }
  echo "  ✅ fftw3 + fftw3f → $P"
}

# ---------------------------------------------------------------------------
# qhull（cmake；需要 -fPIC）
#   注意：装出来的库名是 libqhullstatic_r.a，而 Octave 找的是 -lqhull_r
# ---------------------------------------------------------------------------
do_qhull () {
  say "qhull-8.0.2"
  # ⚠️ 实测坑：qhull 用了 setjmp/longjmp。若构建时**不开** wasm 异常，
  #   emscripten 默认走 legacy longjmp，对象里会引用 `emscripten_longjmp`；
  #   而我们的整棵树是 -fwasm-exceptions，那个符号不会被提供 →
  #     undefined symbol: emscripten_longjmp
  #   且 `-sSUPPORT_LONGJMP=emscripten` 与 -fwasm-exceptions **明确不兼容**
  #   （实测 emcc 报 "not compatible with -fwasm-exceptions"）。
  #   所以必须让 qhull 与整棵树用同一套：加 -fwasm-exceptions。
  unpack "qhull-8.0.2.tar.gz" qhull-8.0.2
  local P="$DEPS/qhull"
  local TC=/emsdk/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake
  emcmake cmake -S "$WORK/qhull-8.0.2" -B "$WORK/qhull-build" \
      -DCMAKE_INSTALL_PREFIX="$P" -DBUILD_SHARED_LIBS=OFF -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_C_FLAGS="-O2 -fPIC -fwasm-exceptions $LANE_FLAGS" \
      -DCMAKE_CXX_FLAGS="-O2 -fPIC -fwasm-exceptions $LANE_FLAGS" \
      -DCMAKE_TOOLCHAIN_FILE="$TC" \
      -DCMAKE_C_COMPILER_LAUNCHER=ccache -DCMAKE_CXX_COMPILER_LAUNCHER=ccache \
      -DCMAKE_CROSSCOMPILING_EMULATOR="/emsdk/node/22.16.0_64bit/bin/node" \
      > "$WORK/qhull-conf.log" 2>&1
  emmake cmake --build "$WORK/qhull-build" -j"$JOBS" > "$WORK/qhull-make.log" 2>&1
  emmake cmake --install "$WORK/qhull-build" > "$WORK/qhull-inst.log" 2>&1
  cp -f "$P/lib/libqhullstatic_r.a" "$P/lib/libqhull_r.a"
  grep -q ' qh_new_qhull$' <(emnm "$P/lib/libqhull_r.a") || { echo "FATAL: libqhull_r.a 缺 qh_new_qhull" >&2; exit 1; }
  echo "  ✅ qhull → $P（qh_new_qhull 在；已补 libqhull_r.a 别名）"
}

# ---------------------------------------------------------------------------
# libsndfile（cmake；需要 -fPIC）
# ---------------------------------------------------------------------------
do_sndfile () {
  say "libsndfile-1.2.2"
  unpack "libsndfile-1.2.2.tar.xz" libsndfile-1.2.2
  local P="$DEPS/sndfile"
  local TC=/emsdk/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake
  cd "$WORK/libsndfile-1.2.2"
  emcmake cmake -S . -B build -DCMAKE_INSTALL_PREFIX="$P" \
      -DBUILD_SHARED_LIBS=OFF -DBUILD_PROGRAMS=OFF -DBUILD_EXAMPLES=OFF \
      -DBUILD_TESTING=OFF -DENABLE_EXTERNAL_LIBS=OFF -DENABLE_MPEG=OFF \
      -DCMAKE_C_FLAGS="-O2 -fPIC $LANE_FLAGS" -DCMAKE_TOOLCHAIN_FILE="$TC" \
      -DCMAKE_C_COMPILER_LAUNCHER=ccache \
      -DCMAKE_CROSSCOMPILING_EMULATOR="/emsdk/node/22.16.0_64bit/bin/node" \
      > "$WORK/sndfile-conf.log" 2>&1
  emmake cmake --build build -j"$JOBS" > "$WORK/sndfile-make.log" 2>&1
  emmake cmake --install build > "$WORK/sndfile-inst.log" 2>&1
  grep -q ' sf_open$' <(emnm "$P/lib/libsndfile.a") || { echo "FATAL: libsndfile.a 缺 sf_open" >&2; exit 1; }
  echo "  ✅ libsndfile → $P（sf_open 在）"
}

# ---------------------------------------------------------------------------
# rapidjson（header-only：只需把头文件摊到 prefix）
# ---------------------------------------------------------------------------
do_rapidjson () {
  say "rapidjson-1.1.0（header-only）"
  unpack "rapidjson-1.1.0.tar.gz" rapidjson-1.1.0
  local P="$DEPS/rapidjson"
  mkdir -p "$P/include"
  cp -r "$WORK/rapidjson-1.1.0/include/rapidjson" "$P/include/"
  [ -f "$P/include/rapidjson/document.h" ] || { echo "FATAL: rapidjson 头未就位" >&2; exit 1; }
  # rapidjson 1.1.0 与新 clang 不兼容（Octave 的 jsondecode.cc 编不过）：
  # 补丁逻辑独立成 build/113/fix-rapidjson.py，避免在 shell 里嵌 heredoc。
  python3 /src/bin/fix-rapidjson.py "$P/include/rapidjson/document.h"
  echo "  ✅ rapidjson → $P/include/rapidjson"
}

# ---------------------------------------------------------------------------
# hdf5（autotools；只要 C 接口，关掉 tools/tests/fortran/cxx/hl 省时间）
# ---------------------------------------------------------------------------
do_hdf5 () {
  say "hdf5-1.14.2"
  unpack "hdf5-1.14.2.tar.gz" hdf5-1.14.2
  local P="$DEPS/hdf5"
  cd "$WORK/hdf5-1.14.2"
  emconfigure ./configure --host=none --prefix="$P" \
      --disable-shared --enable-static --disable-tools --disable-tests \
      --disable-fortran --disable-cxx --disable-hl --disable-docs \
      --disable-parallel --disable-threadsafe --with-pic \
      CC="$CCACHE_CC" CFLAGS="-O2 -fPIC -fwasm-exceptions $LANE_FLAGS" \
      > "$WORK/hdf5-conf.log" 2>&1 \
      || { echo "FATAL: hdf5 configure 失败，见 $WORK/hdf5-conf.log" >&2; tail -20 "$WORK/hdf5-conf.log" >&2; exit 1; }
  # ⚠️ 实测坑（交叉编译经典问题）：H5lib_settings.c / H5Tinit.c 是由**刚编出来的
  #   程序**（H5make_libsettings / H5detect）在**运行时**生成的；而 Emscripten/Node 下
  #   那个程序看不到宿主目录里的 libhdf5.settings → 报
  #     libhdf5.settings: No such file or directory
  #   标准解法：这两个是**构建期工具**，用**宿主原生**编译并运行来产出那两个 .c。
  #   生成后把时间戳推新（并配 HDF5_Make_Ignore=1），阻止 make 再用那条跑不通的规则。
  cd "$WORK/hdf5-1.14.2/src"
  cc -I. -I.. -DHAVE_CONFIG_H -o "$WORK/h5mls" H5make_libsettings.c -lm
  cc -I. -I.. -DHAVE_CONFIG_H -o "$WORK/h5det" H5detect.c -lm
  [ -f libhdf5.settings ] || emmake make libhdf5.settings
  "$WORK/h5mls" H5lib_settings.c
  "$WORK/h5det"  H5Tinit.c
  touch -d "now + 2 hour" H5lib_settings.c H5Tinit.c libhdf5.settings
  cd "$WORK/hdf5-1.14.2"
  HDF5_Make_Ignore=1 emmake make -j"$JOBS" > "$WORK/hdf5-make.log" 2>&1 \
      || { echo "FATAL: hdf5 make 失败，见 $WORK/hdf5-make.log" >&2; tail -20 "$WORK/hdf5-make.log" >&2; exit 1; }
  HDF5_Make_Ignore=1 emmake make install > "$WORK/hdf5-inst.log" 2>&1 \
      || { echo "FATAL: hdf5 install 失败，见 $WORK/hdf5-inst.log" >&2; tail -20 "$WORK/hdf5-inst.log" >&2; exit 1; }
  grep -q ' H5Fopen$' <(emnm "$P/lib/libhdf5.a") || { echo "FATAL: libhdf5.a 缺 H5Fopen" >&2; exit 1; }
  echo "  ✅ hdf5 → $P（H5Fopen 在）"
}


# ---------------------------------------------------------------------------
# arpack-ng（Fortran；需要 -fPIC）
#   7.2 当年为了绕开「COMMON 块重复定义」被迫把全部源 cat 成单个 TU。
#   我们现在终链有 -Wl,--allow-multiple-definition，**先试逐文件编译**——
#   若可行就省掉那个技巧（更干净、也能并行）。
#   归一化：arpack-ng 用 `!` 注释与 `&` 续行，f2c 吃不了，必须先用
#   build/normalize_arpack.py 转成严格 F77。
# ---------------------------------------------------------------------------
do_arpack () {
  say "arpack-ng-3.7.0"
  unpack "arpack-ng-3.7.0.tar.gz" arpack-ng-3.7.0
  local P="$DEPS/arpack"; mkdir -p "$P/lib"
  python3 /src/bin/normalize_arpack.py "$WORK/arpack-ng-3.7.0/SRC"  "$WORK/arpack-src"  >/dev/null
  python3 /src/bin/normalize_arpack.py "$WORK/arpack-ng-3.7.0/UTIL" "$WORK/arpack-util" >/dev/null
  local o=() f
  # f2c 的 INCLUDE 相对 cwd 解析 → 必须在本目录里编（归一化器已把 debug.h 一起拷来）
  cd "$WORK/arpack-src"
  for f in *.f; do emf77 -O2 -fPIC $LANE_FLAGS -c "$f" -o "${f%.f}.o"; o+=("$PWD/${f%.f}.o"); done
  cd "$WORK/arpack-util"
  for f in *.f; do
    # 跳过 second.f：它用系统计时函数 etime，f2c 报
    #   "Declaration error for etime: unknown intrinsic function"
    # 我们用自己的 second_stub.f 代替（7.2 也是这么做的）
    [ "$f" = "second.f" ] && { echo "   （跳过 UTIL/second.f，用 second_stub.f 代替）"; continue; }
    emf77 -O2 -fPIC $LANE_FLAGS -c "$f" -o "${f%.f}.o"; o+=("$PWD/${f%.f}.o")
  done
  emf77 -O2 -fPIC $LANE_FLAGS -c /src/bin/second_stub.f -o "$WORK/second_stub.o"; o+=("$WORK/second_stub.o")
  emar rcs "$P/lib/libarpack.a" "${o[@]}"
  for sym in dsaupd_ dseupd_ dnaupd_; do
    grep -q " $sym$" <(emnm "$P/lib/libarpack.a") || { echo "FATAL: libarpack.a 缺 $sym" >&2; exit 1; }
  done
  echo "  ✅ arpack → $P（dsaupd_/dseupd_/dnaupd_ 在；逐文件编译成功）"
}

# ---------------------------------------------------------------------------
# qrupdate（Fortran，源码在磁盘上是已解包目录）
# ---------------------------------------------------------------------------
do_qrupdate () {
  say "qrupdate-1.1.2"
  if [ ! -d "$WORK/qrupdate-1.1.2" ]; then
    [ -d "$SRC/qrupdate-1.1.2" ] || { echo "FATAL: 找不到 qrupdate 源码目录" >&2; exit 2; }
    cp -r "$SRC/qrupdate-1.1.2" "$WORK/"
  fi
  local P="$DEPS/qrupdate"; mkdir -p "$P/lib"
  cd "$WORK/qrupdate-1.1.2/src"
  local o=() f
  for f in *.f; do emf77 -O2 -fPIC $LANE_FLAGS -c "$f" -o "${f%.f}.o"; o+=("$PWD/${f%.f}.o"); done
  emar rcs "$P/lib/libqrupdate.a" "${o[@]}"
  grep -q ' dqrinc_$' <(emnm "$P/lib/libqrupdate.a") || { echo "FATAL: libqrupdate.a 缺 dqrinc_" >&2; exit 1; }
  echo "  ✅ qrupdate → $P（dqrinc_ 在）"
}


# ---------------------------------------------------------------------------
# SuiteSparse 5.4.0（Octave 要的 C 部分）
#   机制：各子库 Makefile 都 `include ../SuiteSparse_config/SuiteSparse_config.mk`，
#   而里面 `CC = gcc` 是**普通赋值** → **make 命令行覆盖能压过它**。
#   只建 `library` 目标（不建 demos —— demos 是程序、在交叉编译下跑不了）。
#   **必须 CFOPENMP= 关掉**：我们整棵树是单线程（--disable-threads）。
#   只建 Octave --with-* 真正要的那几个；SPQR 不做（R7 已论证 spqr 非缺口）。
# ---------------------------------------------------------------------------
do_suitesparse () {
  say "SuiteSparse-5.4.0（AMD/CAMD/COLAMD/CCOLAMD/CHOLMOD/UMFPACK/KLU/CXSparse）"
  unpack "suitesparse-full-5.4.0.tar.gz" SuiteSparse-5.4.0
  local P="$DEPS/suitesparse"; mkdir -p "$P/lib" "$P/include"
  cd "$WORK/SuiteSparse-5.4.0"
  # CHOLMOD_CONFIG=-DNPARTITION：关掉 CHOLMOD 的分区模块。
  #   实测不关的话它会引用 METIS（METIS_ComputeVertexSeparator / METIS_NodeND），
  #   而我们没建 METIS（Octave 也不需要 CHOLMOD 的分区功能）。
  #   SuiteSparse 文档原文：-DNPARTITION "do not include the Partition module.
  #   also do not include METIS."
  # ⚠️ SS_DEFS 必须在数组**之前**单独赋值：写在 `OV=( ... )` 里只会变成一个
  #   数组元素（名字里带等号），变量本身未定义 → `set -u` 报 unbound（实测踩过）。
  # 不要在这里强改 SuiteSparse_long 的宽度：**已实测证伪**那个假设 ——
  #   Octave 这边 OCTAVE_IDX_TYPE 是 int32_t，而 wasm32 上 `long` 也是 32 位，
  #   两边本来一致；强行改成 64 位反而制造了真错配（改完 lu 照样 trap）。
  #   详见 build/113/NOTES-umfpack.md。
  #
  # ★★ -DNBLAS / -DNSUPERNODAL：**稀疏 lu 整页 trap 的真正根因**（2026-09-22 查明）
  #
  # 现象（改之前）：稀疏 `lu(s)` 的 3 输出/4 输出 → `RuntimeError: unreachable`，
  #   整个页面死掉；而 1/2 输出正常，`chol(s)`/`qr(s)`/`s\b` 也都正常。
  #
  # 根因：这两个开关**正是"别用外部 BLAS"**的开关，而本仓的 BLAS 是 **f2c 转出来的**
  #   （下面 `BLAS="-lrefblas"`）。UMFPACK 的 C 代码按"标准 BLAS"的约定调
  #   `dgemm_`/`dger_`/`dtrsv_`/`dtrsm_`，而 f2c 版这些例程用的是 f2c 的隐藏长度
  #   （`ftnlen`）约定 → 形参错位、内存被踩 → wasm trap。
  #   **1/2 输出不做数值分解所以不炸；3+ 输出要走 → 必炸** —— 现象与根因严丝合缝。
  #   旁证：11.3.0 的 `libumfpack.a` 里能查到 `dgemm_/dger_/dtrsv_/dtrsm_/zgemm_…`
  #   这些**未定义**符号，而 7.2 那份**一个都没有**（对照见下）。
  #
  # 证据（不是猜的，是拿 7.2 的**成品源码树**跟干净 tarball 逐行 diff 出来的）：
  #   本仓 vendored 的 7.2 SuiteSparse 树里，`SuiteSparse_config.mk` 相对干净
  #   `suitesparse-full-5.4.0.tar.gz` 只有 3 处人工改动：
  #     :269  `UMFPACK_CONFIG ?= -DNBLAS`                          ← 本处
  #     :313  `CHOLMOD_CONFIG ?= $(GPU_CONFIG) -DNPARTITION -DNSUPERNODAL`  ← 本处
  #     :476  `SO_OPTS += -shared -Wl,-soname -Wl,$(SO_MAIN)`
  #           （去掉了 tarball 自带的 `-Wl,--no-undefined`）
  #   前两处就是"别用外部 BLAS"，第三处是"编 .so 别要求符号全定义"——我们用
  #   `static` 目标，天然不碰 SO_OPTS。
  #   ⇒ **7.2 能用，是因为它带着这两个补丁**；11.3.0 用了干净 tarball 却只照抄了
  #     `-DNPARTITION`，于是踩了 7.2 早就踩过、且早已修掉的同一个坑。
  #
  # 与 NOTES-umfpack.md 的关系：那份里"索引宽度"的假设**仍然是被证伪的**；
  #   这里不是翻案，是找到了另一条（7.2 已经验证过的）解释。
  local OV=( CC="$CCACHE_CC" CXX="$CCACHE_CXX" AR=emar RANLIB=emranlib
             CFOPENMP=
             CHOLMOD_CONFIG="-DNPARTITION -DNSUPERNODAL"
             UMFPACK_CONFIG="-DNBLAS"
             CFLAGS="-O2 -fPIC $LANE_FLAGS" CXXFLAGS="-O2 -fPIC $LANE_FLAGS"
             BLAS="-lrefblas" LAPACK="-llapack" )
  # ⚠️ 改了 config 宏就必须**先删旧 .o 再编**：SuiteSparse 的 make 不会因为
  #   "命令行里多了一个 -D" 就重编已有对象（与 HISTORY §10.3 坑 2 同源）。
  #   只清受影响的两个库的 .o，精确且可解释。
  for _l in SuiteSparse_config AMD CAMD COLAMD CCOLAMD CHOLMOD UMFPACK KLU CXSparse; do
    rm -f "$_l"/*.o "$_l"/Lib/*.o 2>/dev/null || true
    echo "  清了 $_l 中的旧 .o（确保带 LANE_FLAGS 重编）"
  done
  rm -f "$P/lib"/*.a
  # 用 **static** 目标，不用 library：后者末尾会 `make install` 去编 .so，
  # 而 SO_OPTS 里带 `-Wl,--no-undefined`（wasm-ld 不认识）→ 必失败。
  # static 只产 .a，正好是我们要的。
  for lib in SuiteSparse_config AMD CAMD COLAMD CCOLAMD CHOLMOD UMFPACK KLU CXSparse; do
    echo "  --- $lib"
    ( cd "$lib" && emmake make static "${OV[@]}" > "$WORK/ss-$lib.log" 2>&1 ) \
      || { echo "FATAL: SuiteSparse/$lib 构建失败，见 $WORK/ss-$lib.log" >&2; tail -12 "$WORK/ss-$lib.log" >&2; exit 1; }
  done
  # 收拢产物到独立 prefix
  local n=0 f
  for f in */Lib/*.a */*.a; do [ -f "$f" ] && { cp -f "$f" "$P/lib/"; n=$((n+1)); }; done
  cp -f SuiteSparse_config/SuiteSparse_config.h "$P/include/" 2>/dev/null || true
  for f in */Include/*.h; do [ -f "$f" ] && cp -f "$f" "$P/include/"; done
  echo "  收集到 $n 个 .a：$(cd "$P/lib" && ls *.a | tr '\n' ' ')"
  # 自检：每个子库一个代表符号
  local chk="libamd.a:amd_2 libcamd.a:camd_2 libcolamd.a:colamd libccolamd.a:ccolamd libcholmod.a:cholmod_start libumfpack.a:umfpack_di_solve libklu.a:klu_analyze libcxsparse.a:cs_di_sqr"
  for pair in $chk; do
    local l="${pair%%:*}" sym="${pair##*:}"
    grep -q " $sym$" <(emnm "$P/lib/$l" 2>/dev/null) || { echo "FATAL: $l 缺 $sym" >&2; exit 1; }
  done
  echo "  ✅ SuiteSparse → $P（8 个库的代表符号全在）"
}

case "${1:-list}" in
  zlibbz2)   do_zlibbz2 ;;
  glpk)      do_glpk ;;
  fftw)      do_fftw ;;
  qhull)     do_qhull ;;
  sndfile)   do_sndfile ;;
  rapidjson) do_rapidjson ;;
  hdf5)      do_hdf5 ;;
  arpack)    do_arpack ;;
  qrupdate)  do_qrupdate ;;
  suitesparse) do_suitesparse ;;
  all)       do_zlibbz2; do_glpk; do_fftw; do_qhull; do_sndfile; do_rapidjson; do_hdf5; do_arpack; do_qrupdate; do_suitesparse ;;
  list)      echo "可建：zlibbz2 glpk fftw qhull sndfile rapidjson hdf5 arpack qrupdate suitesparse" ;;
  *)         echo "未知库：$1" >&2; exit 2 ;;
esac

say "完成：$1"
