#!/usr/bin/env bash
#
# 把 Octave 11.3.0 的 wasm 目标链成**浏览器可用**的 octave.js / octave.wasm / octave.data
#
# 这是 7.2 时代 build/Makefile 里 `web/octave.js` 那条规则的 11.3.0 移植版。
# 与 7.2 的差异（都是实测出来的，别照抄 7.2）：
#   1. m 目录集合不同：11.3.0 有 35 个（7.2 没这么多），且多出 `+matlab`、
#      `+containers`、`@ftp` 三个特殊目录 → preload 清单**动态生成**，不写死；
#      并且 main.cc 的 path 里必须加 **m 目录本身**（它们靠父目录解析）。
#   2. C++ 标准：11.3.0 要 C++17（7.2 是 C++11）。
#   3. emsdk 5.0.7 没有 `-enable-emscripten-cxx-exceptions` 这个老旗标（改用 -fwasm-exceptions）。
#   4. 库清单按 11.3.0 的实际配置裁剪（P0 阶段我们 --without 掉了长尾库，
#      所以这里只需要 libinterp/liboctave/libgnu + lapack/refblas/f2c/pcre2）。
#      S4 开回长尾后要回来加 -l。
#
# 用法（容器内）：bash link-web.sh [输出目录]
#
set -euo pipefail

# 本脚本所在目录的**绝对**路径：脚本中途会 `cd`（到 $SRC 去链接），到那时
# `$(dirname "$0")` 就解成相对当前目录的 `.` 了 —— 实测踩过：M2 的保活自检因此
# 报 `can't open file '/src/websrc/./check-oct-imports.py'`（而链接本身是成功的）。
HERE="$(cd "$(dirname "$0")" && pwd)"

OUT="${1:-/src/websrc/out}"
OCT="$(cd /src/work/octave-11.3.0 && pwd)"
INST=/src/work/octave-install
MV="11.3.0"
M="$INST/share/octave/$MV/m"
# M_SRC：预载的**源**树。默认就是安装树；`build/prerender-m-docstrings.py` 会产出一棵
# staged 树（docstring 已渲染成纯文本、去掉 `-*- texinfo -*-` 标记），把它指过来即可。
# **运行期路径完全不变**（仍是 /usr/src/octave/m/...），只是 .m 文件里的 docstring 变了，
# 于是 `help ode45` 这类 .m 文件不再触发运行时的 makeinfo（本构建没有 shell）。
M_SRC="${M_SRC:-$M}"
SRC=/src/websrc
DEPS=/usr/local

[ -f "$SRC/main.o" ] || { echo "FATAL: 缺 $SRC/main.o（先编 main.cc）" >&2; exit 2; }
[ -f "$SRC/post.js" ] || { echo "FATAL: 缺 $SRC/post.js" >&2; exit 2; }
[ -d "$M_SRC" ] || { echo "FATAL: 缺 $M_SRC（Octave 装了没 / staged 树生成了没）" >&2; exit 2; }

mkdir -p "$OUT"

# ---- preload：11.3.0 的 m 子目录逐个映射到 /usr/src/octave/m/<name> ----------
# （main.cc 里硬编码的就是 /usr/src/octave/m/... 这套路径）
#
# ⚠️ `--preload-file` 按**第一个 `@`** 把参数切成 `src@dst`。而 `m/` 下正好有个
#    `@ftp` 目录 —— 它的**源路径自带 `@`**，于是那条参数被切错：
#        src = `.../m/`                （少了一层，变成整个 m/）
#        dst = `ftp@/usr/src/octave/m/@ftp`
#    实测后果：`octave.js` 的文件表里多出 **1087 条记录 / 5.25MB**（占文件表 44%）
#    的**整棵 m/ 副本**，而 `@ftp` 自己的文件**没有**落在正确路径上
#    （`/usr/src/octave/m/@ftp/loadobj.m` 查无此文件）。
#    修法：源路径里带 `@` 的目录先拷到一个**名字里没有 `@`** 的暂存目录再预载；
#    目的地仍然写成正确的 `/usr/src/octave/m/@ftp`（dst 里可以有 `@`，切在第一个之后）。
PRELOAD=()
PRELOAD_AT="${PRELOAD_AT:-/src/work/m-preload}"
for d in "$M_SRC"/*/; do
  n="$(basename "$d")"
  s="${d%/}"
  case "$s" in
    *@*)
      safe="$(printf '%s' "$n" | tr '@' '_')"
      mkdir -p "$PRELOAD_AT"
      rm -rf "$PRELOAD_AT/$safe"
      cp -a "$s" "$PRELOAD_AT/$safe"
      echo "== preload 路径含 '@'：$n 暂存到 $PRELOAD_AT/$safe（否则整棵 m/ 会被复制错位）"
      s="$PRELOAD_AT/$safe"
      ;;
  esac
  PRELOAD+=("--preload-file" "$s@/usr/src/octave/m/$n")
done
echo "== preload ${#PRELOAD[@]} 项（含 +matlab/+containers/@ftp），来自 $M_SRC"

# ---- forge 预装集（20 个 .m）→ /usr/src/octave/m/forge ----------------------
# 为什么要有这一项：7.2 的站点上 `exist("normpdf")` **不加载任何资产就是 2**，
# 因为它的主链把一小撮 forge .m **预装**进了 `m/forge/`（实测 which →
# `/usr/src/octave/m/forge/normpdf.m`）。这批函数是早期为补 `ttest` 依赖塞进去的
# （betacdf/fcdf/gamcdf/normcdf/normpdf/ttest… 共 20 个，另含 fft/ifft/asciiplot，
# 其中 fft/ifft 被核心内建遮蔽、无害）。
# 11.3.0 的链一开始只 preload 了 `m` 的 35 个子目录，缺这一项 ⇒ `normpdf` 变成
# "要加载 statistics 资产才有"，**相对 7.2 是行为回退**。
# 文件集已入仓（build/forge-preload/），容器内同步到 /src/websrc/forge。
FORGE_SRC="${FORGE_SRC:-/src/websrc/forge}"
if [ -d "$FORGE_SRC" ] && ls "$FORGE_SRC"/*.m >/dev/null 2>&1; then
  PRELOAD+=("--preload-file" "$FORGE_SRC@/usr/src/octave/m/forge")
  echo "== preload forge 预装集：$(ls "$FORGE_SRC"/*.m | wc -l) 个 .m → /usr/src/octave/m/forge"
else
  echo "⚠ 缺 $FORGE_SRC/*.m —— 主链会少掉 7.2 就有的 forge 预装（normpdf 等会变成需懒加载）"
fi

# ---- FreeType 字体预载（WITH_FREETYPE=1 时）----------------------------------
# 为什么需要：`--without-fontconfig` 是**有意保留**的（见 configure-113-full.sh 的注释），
# 于是 `ft-text-renderer.cc` 的回落路径是 `OCTAVE_FONTS_DIR`（环境变量，我们没设）→
# `SYSTEM_FREEFONT_DIR`（编译期，未定义）→ `config::oct_fonts_dir()`，在**那个目录**里找
# `FreeSans[Bold][Oblique].otf`。Octave **自带**这几个字体（源码 `etc/fonts/`，`make install`
# 装进 configure 的 `octfontsdir`）⇒ 把它们预载到**同一个绝对路径**即可。
#
# ⚠️ **挂载点不猜**（这是本仓的硬规矩，见 HANDOFF §0 第 6 条）：直接从构建树的 Makefile
#    读 configure 产物 `octfontsdir`。注意它与 main.cc 那套 `/usr/src/octave/m/...`
#    **不是一回事**：m/ 树是 main.cc 自己 addpath 的，字体走 defaults.cc 的
#    `prepend_octave_home(OCTAVE_OCTFONTSDIR)`，实测 = configure prefix
#    `/src/work/octave-install/share/octave/$MV/fonts`（站点里 doc-cache 等 file 资产的
#    mount 也是这个前缀 —— 两处对得上）。
#    **2026-09-24 起预载 8 个**（FreeSans ×4 + **FreeMono ×4**）：以前只装 FreeSans，理由是
#    "FreeMono 绘图/打印用不到"（省 1MB）；但 fontconfig 上线后 `listfonts()` 报的是**真实
#    字体目录**，只有 FreeSans 时"换家族名"仍会落回 FreeSans（§5.31 已记录的那条边界）。
#    加 FreeMono = 让 `fontname="FreeMono"` 真的换个等宽字体（raw +1,036,292 字节）。
FONTS_PRELOAD_TAG=""
if [ "${WITH_FREETYPE:-0}" = "1" ]; then
  fontsdir="$(grep -m1 '^octfontsdir' "$OCT/Makefile" 2>/dev/null | sed 's/^octfontsdir *= *//')"
  [ -n "$fontsdir" ] || { echo "FATAL: 读不到 $OCT/Makefile 的 octfontsdir" >&2; exit 2; }
  [ -d "$fontsdir" ] || { echo "FATAL: $fontsdir 不存在（先 emmake make install）" >&2; exit 2; }
  stage_fonts="$PRELOAD_AT/fonts"
  rm -rf "$stage_fonts"; mkdir -p "$stage_fonts"
  for f in FreeSans.otf FreeSansBold.otf FreeSansOblique.otf FreeSansBoldOblique.otf \
           FreeMono.otf FreeMonoBold.otf FreeMonoOblique.otf FreeMonoBoldOblique.otf; do
    [ -f "$fontsdir/$f" ] || { echo "FATAL: 缺字体 $fontsdir/$f" >&2; exit 2; }
    cp -a "$fontsdir/$f" "$stage_fonts/"
  done
  PRELOAD+=("--preload-file" "$stage_fonts@$fontsdir")
  FONTS_PRELOAD_TAG="FreeSans.otf"
  echo "== preload FreeType 字体 8 个（FreeSans ×4 + FreeMono ×4）→ $fontsdir（$(du -sb "$stage_fonts" | cut -f1) 字节）"
