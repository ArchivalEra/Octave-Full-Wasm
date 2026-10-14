#!/usr/bin/env bash
# 三边性能对比一键复跑：原生 CPython / 浏览器 Pyodide / 原生 Octave+symbolic（2026-10-14）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 用户点令："pyodide 是不是性能承重件，你可以用原生 octave+uv 跑下对比，
#           如果性能接近我们以后就不讨论了"
# 判据：三边跑**同一组 15 个 op**，出几何均值比值（见 compare.py 的表）。
#
# ⚠️ 三条纪律（少一条对比就不可信）：
#   ① **同一份 bench 源码**（`bench-sympy.py`）——浏览器侧是 fetch 这个文件，不复制逻辑；
#   ② **同 sympy 版本**（1.14.0）——两侧的 ground_types 都钉 `python`（Pyodide 无 gmpy2，
#      若原生侧碰巧有 gmpy2 会"免费"快一截：那比的是 gmpy2 不是 Pyodide）；
#   ③ **Octave 侧两档 IPC 分开报**：`popen2`（持久 Python，与"浏览器里常驻一个 Pyodide"
#      语义对齐）才是可比档；`system`（每次调用新起进程）量的是进程启动费。
set -euo pipefail
REPO=${REPO:-$(cd "$(dirname "$0")/../../.." && pwd)}
FIX="$REPO/test/fixtures/sympy-perf"
OUT=/mnt/hdd/octave-wasm-build/w64-logs
VENV=${VENV:-/tmp/oct-sym-venv}
mkdir -p "$OUT"

# ── 1) 原生 CPython（uv；同 sympy 1.14.0）──
echo "== [1/3] 原生 CPython（uv）"
( cd "$FIX" && uv run --python 3.14 --with sympy==1.14.0 python3 bench-sympy.py native 3 ) \
  > "$OUT/sympy-perf-native.json"
echo "   读数 → $OUT/sympy-perf-native.json"

# ── 2) 浏览器 Pyodide（同一份 bench 源码；**两档轮子**：source / pyc）──
#    WHEELS=pyc 只改 pyodide lock 指向预编轮子（字节要先跑 prepare-pyc-wheels.sh 产出）
echo "== [2/3] 浏览器 Pyodide（源码轮子）"
BENCH="$FIX/bench-sympy.py" WHEELS=source sh "$REPO/test/browser/run.sh" \
  "$FIX/probe-sympy-perf-pyodide.mjs" > "$OUT/sympy-perf-pyodide.log" 2>&1
echo "   读数 → $OUT/sympy-perf-pyodide.json"

if [ "${SKIP_PYC:-0}" != "1" ]; then
  echo "== [2b/3] 浏览器 Pyodide（**.pyc 预编译轮子**）"
  sh "$REPO/test/fixtures/sympy-pyc-ab/prepare-pyc-wheels.sh" || {
    echo "   ⚠️ 预编失败 ⇒ 跳过 pyc 档（不算结论，如实记）" >&2; SKIP_PYC=1; }
  if [ "${SKIP_PYC:-0}" != "1" ]; then
    BENCH="$FIX/bench-sympy.py" WHEELS=pyc sh "$REPO/test/browser/run.sh" \
      "$FIX/probe-sympy-perf-pyodide.mjs" > "$OUT/sympy-perf-pyodide-pyc.log" 2>&1
    echo "   读数 → $OUT/sympy-perf-pyodide-pyc.json"
  fi
fi

# ── 3) 原生 Octave + symbolic（两档 IPC）──
#   前置：uv venv 装 sympy（Octave 的 symbolic 包会调它）
if [ ! -x "$VENV/bin/python" ]; then
  echo "== 建 venv：$VENV（uv，sympy 1.14.0）"
  uv venv "$VENV" --python 3.14 >/dev/null
  uv pip install --python "$VENV/bin/python" sympy==1.14.0 >/dev/null
fi
octave_bench () {   # $1 = ipc 档（popen2|system），$2 = 输出日志
  local ipc=$1 log=$2
  cat > /tmp/bench-oct-sym-gen.m <<EOF
pkg load symbolic
sympref ipc $ipc
setenv('PYTHON','$VENV/bin/python')
syms x y
d0 = diff(sin(x)*exp(x), x);   % 预热：python 启动/头装载移出计时（两侧同法）
t=tic; d1=diff(sin(x)*exp(x),x); t1=toc(t);
t=tic; d2=diff(x^20*sin(x)^5,x); t2=toc(t);
t=tic; i1=int(sin(x)*exp(x),x); t3=toc(t);
t=tic; i2=int(1/(x^3+1),x); t4=toc(t);
t=tic; s1=solve(x^3-2*x+1==0,x); t5=toc(t);
t=tic; s2=simplify(sin(x)^2+cos(x)^2+(x^3-1)/(x-1)); t6=toc(t);
t=tic; e1=expand((x+y+1)^25); t7=toc(t);
t=tic; f1=factor(x^30-1); t8=toc(t);
t=tic; l1=limit((1-cos(x))/x^2,x,0); t9=toc(t);
t=tic; se=taylor(sin(x)*exp(x),x,0,'Order',14); t10=toc(t);
printf('OCT|diff_exp_sin %.2f\\ndiff_poly_trig %.2f\\ninteg_exp_sin %.2f\\ninteg_rational %.2f\\nsolve_poly %.2f\\nsimplify_mix %.2f\\nexpand_big %.2f\\nfactor_cyclo %.2f\\nlimit_classic %.2f\\nseries14 %.2f\\n', t1*1000,t2*1000,t3*1000,t4*1000,t5*1000,t6*1000,t7*1000,t8*1000,t9*1000,t10*1000);
t=tic; for k=1:3, dd=diff(sin(x+k),x); end; t11=toc(t);
printf('roundtrip3 %.2f\\n', t11*1000);
EOF
  echo "== [3/3] 原生 Octave + symbolic（ipc=$ipc）"
  timeout 600 env PYTHON="$VENV/bin/python" octave --no-gui \
    --eval "run('/tmp/bench-oct-sym-gen.m')" > "$log" 2>&1 || true
  grep -c "^" "$log" >/dev/null && echo "   读数 → $log"
}
octave_bench popen2 /tmp/oct-popen2.log
octave_bench system /tmp/oct-system.log

# ── 4) 对比 ──
echo
python3 "$FIX/compare.py"
