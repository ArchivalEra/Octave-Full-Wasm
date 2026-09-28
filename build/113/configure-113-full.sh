#!/usr/bin/env bash
#
# ③ 一次性全开：把 ② 建好的全部可选依赖开起来，configure 一次
#
# 策略（外部校对定的）：**主树不要逐库重配**——因为本项目历史上的失败都是
# **组合型**的（某个库单独能编、终链却因 Fortran COMMON 块重复定义失败；
# 某个 .oct 单独能编、一装载却因符号签名不匹配整页崩），逐库单开根本测不出来。
# 主树一次全开；万一失败，**按库集合二分**，而不是逐库重编。
#   → 所以本脚本把依赖写成**一张表**，二分时只需往 SKIP 里加名字：
#        SKIP="hdf5 suitesparse" bash configure-113-full.sh
#
# 与 configure-113.sh（P0 的最小集）的区别：把那一长串 --without-<lib>
# 换成对已建库的 --with-<lib>-includedir/-libdir，并补上 --without-opengl
# （11.3 的 LIBOCTINTERP_LINK_DEPS 里有 -lGL -lGLU，会产生 GLU 未定义符号；
#  我们并不想要 GL，7.2 的配方里就有 --without-opengl，之前我漏了）。
#
# 仍然关着（没有建/不需要）：curl、magick、portaudio、spqr（R7 已论证非缺口）、
#   sundials_*（走 .oct 车道，不链进树）、freetype/fontconfig/fltk/qt（图形，P5 再说）。
#
set -euo pipefail

SRCDIR="${1:-/src/work/octave-11.3.0}"
PREFIX="${2:-/src/work/octave-install}"
# ★ 线程档（branch `threads`）要把这两个指向**独立 prefix**（现役 farm 一字不动）：
#   DEPS=/usr/local-threads D=/src/deps-threads WITH_THREADS=1 bash configure-113-full.sh
DEPS="${DEPS:-/usr/local}"  # 早期建的四个：libf2c/refblas/lapack/pcre2-8
D="${D:-/src/deps}"        # ② 建的库，每库独立 prefix
SKIP="${SKIP:-}"           # 空格分隔的库名，用于二分

[ -d "$SRCDIR" ] || { echo "FATAL: 找不到 $SRCDIR" >&2; exit 2; }
command -v emf77 >/dev/null || { echo "FATAL: PATH 里没有 emf77" >&2; exit 2; }

