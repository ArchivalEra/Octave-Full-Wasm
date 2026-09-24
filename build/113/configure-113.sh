#!/usr/bin/env bash
#
# Octave 11.3.0 → wasm 的 configure（P0：只求无头数值跑通）
#
# 开关基线取自 Edge-Tools/octave-wasm 的 Dockerfile（见 BASELINE-11.3.md §4.2），
# 但按我们的目标改了两处，并补了本项目的口径：
#
#   1. **去掉 `--without-x`**：11.3.0 已无此选项（Edge-Tools 是 11.1.0 时写的）
#   2. **加 `--disable-threads`**：Edge-Tools 是 pthread 构建，托管上必须带
#      COOP/COEP 头（他们的 demo/serve.mjs 里明确设了）；我们现有的静态托管
#      没有这些头，所以保持单线程、免 COI（emscripten-forge 的 10.3 recipe
#      也是 `--disable-threads`）。**这一条要实测确认在 emsdk 5.0.7 + f2c 下可行。**
#   3. 他们关掉的那一长串库我们**暂时照关**——P0 只求解释器起来，变量越少越好；
#      我们的 C 库长尾在 P2 逐个重新打开并各自过数值断言（见 HISTORY §9.3）。
#   4. `--without-freetype`：我们还没建 freetype；无头数值不需要它，P5 图形再说。
#
# 用法（在 o113 容器内）：
#   export PATH=/src/bin:$PATH
#   bash configure-113.sh [源码目录] [安装前缀]
#
set -euo pipefail

SRCDIR="${1:-/src/work/octave-11.3.0}"
PREFIX="${2:-/src/work/octave-install}"
DEPS=/usr/local

[ -d "$SRCDIR" ] || { echo "FATAL: 找不到源码目录 $SRCDIR" >&2; exit 2; }
[ -f "$SRCDIR/configure" ] || { echo "FATAL: $SRCDIR 不是 Octave 源码树" >&2; exit 2; }
command -v emf77 >/dev/null || { echo "FATAL: PATH 里没有 emf77" >&2; exit 2; }

# 依赖（build-deps.sh 装到 /usr/local）
for f in lib/libf2c.a lib/librefblas.a lib/liblapack.a lib/libpcre2-8.a include/f2c.h; do
  [ -f "$DEPS/$f" ] || { echo "FATAL: 缺 $DEPS/$f —— 先跑 build-deps.sh all" >&2; exit 2; }
done
# 补丁是否打过（grep 那三处证据）
grep -q 'Building shared libraries is required' "$SRCDIR/configure" \
  && { echo "FATAL: 平台补丁没打（configure 里还有共享库硬性检查）" >&2; exit 2; }
grep -q 'Please port gnulib getlocalename_l-unsafe' "$SRCDIR/libgnu/getlocalename_l-unsafe.c" \
  && { echo "FATAL: 平台补丁没打（gnulib #error 还在）" >&2; exit 2; }

# ---- Fortran：走 f2c（与 7.2 同路线） --------------------------------------
export F77=emf77 FC=emf77 F90=emf77
export FLIBS="-L$DEPS/lib -lf2c"
export BLAS_LIBS="-lrefblas -lf2c"
export LAPACK_LIBS="-llapack"

# ---- 头搜索路径（LDFLAGS/CFLAGS/CXXFLAGS 在下面统一设） ---------------------
export CPPFLAGS="-I$DEPS/include"
# ⚠️ pcre2 的探测（走过的弯路，记下来）：
# configure 里默认 `ac_octave_pcre2_pkg_check=yes` 且 `PCRE2_LIBS="-lpcre2"`，
# 然后用 `if test -n "$PKG_CONFIG" && $PKG_CONFIG --exists "libpcre2-8"` 去试 pkg-config；
# 这一步一旦不成立，就落到 `-lpcre2` 回退——而我们装的是 **libpcre2-8.a**，
# 于是报 "you must have the PCRE or PCRE2 library and header files installed"，
# 明明头文件已找到（`checking for pcre2.h... yes`），很有迷惑性。
#
# 先按 Edge-Tools 的做法设 PKG_CONFIG_PATH（给 pkg-config 找 .pc 用）。
export PKG_CONFIG_PATH="$DEPS/lib/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
export PKG_CONFIG=/usr/bin/pkg-config
# 但更稳的是**直接绕过探测**：configure 的 case 分支里，`--with-pcre2` 的值若以
# `-` 开头（如 -lpcre2-8）会**原样**当作 PCRE2_LIBS，且因为 ac_octave_pcre2_pkg_check
# 只被 `yes|""` 分支置为 yes，走这条路时 pkg-config 分支根本不会执行。
# 所以下面 configure 行里显式给了 `--with-pcre2=-lpcre2-8`。
# （pcre2 的 8 位宽变体就是这个库名；上游 PCRE2 装出来的 .a 叫 libpcre2-8.a。）

