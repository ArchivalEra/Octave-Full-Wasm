#!/bin/sh
# Compile Octave dldfcn/*.cc modules that can't be .oct-loaded in wasm,
# so they can be static-linked and driven by main.cc's STATIC_DLD_FCNS
# registry.  Run INSIDE the build container (obuild), emsdk on PATH.
#
#   build_dldfcn.sh convhulln fftw __delaunayn__ ...
#
# Writes <name>.o into $DEST (default target/lib).  Then add:
#   target/lib/<name>.o   to src/Makefile EM_LDFLAGS, and
#   X("<name>", G<name>)  to src/main.cc STATIC_DLD_FCNS.
set -e
EMSDK=/usr/src/emsdk
export PATH=$EMSDK:$EMSDK/upstream/emscripten:$PATH
OCT=/usr/src/octave-wasm/third_party/octave-7.2.0
PREFIX=/usr/src/octave-wasm/target
DEST=${DEST:-$PREFIX/lib}

FLAGS="-DHAVE_CONFIG_H -I. -Iliboctave -I$OCT/liboctave -I$OCT/liboctave/array \
-Iliboctave/numeric -I$OCT/liboctave/numeric -Iliboctave/operators -I$OCT/liboctave/operators \
-I$OCT/liboctave/system -I$OCT/liboctave/util -I$OCT/libinterp/octave-value \
-Ilibinterp -I$OCT/libinterp -I$OCT/libinterp/operators \
-Ilibinterp/parse-tree -I$OCT/libinterp/parse-tree \
-Ilibinterp/corefcn -I$OCT/libinterp/corefcn -I$OCT/liboctave/wrappers \
-I$PREFIX/include -std=c++11 -O2 -fwasm-exceptions"

cd $OCT
for m in "$@"; do
  em++ $FLAGS -c "libinterp/dldfcn/$m.cc" -o "$DEST/$m.o"
  echo "built $DEST/$m.o"
done