skipped () { case " $SKIP " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

INCS=(); LIBS=(); FLAGS=()

# ---- 依赖表：库名 | prefix | Octave 的 --with 名（留空=只进搜索路径，无选项）----
#   Octave 的选项名与库名不一定同（qhull 的选项叫 qhull_r；SuiteSparse 每个子库各有选项）
TABLE='
glpk|glpk|glpk
qhull|qhull|qhull_r
fftw|fftw|fftw3
fftw|fftw|fftw3f
sndfile|sndfile|sndfile
qrupdate|qrupdate|qrupdate
hdf5|hdf5|hdf5
zlibbz2|zlibbz2|z
zlibbz2|zlibbz2|bz2
arpack|arpack|arpack
suitesparse|suitesparse|suitesparseconfig
suitesparse|suitesparse|amd
suitesparse|suitesparse|camd
suitesparse|suitesparse|colamd
suitesparse|suitesparse|ccolamd
suitesparse|suitesparse|cholmod
suitesparse|suitesparse|umfpack
suitesparse|suitesparse|klu
suitesparse|suitesparse|cxsparse
rapidjson|rapidjson|
'

echo "=== 依赖表（SKIP=\"$SKIP\"）"
while IFS='|' read -r name pf opt; do
  [ -n "$name" ] || continue
  # SKIP 既可写 prefix 名（跳过该 prefix 下所有选项），也可写选项名
  # （如 SKIP=umfpack 只关 UMFPACK，但保留 SuiteSparse 其余部分）——
  # 按库集合二分 / 精确关单个库都靠它。
  if skipped "$name" || { [ -n "$opt" ] && skipped "$opt"; }; then
    # ⚠️ 仅仅"不传 --with-<opt>-*"是**不够**的：库的 prefix 已经在
    #   CPPFLAGS/LDFLAGS 的搜索路径里，configure 自己就会找到它
    #   （实测：不传 --with-umfpack-* 时 HAVE_UMFPACK 仍是 1）。
    #   必须**显式 --without-<opt>** 才能真正关掉。
    [ -n "$opt" ] && FLAGS+=("--without-$opt")
    echo "   [跳过] $name${opt:+ / $opt}（显式 --without-$opt）"; continue
  fi
  p="$D/$pf"
  [ -d "$p" ] || { echo "FATAL: 库 $name 的 prefix 不存在：$p" >&2; exit 2; }
  [ -d "$p/include" ] && INCS+=("-I$p/include")
  [ -d "$p/lib" ] && LIBS+=("-L$p/lib")
  if [ -n "$opt" ]; then
    [ -d "$p/include" ] && FLAGS+=("--with-$opt-includedir=$p/include")
    [ -d "$p/lib" ]     && FLAGS+=("--with-$opt-libdir=$p/lib")
  fi
done <<< "$TABLE"

export F77=emf77 FC=emf77 F90=emf77
export FLIBS="-L$DEPS/lib -lf2c"
export BLAS_LIBS="-lrefblas -lf2c"
export LAPACK_LIBS="-llapack -lrefblas -lf2c"

# ⚠️ 关键：SuiteSparse 的库是用 64 位 SuiteSparse_long 编的（见 build/113/ss-long64.h），
#   **Octave 自己也必须用同一个口径**，否则 ABI 边界两边不一致 ——
#   这正是稀疏 lu 走 UMFPACK 时整页 trap 的根因。
#   只给 SuiteSparse 加是不够的（实测：那样 Octave 的两条
#   "SuiteSparse_long and octave_idx_type have same size" 检测仍为假，lu 照样 trap）。
#   加进 CPPFLAGS 后两边一致，那两条检测也会变真。
export CPPFLAGS="-I$DEPS/include ${INCS[*]}"
# `-Wl,--allow-multiple-definition` 必须**也在 configure 期**：
#   ARPACK 的 f2c 产物里每个文件都带一份 COMMON 块定义（debug_/timing_），
#   而 configure 的「dseupd in -larpack」测试链接**不带**我们终链的那个标志 →
#   wasm-ld: duplicate symbol: debug_ → 测试判 no → eigs 被关掉。
#   （这正是 7.2 记的那个 COMMON 块问题；7.2 靠"全源 cat 成单 TU"绕，
#     我们现在靠这个链接标志，更简单。）
#   它是纯链接标志、没有 `-s NAME=value` 那种空格，不会像
#   ERROR_ON_UNDEFINED_SYMBOLS 那样把 configure 弄坏（那一条实测踩过）。
export LDFLAGS="-L$DEPS/lib ${LIBS[*]} -fPIC -fwasm-exceptions -Wl,--allow-multiple-definition"
# 异常模式必须 -fwasm-exceptions（原生 wasm 异常）：JS 式异常会引入
# invoke_*/__cxa_* 这些只在 JS 胶水里的符号，.oct side module 解析不到（已实测）
export CFLAGS="-O2 -fwasm-exceptions -fPIC"
export CXXFLAGS="-O2 -fwasm-exceptions -fPIC"

# ── 线程模型开关（B6，2026-09-27）──────────────────────────────────────────────
# `WITH_THREADS=1` ⇒ 线程档：AX_PTHREAD **正常生效**（PTHREAD_CFLAGS=-pthread 顺着
#   CFLAGS 进全树）⇒ wasm 内存是 shared ⇒ **浏览器侧硬要求 COOP/COEP**（闸门③ 被翻）。
# 默认（不设）⇒ 现役形态：跳过 AX_PTHREAD ⇒ 内存不 shared ⇒ 任何静态托管都能跑。
# ⚠️ 两件事必须**一起**做对，少一件就是"看着像线程档、其实不是"：
#   ① configure 里那段"压线程"的插入必须**撤掉**（`patch-ax-pthread.sh --revert`），
#      否则 `--enable-threads` 也白配（覆盖点会把 PTHREAD_CFLAGS 清空，实测）；
#   ② `--enable-threads`（而不是 `--disable-threads`）⇒ config.h 里 OCTAVE_USE_THREADS。
# 状态由旗标**强制**（下面显式 revert/patch），不靠"上次跑过什么"的假设。
WITH_THREADS="${WITH_THREADS:-0}"
if [ "$WITH_THREADS" = "1" ]; then
  THREADS_FLAG="--enable-threads"
else
  THREADS_FLAG="--disable-threads"
fi

export PKG_CONFIG_PATH="$DEPS/lib/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
export PKG_CONFIG=/usr/bin/pkg-config

export CCACHE_DIR="${CCACHE_DIR:-/ccache}"
export CCACHE_MAXSIZE="${CCACHE_MAXSIZE:-20G}"

# configure 期「需要真跑一下」的探测：wasm 下必然假失败，预置
export gl_cv_func_nanosleep=yes gl_cv_func_usleep_works=yes gl_cv_func_svid_putenv=yes
export ac_octave_suitesparseconfig_pkg_check=no
export ac_octave_spqr_check_for_lib=no
# ARPACK 的 C++ 运行测试在容器里会假失败（7.2 记过），预置
export octave_cv_lib_arpack_ok_1=yes

cd "$SRCDIR"
rm -f config.cache
echo "=== configure 前置处理"
grep -q -- '-fexceptions' configure && sed -i 's/-fexceptions/-fwasm-exceptions/g' configure || true
grep -qE "^postdeps_CXX='.+'$" configure && sed -i "s/^postdeps_CXX=.*/postdeps_CXX=''/" configure || true
# emscripten 下跳过 AX_PTHREAD（保留 pthread.h 检测）—— 闸门③ 的关键。
# `WITH_THREADS=1` 时**反过来**：撤掉那段插入，让 AX_PTHREAD 正常给出 -pthread（线程档）。
if [ "$WITH_THREADS" = "1" ]; then
  echo "=== WITH_THREADS=1：撤销 AX_PTHREAD 覆盖（线程档要 -pthread 进全树）"
  # ⚠️ 撤销工具用 **exit 3 = "没有标记，无需撤销"** 表示"状态已满足"。
  #    本脚本是 `set -euo pipefail` ⇒ 直接调用会被 3 杀掉（实测踩到：configure 静默中止、
  #    日志停在"无需撤销"这一行、rc=3，看起来像 configure 失败）。所以必须显式接住 0/3。
  set +e
  bash /src/bin/patch-ax-pthread.sh --revert "$SRCDIR"
  rv=$?
  set -e
  case "$rv" in
    0|3) ;;
    *) echo "FATAL: 撤销失败（rc=$rv）" >&2; exit 1 ;;
  esac
