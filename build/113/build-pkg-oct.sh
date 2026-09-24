#!/usr/bin/env bash
#
# Forge 包的 src/*.cc → wasm side module（真 .oct）**按 11.3.0 重编**
#
# ── 为什么要重编（HISTORY §10.6 第 2 项）──────────────────────────────────
# `site113/assets/octdir/` 里的 27 个 .oct 是 **7.2 编的**。实测它们在 11.3.0 上
# 能装载能调用（accept-pkg 16/16、fminunc 可用），但跨大版本用旧 .oct 是 ABI 赌博
# （本轮的 `__ode15__`、gzip/zip 两个 trap 都是"装载能过、调用才炸"的先例）。
#
# ── 与 7.2 的 build/build_pkg_oct.sh 的三处实质差别 ────────────────────────
#   1. **不再跑包自带的 configure**。理由：它的探测在交叉编译下会选到老名字，
#      7.2 那时是靠事后 sed 纠正 config.h 才对的；而纠正后的值**就是我们要的**
#      （下面 `emit_config_h` 里逐条标了 11.3.0 头文件的出处）。既然值已确定，
#      直接合成 config.h，少一整圈 mkoctfile 垫片 + 交叉探测不确定性。
#      代价：新增宏要手写；收益：可复现、可审计、不依赖宿主工具。
#   2. **`HAVE_OCTAVE_ERROR_STATE` 不再定义** —— 11.3.0 里 `error_state` 已彻底
#      移除（`grep -rn error_state` 在整套安装头文件里 **0 命中**，实测）。
#      optim/struct 的源码里有它的分支，靠这个宏走另一条路。
#   3. **模块清单写死成一张表**（见 PKGS），不再靠"哪些文件含 DEFUN_DLD"自动分组。
#      原因：control 有 48 个 `sl_*.cc` + `__control_slicot_functions__.cc`，它们
#      要 Fortran 的 `slicotlibrary.a`，本仓**不建**（7.2 的站点里也没有这些产物）。
#      自动分组会去编它们、静默产出坏模块。写死清单 = 与现有站点**逐文件对齐**。
#
# ── config.h 逐条出处（11.3.0 安装头文件，实测 grep）────────────────────────
#   octave::execution_exception   error.h:47 前置声明 / :429 verror 形参用它
#   octave::vformat              utils.h:172（utils.h:44 OCTAVE_BEGIN_NAMESPACE(octave)）
#   interpreter::the_interpreter  interpreter.h:556
#   interpreter::feval            interpreter.h:381-400（成员函数）
#   interpreter::get_symbol_table interpreter.h:298
#   symbol_table::find_function   symtab.h:104,111（成员；symtab.h:49 进 octave 命名空间）
#   octave::identity_matrix       utils.h:163
#   octave::math::isnan           mappers.h（11.3.0 的 lo-mappers.h 只有 1.2KB，
#                                 是个转发壳，真实声明在 mappers.h，58 处 isnan）
#   octave_value::isstruct/iscell/ov.h:647 / :602
#   octave::rand_uniform          randmtzig.h:86
#
# 用法（容器内）：bash build-pkg-oct.sh <包名|all|list>
# 产物：/src/octs-pkg/<包名>/<模块名>.oct
#
set -euo pipefail

PREFIX="${PREFIX:-/src/work/octave-install}"
MV="${MV:-11.3.0}"
FORGE="${FORGE:-/src/libwork/forge}"
OUTROOT="${OUTROOT:-/src/octs-pkg}"
DEPS="${DEPS:-/src/deps}"
JOBS="${JOBS:-$(nproc)}"
export CCACHE_DIR="${CCACHE_DIR:-/ccache}"

INC=(-I"$PREFIX/include/octave-$MV" -I"$PREFIX/include/octave-$MV/octave"
     -I"$DEPS/qhull/include" -I"$DEPS/glpk/include" -I"$DEPS/fftw/include")
BASE=(-DHAVE_CONFIG_H -O2 -std=c++17 -fwasm-exceptions -fPIC "${INC[@]}")

