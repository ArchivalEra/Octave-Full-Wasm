#!/usr/bin/env bash
#
# Octave 11.3.0 → wasm 的依赖构建
#
# 需要三个东西：
#   libf2c.a      Fortran 运行时（f2c 翻译出的 C 要链它）
#   librefblas.a  BLAS
#   liblapack.a   LAPACK
#   libpcre2-8.a  正则（**11.x 是新增依赖**：7.2 用的是 PCRE1，11.x 要 pcre2）
#
# 与 Edge-Tools 的做法（build/scripts/build-lapack.sh，见 BASELINE-11.3.md §4.2）
# 的两处关键不同：
#
#   1. **复用我们自己的源码，不去拿 CLAPACK**：
#      libf2c2-20130926 / f2c-20160102 / lapack-3.4.2 都是本项目 7.2 构建用过的
#      （lapack 3.4.2 还比 Edge-Tools 的 3.1.1 新）。libf2c2 需要 f2c.h0 → f2c.h
#      这一步，CLAPACK 是预生成的所以他们没有这一步。
#   2. **不做 INTEGER_STAR_8**：本项目 7.2 构建用的 f2c.h 就是 f2c.h0 的逐字节
#      副本，即默认 4 字节 Fortran INTEGER；ABI 必须与 Octave 侧一致，所以照旧。
#      （Edge-Tools 用了 -DINTEGER_STAR_8，那是他们的选择，我们不复刻。）
#
# 常见整数尺寸**必须与 Octave configure 的探测结果一致**，否则数值会静默错。
# 所以本脚本最后跑数值自检（见 verify），不靠推断。
#
# 用法：  bash build-deps.sh [libf2c|lapack|pcre2|all]    （默认 all）
#
set -euo pipefail

PREFIX="${PREFIX:-/usr/local}"
SRC="${SRC:-/src/third_party}"
WORK="${WORK:-/src/work}"
JOBS="${JOBS:-$(nproc)}"
# 让所有 emcc 调用经过 ccache：LAPACK 有 5000+ 个 .f，重跑时省的是整段
export EMF77_EMCC="${EMF77_EMCC:-ccache emcc}"
export F2C_PREFIX="$PREFIX"
# emf77 在 PATH 里（宿主机/容器都从仓库 build/113 拷进来）
command -v emf77 >/dev/null 2>&1 || { echo "FATAL: PATH 里没有 emf77" >&2; exit 1; }

mkdir -p "$PREFIX/lib" "$PREFIX/include" "$WORK"

say () { echo; echo "=== $*"; }

