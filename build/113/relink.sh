#!/usr/bin/env bash
# Octave-Full-Wasm — **重链的唯一入口**（D1；批次 A1，2026-09-26）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# ═══════════════════════════════════════════════════════════════════════════════
# 为什么有它（`build/113/PLAN-arch.md` §1.1）
#
# `link-web.sh` 读 **22 个环境变量**（复跑：见 §4.2）。其中只有 2 个"值写错会当场报错"
# （`GL_BACKEND` / `MAIN_MODULE_LEVEL`），**所有"漏写"都是静默**；而它的**六组产物自检
# 全部在"开了才查"的分支里**（`:553`/`:588`/`:610`/`:632`/`:647`/`:661`）—— 漏一个开关
# ⇒ 自检整块跳过、构建/链接/自检**全绿**，产物却是另一个形态。
# 以前要把一条命令拼对，得在 8 份文档之间来回加法规约（HISTORY §5.26 + §5.38 + §5.54
# + AGENTS 事实纪律 + NOTES…）。本文件把那些"口径"**搬进代码**：模式决定全部 22 个变量，
# **一个都不许手设**（管道变量漏一个同样静默退化，例如漏 `OCT_SCAN_DIRS` ⇒ 保活闸门被跳过）。
#
# ═══════════════════════════════════════════════════════════════════════════════
# 三个模式（意图命名；**产物目录名 == 模式名**，`m2fc-simd-out` 那类名字就此退役）
#
#   m1       M1（无 DCE）= **保活闸门的差分基线**：导出面最全。它是下面两级的前提。
#   scalar   M2 + JSPI + 字体 + GL + IDBFS，**但不带 SIMD BLAS** —— `product` 的 A/B 对照
#            （DGEMM 的 1.62×/1.75×/1.31× 就是拿它比的）。
#   product  **现役形态**：scalar + SIMD BLAS（`-L/src/deps/lapack-simd/lib`）。
#
# 基线链（结构优先）：每一级拿**下一级模式的产物**当保活基线
#   m1 → scalar → product
# 如果下一级的产物还不存在，就退回表里记录的现存路径并**如实打印用了哪一个**（基线路径与
# sha 都会记进产物身份证 —— "基线是哪个产物"第一次成为可查的事实，而不是记忆）。
# ⚠️ `BASELINE_WASM` **只喂保活闸门**（`link-web.sh:622` 的 `--baseline`），**不进链接行**
#    ⇒ 换基线**不改变产物字节**（复跑：`grep -n BASELINE_WASM build/113/link-web.sh` 只有一处）。
#
# ═══════════════════════════════════════════════════════════════════════════════
# fail-closed：链接结束后 `check-build-manifest.py` 拿**模式的声明**核对**产物的量测**
#   · 过 ⇒ `octave.build.json` 的 `verdict="ok"`；
#   · 不过 ⇒ 非零退出 + `verdict="rejected"` + `mismatches`（留下证据，比"不写清单"好查）。
#   读取方（promote / parity / 探针 / 页面自证）一律只认 `verdict == "ok"`：**没核对过 = 不可部署**。
#
# 用法（容器内；宿主的 `--list`/`explain` 也能跑）：
#   relink.sh link    <模式> [--out DIR] [--diag]        # 默认子命令（快，几分钟）
#   relink.sh verify  <模式> [--out DIR]                 # 只核对已有产物（不链接）
#   relink.sh rebuild <模式> [--out DIR] [--diag] --yes-rebuild
#   relink.sh explain <模式>                             # 打印全部 22 个变量（文档生成物）
#   relink.sh --list
#
# ⚠️ `rebuild` 的**执行路径尚未实测**（要跑 configure + make clean + 全量 make，数小时）：
#    第一次真用是 B6 线程版构建。它刻意**强制 `make clean`**（不信任 config.h 的新鲜度）——
#    改了 configure 旗标却漏 `make clean` 是历史上白跑两个大重建的那个坑（HISTORY §10.3）。
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OCT="${OCT:-/src/work/octave-11.3.0}"
# ★ F1：`--selfcheck` 要看的那份 link-web.sh **可注入** —— 自证必须在**夹具副本**上跑，
#   不许为了自证去临时改真文件（本会话真这么干过，改完还得记得还原）。
LINK_WEB="${LINK_WEB:-$HERE/link-web.sh}"
JOBS="${JOBS:-$(nproc 2>/dev/null || echo 8)}"

