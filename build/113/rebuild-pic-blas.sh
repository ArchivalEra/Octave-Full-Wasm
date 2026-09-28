#!/usr/bin/env bash
#
# 重编 Fortran 侧三个库（**带 -fPIC**）：libf2c + BLAS + LAPACK
# 输出到独立 prefix —— 给 side module（`.oct`）用
#
# ── 为什么需要它 ────────────────────────────────────────────────────────────
# `build-deps.sh` 建的 `liblapack.a` / `librefblas.a` 是**非 PIC** 的（`emf77 -O2 -c`）。
# 主模块（`MAIN_MODULE=1`）不在乎，但 **side module 必须是 PIC**，否则链接期直接报：
#
#     wasm-ld: error: /usr/local/lib/liblapack.a(dlacn2.o): relocation
#     R_WASM_MEMORY_ADDR_SLEB cannot be used against symbol `c_b11`; recompile with -fPIC
#
# 2026-09-23 修 control 包的 SLICOT 编译件时撞上这条：SLICOT 的 48 个包装器要调
# LAPACK/BLAS，而主模块**没有把这些符号导出去**（实测 50533 个函数只导出 44738 个，
# `dgemm_`/`dgetrf_`/`dggev_` 都不在其中）⇒ `.oct` 的调用落到 emscripten 的 stub 上，
# 报 `TypeError: resolved is not a function`。
# 与其重链主 wasm 去加导出，不如**让 `.oct` 自包含**（与 `__ode15__` 内嵌 SUNDIALS 同型），
# 主 wasm 一个字节都不用动 —— 这正是本项目的既定架构。
#
# ⚠️ **绝不覆盖 `/usr/local/lib/liblapack.a`**：主链还在用它（`-L/usr/local/lib -llapack`），
#    就地重编会让已部署的 wasm 与源不一致。所以本脚本输出到**独立 prefix**。
#
# 用法（容器内）：bash rebuild-pic-blas.sh [输出 prefix]      # 默认 /src/deps/lapack-pic
# 产物：<prefix>/lib/{libf2c.a,librefblas.a,liblapack.a}
set -euo pipefail

PREFIX="${PREFIX:-/src/deps/lapack-pic}"
SRC="${SRC:-/src/third_party/lapack-3.4.2}"
[ -d "$SRC" ] || SRC=/src/work/lapack-3.4.2
F2CSRC="${F2CSRC:-/src/third_party/libf2c2-20130926}"
[ -d "$F2CSRC" ] || F2CSRC=/src/work/libf2c2
WORK="${WORK:-/src/work}"
JOBS="${JOBS:-$(nproc)}"
export EMF77_EMCC="${EMF77_EMCC:-ccache emcc}"
export F2C_PREFIX="${F2C_PREFIX:-/usr/local}"

command -v emf77 >/dev/null 2>&1 || { echo "FATAL: PATH 里没有 emf77" >&2; exit 2; }
[ -d "$SRC" ] || { echo "FATAL: 找不到 lapack 源码树 $SRC" >&2; exit 2; }

mkdir -p "$PREFIX/lib"

# ── libf2c：f2c 翻译出来的 C 要调它 ────────────────────────────────────────
# 为什么也要 PIC：`.oct` 里的 f2c 产物会调 `pow_di`/`s_cmp`/`do_fio` 这些运行时函数，
# 而主模块**没有把它们导出去**（实测：导出的只有 xerbla_/xstopx_/second_ 三个）。
# 实测踩过：漏了这一步时 `norm()` 报
#   `MISSING-OCT-SYMBOL: pow_di` → `TypeError: resolved is not a function`。
build_libf2c () {
  echo "=== libf2c（来自 $F2CSRC）"
  local d="$WORK/libf2c2-pic"
  rm -rf "$d"; mkdir -p "$d"
  tar -C "$F2CSRC" -cf - . | tar -C "$d" -xf -
  cd "$d"
  cp f2c.h0 f2c.h; cp signal1.h0 signal1.h; cp sysdep1.h0 sysdep1.h
  # ⚠️ 只改 1-30 行的 integer 和 logical，不改 59 行的 ftnlen（Octave f77-fcn.h 硬要求 F77_CHAR_ARG_LEN_TYPE long）
  sed -i '1,30s/defined(__ia64__)/defined(__ia64__) || defined(__wasm64__) || defined(__LP64__)/g' f2c.h
  # arithchk 用**宿主** cc 跑（只探测本机浮点格式，不产 wasm 码）
  cc -O2 -DNO_FPINIT arithchk.c -lm -o arithchk
  ./arithchk > arith.h
  [ -s arith.h ] || { echo "FATAL: arithchk 没产出 arith.h" >&2; exit 1; }
  local -a objs=(); local c
  for c in *.c; do
    case "$c" in
      # main.c/arithchk.c 不是库的一部分；
      # pow_qq/qbitbits/qbitshft/ftell64_ 是 INTEGER_STAR_8（8 字节整数）那组，
      # 我们用的是默认 4 字节 Fortran INTEGER，编进来会 ABI 不一致（与 build-deps.sh 同）。
      main.c|arithchk.c|pow_qq.c|qbitbits.c|qbitshft.c|ftell64_.c) continue ;;
    esac
    $EMF77_EMCC -O2 -fPIC -Wno-implicit-function-declaration -Wno-implicit-int \
        -DNON_UNIX_STDIO -I. -c "$c" -o "${c%.c}.pic.o"
    objs+=("${c%.c}.pic.o")
  done
  emar rcs "$PREFIX/lib/libf2c.a" "${objs[@]}"
  local s; s="$(emnm "$PREFIX/lib/libf2c.a")"
  for sym in s_cat s_copy pow_dd pow_di do_fio d_lg10; do
    grep -q " $sym\$" <<<"$s" || { echo "FATAL: libf2c.a 缺 $sym" >&2; exit 1; }
  done
  echo "  ✅ $PREFIX/lib/libf2c.a（$(grep -c . <<<"$s") 个符号）"
}

