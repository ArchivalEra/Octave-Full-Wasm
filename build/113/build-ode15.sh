#!/usr/bin/env bash
#
# 真编 `__ode15__.oct`（自包含，内嵌 SUNDIALS 6.1.1）
#
# 取代之前的**桩**：桩是 `-DHAVE_SUNDIALS` 没传时 `__ode15__.cc` 整个文件被
# `#if defined (HAVE_SUNDIALS)` 预处理器剪掉编出来的空模块（1543 字节，
# `exist('__ode15__')==3` 但调用必报"没有这个功能"）。
#
# ── 门禁宏怎么来的（逐条都有出处，别凭记忆改）──────────────────────────────
# `libinterp/dldfcn/__ode15__.cc` 用的门禁，与 7.2 是**同一套**（已逐行核对
# 11.3.0 的源码）：
#   HAVE_SUNDIALS                         ← 整个文件的开关（:47）
#   HAVE_SUNDIALS_SUNCONTEXT              ← 6.x 新 API 的 SUNContext 分支（:197/:377/:586）
#   HAVE_SUNDIALS_IDA / _NVECSERIAL / _SUNLINSOL_DENSE   ← 语义标记（不参与编译分支）
#   HAVE_NVECTOR_NVECTOR_SERIAL_H         ← <nvector/nvector_serial.h>   (:49)
#   HAVE_IDA_IDA_H / HAVE_IDA_IDA_DIRECT_H← <ida/ida.h> / <ida/ida_direct.h> (:53,:58)
#   HAVE_SUNLINSOL_SUNLINSOL_DENSE_H      ← <sunlinsol/sunlinsol_dense.h> (:64)
#   HAVE_IDASETJACFN / HAVE_IDASETLINEARSOLVER / HAVE_SUNLINSOL_DENSE
#                                         ← 6.x 的**真名**就在库里 → 定义它们，
#                                           让源码里那三处兼容 shim（:87/:95/:103）
#                                           被跳过，直接调真函数。
# **不定义** HAVE_SUNDIALS_SUNLINSOL_KLU / HAVE_KLU_* / HAVE_SUNKLU：
#   KLU 稀疏那条路（:295/:423）关掉（7.2 第一版也是关的）。
#   ⚠️ 只关 HAVE_SUNDIALS_SUNLINSOL_KLU 是不够的——这里两个宏一个都别传。
#
# ── OCTAVE_SUNREALTYPE：**必须显式传**，漏了就编不过 ───────────────────────
# config.h:2872 是 `/* #undef OCTAVE_SUNREALTYPE */`（同样是注释），而不传时
# 编译器直接报 `unknown type name 'OCTAVE_SUNREALTYPE'`（实测，`__ode15__.cc`
# 里用了 51 次）。取值规则来自 configure 自身的探测（configure:107537）：
#   `sunrealtype test;` 编得过 → sunrealtype，否则 realtype。
# SUNDIALS 6.1.1 的 sundials_types.h 在 `SUNDIALS_DOUBLE_PRECISION` 分支下
# **同时** typedef 了 `realtype` 与 `sunrealtype`（前者的注释就写着 "deprecated"），
# 所以该探测必然成功 ⇒ 与「configure 开着 sundials 跑」的结果一致 = `sunrealtype`。
# 同时那一支还带 `SUN_RCONST` 等宏，源码里用的正是新名，选 sunrealtype 才配套。
#
# ── 链接 ────────────────────────────────────────────────────────────────────
# 只给 `-lsundials_ida` **一个**库：它自带 nvector/sunlinsol/sunmatrix/generic
# （实测 35 个成员，`N_VNew_Serial`/`SUNContext_Create` 都在里面）。
# 再叠 `-lsundials_nvecserial` 会 `duplicate symbol: N_VGetVectorID_Serial`。
#
# 用法（容器内）：bash build-ode15.sh
# 产物：/src/octs/__ode15__.oct
#
set -euo pipefail

SUNDIALS_PREFIX="${SUNDIALS_PREFIX:-/src/deps/sundials}"
OUT="${OUT:-/src/octs}"
HERE="$(cd "$(dirname "$0")" && pwd)"

[ -f "$SUNDIALS_PREFIX/lib/libsundials_ida.a" ] \
  || { echo "FATAL: 没有 $SUNDIALS_PREFIX/lib/libsundials_ida.a（先跑 build-sundials.sh）" >&2; exit 2; }
[ -d "$SUNDIALS_PREFIX/include/ida" ] \
  || { echo "FATAL: 没有 $SUNDIALS_PREFIX/include/ida（SUNDIALS 头没装）" >&2; exit 2; }

DEFS="-DHAVE_SUNDIALS \
-DHAVE_SUNDIALS_IDA -DHAVE_SUNDIALS_NVECSERIAL -DHAVE_SUNDIALS_SUNCONTEXT \
-DHAVE_SUNDIALS_SUNLINSOL_DENSE \
-DHAVE_NVECTOR_NVECTOR_SERIAL_H -DHAVE_IDA_IDA_H -DHAVE_IDA_IDA_DIRECT_H \
-DHAVE_SUNLINSOL_SUNLINSOL_DENSE_H \
-DHAVE_IDASETJACFN -DHAVE_IDASETLINEARSOLVER -DHAVE_SUNLINSOL_DENSE \
-DOCTAVE_SUNREALTYPE=sunrealtype"

OCT_DEFS="$DEFS" \
OCT_INCS="-I$SUNDIALS_PREFIX/include" \
OCT_LIBS="-L$SUNDIALS_PREFIX/lib -lsundials_ida" \
OUT="$OUT" \
  bash "$HERE/build-oct.sh" __ode15__

echo
echo "== 自检：门禁是否**真的**打开了（不是又一个空桩）"
sz=$(stat -c%s "$OUT/__ode15__.oct")
echo "   产物大小：$sz 字节（空桩是 1543 字节）"
[ "$sz" -gt 100000 ] || { echo "FATAL: 产物太小，门禁没打开（还是空桩）" >&2; exit 3; }
if emnm --defined-only "$OUT/__ode15__.oct" > "$OUT/.ode15.syms" 2>/dev/null; then
  if grep -qE " [TtWw] _?(IDASetLinearSolver|oda15s_function|__ode15__)" "$OUT/.ode15.syms"; then
    echo "   ✅ 符号表里有 ode15 的入口（不是空模块）"
  else
    echo "   ⚠️  没在符号表里看到预期入口，前 12 行：" >&2
    head -12 "$OUT/.ode15.syms" >&2
  fi
  rm -f "$OUT/.ode15.syms"
fi
echo "✅ $OUT/__ode15__.oct"
