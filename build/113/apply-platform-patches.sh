#!/usr/bin/env bash
#
# Octave 11.3.0 → wasm 平台补丁
#
# 出处：Edge-Tools/octave-wasm 的 build/Dockerfile（edgetools.io 的 GPL 对应源码，
#       Octave 11.1.0）。我们把它那 5 处 sed 抽成独立脚本，并加了三样它没有的东西：
#
#   1. **可离线跑、可重复跑**：不依赖 docker，源码树外无副作用，便于 review 与回滚
#   2. **每处都带守卫**：模式对不上就 **FATAL 退出**，绝不静默改错
#      （上游一改，宁可构建停在这里，也不要产出一个看着正常其实不对的 wasm）
#   3. **幂等**：已应用过的再跑只报「已应用（跳过）」，不会重复改
#
# 实测记录见 build/BASELINE-11.3.md §4.1 / §5：这 5 处模式对 11.3.0
# **5/5 命中**（configure ×2、getlocalename_l-unsafe.c、cxx-signal-helpers.cc、
# interpreter.cc）。
#
# 用法：
#   bash build/113/apply-platform-patches.sh <octave 源码目录>
#   bash build/113/apply-platform-patches.sh <octave 源码目录> \
#        --with-graphics <webgl-graphics-toolkit.cc 路径>
#
# 图形那一处（第 5 处）**默认不打**：P0 只求无头数值跑通，图形是 P5 的事。
# 分开也便于定位——P0 阶段任何失败都与图形无关。
#
set -euo pipefail

SRC=""
WITH_GRAPHICS=0
TOOLKIT_CC=""

while [ $# -gt 0 ]; do
  case "$1" in
    --with-graphics)
      WITH_GRAPHICS=1
      shift
      [ $# -gt 0 ] || { echo "FATAL: --with-graphics 还需要一个 toolkit .cc 路径" >&2; exit 2; }
      TOOLKIT_CC="$1"
      # 就地校验：所有参数问题都必须在**动任何文件之前**暴露，
      # 否则会出现「前 4 处已改、第 5 处才失败」的半打补丁状态。
      [ -f "$TOOLKIT_CC" ] || { echo "FATAL: 找不到 toolkit 源码 $TOOLKIT_CC" >&2; exit 2; }
      ;;
    -h|--help)
      sed -n '2,30p' "$0"
      exit 0
      ;;
    -*)
      echo "FATAL: 未知选项 $1" >&2
      exit 2
      ;;
    *)
      [ -z "$SRC" ] || { echo "FATAL: 只接受一个源码目录参数" >&2; exit 2; }
      SRC="$1"
      ;;
  esac
  shift
done

[ -n "$SRC" ] || { echo "FATAL: 缺少 <octave 源码目录>" >&2; exit 2; }
[ -d "$SRC" ] || { echo "FATAL: 不是目录：$SRC" >&2; exit 2; }

# 只认 11.3.0：别的版本守卫可能命中也可能不命中，但那不是我们实测过的组合
[ -f "$SRC/configure" ] && [ -d "$SRC/liboctave" ] || {
  echo "FATAL: $SRC 看起来不是 Octave 源码树（缺 configure 或 liboctave/）" >&2; exit 2; }

APPLIED=0
SKIPPED=0

die () { echo "FATAL: $*" >&2; exit 1; }
ok  () { echo "  $*"; }

echo "== Octave wasm 平台补丁 → $SRC"

# ---------------------------------------------------------------------------
# 1/5 · configure：允许静态构建
#   Octave 默认要求能建共享库；wasm 这里我们按静态走（.oct 另走 side module）。
#   本处是「整行删除」，删完就没有自己的标记串了，所以用「原串是否还在」判幂等。
# ---------------------------------------------------------------------------
if grep -qF 'Building shared libraries is required' "$SRC/configure"; then
  sed -i '/Building shared libraries is required/d' "$SRC/configure"
  grep -qF 'Building shared libraries is required' "$SRC/configure" \
    && die "1/5 configure：删除后字符串仍在"
  ok "1/5 configure：已去掉「必须能建共享库」的硬性检查"
  APPLIED=$((APPLIED+1))
