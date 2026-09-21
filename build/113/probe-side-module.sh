#!/usr/bin/env bash
#
# 闸门二 · 廉价探针：emsdk 5.0.7 还支不支持 MAIN_MODULE=1 + SIDE_MODULE=1（真 dlopen）
#
# 为什么不直接拿 Octave 试：Octave 那棵树编一次是分钟到十分钟级，而这个探针
# **完全不碰 Octave**，三十秒内就能回答同一个问题。先问便宜的，再决定要不要
# 把整棵树按 PIC/MAIN_MODULE 重配。
#
# 依据（我们 7.2 上验证过的配方，见 build/CLIBS.md「真 .oct 动态装载」）：
#   主模块  -sMAIN_MODULE=1 -sALLOW_TABLE_GROWTH=1 -fPIC
#   side    -sSIDE_MODULE=1 -fPIC -shared，且**不链任何库**（符号由主模块解析）
#   .oct 就是 side module 这条路。
#
# 判据（唯一）：主模块里 dlopen 打开 side 模块 → dlsym 取到它的函数 →
# 调它 → 它能回调主模块导出的函数 → 得到 43。
# 只打印 43 算过；任何一步失败都算不过，并把 dlerror 原文打出来。
#
# 用法：  bash probe-side-module.sh          （在当前目录建 probe-113/ 干活）
# 退出码：0 = 通过；非 0 = 不通过（原因见输出）
#
set -euo pipefail

WORK="${WORK:-/src/work/probe-113}"
rm -rf "$WORK"; mkdir -p "$WORK"; cd "$WORK"

command -v emcc >/dev/null || { echo "FATAL: 没有 emcc" >&2; exit 2; }

echo "== emsdk: $(emcc --version 2>/dev/null | head -1)"

# ---- side module：只引用主模块的符号，自己不链任何库 ------------------------
cat > side.c <<'EOF'
extern int base_value (void);   /* 由主模块提供 */
int g (void) { return base_value () + 1; }
EOF

# ---- 主模块：导出 base_value，并 dlopen side 模块 ---------------------------------
cat > main.c <<'EOF'
#include <stdio.h>
#include <dlfcn.h>
#include <emscripten.h>

EMSCRIPTEN_KEEPALIVE int base_value (void) { return 42; }

int main (void) {
  const char *path = "/side.wasm";
  void *h = dlopen (path, RTLD_NOW);
  if (!h) { printf ("PROBE-FAIL dlopen: %s\n", dlerror ()); return 1; }

  int (*g) (void) = (int (*) (void)) dlsym (h, "g");
  if (!g) { printf ("PROBE-FAIL dlsym: %s\n", dlerror ()); return 2; }

  int r = g ();
  printf ("PROBE-RESULT %d\n", r);
  return (r == 43) ? 0 : 3;   /* base_value()=42, g()=42+1 */
}
EOF

echo "== 编 side module（-sSIDE_MODULE=1 -fPIC -shared，不链库）"
emcc side.c -o side.wasm -sSIDE_MODULE=1 -fPIC -shared -O0 2>&1 | tail -3
[ -f side.wasm ] || { echo "PROBE-FAIL: side.wasm 没产出"; exit 4; }
echo "   side.wasm $(stat -c%s side.wasm) 字节"

echo "== 编主模块（-sMAIN_MODULE=1 -sALLOW_TABLE_GROWTH=1 -fPIC）"
emcc main.c -o main.js \
  -sMAIN_MODULE=1 -sALLOW_TABLE_GROWTH=1 -fPIC -O0 \
  -sERROR_ON_UNDEFINED_SYMBOLS=0 \
  -sFORCE_FILESYSTEM=1 \
  --preload-file side.wasm@/side.wasm \
  2>&1 | tail -5
[ -f main.js ] || { echo "PROBE-FAIL: main.js 没产出"; exit 5; }

echo "== 跑（node）"
set +e
out="$(node main.js 2>&1)"
rc=$?
set -e
echo "$out" | tail -10

if [ "$rc" -eq 0 ] && grep -q "PROBE-RESULT 43" <<<"$out"; then
  echo
  echo "PROBE-PASS：emsdk $(emcc --version 2>/dev/null | head -1 | awk '{print $NF}') 的"
  echo "            MAIN_MODULE=1 + SIDE_MODULE=1 可用 → .oct 车道可以走这条路"
  exit 0
fi
echo
echo "PROBE-FAIL（node 退出码 $rc）：这条 emsdk 上 side module 走不通，"
echo "           不要自己死磕，按计划停下来出问题单"
exit 1
