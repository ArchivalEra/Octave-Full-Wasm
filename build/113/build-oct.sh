#!/usr/bin/env bash
#
# 把 dldfcn/*.cc 编成 wasm **side module**（真 .oct，运行期 dlopen 装载）
#
# 与 7.2 的 build/build_oct.sh 同一条路，但按 11.3.0 调整：
#   - C++17（11.3.0 要求），emscripten 5.0.7 没有 -enable-emscripten-cxx-exceptions 老旗标
#   - **-fwasm-exceptions**：必须与主模块同一套异常模型（JS 式异常会引入
#     invoke_*/__cxa_* 这些只在 JS 胶水里的符号，side module 解析不到 →
#     "could not load dynamic lib … TypeError: Cannot read properties of undefined"）
#   - 链接用 -sSIDE_MODULE=1 且**不链任何库**：所有符号由主模块在 dlopen 时解析
#     （所以主模块必须把 glpk/qhull_r/sndfile 等一并链进去，见 link-web.sh 的注释）
#   - 头文件用**安装树**的（$INST/include/octave-11.3.0），另加构建树取 config.h
#
# 用法（容器内）：bash build-oct.sh <模块名...>    例如 build-oct.sh convhulln gzip
# 输出：$OUT/<模块名>.oct（默认 /src/octs）
#
# ---- 「自带第三方静态库」的模块：只有 __ode15__（SUNDIALS）一个 --------------
# 绝大多数 dldfcn 的第三方符号（qhull/glpk/sndfile…）由**主模块**在 dlopen 时解析，
# 所以这里不链任何库。例外是 SUNDIALS：它**不在主 wasm 里**（也不该进去——
# 主 wasm 一个字节都别动），静态码整个打进 .oct，产物自包含。
# 这类模块靠三个环境变量开口子（都是空格分隔、无嵌套空格的简单旗标）：
#   OCT_DEFS 额外的 -D 门禁。注意 config.h 里 sundials 的宏**全是 `/* #undef */`
#            纯注释**（`HAVE_SUNDIALS` 在 11.3.0 的 config.h:2233 就是如此），
#            所以命令行 -D 直接就能打开，**不需要重跑 configure**。
#   OCT_INCS 额外的 -I
#   OCT_LIBS 额外要链的静态库；**放在链接命令行、且必须排在 .o 之后**
#            （否则归档成员一个都拉不进来）
set -euo pipefail

OCT="${OCT:-/src/work/octave-11.3.0}"
INST="${INST:-/src/work/octave-install}"
OUT="${OUT:-/src/octs}"
MV="11.3.0"
export CCACHE_DIR="${CCACHE_DIR:-/ccache}"
mkdir -p "$OUT"