else
  ok "1/5 configure：已应用（跳过）"
  SKIPPED=$((SKIPPED+1))
fi

# ---------------------------------------------------------------------------
# 2/5 · libgnu/getlocalename_l-unsafe.c：gnulib 不认识 emscripten
#   该函数在未知平台上是 #error；给它一个「C locale」的返回值即可。
#   要求返回类型与相邻分支一致：(struct string_with_storage){ name, STORAGE_* }
# ---------------------------------------------------------------------------
GNULIB_C="libgnu/getlocalename_l-unsafe.c"
[ -f "$SRC/$GNULIB_C" ] || die "2/5：找不到 $GNULIB_C"

if grep -qF 'STORAGE_INDEFINITE };' "$SRC/$GNULIB_C" \
   && ! grep -qF 'Please port gnulib getlocalename_l-unsafe.c' "$SRC/$GNULIB_C"; then
  ok "2/5 $GNULIB_C：已应用（跳过）"
  SKIPPED=$((SKIPPED+1))
elif grep -qE ' *#error "Please port gnulib getlocalename_l-unsafe\.c' "$SRC/$GNULIB_C"; then
  sed -i -E 's| *#error "Please port gnulib getlocalename_l-unsafe\.c.*|      return (struct string_with_storage) { "C", STORAGE_INDEFINITE };|' \
      "$SRC/$GNULIB_C"
  grep -qF 'Please port gnulib getlocalename_l-unsafe.c' "$SRC/$GNULIB_C" \
    && die "2/5 $GNULIB_C：替换后 #error 仍在"
  # 复核：这一行确实落在了 #else 分支里
  grep -qE '^ *return \(struct string_with_storage\) \{ "C", STORAGE_INDEFINITE \};$' "$SRC/$GNULIB_C" \
    || die "2/5 $GNULIB_C：替换文本没落成预期的返回语句"
  ok "2/5 $GNULIB_C：#error 已换成 C locale 返回值"
  APPLIED=$((APPLIED+1))
else
  die "2/5 $GNULIB_C：既没找到 #error，也没有已应用的证据 → 上游已改动，需人工核对"
fi

# ---------------------------------------------------------------------------
# 3/5 · liboctave/wrappers/cxx-signal-helpers.cc：信号包装器不认 emscripten
#   顶层条件编译 #if ! defined (__WIN32__) 里假定是 POSIX 信号语义；
#   追加 && ! defined (__EMSCRIPTEN__) 让它走别的分支。
#   注意：本处与 emscripten-forge 的 patch 0017「Adapt-signal-wrappers」是
#   同一个文件、同一个意图（两者互相印证），但 0017 更彻底（另改 signal-wrappers.c）。
#   若 11.3.0 上单靠本处不够，回去看 0017。
# ---------------------------------------------------------------------------
SIG_C="liboctave/wrappers/cxx-signal-helpers.cc"
[ -f "$SRC/$SIG_C" ] || die "3/5：找不到 $SIG_C"

if grep -qF '__EMSCRIPTEN__' "$SRC/$SIG_C"; then
  ok "3/5 $SIG_C：已应用（跳过）"
  SKIPPED=$((SKIPPED+1))
elif grep -qE '^#if ! defined \(__WIN32__\)$' "$SRC/$SIG_C"; then
  sed -i -E 's|^#if ! defined \(__WIN32__\)$|#if ! defined (__WIN32__) \&\& ! defined (__EMSCRIPTEN__)|' \
      "$SRC/$SIG_C"
  grep -qF '__EMSCRIPTEN__' "$SRC/$SIG_C" || die "3/5 $SIG_C：改动未生效"
  ok "3/5 $SIG_C：条件编译已排除 __EMSCRIPTEN__"
  APPLIED=$((APPLIED+1))
else
  die "3/5 $SIG_C：找不到 ^#if ! defined (__WIN32__)$ → 上游已改动，需人工核对"
fi

