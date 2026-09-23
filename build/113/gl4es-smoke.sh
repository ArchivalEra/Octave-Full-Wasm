#!/usr/bin/env bash
#
# 图形线 WebGL 步骤① 的构建：把 build/113/gl4es-smoke.c 用 gl4es 编成 wasm（浏览器里跑）
#
# 与 OSMesa 那版的关键差异：**必须有 canvas**，所以产出是"网页"而不是"node 脚本"；
# 运行交给 `test/browser/probe-gl4es-smoke.mjs`（headless Chromium）。
#
# 用法（容器内）：bash gl4es-smoke.sh [gl4es源码根] [gl4es构建产出根]
#   默认 GL4ES_SRC=/src/libwork/gl4es-src（可写副本；只读的 /src/vendor 那份建不了，
#   因为 gl4es 的 CMake 把 libGL.a 写到源码树里的 lib/）
set -euo pipefail

GL4ES_SRC="${1:-/src/libwork/gl4es-src}"
GL4ES_BUILD="${2:-/src/libwork/gl4es-build}"
OUT="${OUT:-/src/deps/gl4es/smoke}"

GL4ES_A="$GL4ES_SRC/lib/libGL.a"
[ -f "$GL4ES_A" ] || { echo "FATAL: 没有 $GL4ES_A（先建 gl4es：见 NOTES-webgl.md §3.1）" >&2; exit 2; }
[ -d "$GL4ES_SRC/include" ] || { echo "FATAL: 没有 $GL4ES_SRC/include" >&2; exit 2; }

mkdir -p "$OUT"

echo "== 编译 + 链接 gl4es-smoke → $OUT"
# ★ 四个要点（缺一个就白干）：
#   1. `-I$GL4ES_SRC/include` **必须**在其它 GL 头之前 —— gl4es 的 <GL/gl.h> 会把
#      `glBegin` 之类 `#define` 成 `gl4es_glBegin`（见 gl4es-smoke.c 的文件头）。
#      指错头文件的话调用会落到真 GLES2 上，而 GLES2 没有固定管线。
#   2. **gl4es 的归档必须用「绝对路径」，不能用 `-lGL`** —— 实测 `-lGL` 会被 emcc
#      改写进它**自带的 GL 仿真库**（`sysroot/lib/wasm32-emscripten/libGL-emu-*.a`），
#      于是我们那份 `libGL.a` 根本没被搜索，报一堆
#      `undefined symbol: gl4es_glBegin`。这与本项目在 `-lGLU` 上踩的是同一个坑
#      （见 NOTES-p5-osmesa.md §7.3 第 3 条），一律绝对路径。
#   3. `-sFULL_ES2=1` —— gl4es 的 COMPILE.md 明确要求；真 GLES2 入口与其
#      `emscripten_GetProcAddress()` 由它带进来。
#   4. `#canvas` 那个 DOM 元素由本脚本生成的 index.html 提供（WebGL 与 OSMesa 的
#      最大形态差异：**必须有绘制目标 canvas**）。
emcc "$(dirname "$0")/gl4es-smoke.c" -o "$OUT/gl4es-smoke.js" \
  -I"$GL4ES_SRC/include" \
  "$GL4ES_A" \
  -sFULL_ES2=1 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sEXIT_RUNTIME=1 \
  -O1 \
  > "$OUT/build.log" 2>&1 \
  || { echo "FATAL: 链接失败，见 $OUT/build.log" >&2; tail -30 "$OUT/build.log" >&2; exit 3; }

# 网页外壳：gl4es-smoke.c 里用的是 `#canvas`
cat > "$OUT/index.html" <<'HTML'
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>gl4es + WebGL2 smoke</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:16px}
#canvas{border:1px solid #999;image-rendering:pixelated;width:320px;height:320px}
pre{background:#f6f6f6;padding:8px;white-space:pre-wrap}</style>
</head>
<body>
<h1>图形线 WebGL 步骤①：gl4es + WebGL2</h1>
<p>下面这个 canvas 是 gl4es 的绘制目标（64×64，CSS 放大到 320 显示）。</p>
<canvas id="canvas" width="64" height="64"></canvas>
<pre id="out">启动中…</pre>
<script>
  // emscripten 的 printf 会走 console；这里顺手镜像到页面，便于人工看
  const orig = console.log.bind(console);
  console.log = (...a) => { orig(...a);
    const el = document.getElementById('out');
    el.textContent += a.join(' ') + '\n'; };
  window.addEventListener('error', e => { console.log('[error] ' + e.message); });
</script>
<script src="gl4es-smoke.js"></script>
</body>
</html>
HTML

echo "  产物 $OUT/gl4es-smoke.js（$(stat -c%s "$OUT/gl4es-smoke.js" 2>/dev/null) 字节）"
echo "        $OUT/gl4es-smoke.wasm（$(stat -c%s "$OUT/gl4es-smoke.wasm" 2>/dev/null) 字节）"
echo "        外壳 $OUT/index.html"
echo
echo "运行：用 test/browser/probe-gl4es-smoke.mjs 在 headless Chromium 里打开它"