fi

# ---- fontconfig 的**运行期配置**（WITH_FONTCONFIG=1 时）--------------------------
# 三件事，都是实测出来的（机制闸门 `build/113/probe-fontconfig.sh`）：
#   ① 配置文件要挂在 **`/fonts/fonts.conf`**：`--sysconfdir=/` 让 fontconfig 的配置目录是
#      `/fonts`。但**编译期默认文件名是 `//fonts/fonts.conf`（双斜杠）**，Emscripten 的 FS
#      解析不到 ⇒ 不显式设变量就是"0 个 face 且一声不响"⇒ ② 还要 `setenv`。
#   ② `setenv("FONTCONFIG_FILE", "/fonts/fonts.conf", 1)` 在 **main.cc** 里（启动早期，
#      见那里的注释）—— 页面上没有任何口子改 wasm 的 ENV（`Module.ENV` 不存在，
#      而 node/浏览器的环境变量**不会**进 wasm，实测）。
#   ③ `<dir>` 指向**已预载字体的 `$fontsdir`**：不重复打包字体（省 1.87MB raw）；
#      `<cachedir>` 指到 `/tmp/fontconfig-cache`（MEMFS 可写；目录不存在时 fontconfig
#      只是不写缓存，实测无警告、`FcFontList`/`FcFontMatch` 照常）。
if [ "${WITH_FONTCONFIG:-0}" = "1" ]; then
  [ "${WITH_FREETYPE:-0}" = "1" ] || {
    echo "FATAL: WITH_FONTCONFIG=1 需要同时 WITH_FREETYPE=1（fontconfig 靠 FreeType 读字体）" >&2; exit 2; }
  [ -n "$fontsdir" ] || { echo "FATAL: fontsdir 未取到（上面那段没跑？）" >&2; exit 2; }
  stage_conf="$PRELOAD_AT/fontconfig"
  rm -rf "$stage_conf"; mkdir -p "$stage_conf"
  cat > "$stage_conf/fonts.conf" <<EOF
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <!-- Octave 自带的 8 个面（FreeSans ×4 + FreeMono ×4，预载在 $fontsdir）——本构建没有系统字体目录 -->
  <dir>$fontsdir</dir>
  <cachedir>/tmp/fontconfig-cache</cachedir>

  <!-- ── 家族替换：**实测出来的两条规则**（2026-09-24，见 HISTORY §5.39）─────────────
       背景：字体目录里出现第二个家族（FreeMono）之后，fontconfig 对"要不到的家族"的
       **兜底**从 FreeSans 变成了 **FreeMono**（按目录里家族名排序，FreeMono 在前）——
       于是 `fontname="Arial"`/`"Helvetica"` 这类学生常写的名字会变成**等宽**字体。
       两条规则把它掰回来：
         ① 等宽请求（Courier / monospace）→ **FreeMono**（这才是对味的替换）；
         ② 其余要不到的名字 → 追加一个 **weak** 的 FreeSans 兜底 ⇒ 回到改动前的默认。 -->
  <alias binding="same">
    <family>Courier</family>
    <accept><family>FreeMono</family></accept>
  </alias>
  <alias binding="same">
    <family>monospace</family>
    <accept><family>FreeMono</family></accept>
  </alias>
  <match target="pattern">
    <edit name="family" mode="append" binding="weak"><string>FreeSans</string></edit>
  </match>
</fontconfig>
EOF
  PRELOAD+=("--preload-file" "$stage_conf/fonts.conf@/fonts/fonts.conf")
  FONTCONFIG_PRELOAD_TAG="fonts.conf"
  echo "== preload fontconfig 配置 → /fonts/fonts.conf（<dir>=$fontsdir）"
  cat "$stage_conf/fonts.conf"