[ $# -gt 0 ] || { echo "用法: build-oct.sh <模块名...>" >&2; exit 2; }

FLAGS=(
  -DHAVE_CONFIG_H
  -I. -I"$OCT" -I"$OCT"/liboctave -I"$OCT"/liboctave/array
  -I"$OCT"/liboctave/numeric -I"$OCT"/liboctave/operators
  -I"$OCT"/liboctave/system -I"$OCT"/liboctave/util
  -I"$OCT"/liboctave/wrappers
  -I"$OCT"/libinterp -I"$OCT"/libinterp/octave-value
  -I"$OCT"/libinterp/operators -I"$OCT"/libinterp/parse-tree
  -I"$OCT"/libinterp/corefcn
  -I"$INST/include/octave-$MV" -I"$INST/include/octave-$MV/octave"
  # 各库的独立 prefix（② 建的）——dldfcn 的源要 include 它们的头
  # （实测：漏掉时 convhulln 报 'libqhull_r/libqhull_r.h' file not found）
  -I/src/deps/qhull/include -I/src/deps/glpk/include -I/src/deps/sndfile/include
  -I/src/deps/fftw/include -I/src/deps/suitesparse/include -I/src/deps/hdf5/include
  -I/src/deps/zlibbz2/include -I/src/deps/arpack/include -I/src/deps/rapidjson/include
  -I/usr/local/include
  -I/src/vendor/stb          # webimage.cc 用 stb_image / stb_image_write（header-only）
  -std=c++17 -O2 -fwasm-exceptions -fPIC
)

# 额外门禁 / 头 / 库（见文件头的说明；默认全空 → 与老行为逐字节一致）
# shellcheck disable=SC2206  # 故意按 IFS 拆词：这些都是「无嵌套空格的旗标串」
EXTRA=( ${OCT_DEFS:-} ${OCT_INCS:-} )
EXTRA_LIBS=( ${OCT_LIBS:-} )

# ---- 我们自己的 .cc（不是 Octave 的 dldfcn）也走同一条路 -------------------
# 用法：OUT=/src/octs CC_SRCS="webio:/src/websrc/webio.cc webimage:/src/websrc/webimage.cc" \
#        bash build-oct.sh --cc
# 这些模块导出的是 __web_*__，靠 manifest 的 aliases 建符号链接才挂得上名字。
if [ "${1:-}" = "--cc" ]; then
  : "${CC_SRCS:?用法: CC_SRCS=\"名字:/路径.cc 名字:/路径.cc\" bash build-oct.sh --cc}"
  n=0; bad=0
  for spec in $CC_SRCS; do
    name="${spec%%:*}"; src="${spec#*:}"
    [ -f "$src" ] || { echo "  ✗ $name: 没有 $src" >&2; bad=$((bad+1)); continue; }
    if ccache em++ "${FLAGS[@]}" -c "$src" -o "$OUT/$name.oct.o" 2> "$OUT/$name.cxx.log"; then
      ccache em++ -sSIDE_MODULE=1 -fPIC -O2 -fwasm-exceptions -shared \
          -o "$OUT/$name.oct" "$OUT/$name.oct.o" 2> "$OUT/$name.link.log" \
        && { printf "  ✅ %-16s %s 字节\n" "$name" "$(stat -c%s "$OUT/$name.oct")"; n=$((n+1)); } \
        || { echo "  ✗ $name 链接失败:" >&2; tail -4 "$OUT/$name.link.log" >&2; bad=$((bad+1)); }
    else
      echo "  ✗ $name 编译失败:" >&2; grep -E "error:" "$OUT/$name.cxx.log" | head -4 >&2; bad=$((bad+1))
    fi
  done
  echo "== 成功 $n 个，失败 $bad 个 → $OUT"
  exit $(( bad > 0 ))
fi

cd "$OCT"
ok=0; bad=0
for m in "$@"; do
  src="$OCT/libinterp/dldfcn/$m.cc"
  if [ ! -f "$src" ]; then echo "  ✗ $m: 没有 $src" >&2; bad=$((bad+1)); continue; fi
  if ccache em++ "${FLAGS[@]}" "${EXTRA[@]}" -c "$src" -o "$OUT/$m.oct.o" 2> "$OUT/$m.cxx.log"; then
    ccache em++ -sSIDE_MODULE=1 -fPIC -O2 -fwasm-exceptions -shared \
        -o "$OUT/$m.oct" "$OUT/$m.oct.o" "${EXTRA_LIBS[@]}" 2> "$OUT/$m.link.log" \
      && { printf "  ✅ %-16s %s 字节\n" "$m" "$(stat -c%s "$OUT/$m.oct")"; ok=$((ok+1)); } \
      || { echo "  ✗ $m 链接失败:" >&2; tail -4 "$OUT/$m.link.log" >&2; bad=$((bad+1)); }
  else
    echo "  ✗ $m 编译失败:" >&2; grep -E "error:" "$OUT/$m.cxx.log" | head -4 >&2; bad=$((bad+1))
  fi
done

echo "== 成功 $ok 个，失败 $bad 个 → $OUT"
[ "$bad" -eq 0 ]