else
  bash /src/bin/patch-ax-pthread.sh "$SRCDIR"
fi

# P5 步骤②：要不要开 OpenGL？
#   默认仍然 `--without-opengl`（与之前逐字节一致）。
#   `WITH_OPENGL=1` 时**不开** --without-opengl，并把 GL 头/库摆到搜索路径上，
#   好让 Octave 的 `gl-render.cc` 编出来、并链到真正的 GL 实现上。
#
#   ⚠️ 2026-09-23 起：**OSMesa 后端已退役**（图形线只剩 gl4es → GLES2 → WebGL2）。
#   这里加的 `-I/src/deps/glshim/include` 现在是**指向 gl4es+GLU 头目录的软链**
#   （`build/113/gl-headers-webgl.sh` 组装的 `/src/deps/glheaders-webgl/include`）。
#   保留这个**路径字符串**是故意的：`-I` 进 ccache 哈希、也进 automake 的 .d，
#   换路径 = 整片缓存失效 = 一次 -O2 全树重建；只换目录内容就只重编那几个 GL TU。
#   `-L/src/deps/glshim/lib` 同理（那里的 libGL.a 是 OSMesa 冒充品，现在没人链它了，
#   留着只为不动命令行）。
OPENGL_FLAG="${OPENGL_FLAG:---without-opengl}"
if [ "${WITH_OPENGL:-0}" = "1" ]; then
  OPENGL_FLAG=""
  CPPFLAGS="${CPPFLAGS:-} -I/src/deps/glshim/include"
  LDFLAGS="${LDFLAGS:-} -L/src/deps/glshim/lib"
  echo "=== WITH_OPENGL=1：开 OpenGL（头/库走 /src/deps/glshim，内容已是 gl4es+GLU）==="
fi