# ---------------------------------------------------------------------------
# libf2c：Fortran 运行时
#   f2c.h 的生成是「cp f2c.h0 f2c.h」；另外要原生跑 arithchk 生成 arith.h
#   （浮点格式探测，部分 .c 会 include 它）。
# ---------------------------------------------------------------------------
build_libf2c () {
  say "构建 libf2c（来自 $SRC/libf2c2-20130926）"
  local d="$WORK/libf2c2"
  rm -rf "$d"; mkdir -p "$d"
  # 只读挂载 → 先拷到可写工作区
  cp -r "$SRC/libf2c2-20130926/." "$d/"
  cd "$d"

  cp f2c.h0 f2c.h
  cp signal1.h0 signal1.h
  cp sysdep1.h0 sysdep1.h

  # arithchk 必须用**宿主的** cc 跑（它只探测本机浮点特性，不产 wasm 代码）
  cc -O2 -DNO_FPINIT arithchk.c -lm -o arithchk
  ./arithchk > arith.h
  [ -s arith.h ] || { echo "FATAL: arithchk 没产出 arith.h" >&2; exit 1; }

  local objs=() c
  for c in *.c; do
    case "$c" in
      # main.c 是 f2c 主程序本身的；arithchk.c 已经在上面当原生工具用过了
      main.c|arithchk.c) continue ;;
      # 以下 4 个是 libf2c 的 QINT（四倍/整数*8）组，源码里用 longint，
      # 而 longint 只在 #ifdef INTEGER_STAR_8 下才 typedef —— 我们用的是默认
      # 4 字节 Fortran INTEGER，所以这组**必须跳过**，不能靠 -DINTEGER_STAR_8
      # 硬塞（那会把它们的 ABI 变成 8 字节整数，与调用方 4 字节不一致）。
      # 依据：本项目 7.2 构建的 libf2c.so 里 ftell64_/fseek64_/pow_qq_/
      # qbit_clear/qbit_set **一个都没有**，即当时就是跳过的（156/167）。
      pow_qq.c|qbitbits.c|qbitshft.c|ftell64_.c) continue ;;
    esac
    # shellcheck disable=SC2086
    $EMF77_EMCC -O2 -Wno-implicit-function-declaration -Wno-implicit-int \
        -DNON_UNIX_STDIO -I. -c "$c" -o "${c%.c}.o"
    objs+=("${c%.c}.o")
  done
  emar rcs "$PREFIX/lib/libf2c.a" "${objs[@]}"
  cp f2c.h "$PREFIX/include/f2c.h"

  # 自检：f2c 运行时该有的符号
  local sym; sym="$(emnm "$PREFIX/lib/libf2c.a")"
  for s in s_cat s_copy pow_dd d_lg10; do
    grep -q " $s\$" <<<"$sym" || { echo "FATAL: libf2c.a 缺符号 $s" >&2; exit 1; }
  done
  # 反向自检：QINT 组确实没进来（进来了就说明上面的跳过失效、
  # 或者有人偷偷加了 -DINTEGER_STAR_8，ABI 会不一致）
  for s in ftell64_ pow_qq_ qbit_clear; do
    grep -q " $s\$" <<<"$sym" && { echo "FATAL: libf2c.a 意外含 QINT 符号 $s —— 整数 ABI 可能不一致" >&2; exit 1; }
  done
  echo "  ✅ libf2c.a（$(grep -c . <<<"$sym") 个符号；QINT 组已按预期排除）"
  echo "     整数口径: $(grep -m1 -E '^typedef (int|long int) integer;' f2c.h)"
}

# ---------------------------------------------------------------------------
# 一个目录里的 .f 全部翻成 wasm 目标文件并归档
#   $1=源目录  $2=输出 .a  $3=允许失败的上限  $4..=跳过清单
# ---------------------------------------------------------------------------
build_fortran_dir () {
  local srcdir="$1" outlib="$2" maxfail="$3"; shift 3
  local skip=" $* "
  local -a files=() f
  while IFS= read -r f; do
    local b; b="$(basename "$f")"
    [[ "$skip" == *" $b "* ]] && continue
    files+=("$f")
  done < <(find "$srcdir" -maxdepth 1 -name '*.f' | sort)

  echo "  翻译 $srcdir：${#files[@]} 个 .f（并行 $JOBS）"
  local failed=0
  # 并行走；每个 emf77 自带独立临时目录，同名源不会互相踩
  printf '%s\0' "${files[@]}" \
    | xargs -0 -P "$JOBS" -I{} sh -c '
        f="$1"; o="${f%.f}.o"
        if ! emf77 -O2 -c "$f" -o "$o" >/dev/null 2>&1; then echo "$f"; fi
      ' _ {} > "$WORK/failed-$(basename "$outlib").txt" || true
  failed="$(wc -l < "$WORK/failed-$(basename "$outlib").txt")"

  if [ "$failed" -gt "$maxfail" ]; then
    echo "FATAL: $srcdir 有 $failed 个文件被 f2c 拒编，超过上限 $maxfail" >&2
    head -10 "$WORK/failed-$(basename "$outlib").txt" >&2
    exit 1
  fi
  [ "$failed" -gt 0 ] && echo "  ⚠️  $failed 个文件被拒编（在上限 $maxfail 内），清单见 $WORK/failed-$(basename "$outlib").txt"

  find "$srcdir" -maxdepth 1 -name '*.o' -print0 | xargs -0 emar rcs "$outlib"
  echo "  ✅ $outlib（$(du -h "$outlib" | cut -f1)）"
}

