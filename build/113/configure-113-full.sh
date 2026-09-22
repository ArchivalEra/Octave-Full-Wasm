#!/usr/bin/env bash
#
# ③ 一次性全开：把 ② 建好的全部可选依赖开起来，configure 一次
#
# 策略（外部校对定的）：**主树不要逐库重配**——因为本项目历史上的失败都是
# **组合型**的（某个库单独能编、终链却因 Fortran COMMON 块重复定义失败；
# 某个 .oct 单独能编、一装载却因符号签名不匹配整页崩），逐库单开根本测不出来。
# 主树一次全开；万一失败，**按库集合二分**，而不是逐库重编。
#   → 所以本脚本把依赖写成**一张表**，二分时只需往 SKIP 里加名字：
#        SKIP="hdf5 suitesparse" bash configure-113-full.sh
#
# 与 configure-113.sh（P0 的最小集）的区别：把那一长串 --without-<lib>
# 换成对已建库的 --with-<lib>-includedir/-libdir，并补上 --without-opengl
# （11.3 的 LIBOCTINTERP_LINK_DEPS 里有 -lGL -lGLU，会产生 GLU 未定义符号；
#  我们并不想要 GL，7.2 的配方里就有 --without-opengl，之前我漏了）。
#
# 仍然关着（没有建/不需要）：curl、magick、portaudio、spqr（R7 已论证非缺口）、
#   sundials_*（走 .oct 车道，不链进树）、freetype/fontconfig/fltk/qt（图形，P5 再说）。
#
set -euo pipefail

SRCDIR="${1:-/src/work/octave-11.3.0}"
PREFIX="${2:-/src/work/octave-install}"
DEPS=/usr/local            # 早期建的四个：libf2c/refblas/lapack/pcre2-8
D="${D:-/src/deps}"        # ② 建的库，每库独立 prefix
SKIP="${SKIP:-}"           # 空格分隔的库名，用于二分

[ -d "$SRCDIR" ] || { echo "FATAL: 找不到 $SRCDIR" >&2; exit 2; }
command -v emf77 >/dev/null || { echo "FATAL: PATH 里没有 emf77" >&2; exit 2; }