fi

# ---- 主链 ---------------------------------------------------------------
#  MAIN_MODULE_LEVEL（1|2）：主模块的链接模型层级（`-s MAIN_MODULE=`）。
#    1（默认）= 不做 DCE、导出全部符号：`.oct` 随便解析，首包大（wasm 35.97MB）。
#    2 = 做 DCE，**只保活导出的符号**：wasm 实测 27.73MB / 三大件 gzip −1.81MB，
#        但要自己把保活集算出来喂给它（KEEP_LIST），见 build/113/gen-keep-list.sh
#        与 NOTES-main-module-2.md。**M2 是有前提的**：链完必须过
#        build/113/check-oct-imports.py（下面的自检会替你做）。
#  ALLOW_TABLE_GROWTH=1：为 .oct side module 的 dlopen 服务（闸门②探针实测 emsdk 5.0.7 可行）
#  -Wl,--allow-multiple-definition：f2c 把每个 COMMON 块渲染成逐文件 tentative
#  definition，clang 默认 -fno-common 会变成冲突的强定义（dls001_/globe_…），
#  而 -fcommon 不能用（wasm-ld 没有 common symbol 链接）
MAIN_MODULE_LEVEL="${MAIN_MODULE_LEVEL:-1}"
case "$MAIN_MODULE_LEVEL" in 1|2) ;; *) echo "FATAL: MAIN_MODULE_LEVEL 只能是 1 或 2" >&2; exit 2;; esac
SFLAGS=( -s WASM=1 -s "MAIN_MODULE=$MAIN_MODULE_LEVEL" -s ALLOW_TABLE_GROWTH=1
         -s ERROR_ON_UNDEFINED_SYMBOLS=0
         -s INITIAL_MEMORY=128MB -s ALLOW_MEMORY_GROWTH=1 )
echo "== MAIN_MODULE=$MAIN_MODULE_LEVEL$([ "$MAIN_MODULE_LEVEL" = 2 ] && echo '（DCE：保活集由 KEEP_LIST 提供）')"

# KEEP_LIST：**文件路径**，一行一个符号名 —— M2 车道用它喂 `-Wl,--export-if-defined=`
#   （由 build/113/gen-keep-list.sh 从所有 `.oct` 的 IMPORT 段生成）。
#   没有它就别想 M2：`.oct` 走资产车道、不在主链命令行上，拿不到 Emscripten 的自动保活。
KEEP_LIST="${KEEP_LIST:-}"
if [ -n "$KEEP_LIST" ]; then
  [ -s "$KEEP_LIST" ] || { echo "FATAL: KEEP_LIST 指向的文件不存在或为空：$KEEP_LIST" >&2; exit 2; }
  n_keep=$(grep -c . "$KEEP_LIST" || true)
  # 与 EXPORT_IF_DEFINED（下面那个逗号串口子）合并：两条路都是 --export-if-defined
  EXPORT_IF_DEFINED="${EXPORT_IF_DEFINED:-}"
  KEEP_FLAGS=()
  while read -r _sym; do
    [ -n "$_sym" ] || continue
    KEEP_FLAGS+=( "-Wl,--export-if-defined=$_sym" )
  done < "$KEEP_LIST"
  echo "== KEEP_LIST：$n_keep 个保活符号（$KEEP_LIST）"
else
  KEEP_FLAGS=()
fi

# GL_LIBS=1 时给**最终链接**补 GLES 仿真旗标：
#   · `-sFULL_ES2=1` 是 gl4es 的 COMPILE.md **要求** —— 真 GLES2 入口（以及 gl4es 用来取
#     它们的 `emscripten_GetProcAddress`）由它带进来。
#   · `-sFULL_ES3=1` 是 2026-09-23 加的**加试项**（用户点名要）。要分清两件事：**上下文本来
#     就是 WebGL2**（`webgl_toolkit.cc` 里 `attrs.majorVersion = 2`），而 FULL_ES3 管的是
#     emscripten 那一层 **GLES3 API 模拟**。实测加它之后图形验收 61/61、全量回归全绿
#     （见 NOTES-webgl.md §4.6）；若哪天它引起回归，去掉这一项只留 ES2 即可（gl4es 只要求 ES2）。
GL_ES_FLAGS=()
if [ "${GL_LIBS:-0}" = "1" ]; then
  GL_ES_FLAGS=( -sFULL_ES2=1 -sFULL_ES3=1 )
fi

# EXPORTED_FUNCS：逗号分隔的导出符号名（默认只有 `_main`）。
# ⚠️ 为什么要有这个口子：`MAIN_MODULE=2`（DCE 版）下，**JS 库符号也要列进导出**
#    才会进 JS 胶水的符号表（`tools/emscripten.py:868-884` 只把
#    `EXPORTED_FUNCTIONS + SIDE_MODULE_IMPORTS` 里的库函数加进去）——
#    side module 里的 `emscripten_run_script`（webnet 那套同步 XHR）就靠它解析。
#    实测踩过：把它写进 EXTRA_LDFLAGS **没用**，因为下面那行 `-s EXPORTED_FUNCTIONS=`
#    在后面会把它覆盖掉（`-s` 后者胜）。
#    M2 车道用：EXPORTED_FUNCS="_main,emscripten_run_script,exit,__assert_fail"
EXPORTED_FUNCS="${EXPORTED_FUNCS:-_main}"
EF_JSON="["
IFS=',' read -r -a _ef <<< "$EXPORTED_FUNCS"
for _f in "${_ef[@]}"; do EF_JSON="$EF_JSON\"$_f\","; done
EF_JSON="${EF_JSON%,}]"
echo "== EXPORTED_FUNCTIONS = $EF_JSON"

# EXPORT_IF_DEFINED：逗号分隔的符号名，**只导出确实有定义的**（未定义的静默忽略）。
# 为什么需要它（2026-09-23，SLICOT 那一批查出来的）：side module 解析导入时
# **只能看主模块的导出表**，而主模块并没有把所有 LAPACK/BLAS 符号导出去
# （实测：50533 个函数里只导出 44738 个，`dgemm_`/`dgetrf_`/`dggev_` 都不在其中）。
# 那时 `.oct` 调用就落到 emscripten 的 stub 上，报 `TypeError: resolved is not a function`。
# ⚠️ 别用 EXPORTED_FUNCTIONS 干这事：它对**未定义**的符号是硬错误
# （实测踩过：`__assert_fail`/`emscripten_run_script` 不是 wasm 导出 → 链接直接失败），
# 而这里要传的是一大串「可能有、可能没有」的候选名。
# ⚠️ 也别用 emscripten 的 `-s EXPORT_IF_DEFINED=`：那是**内部设置**，命令行为拒绝
# （实测：`em++: error: EXPORT_IF_DEFINED is an internal setting and cannot be set
#  from command line`）。直接用 lld 的 `-Wl,--export-if-defined=`（emscripten 自己的
# 链接行里就是这么传 `__start_em_asm` 那一串的）。
EXPORT_IF_DEFINED="${EXPORT_IF_DEFINED:-}"
EID_FLAGS=()
if [ -n "$EXPORT_IF_DEFINED" ]; then
  IFS=',' read -r -a _eid <<< "$EXPORT_IF_DEFINED"
  for _f in "${_eid[@]}"; do EID_FLAGS+=( "-Wl,--export-if-defined=$_f" ); done
  echo "== EXPORT_IF_DEFINED = ${#_eid[@]} 个候选符号（未定义的静默忽略）"