# ── 产物目录默认值：**目录名 == 模式名** ────────────────────────────────────────
out_default() {
  case "$1" in
    product) echo /src/websrc/product ;;
    scalar)  echo /src/websrc/scalar ;;
    m1)      echo /src/websrc/m1 ;;
    threads) echo /src/websrc/m2fc-threads-out ;;    # B6：线程档（PLAN-threads §5 步骤④）
    *)       echo "" ;;
  esac
}

modes_list() { echo "product scalar m1 threads"; }

# 基线：结构优先 —— 下一级模式自己的产物在就用它，否则退回表里记录的现存路径。
pick_baseline() {   # $1=下一级模式 $2=现存路径（表里记录）
  local below="$1" legacy="$2" p
  p="$(out_default "$below")/octave.wasm"
  if [ -f "$p" ]; then echo "$p"; else echo "$legacy"; fi
}

# ── 模式表：**唯一**的真值来源。22 个变量全在这里推出来，调用方一个都不许传 ──────────
mode_table() {      # 输出 KEY=VALUE 行（供 export）
  local m="$1"
  case "$m" in product|scalar|m1|threads) ;; *)
    echo "FATAL: 未知模式 '$m'（可选：$(modes_list)）" >&2; exit 2 ;; esac

  # 三模式共有：都是"完整产品形态"的能力面（区别只在 DCE / SIMD 两条轴，
  # 以及 M2 专用管道 —— 见下面各分支的注释）
  cat <<'EOF'
WITH_FREETYPE=1
WITH_FONTCONFIG=1
GL_LIBS=1
GL_BACKEND=webgl
P5_TOOLKIT=1
M_SRC=/src/work/m-prerendered/m
FORGE_SRC=/src/websrc/forge
PRELOAD_AT=/src/work/m-preload
P5_GLPROBE=
P5_TRACE=
DIAG_NAMES=0
DIAG_ASSERT=0
DIAG_SOURCEMAP=0
EOF

  case "$m" in
    m1)
      # M1：无 DCE ⇒ **不需要保活集**，于是 M2 专用管道一律清空（它们存在的唯一理由就是 M2）
      cat <<'EOF'
MAIN_MODULE_LEVEL=1
WITH_JSPI=1
KEEP_LIST=
LIB_FUNCS=
EXPORT_IF_DEFINED=
EXPORTED_FUNCS=_main
OCT_SCAN_DIRS=
BASELINE_WASM=
EXTRA_LDFLAGS=
EOF
      ;;
    scalar|product)
      cat <<'EOF'
