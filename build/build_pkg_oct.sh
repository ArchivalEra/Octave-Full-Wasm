#!/bin/sh
# Octave-Full-Wasm — 把 Forge 包的 src/*.cc 编成 .oct（wasm side module）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 用法（容器内）：build_pkg_oct.sh <包目录> <输出目录>
#   包目录 = 解包后的 Forge 包（含 src/、inst/）
#   产物   = <输出目录>/<name>.oct，可直接作为 kind=octdir 资产加载
#
# 与 mkoctfile 的对应关系：mkoctfile 干的是「编 .cc + 链 helper .o + 链 octave 库」。
# 我们这里：
#   * 含 DEFUN_DLD/DEFUN 的源 → 各成一个 .oct；
#   * 其余 .cc（error-helpers.cc 之类）→ 作为 helper 链进每个 .oct；
#   * **不链任何 octave 库**——符号由主模块在 dlopen 时解析（同 build_oct.sh）。
set -e
PKG=$(cd "$1" && pwd)
OUT=${2:-/octs-pkg}
SRC="$PKG/src"
PREFIX=/usr/src/octave-wasm/target

[ -d "$SRC" ] || { echo "没有 src/：$PKG" >&2; exit 1; }
mkdir -p "$OUT"

export PATH=/usr/src/emsdk:/usr/src/emsdk/upstream/emscripten:/usr/src/emsdk/node/14.18.2_64bit/bin:$PATH

# 关键坑（试过 --host 无效）：这些包的 configure.ac **没有 AC_CANONICAL_HOST**，
# 所以 `--host=` 只是被静默忽略，configure 仍按本地编译走，于是 autoconf 的
# "编译器能不能造可执行文件"自检会尝试**运行** wasm 产物 —— 容器 Node 14 跑不了，
# 直接报 "C++ compiler cannot create executables"。
# （emsdk 3.1.24 里 EMCONFIGURE_JS 已废弃，靠它也没用。）
# 解：给生成的 configure 打一行补丁，让 cross_compiling 可被环境变量置为 yes ——
# 这就是 Octave 自己 configure 的效果：交叉编译模式下 autoconf 跳过所有 run-test。
#
# 包自带的 configure 依赖 mkoctfile（只用来查编译旗标）。我们装出来的
# mkoctfile-7.2.0 是坏脚本（变量没替换，跑起来报 "//: Is a directory"），
# 所以这里放一个**垫片**：只回答 -p 查询，真正的编译由本脚本负责。
SHIM=/opt/mkoctfile-shim
mkdir -p $SHIM
cat > $SHIM/mkoctfile <<SHIMEOF
#!/bin/sh
PREFIX=/usr/src/octave-wasm/target
INC="-I\$PREFIX/include -I\$PREFIX/include/octave-7.2.0/octave"
case "\$1" in
  -p) case "\$2" in
        ALL_CXXFLAGS|CXXFLAGS) echo "-std=c++11 -fwasm-exceptions -fPIC \$INC" ;;
        ALL_CFLAGS|CFLAGS)     echo "-fPIC \$INC" ;;
        ALL_LDFLAGS|LFLAGS)    echo "-s ERROR_ON_UNDEFINED_SYMBOLS=0 -L\$PREFIX/lib -L\$PREFIX/lib/octave/7.2.0" ;;
        OCTAVE_LIBS|LIBS)      echo "-loctinterp -loctave" ;;
        INCFLAGS|ALL_INCFLAGS) echo "\$INC" ;;
        # 注意：包的 configure 会用 mkoctfile -p CXX 覆盖掉我们传的 CXX，
        # 所以这里必须回包装器路径（emxx 会补 autoconf 期待的 a.out），否则
        # "C++ compiler cannot create executables" 又回来了。
        CXX) echo /opt/mkoctfile-shim/emxx ;; CC) echo emcc ;; AR) echo emar ;; RANLIB) echo emranlib ;;
        PREFIX|OCTAVE_PREFIX) echo "\$PREFIX" ;;
        *) echo "" ;;
      esac ;;
  --version) echo "7.2.0" ;;
  *) exit 0 ;;
