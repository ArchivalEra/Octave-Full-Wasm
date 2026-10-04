#!/usr/bin/env bash
# Octave-Full-Wasm — 工单 60 结算件：libm spike（musl libm 子集的同源重编覆盖 vs 默认链接）
# Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
#
# 问题（工单 60）：纯换 libm 实现、Octave 源码一行不改，标量超越函数每个调用能快多少。
# spike A（零新依赖）：用 emscripten 自带的 musl 源码，以 -O3 -fno-math-errno
#   -ffp-contract=fast -mrelaxed-simd 重编 exp/log/pow/sin/cos/__rem_pio2 覆盖对象，
#   链接时排在 libc 前。fno-math-errno 只去 errno 分支；FMA 收缩一般提升精度。
# 判据（driver.mjs 里实现）：精度 <1e-12（对照 host Math.*）+ 每调用几何均值 ≥1.5
#   （= 元素级热点压降 ≥1/3 的操作化）⇒ SPIKE_VERDICT: ADOPT_CANDIDATE，否则 REJECT。
# 用法：sh build/113/bench-libm-spike.sh [reps]     # 容器内构建 + 运行，宿主编排
set -euo pipefail
REPO=${REPO:-/mnt/hdd/zcode-projects/Octave-Full-Wasm}
FIX="$REPO/test/fixtures/libm-spike"
CTR=${CTR:-o113}
WORK=/src/libwork/libm-fast
REPS=${1:-8}

# ── 容器侧构建脚本（单独成文件，避免多层引号转义）────────────────────────────────
TMP=$(mktemp /tmp/spike-build-XXXXXX.sh)
cat > "$TMP" <<'EOS'
#!/usr/bin/env bash
set -euo pipefail
WORK=/src/libwork/libm-fast
MUSL=/emsdk/upstream/emscripten/system/lib/libc/musl
SRCS="exp.c exp_data.c log.c log_data.c pow.c pow_data.c sin.c cos.c __rem_pio2.c __rem_pio2_large.c"
mkdir -p "$WORK" && cd "$WORK"
for f in $SRCS; do cp "$MUSL/src/math/$f" .; done
INC="-I$MUSL/src/internal -I$MUSL/arch/generic -I$MUSL/src/include -I$MUSL/src/math -I."
CFLAGS="-O3 -fno-math-errno -ffp-contract=fast -mrelaxed-simd -sMEMORY64=1 $INC"   # 覆盖对象必须与主链同位宽（wasm64），否则 wasm-ld 拒链
echo "== 编覆盖对象（-O3 -fno-math-errno -ffp-contract=fast -mrelaxed-simd）"
for f in $SRCS; do emcc $CFLAGS -c "$f" -o "${f%.c}.o"; done
echo "== 编两个变体（wasm64 车道）"
COMMON="-O2 -sMEMORY64=1 -sMODULARIZE=1 -sEXPORT_NAME=createBench -sENVIRONMENT=node"
OBJ="exp.o exp_data.o log.o log_data.o pow.o pow_data.o sin.o cos.o __rem_pio2.o __rem_pio2_large.o"
emcc $COMMON bench.c -o bench-base.js
# 覆盖变体：显式对象先于 libc；重复符号先试不加宽宥，失败再加 --allow-multiple-definition
# （第一定义胜出 = 我们的覆盖；后果由精度对拍把守——§"allow-multiple-definition 静默吞重复"
#   的教训在这里被精度门槛对冲）
if ! emcc $COMMON bench.c shim.c $OBJ -o bench-cand.js 2>/tmp/dup.log; then
  echo "   （显式对象与 libc 重复 ⇒ 加 -Wl,--allow-multiple-definition 重试：$(head -c 200 /tmp/dup.log)）"
  emcc $COMMON bench.c shim.c $OBJ -Wl,--allow-multiple-definition -o bench-cand.js
fi
echo "== 构建完成（wasm64 运行交给宿主 node ≥26：容器 node 22 不支持 table64）"
EOS

sudo docker cp "$TMP" "$CTR:/tmp/spike-build.sh"
sudo docker cp "$FIX/bench.c"    "$CTR:$WORK/bench.c" 2>/dev/null || { sudo docker exec "$CTR" mkdir -p "$WORK"; sudo docker cp "$FIX/bench.c" "$CTR:$WORK/bench.c"; }
sudo docker cp "$FIX/shim.c"     "$CTR:$WORK/shim.c"
sudo docker cp "$FIX/driver.mjs" "$CTR:$WORK/driver.mjs"
sudo docker exec "$CTR" bash /tmp/spike-build.sh "${REPS}"
RUNDIR=$(mktemp -d /tmp/libm-spike-run-XXXXXX)
for f in bench-base.js bench-base.wasm bench-cand.js bench-cand.wasm driver.mjs; do
  sudo docker cp "$CTR:$WORK/$f" "$RUNDIR/$f"
done
sudo chown -R "$(id -u):$(id -g)" "$RUNDIR"
node "$RUNDIR/driver.mjs" "$RUNDIR/bench-base.js" "$RUNDIR/bench-cand.js" "${REPS}"
rc=$?
rm -rf "$RUNDIR" "$TMP"
exit $rc
