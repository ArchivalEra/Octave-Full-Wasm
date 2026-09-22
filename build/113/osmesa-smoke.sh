#!/usr/bin/env bash
#
# P5 步骤① 的构建+运行：把 build/113/osmesa-smoke.c 编成 wasm 并用 node 跑起来
#
# 为什么要 node：wasm 产物在容器里没有浏览器可用，但 emscripten 的 .js 跑得了 node，
# 而 OSMesa 这条路**不需要 canvas / 不需要 DOM**（这正是选它而不选 WebGL 的原因）。
#
# 用法（容器内）：bash osmesa-smoke.sh [mesa源码] [mesa构建目录]
set -euo pipefail

MESA_SRC="${1:-/src/libwork/mesa-24.0.9}"
MESA_BUILD="${2:-/src/libwork/mesa-build}"
OUT="${OUT:-/src/deps/osmesa}/smoke"
ZLIB="${ZLIB:-/src/deps/zlibbz2}"

OSMESA_A="$MESA_BUILD/src/gallium/targets/osmesa/libOSMesa.a"
[ -f "$OSMESA_A" ] || { echo "FATAL: 没有 $OSMESA_A（先建 Mesa）" >&2; exit 2; }

mkdir -p "$OUT"

# 依赖归档：libOSMesa.a 用 link_whole 把 osmesa_st + glapi_static 合进去了（784 个成员、
# 自带 OSMesaCreateContextExt / softpipe_create_screen / _glapi_set_context），
# 但 libsoftpipe/libmesa_util_sse41/libblake3 仍要单独给。用 --start-group/--end-group
# 兜住静态库之间的循环依赖（这是静态 Mesa 的标准做法）。
LIBS=(
  "$OSMESA_A"
  "$MESA_BUILD/src/gallium/drivers/softpipe/libsoftpipe.a"
  "$MESA_BUILD/src/util/libmesa_util_sse41.a"
  "$MESA_BUILD/src/util/blake3/libblake3.a"
)
for l in "${LIBS[@]}"; do [ -f "$l" ] || { echo "FATAL: 缺 $l" >&2; exit 2; }; done

echo "== 编译 + 链接 osmesa-smoke → $OUT"
# 垫片：emscripten 缺 sched_getcpu / pthread_setname_np（见 osmesa-stubs.c 的说明）
emcc "$(dirname "$0")/osmesa-smoke.c" "$(dirname "$0")/osmesa-stubs.c" -o "$OUT/osmesa-smoke.js" \
  -I"$MESA_SRC/include" -I"$MESA_SRC/src" -I"$MESA_BUILD/src" -I"$ZLIB/include" \
  -Wl,--start-group "${LIBS[@]}" -Wl,--end-group \
  -L"$ZLIB/lib" -lz \
  -O1 -sENVIRONMENT=node -sEXIT_RUNTIME=1 -sALLOW_MEMORY_GROWTH=1 \
  -Wno-implicit-function-declaration \
  > "$OUT/build.log" 2>&1 \
  || { echo "FATAL: 链接失败，见 $OUT/build.log" >&2; tail -20 "$OUT/build.log" >&2; exit 3; }
echo "  产物 $OUT/osmesa-smoke.js（$(stat -c%s "$OUT/osmesa-smoke.js" 2>/dev/null) 字节）、.wasm $(stat -c%s "$OUT/osmesa-smoke.wasm" 2>/dev/null) 字节"

echo
echo "== 运行（node）"
set +e
node "$OUT/osmesa-smoke.js" 2>&1 | tee "$OUT/run.log"
rc=${PIPESTATUS[0]}
set -e
echo "  node 退出码 = $rc"
exit $rc