fi

# LIB_FUNCS：逗号分隔的 **JS 库函数**名，加进主模块的 JS 胶水
#   （`-s DEFAULT_LIBRARY_FUNCS_TO_INCLUDE=`）。
# 为什么需要（2026-09-23，P5 的 OSMesa toolkit 撞上）：side module 能解析的 JS 库函数
# 集合 = 主模块胶水里有的那些；而胶水的集合来自
#   `EXPORTED_FUNCTIONS + SIDE_MODULE_IMPORTS + DEFAULT_LIBRARY_FUNCS_TO_INCLUDE`
# （`tools/emscripten.py:880` 与 `tools/link.py:2876`）。后两者本是**给"主链命令行上的
# side module"自动收集导入用的**，而我们的 `.oct` 走**资产车道**、不在主链命令行上
# ⇒ 它们的 JS 导入不会被自动收进来。于是 `.oct` 里对 `emscripten_longjmp` 的引用
# 成了"必需未定义"，加载器的 `reportUndefinedSymbols()` 去读 `undefined.value`，
# 报出 `TypeError: Cannot read properties of undefined (reading 'value')` ——
# 又是一条"报错骗人"（真名靠诊断补丁才看到）。
# ⚠️ **别用 EXPORTED_FUNCTIONS 传这些名字**：实测 `undefined exported symbol`
#   硬错误（带下划线 `_emscripten_longjmp` 与不带下划线都一样），因为那一路会被
#   直接喂给 lld 当 `--export=`。
# GL_LIBS=1：主链带上 OpenGL。用途：P5 图形线走"**主 wasm 带 GL**"那条路
# （A 档"把 Mesa 全打进 .oct"试到底后放弃；三道墙的实测在 git 历史里
#  build/113/osmesa_toolkit.cc 的文件头注释里，见 NOTES-p5-osmesa.md）。
# 为什么需要这个开关：树一旦用 `WITH_OPENGL=1` 重配，Octave 的
# `LIBOCTINTERP_LINK_DEPS` 里就有 `-lGL -lGLU`，而本脚本的 web 主链是**自己写的链接行**，
# 得自己把它们补上（补在归档**之后**：静态库按左到右解析）。
#
# GL 垫片：**2026-09-23 起只有 gl4es 一条**（OSMesa/glshim 已退役）。
# gl4es = **OpenGL 1.5/2.1 → GLES2 → WebGL2（GPU）** 的翻译库，官方带 Emscripten 目标；
# 立即模式（`glBegin/glEnd`）是它自带实现 —— 而 emscripten 自带的 `LEGACY_GL_EMULATION`
# 在这件事上是实测失败的（Edge-Tools 死在 `glEnd: numVertices must be an integer`）。
# `GL_BACKEND` 这个名字保留下来只为"给错值就明确失败"，不再有第二条分支。

# GL_LIBS=1：主链带 GL 垫片。**2026-09-23 起只剩 gl4es 一条**（OSMesa 已退役，
# 见下），但保留 `GL_BACKEND` 这个名字：给错值就**明确失败**，免得静默链成别的东西。
#   ① 归档 = gl4es 的 `libGL.a`（4.74MB，"OpenGL 1.5/2.1 → GLES2" 的翻译库）+
#      "gl 走 gl4es、glu 保持原名"的 GLU（`build/113/build-glu-webgl.sh` 产出的那份）；
#   ② 最终链接加 `-sFULL_ES2=1`（见上面 GL_ES_FLAGS）。
#   ⚠️ 必须**绝对路径**，不能用 `-lGL` —— 实测 emcc 会把 `-lGL` 改写进它**自带**的
#      GL 仿真库（`sysroot/lib/wasm2-emscripten/libGL-emu-*.a`），我们那份根本不被搜索，
#      报一堆 `undefined symbol: gl4es_glBegin`。见 NOTES-webgl.md §3.6 坑 2。
#      （与 `-lGLU` 那个坑是同一族 ⇒ 自己建的归档一律绝对路径。）
GL_FLAGS=()
GL_INC_FLAGS=()
if [ "${GL_LIBS:-0}" = "1" ]; then
  GL_BACKEND="${GL_BACKEND:-webgl}"
  if [ "$GL_BACKEND" != "webgl" ]; then
    echo "FATAL: GL_BACKEND='$GL_BACKEND' —— OSMesa 后端已于 2026-09-23 退役，这里只有 webgl。" >&2
    echo "       若确实要重建 OSMesa 那条链：脚本与配方在 git 历史里的 graphics-osmesa 分支" >&2
    echo "       （build/113/osmesa_toolkit.cc + patch-mesa-osmesa-static.sh），并参考 NOTES-p5-osmesa.md。" >&2
    exit 3
  fi
  GL_FLAGS=( /src/libwork/gl4es-src/lib/libGL.a /src/libwork/glu-webgl/lib/libGLU.a
             "$SRC/gl4es-unmangled-shim.c" )
  # include 顺序**很重要**：gl4es 的 `GL/gl.h` 会把 `glBegin` 之类 mangle 成
  # `gl4es_glBegin`；而 GLU 自己那份 `GL/glu.h` 必须保持原名（`gl-render.o` 引用的是
  # 裸 `gluNewTess`）。所以：gl4es 先（拿 mangled 的 gl.h），GLU 的 include 只提供 glu.h。
  GL_INC_FLAGS=( -I/src/libwork/gl4es-src/include )
  echo "== GL_LIBS=1：gl4es（→WebGL2/GPU） + glu-webgl —— 绝对路径 + FULL_ES2/ES3"
fi