# ---- 模块表：包 | 模块名 | 源码（相对 包/src/，空格分隔）| 额外旗标（可空）----
# 模块名 = **产物文件名**，Octave 按 `<函数名>.oct` 找模块，所以它必须等于
# 源码里 DEFUN_DLD 的函数名 —— 注意它**不一定等于源文件名**：
#   optim: `__bfgsmin.cc` 里是 `DEFUN_DLD(__bfgsmin, …)`，产物叫 `__bfgsmin.oct`
#   （单下划线）。第一版照抄源文件名写成 `__bfgsmin__`，是错的 —— 已核对过
#   站点上真实文件名是 `__bfgsmin.oct`。
# 与现有 site113/assets/octdir/ 的 27 个文件逐一对齐。
PKGS='
control|__control_helper_functions__|__control_helper_functions__.cc|
control|is_matrix|is_matrix.cc|
control|is_real_matrix|is_real_matrix.cc|
control|is_real_scalar|is_real_scalar.cc|
control|is_real_square_matrix|is_real_square_matrix.cc|
control|is_real_vector|is_real_vector.cc|
control|is_zp_vector|is_zp_vector.cc|
control|lti_input_idx|lti_input_idx.cc|
geometry|polybool_mrf|polybool_mrf.cc connector.cpp martinez.cpp polygon.cpp utilities.cpp|-D_LIBCPP_ENABLE_CXX17_REMOVED_UNARY_BINARY_FUNCTION
miscellaneous|cell2cell|cell2cell.cc|
miscellaneous|partint|partint.cc|
optim|__bfgsmin|__bfgsmin.cc error-helpers.cc|
optim|__disna_optim__|__disna_optim__.cc error-helpers.cc|
optim|__max_nargin_optim__|__max_nargin_optim__.cc error-helpers.cc|-include octave/interpreter.h -include octave/ov-usr-fcn.h -include octave/pt-misc.h
optim|numgradient|numgradient.cc error-helpers.cc|
optim|numhessian|numhessian.cc error-helpers.cc|
statistics|editDistance|editDistance.cc|
statistics|libsvmread|libsvmread.cc|
statistics|libsvmwrite|libsvmwrite.cc|
statistics|svmpredict|svmpredict.cc svm.cpp svm_model_octave.cc|
statistics|svmtrain|svmtrain.cc svm.cpp svm_model_octave.cc|
statistics|fcnntrain|fcnntrain.cc|
statistics|fcnnpredict|fcnnpredict.cc|
struct|cell2fields|cell2fields.cc error-helpers.cc|
struct|fieldempty|fieldempty.cc error-helpers.cc|
struct|fields2cell|fields2cell.cc error-helpers.cc|
struct|structcat|structcat.cc error-helpers.cc|
'

PKG_DIRS='
control|control-4.1.3
geometry|geometry-4.1.0
miscellaneous|miscellaneous-1.3.3
optim|optim-1.6.3
statistics|statistics-release-1.7.3
struct|struct-1.0.18
'

dir_of () { echo "$PKG_DIRS" | awk -F'|' -v p="$1" '$1==p{print $2}'; }

# ---- 合成 config.h（11.3.0 专用；已存在则不覆盖，保证可重入）----------------
emit_config_h () {
  local src="$1/src"
  [ -f "$src/config.h" ] && { echo "    config.h 已存在，不动"; return; }
  cat > "$src/config.h" <<'CFGEOF'
/* 由 build/113/build-pkg-oct.sh 合成。每个宏的出处见该脚本头部注释
   （都是对 11.3.0 安装头文件实测 grep 出来的，不是照抄 7.2）。
   ⚠️ 与 7.2 版的关键差别：**故意不定义 HAVE_OCTAVE_ERROR_STATE** ——
      11.3.0 已移除 error_state，定义了会让包去引用一个不存在的符号。 */
#define HAVE_INTTYPES_H 1
#define HAVE_MEMORY_H 1
#define HAVE_STDINT_H 1
#define HAVE_STDIO_H 1
#define HAVE_STDLIB_H 1
#define HAVE_STRINGS_H 1
#define HAVE_STRING_H 1
#define HAVE_SYS_STAT_H 1
#define HAVE_SYS_TYPES_H 1
#define HAVE_UNISTD_H 1
#define HAVE_FLOAT_H 1
#define HAVE_SQRT 1
#define HAVE__BOOL 1
#define STDC_HEADERS 1
#define HAVE_OCTAVE_VERROR_ARG_EXC 1
#define OCTAVE__EXECUTION_EXCEPTION octave::execution_exception
#define OCTAVE__VFORMAT octave::vformat
#define OCTAVE__FEVAL octave::interpreter::the_interpreter ()->feval
#define OCTAVE__IDENTITY_MATRIX octave::identity_matrix
#define OCTAVE__MATH__ISNAN octave::math::isnan
#define OCTAVE__INTERPRETER__SYMBOL_TABLE__FIND_FUNCTION octave::interpreter::the_interpreter ()->get_symbol_table ().find_function
#define OV_ISSTRUCT isstruct
#define OV_ISCELL iscell
#define OV_ISNUMERIC isnumeric
#define OCTAVE__RAND_UNIFORM octave::rand_uniform
CFGEOF
  echo "    合成 config.h（$(grep -cE '^#define' "$src/config.h") 个宏）"
}

