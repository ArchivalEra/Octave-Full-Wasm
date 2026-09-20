#!/bin/sh
# 5 个「非 PIC」静态库 → -fPIC 重建（配合 build/reconf-pic.sh）。
#
# 为什么只有这 5 个：用 `-Wl,--error-limit=0` 让 wasm-ld 报全量错误后统计出来的
# 完整清单就是 liboctave.a + libglpk.a + libarpack.a + libsndfile.a +
# libqhull_r.a + libfftw3.a + libfftw3f.a。
# f2c / refblas / clapack / pcre / SuiteSparse 那几个是 `.so`（-shared 编的），
# **零报错，不要动**。
#
# 每个库的配方 = 原配方（出处 /tmp/*-conf.log，与 CLIBS.md 一致）+ CFLAGS 追加 -fPIC。
# 两个坑：
#   1. ARPACK 的 fort77 必须在 arpack 源码 SRC/ 目录里跑 —— arpack_all.f 里有
#      Fortran `include 'debug.h'`，f2c 按 cwd 找，否则 "Cannot open file debug.h"。
#   2. fort77 要从 $PREFIX/bin/fort77 走绝对路径（脚本 PATH 里没有 target/bin）。
set -e
export PATH=/usr/src/emsdk:/usr/src/emsdk/upstream/emscripten:/usr/src/emsdk/node/14.18.2_64bit/bin:$PATH
PREFIX=/usr/src/octave-wasm/target
INCDIR=$PREFIX/include
F77=$PREFIX/bin/fort77
TC=/usr/src/emsdk/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake
EMU="/usr/src/emsdk/node/14.18.2_64bit/bin/node;--experimental-wasm-threads"
J=${J:-12}

echo "########## GLPK"
cd /tmp/gl/glpk-5.0
emmake make clean >/dev/null 2>&1 || true
emconfigure ./configure --prefix=$PREFIX --disable-shared --enable-static CFLAGS="-O2 -fPIC" > /tmp/pic-glpk-conf.log 2>&1
emmake make -j$J > /tmp/pic-glpk-make.log 2>&1
emmake make install > /tmp/pic-glpk-inst.log 2>&1

echo "########## ARPACK (单 TU)"
cd /tmp/a370/arpack-ng-3.7.0/SRC && $F77 -O0 -I$INCDIR -fPIC -c /tmp/arpack_all.f -o /tmp/arpack-one.o > /tmp/pic-ak.log 2>&1
emar rcs $PREFIX/lib/libarpack.a /tmp/arpack-one.o
emranlib $PREFIX/lib/libarpack.a

echo "########## FFTW double"
cd /tmp/fftw-src/fftw-3.3.10
emmake make distclean >/dev/null 2>&1 || true
emconfigure ./configure --prefix=$PREFIX --disable-fortran --disable-threads --disable-openmp --disable-shared --enable-static CFLAGS="-O2 -fPIC" > /tmp/pic-fftw1-conf.log 2>&1
emmake make -j$J > /tmp/pic-fftw1-make.log 2>&1
emmake make install > /tmp/pic-fftw1-inst.log 2>&1

echo "########## FFTW single"
emmake make distclean >/dev/null 2>&1 || true
emconfigure ./configure --prefix=$PREFIX --disable-fortran --disable-threads --disable-openmp --disable-shared --enable-static --enable-single CFLAGS="-O2 -fPIC" > /tmp/pic-fftw2-conf.log 2>&1
emmake make -j$J > /tmp/pic-fftw2-make.log 2>&1
emmake make install > /tmp/pic-fftw2-inst.log 2>&1

echo "########## QHULL"
emcmake cmake -S /tmp/ql/qhull-8.0.2 -B /tmp/ql/build -DCMAKE_INSTALL_PREFIX=$PREFIX -DBUILD_SHARED_LIBS=OFF -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_FLAGS=-fPIC -DCMAKE_CXX_FLAGS=-fPIC -DCMAKE_TOOLCHAIN_FILE=$TC -DCMAKE_CROSSCOMPILING_EMULATOR="$EMU" > /tmp/pic-ql-conf.log 2>&1
emmake cmake --build /tmp/ql/build -j$J > /tmp/pic-ql-make.log 2>&1
emmake cmake --install /tmp/ql/build > /tmp/pic-ql-inst.log 2>&1
cp -f $PREFIX/lib/libqhullstatic_r.a $PREFIX/lib/libqhull_r.a

echo "########## LIBSNDFILE"
cd /tmp/ls/libsndfile-1.2.2
emcmake cmake -S . -B build -DCMAKE_INSTALL_PREFIX=$PREFIX -DBUILD_SHARED_LIBS=OFF -DBUILD_PROGRAMS=OFF -DBUILD_EXAMPLES=OFF -DBUILD_TESTING=OFF -DENABLE_EXTERNAL_LIBS=OFF -DENABLE_MPEG=OFF -DCMAKE_C_FLAGS=-fPIC -DCMAKE_TOOLCHAIN_FILE=$TC -DCMAKE_CROSSCOMPILING_EMULATOR="$EMU" > /tmp/pic-ls-conf.log 2>&1
emmake cmake --build build -j$J > /tmp/pic-ls-make.log 2>&1
emmake cmake --install build > /tmp/pic-ls-inst.log 2>&1

echo "PIC_LIBS_ALLDONE"
