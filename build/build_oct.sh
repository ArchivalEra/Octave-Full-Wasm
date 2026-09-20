#!/bin/sh
# 把 libinterp/dldfcn/<name>.cc 编成 wasm side module（= 真 .oct），
# 给 `-sMAIN_MODULE=1` 的主链用 dlopen 加载。容器内跑。
#
#   build_oct.sh gzip convhulln ...      # 产物在 $OUT（默认 /octs）
#
# 与 build_dldfcn.sh 的关系：那个编的是「静态直装」用的 .o，编完挂终链；
# 这个编的是「动态装载」用的 .oct，不挂终链，靠运行时 dlopen。
# 两者共用同一套 FLAGS，差别只在这里多一个 -sSIDE_MODULE=1 的链接步。
#
# 三个必须踩对的点：
#   1. 必须先 `cd $OCT` —— FLAGS 里的 `-I.` 是为了让 `#include "config.h"` 找得到，
#      切目录后 config.h 立刻 not found（本脚本曾在编到一半 cd 走，直接翻车）。
#   2. 必须带 `-DHAVE_CONFIG_H` + 源码树头目录：dldfcn 源码用的是 Octave 的
#      `doc: /* -*- texinfo -*- */` 写法，只给「已安装头文件」那两个 -I 会报
#      `use of undeclared identifier 'doc'`。
#   3. 链接一律 `-sSIDE_MODULE=1`，**不要**链任何 Octave/第三方库——
#      .oct 里对 octave:: / zlib / qhull 符号的引用由主模块在 dlopen 时解析
#      （MAIN_MODULE=1 会把主模块全部符号导出）。
set -e
export PATH=/usr/src/emsdk:/usr/src/emsdk/upstream/emscripten:/usr/src/emsdk/node/14.18.2_64bit/bin:$PATH
OCT=/usr/src/octave-wasm/third_party/octave-7.2.0
PREFIX=/usr/src/octave-wasm/target
OUT=${OUT:-/octs}
mkdir -p $OUT

FLAGS="-DHAVE_CONFIG_H -I. -Iliboctave -I$OCT/liboctave -I$OCT/liboctave/array \
-Iliboctave/numeric -I$OCT/liboctave/numeric -Iliboctave/operators -I$OCT/liboctave/operators \
-I$OCT/liboctave/system -I$OCT/liboctave/util -I$OCT/libinterp/octave-value \
-Ilibinterp -I$OCT/libinterp -I$OCT/libinterp/operators \
-Ilibinterp/parse-tree -I$OCT/libinterp/parse-tree \
-Ilibinterp/corefcn -I$OCT/libinterp/corefcn -I$OCT/liboctave/wrappers \
-I$PREFIX/include -std=c++11 -O2 -fwasm-exceptions -fPIC"

cd $OCT
for m in "$@"; do
  SRC=$OCT/libinterp/dldfcn/$m.cc
  [ -f "$SRC" ] || { echo "no such dldfcn: $SRC" >&2; exit 1; }
  em++ $FLAGS -c "$SRC" -o "$OUT/$m.oct.o"
  em++ -sSIDE_MODULE=1 -fPIC -O0 -shared -o "$OUT/$m.oct" "$OUT/$m.oct.o"
  echo "built $OUT/$m.oct ($(stat -c%s "$OUT/$m.oct") bytes)"
done