esac
SHIMEOF
cat > $SHIM/octave-config <<SHIMEOF
#!/bin/sh
PREFIX=/usr/src/octave-wasm/target
case "\$1" in
  -p) case "\$2" in
        VERSION) echo "7.2.0" ;;
        API_VERSION) echo "57" ;;
        OCTINCLUDEDIR|INCLUDEDIR) echo "\$PREFIX/include/octave-7.2.0" ;;
        OCTLIBDIR|LIBDIR) echo "\$PREFIX/lib/octave/7.2.0" ;;
        OCTDATADIR|DATADIR) echo "\$PREFIX/share/octave/7.2.0" ;;
        PREFIX|OCTAVE_HOME) echo "\$PREFIX" ;;
        *) echo "" ;;
      esac ;;
  --version) echo "7.2.0" ;;
  --api-version) echo "57" ;;
  *) exit 0 ;;
esac
SHIMEOF
# 第二个坑：emcc 不带 -o 时产出 a.out.js，而 autoconf 的编译器自检找的是 `a.out`，
# 找不到就判"C++ compiler cannot create executables"。垫一个 CXX 包装器补上这个文件
# （指向 node 跑 a.out.js 的 shell 脚本；交叉编译模式下 autoconf 只查存在性、不会真跑）。
cat > $SHIM/emxx <<SHIMEOF
#!/bin/sh
EMXX=/usr/src/emsdk/upstream/emscripten/em++
NODE=/usr/src/emsdk/node/14.18.2_64bit/bin/node
case " \$* " in
  *" -o "*|*" -c "*|*" -E "*|*" -S "*) exec \$EMXX "\$@" ;;
esac
\$EMXX "\$@"; rc=\$?
if [ -f a.out.js ]; then
  printf '#!/bin/sh\nexec "%s" "%s/a.out.js" "\$@"\n' "\$NODE" "\$PWD" > a.out
  chmod +x a.out
fi
exit \$rc
SHIMEOF
chmod +x $SHIM/mkoctfile $SHIM/octave-config $SHIM/emxx
export PATH=$SHIM:$PATH

