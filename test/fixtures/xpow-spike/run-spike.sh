#!/usr/bin/env bash
# xpow-spike（工单 63 收口 / 候选④）：模型化 Octave elem_xpow 的驱动循环，
# 量「驱动层（octave_quit + 逐元素索引）能省多少」。结论判据：driver_only/base。
# 用法：bash test/fixtures/xpow-spike/run-spike.sh   （宿主 rustc/cargo + 容器 emcc + 宿主 node）
set -euo pipefail
REPO=${REPO:-$(cd "$(dirname "$0")/../../.." && pwd)}
FIX="$REPO/test/fixtures/xpow-spike"
CTR=${CTR:-o113}
W=/tmp/xpowspike

# ① wasm64 Rust 库（nightly build-std，与正典 rust-sort 同路线）
( cd "$FIX/rust" && cargo +nightly build --release )
LIB="$FIX/rust/target/wasm64-unknown-unknown/release/libxpow_spike.a"

# ② 容器 emcc 链 spike（wasm64 + node）
sudo docker exec "$CTR" mkdir -p "$W"
sudo docker cp "$FIX/xpowspike.cpp" "$CTR:$W/"
sudo docker cp "$FIX/xpowmain.cpp" "$CTR:$W/"
sudo docker cp "$LIB" "$CTR:$W/libxpow_spike.a"
sudo docker exec "$CTR" bash -c "cd $W && \
  /emsdk/upstream/emscripten/em++ xpowspike.cpp xpowmain.cpp libxpow_spike.a -O3 \
    -sMEMORY64=1 -sENVIRONMENT=node -sEXIT_RUNTIME=1 -sINITIAL_MEMORY=256MB \
    -sALLOW_MEMORY_GROWTH=1 -o xs.js"

# ③ 宿主 node 跑
mkdir -p "$W"
for f in xs.js xs.wasm; do sudo docker cp "$CTR:$W/$f" "$W/$f"; done
sudo chown -R "$(id -u):$(id -g)" "$W"
node "$W/xs.js"
