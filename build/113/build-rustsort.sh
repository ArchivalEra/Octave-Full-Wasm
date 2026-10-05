#!/usr/bin/env bash
# build/113/build-rustsort.sh — rust-sort 插件的库构建（工单 63 候选③）。
# 宿主 rustc（wasm32-unknown-emscripten）→ 静态库 → docker cp 进容器固定路径
# /src/deps/rustsort/librustsort.a，供 link-web.sh 的 RUST_SORT 旋钮链入。
# G5 工具链不变式（build/build-inputs.json）：wasm32 先行（rustc 无 wasm64 std）、
# panic=abort（边界不许 unwind）、staticlib、符号 = 缝的弱符号名。
# 用法：bash build/113/build-rustsort.sh   （幂等：每次重编，rustc 秒级）
set -euo pipefail
REPO=${REPO:-$(cd "$(dirname "$0")/../.." && pwd)}
CTR=${CTR:-o113}
SRC="$REPO/build/113/rust/sort.rs"
OUT=/tmp/rustsort-lane

[ -f "$SRC" ] || { echo "FATAL: 找不到正典源 $SRC" >&2; exit 2; }
command -v rustc >/dev/null 2>&1 || { echo "FATAL: 宿主没有 rustc（车道 Rust 内核在宿主编）" >&2; exit 2; }

mkdir -p "$OUT"
rustc --target wasm32-unknown-emscripten -O --crate-type staticlib -C panic=abort \
  "$SRC" -o "$OUT/librustsort.a"

# fail-closed（G1 同款纪律）：库里必须有缝的符号，否则宁可停在这里。
# ⚠ 不用 `llvm-nm | grep -q`：pipefail 下 grep -q 提前退出 ⇒ 上游 SIGPIPE ⇒
#   管道假阴性（符号在也报 FATAL）——先收全量输出再 case 匹配。
SYMS=$(llvm-nm --defined-only "$OUT/librustsort.a" 2>/dev/null || true)
case "$SYMS" in
  *octave_rust_sort_f64*) ;;
  *) echo "FATAL: librustsort.a 里没有 octave_rust_sort_f64（符号名与缝不一致？）" >&2; exit 2 ;;
esac

sudo docker exec "$CTR" mkdir -p /src/deps/rustsort
sudo docker cp "$OUT/librustsort.a" "$CTR:/src/deps/rustsort/librustsort.a"
echo "librustsort.a → $CTR:/src/deps/rustsort/librustsort.a（$(stat -c%s "$OUT/librustsort.a") 字节）"