# gl2ps：Octave 的 `print` 矢量输出（`__opengl_print__.m` 全程围绕 gl2ps 写，
# **不会**调用 toolkit 的 `print_figure`）。树一旦用 `WITH_GL2PS=1` 重配过
# （`config.h` 里 `HAVE_GL2PS_H` = 1，配方见 build/113/build-gl2ps.sh），
# liboctinterp 就会引用 gl2ps 的符号 —— 这里必须补上，否则因为
# `ERROR_ON_UNDEFINED_SYMBOLS=0` 会被**静默放过**，运行期才炸。
# 存在就自动加（两条图形线都受益），不存在就是 no-op。
GL2PS_FLAGS=()
if [ -f /src/deps/gl2ps/lib/libgl2ps.a ]; then
  # 绝对路径（老规矩：`-l` 会被 emcc 的库解析规则吃掉，见 NOTES-webgl.md §3.6 坑 2）
  GL2PS_FLAGS=( /src/deps/gl2ps/lib/libgl2ps.a )
  echo "== gl2ps：链 $(basename /src/deps/gl2ps/lib/libgl2ps.a)（print 的矢量输出）"
fi

LIB_FUNCS="${LIB_FUNCS:-}"
LF_FLAGS=()
if [ -n "$LIB_FUNCS" ]; then
  IFS=',' read -r -a _lf <<< "$LIB_FUNCS"
  LF_JSON="["
  for _f in "${_lf[@]}"; do LF_JSON="$LF_JSON\"$_f\","; done
  LF_JSON="${LF_JSON%,}]"
  LF_FLAGS=( -s "DEFAULT_LIBRARY_FUNCS_TO_INCLUDE=$LF_JSON" )
  echo "== DEFAULT_LIBRARY_FUNCS_TO_INCLUDE = $LF_JSON"
fi

LIBS=(
  # Octave 自身的三个归档
  "$OCT/libinterp/.libs/liboctinterp.a"
  "$OCT/liboctave/.libs/liboctave.a"
  "$OCT/libgnu/.libs/libgnu.a"
  # 各库的独立 prefix（② 建的）
  -L/src/deps/glpk/lib -L/src/deps/qhull/lib -L/src/deps/fftw/lib
  -L/src/deps/sndfile/lib -L/src/deps/qrupdate/lib -L/src/deps/hdf5/lib
  -L/src/deps/zlibbz2/lib -L/src/deps/arpack/lib -L/src/deps/suitesparse/lib
  -L"$DEPS/lib"
  # 早期四个 + Octave 自己报的链接依赖（LIBOCTINTERP_LINK_DEPS / LIBOCTAVE_LINK_DEPS）
  -llapack -lrefblas -lf2c -lpcre2-8
  -lhdf5
  # ⚠️ zlib/bz2 必须 **--whole-archive**：`.oct`（gzip/webio）依赖 zlib 的
  #   流式接口（deflate/inflate/gzopen/crc32），而 Octave 核心自己**不引用**它们
  #   → 静态库按需拉取时那些对象不会被带进来 → 既不在主模块里、也不在导出表里
  #   → .oct 导入解析不到 → 调用即整页 trap（实测）。
  # ⚠️ 不要用 --whole-archive 整库拉 zlib/bz2：实测那样会把 convhulln 与 glpk
  #   弄崩（整库引入的符号与 qhull/glpk 撞车 → `.oct` 的导入解析到错的东西 →
  #   调用打到 emscripten 的 stub，报 "TypeError: resolved is not a function"）。
  #   改用**定点拉取**：只 `-u` 出 `.oct` 真正需要的那几个符号，
  #   链接器会只把定义它们的那些对象拉进来，没有附带损伤。
  -Wl,-u,deflate -Wl,-u,deflateEnd -Wl,-u,deflateInit2_ -Wl,-u,deflateSetHeader
  -Wl,-u,inflate -Wl,-u,inflateEnd -Wl,-u,inflateInit2_
  -Wl,-u,gzopen -Wl,-u,gzclose -Wl,-u,gzread -Wl,-u,crc32
  -Wl,-u,BZ2_bzCompress -Wl,-u,BZ2_bzCompressInit -Wl,-u,BZ2_bzCompressEnd
  -Wl,-u,BZ2_bzDecompress -Wl,-u,BZ2_bzDecompressInit -Wl,-u,BZ2_bzDecompressEnd
  -lz -lbz2
  -lcholmod -lumfpack -lamd -lcamd -lcolamd -lccolamd -lcxsparse -lsuitesparseconfig
  -lfftw3 -lfftw3f -larpack -lqrupdate
  # ⚠️ 这三个**不在** LIB*_LINK_DEPS 里（它们只被 dldfcn 用），但必须链进主模块：
  #   `.oct` 是 side module、**不链任何库**，装载时靠主模块解析符号——
  #   qhull ← convhulln/__delaunayn__/__voronoi__，glpk ← __glpk__，sndfile ← audioread。
  #   7.2 的 Makefile 注释里专门记了这条（"下面这一串 -l 一个都不能删"）。
  -lglpk -lqhull_r -lsndfile
  -lm
)

# ---- FreeType（WITH_FREETYPE=1）：文字渲染 ------------------------------------
# `ft-text-renderer.o` 现在会引用 `FT_*`（HAVE_FREETYPE=1），必须链进主模块。
# 用**我们自己那份 PIC 归档**（`build/113/build-freetype.sh` → /src/deps/freetype），
# 而不是 emscripten 端口的（那份非 PIC，与 MAIN_MODULE 的可重定位要求不是一路）。
# 定序：freetype 依赖 zlib（`FT_CONFIG_OPTION_SYSTEM_ZLIB`）⇒ 放在 `-lz -lbz2` **之后**
# （静态库左到右解析）。
if [ "${WITH_FREETYPE:-0}" = "1" ]; then
  [ -f /src/deps/freetype/lib/libfreetype.a ] || {
    echo "FATAL: 缺 /src/deps/freetype/lib/libfreetype.a（先跑 build/113/build-freetype.sh）" >&2; exit 2; }
  LIBS+=( -L/src/deps/freetype/lib -lfreetype )
  echo "== FreeType：链 /src/deps/freetype/lib/libfreetype.a"
fi

# ---- fontconfig（WITH_FONTCONFIG=1，R3 2026-09-24）：字体**匹配** ----------------
# `ft-text-renderer.o` 在 `HAVE_FONTCONFIG` 下会引用 `Fc*`（列字体表 + `FcFontMatch`
# 把 family/style/codepoint 变成**具体字体文件**）⇒ 必须链进来。定序照静态库的规矩：
#   -lfontconfig → -lfreetype（fcfreetype.o 用 FT_*）→ -lexpat（fontconfig 的 XML 后端）
#   → -lz（freetype 用）。freetype 已经在上面那一行，这里只需补前后两段。
if [ "${WITH_FONTCONFIG:-0}" = "1" ]; then
  for a in /src/deps/fontconfig/lib/libfontconfig.a /src/deps/expat/lib/libexpat.a; do
    [ -f "$a" ] || { echo "FATAL: 缺 $a（先跑 build/113/build-fontconfig.sh）" >&2; exit 2; }
  done
  LIBS+=( -L/src/deps/fontconfig/lib -lfontconfig -L/src/deps/expat/lib -lexpat )
  echo "== fontconfig：链 libfontconfig.a + libexpat.a（字体匹配；运行期配置见下面的预载）"