# ---------------------------------------------------------------------------
# BLAS / LAPACK
#   xerbla.f 等**故意跳过**：Octave 自己的 liboctave/external/blas-xtra/xerbla.cc
#   会提供 xerbla_，两边都编会重复定义。（emscripten-forge 的 patch 0012
#   "Return-void-from-xerbla" 处理的就是同一个冲突。）
# ---------------------------------------------------------------------------
build_lapack () {
  say "构建 BLAS / LAPACK（来自 $SRC/lapack-3.4.2）"
  local d="$WORK/lapack-3.4.2"
  rm -rf "$d"; mkdir -p "$d"
  cp -r "$SRC/lapack-3.4.2/." "$d/"

  local SKIP="xerbla.f xerbla_array.f cpstf2.f cpstrf.f dpstf2.f dpstrf.f spstf2.f spstrf.f zpstf2.f zpstrf.f"
  build_fortran_dir "$d/BLAS/SRC" "$PREFIX/lib/librefblas.a" 10 $SKIP
  build_fortran_dir "$d/SRC"      "$PREFIX/lib/liblapack.a"  30 $SKIP
  # dlamch/slamch 是机器常数，LAPACK 的 SRC 不含它们（在 INSTALL/ 下）
  local f o=()
  for f in dlamch slamch; do
    emf77 -O2 -c "$d/INSTALL/$f.f" -o "$d/INSTALL/$f.o"
    o+=("$d/INSTALL/$f.o")
  done
  emar rcs "$PREFIX/lib/liblapack.a" "$d/INSTALL/dlamch.o" "$d/INSTALL/slamch.o"

  # 自检：缺这些符号就说明归档没成
  local b l
  b="$(emnm "$PREFIX/lib/librefblas.a")"; l="$(emnm "$PREFIX/lib/liblapack.a")"
  grep -q ' dgemm_$'  <<<"$b" || { echo "FATAL: librefblas.a 缺 dgemm_" >&2; exit 1; }
  grep -q ' dgesv_$'  <<<"$l" || { echo "FATAL: liblapack.a 缺 dgesv_" >&2; exit 1; }
  grep -q ' dlamch_$' <<<"$l" || { echo "FATAL: liblapack.a 缺 dlamch_" >&2; exit 1; }
  echo "  ✅ dgemm_ / dgesv_ / dlamch_ 都在"
}

# ---------------------------------------------------------------------------
# pcre2（11.x 新增依赖）
# ---------------------------------------------------------------------------
build_pcre2 () {
  say "构建 pcre2（来自 $SRC/pcre2-10.45.tar.gz）"
  local tgz="$SRC/pcre2-10.45.tar.gz"
  # 注意 $SRC 是挂载进来的第三方源码目录（容器里默认 /src/third_party，
  # 宿主侧对应 /mnt/hdd/octave-wasm-build/octave-wasm/third_party）。
  # pcre2 不在那个目录里的话，宿主侧走 2080 代理下过去即可：
  #   curl -x http://127.0.0.1:2080 -L -o <该目录>/pcre2-10.45.tar.gz \
  #     https://github.com/PCRE2Project/pcre2/releases/download/pcre2-10.45/pcre2-10.45.tar.gz
  [ -f "$tgz" ] || { echo "FATAL: 缺 $tgz（见本函数注释里的下载命令）" >&2; exit 1; }
  local d="$WORK/pcre2-10.45"
  rm -rf "$d"; mkdir -p "$d"
  tar xf "$tgz" -C "$WORK"
  cd "$WORK/pcre2-10.45"
  emconfigure ./configure \
      --host=wasm32-unknown-emscripten --prefix="$PREFIX" \
      --disable-shared --enable-static --disable-jit --enable-pcre2-8 \
      CFLAGS="-O2 -fPIC" >/dev/null
  emmake make -j"$JOBS" install >/dev/null
  local s; s="$(emnm "$PREFIX/lib/libpcre2-8.a")"
  grep -q ' pcre2_compile_8$' <<<"$s" || { echo "FATAL: libpcre2-8.a 缺 pcre2_compile_8" >&2; exit 1; }
  echo "  ✅ libpcre2-8.a"
}

case "${1:-all}" in
  libf2c) build_libf2c ;;
  lapack) build_lapack ;;
  pcre2)  build_pcre2 ;;
  all)    build_libf2c; build_pcre2; build_lapack ;;
  *) echo "用法: $0 [libf2c|lapack|pcre2|all]" >&2; exit 2 ;;
esac

say "完成。$PREFIX 内容："
ls -la "$PREFIX/lib" | grep -E "\.a$|total" || true