# §8 待办 2：FreeType 文字渲染（默认仍关 = 与既有产物逐字节一致）。
#   `WITH_FREETYPE=1` 时不传 `--without-freetype`，并把我们自己的 `freetype2.pc` 摆到
#   pkg-config 搜索路径上 —— configure 的探测是
#   `PKG_CHECK_MODULES([FT2],[freetype2])` + `$PKG_CONFIG freetype2 --atleast-version=9.03`，
#   全靠 pkg-config（没有 `--with-freetype=` 那种带路径的写法）。
#   库由 `build/113/build-freetype.sh` 建到 `$D/freetype`（**-fPIC 是硬要求**：
#   主链可重定位，混进非 PIC 归档会在 dylink 那层出问题）。
#   `WITH_FONTCONFIG=1`（2026-09-24，R3）时**同时**开 fontconfig：它是"`fontname` 真的生效 +
#   `listfonts()` 能用"的唯一正路 —— `ft-text-renderer.cc` 只有在 `HAVE_FONTCONFIG` 时才用
#   `FcFontMatch()` 去挑字体文件；没有它就走 `oct_fonts_dir()` 下的 `FreeSans*.otf` 回落
#   （属性存得住、渲染被忽略；`listfonts` 还会报 `structure has no member 'family'`）。
#   库由 `build/113/build-fontconfig.sh` 建（`$D/fontconfig` + `$D/expat`）。
#   ⚠️ **运行期还要两件事**（都在 link-web.sh 与 main.cc 里，缺一不可，实测）：
#     ① `fonts.conf` 预载到 `/fonts/fonts.conf`，`<dir>` 指向**已预载字体的 octfontsdir**；
#     ② `setenv("FONTCONFIG_FILE", "/fonts/fonts.conf", 1)` —— `--sysconfdir=/` 编出来的默认
#        路径是 **`//fonts/fonts.conf`**（双斜杠），Emscripten 的 FS 解析不到它，于是
#        `FcFontList` 恒为 **0 个 face** 且**一声不响**（机制闸门 probe-fontconfig.sh 实测）。
FREETYPE_FLAG="${FREETYPE_FLAG:---without-freetype}"
if [ "${WITH_FREETYPE:-0}" = "1" ]; then
  FREETYPE_FLAG=""
  PKG_CONFIG_PATH="$D/freetype/lib/pkgconfig:${PKG_CONFIG_PATH:-}"
  export PKG_CONFIG_PATH
  # ⚠️ **还必须设 `EM_PKG_CONFIG_PATH`**：`emconfigure` 会把 emscripten sysroot 的
  #    pkgconfig 目录摆到 pkg-config 搜索路径**最前面**，于是 `freetype2` 解析到
  #    **emsdk 端口**那份 .pc（内容 `Libs/Cflags: -sUSE_FREETYPE`）而不是我们这份 ——
  #    实测：只设 PKG_CONFIG_PATH 时 Makefile 里 `FT2_LIBS = -sUSE_FREETYPE`，
  #    于是一串 in-tree 链接（octave-cli 等）报 `undefined symbol: FT_Done_Face`。
  #    `EM_PKG_CONFIG_PATH` 是 emscripten 给的这个口子，优先级高于它自己的 sysroot。
  EM_PKG_CONFIG_PATH="$D/freetype/lib/pkgconfig:${EM_PKG_CONFIG_PATH:-}"
  export EM_PKG_CONFIG_PATH
  CPPFLAGS="${CPPFLAGS:-} -I$D/freetype/include"
  LDFLAGS="${LDFLAGS:-} -L$D/freetype/lib"
  pkg-config --modversion freetype2 >/dev/null 2>&1 || {
    echo "FATAL: pkg-config 找不到 freetype2（先跑 build/113/build-freetype.sh）" >&2; exit 2; }
  echo "=== WITH_FREETYPE=1：开 FreeType（$D/freetype，$(pkg-config --libs freetype2)）==="
fi