skipped () { case " $SKIP " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

INCS=(); LIBS=(); FLAGS=()

# ---- 依赖表：库名 | prefix | Octave 的 --with 名（留空=只进搜索路径，无选项）----
#   Octave 的选项名与库名不一定同（qhull 的选项叫 qhull_r；SuiteSparse 每个子库各有选项）
TABLE='
glpk|glpk|glpk
qhull|qhull|qhull_r
fftw|fftw|fftw3
fftw|fftw|fftw3f
sndfile|sndfile|sndfile
qrupdate|qrupdate|qrupdate
hdf5|hdf5|hdf5
zlibbz2|zlibbz2|z
zlibbz2|zlibbz2|bz2
arpack|arpack|arpack
suitesparse|suitesparse|suitesparseconfig
suitesparse|suitesparse|amd
suitesparse|suitesparse|camd
suitesparse|suitesparse|colamd
suitesparse|suitesparse|ccolamd
suitesparse|suitesparse|cholmod
suitesparse|suitesparse|umfpack
suitesparse|suitesparse|klu
suitesparse|suitesparse|cxsparse
rapidjson|rapidjson|
'

echo "=== 依赖表（SKIP=\"$SKIP\"）"
while IFS='|' read -r name pf opt; do
  [ -n "$name" ] || continue
  # SKIP 既可写 prefix 名（跳过该 prefix 下所有选项），也可写选项名
  # （如 SKIP=umfpack 只关 UMFPACK，但保留 SuiteSparse 其余部分）——
  # 按库集合二分 / 精确关单个库都靠它。
  if skipped "$name" || { [ -n "$opt" ] && skipped "$opt"; }; then
    # ⚠️ 仅仅"不传 --with-<opt>-*"是**不够**的：库的 prefix 已经在
    #   CPPFLAGS/LDFLAGS 的搜索路径里，configure 自己就会找到它
    #   （实测：不传 --with-umfpack-* 时 HAVE_UMFPACK 仍是 1）。
    #   必须**显式 --without-<opt>** 才能真正关掉。
    [ -n "$opt" ] && FLAGS+=("--without-$opt")
    echo "   [跳过] $name${opt:+ / $opt}（显式 --without-$opt）"; continue
  fi
  p="$D/$pf"
  [ -d "$p" ] || { echo "FATAL: 库 $name 的 prefix 不存在：$p" >&2; exit 2; }
  [ -d "$p/include" ] && INCS+=("-I$p/include")
  [ -d "$p/lib" ] && LIBS+=("-L$p/lib")
  if [ -n "$opt" ]; then
    [ -d "$p/include" ] && FLAGS+=("--with-$opt-includedir=$p/include")
    [ -d "$p/lib" ]     && FLAGS+=("--with-$opt-libdir=$p/lib")
  fi
done <<< "$TABLE"

export F77=emf77 FC=emf77 F90=emf77
export FLIBS="-L$DEPS/lib -lf2c"
export BLAS_LIBS="-lrefblas -lf2c"
export LAPACK_LIBS="-llapack -lrefblas -lf2c"

# ⚠️ 关键：SuiteSparse 的库是用 64 位 SuiteSparse_long 编的（见 build/113/ss-long64.h），
#   **Octave 自己也必须用同一个口径**，否则 ABI 边界两边不一致 ——
#   这正是稀疏 lu 走 UMFPACK 时整页 trap 的根因。
#   只给 SuiteSparse 加是不够的（实测：那样 Octave 的两条
#   "SuiteSparse_long and octave_idx_type have same size" 检测仍为假，lu 照样 trap）。
#   加进 CPPFLAGS 后两边一致，那两条检测也会变真。
export CPPFLAGS="-I$DEPS/include ${INCS[*]}"
# `-Wl,--allow-multiple-definition` 必须**也在 configure 期**：
#   ARPACK 的 f2c 产物里每个文件都带一份 COMMON 块定义（debug_/timing_），
#   而 configure 的「dseupd in -larpack」测试链接**不带**我们终链的那个标志 →
#   wasm-ld: duplicate symbol: debug_ → 测试判 no → eigs 被关掉。
#   （这正是 7.2 记的那个 COMMON 块问题；7.2 靠"全源 cat 成单 TU"绕，
#     我们现在靠这个链接标志，更简单。）
#   它是纯链接标志、没有 `-s NAME=value` 那种空格，不会像
#   ERROR_ON_UNDEFINED_SYMBOLS 那样把 configure 弄坏（那一条实测踩过）。
export LDFLAGS="-L$DEPS/lib ${LIBS[*]} -fPIC -fwasm-exceptions -Wl,--allow-multiple-definition"
# 异常模式必须 -fwasm-exceptions（原生 wasm 异常）：JS 式异常会引入
# invoke_*/__cxa_* 这些只在 JS 胶水里的符号，.oct side module 解析不到（已实测）
export CFLAGS="-O2 -fwasm-exceptions -fPIC"
export CXXFLAGS="-O2 -fwasm-exceptions -fPIC"

export PKG_CONFIG_PATH="$DEPS/lib/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
export PKG_CONFIG=/usr/bin/pkg-config

export CCACHE_DIR="${CCACHE_DIR:-/ccache}"
export CCACHE_MAXSIZE="${CCACHE_MAXSIZE:-20G}"

# configure 期「需要真跑一下」的探测：wasm 下必然假失败，预置
export gl_cv_func_nanosleep=yes gl_cv_func_usleep_works=yes gl_cv_func_svid_putenv=yes
export ac_octave_suitesparseconfig_pkg_check=no
export ac_octave_spqr_check_for_lib=no
# ARPACK 的 C++ 运行测试在容器里会假失败（7.2 记过），预置
export octave_cv_lib_arpack_ok_1=yes

cd "$SRCDIR"
rm -f config.cache
echo "=== configure 前置处理"
grep -q -- '-fexceptions' configure && sed -i 's/-fexceptions/-fwasm-exceptions/g' configure || true
grep -qE "^postdeps_CXX='.+'$" configure && sed -i "s/^postdeps_CXX=.*/postdeps_CXX=''/" configure || true
# emscripten 下跳过 AX_PTHREAD（保留 pthread.h 检测）—— 闸门③ 的关键
bash /src/bin/patch-ax-pthread.sh "$SRCDIR"

# P5 步骤②：要不要开 OpenGL？
#   默认仍然 `--without-opengl`（与之前逐字节一致）。
#   `WITH_OPENGL=1` 时**不开** --without-opengl，并把 /src/deps/glshim 摆到搜索路径上
#   —— 那个前缀里 libGL.a 就是 **libOSMesa.a**、libGLU.a 是给 wasm 编的 libGLU，
#   头文件用 Mesa 的（legacy API 声明齐全）。也就是"把 OSMesa 冒充成 GL"，
#   好让 Octave 的 gl-render.cc 编出来、并链到软件光栅化那条路。
OPENGL_FLAG="${OPENGL_FLAG:---without-opengl}"
if [ "${WITH_OPENGL:-0}" = "1" ]; then
  OPENGL_FLAG=""
  CPPFLAGS="${CPPFLAGS:-} -I/src/deps/glshim/include"
  LDFLAGS="${LDFLAGS:-} -L/src/deps/glshim/lib"
  echo "=== WITH_OPENGL=1：开 OpenGL，GL 由 OSMesa 冒充（glshim）==="
fi

echo "=== configure（全开）"
emconfigure ./configure \
  --host=wasm32-unknown-emscripten \
  --prefix="$PREFIX" \
  --enable-fortran-calling-convention=f2c \
  --with-pcre2=-lpcre2-8 \
  --with-blas=-lrefblas --with-lapack=-llapack \
  --disable-shared --enable-static \
  --disable-readline --disable-docs --disable-java \
  --disable-threads \
  --without-qt --without-fltk ${OPENGL_FLAG} \
  --without-freetype --without-fontconfig \
  --without-curl --without-magick --without-portaudio \
  --without-spqr \
  --without-sundials_core --without-sundials_ida \
  --without-sundials_nvecserial --without-sundials_sunlinsolklu \
  "${FLAGS[@]}" \
  CC="ccache emcc" CXX="ccache em++" \
  || { echo "=== configure 失败，config.log 尾部 ==="; tail -n 100 config.log; exit 1; }

echo "=== configure 成功"
# 汇报实际开起来了什么（这是 ③ 的可读证据）
for h in HAVE_GLPK HAVE_QHULL_R HAVE_FFTW3 HAVE_FFTW3F HAVE_SNDFILE HAVE_HDF5 \
         HAVE_ZLIB HAVE_BZ2 HAVE_ARPACK HAVE_AMD HAVE_CHOLMOD HAVE_UMFPACK \
         HAVE_KLU HAVE_CXSPARSE HAVE_QRUPDATE HAVE_RAPIDJSON; do
  # 注意 `|| true`：grep 无匹配会返回 1，而 `var=$(cmd)` 的退出码会被 set -e 捕获
  # → 整个脚本会在汇报到第一个"未定义"的库时就死掉（这个 bug 踩过一次）
  v=$(grep -E "^#define $h " config.h 2>/dev/null | awk '{print $3}' || true)
  printf "   %-16s %s\n" "$h" "${v:-（未定义）}"
done
_cfg=$(grep -m1 "^CC = " Makefile 2>/dev/null || true)
case "$_cfg" in *ccache*) echo "  ✅ ccache 已进 Makefile：$_cfg" ;;
  *) echo "  ⚠️  Makefile 里没看到 ccache：$_cfg" >&2 ;; esac
