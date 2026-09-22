#!/usr/bin/env bash
#
# 把 Octave 11.3.0 的 wasm 目标链成**浏览器可用**的 octave.js / octave.wasm / octave.data
#
# 这是 7.2 时代 build/Makefile 里 `web/octave.js` 那条规则的 11.3.0 移植版。
# 与 7.2 的差异（都是实测出来的，别照抄 7.2）：
#   1. m 目录集合不同：11.3.0 有 35 个（7.2 没这么多），且多出 `+matlab`、
#      `+containers`、`@ftp` 三个特殊目录 → preload 清单**动态生成**，不写死；
#      并且 main.cc 的 path 里必须加 **m 目录本身**（它们靠父目录解析）。
#   2. C++ 标准：11.3.0 要 C++17（7.2 是 C++11）。
#   3. emsdk 5.0.7 没有 `-enable-emscripten-cxx-exceptions` 这个老旗标（改用 -fwasm-exceptions）。
#   4. 库清单按 11.3.0 的实际配置裁剪（P0 阶段我们 --without 掉了长尾库，
#      所以这里只需要 libinterp/liboctave/libgnu + lapack/refblas/f2c/pcre2）。
#      S4 开回长尾后要回来加 -l。
#
# 用法（容器内）：bash link-web.sh [输出目录]
#
set -euo pipefail

OUT="${1:-/src/websrc/out}"
OCT="$(cd /src/work/octave-11.3.0 && pwd)"
INST=/src/work/octave-install
MV="11.3.0"
M="$INST/share/octave/$MV/m"
SRC=/src/websrc
DEPS=/usr/local

[ -f "$SRC/main.o" ] || { echo "FATAL: 缺 $SRC/main.o（先编 main.cc）" >&2; exit 2; }
[ -f "$SRC/post.js" ] || { echo "FATAL: 缺 $SRC/post.js" >&2; exit 2; }
[ -d "$M" ] || { echo "FATAL: 缺 $M（Octave 装了没）" >&2; exit 2; }

mkdir -p "$OUT"

# ---- preload：11.3.0 的 m 子目录逐个映射到 /usr/src/octave/m/<name> ----------
# （main.cc 里硬编码的就是 /usr/src/octave/m/... 这套路径）
PRELOAD=()
for d in "$M"/*/; do
  n="$(basename "$d")"
  PRELOAD+=("--preload-file" "${d%/}@/usr/src/octave/m/$n")
done
echo "== preload ${#PRELOAD[@]} 项（含 +matlab/+containers/@ftp），来自 $M"

# ---- 主链 ---------------------------------------------------------------
#  MAIN_MODULE=1 + ALLOW_TABLE_GROWTH=1：为 .oct side module 的 dlopen 服务
#  （闸门②探针已实测 emsdk 5.0.7 上可行）
#  -Wl,--allow-multiple-definition：f2c 把每个 COMMON 块渲染成逐文件 tentative
#  definition，clang 默认 -fno-common 会变成冲突的强定义（dls001_/globe_…），
#  而 -fcommon 不能用（wasm-ld 没有 common symbol 链接）
SFLAGS=( -s WASM=1 -s MAIN_MODULE=1 -s ALLOW_TABLE_GROWTH=1
         -s ERROR_ON_UNDEFINED_SYMBOLS=0
         -s INITIAL_MEMORY=128MB -s ALLOW_MEMORY_GROWTH=1 )

LIBS=(
  # Octave 自身的三个归档
  "$OCT/libinterp/.libs/liboctinterp.a"
  "$OCT/liboctave/.libs/liboctave.a"
  "$OCT/libgnu/.libs/libgnu.a"
  # 各库的独立 prefix（② 建的）
  -L/src/deps/glpk/lib -L/src/deps/qhull/lib -L/src/deps/fftw/lib
  -L/src/deps/sndfile/lib -L/src/deps/qrupdate/lib -L/src/deps/hdf5/lib
  -L/src/deps/zlibbz2/lib -L/src/deps/arpack/lib -L/src/deps/suitesparse/lib
  -L"$DEPS/lib"
  # 早期四个 + Octave 自己报的链接依赖（LIBOCTINTERP_LINK_DEPS / LIBOCTAVE_LINK_DEPS）
  -llapack -lrefblas -lf2c -lpcre2-8
  -lhdf5 -lz -lbz2
  -lcholmod -lumfpack -lamd -lcamd -lcolamd -lccolamd -lcxsparse -lsuitesparseconfig
  -lfftw3 -lfftw3f -larpack -lqrupdate
  # ⚠️ 这三个**不在** LIB*_LINK_DEPS 里（它们只被 dldfcn 用），但必须链进主模块：
  #   `.oct` 是 side module、**不链任何库**，装载时靠主模块解析符号——
  #   qhull ← convhulln/__delaunayn__/__voronoi__，glpk ← __glpk__，sndfile ← audioread。
  #   7.2 的 Makefile 注释里专门记了这条（"下面这一串 -l 一个都不能删"）。
  -lglpk -lqhull_r -lsndfile
  -lm
)

#  ---- 异常模式：必须与整棵树一致 -------------------------------------------
#  实测坑：给 main.o 用 `-fwasm-exceptions`（原生 wasm 异常）而树用 `-fexceptions`
#  （emscripten 的 JS 式异常，链接行里带 -mllvm -enable-emscripten-cxx-exceptions
#   -mllvm -enable-emscripten-sjlj）→ 链接期断言失败：
#     AssertionError: invoke_ functions exported but exceptions and longjmp are both disabled
#  所以**编译 main.cc 与最终链接都用 `-fexceptions`**，与 configure 时给
#  CXXFLAGS 的口径一致。
EXC_FLAGS=( -O2 -fPIC -std=c++17 -fwasm-exceptions )

echo "== 编 main.cc"
em++ -I"$INST/include" -I"$INST/include/octave-$MV" -I"$INST/include/octave-$MV/octave" \
     "${EXC_FLAGS[@]}" -c "$SRC/main.cc" -o "$SRC/main.o"
echo "   main.o = $(stat -c%s "$SRC/main.o") 字节"

cd "$SRC"
set -x
em++ --bind \
  "${SFLAGS[@]}" \
  -s EXPORTED_FUNCTIONS='["_main"]' \
  -s EXPORTED_RUNTIME_METHODS='["FS","MEMFS"]' \
  -s MODULARIZE=1 -s EXPORT_NAME=OCTAVE -s ENVIRONMENT=web -s EXPORT_ES6=0 \
  "${PRELOAD[@]}" \
  --post-js "$SRC/post.js" \
  "${EXC_FLAGS[@]}" -Wl,--allow-multiple-definition \
  "${LIBS[@]}" \
  -o "$OUT/octave.js" "$SRC/main.o"
set +x

echo "== 产物:"
ls -la "$OUT"