fi

#  ---- 异常模式：必须与整棵树一致 -------------------------------------------
#  实测坑：给 main.o 用 `-fwasm-exceptions`（原生 wasm 异常）而树用 `-fexceptions`
#  （emscripten 的 JS 式异常，链接行里带 -mllvm -enable-emscripten-cxx-exceptions
#   -mllvm -enable-emscripten-sjlj）→ 链接期断言失败：
#     AssertionError: invoke_ functions exported but exceptions and longjmp are both disabled
#  所以**编译 main.cc 与最终链接都用 `-fexceptions`**，与 configure 时给
#  CXXFLAGS 的口径一致。
EXC_FLAGS=( -O2 -fPIC -std=c++17 -fwasm-exceptions )

# P5_TOOLKIT=1：把 **webgl graphics toolkit 编进主模块**（不是 `.oct`）。
# 为什么必须进主模块：`opengl_functions`（GL 函数表）的**虚表跨模块会失效** ——
# `opengl_renderer`（opengl-on 后编在主模块里）通过 `m_glfcns.xxx()` 回调，
# 对象若由 side module 创建，主模块那边的间接调用会打到不属于它的表槽上
# （实测 `RuntimeError: table index is out of bounds`，栈顶正是
#  `octave::opengl_renderer::set_viewport(int, int)`）。
# Edge-Tools 的参考实现也是这个形态（toolkit 编进主模块）。
# 依赖：`GL_LIBS=1`（主链带 gl4es/GLU）+ 主树 `WITH_OPENGL=1` 重配重编。
# 把 gl4es 的 include 放在**所有 GL 头之前** —— 这是这条线能成的关键，见 NOTES-webgl.md §3.2。
# （2026-09-23 之前这里还有一条 OSMesa 分支，已随该后端退役删掉；`GL_BACKEND` 给别的值
#   会在上面 GL_FLAGS 那段明确失败。）
P5_OBJS=()
if [ "${P5_TOOLKIT:-0}" = "1" ]; then
  echo "== P5_TOOLKIT=1：编 webgl graphics toolkit 进主模块"
  P5_SRC="$SRC/webgl_toolkit.cc"
  P5_DEF=-DP5_WEBGL_TOOLKIT
  P5_TK_INCS=( -I/src/libwork/gl4es-src/include )
  P5_TK_OBJ="$SRC/webgl_toolkit.o"

  em++ -I"$OCT" -I"$OCT/liboctave" -I"$OCT/liboctave/array" -I"$OCT/liboctave/util" \
       -I"$OCT/libinterp" -I"$OCT/libinterp/corefcn" -I"$OCT/libinterp/octave-value" \
       -I"$OCT/libinterp/parse-tree" -I"$INST/include/octave-$MV" \
       -I"$INST/include/octave-$MV/octave" \
       ${P5_TK_INCS[@]+"${P5_TK_INCS[@]}"} \
       -I/src/vendor/stb \
       -DHAVE_CONFIG_H ${P5_DEF} ${P5_GLPROBE:+ -DP5TK_GLPROBE} ${P5_TRACE:+ -DP5TK_TRACE} -std=c++17 \
       "${EXC_FLAGS[@]}" -c "$P5_SRC" -o "$P5_TK_OBJ"
  echo "   $(basename "$P5_TK_OBJ") = $(stat -c%s "$P5_TK_OBJ") 字节"
  P5_OBJS=( "$P5_TK_OBJ" )
fi

echo "== 编 main.cc"
em++ -I"$INST/include" -I"$INST/include/octave-$MV" -I"$INST/include/octave-$MV/octave" \
     ${P5_OBJS:+ $P5_DEF} \
     "${EXC_FLAGS[@]}" ${JSPI_DEF[@]+"${JSPI_DEF[@]}"} -c "$SRC/main.cc" -o "$SRC/main.o"
echo "   main.o = $(stat -c%s "$SRC/main.o") 字节"

cd "$SRC"
# DIAG_NAMES=1：加 `--profiling-funcs`，**产物里保留函数名**（name 段）。
#   为什么要它：线上产物是 `--strip-debug` 的，wasm 里只有 `dylink.0` 一个 custom
#   段，**没有 name 段** → 浏览器报的 `RuntimeError: unreachable at
#   wasm-function[NNNNN]` 没法翻译成函数名（`lsode` 那个整页 trap 就卡在这）。
#   诊断时这样链一次到独立目录，就能把索引符号化；**别拿它当部署产物**（更大）。
#   用法：DIAG_NAMES=1 bash link-web.sh /src/websrc/diag
DIAG=()
[ "${DIAG_NAMES:-0}" = "1" ] && { DIAG=( --profiling-funcs ); echo "== DIAG_NAMES=1：保留函数名（name 段）"; }
# DIAG_ASSERT=1：打开 emscripten 的运行时断言（-s ASSERTIONS=1）。
#   为什么需要：浏览器只给一句 `RuntimeError: unreachable`，看不出 abort 的原因。
#   开了断言之后，多数 abort 会在 console 里打出可读原因（越界、未捕获异常、
#   栈溢出……）。和 DIAG_NAMES 一起用，就能"有名字 + 有原因"。
[ "${DIAG_ASSERT:-0}" = "1" ] && { DIAG+=( -s ASSERTIONS=1 ); echo "== DIAG_ASSERT=1：打开运行时断言"; }
# DIAG_SOURCEMAP=1：产出 octave.wasm.map，把 wasm 偏移映射回源码行。
#   用途：浏览器只报 `wasm-function[N]:0x<文件偏移>`，有了 source map 就能翻成
#   `文件:行`（本仓的 wasm-opt/wasm-dis 不带 dwarfdump，只能走这条路）。
[ "${DIAG_SOURCEMAP:-0}" = "1" ] && { DIAG+=( -g -gsource-map ); echo "== DIAG_SOURCEMAP=1：产出 source map"; }

# ---- IDBFS（持久化）：**必须显式 -lidbfs.js**（2026-09-24 实测）--------------------
# Emscripten 默认只编 MEMFS 进去：没有这一行，`Module.FS.filesystems` 实测只有
# `["MEMFS"]`（IDBFS/NODEFS 都是 undefined），`FS.mount`/`FS.syncfs` 虽然在，**没有可挂的
# 持久文件系统** ⇒ 页面侧 `FS.mount(IDBFS, {}, '/home/web_user')` 一定失败。
# （挂载点就选 `/home/web_user`：实测 `getenv('HOME')` 正是它。）
# ⚠️ **注释不能写进下面那条 `\` 续行的命令里**（会被当成 emcc 的输入参数，报 "no input files"
#    —— 这个坑本仓在 JSPI 那轮踩过），所以说明一律写在命令**上面**。
IDBFS_FLAGS=( -lidbfs.js )

