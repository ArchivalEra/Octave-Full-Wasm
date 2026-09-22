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
# M_SRC：预载的**源**树。默认就是安装树；`build/prerender-m-docstrings.py` 会产出一棵
# staged 树（docstring 已渲染成纯文本、去掉 `-*- texinfo -*-` 标记），把它指过来即可。
# **运行期路径完全不变**（仍是 /usr/src/octave/m/...），只是 .m 文件里的 docstring 变了，
# 于是 `help ode45` 这类 .m 文件不再触发运行时的 makeinfo（本构建没有 shell）。
M_SRC="${M_SRC:-$M}"
SRC=/src/websrc
DEPS=/usr/local

[ -f "$SRC/main.o" ] || { echo "FATAL: 缺 $SRC/main.o（先编 main.cc）" >&2; exit 2; }
[ -f "$SRC/post.js" ] || { echo "FATAL: 缺 $SRC/post.js" >&2; exit 2; }
[ -d "$M_SRC" ] || { echo "FATAL: 缺 $M_SRC（Octave 装了没 / staged 树生成了没）" >&2; exit 2; }

mkdir -p "$OUT"

# ---- preload：11.3.0 的 m 子目录逐个映射到 /usr/src/octave/m/<name> ----------
# （main.cc 里硬编码的就是 /usr/src/octave/m/... 这套路径）
#
# ⚠️ `--preload-file` 按**第一个 `@`** 把参数切成 `src@dst`。而 `m/` 下正好有个
#    `@ftp` 目录 —— 它的**源路径自带 `@`**，于是那条参数被切错：
#        src = `.../m/`                （少了一层，变成整个 m/）
#        dst = `ftp@/usr/src/octave/m/@ftp`
#    实测后果：`octave.js` 的文件表里多出 **1087 条记录 / 5.25MB**（占文件表 44%）
#    的**整棵 m/ 副本**，而 `@ftp` 自己的文件**没有**落在正确路径上
#    （`/usr/src/octave/m/@ftp/loadobj.m` 查无此文件）。
#    修法：源路径里带 `@` 的目录先拷到一个**名字里没有 `@`** 的暂存目录再预载；
#    目的地仍然写成正确的 `/usr/src/octave/m/@ftp`（dst 里可以有 `@`，切在第一个之后）。
PRELOAD=()
PRELOAD_AT="${PRELOAD_AT:-/src/work/m-preload}"
for d in "$M_SRC"/*/; do
  n="$(basename "$d")"
  s="${d%/}"
  case "$s" in
    *@*)
      safe="$(printf '%s' "$n" | tr '@' '_')"
      mkdir -p "$PRELOAD_AT"
      rm -rf "$PRELOAD_AT/$safe"
      cp -a "$s" "$PRELOAD_AT/$safe"
      echo "== preload 路径含 '@'：$n 暂存到 $PRELOAD_AT/$safe（否则整棵 m/ 会被复制错位）"
      s="$PRELOAD_AT/$safe"
      ;;
  esac
  PRELOAD+=("--preload-file" "$s@/usr/src/octave/m/$n")
done
echo "== preload ${#PRELOAD[@]} 项（含 +matlab/+containers/@ftp），来自 $M_SRC"

# ---- forge 预装集（20 个 .m）→ /usr/src/octave/m/forge ----------------------
# 为什么要有这一项：7.2 的站点上 `exist("normpdf")` **不加载任何资产就是 2**，
# 因为它的主链把一小撮 forge .m **预装**进了 `m/forge/`（实测 which →
# `/usr/src/octave/m/forge/normpdf.m`）。这批函数是早期为补 `ttest` 依赖塞进去的
# （betacdf/fcdf/gamcdf/normcdf/normpdf/ttest… 共 20 个，另含 fft/ifft/asciiplot，
# 其中 fft/ifft 被核心内建遮蔽、无害）。
# 11.3.0 的链一开始只 preload 了 `m` 的 35 个子目录，缺这一项 ⇒ `normpdf` 变成
# "要加载 statistics 资产才有"，**相对 7.2 是行为回退**。
# 文件集已入仓（build/forge-preload/），容器内同步到 /src/websrc/forge。
FORGE_SRC="${FORGE_SRC:-/src/websrc/forge}"
if [ -d "$FORGE_SRC" ] && ls "$FORGE_SRC"/*.m >/dev/null 2>&1; then
  PRELOAD+=("--preload-file" "$FORGE_SRC@/usr/src/octave/m/forge")
  echo "== preload forge 预装集：$(ls "$FORGE_SRC"/*.m | wc -l) 个 .m → /usr/src/octave/m/forge"
else
  echo "⚠ 缺 $FORGE_SRC/*.m —— 主链会少掉 7.2 就有的 forge 预装（normpdf 等会变成需懒加载）"
fi

# ---- 主链 ---------------------------------------------------------------
#  MAIN_MODULE=1 + ALLOW_TABLE_GROWTH=1：为 .oct side module 的 dlopen 服务
#  （闸门②探针已实测 emsdk 5.0.7 上可行）
#  -Wl,--allow-multiple-definition：f2c 把每个 COMMON 块渲染成逐文件 tentative
#  definition，clang 默认 -fno-common 会变成冲突的强定义（dls001_/globe_…），
#  而 -fcommon 不能用（wasm-ld 没有 common symbol 链接）
SFLAGS=( -s WASM=1 -s MAIN_MODULE=1 -s ALLOW_TABLE_GROWTH=1
         -s ERROR_ON_UNDEFINED_SYMBOLS=0
         -s INITIAL_MEMORY=128MB -s ALLOW_MEMORY_GROWTH=1 )

# EXPORTED_FUNCS：逗号分隔的导出符号名（默认只有 `_main`）。
# ⚠️ 为什么要有这个口子：`MAIN_MODULE=2`（DCE 版）下，**JS 库符号也要列进导出**
#    才会进 JS 胶水的符号表（`tools/emscripten.py:868-884` 只把
#    `EXPORTED_FUNCTIONS + SIDE_MODULE_IMPORTS` 里的库函数加进去）——
#    side module 里的 `emscripten_run_script`（webnet 那套同步 XHR）就靠它解析。
#    实测踩过：把它写进 EXTRA_LDFLAGS **没用**，因为下面那行 `-s EXPORTED_FUNCTIONS=`
#    在后面会把它覆盖掉（`-s` 后者胜）。
#    M2 车道用：EXPORTED_FUNCS="_main,emscripten_run_script,exit,__assert_fail"
EXPORTED_FUNCS="${EXPORTED_FUNCS:-_main}"
EF_JSON="["
IFS=',' read -r -a _ef <<< "$EXPORTED_FUNCS"
for _f in "${_ef[@]}"; do EF_JSON="$EF_JSON\"$_f\","; done
EF_JSON="${EF_JSON%,}]"
echo "== EXPORTED_FUNCTIONS = $EF_JSON"

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
  -lhdf5
  # ⚠️ zlib/bz2 必须 **--whole-archive**：`.oct`（gzip/webio）依赖 zlib 的
  #   流式接口（deflate/inflate/gzopen/crc32），而 Octave 核心自己**不引用**它们
  #   → 静态库按需拉取时那些对象不会被带进来 → 既不在主模块里、也不在导出表里
  #   → .oct 导入解析不到 → 调用即整页 trap（实测）。
  # ⚠️ 不要用 --whole-archive 整库拉 zlib/bz2：实测那样会把 convhulln 与 glpk
  #   弄崩（整库引入的符号与 qhull/glpk 撞车 → `.oct` 的导入解析到错的东西 →
  #   调用打到 emscripten 的 stub，报 "TypeError: resolved is not a function"）。
  #   改用**定点拉取**：只 `-u` 出 `.oct` 真正需要的那几个符号，
  #   链接器会只把定义它们的那些对象拉进来，没有附带损伤。
  -Wl,-u,deflate -Wl,-u,deflateEnd -Wl,-u,deflateInit2_ -Wl,-u,deflateSetHeader
  -Wl,-u,inflate -Wl,-u,inflateEnd -Wl,-u,inflateInit2_
  -Wl,-u,gzopen -Wl,-u,gzclose -Wl,-u,gzread -Wl,-u,crc32
  -Wl,-u,BZ2_bzCompress -Wl,-u,BZ2_bzCompressInit -Wl,-u,BZ2_bzCompressEnd
  -Wl,-u,BZ2_bzDecompress -Wl,-u,BZ2_bzDecompressInit -Wl,-u,BZ2_bzDecompressEnd
  -lz -lbz2
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
# DIAG_NAMES=1：加 `--profiling-funcs`，**产物里保留函数名**（name 段）。
#   为什么要它：线上产物是 `--strip-debug` 的，wasm 里只有 `dylink.0` 一个 custom
#   段，**没有 name 段** → 浏览器报的 `RuntimeError: unreachable at
#   wasm-function[NNNNN]` 没法翻译成函数名（`lsode` 那个整页 trap 就卡在这）。
#   诊断时这样链一次到独立目录，就能把索引符号化；**别拿它当部署产物**（更大）。
#   用法：DIAG_NAMES=1 bash link-web.sh /src/websrc/diag
DIAG=()
[ "${DIAG_NAMES:-0}" = "1" ] && { DIAG=( --profiling-funcs ); echo "== DIAG_NAMES=1：保留函数名（name 段）"; }
# DIAG_ASSERT=1：打开 emscripten 的运行时断言（-s ASSERTIONS=1）。
#   为什么需要：浏览器只给一句 `RuntimeError: unreachable`，看不出 abort 的原因。
#   开了断言之后，多数 abort 会在 console 里打出可读原因（越界、未捕获异常、
#   栈溢出……）。和 DIAG_NAMES 一起用，就能"有名字 + 有原因"。
[ "${DIAG_ASSERT:-0}" = "1" ] && { DIAG+=( -s ASSERTIONS=1 ); echo "== DIAG_ASSERT=1：打开运行时断言"; }
# DIAG_SOURCEMAP=1：产出 octave.wasm.map，把 wasm 偏移映射回源码行。
#   用途：浏览器只报 `wasm-function[N]:0x<文件偏移>`，有了 source map 就能翻成
#   `文件:行`（本仓的 wasm-opt/wasm-dis 不带 dwarfdump，只能走这条路）。
[ "${DIAG_SOURCEMAP:-0}" = "1" ] && { DIAG+=( -g -gsource-map ); echo "== DIAG_SOURCEMAP=1：产出 source map"; }

set -x
# EXTRA_LDFLAGS：诊断/定点补救用（空格分隔的链接旗标）。
#   当前用途：`-Wl,-u,dlsode_` —— 强制把 odepack 的入口从归档里拉进主模块
#   （`lsode` 整页 trap 的候选根因：dlsode_ 没被链进来，调用落到空导入 → trap；
#    与 HANDOFF §10.3 坑 3 的 zlib 完全同一类问题、同一个修法）。
em++ --bind \
  "${DIAG[@]}" \
  "${SFLAGS[@]}" \
  ${EXTRA_LDFLAGS:-} \
  -s "EXPORTED_FUNCTIONS=$EF_JSON" \
  -s EXPORTED_RUNTIME_METHODS='["FS","MEMFS"]' \
  -s MODULARIZE=1 -s EXPORT_NAME=OCTAVE -s ENVIRONMENT=web -s EXPORT_ES6=0 \
  "${PRELOAD[@]}" \
  --post-js "$SRC/post.js" \
  "${EXC_FLAGS[@]}" -Wl,--allow-multiple-definition \
  "${LIBS[@]}" \
  -o "$OUT/octave.js" "$SRC/main.o"
set +x

# ---- 自检：预载路径有没有错位 ------------------------------------------------
# 专防上面那个 `@ftp` 坑复发：`--preload-file` 按第一个 `@` 切 src@dst，源路径里
# 只要有 `@`，整棵目录就会被搬到错误的地方（实测代价：**5.25MB 重复数据 /
# octave.data 翻倍**）。跑完直接查文件表，错位就**明确失败**，别静默出包。
if grep -q 'filename:"/ftp@' "$OUT/octave.js"; then
  echo "FATAL: 预载路径错位 —— octave.js 里出现 /ftp@/ 前缀的记录" >&2
  echo "       说明 m/ 下某个源目录名里含 '@' 且没走 PRELOAD_AT 暂存那条路" >&2
  echo "       （octave.data 会比正常大一倍，且该目录的文件不在正确路径上）" >&2
  exit 3
fi

echo "== 产物:"
ls -la "$OUT"
