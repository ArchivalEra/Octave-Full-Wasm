#!/bin/sh
# Octave-Full-Wasm — R10 基准矩阵的 O 级重编配方
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 用法（**在一次性容器里跑，别碰 odld**）：
#     sh build/reconf-bench.sh 0|1|2
#
# 这是 reconf-pic.sh 的**参数化副本**：唯一可变的是 O 级，其余一字不动。
# 为什么不在 reconf-pic.sh 上加参数：那份是整个项目验证过的基线配方，
# 被 5 个批次依赖；给它加分支会让"重编 Octave 本体"这件事多一条路径可走错。
# 两边一旦漂移，本脚本头部注释就是提醒：改动请同步回去。
#
# 注意 `-O` 同时进 CFLAGS/CXXFLAGS/LDFLAGS——只改编译不改链接会得到
# 混合 O 级（链接期的 LTO/优化决策按 LDFLAGS 走），矩阵就对不上号了。
set -e
OPT=${1:-0}
case "$OPT" in
  0|1|2|3) ;;
  *) echo "用法: $0 0|1|2|3"; exit 1 ;;
esac

export PATH="/usr/src/emsdk:/usr/src/emsdk/upstream/emscripten:/usr/src/emsdk/node/14.18.2_64bit/bin:${PATH}"
PROJECTDIR=/usr/src/octave-wasm
THIRDPARTYDIR=$PROJECTDIR/third_party
INSTALLDIR=$PROJECTDIR/target
BINDIR=$INSTALLDIR/bin
INCDIR=$INSTALLDIR/include
LIBDIR=$INSTALLDIR/lib

cd $THIRDPARTYDIR/octave-7.2.0
echo "=== configure (pic, -O$OPT) ==="
# Fortran 探测在交叉编译下必然失败（fort77 生成的 C 用到未定义的 longint，
# 且 `-o` 之后 emcc 找不到 .c 源），configure 会因此判"cannot compute suffix
# of executables"直接退出。基线配方之所以能过，是因为它依赖 /tmp 里的残留
# conftest.f —— 换个干净容器就复现不了。
# 正解是预置 Fortran INTEGER 大小：configure 在 cross_compiling=yes 时本来
# 就走 `octave_cv_sizeof_fortran_integer=4` 这条短路（见 configure:37604-37613），
# 预置等于替它把答案写好，整段探测不用跑。同 build_pkg_oct.sh 的 cross_compiling 补丁。
emconfigure ./configure \
    octave_cv_lib_arpack_ok_1=yes \
    octave_cv_sizeof_fortran_integer=4 \
    F77=$BINDIR/fort77 \
    CC=emcc \
    CXX=em++ \
    AR=emar \
    RANLIB=emranlib \
    CPPFLAGS="-I$INCDIR" \
    CFLAGS="-I$INCDIR -O$OPT -fPIC" \
    CXXFLAGS="-std=c++11 -I$INCDIR -O$OPT -fwasm-exceptions -fPIC" \
    FFLAGS="-I$INCDIR -O$OPT -E -fPIC" \
    FLIBS="" \
    LDFLAGS="-s ERROR_ON_UNDEFINED_SYMBOLS=0 -L$LIBDIR -O$OPT -fPIC" \
    EMCC_FORCE_STDLIBS=1 \
    EMCONFIGURE_JS=1 \
    BUILD_EXEEXT=.js \
    --host=wasm32-local-emscripten \
    --prefix=$INSTALLDIR \
    --enable-shared --disable-static \
    --disable-threads --disable-openmp \
    --without-qt --disable-java --enable-fortran-calling-convention=f2c --disable-cross-tools \
    --disable-readline --disable-64 --disable-docs --without-curl \
    --with-hdf5-includedir=$INCDIR --with-hdf5-libdir=$LIBDIR \
    --without-opengl --without-framework-carbon --without-framework-opengl --without-x \
    --with-blas=-lrefblas --with-lapack=-lclapack \
    --without-portaudio --without-freetype --without-fontconfig --without-fltk \
    --without-sundials_ida --without-sundials_nvecserial --without-sundials_sunlinsolklu \
    --with-pcre-includedir=$INCDIR --with-pcre-libdir=$LIBDIR \
    --with-cxsparse --with-cxsparse-includedir=$INCDIR --with-cxsparse-libdir=$LIBDIR \
    --without-magick --without-spqr
echo "=== configure exit=$? ==="
grep -E "define HAVE_(ZLIB|BZ2|RAPIDJSON|CCOLAMD|SNDFILE)" config.h || true

# -O2 时全树编译内存需求明显更高（-j24 在 32G 机器上会 OOM），降到 -j12。
JOBS=24
if [ "$OPT" = "2" ] || [ "$OPT" = "3" ]; then JOBS=12; fi

echo "=== make -j$JOBS ==="
emmake make -j$JOBS
echo "=== make exit=$? ==="
emmake make install
echo "=== install exit=$? ==="
echo "=== 重链 web 端（-O$OPT）==="
cd $PROJECTDIR/src
rm -f web/octave.js web/octave.wasm web/octave.data
emmake make web/octave.js
echo ALLDONE