PKGLOG=${PKGLOG:-/tmp/pkg-conf.log}
echo "--- [$PKG] 生成 config.h（跑包自带 configure，只要头文件）→ 日志 $PKGLOG"
if [ ! -f "$SRC/configure" ]; then
  if grep -q "config\.h" "$SRC"/*.c* 2>/dev/null; then
    echo "    包里没有 configure，但源码依赖 config.h —— 生成最小 config.h"
    : > "$SRC/config.h"
  else
    echo "    包里没有 configure，源码也不依赖 config.h —— 跳过（无需生成）"
  fi
fi
if [ -f "$SRC/configure" ] && [ ! -f "$SRC/config.h" ]; then
  sed -i 's/^cross_compiling=no$/cross_compiling=${CROSS_COMPILING:-no}/' "$SRC/configure"
  ( cd "$SRC" && CROSS_COMPILING=yes CC=emcc CXX=$SHIM/emxx AR=emar RANLIB=emranlib \
      EMCONFIGURE_JS=1 BUILD_EXEEXT=.js EMCC_FORCE_STDLIBS=1 \
      CPPFLAGS="-I$PREFIX/include -I$PREFIX/include/octave-7.2.0/octave" \
      CXXFLAGS="-std=c++11 -fwasm-exceptions -fPIC" \
      LDFLAGS="-s ERROR_ON_UNDEFINED_SYMBOLS=0 -L$PREFIX/lib -L$PREFIX/lib/octave/7.2.0" \
      ./configure > "${PKGLOG:-/tmp/pkg-conf.log}" 2>&1 ) \
      || echo "    （configure 非零退出，看 $PKGLOG）"
fi
# 第三个坑：交叉编译模式下这些包的新旧 API 探测会判错（选到老式符号），
# 按**本仓实际装出来的 Octave 7.2 头文件**纠正。依据（逐条实测）：
#   octave/error.h:434   verror (octave::execution_exception&, const char*, va_list)  → 非 const 引用
#   octave/error.h:577   extern OCTINTERP_API int error_state;                        → 存在
#   octave/utils.h:175   octave::vformat (std::ostream&, const char*, va_list)        → 存在
#   octave/octave-value/ov.h                                                          → octave_value::isstruct()
# 同一批纠正里还有一组 Olaf-Till 套件的 OCTAVE__* 宏（feval / isnan / identity_matrix /
# symbol_table::find_function）——它们在 Octave 7.2 都变成了命名空间内或解释器成员，
# 而交叉模式下的探测全选了老式全局名。依据（逐条实测 header）：
#   interpreter.h:381-400  feval 是 octave::interpreter 的**成员**（不再是全局函数）
#   lo-mappers.h:178-182   isnan 在 octave::math 命名空间
#   utils.h                identity_matrix 在 octave:: 命名空间
#   symtab.h:105-115       find_function 是 symbol_table 的**成员**（不再有静态版）
#   另有 OV_* 一族：octave_value 的谓词在 7.2 去掉了下划线（isstruct/iscell），
#   而交叉模式的探测仍选到下划线的老名。
# 兜底：包的 configure 在交叉环境下仍可能失败（它会用 mkoctfile 覆盖 CXX、
# 或要求 GNU Units 之类的宿主程序）。失败时直接合成 config.h —— 内容就是上面
# 那套**按本仓头文件实测纠正过**的宏，语义与正确跑完 configure 等价。
if [ ! -f "$SRC/config.h" ]; then
  echo "    configure 未产出 config.h —— 按实测值合成"
  cat > "$SRC/config.h" <<CFGEOF
/* 合成于 build/build_pkg_oct.sh：值取自本仓装出的 Octave 7.2 头文件 */
#define HAVE_INTTYPES_H 1
#define HAVE_MEMORY_H 1
#define HAVE_STDINT_H 1
#define HAVE_STDLIB_H 1
#define HAVE_STRINGS_H 1
#define HAVE_STRING_H 1
#define HAVE_SYS_STAT_H 1
#define HAVE_SYS_TYPES_H 1
#define HAVE_UNISTD_H 1
#define STDC_HEADERS 1
#define HAVE_OCTAVE_ERROR_STATE 1
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
fi

if [ -f "$SRC/config.h" ]; then
sed -i \
  -e 's/^#define OCTAVE__EXECUTION_EXCEPTION octave_execution_exception$/#define OCTAVE__EXECUTION_EXCEPTION octave::execution_exception/' \
  -e 's/^#define OCTAVE__VFORMAT octave_vformat$/#define OCTAVE__VFORMAT octave::vformat/' \
  -e 's/^#define OV_ISSTRUCT is_map$/#define OV_ISSTRUCT isstruct/' \
  -e 's/^#define OV_ISCELL is_cell$/#define OV_ISCELL iscell/' \
  -e 's/^#define OCTAVE__FEVAL feval$/#define OCTAVE__FEVAL octave::interpreter::the_interpreter ()->feval/' \
  -e 's/^#define OCTAVE__IDENTITY_MATRIX identity_matrix$/#define OCTAVE__IDENTITY_MATRIX octave::identity_matrix/' \
  -e 's/^#define OCTAVE__MATH__ISNAN xisnan$/#define OCTAVE__MATH__ISNAN octave::math::isnan/' \
  -e 's/^#define OCTAVE__INTERPRETER__SYMBOL_TABLE__FIND_FUNCTION symbol_table::find_function$/#define OCTAVE__INTERPRETER__SYMBOL_TABLE__FIND_FUNCTION octave::interpreter::the_interpreter ()->get_symbol_table ().find_function/' \
  "$SRC/config.h"
