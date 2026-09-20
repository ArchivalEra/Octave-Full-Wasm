#!/bin/sh
# Octave-Full-Wasm — configure 配方（-fPIC 版，为 MAIN_MODULE=1 / 真 .oct）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

# -fPIC 版 configure + 全量重编 + 安装（为 MAIN_MODULE=1 可重定位主链 / 真 .oct 动态装载）。
#
# 与 reconf-batch1b.sh 的唯一差别：CFLAGS / CXXFLAGS / FFLAGS 各加一个 -fPIC。
# 不要手抄这份食谱再改 —— 当初手抄漏了 --without-cxsparse 直接 configure 失败；
# 正确姿势是拿 reconf-batch1b.sh 跑 sed 只加 -fPIC（见 CLIBS.md「真 .oct」节）。
#
# 为什么要 -fPIC：`-sMAIN_MODULE=1` 走 `--experimental-pic -pie`，wasm-ld 对任何
# 非 PIC 对象直接报 `relocation R_WASM_MEMORY_ADDR_LEB ... recompile with -fPIC`。
# 重编前必须先 `emmake make clean`（树里残留的非 PIC .o 不会被 make 自动重编）。
set -e
export PATH="/usr/src/emsdk:/usr/src/emsdk/upstream/emscripten:/usr/src/emsdk/node/14.18.2_64bit/bin:${PATH}"
PROJECTDIR=/usr/src/octave-wasm
THIRDPARTYDIR=$PROJECTDIR/third_party
INSTALLDIR=$PROJECTDIR/target
BINDIR=$INSTALLDIR/bin
INCDIR=$INSTALLDIR/include
LIBDIR=$INSTALLDIR/lib

cd $THIRDPARTYDIR/octave-7.2.0
echo "=== configure (pic) ==="
emconfigure ./configure \
    octave_cv_lib_arpack_ok_1=yes \
    F77=$BINDIR/fort77 \
    CC=emcc \
    CXX=em++ \
    AR=emar \
    RANLIB=emranlib \
    CFLAGS="-I$INCDIR -O0 -fPIC" \
    CXXFLAGS="-std=c++11 -I$INCDIR -O0 -fwasm-exceptions -fPIC" \
    FFLAGS="-I$INCDIR -O0 -E -fPIC" \
    FLIBS="" \
    LDFLAGS="-s ERROR_ON_UNDEFINED_SYMBOLS=0 -L$LIBDIR -O0 -fPIC" \
    EMCC_FORCE_STDLIBS=1 \
    EMCONFIGURE_JS=1 \
    BUILD_EXEEXT=.js \
    --host=wasm32-local-emscripten \
    --prefix=$INSTALLDIR \
    --enable-shared --disable-static \
    --disable-threads --disable-openmp \
    --without-qt --disable-java --enable-fortran-calling-convention=f2c --disable-cross-tools \
    --disable-readline --disable-64 --disable-docs --without-curl --without-hdf5 \
    --without-opengl --without-framework-carbon --without-framework-opengl --without-x \
    --with-blas=-lrefblas --with-lapack=-lclapack \
    --without-portaudio --without-freetype --without-fontconfig --without-fltk \
    --without-sundials_ida --without-sundials_nvecserial --without-sundials_sunlinsolklu \
    --with-pcre-includedir=$INCDIR --with-pcre-libdir=$LIBDIR \
    --without-cxsparse \
    --without-magick --without-spqr
echo "=== configure exit=$? ==="
grep -E "define HAVE_(ZLIB|BZ2|RAPIDJSON|CCOLAMD|SNDFILE)" config.h || true
echo "=== make ==="
emmake make -j24
echo "=== make exit=$? ==="
emmake make install
echo "=== install exit=$? ==="
echo ALLDONE