# ---- JSPI（G1，2026-09-24）：异步入口 `eval_async` 的运行期基础 -------------------
# **为什么必须显式加**：libembind 里写明 `async bindings are only supported with JSPI`
#（实测 emsdk 5.0.7）⇒ `main.cc` 里的 `emscripten::function("eval_async", …, async())`
# 在**没有** `-sJSPI` 时编得过、链接过，运行时才炸 —— 属于"静默陷阱"那一类。
#
# 三条实现要求（全都撞过，见 `build/113/NOTES-jspi.md`）：
#   ① 每个"可能间接挂起"的 JS 入口都要在 `-sJSPI_EXPORTS` 里（V8 要求**挂起点所在整条入口**
#      都是 promising；只列最外层的那个不够）；
#   ② JSPI 边界**不传 JS 字符串**（要 `ccall`/`cwrap`）—— 传了会得到 NULL，
#      于是 `dlopen(NULL)` 返回主模块句柄、症状极像"没导出符号"；
#   ③ side module 要**显式导出**符号（不写就是 `-O2` DCE 后的 64 字节空壳）。
#
# ★ 产物形状是**单产物 + 运行时能力门**（Gate 0 已实测：把 `WebAssembly.Suspending`/
#   `promising` 删掉之后，带 `-sJSPI` 的产物**仍然能加载**，只是被包过的导出不存在）
#   ⇒ 不抬浏览器下限、不维护两条车道。页面侧的门在 `bridge/index.html` 的 `__octaveJspi`。
# `WITH_JSPI=0` 可以关掉（对照组用；关了 `eval_async` 就不存在，页面会如实报 no-entry）。
# ⛔ **2026-09-24 起默认关闭**：G1 第一次尝试失败（`RuntimeError: null function`，一调还把页面卡死），
#    已把产物回退。**在机制没于小复现里证明之前，别把它做成默认** —— 免得谁重链一次就拿到坏产物。
#    开启时同时给编译期宏 `-DJSPI_EVAL_ASYNC=1`（main.cc 里那个绑定在 `#if` 里；宏不加就编不进去，
#    这样"关掉"是真的关掉，不是留一个坏绑定在产物里）。
JSPI_FLAGS=(); JSPI_DEF=()
if [ "${WITH_JSPI:-0}" = "1" ]; then
  JSPI_FLAGS=( -sJSPI -sJSPI_EXPORTS=eval_async )
  JSPI_DEF=( -DJSPI_EVAL_ASYNC=1 )
  echo "⚠⚠ WITH_JSPI=1：这是**实验车道** —— G1 的 eval_async 目前实测是坏的（见 HISTORY §5.43）"
else
  echo "== JSPI 关闭（默认）：不加 -sJSPI、不编 eval_async ⇒ 与现役产物一致"
fi

set -x
# EXTRA_LDFLAGS：诊断/定点补救用（空格分隔的链接旗标）。
#   当前用途：`-Wl,-u,dlsode_` —— 强制把 odepack 的入口从归档里拉进主模块
#   （`lsode` 整页 trap 的候选根因：dlsode_ 没被链进来，调用落到空导入 → trap；
#    与 HISTORY §10.3 坑 3 的 zlib 完全同一类问题、同一个修法）。
em++ --bind \
  "${DIAG[@]}" \
  "${SFLAGS[@]}" \
  ${GL_ES_FLAGS[@]+"${GL_ES_FLAGS[@]}"} \
  ${EXTRA_LDFLAGS:-} \
  ${GL_INC_FLAGS[@]+"${GL_INC_FLAGS[@]}"} \
  -s "EXPORTED_FUNCTIONS=$EF_JSON" \
  ${EID_FLAGS[@]+"${EID_FLAGS[@]}"} \
  ${KEEP_FLAGS[@]+"${KEEP_FLAGS[@]}"} \
  ${LF_FLAGS[@]+"${LF_FLAGS[@]}"} \
  -s EXPORTED_RUNTIME_METHODS='["FS","MEMFS","IDBFS"]' \
  -s MODULARIZE=1 -s EXPORT_NAME=OCTAVE -s ENVIRONMENT=web -s EXPORT_ES6=0 \
  "${PRELOAD[@]}" \
  --post-js "$SRC/post.js" \
  "${EXC_FLAGS[@]}" -Wl,--allow-multiple-definition \
  "${LIBS[@]}" \
  "${IDBFS_FLAGS[@]}" \
  ${GL2PS_FLAGS[@]+"${GL2PS_FLAGS[@]}"} \
  ${GL_FLAGS[@]+"${GL_FLAGS[@]}"} \
  -o "$OUT/octave.js" "$SRC/main.o" ${P5_OBJS[@]+"${P5_OBJS[@]}"}
set +x

# ---- 自检：预载路径有没有错位 ------------------------------------------------
# 专防上面那个 `@ftp` 坑复发：`--preload-file` 按第一个 `@` 切 src@dst，源路径里
# 只要有 `@`，整棵目录就会被搬到错误的地方（实测代价：**5.25MB 重复数据 /
# octave.data 翻倍**）。跑完直接查文件表，错位就**明确失败**，别静默出包。
if grep -q 'filename:"/ftp@' "$OUT/octave.js"; then
  echo "FATAL: 预载路径错位 —— octave.js 里出现 /ftp@/ 前缀的记录" >&2
  echo "       说明 m/ 下某个源目录名里含 '@' 且没走 PRELOAD_AT 暂存那条路" >&2
  echo "       （octave.data 会比正常大一倍，且该目录的文件不在正确路径上）" >&2
  exit 3
fi

# ---- 自检：GL 后端到底进没进产物 ---------------------------------------------
# 为什么要查**产物**而不是只查输入：`ERROR_ON_UNDEFINED_SYMBOLS=0` 会把未定义符号
# **静默放过**（历史上真踩过：gl4es 的入口没被解析，链接"成功"，运行期第一次 GL 调用
# 才炸）。所以这里直接看二进制：
#   · 必须含 `gl4es_gl*`（gl4es 那些 mangled 入口名进了符号表 ⇒ 后端真的是 gl4es）
#   · 必须**不含** `OSMesaMakeCurrent`（OSMesa 已退役；出现就说明链错了后端）
if [ "${GL_LIBS:-0}" = "1" ]; then
  if ! grep -qa 'gl4es_gl' "$OUT/octave.wasm"; then
    echo "FATAL: octave.wasm 里找不到 gl4es_gl* —— GL 后端没进产物" >&2
    exit 3
  fi
  if grep -qa 'OSMesaMakeCurrent' "$OUT/octave.wasm"; then
    echo "FATAL: octave.wasm 里出现 OSMesaMakeCurrent —— 链到了已退役的 OSMesa 后端" >&2
    exit 3
  fi
  if [ -n "${P5_OBJS[*]:-}" ] && ! grep -qa 'gl4es_gl' "${P5_OBJS[0]}"; then
    echo "FATAL: toolkit 目标文件里没有 gl4es_gl*（编译时 gl4es 的 include 没生效？）" >&2
    exit 3
  fi
  echo "== GL 自检: gl4es_gl* 出现 $(grep -oa 'gl4es_gl' "$OUT/octave.wasm" | wc -l) 次，OSMesa 残留 0 处，octave.wasm $(stat -c%s "$OUT/octave.wasm") 字节"