MAIN_MODULE_LEVEL=2
WITH_JSPI=1
KEEP_LIST=/src/libwork/keep.txt
LIB_FUNCS=emscripten_run_script,__assert_fail,abort,exit
EXPORT_IF_DEFINED=
EXPORTED_FUNCS=_main
OCT_SCAN_DIRS=/src/octs-site
EOF
      if [ "$m" = product ]; then
        echo "EXTRA_LDFLAGS=-L/src/deps/lapack-simd/lib"
        echo "BASELINE_WASM=$(pick_baseline scalar /src/websrc/m2fc-jspb-out/octave.wasm)"
      else
        # scalar = product 去掉 SIMD ⇒ 没有 EXTRA_LDFLAGS；基线是 m1
        echo "EXTRA_LDFLAGS="
        echo "BASELINE_WASM=$(pick_baseline m1 /src/websrc/out/octave.wasm)"
      fi
      ;;
    threads)
      # ★ B6（2026-09-27）：product 的形态 **+ 线程运行时**。
      #   链接侧只多一个 `-pthread`（它自带 SHARED_MEMORY ⇒ wasm 内存 shared ⇒ 浏览器侧
      #   **硬要求** COOP/COEP，闸门③ 由此翻面）。实测：`-pthread` 编/链在 emcc 下都成立。
      #   ⚠️ **只加这个旗标是不够的**：对象层必须是用 `WITH_THREADS=1` 重编过的那一份
      #   （configure 去掉 `--disable-threads` **且**撤销 AX_PTHREAD 覆盖）。拿旧对象链 ⇒
      #   链接期就报特性不兼容；硬链成 ⇒ 产物的 threads 实测事实会是 false，而
      #   `check-build-manifest.py` 的 threads 判定**当场判拒**（fail-closed）。
      cat <<'EOF'
MAIN_MODULE_LEVEL=2
WITH_JSPI=1
KEEP_LIST=/src/libwork/keep.txt
LIB_FUNCS=emscripten_run_script,__assert_fail,abort,exit
EXPORT_IF_DEFINED=
EXPORTED_FUNCS=_main
OCT_SCAN_DIRS=/src/octs-site
EOF
      # `-pthread` 自带 SHARED_MEMORY；**池大小必须显式给** —— 否则 Emscripten 只允许
      # "从 worker 里动态起 worker"，主线程 `pthread_create` 直接失败 ⇒ "线程档"名不副实
      # （命令行看着有线程、实际一个都起不来）。4 = 够用且不白占内存（每个 worker 有独立栈）。
      echo "EXTRA_LDFLAGS=-L/src/deps/lapack-simd/lib -pthread -sPTHREAD_POOL_SIZE=4"
      # 基线 = **现役 product 产物**（导出面要保住）。`/src/websrc/product` 还没链过时，退回
      # A1 那份逐字节复现的 product 产物（sha 与 8761 现役件相同）。
      echo "BASELINE_WASM=$(pick_baseline product /src/websrc/a1-verify-product/octave.wasm)"
      ;;
  esac
}

# ── 声明（declared）：模式**承诺**产物里该有什么。由 check-build-manifest.py 逐条核对 ──
mode_declared() {
  case "$1" in
    product)
      cat <<'EOF'
{"main_module": 2, "simd": true, "jspi_entry": true, "jspi_glue_suspending": 0,
 "gl4es": true, "idbfs": true, "fontconfig": true, "threads": false,
 "fonts": ["FreeSans.otf", "FreeSansBold.otf", "FreeSansOblique.otf", "FreeSansBoldOblique.otf",
           "FreeMono.otf", "FreeMonoBold.otf", "FreeMonoOblique.otf", "FreeMonoBoldOblique.otf"]}
EOF
      ;;
    scalar)
      cat <<'EOF'
{"main_module": 2, "simd": false, "jspi_entry": true, "jspi_glue_suspending": 0,
 "gl4es": true, "idbfs": true, "fontconfig": true, "threads": false,
 "fonts": ["FreeSans.otf", "FreeSansBold.otf", "FreeSansOblique.otf", "FreeSansBoldOblique.otf",
           "FreeMono.otf", "FreeMonoBold.otf", "FreeMonoOblique.otf", "FreeMonoBoldOblique.otf"]}
EOF
      ;;
    threads)
      cat <<'EOF'
{"main_module": 2, "simd": true, "jspi_entry": true, "jspi_glue_suspending": 0,
 "gl4es": true, "idbfs": true, "fontconfig": true, "threads": true,
 "fonts": ["FreeSans.otf", "FreeSansBold.otf", "FreeSansOblique.otf", "FreeSansBoldOblique.otf",
           "FreeMono.otf", "FreeMonoBold.otf", "FreeMonoOblique.otf", "FreeMonoBoldOblique.otf"]}