echo "   config.h 校正后: $(grep -cE '^#define (OCTAVE__|OV_)' "$SRC/config.h") 条版本自适应宏"
fi

INC="-I$SRC -I$PREFIX/include -I$PREFIX/include/octave-7.2.0/octave/.. -I$PREFIX/include/octave-7.2.0/octave"
FLAGS="-O2 -std=c++11 -fwasm-exceptions -fPIC $INC"

# 分出「有 DEFUN 的模块源」与「helper」
# 源分组：**优先读包自带的 src/Makefile**（那是作者的意图，例如 statistics 的
#   `$(MKOCTFILE) svmpredict.cc svm.cpp svm_model_octave.cc` 表明 svm.cpp 该只并进
#   这两个模块，而不是无脑并进所有模块 —— 后者会导致 duplicate symbol）。
# 没有 Makefile 或没匹配到时，退化为「含 DEFUN 的各自成模块 + 其余当 helper」。
cd "$SRC"
GROUPS=""
if [ -f Makefile ]; then
  GROUPS=$(sed -n 's/^[[:space:]]*\$(MKOCTFILE)[[:space:]]\{1,\}\([^$()]*\.c[cp]*\).*/\1/p' Makefile | tr '\n' ';')
fi

MODS=""; HELPERS=""; MEXES=""
if [ -n "$GROUPS" ]; then
  echo "--- 按 src/Makefile 分组编译"
  echo "$GROUPS" | tr ';' '\n' | while IFS= read -r grp; do
    [ -n "$grp" ] || continue
    set -- $grp
    mod=$(basename "$1" | sed 's/\.[^.]*$//')
    objs=""
    ok=1
    for src in "$@"; do
      case "$src" in *mex*) continue ;; esac
      if grep -q "mexFunction" "$src" 2>/dev/null; then continue; fi
      o="$OUT/$mod--$(basename "$src").o"
      em++ $FLAGS -c "$src" -o "$o" 2>&1 | grep "error:" | head -3
      [ -f "$o" ] || ok=0
      objs="$objs $o"
    done
    if [ "$ok" = "1" ]; then
      em++ -sSIDE_MODULE=1 -fPIC -O0 -shared -o "$OUT/$mod.oct" $objs && \
        echo "  built $OUT/$mod.oct ($(stat -c%s "$OUT/$mod.oct") 字节)"
    else
      echo "  !! $mod 编译失败"
    fi
  done
  exit 0
fi

for f in *.cc *.cpp *.c; do
  [ -f "$f" ] || continue
  if grep -lq "mexFunction" "$f" 2>/dev/null; then MEXES="$MEXES $f"; continue; fi
  if grep -lqE "DEFUN_DLD|DEFUN \(" "$f" 2>/dev/null; then MODS="$MODS $f"; else HELPERS="$HELPERS $f"; fi
done
[ -n "$MEXES" ] && echo "--- 跳过 MEX（需 mex 运行时，本构建不支持）:$MEXES"
echo "--- 模块: $MODS"
echo "--- helper: ${HELPERS:-（无）}"

for h in $HELPERS; do
  em++ $FLAGS -c "$h" -o "$OUT/${h%.cc}.helper.o" 2>&1 | tail -3
done

for m in $MODS; do
  name=${m%.cc}
  em++ $FLAGS -c "$m" -o "$OUT/$name.o" 2>&1 | tail -3
  OBJS="$OUT/$name.o"
  for h in $HELPERS; do OBJS="$OBJS $OUT/${h%.cc}.helper.o"; done
  em++ -sSIDE_MODULE=1 -fPIC -O0 -shared -o "$OUT/$name.oct" $OBJS
  echo "  built $OUT/$name.oct ($(stat -c%s "$OUT/$name.oct") 字节)"
done
