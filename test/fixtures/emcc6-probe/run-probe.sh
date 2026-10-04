#!/usr/bin/env bash
# emcc 5.0.7 vs 6.0.10 工具链对比（IllegalPerformance 线）：同源源码、双 emcc、交错计时
# + 旗标存活矩阵（JSPI/MEMORY64/pthread/relaxed-simd 跨主版本的存活清单）。
# 用法：sh test/fixtures/emcc6-probe/run-probe.sh [reps]
set -euo pipefail
REPO=${REPO:-$(cd "$(dirname "$0")/../../.." && pwd)}
FIX="$REPO/test/fixtures/emcc6-probe"
CTR=${CTR:-o113}
WORK=/tmp/emcc6-probe
REPS=${1:-1}

sudo docker exec "$CTR" mkdir -p "$WORK"
for f in probe.c driver.mjs; do sudo docker cp "$FIX/$f" "$CTR:$WORK/$f"; done
sudo docker exec "$CTR" bash -c "cd $WORK && \
  /emsdk/upstream/emscripten/emcc -O2 -sINITIAL_MEMORY=64MB -sMODULARIZE=1 \
    -sEXPORT_NAME=createProbe -sENVIRONMENT=node probe.c -o p5.js && \
  /opt/emsdk-6/upstream/emscripten/emcc -O2 -sINITIAL_MEMORY=64MB -sMODULARIZE=1 \
    -sEXPORT_NAME=createProbe -sENVIRONMENT=node probe.c -o p6.js" 2>&1 | grep -iE 'error|warn' | head -5 || true

echo "== 旗标存活矩阵（6.0.10 编译 rc；同旗标 5.0.7 对照）"
sudo docker exec "$CTR" bash -c 'cd '"$WORK"' && for f in "-sMEMORY64=1" "-fwasm-exceptions" "-sJSPI" "-pthread" "-mrelaxed-simd" "-sMAIN_MODULE=2"; do
  r5=✓; r6=✓
  echo "int main(){return 0;}" > t.c
  /emsdk/upstream/emscripten/emcc $f -o /dev/null t.c >/dev/null 2>&1 || r5=✗
  /opt/emsdk-6/upstream/emscripten/emcc $f -o /dev/null t.c >/dev/null 2>&1 || r6=✗
  echo "  $f : 5.0.7=$r5  6.0.10=$r6"
done'

for f in p5.js p5.wasm p6.js p6.wasm driver.mjs; do
  sudo docker cp "$CTR:$WORK/$f" "/tmp/emcc6/$f" 2>/dev/null || { mkdir -p /tmp/emcc6 && sudo docker cp "$CTR:$WORK/$f" "/tmp/emcc6/$f"; }
done
sudo chown -R "$(id -u):$(id -g)" /tmp/emcc6
node /tmp/emcc6/driver.mjs /tmp/emcc6/p5.js /tmp/emcc6/p6.js "$REPS"
rm -rf /tmp/emcc6