# ── fontconfig（R3，2026-09-24）：`WITH_FONTCONFIG=1` 时开 ─────────────────────────
# Octave 的探测是 `OCTAVE_CHECK_LIB(fontconfig, fontconfig, [fontconfig], …, [FcInit])`，
# 走 pkg-config（没有 `--with-fontconfig=DIR` 那种带路径的写法）⇒ 手写的 fontconfig.pc
# 必须在搜索路径上（且 EM_PKG_CONFIG_PATH 也要给，理由同上面的 freetype）。
FONTCONFIG_FLAG="${FONTCONFIG_FLAG:---without-fontconfig}"
if [ "${WITH_FONTCONFIG:-0}" = "1" ]; then
  FONTCONFIG_FLAG=""
  for d in $D/fontconfig/lib/pkgconfig $D/expat/lib/pkgconfig $D/freetype/lib/pkgconfig; do
    PKG_CONFIG_PATH="$d:${PKG_CONFIG_PATH:-}"
    EM_PKG_CONFIG_PATH="$d:${EM_PKG_CONFIG_PATH:-}"
  done
  export PKG_CONFIG_PATH EM_PKG_CONFIG_PATH
  CPPFLAGS="${CPPFLAGS:-} -I$D/fontconfig/include -I$D/expat/include"
  LDFLAGS="${LDFLAGS:-} -L$D/fontconfig/lib -L$D/expat/lib"
  pkg-config --modversion fontconfig >/dev/null 2>&1 || {
    echo "FATAL: pkg-config 找不到 fontconfig（先跑 build/113/build-fontconfig.sh）" >&2; exit 2; }
  pkg-config --modversion expat >/dev/null 2>&1 || {
    echo "FATAL: pkg-config 找不到 expat" >&2; exit 2; }
  # ⚠️ **预置探测缓存变量**（本项目的老对策，见 HANDOFF §4.7：容器里"需要在 configure 期
  #    真跑一次链接"的探测会假失败）。这一次的具体错误（config.log 实测原文）是：
  #      checking for FcInit in -lfontconfig -lfreetype -lexpat -lz … failed
  #      conftest.c:617:1: error: unknown type name 'namespace'
  #    —— `OCTAVE_CHECK_LIB` 的 `AC_LINK_IFELSE(AC_LANG_CALL([], [FcInit]))` 生成了 **C++**
  #    形式的程序（`namespace conftest { … }`），而文件名/编译器却是 `conftest.c`/`emcc`（C）
  #    ⇒ 与库本身无关，纯粹是这个组合下的 autoconf 失真。
  #    真正的能力已由机制闸门 `build/113/probe-fontconfig.sh` 独立证明（静态链接 + FcInit +
  #    FcFontList + FcFontMatch 在 wasm/MEMFS 里全通，含反证）；链接期还有 link-web.sh 的
  #    产物自检兜底 ⇒ 这里预置 yes 是**有据的**，不是把红的说成绿的。
  export octave_cv_lib_fontconfig=yes
  echo "=== WITH_FONTCONFIG=1：开 fontconfig（$D/fontconfig，$(pkg-config --libs fontconfig)）==="
  echo "    （octave_cv_lib_fontconfig=yes 预置；理由见本脚本注释与 probe-fontconfig.sh）"
fi

# gl2ps：要不要让 Octave 的 print 支持矢量输出？
#   默认不开（与之前逐字节一致）。
#   `WITH_GL2PS=1` 时把 /src/deps/gl2ps 摆到搜索路径上 —— 那里有给 wasm 编的
#   libgl2ps.a 与 gl2ps.h（配方见 build/113/build-gl2ps.sh）。
#
#   为什么需要（2026-09-23 实测）：Octave 的 `print` 管线
#   （`m/plot/util/private/__opengl_print__.m`）是**围绕 gl2ps 写的**，全程
#   `gl2ps_device`，**从不调用 toolkit 的 `print_figure`**。没有 gl2ps 时
#   `print -dsvg/-dpdf/-dps/-dpng` 全部失败（前两个报 gl2ps，后几个报缺 gs）——
#   也就是说 plot 桥自己那份 SVG 是**唯一**能出矢量的路。
#   开了 gl2ps 之后 toolkit 才能自己扛 print，桥那条 1.7 s 的数据管线才真正冗余。
WITH_GL2PS_FLAG=""
if [ "${WITH_GL2PS:-0}" = "1" ]; then
  CPPFLAGS="${CPPFLAGS:-} -I/src/deps/gl2ps/include"
  LDFLAGS="${LDFLAGS:-} -L/src/deps/gl2ps/lib"
  WITH_GL2PS_FLAG="-lgl2ps"
  echo "=== WITH_GL2PS=1：把 wasm 版 gl2ps 摆进搜索路径（print 的矢量输出）==="
fi