# ⚠️ 为什么是这一组（别再随手往里加东西，都是实测换来的）：
#
# 1. **`--disable-shared --enable-static`，不要 `--enable-shared`。**
#    实测 `--enable-shared` 会让 configure 死在
#      "configure: error: Octave requires some way to perform dynamic linking."
#    （autoconf/libtool 在 emconfigure 下建立不起「动态链接」这个概念）。
#    `--enable-shared` **不是** `.oct` 车道的必要条件：闸门二探针已证明，
#    真正必需的是「全树 -fPIC + 终链 -sMAIN_MODULE=1 -sALLOW_TABLE_GROWTH=1」，
#    而 `.oct` 是独立编的 side module、不链 Octave 的库；静态归档里的 -fPIC
#    对象照样能进 PIC 主链。MAIN_MODULE 属于**终链**，不该塞进这里的 LDFLAGS。
#
# 2. **LDFLAGS 里不要放 `-s ERROR_ON_UNDEFINED_SYMBOLS=0`。**
#    实测加进去之后 configure 在动态链接器特性那一段会报
#      "./configure: line 36627: =-fPIC: command not found"
#    紧跟 "Octave requires some way to perform dynamic linking." ——
#    带空格的 `-s NAME=value` 被 autoconf/libtool 的 shell 片段拆坏。
#    这个标志真正该出现的地方同样是**终链**（build/Makefile 的 EM_SFLAGS/LDFLAGS）。
#
# 3. **不要 FFLAGS、不要 EMCC_FORCE_STDLIBS、不要 --with-blas/--with-lapack。**
#    这几样是照抄 7.2 的 reconf-pic.sh 加进来的，加完 configure 就挂；
#    撤掉即恢复。BLAS/LAPACK 交给下面的 BLAS_LIBS/LAPACK_LIBS 环境变量。
#
# 结论：本脚本的 configure 配方是**实测通过过的那一版**（见 STATUS.md），
# 加任何东西之前先跑一遍确认没破，再改。
# ⚠️ 异常模式必须是 **-fwasm-exceptions（原生 wasm 异常）**，不能是 -fexceptions
#    （emscripten 的 JS 式异常）。这是 `.oct` 车道能否成立的关键，实测证据：
#      JS 式异常会给整棵树引入 `invoke_*` / `__cxa_throw` / `__cxa_begin_catch`
#      这些**只存在于 JS 胶水里的运行时符号**；而 side module（.oct）装载时是靠
#      主模块的**导出表**解析导入的，这些符号不在导出表里 →
#        could not load dynamic lib: …miniprobe.oct
#        TypeError: Cannot read properties of undefined (reading 'value')
#      （用解析 wasm 导入/导出段的方式核对过：side 的 30 个导入里，16 个 Octave/
#        C++/libc 符号主模块都导出了，缺的 14 个全是 invoke_*/__cxa_*。）
#    改用原生 wasm 异常后，根本不产生这些依赖。
#    → 与两份公开配方一致（emscripten-forge 的 10.3 与 Edge-Tools 的 11.1 都是
#      -fwasm-exceptions），也解释了我们 7.2 的 .oct 为何能装。
export CFLAGS="-O2 -fwasm-exceptions -fPIC"
export CXXFLAGS="-O2 -fwasm-exceptions -fPIC"
export LDFLAGS="-L$DEPS/lib -fPIC -fwasm-exceptions"

# ---- ccache：让整棵树的编译都进缓存 ----------------------------------------
# ⚠️ 实测坑（第一版就是错的）：**`emconfigure` 会把 CC/CXX 覆盖掉**——
#    未过 emconfigure:  CC=[ccache emcc]      CXX=[ccache em++]
#    过了 emconfigure:  CC=[/emsdk/.../emcc]  CXX=[/emsdk/.../em++]
#    结果：Octave 自己那 1400+ 个对象**一个都没进缓存**。
#    证据：ccache 累计 Cacheable calls=1990，而依赖那批（libf2c 165 + BLAS 149
#    + LAPACK 1660）恰好约 1990；缓存目录只有 24MB，装不下 Octave 的对象。
#    （依赖能进缓存是因为 build-deps.sh/emf77 直接用 `ccache emcc` 调，绕过了 emconfigure。）
#
# 修法：把 CC/CXX 作为 **configure 的命令行参数**传（见下面调用末尾）。
#   autoconf 对「命令行赋值的 precious 变量」直接采用，优先级高于环境变量，
#   所以能压过 emconfigure 的覆盖。仅 export 是不够的。
#
# 收益的边界（如实）：只在「参数完全相同的重复构建」上兑现。今天五次构建每次
#   flag/config.h 都不同（pthread 预设、--enable-shared、AX_PTHREAD 补丁），
#   注定全 miss。真正省时间的是 S4/S5 反复调库、反复改 .oct 的时候。
export CCACHE_DIR="${CCACHE_DIR:-/ccache}"
export CCACHE_MAXSIZE="${CCACHE_MAXSIZE:-20G}"

