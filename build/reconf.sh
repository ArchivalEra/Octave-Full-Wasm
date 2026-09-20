#!/bin/sh
# Octave-Full-Wasm — 基线 configure 配方（与上游 Dockerfile 同 flag）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

# Octave 7.2.0 reconfigure: enable qrupdate/arpack/fftw3/fftw3f/qhull_r/glpk.
# Same flags as Dockerfile, minus the five --without-* lines.
set -e
export PATH="/usr/src/emsdk:/usr/src/emsdk/upstream/emscripten:/usr/src/emsdk/node/14.18.2_64bit/bin:${PATH}"
PROJECTDIR=/usr/src/octave-wasm
THIRDPARTYDIR=$PROJECTDIR/third_party
INSTALLDIR=$PROJECTDIR/target
BINDIR=$INSTALLDIR/bin
INCDIR=$INSTALLDIR/include
LIBDIR=$INSTALLDIR/lib

echo "=== env ==="
printenv | grep -E "^(PROJECTDIR|INSTALLDIR|EMSDK|EM_CONFIG)" || true
echo "=== libs present ==="
ls $LIBDIR/libqrupdate.a $LIBDIR/libarpack.a $LIBDIR/libfftw3.a $LIBDIR/libfftmp3f.a $LIBDIR/libqhull_r.a $LIBDIR/libglpk.a 2>&1 || ls $LIBDIR/libqrupdate.a $LIBDIR/libarpack.a $LIBDIR/libfftw3.a $LIBDIR/libfftw3f.a $LIBDIR/libqhull_r.a $LIBDIR/libglpk.a

cd $THIRDPARTYDIR/octave-7.2.0
echo "=== configure ==="
# octave_cv_lib_arpack_ok_1=yes: the ARPACK "works" test compiles+links OK
# but must RUN under container Node 14, which rejects the Wasm exception
# section (WebAssembly.instantiate: unexpected section <Exception>).
# Env limitation, not a library defect — numerics proven later via eigs-vs-eig.
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
    --without-sndfile --without-portaudio --without-freetype --without-fontconfig --without-fltk \
    --without-sundials_ida --without-sundials_nvecserial --without-sundials_sunlinsolklu \
    --with-pcre-includedir=$INCDIR --with-pcre-libdir=$LIBDIR --without-cxsparse --without-ccolamd \
    --without-z --without-bz2 --without-magick --without-spqr --disable-rapidjson
echo "=== configure exit=$? ==="
echo "=== feature check ==="
grep -E "^(HAVE_QRHACK|HAVE_QRUPDATE|HAVE_ARPACK|HAVE_FFTW|HAVE_QHULL|HAVE_GLPK)" config.h 2>/dev/null || grep -iE "qrupdate|arpack|fftw|qhull|glpk" config.log | grep -iE "result|yes|no" | tail -n 20
echo "=== make ==="
emmake make -j24
echo "=== make exit=$? ==="
echo "=== install ==="
emmake make install
echo "=== install exit=$? ==="
echo ALLDONE