build_one () {  # $1=包名 $2=模块名 $3=源文件列表（空格分隔） $4=额外旗标
  local pkg="$1" mod="$2" srcs="$3" extra="$4"
  local dir; dir="$(dir_of "$pkg")"
  local psrc="$FORGE/$dir/src"
  local out="$OUTROOT/$pkg"
  mkdir -p "$out"

  local objs=() s o ok=1
  # shellcheck disable=SC2086  # 故意拆词：$srcs/$extra 是空格分隔的简单串
  for s in $srcs; do
    [ -f "$psrc/$s" ] || { echo "  ✗ $pkg/$mod: 缺源文件 $s" >&2; return 1; }
    o="$out/$mod--$(basename "$s").o"
    # shellcheck disable=SC2086
    if ! ccache em++ "${BASE[@]}" -I"$psrc" $extra -c "$psrc/$s" -o "$o" 2> "$out/$mod--$(basename "$s").log"; then
      echo "  ✗ $pkg/$mod: 编译失败 $s" >&2
      grep -E "error:" "$out/$mod--$(basename "$s").log" | head -4 >&2
      ok=0
    fi
    objs+=("$o")
  done
  [ "$ok" = "1" ] || return 1

  if ccache em++ -sSIDE_MODULE=1 -fPIC -O2 -fwasm-exceptions -shared \
       -o "$out/$mod.oct" "${objs[@]}" 2> "$out/$mod.link.log"; then
    printf "  ✅ %-12s %-28s %s 字节\n" "$pkg" "$mod" "$(stat -c%s "$out/$mod.oct")"
  else
    echo "  ✗ $pkg/$mod 链接失败:" >&2; tail -4 "$out/$mod.link.log" >&2; return 1
  fi
}

if [ "${1:-}" = "list" ]; then
  echo "$PKGS" | awk -F'|' 'NF{printf "%-14s %s\n", $1, $2}'
  echo "共 $(echo "$PKGS" | grep -c '|') 个模块"
  exit 0
fi

WANT="${1:-all}"
ok=0; bad=0
seen_pkgs=""
while IFS='|' read -r pkg mod srcs extra; do
  [ -n "$pkg" ] || continue
  [ -n "$mod" ] || continue
  [ "$WANT" = "all" ] || [ "$WANT" = "$pkg" ] || continue
  dir="$(dir_of "$pkg")"
  [ -d "$FORGE/$dir" ] || { echo "FATAL: 没有 $FORGE/$dir" >&2; exit 2; }
  case " $seen_pkgs " in *" $pkg "*) ;; *) echo "=== $pkg（$dir）"; emit_config_h "$FORGE/$dir"; seen_pkgs="$seen_pkgs $pkg";; esac
  if build_one "$pkg" "$mod" "$srcs" "$extra"; then ok=$((ok+1)); else bad=$((bad+1)); fi
done <<< "$PKGS"

echo
echo "== 成功 $ok 个，失败 $bad 个 → $OUTROOT"
ls -R "$OUTROOT" 2>/dev/null | head -5
[ "$bad" -eq 0 ]