# ---------------------------------------------------------------------------
# 4/5 · configure：Qt/FLTK 两者都不建时的那段失败分支，改成永不进入
#   （我们根本没有 GUI toolkit；Step 5 的 webgl toolkit 顶替它）
# ---------------------------------------------------------------------------
if grep -qF 'build_qt_gui = no && test' "$SRC/configure"; then
  sed -i -E 's|^.*build_qt_gui = no && test .*build_fltk_graphics = no.*then$|if false; then|' "$SRC/configure"
  grep -qF 'build_qt_gui = no && test' "$SRC/configure" \
    && die "4/5 configure：替换后原条件仍在（可能该行不止一处，需人工看）"
  ok "4/5 configure：Qt/FLTK 缺失的失败分支已改为 if false"
  APPLIED=$((APPLIED+1))
else
  ok "4/5 configure：已应用（跳过）"
  SKIPPED=$((SKIPPED+1))
fi

# ---------------------------------------------------------------------------
# 5/5 · 图形：webgl toolkit（默认不打，P5 才需要）
#   做法与 Edge-Tools 一致：把 toolkit 的 .cc **追加**到 gl-render.cc 末尾
#   （它要用 gl-render.cc 里的内部类型），再在 interpreter::initialize() 里
#   注入一次 install 调用。
# ---------------------------------------------------------------------------
if [ "$WITH_GRAPHICS" -eq 1 ]; then
  [ -n "$TOOLKIT_CC" ] || die "5/5：--with-graphics 需要给 toolkit .cc 路径"
  [ -f "$TOOLKIT_CC" ] || die "5/5：找不到 toolkit 源码 $TOOLKIT_CC"

  GLRENDER="libinterp/corefcn/gl-render.cc"
  INTERP="libinterp/corefcn/interpreter.cc"
  [ -f "$SRC/$GLRENDER" ] || die "5/5：找不到 $GLRENDER"
  [ -f "$SRC/$INTERP" ]   || die "5/5：找不到 $INTERP"

  if grep -qF 'install_webgl_graphics_toolkit' "$SRC/$GLRENDER"; then
    ok "5/5 $GLRENDER：toolkit 已追加（跳过）"
    SKIPPED=$((SKIPPED+1))
  else
    printf '\n\n/* ---- webgl graphics toolkit ----\n * 来源：Edge-Tools/octave-wasm 的\n * build/octave-patches/webgl-graphics-toolkit.cc（GPL-3.0-or-later），\n * 逐字节照搬，见 build/BASELINE-11.3.md §4.4。\n */\n' >> "$SRC/$GLRENDER"
    cat "$TOOLKIT_CC" >> "$SRC/$GLRENDER"
    grep -qF 'install_webgl_graphics_toolkit' "$SRC/$GLRENDER" || die "5/5：追加后仍找不到符号"
    ok "5/5 $GLRENDER：toolkit 已追加（+$(wc -c <"$TOOLKIT_CC") 字节）"
    APPLIED=$((APPLIED+1))
  fi

  if grep -qF 'install_webgl_graphics_toolkit (*this)' "$SRC/$INTERP"; then
    ok "5/5 $INTERP：install 调用已注入（跳过）"
    SKIPPED=$((SKIPPED+1))
  elif grep -qE '^  initialize_load_path \(\);$' "$SRC/$INTERP"; then
    sed -i -E 's|^  initialize_load_path \(\);$|  initialize_load_path ();\n  { extern void install_webgl_graphics_toolkit (interpreter\&); install_webgl_graphics_toolkit (*this); }|' \
        "$SRC/$INTERP"
    grep -qF 'install_webgl_graphics_toolkit (*this)' "$SRC/$INTERP" || die "5/5：注入未生效"
    ok "5/5 $INTERP：已注入 install_webgl_graphics_toolkit (*this)"
    APPLIED=$((APPLIED+1))
  else
    die "5/5 $INTERP：找不到 ^  initialize_load_path ();$ → 上游已改动，需人工核对"
  fi
else
  ok "5/5 图形 toolkit：跳过（未给 --with-graphics；P0 只求无头数值）"
  SKIPPED=$((SKIPPED+1))
fi

echo "== 完成：改动 $APPLIED 处，跳过 $SKIPPED 处"
echo "   复核建议：git -C $SRC diff --stat"
