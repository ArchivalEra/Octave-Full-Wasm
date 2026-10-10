#!/usr/bin/env bash
# 裸 clang + 裸 wasm-ld 编 w64 档 .oct（不经 emcc）—— 实验固化配方
set -euo pipefail
E=${E:-/emsdk/upstream}; SR=$E/emscripten/cache/sysroot
OCT=${OCT:-/src/work/octave-11.3.0}; IW=${IW:-/src/work/octave-install-w64}
src=$1; out=$2
INC="-DHAVE_CONFIG_H -I$OCT -I$OCT/liboctave -I$OCT/liboctave/array -I$OCT/liboctave/numeric -I$OCT/liboctave/operators -I$OCT/liboctave/system -I$OCT/liboctave/util -I$OCT/liboctave/wrappers -I$OCT/libinterp -I$OCT/libinterp/octave-value -I$OCT/libinterp/operators -I$OCT/libinterp/parse-tree -I$OCT/libinterp/corefcn -I$IW/include/octave-11.3.0 -I$IW/include/octave-11.3.0/octave -isystem $SR/include/compat"
o=${out%.oct}.o
$E/bin/clang --target=wasm64-unknown-emscripten --sysroot=$SR -fvisibility=default $INC \
  -fPIC -O2 -fwasm-exceptions -pthread -c "$src" -o "$o"
$E/bin/wasm-ld -mwasm64 -o "$out" --strip-debug \
  --export=__wasm_call_ctors --export=_emscripten_tls_init --export-dynamic \
  --experimental-pic --unresolved-symbols=import-dynamic \
  -shared --shared-memory --no-stack-first \
  $SR/lib/wasm64-emscripten/pic/crtbegin-mt.o "$o" \
  -L$SR/lib/wasm64-emscripten/pic -L$E/emscripten/src/lib \
  -mllvm -wasm-enable-eh -mllvm -exception-model=wasm 2>&1 | grep -v "not yet stable" || true
echo "$(stat -c%s "$out") B -> $out"
