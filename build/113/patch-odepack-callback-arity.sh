#!/usr/bin/env bash
#
# 修 `lsode` 整页 trap 的根因：**ODEPACK 的回调参数个数与 Octave 的回调不匹配**
#
# ── 根因（2026-09-22 查明，证据链完整）──────────────────────────────────────
# `lsode` 一调用就把整个页面打死（`RuntimeError: unreachable`）。定位过程：
#   1. 用 `link-web.sh DIAG_NAMES=1` 把 trap 符号化 → `LSODE::do_integrate(double)`；
#   2. 开 `-s ASSERTIONS=1` 无原因输出 → 是**裸 `unreachable`**；
#   3. 三条错误路径（回调长度不匹配 / AbsTol 不匹配 / maxord 非法）**都干净报错**，
#      说明回调与初始化全通过 ⇒ trap 夹在 `F77_XFCN (dlsode, …)` 那一步；
#   4. `DIAG_SOURCEMAP=1` 出一份 `octave.wasm.map`，把 trap 的 wasm 偏移翻成源码行
#      → **`dlsode.c:1618`**，即 f2c 生成的
#          `(*f)(&neq[1], t, &y[1], &rwork[lf0]);`
#
# 也就是说：**trap 就是"调用用户函数"这一句**。原因是**参数个数不一致**：
#
#   · 本树 odepack 的 Fortran 调 F 时给 **4 个**实参：
#       dlsode.f:1393        CALL F (NEQ, T, Y, RWORK(LF0))
#       dstode.f:257/311/470 CALL F (NEQ, TN, Y, SAVF)
#       dprepj.f:107/129/172 CALL F (NEQ, TN, Y, FTEM|WM(3))
#     f2c 因此生成 4 参函数指针调用 → wasm 类型 `(i32,i32,i32,i32)->void`。
#   · Octave 的 `lsode_f`（liboctave/numeric/LSODE.cc）有 **5 个形参**（多一个
#     `F77_INT& ierr`，用于在导数为空时回 -1）→ wasm 类型是
#     `(i32,i32,i32,i32,i32)->void`。
#
# 在原生 x86 上这不致命：C 不检查函数指针签名，第 5 个实参只是读到一段垃圾；
# 而 `lsode_f` 只在**导数为空**时才写它 —— 所以平时"看起来能用"。
# **在 wasm 上 `call_indirect` 会做精确类型检查 → 类型不符即 `unreachable`**
#  → 整页死掉。7.2 与 11.3.0 都踩同一坑，所以这是两代共有的先天缺陷。
#
# （旁证：同一批里 `lsode_j` 有 7 个形参，而 dprepj 的 `(*jac)(…)` 恰好也是 7 个
#   → **只有 `f` 这一侧不匹配**，这也解释了为什么只有 F 的调用点会 trap。）
#
# ── 修法 ────────────────────────────────────────────────────────────────────
# 给这 7 处 `CALL F` **补上第 5 个实参**，与 Octave 回调对齐（也就是 Octave 本来
# 就期待的 F2003 风格接口 `F(NEQ, T, Y, YDOT, IERR)`）。
# 用 `JERR` 这个名字**故意不做声明**：这些文件都没有 `IMPLICIT NONE`，Fortran 的
# 隐式类型规则下 J 开头的名字自动是 INTEGER —— 既省掉改动声明区（容易踩续行），
# f2c 也会照隐式类型给它 `integer` 定义。
# DLSODE 本身并不读它（stock 版没有 IERR 语义），所以**行为与原生一致**：
# 只是让那个引用指向一个**真实存在的变量**，而不是垃圾指针。
#
# 幂等：已经是 5 参的行会被跳过；改完带自检（必须是 7 处）。
#
# 用法（容器内，**在编译主树之前**或改完后重编那几个 .o）：
#   bash patch-odepack-callback-arity.sh [源码树路径]
#
set -euo pipefail

OCT="${1:-/src/work/octave-11.3.0}"
D="$OCT/liboctave/external/odepack"

for f in dlsode.f dstode.f dprepj.f; do [ -f "$D/$f" ] || { echo "FATAL: 找不到 $D/$f" >&2; exit 2; }; done

changed=0; already=0; total=0
for f in dlsode.f dstode.f dprepj.f; do
  p="$D/$f"
  # 先把已经带 JERR 的行数出来（幂等判断）
  already=$(( already + $(grep -cE "CALL F \(.*JERR\)[[:space:]]*$" "$p" || true) ))
  # 只改「CALL F (…4 个实参…)」且行尾不是 JERR) 的行
  before=$(grep -cE "CALL F \(" "$p" || true)
  python3 - "$p" <<'PY'
import re, sys
p=sys.argv[1]
lines=open(p).read().split('\n')
n=0
for i,l in enumerate(lines):
    if 'CALL F (' in l and not l.rstrip().endswith('JERR)'):
        # 在最后一个 ')' 之前插入 ', JERR'
        j=l.rstrip().rfind(')')
        if j<0: continue
        # 只处理「整行就是一个 CALL 语句」的情况，避免误伤续行
        if l.strip().startswith('CALL F ('):
            lines[i] = l[:j] + ', JERR' + l[j:]
            n+=1
open(p,'w').write('\n'.join(lines))
print(f"  {p.split('/')[-1]}: 改了 {n} 处")
PY
  total=$(( total + before ))
  changed=$(( changed + $(grep -cE "CALL F \(.*JERR\)[[:space:]]*$" "$p" || true) ))
done

echo "== 自检：CALL F 共 $total 处，其中已带 JERR 的 $changed 处（改前已有 $already 处）"
if [ "$changed" -ne 7 ]; then
  echo "FATAL: 期望 7 处 CALL F 都带 JERR，实际 $changed 处 —— 源文件与预期不符，请人工核对" >&2
  exit 3
fi
echo "✅ ODEPACK CALL F 的回调参数已与 Octave 的 lsode_f（5 参）对齐"
echo "   改完记得重编这几个目标（liboctave/external 下的 dlsode/dstode/dprepj）并重链。"