fi

# ---- 自检（M2 专用）：**保活完整性** ------------------------------------------
# 为什么必须在**链接这一层**做：M2 只导出保活集，而 `.oct` 的导入在**装载期**才解析 ——
# 缺一个符号，链接期一声不响，运行期炸成 `TypeError: resolved is not a function` 或
# `Cannot read properties of undefined (reading 'value')`（后者连符号名都看不见）。
# 判据见 check-oct-imports.py 的文件头：与**基线（今天在跑的 M1 产物）**差分 ——
# 只在"基线导得出、新构建导不出"时报失败；JS 库符号（M1 靠 JS 胶水全可见）单列一类。
if [ "$MAIN_MODULE_LEVEL" = "2" ]; then
  OCT_SCAN_DIRS="${OCT_SCAN_DIRS:-}"
  if [ -z "$OCT_SCAN_DIRS" ]; then
    echo "⚠ MAIN_MODULE=2 但没给 OCT_SCAN_DIRS ⇒ **跳过保活完整性检查**" >&2
    echo "  （别这么部署：给一个能扫到全部 .oct 的目录列表，例如站点 assets 下那几个）" >&2
  else
    # --js-provided：把 LIB_FUNCS 里显式暴露过的 JS 库符号告进去 —— 它们在 wasm 导出表里
    # 查不到（不是 wasm 导出），但 M2 下**确实**能解析（实测：emscripten_run_script /
    # __assert_fail / abort / exit 四个都靠 LIB_FUNCS 在 M2 上跑通了 accept-net / image /
    # slicot / forge2）。不告的话闸门会把一个合法产物拦下来。
    python3 "$HERE/check-oct-imports.py" "$OUT/octave.wasm" $OCT_SCAN_DIRS \
      ${LIB_FUNCS:+--js-provided "$LIB_FUNCS"} \
      ${BASELINE_WASM:+--baseline "$BASELINE_WASM"} || {
        echo "FATAL: M2 产物的保活集不完整（见上面逐条）—— 不部署" >&2; exit 4; }
  fi
fi

# ---- 自检：FreeType 字体到底进没进产物 ----------------------------------------
# 与 /ftp@ 那条同类：预载**成功**与"字体真的在产物里"是两件事（路径写错、`@` 切错、
# 文件系统上没有都会静默少东西），而少字体的表现是"文字空白"——在浏览器里很难一眼看出
# 是"没编 FreeType"还是"没预载字体"。所以直接查产物。另外查 HAVE_FREETYPE 的反面：
# 产物里**不该**再出现 `FreeType) was unavailable or disabled` 的警告文案。
if [ -n "$FONTS_PRELOAD_TAG" ]; then
  grep -q "FreeSans.otf" "$OUT/octave.js" || {
    echo "FATAL: octave.js 里没有 FreeSans.otf 的预载记录 ⇒ 文字会空白" >&2; exit 3; }
  # 2026-09-24 起还要 FreeMono ×4（`fontname="FreeMono"` 才真的换家族，见上面那段注释）：
  # 「预载成功了」与「四个面都在」是两件事，逐个点名查，缺一个就报出来。
  for _mf in FreeMono.otf FreeMonoBold.otf FreeMonoOblique.otf FreeMonoBoldOblique.otf; do
    grep -q "$_mf" "$OUT/octave.js" || {
      echo "FATAL: octave.js 里没有 $_mf 的预载记录 ⇒ 等宽家族名会静默落回 FreeSans" >&2; exit 3; }
  done
  echo "== FreeType 自检: 产物里含 $(grep -o 'Free\(Sans\|Mono\)[A-Za-z]*\.otf' "$OUT/octave.js" | sort -u | tr '\n' ' ')"
fi

# ---- 自检：IDBFS 到底有没有编进去（2026-09-24）----------------------------------
# 症状与"没写 -lidbfs.js"完全一致：页面里 `FS.filesystems` 只有 MEMFS、`FS.mount(IDBFS,…)`
# 抛错，而构建期**一声不响**。⇒ 直接查产物里的 IDBFS 实现与运行时导出表。
if [ "${#IDBFS_FLAGS[@]}" -gt 0 ]; then
  grep -q "IDBFS" "$OUT/octave.js" || {
    echo "FATAL: octave.js 里没有 IDBFS（-lidbfs.js 没生效？）⇒ 页面挂不上持久文件系统" >&2; exit 3; }
  grep -q '"IDBFS"' "$OUT/octave.js" || {
    echo "FATAL: octave.js 的 EXPORTED_RUNTIME_METHODS 里没有 IDBFS" >&2; exit 3; }
  echo "== IDBFS 自检: octave.js 里有 IDBFS 实现 + 运行时导出"
fi

# ---- 自检：fontconfig 的配置到底进没进产物 --------------------------------------
# 缺配置的**症状**与"没编 fontconfig"几乎一样（`listfonts()` 报错、`fontname` 不生效），
# 只有 `FONTCONFIG_FILE` 指向的那份文件在不在能区分：所以这里两头都查 ——
#   ① 产物里要有预载记录（`/fonts/fonts.conf`）；
#   ② 主模块的字符串里要有 `setenv` 写进去的那个路径（main.cc 改动了才会有）。
# 查 ② 就是查"main.cc 那两行真的进了这次链接"（忘 `docker cp`/忘重编时最容易漏）。
if [ -n "$FONTCONFIG_PRELOAD_TAG" ]; then
  grep -q "fonts.conf" "$OUT/octave.js" || {
    echo "FATAL: octave.js 里没有 fonts.conf 的预载记录 ⇒ fontconfig 读不到配置（0 个 face 且不报错）" >&2; exit 3; }
  echo "== fontconfig 自检: octave.js 里有 fonts.conf 预载记录"
  if grep -qa "FONTCONFIG_FILE" "$OUT/octave.wasm"; then
    echo "== fontconfig 自检: 主模块里有 FONTCONFIG_FILE 字符串（main.cc 的 setenv 生效）"
  else
    echo "FATAL: 主模块里找不到 FONTCONFIG_FILE ⇒ main.cc 的 setenv 没进产物（重编了 main.cc 吗？）" >&2
    exit 3
  fi
fi

echo "== 产物:"
ls -la "$OUT"
