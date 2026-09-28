#!/usr/bin/env bash
#
# SUNDIALS 6.1.1 → wasm 静态库（只 IDA + 稠密线性求解器），给 __ode15__.oct 用
#
# ── 为什么主树不用动（这是本脚本存在的全部理由）────────────────────────────
# `__ode15__.oct` 是 `-sSIDE_MODULE=1` 的 side module，**SUNDIALS 的静态码整个打进去**，
# 产物自包含（7.2 批次 3 实测 568 KB）。主 wasm 零增长、零重链、零重配。
#   ⇒ 所以 configure 里保持 `--without-sundials_*` 就行，**不必**改成 `--with-*`。
#   （HISTORY §10.6 第 1 项原写"重配 → 重编 → 重链"是按 configure 车道设想的；
#     实车走 .oct 车道，更短也更安全：主 wasm 的字节数不变，回归面为零。）
#
# ── 7.2 踩过、这里原样保留的两个坑（build/CLIBS.md 批次 3）──────────────────
#   1. 交叉编译下 `check_type_size` 全空 → "No integer type of size 4 was found"。
#      解：直接预置判据缓存 `HAS_int32_t=4 HAS_int=4 HAS_long=4`
#      （源码 cmake/SundialsIndexSize.cmake 正是读 `HAS_<type> EQUAL 4`）。
#   2. `-lsundials_ida` **自带全部依赖**（nvector/sunlinsol/sunmatrix/generic 都在
#      同一个 .a 里，实测 35 个成员），再叠 `-lsundials_nvecserial` 会
#      `duplicate symbol: N_VGetVectorID_Serial`。⇒ 链接时**只给 -lsundials_ida**。
#
# ── 11.3.0 相对 7.2 的唯一差别 ─────────────────────────────────────────────
#   CFLAGS 加 `-fwasm-exceptions`：11.3.0 全树用 wasm 原生异常（HISTORY §10.3 坑 1），
#   side module 必须同模型；C 代码里它近乎空操作，但保证了 EH 模型一致。
#   （本目录其它 C 库 glpk/hdf5 也是这么编的，见 build-libs.sh:104。）
#
# 用法（容器内）：bash build-sundials.sh [check]
#   check：只验已装 prefix 的符号，不重新构建。
# 产物：/src/deps/sundials/{include,lib}
#
set -euo pipefail

SRC="${SRC:-/src/vendor}"
WORK="${WORK:-/src/libwork}"
P="${P:-/src/deps/sundials}"
JOBS="${JOBS:-$(nproc)}"
# ★ 车道旗标（branch threads）：emcmake 把编译器钉成绝对路径 ⇒ 影子管不到显式旗标串
LANE_FLAGS="${LANE_FLAGS:-}"
export CCACHE_DIR="${CCACHE_DIR:-/ccache}"
TARBALL="sundials-6.1.1.tar.gz"
SRCDIR="$WORK/sundials-6.1.1"
BUILD="${BUILD:-$WORK/sundials-build}"

say () { echo; echo "=== $*"; }

# ---- 自检：链接器真正需要的那几个符号必须都在 -------------------------------
check_symbols () {
  local lib="$P/lib/libsundials_ida.a"
  [ -f "$lib" ] || { echo "FATAL: 没有 $lib" >&2; exit 2; }
  # 期望符号 = __ode15__.cc 定义 HAVE_* 门禁后会真正调用的那批 API。
  #   IDAInit / IDASetLinearSolver / IDASetJacFn ：新 API（6.x）
  #   SUNContext_Create                          ：HAVE_SUNDIALS_SUNCONTEXT 分支
  #   SUNLinSol_Dense / SUNSparseMatrix_*        ：HAVE_SUNLINSOL_DENSE 分支
  #   N_VNew_Serial                              ：串行 nvector
  # ⚠️ emnm 打印时会**剥掉 wasm 符号的前导下划线**（实测 `T IDAInit`，
  # 而 wasm 里的真名是 `_IDAInit`）——所以匹配时下划线可有可无。
  # ⚠️ 符号表**先落文件再 grep**，不要 `emnm | grep -q`：
  #   grep -q 命中即退出会关掉管道，emnm 收到 SIGPIPE（141），
  #   而本脚本有 `set -o pipefail` → 整条管道被判失败 → **命中反而报 MISS**
  #   （实测：SUNLinSol_Dense 命中、更早出现的 IDAInit 被误报缺失）。
  local syms="$P/lib/.syms.tmp" missing=0
  emnm --defined-only "$lib" > "$syms" 2>/dev/null || true
  local want="IDAInit IDASetLinearSolver IDASetJacFn SUNContext_Create SUNLinSol_Dense N_VNew_Serial"
  for s in $want; do
    if grep -qE " [TtWw] _?${s}$" "$syms"; then
      printf "  ok   %s\n" "$s"
    else
      printf "  MISS %s\n" "$s"; missing=$((missing+1))
    fi
  done
  echo "  库大小：$(stat -c%s "$lib") 字节，成员 $(emar t "$lib" | wc -l) 个"
  rm -f "$syms"
  # 反向自检：不要串行 nvector 的独立库（它会和 ida 里的重名）
  if [ -f "$P/lib/libsundials_nvecserial.a" ]; then
    echo "  ⚠️  存在 libsundials_nvecserial.a —— 链接 __ode15__.oct 时**不要**加它（会重名）"
  fi
  [ "$missing" -eq 0 ] || { echo "FATAL: 缺 $missing 个符号" >&2; exit 3; }
  echo "  ✅ SUNDIALS 符号自检通过"
}