EOF
      ;;
    m1)
      cat <<'EOF'
{"main_module": 1, "simd": false, "jspi_entry": true, "jspi_glue_suspending": 0,
 "gl4es": true, "idbfs": true, "fontconfig": true, "threads": false,
 "fonts": ["FreeSans.otf", "FreeSansBold.otf", "FreeSansOblique.otf", "FreeSansBoldOblique.otf",
           "FreeMono.otf", "FreeMonoBold.otf", "FreeMonoOblique.otf", "FreeMonoBoldOblique.otf"]}
EOF
      ;;
  esac
}

apply_mode() {      # 把模式表导出成环境（22 个变量）；$2 = --diag?
  local m="$1" diag="${2:-}" k v
  while IFS='=' read -r k v; do
    [ -n "$k" ] || continue
    export "$k=$v"
  done < <(mode_table "$m")
  # --diag：正交修饰（不属于任何模式）—— 保留 name 段 / 断言 / sourcemap，产物更大更慢
  if [ "$diag" = "1" ]; then
    export DIAG_NAMES=1 DIAG_ASSERT=1 DIAG_SOURCEMAP=1
  fi
  export BUILD_MODE="$m"
  export BUILD_DECLARED="$(mode_declared "$m")"
}

usage() {
  cat <<'EOF'
用法（容器内；宿主的 --list / explain 也能跑）：
  relink.sh link    <模式> [--out DIR] [--diag]        # 默认子命令（快，几分钟）
  relink.sh verify  <模式> [--out DIR]                 # 只核对已有产物（不链接）
  relink.sh rebuild <模式> [--out DIR] [--diag] --yes-rebuild
  relink.sh explain <模式>                             # 打印全部 22 个变量（文档生成物）
  relink.sh --list
模式：product（现役） / scalar（去 SIMD 的对照） / m1（无 DCE，保活基线）
      threads（B6 线程档：product + `-pthread` ⇒ **需宿主发 COOP/COEP**，否则页面自动落回非线程档）
EOF
}

cmd_explain() {
  local m="$1" k v
  echo "# 模式 '$m' 推出的全部变量（这就是文档 —— 别再去别处抄命令）"
  while IFS='=' read -r k v; do
    [ -n "$k" ] || continue
    printf '%-20s %s\n' "$k" "${v:-（空）}"
  done < <(mode_table "$m")
  echo
  echo "# 产物目录：$([ -n "${OUT:-}" ] && echo "$OUT" || out_default "$m")"
  echo "# 链接命令（由本脚本执行）："
  echo "#   cd \$(dirname link-web.sh) && bash link-web.sh <产物目录>"
  echo "# 声明（fail-closed 的判据）："
  mode_declared "$m" | sed 's/^/  /'
}

cmd_list() {
  echo "product  $(out_default product)   现役形态：M2 + JSPI + 字体 + GL + IDBFS + SIMD BLAS"
  echo "scalar   $(out_default scalar)    同上但**无 SIMD**（product 的 A/B 对照，也是 product 的保活基线）"
  echo "m1       $(out_default m1)        M1（无 DCE），导出面最全（保活闸门差分基线；scalar 的基线）"
  echo "threads  $(out_default threads)  B6 线程档：product + -pthread（内存 shared ⇒ 宿主必须发 COOP/COEP）"
}

