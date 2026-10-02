#!/bin/sh
# 原生基线基准（perf-max 图票 02）—— 浏览器占比仪表盘的"原生"一侧。
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 口径与 test/browser/bench-core.mjs / bench-lanes.mjs 的线代子集**同题**（Q4=a：只算线代）：
#   matmul 500²/1024²/2000² + lu(800)，rand 在计时外，×3 取中位数。
# 两个后端都测、都如实记录：
#   netlib     = 系统 libblas.so.3 默认（参考实现，单线程）—— "用户手里的 Octave"
#   openblas24 = LD_PRELOAD OpenBLAS（0.3.34 pthread，OPENBLAS_NUM_THREADS=24）—— "天花板"
#                （与 wasm 里的 OpenBLAS 同版本族 0.3.34；**不动 alternatives**，只 preload）
# 产出：JSON → $OUT_JSON（facts.py 的 native_* 键从这里读），stdout 打人类可读摘要。
#
# 用法：sh build/113/bench-native.sh
# 复跑前提：机器空闲（跑基准别并行干重活）；libopenblas0-pthread 已装（只加库，不切换系统 BLAS）。
set -e
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_JSON="${OUT_JSON:-/mnt/hdd/octave-wasm-build/w64-logs/native-baseline.json}"
OB_LIB="$(ls /usr/lib/x86_64-linux-gnu/openblas-pthread/libopenblasp-r*.so 2>/dev/null | sort | tail -1)"

PROG="$(mktemp /tmp/bench-native-XXXX.m)"
trap 'rm -f "$PROG"' EXIT
cat > "$PROG" <<'EOF'
ts=[];
for r=1:3, A=rand(500);  B=rand(500);  tic; C=A*B;        ts(r)=toc; endfor
printf("matmul500 %.6f\n", median(ts));
ts=[];
for r=1:3, A=rand(1024); B=rand(1024); tic; C=A*B;        ts(r)=toc; endfor
printf("matmul1024 %.6f\n", median(ts));
ts=[];
for r=1:3, A=rand(2000); B=rand(2000); tic; C=A*B;        ts(r)=toc; endfor
printf("matmul2000 %.6f\n", median(ts));
ts=[];
for r=1:3, A=rand(800);  tic; [L,U,P]=lu(A);              ts(r)=toc; endfor
printf("lu800 %.6f\n", median(ts));
EOF

run_backend() {  # $1=名字  $2=LD_PRELOAD 值（空=系统默认）
  local name="$1" pre="$2" f
  f="$(mktemp /tmp/bench-native-out-XXXX.txt)"
  if [ -n "$pre" ]; then
    LD_PRELOAD="$pre" OPENBLAS_NUM_THREADS="${OB_THREADS:-24}" \
      octave-cli --quiet --no-window-system "$PROG" > "$f" 2>/dev/null
  else
    octave-cli --quiet --no-window-system "$PROG" > "$f" 2>/dev/null
  fi
  echo "$f"
}

NETLIB_OUT="$(run_backend netlib "")"
OB_OUT="$(run_backend openblas24 "$OB_LIB")"

CPU="$(lscpu 2>/dev/null | sed -n 's/^型号名称：\s*//p;s/^Model name:\s*//p' | head -1)"
OCT_VER="$(octave-cli --quiet --eval 'disp(version())' 2>/dev/null | head -1)"
OB_VER="$(basename "${OB_LIB:-none}" | sed 's/libopenblasp-r//;s/\.so//')"
NOW="$(date -Is)"

python3 - "$NETLIB_OUT" "$OB_OUT" "$OUT_JSON" "$CPU" "$OCT_VER" "$OB_VER" "${OB_THREADS:-24}" "$NOW" <<'EOF'
import json, sys
net_f, ob_f, out_json, cpu, oct_ver, ob_ver, ob_threads, now = sys.argv[1:9]
def read(f):
    d = {}
    for line in open(f):
        parts = line.split()
        if len(parts) == 2:
            try: d[parts[0]] = float(parts[1])
            except ValueError: pass
    return d
net, ob = read(net_f), read(ob_f)
def gflops(name, t):
    n = {"matmul500": 500, "matmul1024": 1024, "matmul2000": 2000}.get(name)
    if t <= 0: return None
    if n:  return round(2 * n**3 / t / 1e9, 2)          # matmul ≈ 2n³ FLOP
    if name == "lu800": return round(2/3 * 800**3 / t / 1e9, 2)  # lu ≈ 2/3 n³
    return None
def dress(d):
    return {k: {"s": v, "gflops": gflops(k, v)} for k, v in sorted(d.items())}
doc = {
    "generated_at": now,
    "cpu": cpu, "octave_version": oct_ver, "nproc": __import__("os").cpu_count(),
    "backends": {
        "netlib":     {"desc": "系统默认 libblas.so.3（参考实现，单线程）", **dress(net)},
        "openblas24": {"desc": f"LD_PRELOAD OpenBLAS {ob_ver} pthread", "threads": int(ob_threads), **dress(ob)},
    },
    "note": "与 test/browser/bench-core.mjs / bench-lanes.mjs 线代子集同题同口径（Q4=a）；×3 中位数",
}
open(out_json, "w").write(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
print(f"cpu={cpu}  octave={oct_ver.strip()}  openblas={ob_ver}  threads={ob_threads}")
for bk, dd in doc["backends"].items():
    for k, v in dd.items():
        if isinstance(v, dict):
            print(f"  {bk:10s} {k:11s} {v['s']:8.4f} s  {v['gflops']:8.2f} GFLOPS")
print(f"→ {out_json}")
EOF