if [ "${1:-}" = "check" ]; then
  say "只做符号自检（$P）"; check_symbols; exit 0
fi

# ---- 取源码 -----------------------------------------------------------------
if [ ! -d "$SRCDIR" ]; then
  [ -f "$SRC/$TARBALL" ] || { echo "FATAL: 找不到 $SRC/$TARBALL" >&2; exit 2; }
  say "解包 $TARBALL → $WORK（81 MB，约 20 秒）"
  mkdir -p "$WORK"
  tar xf "$SRC/$TARBALL" -C "$WORK"
fi
[ -d "$SRCDIR" ] || { echo "FATAL: 解包后没有 $SRCDIR" >&2; exit 2; }

# ---- cmake configure --------------------------------------------------------
# 只留 IDA；ARKODE/CVODE/CVODES/IDAS/KINSOL 全关（不需要，省编译时间）。
# SUNDIALS_INDEX_SIZE=32 与 Octave 的 OCTAVE_IDX_TYPE=int32_t 对齐。
mkdir -p "$P"
say "emcmake cmake（只 IDA + 稠密线性求解器，32 位索引，静态）"
emcmake cmake -S "$SRCDIR" -B "$BUILD" \
  -DCMAKE_INSTALL_PREFIX="$P" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_COMPILER_LAUNCHER=ccache \
  -DCMAKE_C_FLAGS="-O2 -fPIC -fwasm-exceptions $LANE_FLAGS" \
  -DBUILD_SHARED_LIBS=OFF \
  -DSUNDIALS_PRECISION=double \
  -DSUNDIALS_INDEX_SIZE=32 \
  -DBUILD_IDA=ON -DBUILD_IDAS=OFF \
  -DBUILD_ARKODE=OFF -DBUILD_CVODE=OFF -DBUILD_CVODES=OFF -DBUILD_KINSOL=OFF \
  -DEXAMPLES_ENABLE_C=OFF -DEXAMPLES_ENABLE_CXX=OFF -DEXAMPLES_ENABLE_F2003=OFF \
  -DBUILD_TESTING=OFF \
  -DBUILD_FORTRAN_MODULE_INTERFACE=OFF \
  -DENABLE_MPI=OFF -DENABLE_OPENMP=OFF -DENABLE_PTHREAD=OFF \
  -DHAS_int32_t=4 -DHAS_int=4 -DHAS_long=4 \
  > "$WORK/sundials-conf.log" 2>&1 \
  || { echo "FATAL: configure 失败，见 $WORK/sundials-conf.log" >&2; tail -25 "$WORK/sundials-conf.log" >&2; exit 4; }
echo "  configure ok"

say "编译 + 安装（-j$JOBS）"
emmake cmake --build "$BUILD" -j"$JOBS" > "$WORK/sundials-make.log" 2>&1 \
  || { echo "FATAL: build 失败，见 $WORK/sundials-make.log" >&2; grep -E "error:|Error" "$WORK/sundials-make.log" | head -20 >&2; exit 5; }
emmake cmake --install "$BUILD" > "$WORK/sundials-inst.log" 2>&1 \
  || { echo "FATAL: install 失败，见 $WORK/sundials-inst.log" >&2; exit 6; }

say "符号自检"
check_symbols
echo
echo "✅ SUNDIALS 6.1.1 → $P"
ls "$P/lib"