# ★ D1 的**反向断言**（静态、不需要容器）：link-web.sh 读的每个环境变量都必须由模式表推出。
#   为什么必须有它：本入口存在的全部理由就是"漏一个变量 ⇒ 静默退化"。可这个契约本身
#   以前没人测 —— 谁往 link-web.sh 里加第 23 个变量，模式表不会自己知道。
#   标签变量（不是构建开关，只是给清单/日志打个名字）显式列在下面，**逐个说明**，不许悄悄放行。
LABEL_VARS="BUILD_MODE BUILD_DECLARED BUILD_MODE_LABEL"
LOCAL_VARS="P5_OBJS OBJS PRELOAD PRELOAD_AT_STAGED"   # 脚本内数组/局部量，不是环境变量
cmd_selfcheck() {
  local bad=0 v names
  names="$(grep -oE '\$\{[A-Za-z0-9_]+:[-+]' "$LINK_WEB" | sed 's/\${//;s/:[-+]//' | sort -u | grep -vE '^[0-9]+$')"
  while read -r v; do
    [ -n "$v" ] || continue
    case " $LABEL_VARS $LOCAL_VARS " in *" $v "*) continue ;; esac
    mode_table product | cut -d= -f1 | grep -qx "$v" || {
      echo "✗ link-web.sh 读了 \$$v，但模式表里没有它 ⇒ 它会停在脚本默认值上（**静默退化**）" >&2
      bad=1; }
  done <<< "$names"
  # 反方向：模式表里的变量，link-web.sh 必须真的读它（表里放个没人读的变量 = 文档骗人）
  # ⚠️ 这里必须用**固定串** grep：`grep -E "\$\{$v:[-+]"` 在 ERE 下把 `{` 当区间表达式的开头，
  #    实测**恒不匹配**（于是这一整条反方向断言变成"永远报错"的假红）。踩过，别改回去。
  while read -r v; do
    [ -n "$v" ] || continue
    grep -qF -- "\${$v:-" "$LINK_WEB" || grep -qF -- "\${$v:+" "$LINK_WEB" || {
      echo "✗ 模式表声明了 \$$v，但 link-web.sh 根本不读它（表在骗人）" >&2; bad=1; }
  done < <(mode_table product | cut -d= -f1)
  # 三个模式的变量集合必须完全一致（否则"换模式"会悄悄多/少一个变量）
  if [ "$(mode_table product | cut -d= -f1 | sort | tr '\n' ' ')" \
     != "$(mode_table scalar | cut -d= -f1 | sort | tr '\n' ' ')" ] \
  || [ "$(mode_table product | cut -d= -f1 | sort | tr '\n' ' ')" \
     != "$(mode_table m1 | cut -d= -f1 | sort | tr '\n' ' ')" ]; then
    echo "✗ 三个模式推出的变量集合不一致" >&2; bad=1
  fi
  local n
  n="$(mode_table product | grep -c '=')"
  if [ "$bad" = "0" ]; then
    echo "✅ relink.sh --selfcheck：模式表覆盖 link-web.sh 读的全部 $((n)) 个变量（标签变量：$LABEL_VARS）"
    return 0
  fi
  return 1
}

cmd_link() {
  local m="$1" out="$2" diag="$3"
  [ -f "$LINK_WEB" ] || {
    echo "FATAL: 找不到 "$LINK_WEB"" >&2; exit 2; }
  apply_mode "$m" "$diag"

  # 基线是**输入**，先核对它真的在（"基线是哪个产物"要能被查到，不能靠记）
  if [ -n "${BASELINE_WASM:-}" ] && [ ! -f "$BASELINE_WASM" ]; then
    echo "FATAL: 保活基线不存在：$BASELINE_WASM" >&2
    echo "       模式 '$m' 的基线应当是 $(mode_table "$m" | grep '^BASELINE_WASM=' | cut -d= -f2- || true)" >&2
    echo "       先构建下一级：$( [ "$m" = product ] && echo 'relink.sh link scalar' || echo 'relink.sh link m1' )" >&2
    exit 2
  fi
  mkdir -p "$out"
  echo "════ relink.sh link $m ════"
  echo "  产物目录：$out"
  echo "  保活基线：${BASELINE_WASM:-（无 —— M1 不需要）}"
  echo "  链接脚本："$LINK_WEB""
  bash "$LINK_WEB" "$out"

  echo "════ 出厂核对（fail-closed）════"
  python3 "$HERE/check-build-manifest.py" "$out/octave.build.json" --write || {
    echo "FATAL: 模式 '$m' 的声明与产物实测不符 ⇒ **这份产物不可部署**" >&2
    echo "       逐条 mismatch 见 $out/octave.build.json" >&2
    exit 3; }
  local sha
  sha=$(sha256sum "$out/octave.wasm" | cut -c1-16)
  echo "✅ relink.sh link $m 完成：octave.wasm sha256 ${sha}…，verdict=ok"
}

