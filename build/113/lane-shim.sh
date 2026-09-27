#!/usr/bin/env bash
# Octave-Full-Wasm — **车道旗标的 PATH 影子包装**（branch `threads`，2026-09-27）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

# 目的：给"**没有地方传编译旗标**"的 farm 脚本注入 `-pthread`（线程档的 atomics 要求），
# **一个仓库脚本都不用改**。本仓的 SIMD 车道就是这么干的（PATH 影子包装 `emf77`）。
#
# 为什么需要它（实测，见 `NOTES-threads.md` B5 与 `PLAN-arch.md` §2 B6）：
#   `-pthread` 要求 shared-memory 链上**每个对象**都声明 `atomics`；现役 farm（20+ 个库、
#   含 BLAS/LAPACK/fontconfig/freetype/gl4es/suitesparse…）**全部**缺 ⇒ 线程档必须整条重编。
#   而各库的构建脚本旗标点位五花八门（有的在 `CFLAGS=`、有的在 cmake、有的直接写在 emf77 命令行）
#   ⇒ 与其逐个改脚本（漏一处 = 那个库静默没有 atomics = 链接期才炸），不如包住编译器。
#
# 用法：
#   SHIM=$(bash build/113/lane-shim.sh -pthread)          # 建影子目录并**打印它的路径**
#   PATH="$SHIM:$PATH" LANE_FLAGS=-pthread PREFIX=/usr/local-threads \
#       bash build/113/build-deps.sh all                  # 该脚本自己认 LANE_FLAGS
#   PATH="$SHIM:$PATH" DEPS=/src/deps-threads bash build/113/build-libs.sh all   # 这个不认 ⇒ 靠影子
#
# 要点（都实测过）：
#   · 影子**必须解析成真实编译器的绝对路径**（写成相对路径或 `emcc` 会自递归）；
#   · 只包 wasm 编译器（`emcc`/`em++`/`emf77`）—— **不包宿主的 `cc`/`gcc`**：
#     那些是编 arithchk / fc-cache 之类**原生工具**用的，加 `-pthread` 没意义；
#   · `-pthread` 对 configure/cmake 的**探测**步骤也是无害的（它们本来就编+链小样例）。
set -euo pipefail

# `--selftest`：只证明"机制会红/会绿"，不需要真编译
if [ "${1:-}" = "--selftest" ]; then
  T="$(mktemp -d)"; mkdir -p "$T/fakebin" "$T/shim"
  printf '#!/bin/sh\necho "REAL-EMCC $*"\n' > "$T/fakebin/emcc"; chmod +x "$T/fakebin/emcc"
  cp "$T/fakebin/emcc" "$T/fakebin/em++"; cp "$T/fakebin/emcc" "$T/fakebin/emf77"
  n=0; bad=0
  ck () { n=$((n+1)); if eval "$2" >/dev/null 2>&1; then echo "PASS | $1"; else echo "fail | $1"; bad=$((bad+1)); fi; }
  # ① 影子建得出来，且**真的**把旗标注进去了（跑一次看命令行）
  out="$(PATH="$T/fakebin:$PATH" bash "$0" -pthread "$T/shim" 2>&1)"
  ck "① 建影子并打印目录" "[ "$out" = "$T/shim" ]"
  ck "② 影子把 -pthread 注进了命令行" "PATH=$T/shim:\$PATH $T/shim/emcc -c x.c | grep -q -- '-pthread -c x.c'"
  # ③ 反向：PATH 里只有影子自己（找不到真实编译器）必须 FATAL，不许自递归
  ck "③ 解析不到真实编译器 ⇒ 必须 FATAL（反证：不许自递归）" \
     "! PATH=$T/shim bash $0 -pthread $T/shim2"
  echo "=== lane-shim 自证：$((n-bad)) PASS / $bad fail ==="
  rm -rf "$T"; [ "$bad" = 0 ]
  exit $?
fi

FLAGS="${1:--pthread}"
DIR="${2:-/src/libwork/lane-shim}"
mkdir -p "$DIR"

# 真实编译器：在**去掉影子目录**的 PATH 里找（否则第二次跑会包住上一次的影子）
CLEAN_PATH="$(printf '%s' "$PATH" | tr ':' '\n' | grep -v "^$DIR\$" | paste -sd: -)"
for c in emcc em++ emf77; do
  real="$(PATH="$CLEAN_PATH" command -v "$c" || true)"
  [ -n "$real" ] || { echo "FATAL: PATH 里找不到 $c" >&2; exit 2; }
  case "$real" in "$DIR"/*) echo "FATAL: $c 解析到了影子自己（$real）" >&2; exit 2 ;; esac
  cat > "$DIR/$c" <<EOF
#!/bin/sh
# 车道影子：$c → $real，注入：$FLAGS
exec "$real" $FLAGS "\$@"
EOF
  chmod +x "$DIR/$c"
done
[ -f "$DIR/emcc" ] && [ -f "$DIR/emf77" ] || { echo "FATAL: 影子没建全" >&2; exit 2; }
# ⚠️ 自证要能证明"旗标**真的**进了命令行"，而不是只证明文件存在（"赋值了但没被引用"那类坑）
echo "$DIR"
