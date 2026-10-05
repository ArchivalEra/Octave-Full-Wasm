#!/usr/bin/env bash
# build/113/build-rustsort-w64.sh — rust-sort 插件的 **wasm64** 库构建（工单 63 候选③）。
# rustc 上游没有 wasm64-unknown-emscripten target（实测 1.98.1/nightly target 列表）⇒
# 走 nightly cargo build-std（core+alloc）+ wasm64-unknown-unknown。
# 评审结论落实（外部评审 2026-10-05）：
#   · target-feature 必须带 +atomics,+bulk-memory,+mutable-globals（wasm-ld 的
#     --shared-memory 检查看对象声明的特性，不是实际使用；预编译 core 无 atomics）。
#   · panic_handler + global_allocator 胶水在 src/lib.rs（abort/malloc/free/realloc/
#     posix_memalign 由 emscripten libc 供给；不开 compiler-builtins-mem）。
#   · 弱符号判空已在 MAIN_MODULE=2 + memory64 + pthread 下实测可靠（ghost=0，E4）。
# 用法：bash build/113/build-rustsort-w64.sh   （幂等；E1 实测 ~11s）
set -euo pipefail
REPO=${REPO:-$(cd "$(dirname "$0")/../.." && pwd)}
CTR=${CTR:-o113}
PROJ="$REPO/build/113/rust"
OUT="$PROJ/target/wasm64-unknown-unknown/release/librs_sort.a"

[ -f "$PROJ/Cargo.toml" ] || { echo "FATAL: 找不到 cargo 工程 $PROJ" >&2; exit 2; }
command -v cargo >/dev/null 2>&1 || { echo "FATAL: 宿主没有 cargo（wasm64 Rust 库在宿主编）" >&2; exit 2; }

( cd "$PROJ" && cargo +nightly build --release )

# fail-closed（G1 同款；先收全量输出再匹配——pipefail×grep -q 假阴性已入档 §5.89）
SYMS=$(llvm-nm --defined-only "$OUT" 2>/dev/null || true)
case "$SYMS" in
  *octave_rust_sort_f64*) ;;
  *) echo "FATAL: librs_sort.a 里没有 octave_rust_sort_f64（wasm64 库与缝不一致？）" >&2; exit 2 ;;
esac
# 反向断言：no_std+abort 策略下不许出现 unwind/personality（评审 ②）
UND=$(llvm-nm -u "$OUT" 2>/dev/null || true)
case "$UND" in
  *eh_personality*|*_Unwind_*) echo "FATAL: 出现 unwind/personality 引用" >&2; exit 2 ;;
esac

sudo docker exec "$CTR" mkdir -p /src/deps/rustsort-w64
sudo docker cp "$OUT" "$CTR:/src/deps/rustsort-w64/librustsort.a"
echo "librustsort.a(wasm64) → $CTR:/src/deps/rustsort-w64/librustsort.a（$(stat -c%s "$OUT") 字节）"