echo "=== configure（全开）"
emconfigure ./configure \
  --host="${TARGET_HOST:-wasm32-unknown-emscripten}" \
  --prefix="$PREFIX" \
  --enable-fortran-calling-convention=f2c \
  --with-pcre2=-lpcre2-8 \
  --with-blas=-lrefblas --with-lapack=-llapack \
  --disable-shared --enable-static \
  --disable-readline --disable-docs --disable-java \
  ${THREADS_FLAG} \
  --without-qt --without-fltk ${OPENGL_FLAG} \
  ${FREETYPE_FLAG} ${FONTCONFIG_FLAG} \
  --without-curl --without-magick --without-portaudio \
  --without-spqr \
  --without-sundials_core --without-sundials_ida \
  --without-sundials_nvecserial --without-sundials_sunlinsolklu \
  "${FLAGS[@]}" \
  CC="ccache emcc" CXX="ccache em++" \
  || { echo "=== configure 失败，config.log 尾部 ==="; tail -n 100 config.log; exit 1; }

echo "=== configure 成功"

# ---- GL 头相关的两个探测：重跑 configure 会把它们翻成 undef，这里显式恢复 ----
# 为什么会翻：这两个都是**看 GL 头/库**的探测（`GL_GLEXT_PROTOTYPES`、
# `glBlendFuncSeparate`），而 `/src/deps/glshim/include` 的内容在 2026-09-23 从 Mesa 头
# 换成了 gl4es+GLU 头（`build/113/gl-headers-webgl.sh`）。那次只做了**增量重编**
# （3 个 TU，config.h 没重生成）⇒ **部署版是在这两个 = 1 的状态下编出来的**。
# 为什么恢复成 1 而不是接受 undef：**这一批（FreeType）不该顺带改图形行为**；
# 而且 gl4es 实测提供 glBlendFuncSeparate —— `/src/deps/glshim/lib/libGL.a` 里有 4 个
# 相关符号，部署的 wasm 里也确实有 `gl4es_glBlendFuncSeparate` 的引用。
# 要改这条，先跑一遍图形套件（accept-p5-graphics / accept-print / accept-plotv2 / -3d）
# 证明行为不变，再改。
# ⚠️ **这段是"沉默的图形退化"的唯一防线**（2026-09-24 又踩了一次，教训值得写下来）：
#    漏给 `WITH_OPENGL=1` 时这段被跳过 ⇒ 两个宏是 undef ⇒ **编得过、链接过、自检全绿**，
#    但运行时默认 toolkit 掉回 `web`（`probe-text-render` 直接 SKIP："默认 toolkit 不是 webgl"），
#    现象是"图变成 SVG 回落"——很容易误判成"fontconfig 把 GL 弄坏了"。
#    ⇒ 所以这里改成**必须恢复成 1，否则 FATAL**，不再"能改就改、不能改就算了"。
if [ "${WITH_OPENGL:-0}" = "1" ]; then
  for h in GL_GLEXT_PROTOTYPES HAVE_GLBLENDFUNCSEPARATE; do
    if grep -qE "^/\* #undef $h \*/" config.h; then
      sed -i "s|^/\* #undef $h \*/|#define $h 1|" config.h
      echo "   ★ 恢复 $h = 1（gl4es 头不声明、但部署版就是 1；见脚本内注释）"
    fi
    grep -qE "^#define $h 1" config.h || {
      echo "FATAL: $h 没能恢复成 1 —— 默认 toolkit 会掉回 web（图形退化但不会报错）" >&2; exit 3; }
  done
fi
# 汇报实际开起来了什么（这是 ③ 的可读证据）
for h in HAVE_GLPK HAVE_QHULL_R HAVE_FFTW3 HAVE_FFTW3F HAVE_SNDFILE HAVE_HDF5 \
         HAVE_ZLIB HAVE_BZ2 HAVE_ARPACK HAVE_AMD HAVE_CHOLMOD HAVE_UMFPACK \
         HAVE_KLU HAVE_CXSPARSE HAVE_QRUPDATE HAVE_RAPIDJSON; do
  # 注意 `|| true`：grep 无匹配会返回 1，而 `var=$(cmd)` 的退出码会被 set -e 捕获
  # → 整个脚本会在汇报到第一个"未定义"的库时就死掉（这个 bug 踩过一次）
  v=$(grep -E "^#define $h " config.h 2>/dev/null | awk '{print $3}' || true)
  printf "   %-16s %s\n" "$h" "${v:-（未定义）}"
done
_cfg=$(grep -m1 "^CC = " Makefile 2>/dev/null || true)
case "$_cfg" in *ccache*) echo "  ✅ ccache 已进 Makefile：$_cfg" ;;
  *) echo "  ⚠️  Makefile 里没看到 ccache：$_cfg" >&2 ;; esac
