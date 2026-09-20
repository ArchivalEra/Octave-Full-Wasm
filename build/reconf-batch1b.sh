#!/bin/sh
# Octave-Full-Wasm — 批次 1b 的 configure 配方（libsndfile → audioread 系列）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

# Batch 1b reconfigure: enable libsndfile (audioread/audiowrite/audioinfo/
# audioformats).  Same as batch1 but --without-sndfile is removed.
set -e
export PATH="/usr/src/emsdk:/usr/src/emsdk/upstream/emscripten:/usr/src/emsdk/node/14.18.2_64bit/bin:${PATH}"
PROJECTDIR=/usr/src/octave-wasm
THIRDPARTYDIR=$PROJECTDIR/third_party
INSTALLDIR=$PROJECTDIR/target
BINDIR=$INSTALLDIR/bin
INCDIR=$INSTALLDIR/include
LIBDIR=$INSTALLDIR/lib

cd $THIRDPARTYDIR/octave-7.2.0
echo "=== configure (batch1b) ==="
emconfigure ./configure \
    octave_cv_lib_arpack_ok_1=yes \
    F77=$BINDIR/fort77 \
    CC=emcc \
    CXX=em++ \
    AR=emar \
    RANLIB=emranlib \
    CFLAGS="-I$INCDIR -O0" \
    CXXFLAGS="-std=c++11 -I$INCDIR -O0 -fwasm-exceptions" \
    FFLAGS="-I$INCDIR -O0 -E" \
    FLIBS="" \
    LDFLAGS="-s ERROR_ON_UNDEFINED_SYMBOLS=0 -L$LIBDIR -O0" \
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