# ---- configure 期那些「需要真跑一下」的探测：wasm 下必然假失败，直接预置 -----
# （HANDOFF §4.7 记过：容器里的运行期测试会因 Node 太旧/不可执行而假失败）
export gl_cv_func_nanosleep=yes
export gl_cv_func_usleep_works=yes
export gl_cv_func_svid_putenv=yes
# ⚠️ 线程相关：**不要预置 ac_cv_header_pthread_h=no 这类值**（实测教训）。
# 把 emscripten-forge 那份 recipe 的 pthread 预设抄进来后，gnulib 认为
# 「本机没有 pthread.h」，于是自己生成 libgnu/pthread.h，与 Emscripten sysroot 的
# pthread.h 撞车 → make 在 libgnu 就死：
#   ./pthread.h:718:13: error: typedef redefinition with different types
#     ('int' vs 'struct __pthread *')
# 这正是 emscripten-forge patch 0010「Remove-redundant-headers」在处理的冲突；
# 而 Edge-Tools 那份成功建出 11.1.0 的配方里**没有**这些 pthread 预设。
# 我们只是不要多线程，`--disable-threads` 已经表达了，不必假装头文件不存在。
# SuiteSparse 相关：我们全关，避免 configure 卡在探测上
export ac_octave_suitesparseconfig_pkg_check=no
export ac_octave_spqr_check_for_lib=no

echo "=== configure 前置：Edge-Tools 在 11.x 上验证过的两处 configure 处理"
cd "$SRCDIR"
# 清掉 configure 缓存：`lt_cv_*` 这类结果会跨次污染
# （实测过一次：上一次 --disable-shared 的缓存让这次 --enable-shared 的
#  动态链接探测直接对不上，日志里一律带 (cached)）
rm -f config.cache
# 1) -fexceptions → -fwasm-exceptions（emsdk 5.x 下后者才是原生 wasm 异常）
if grep -q -- '-fexceptions' configure; then
  n_before=$(grep -c -- '-fexceptions' configure || true)
  sed -i 's/-fexceptions/-fwasm-exceptions/g' configure
  n_after=$(grep -c -- '-fexceptions' configure || true)
  echo "  [1] -fexceptions → -fwasm-exceptions：$n_before 处 → 剩 $n_after 处"
  [ "$n_after" -lt "$n_before" ] || { echo "FATAL: 替换没生效" >&2; exit 1; }
else
  echo "  [1] 已处理（跳过）"
fi
# 2) 清掉 postdeps_CXX：某些 configure 测试会顺带拖进编译器库里的 legacy 异常实现
if grep -qE "^postdeps_CXX='.+'$" configure; then
  sed -i "s/^postdeps_CXX=.*/postdeps_CXX=''/" configure
  grep -qE "^postdeps_CXX=''$" configure || { echo "FATAL: postdeps_CXX 未清空" >&2; exit 1; }
  echo "  [2] postdeps_CXX 已清空"
else
  echo "  [2] 已处理（跳过）"
fi

# 3) emscripten 下跳过 AX_PTHREAD（但**保留** pthread.h 检测）
#    这一步是闸门③（免 COI）的关键，详见 build/113/GATE3-QUESTION.md 与
#    patch-ax-pthread.sh 的头注释。要点：把「有没有 pthread.h」与
#    「要不要 pthread 线程模型」解耦——前者保持 yes（gnulib 于是不造替代头），
#    后者在 emscripten 下由本补丁压成空，使全树不带 -pthread。
if [ -f /src/bin/patch-ax-pthread.sh ]; then
  bash /src/bin/patch-ax-pthread.sh "$SRCDIR"
else
  echo "FATAL: 缺 patch-ax-pthread.sh（闸门③ 必需）" >&2; exit 1
fi

echo "=== configure $SRCDIR → $PREFIX"
emconfigure ./configure \
  --host=wasm32-unknown-emscripten \
  --prefix="$PREFIX" \
  --enable-fortran-calling-convention=f2c \
  --with-pcre2=-lpcre2-8 \
  --disable-shared --enable-static \
  --disable-readline --disable-docs --disable-java \
  --disable-threads \
  --without-qt --without-fltk \
  --without-freetype \
  --without-qhull --without-glpk --without-arpack --without-qrupdate \
  --without-curl --without-hdf5 --without-fftw3 --without-fftw3f \
  --without-magick --without-sndfile --without-portaudio \
  --without-amd --without-camd --without-colamd --without-ccolamd \
  --without-cholmod --without-cxsparse --without-klu --without-umfpack \
  --without-bz2 --without-fontconfig \
  CC="ccache emcc" CXX="ccache em++" \
  || { echo "=== configure 失败，config.log 尾部 ==="; tail -n 80 config.log; exit 1; }

echo "=== configure 成功"
# 复核 ccache 真的进了构建系统（这是上面那个坑的回归护栏）
_cfgline_cc=$(grep -m1 "^CC = " Makefile 2>/dev/null || true)
_cfgline_cxx=$(grep -m1 "^CXX = " Makefile 2>/dev/null || true)
case "$_cfgline_cc $_cfgline_cxx" in
  *ccache*) echo "  ✅ ccache 已进 Makefile：$_cfgline_cc / $_cfgline_cxx" ;;
  *) echo "  ⚠️  Makefile 里没看到 ccache —— 本树的编译不会进缓存：" >&2
     echo "      CC  = $_cfgline_cc" >&2
     echo "      CXX = $_cfgline_cxx" >&2 ;;
esac