cmd_verify() {
  local m="$1" out="$2" d rc=0
  apply_mode "$m" ""
  [ -f "$out/octave.build.json" ] || {
    echo "FATAL: $out/octave.build.json 不存在 —— 这份产物没有身份证，**不可部署**" >&2; exit 2; }
  # 显式把**请求的模式**的声明传进去：这样 verify 能把一份手跑出来的产物补判成某个模式，
  # 也能用"另一种模式的声明"去测判定器（反向断言）。
  d="$(mktemp)"
  mode_declared "$m" > "$d"
  python3 "$HERE/check-build-manifest.py" "$out/octave.build.json" "$d" --write || rc=$?
  rm -f "$d"
  return $rc
}

cmd_rebuild() {
  local m="$1" out="$2" diag="$3" yes="$4"
  echo "════ relink.sh rebuild $m ════"
  echo "这会做四步（数小时）："
  echo "  ① cd $OCT && WITH_OPENGL=1 WITH_GL2PS=1 WITH_FREETYPE=1 WITH_FONTCONFIG=1 WITH_THREADS=$( [ "$m" = threads ] && echo 1 || echo 0 ) bash $HERE/configure-113-full.sh"
  echo "  ② cd $OCT && emmake make clean      # 刻意强制：不信任 config.h 的新鲜度"
  echo "  ③ cd $OCT && emmake make -k -j$JOBS"
  echo "  ④ relink.sh link $m --out $out $([ "$diag" = 1 ] && echo --diag)"
  echo "⚠️ 重配口径是**一整组**：WITH_OPENGL=1 WITH_FREETYPE=1 WITH_FONTCONFIG=1（另加 WITH_GL2PS=1）。"
  echo "   漏 WITH_OPENGL=1 ⇒ 默认 toolkit 静默掉回 web，而构建/链接/自检全绿（HISTORY §5.31）。"
  if [ "$yes" != "1" ]; then
    echo "拒绝执行：确认要跑就在命令里加 --yes-rebuild" >&2
    exit 2
  fi
  command -v emmake >/dev/null 2>&1 || {
    echo "FATAL: PATH 里没有 emmake（先 export PATH=/usr/src/emsdk/upstream/emscripten:\$PATH）" >&2; exit 2; }
  # ★ 线程档：模式决定 configure 的线程开关（WITH_THREADS=1 ⇒ 撤销 AX_PTHREAD 覆盖 +
  #   --enable-threads）。**不许手设** —— 与 D1 的纪律一致（口径从模式推出来）。
  local th=0; [ "$m" = threads ] && th=1
  ( cd "$OCT" && WITH_OPENGL=1 WITH_GL2PS=1 WITH_FREETYPE=1 WITH_FONTCONFIG=1 \
      WITH_THREADS="$th" bash "$HERE/configure-113-full.sh" )
  ( cd "$OCT" && emmake make clean )
  ( cd "$OCT" && emmake make -k -j"$JOBS" )
  cmd_link "$m" "$out" "$diag"
}

# ── 参数解析 ─────────────────────────────────────────────────────────────────
SUB="link"
case "${1:-}" in
  link|verify|rebuild) SUB="$1"; shift ;;
  explain|--explain)   SUB="explain"; shift ;;
  --selfcheck)         SUB="selfcheck"; shift ;;
  --selftest)          SUB="selftest"; shift ;;
  --list|-l)           SUB="list"; shift ;;
  -h|--help)           usage; exit 0 ;;
  --*) echo "FATAL: 未知选项 $1" >&2; usage >&2; exit 2 ;;
  *)   SUB="link" ;;
