#!/usr/bin/env bash
#
# 重编 BLAS + LAPACK（**带 -msimd128**）：给 E1 基准用的 SIMD 版三个库
# Output 到独立 prefix —— 与主链的 /usr/local 那份**并存**，绝不覆盖。
#
# ── 为什么需要它（第四轮评审 C4 / PLAN-threads B3）──────────────────────────
# 现役 BLAS 是 `emf77 -O2 -c` 出来的**纯标量** reference 实现（f2c 翻译的 C）。
# `-msimd128` 是**每个 TU 各自的 codegen**，链接期不需要全模块一致
#（`wasm-ld` 默认从输入对象推断特性），所以"只给 BLAS 对象加 SIMD"是安全且最小的实验。
#
# ⚠️ **绝不覆盖 /usr/local/lib/liblapack.a**：主链（link-web.sh）还在用它。
#    与 rebuild-pic-blas.sh 同一条纪律（那份是给 .oct 的 PIC 版，本份是给主链的 SIMD 版）。
#
# 用法（容器内）：bash build-blas-simd.sh [输出 prefix]   # 默认 /src/deps/lapack-simd
# 产物：<prefix>/lib/{librefblas.a,liblapack.a}
set -euo pipefail

PREFIX="${PREFIX:-/src/deps/lapack-simd}"
SRC="${SRC:-/src/third_party/lapack-3.4.2}"
[ -d "$SRC" ] || SRC=/src/work/lapack-3.4.2
WORK="${WORK:-/src/work}"
JOBS="${JOBS:-$(nproc)}"
SIMD_FLAG="${SIMD_FLAG:--msimd128}"
export EMF77_EMCC="${EMF77_EMCC:-ccache emcc}"

command -v emf77 >/dev/null 2>&1 || { echo "FATAL: PATH 里没有 emf77" >&2; exit 2; }
[ -d "$SRC" ] || { echo "FATAL: 找不到 lapack 源码树 $SRC" >&2; exit 2; }

OBJDUMP="$(command -v llvm-objdump || true)"
[ -n "$OBJDUMP" ] || OBJDUMP=/emsdk/upstream/bin/llvm-objdump

mkdir -p "$PREFIX/lib"
d="$WORK/lapack-simd"
echo "=== 从 $SRC 取干净副本到 $d（排除上一轮 .o/.c）"
rm -rf "$d"; mkdir -p "$d"
tar -C "$SRC" --exclude='*.o' -cf - . | tar -C "$d" -xf -

# 与 build-deps.sh / rebuild-pic-blas.sh 同一张跳过清单（xerbla 由 Octave 提供，重复定义）
SKIP="xerbla.f xerbla_array.f cpstf2.f cpstrf.f dpstf2.f dpstrf.f spstf2.f spstrf.f zpstf2.f zpstrf.f"

build_dir () {
  local srcdir="$1" outlib="$2" maxfail="$3"
  local -a files=() keep=() f b
  while IFS= read -r f; do
    b="$(basename "$f")"
    case " $SKIP " in *" $b "*) continue ;; esac
    files+=("$f")
  done < <(find "$srcdir" -maxdepth 1 -name '*.f' | sort)
  echo "=== 翻译 $srcdir：${#files[@]} 个 .f（并行 $JOBS，带 $SIMD_FLAG）"
  printf '%s\0' "${files[@]}" \
    | xargs -0 -P "$JOBS" -I{} sh -c '
        f="$1"; shift; o="${f%.f}.simd.o"
        if ! emf77 -O2 "$@" -c "$f" -o "$o" >/dev/null 2>&1; then echo "$f"; fi
      ' _ {} $SIMD_FLAG > "$WORK/simd-failed-$(basename "$outlib").txt" || true
  local failed; failed="$(wc -l < "$WORK/simd-failed-$(basename "$outlib").txt")"
  [ "$failed" -le "$maxfail" ] || {
    echo "FATAL: $srcdir 有 $failed 个文件被拒编（上限 $maxfail）" >&2
    head -10 "$WORK/simd-failed-$(basename "$outlib").txt" >&2; exit 1; }
  [ "$failed" -gt 0 ] && echo "  ⚠️  $failed 个被拒编（在上限内），清单见 $WORK/simd-failed-$(basename "$outlib").txt" || true
  find "$srcdir" -maxdepth 1 -name '*.simd.o' -print0 | xargs -0 emar rcs "$outlib"
  echo "  ✅ $outlib（$(du -h "$outlib" | cut -f1)）"
}

build_dir "$d/BLAS/SRC" "$PREFIX/lib/librefblas.a" 10
build_dir "$d/SRC"      "$PREFIX/lib/liblapack.a"  30

# dlamch/slamch 是机器常数，LAPACK 的 SRC 不含它们（在 INSTALL/ 下）
echo "=== dlamch/slamch"
for f in dlamch slamch; do
  emf77 -O2 $SIMD_FLAG -c "$d/INSTALL/$f.f" -o "$d/INSTALL/$f.simd.o"
done
emar rcs "$PREFIX/lib/liblapack.a" "$d/INSTALL/dlamch.simd.o" "$d/INSTALL/slamch.simd.o"

echo "=== 符号自检"
b="$(emnm "$PREFIX/lib/librefblas.a")"; l="$(emnm "$PREFIX/lib/liblapack.a")"
grep -q ' dgemm_$' <<<"$b" || { echo "FATAL: librefblas.a 缺 dgemm_" >&2; exit 1; }
for s in dgesv_ dlamch_ dgetrf_ dggev_; do
  grep -q " $s\$" <<<"$l" || { echo "FATAL: liblapack.a 缺 $s" >&2; exit 1; }
done
echo "  ✅ dgemm_ / dgesv_ / dlamch_ / dgetrf_ / dggev_ 都在"

echo "=== ★ v128 自检（SIMD 到底进没进对象）"
total=0
for o in "$d/BLAS/SRC/dgemm.simd.o" "$d/BLAS/SRC/daxpy.simd.o" "$d/BLAS/SRC/dscal.simd.o" "$d/SRC/dgetrf.simd.o"; do
  n="$("$OBJDUMP" -d "$o" 2>/dev/null | grep -c 'v128' || true)"
  printf '   %-42s v128 指令 %s 条\n' "$(basename "$o")" "$n"
  total=$((total + n))
done
echo "   —— 抽样合计 $total 条 v128"
[ "$total" -gt 0 ] && echo "   ✅ SIMD 确实进了对象" || echo "   ⚠️ 抽样里一条 v128 都没有 ⇒ E2（OpenBLAS）的触发条件成立"
echo "  产物：$PREFIX/lib/{librefblas.a,liblapack.a}"
echo "  （本次刻意**没有**动 /usr/local —— 主链仍用那份非 SIMD 的）"