build_libf2c

d="$WORK/lapack-pic"
echo "=== 从 $SRC 取一份干净副本到 $d（排除上一轮的 .o/.c）"
rm -rf "$d"; mkdir -p "$d"
tar -C "$SRC" --exclude='*.o' -cf - . | tar -C "$d" -xf -

# xerbla.f 等**故意跳过**：Octave 的 liboctave/external/blas-xtra/xerbla.cc 提供 xerbla_，
# 两边都编会重复定义（与 build-deps.sh 同一张清单）。
SKIP="xerbla.f xerbla_array.f cpstf2.f cpstrf.f dpstf2.f dpstrf.f spstf2.f spstrf.f zpstf2.f zpstrf.f"

build_dir () {
  local srcdir="$1" outlib="$2" maxfail="$3"
  local -a files=() keep=() f b
  while IFS= read -r f; do
    b="$(basename "$f")"
    case " $SKIP " in *" $b "*) continue ;; esac
    files+=("$f")
  done < <(find "$srcdir" -maxdepth 1 -name '*.f' | sort)
  echo "=== 翻译 $srcdir：${#files[@]} 个 .f（并行 $JOBS，带 -fPIC）"
  printf '%s\0' "${files[@]}" \
    | xargs -0 -P "$JOBS" -I{} sh -c '
        f="$1"; o="${f%.f}.pic.o"
        if ! emf77 -O2 -fPIC -c "$f" -o "$o" >/dev/null 2>&1; then echo "$f"; fi
      ' _ {} > "$WORK/pic-failed-$(basename "$outlib").txt" || true
  local failed; failed="$(wc -l < "$WORK/pic-failed-$(basename "$outlib").txt")"
  [ "$failed" -le "$maxfail" ] || {
    echo "FATAL: $srcdir 有 $failed 个文件被拒编（上限 $maxfail）" >&2
    head -10 "$WORK/pic-failed-$(basename "$outlib").txt" >&2; exit 1; }
  [ "$failed" -gt 0 ] && echo "  ⚠️  $failed 个被拒编（在上限内），清单见 $WORK/pic-failed-$(basename "$outlib").txt"
  find "$srcdir" -maxdepth 1 -name '*.pic.o' -print0 | xargs -0 emar rcs "$outlib"
  echo "  ✅ $outlib（$(du -h "$outlib" | cut -f1)）"
}

build_dir "$d/BLAS/SRC" "$PREFIX/lib/librefblas.a" 10
build_dir "$d/SRC"      "$PREFIX/lib/liblapack.a"  30

# dlamch/slamch 是机器常数，LAPACK 的 SRC 不含它们（在 INSTALL/ 下）
echo "=== dlamch/slamch"
for f in dlamch slamch; do
  emf77 -O2 -fPIC -c "$d/INSTALL/$f.f" -o "$d/INSTALL/$f.pic.o"
done
emar rcs "$PREFIX/lib/liblapack.a" "$d/INSTALL/dlamch.pic.o" "$d/INSTALL/slamch.pic.o"

echo "=== 符号自检"
b="$(emnm "$PREFIX/lib/librefblas.a")"; l="$(emnm "$PREFIX/lib/liblapack.a")"
grep -q ' dgemm_$' <<<"$b" || { echo "FATAL: librefblas.a 缺 dgemm_" >&2; exit 1; }
for s in dgesv_ dlamch_ dgetrf_ dggev_; do
  grep -q " $s\$" <<<"$l" || { echo "FATAL: liblapack.a 缺 $s" >&2; exit 1; }
done
echo "  ✅ dgemm_ / dgesv_ / dlamch_ / dgetrf_ / dggev_ 都在"
echo "  产物：$PREFIX/lib/{libf2c.a,librefblas.a,liblapack.a}"
echo "  （本次刻意**没有**动 /usr/local —— 主链仍用那份非 PIC 的）"