esac

MODE=""; OUT=""; DIAG=0; YES=0
for a in "$@"; do
  case "$a" in
    --out)  OUT="__NEXT__" ;;
    --diag) DIAG=1 ;;
    --yes-rebuild) YES=1 ;;
    --*) echo "FATAL: 未知选项 $a" >&2; exit 2 ;;
    *)
      if [ "$OUT" = "__NEXT__" ]; then OUT="$a"
      elif [ -z "$MODE" ]; then MODE="$a"
      else echo "FATAL: 多余的参数 '$a'" >&2; exit 2; fi ;;
  esac
done
[ "$OUT" = "__NEXT__" ] && { echo "FATAL: --out 后面要跟目录" >&2; exit 2; }

cmd_selftest() {
  # ★ F1：自证 —— 三个用例（全部在**夹具副本**上跑，不碰真 link-web.sh）
  local bad=0 tmp
  tmp="$(mktemp -d)"
  cp "$LINK_WEB" "$tmp/link-web.sh"
  # ① 真仓库：--selfcheck 应当绿
  if LINK_WEB="$LINK_WEB" bash "$0" --selfcheck >/dev/null 2>&1; then
    echo "PASS | relink/真实 link-web.sh ⇒ selfcheck 绿"
  else
    echo "fail | relink/真实 link-web.sh selfcheck 竟红"; bad=1
  fi
  # ② 夹具：加一个"读了但模式表里没有"的变量 ⇒ selfcheck **必须红**
  printf '\necho "T ${ZZZ_NOT_IN_TABLE:-}"\n' >> "$tmp/link-web.sh"
  if LINK_WEB="$tmp/link-web.sh" bash "$0" --selfcheck >/dev/null 2>&1; then
    echo "fail | relink/**未登记变量却没报**（自检失效）"; bad=1
  else
    echo "PASS | ★ 未登记变量 ⇒ selfcheck 必须红"
  fi
  # ③ 夹具：把模式表里的变量删光 ⇒ 反向方向（"表在骗人"）必须红
  cp "$LINK_WEB" "$tmp/link-web.sh"; printf '\n' >> "$tmp/link-web.sh"
  if LINK_WEB="$tmp/link-web.sh" bash "$0" --selfcheck >/dev/null 2>&1; then
    echo "PASS | 未动的副本 ⇒ 仍绿（自证不是恒红）"
  else
    echo "fail | relink/未动的副本竟红"; bad=1
  fi
  rm -rf "$tmp"
  echo ""
  echo "=== relink 自证：$((3 - bad)) PASS / $bad fail ==="
  return $bad
}

case "$SUB" in
  list)      cmd_list; exit 0 ;;
  selfcheck) cmd_selfcheck; exit $? ;;
  selftest)  cmd_selftest; exit $? ;;
  explain)   [ -n "$MODE" ] || { echo "FATAL: explain 要一个模式名" >&2; exit 2; }
             cmd_explain "$MODE"; exit 0 ;;
esac

[ -n "$MODE" ] || { echo "FATAL: 要给一个模式名（$(modes_list)）" >&2; usage >&2; exit 2; }
case "$MODE" in product|scalar|m1|threads) ;; *) echo "FATAL: 未知模式 '$MODE'（可选：$(modes_list)）" >&2; exit 2 ;; esac
[ -n "$OUT" ] || OUT="$(out_default "$MODE")"

case "$SUB" in
  link)    cmd_link "$MODE" "$OUT" "$DIAG" ;;
  verify)  cmd_verify "$MODE" "$OUT" ;;
  rebuild) cmd_rebuild "$MODE" "$OUT" "$DIAG" "$YES" ;;
esac
