#!/usr/bin/env bash
# Octave-Full-Wasm — **重链的唯一入口**（D1；批次 A1，2026-09-26）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# ═══════════════════════════════════════════════════════════════════════════════
# 为什么有它（`build/113/PLAN-arch.md` §1.1）
#
# `link-web.sh` 读**一组环境变量**（条数见 `build/FACTS.json` 的 `env_vars`；
# 查法 `python3 build/facts.py show env_vars` —— 别在这里手抄数字）。其中只有 2 个"值写错会当场报错"
# （`GL_BACKEND` / `MAIN_MODULE_LEVEL`），**所有"漏写"都是静默**；而它的**六组产物自检
# 全部在"开了才查"的分支里**（`:553`/`:588`/`:610`/`:632`/`:647`/`:661`）—— 漏一个开关
# ⇒ 自检整块跳过、构建/链接/自检**全绿**，产物却是另一个形态。
# 以前要把一条命令拼对，得在 8 份文档之间来回加法规约（HISTORY §5.26 + §5.38 + §5.54
# + AGENTS 事实纪律 + NOTES…）。本文件把那些"口径"**搬进代码**：模式决定全部变量，
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
#   relink.sh explain <模式>                             # 打印全部变量（文档生成物）
#   relink.sh --list
#
# ⚠️ `rebuild` 的**执行路径尚未实测**（要跑 configure + make clean + 全量 make，数小时）：
#    第一次真用是 B6 线程版构建。它刻意**强制 `make clean`**（不信任 config.h 的新鲜度）——
#    改了 configure 旗标却漏 `make clean` 是历史上白跑两个大重建的那个坑（HISTORY §10.3）。
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# ★ 把自己的目录放进 PATH（工单 09，2026-09-29 实测踩到）：容器里 relink.sh 住在 /src/bin，
#   emf77 也在那里 —— 但"操作员的交互 shell 恰好带了 /src/bin"是个**隐形前置**，
#   非交互（docker exec bash -c）直接死于 `FATAL: PATH 里没有 emf77`。
#   与车道影子同款教训：凡是入口，前置必须入口自己解决，不能活在人的 shell 配置里。
#   （宿主上 HERE=build/113，里面没有 emf77，此行无害。）
case ":$PATH:" in
  *":$HERE:"*) ;;
  *) export PATH="$HERE:$PATH" ;;
esac
OCT="${OCT:-/src/work/octave-11.3.0}"
# ★ F1：`--selfcheck` 要看的那份 link-web.sh **可注入** —— 自证必须在**夹具副本**上跑，
#   不许为了自证去临时改真文件（本会话真这么干过，改完还得记得还原）。
LINK_WEB="${LINK_WEB:-$HERE/link-web.sh}"
JOBS="${JOBS:-$(nproc 2>/dev/null || echo 8)}"
# ★ 车道影子目录（线程档的**隐形前置**，2026-09-28 实测被它咬）。见 cmd_link 里的长注释。
LANE_SHIM="${LANE_SHIM:-/src/libwork/lane-shim}"

# ── 产物目录默认值：**目录名 == 模式名** ────────────────────────────────────────
out_default() {
  case "$1" in
    product) echo /src/websrc/product ;;
    scalar)  echo /src/websrc/scalar ;;
    m1)      echo /src/websrc/m1 ;;
    threads) echo /src/websrc/m2fc-threads-out ;;    # B6：线程档（PLAN-threads §5 步骤④）
    w64)     echo /src/websrc/w64-out ;;              # wasm64 车道（PLAN-wasm64）
    w64-base) echo /src/websrc/w64-base-out ;;         # wasm64 基础档（单线程）
    *)       echo "" ;;
  esac
}

modes_list() { echo "product scalar m1 threads w64 w64-base"; }

# 基线：结构优先 —— 下一级模式自己的产物在就用它，否则退回表里记录的现存路径。
pick_baseline() {   # $1=下一级模式 $2=现存路径（表里记录）
  local below="$1" legacy="$2" p
  p="$(out_default "$below")/octave.wasm"
  if [ -f "$p" ]; then echo "$p"; else echo "$legacy"; fi
}

# ── 模式表：**唯一**的真值来源。全部变量都在这里推出来，调用方一个都不许传 ──────────
mode_table() {      # 输出 KEY=VALUE 行（供 export）
  local m="$1"
  case "$m" in product|scalar|m1|threads|w64|w64-base) ;; *)
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
DIAG_EXPORTS=
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
DEPS=/usr/local
DEPS_ROOT=/src/deps
GL4ES_A=/src/libwork/gl4es-src/lib/libGL.a
GLU_A=/src/libwork/glu-webgl/lib/libGLU.a
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
DEPS=/usr/local
DEPS_ROOT=/src/deps
GL4ES_A=/src/libwork/gl4es-src/lib/libGL.a
GLU_A=/src/libwork/glu-webgl/lib/libGLU.a
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
DEPS=/usr/local-threads
DEPS_ROOT=/src/deps-threads
GL4ES_A=/src/libwork/gl4es-src-threads/lib/libGL.a
GLU_A=/src/libwork/glu-webgl-threads/lib/libGLU.a
EOF
      # `-pthread` 自带 SHARED_MEMORY；**池大小必须显式给** —— 否则 Emscripten 只允许
      # "从 worker 里动态起 worker"，主线程 `pthread_create` 直接失败 ⇒ "线程档"名不副实
      # （命令行看着有线程、实际一个都起不来）。4 = 够用且不白占内存（每个 worker 有独立栈）。
      # ★ E2（branch `e2-openblas`，2026-09-27）：把 BLAS 换成**线程版 OpenBLAS**。
      #   `E2_OPENBLAS=<目录>` 时该目录**排在最前**（`-lrefblas` 从那里解析）⇒ 主模块的
      #   `dgemm_` 等走 OpenBLAS；LAPACK 仍是车道那份 f2c 库（`-llapack` 从车道目录解析）。
      #   为什么排最前就能"换库"：link-web.sh 用的是 `-lrefblas`，而 `-L` 的**顺序**决定
      #   同名库谁被选中（不写死路径 ⇒ 一个变量就够，见 NOTES-threads 的 E2 节）。
      if [ -n "${E2_OPENBLAS:-}" ]; then
        echo "EXTRA_LDFLAGS=-L$E2_OPENBLAS -L/src/deps-threads/lapack-simd/lib -pthread -sPTHREAD_POOL_SIZE=4"
      else
        echo "EXTRA_LDFLAGS=-L/src/deps-threads/lapack-simd/lib -pthread -sPTHREAD_POOL_SIZE=4"
      fi
      # 基线 = **现役 product 产物**（导出面要保住）。`/src/websrc/product` 还没链过时，退回
      # A1 那份逐字节复现的 product 产物（sha 与 8761 现役件相同）。
      echo "BASELINE_WASM=$(pick_baseline product /src/websrc/a1-verify-product/octave.wasm)"
      ;;
    w64|w64-base)
      # ★ wasm64 车道（2026-09-28，branch `wasm64`）：= threads 的形态 **+ memory64**。
      #   目标形态见 `build/113/PLAN-wasm64.md` §0（memory64 主路径 + 单线程回退）。
      #   两个**新 prefix**（绝不覆盖现役）：farm `/usr/local-w64` + `/src/deps-w64`，
      #   由 `build-w64-lane.sh` 用 `-pthread -sMEMORY64=1` 的影子重编出来。
      #   ⚠️ memory64 是 [compile+link] ⇒ 对象必须同旗标（那面实测墙见 PLAN-wasm64.md §1）。
      #   ⚠️ **GL4ES_A / GLU_A 现在指的是 threads 那份（wasm32）** —— w64 需要重编它们；
      #      先用它把链接跑通、看下一面墙在哪，别当作"w64 的 GL 已经好了"。
      cat <<'EOF'
MAIN_MODULE_LEVEL=2
WITH_JSPI=1
KEEP_LIST=/src/libwork/keep-w64.txt
LIB_FUNCS=emscripten_run_script,__assert_fail,abort,exit
EXPORT_IF_DEFINED=
EXPORTED_FUNCS=_main
OCT_SCAN_DIRS=/src/libwork/octs-w64 /src/libwork/octs-w64-pkg
DEPS=/usr/local-w64
DEPS_ROOT=/src/deps-w64
GL4ES_A=/src/libwork/gl4es-src-w64/lib/libGL.a
GLU_A=/src/libwork/glu-webgl-w64/lib/libGLU.a
EOF
      if [ "$m" = w64 ]; then
        echo "EXTRA_LDFLAGS=-L/src/deps-w64/lapack-simd/lib -pthread -sPTHREAD_POOL_SIZE=4"
      else
        echo "EXTRA_LDFLAGS=-L/src/deps-w64/lapack-simd/lib"
      fi
      echo "MEMORY64=1"
      echo "BASELINE_WASM=$(pick_baseline threads /src/websrc/m2fc-threads-out/octave.wasm)"
      ;;
  esac

  # ★ `MEMORY64` 的默认值放在**模式分支之后**给，且 w64/w64-base 自己给过 1 就不再给 ——
  #   这样表里**同一个变量只会出现一行**。为什么强调：第一版把它写进共有块、又在 w64 分支里
  #   写了 1 ⇒ 表里两行 `MEMORY64`（0 与 1），靠"后导出者覆盖前者"才生效。
  #   那正是本仓记过的"同一旗标两处"的形状（消费者若 `grep -m1` 就会拿到 0）；
  #   而且 `exports` 的条数也会比别的模式多一条（自证/对比会莫名其妙地不一致）。
  case "$m" in w64|w64-base) ;; *) echo "MEMORY64=0" ;; esac
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
      # `E2_OPENBLAS` 有值时多声明一条 `e2_openblas` ⇒ `check-build-manifest.py` 据此换判据
      # （BLAS 溯源从"必须含 -threads"改成"必须指向 E2 目录"）。
      _e2=""
      [ -n "${E2_OPENBLAS:-}" ] && _e2=', "e2_openblas": true'
      cat <<EOF
{"main_module": 2, "simd": true, "jspi_entry": true, "jspi_glue_suspending": 0,
 "gl4es": true, "idbfs": true, "fontconfig": true, "threads": true${_e2},
 "fonts": ["FreeSans.otf", "FreeSansBold.otf", "FreeSansOblique.otf", "FreeSansBoldOblique.otf",
           "FreeMono.otf", "FreeMonoBold.otf", "FreeMonoOblique.otf", "FreeMonoBoldOblique.otf"]}
EOF
      ;;
    w64)
      # ★ wasm64 车道：显式声明 wasm64=true，与 wasm32 各档明确区分
      cat <<'EOF'
{"main_module": 2, "simd": true, "jspi_entry": true, "jspi_glue_suspending": 0,
 "gl4es": true, "idbfs": true, "fontconfig": true, "threads": true, "wasm64": true,
 "fonts": ["FreeSans.otf", "FreeSansBold.otf", "FreeSansOblique.otf", "FreeSansBoldOblique.otf",
           "FreeMono.otf", "FreeMonoBold.otf", "FreeMonoOblique.otf", "FreeMonoBoldOblique.otf"]}
EOF
      ;;
    w64-base)
      # ★ wasm64 基础档：单线程 + wasm64=true
      cat <<'EOF'
{"main_module": 2, "simd": true, "jspi_entry": true, "jspi_glue_suspending": 0,
 "gl4es": true, "idbfs": true, "fontconfig": true, "threads": false, "wasm64": true,
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

# ★ `--diag` 的**正交修饰**：不属于任何模式，但会改变产物。这里是它**唯一**的定义处 ——
#   `apply_mode`（导出环境）与 `cmd_explain`（打印文档）都读这一份，免得"文档说的"与
#   "实际导出的"分叉（那就是本仓反复出错的形状）。
#
#   为什么诊断还需要**导出符号**（工单 01，2026-09-28）：一个够不到的符号会让诊断**做不下去** ——
#   实测 E2 的线程版：三个产物的导出表里**一条 BLAS 都没有**，于是"在页面里先调
#   `openblas_set_num_threads(1)` 再跑同一路径"这句结论写法**今天无法执行**。
#   走 `--export-if-defined`（未定义的**静默忽略**）⇒ 对不定义它的模式无害，可以安全地只在诊断档开。
diag_overrides() {
  cat <<'EOF'
DIAG_NAMES=1
DIAG_ASSERT=1
DIAG_SOURCEMAP=1
DIAG_EXPORTS=openblas_set_num_threads
EOF
}

apply_mode() {      # 把模式表导出成环境（全表变量）；$2 = --diag?
  local m="$1" diag="${2:-}" k v
  while IFS='=' read -r k v; do
    [ -n "$k" ] || continue
    export "$k=$v"
  done < <(mode_table "$m")
  # --diag：正交修饰 —— 保留 name 段 / 断言 / sourcemap，外加诊断专用导出。产物更大更慢。
  if [ "$diag" = "1" ]; then
    while IFS='=' read -r k v; do
      [ -n "$k" ] || continue
      export "$k=$v"
    done < <(diag_overrides)
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
  relink.sh explain <模式>                             # 打印全部变量（文档生成物）
  relink.sh --list
模式：product（现役） / scalar（去 SIMD 的对照） / m1（无 DCE，保活基线）
      threads（B6 线程档：product + `-pthread` ⇒ **需宿主发 COOP/COEP**，否则页面自动落回非线程档）
EOF
}

cmd_explain() {
  local m="$1" diag="${2:-}" k v
  echo "# 模式 '$m' 推出的全部变量（这就是文档 —— 别再去别处抄命令）"
  while IFS='=' read -r k v; do
    [ -n "$k" ] || continue
    printf '%-20s %s\n' "$k" "${v:-（空）}"
  done < <(mode_table "$m")
  if [ "$diag" = "1" ]; then
    # ★ 工单 01：`--diag` 的修饰**必须打得出来**。打不出来的开关就是看不见的开关，
    #   而"赋值了却没人引用"是本仓踩过的静默失效形状。这里与 apply_mode 同读 diag_overrides()。
    echo
    echo "# ── 下面是 --diag 的**正交修饰**（不属于模式表，但会改变产物）──"
    while IFS='=' read -r k v; do
      [ -n "$k" ] || continue
      printf '%-20s %s\n' "$k" "${v:-（空）}"
    done < <(diag_overrides)
    echo "# （DIAG_EXPORTS 走 lld 的 --export-if-defined：未定义的符号静默忽略 ⇒ 无害）"
  fi
  echo
  echo "# 产物目录：$([ -n "${OUT:-}" ] && echo "$OUT" || out_default "$m")"
  echo "# 链接命令（由本脚本执行）："
  echo "#   cd \$(dirname link-web.sh) && bash link-web.sh <产物目录>"
  echo "# 声明（fail-closed 的判据）："
  mode_declared "$m" | sed 's/^/  /'
}

# ★ `exports <模式>`：**机器可读**的模式表导出（`KEY=VALUE` 行，空值是**真空**）。
#   为什么需要它（2026-09-28 实测踩到）：`explain` 是**给人看的** —— 它把空值渲染成 `（空）`。
#   拿 `explain` 的输出当数据源，会让每个空变量变成**字面量** `（空）`：真踩到
#   `-Wl,--export-if-defined=（空）`，而 `P5_GLPROBE=（空）` 更坏 —— `[ -n ]` 判真 ⇒ 悄加一个 -D。
#   ⇒ 想驱动 link-web.sh 的调用方（探针、诊断档）**用 `exports`，别解析 `explain`**。
cmd_exports() {
  mode_table "$1"
}

cmd_list() {
  echo "product  $(out_default product)   现役形态：M2 + JSPI + 字体 + GL + IDBFS + SIMD BLAS"
  echo "scalar   $(out_default scalar)    同上但**无 SIMD**（product 的 A/B 对照，也是 product 的保活基线）"
  echo "m1       $(out_default m1)        M1（无 DCE），导出面最全（保活闸门差分基线；scalar 的基线）"
  echo "threads  $(out_default threads)  B6 线程档：product + -pthread（内存 shared ⇒ 宿主必须发 COOP/COEP）"
  echo "w64      $(out_default w64)      wasm64 线程档：w64 + -pthread（MEMORY64=1）"
  echo "w64-base $(out_default w64-base) wasm64 基础档：单线程 + MEMORY64=1"
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
  # 各模式的变量集合必须完全一致（否则"换模式"会悄悄多/少一个变量）
  for check_m in scalar m1 threads w64 w64-base; do
    if [ "$(mode_table product | cut -d= -f1 | sort | tr '\n' ' ')" \
       != "$(mode_table "$check_m" | cut -d= -f1 | sort | tr '\n' ' ')" ]; then
      echo "✗ 模式 product 与 $check_m 推出的变量集合不一致" >&2; bad=1
    fi
  done
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

  # ★ 工单 29（2026-09-30）：**链之前校验"树配的前缀"与模式一致**。
  #   为什么：产物会把树 configure 时的 --prefix **烘死**进 octave.js（docstrings/doc-cache
  #   等运行期路径）。一棵树只配一个前缀 ⇒ 在 threads 前缀的树上跑 `link product`，会产出
  #   **烘死 threads 路径的 product 产物** ⇒ 上线后 8761 的 help 打不开，而
  #   `verdict=ok`、三条 SHA、"链得过" **全都绿**（工单 28 的同族盲区，实测过）。
  #   判据从**树自己**读（`Makefile` 的 prefix 行），不信任何人的记忆。
  local want
  case "$m" in
    threads)      want=/src/work/octave-install-threads ;;
    w64|w64-base) want=/src/work/octave-install-w64 ;;
    *)            want=/src/work/octave-install ;;
  esac
  if [ -f "$OCT/Makefile" ]; then
    local have
    have=$(sed -n 's/^[[:space:]]*prefix[[:space:]]*=[[:space:]]*//p' "$OCT/Makefile" | head -1)
    if [ -n "$have" ] && [ "$have" != "$want" ]; then
      echo "FATAL: 这棵树的 configure 前缀是 $have，但模式 $m 要的是 $want。" >&2
      echo "       产物会把前缀**烘死**进 octave.js（docstrings 等运行期路径）⇒ 上线后 help 打不开，" >&2
      echo "       而 verdict=ok / SHA / '链得过' **全绿**（工单 28 的同族盲区）。" >&2
      echo "       先重配重建：bash $0 rebuild $m --out <目录> --yes-rebuild" >&2
      exit 2
    fi
    [ -n "$have" ] && echo "  树前缀校验：$have == 模式 $m 的期望 ✓"
  fi

  # ★★ 线程档的**隐形前置**（2026-09-28 实测被它咬，见 HISTORY §5.67）★★
  #   为什么线程档需要它：`-pthread` 要求 shared-memory 链上**每个对象**都声明 `atomics`，
  #   而 farm 里那 20+ 个库的构建脚本**没有传旗标的点位**（有的写死在 emf77 命令行、有的在
  #   cmake）⇒ 只能靠 `lane-shim.sh` 建的 **PATH 影子**（`$LANE_SHIM/em++` 就是
  #   `em++ -pthread "$@"`）把旗标注进去。而 **`main.cc` 的编译也在 `link-web.sh` 里** ⇒
  #   链线程档之前影子必须在 PATH 上 —— 否则 `main.o` 不带 atomics，
  #   链接期报 `--shared-memory is disallowed by /src/websrc/main.o`。
  #   以前这一步**只存在于操作员的记忆与 NOTES 散文里**，而这个入口自称"唯一入口、
  #   一个变量都不许手设" —— 那句话在 threads 模式上是**假的**。
  #   现在由入口自己挂：口径搬进代码。缺影子就**点名 FATAL**（附可直接复制的建法），
  #   而不是链到一半才炸（那时错误信息离根因很远）。
  #   ⚠️ 检查放在 LINK_WEB 之前：`--selftest` 的第 ⑤ 条要在**宿主**上就能证明它会红。
  if [ "$m" = threads ]; then
    if [ -d "$LANE_SHIM" ]; then
      export PATH="$LANE_SHIM:$PATH"
      echo "  车道影子：$LANE_SHIM（注入 -pthread —— 线程档的 atomics 前置）"
    else
      echo "FATAL: threads 模式需要**车道影子**（$LANE_SHIM 不存在）—— 它是线程档的隐形前置：" >&2
      echo "       \`-pthread\` 要求链上每个对象都带 atomics，而 farm 那批库没有传旗标的点位，" >&2
      echo "       只能靠 PATH 影子注入。没有它 ⇒ main.o 不带 atomics ⇒ 链接期才报" >&2
      echo "       \`--shared-memory is disallowed by main.o\`（离根因很远）。" >&2
      echo "       建它：export PATH=/src/bin:\$PATH && bash build/113/lane-shim.sh -pthread" >&2
      exit 2
    fi
  elif [ "$m" = w64 ]; then
    local shim_w64="${LANE_SHIM_W64:-/src/libwork/lane-shim-w64}"
    if [ -d "$shim_w64" ]; then
      export PATH="$shim_w64:$PATH"
      echo "  车道影子：$shim_w64（注入 -pthread -sMEMORY64=1 —— w64 前置）"
    else
      echo "FATAL: w64 模式需要**车道影子**（$shim_w64 不存在）" >&2
      exit 2
    fi
  elif [ "$m" = w64-base ]; then
    local shim_w64_single="${LANE_SHIM_W64_SINGLE:-/src/libwork/lane-shim-w64-single}"
    if [ -d "$shim_w64_single" ]; then
      export PATH="$shim_w64_single:$PATH"
      echo "  车道影子：$shim_w64_single（注入 -sMEMORY64=1 —— w64-base 前置）"
    else
      echo "FATAL: w64-base 模式需要**车道影子**（$shim_w64_single 不存在）" >&2
      exit 2
    fi
  fi

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
  # ★ --out-dir 必须转发（工单 15）：验证谁就按**谁所在目录**核对三个大件 ——
  #   不转发时配对检查退回身份证里记录的**构建时**目录（容器内路径），宿主上验副本必假红，
  #   且 --write 把 verdict=rejected 写回副本（一次验证动作销毁了被验证的东西）。
  python3 "$HERE/check-build-manifest.py" "$out/octave.build.json" "$d" --out-dir "$out" --write || rc=$?
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
  # ★ 工单 26（2026-09-30 实测踩到）：**线程档/w64 档的树必须由车道影子注入旗标来编**，
  #   否则 configure/make 出来的对象**不带 atomics**（或不是 64 位），重链时报
  #   `--shared-memory is disallowed by <tree>.o` —— 一个离根因很远的错。
  #   以前这一步只在**操作员记忆**里（export PATH=…lane-shim…），本单把它搬进入口：
  #   与 cmd_link 同款处置（缺了就**点名** FATAL，不许编到一半才炸）。
  if [ "$m" = threads ] || [ "$m" = w64 ]; then
    local shim="${LANE_SHIM:-/src/libwork/lane-shim}"
    [ "$m" = w64 ] && shim="${LANE_SHIM_W64:-/src/libwork/lane-shim-w64}"
    if [ -d "$shim" ]; then
      export PATH="$shim:$PATH"
      echo "  车道影子：$shim（rebuild 的 configure/make 也走它 —— 否则对象不带 atomics）"
    else
      echo "FATAL: \`rebuild $m\` 需要**车道影子** $shim，但它不在 —— 缺它编出来的树对象不带 atomics，" >&2
      echo "       重链会报 \`--shared-memory is disallowed by …\`（离根因很远的错）。" >&2
      echo "       建它：bash build/113/lane-shim.sh \"$([ "$m" = w64 ] && echo '-pthread -sMEMORY64=1' || echo '-pthread')\" \"$shim\"" >&2
      exit 2
    fi
  fi
  command -v emmake >/dev/null 2>&1 || {
    echo "FATAL: PATH 里没有 emmake（先 export PATH=/usr/src/emsdk/upstream/emscripten:\$PATH）" >&2; exit 2; }
  # ★ 线程档：模式决定 configure 的线程开关（WITH_THREADS=1 ⇒ 撤销 AX_PTHREAD 覆盖 +
  #   --enable-threads）。**不许手设** —— 与 D1 的纪律一致（口径从模式推出来）。
  local th=0; [ "$m" = threads ] && th=1
  # ★ 工单 28（2026-09-30 实测）：**必须把车道自己的 install 前缀传给 configure** ——
  #   不传就落到默认的 product 路径（`/src/work/octave-install`），于是产物**烘死 product 的
  #   docstrings 路径**，而站点资产是按**车道**前缀挂载的（`manifest.threads.json` 挂到
  #   `/src/work/octave-install-threads/…`）⇒ 运行期 `help` 全打不开（实测 accept-help 5/7）。
  #   这类错 `verdict=ok` **查不出来**（它只核对声明 vs 量测），必须靠运行期套件 + 下面的烘死路径自证。
  local inst
  case "$m" in
    threads)      inst=/src/work/octave-install-threads ;;
    w64|w64-base) inst=/src/work/octave-install-w64 ;;
    *)            inst=/src/work/octave-install ;;
  esac
  echo "   车道 install 前缀：$inst（configure 的 \$2；不传就会烘死 product 路径 —— 工单 28）"
  [ -d "$inst" ] || { echo "FATAL: 车道安装树不存在：$inst（先建它，别拿 product 树凑）" >&2; exit 2; }
  ( cd "$OCT" && WITH_OPENGL=1 WITH_GL2PS=1 WITH_FREETYPE=1 WITH_FONTCONFIG=1 \
      WITH_THREADS="$th" bash "$HERE/configure-113-full.sh" "$OCT" "$inst" ) \
    || { echo "FATAL: configure 失败（rebuild 第①步）—— 第一面墙在上面输出里" >&2; exit 2; }
  ( cd "$OCT" && emmake make clean ) \
    || { echo "FATAL: make clean 失败（rebuild 第②步）" >&2; exit 2; }
  # ★ make 的 rc≠0 是**已知预期**（工单 09，2026-09-29 实测）：树内 octave-cli 用
  #   configure 时的 /usr/local 前缀链 LAPACK，缺 `zgejsv_`/`cgejsv_`（web 链接用的是
  #   /src/deps/lapack-simd 那份新的，树内 cli 没这份）——farm 的 stage_tree 早就写明
  #   "预期 ≠0：树内 cli 失败"。⇒ 不能因为它中止：web 产物只吃树内 .libs + 车道 deps。
  #   但要**零值守卫**：三大 .libs 必须真的（重）建出来了，否则就是"全没编过"而不是
  #   "只有 cli 失败"——那种情况必须红着死，不能带病链接。
  local mkr=0
  ( cd "$OCT" && emmake make -k -j"$JOBS" ) || mkr=$?
  echo "   make rc=$mkr（树内 cli 失败是已知预期；库必须都在才继续）"
  local lib f
  for lib in liboctave/.libs/liboctave.a libinterp/.libs/liboctinterp.a \
             libmex/.libs/liboctmex.a libgnu/.libs/libgnu.a; do
    f="$OCT/$lib"
    if [ ! -s "$f" ]; then
      echo "FATAL: 树内库缺或空：$f —— make 不是'只有 cli 失败'，不许带病链接" >&2
      exit 2
    fi
  done
  echo "   ✅ 树内四大 .libs 在（$(date -u +%H:%M:%SZ)），继续链接"
  cmd_link "$m" "$out" "$diag"
  # ★ 烘死路径自证（工单 28）：产物的 `octave.js` 里出现的安装前缀必须是**本车道**那一个。
  #   为什么单列：这是"能链过、verdict=ok、但运行期打不开 doc"的唯一机器可查的迹象。
  local baked
  baked=$(grep -o '/src/work/octave-install[a-z0-9_-]*' "$out/octave.js" 2>/dev/null | sort -u | tr '\n' ' ')
  case " $baked " in
    *" $inst "*) echo "   ✅ 烘死路径含本车道前缀（$inst）" ;;
    *) echo "FATAL: 产物烘死的安装前缀里**没有** $inst（量到：$baked）⇒ 运行期 doc/help 会打不开" >&2
       exit 2 ;;
  esac
}

# ── 参数解析 ─────────────────────────────────────────────────────────────────
SUB="link"
case "${1:-}" in
  link|verify|rebuild) SUB="$1"; shift ;;
  explain|--explain)   SUB="explain"; shift ;;
  exports|--exports)   SUB="exports"; shift ;;
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
  # ★ F1：自证 —— 四个用例（前三个在**夹具副本**上跑，不碰真 link-web.sh）
  local bad=0 n=0 tmp on off
  tmp="$(mktemp -d)"
  cp "$LINK_WEB" "$tmp/link-web.sh"
  # ① 真仓库：--selfcheck 应当绿（**阳性对照** —— 没有它，"恒红"的自检也能骗过自证）
  n=$((n + 1))
  if LINK_WEB="$LINK_WEB" bash "$0" --selfcheck >/dev/null 2>&1; then
    echo "PASS | relink/真实 link-web.sh ⇒ selfcheck 绿"
  else
    echo "fail | relink/真实 link-web.sh selfcheck 竟红"; bad=1
  fi
  # ② 夹具：加一个"读了但模式表里没有"的变量 ⇒ selfcheck **必须红**
  n=$((n + 1))
  printf '\necho "T ${ZZZ_NOT_IN_TABLE:-}"\n' >> "$tmp/link-web.sh"
  if LINK_WEB="$tmp/link-web.sh" bash "$0" --selfcheck >/dev/null 2>&1; then
    echo "fail | relink/**未登记变量却没报**（自检失效）"; bad=1
  else
    echo "PASS | ★ 未登记变量 ⇒ selfcheck 必须红"
  fi
  # ③ 夹具：**未动**的副本 ⇒ 仍绿（证明自证不是恒红）
  n=$((n + 1))
  cp "$LINK_WEB" "$tmp/link-web.sh"
  if LINK_WEB="$tmp/link-web.sh" bash "$0" --selfcheck >/dev/null 2>&1; then
    echo "PASS | 未动的副本 ⇒ 仍绿（自证不是恒红）"
  else
    echo "fail | relink/未动的副本竟红"; bad=1
  fi
  # ④ ★ 工单 01 的反向断言：`--diag` 的修饰必须是**看得见**的
  #    为什么：诊断档若是个看不见的开关，它等于没有 —— 而"赋值了却没人引用"正是本仓
  #    踩过的静默失效形状（`JSPI_FLAGS` 那次：全绿，功能不在）。
  #    ⚠️ `grep -c` 零命中会退出 1 ⇒ 必须 `|| true`，否则 `set -e` 下整段自证会中断。
  #    ⚠️ 模式里**不能写 `=`**：`explain` 是列对齐打印（`printf '%-20s %s'`），
  #       行里没有等号。第一版就是这么写错的 —— 于是断言"恒失败"，看起来像功能没做（实测踩到）。
  n=$((n + 1))
  on="$(bash "$0" explain product --diag 2>/dev/null | grep -c 'DIAG_EXPORTS.*openblas_set_num_threads' || true)"
  off="$(bash "$0" explain product 2>/dev/null | grep -c 'DIAG_EXPORTS.*openblas_set_num_threads' || true)"
  if [ "${on:-0}" -ge 1 ] && [ "${off:-0}" -eq 0 ]; then
    echo "PASS | ★ --diag ⇒ explain 打得出来；不带 --diag 时打不出来（修饰可见，且非恒真）"
  else
    echo "fail | --diag 修饰在 explain 里看不见（on=$on off=$off）"; bad=1
  fi
  # ⑤ ★ 线程档的**隐形前置必须在入口里被点名**（而不是链到一半才炸）
  #    实测背景：threads 的 `-pthread` 依赖 PATH 上的车道影子，以前只在人的记忆里；
  #    不挂 ⇒ main.o 不带 atomics ⇒ 链接期才报 `--shared-memory is disallowed by main.o`。
  #    ⚠️ 这条在**宿主**上跑：`LANE_SHIM=/不存在` ⇒ 必须命中"点名 FATAL"那一路。
  #      它证明的是"入口认得这个前置"，不证明容器内的愉快路径（那由每次真链覆盖）。
  n=$((n + 1))
  msg="$(LANE_SHIM=/nonexistent-lane-shim bash "$0" link threads --out /tmp/_zr_shim_probe 2>&1 || true)"
  if printf '%s' "$msg" | grep -q '车道影子'; then
    echo "PASS | ★ 缺车道影子 ⇒ 入口**点名** FATAL（不再靠人的记忆）"
  else
    echo "fail | 缺车道影子时入口没点名（msg=${msg:0:100}）"; bad=1
  fi
  # ⑥ ★ `exports` 必须是**机器可读**的（空值是真空，不是占位符）
  #    实测背景：`explain` 把空值渲染成 `（空）`，我拿它当数据源驱动探针 ⇒
  #    `-Wl,--export-if-defined=（空）`，而 `P5_GLPROBE=（空）` 会让 `[ -n ]` 判真、悄加一个 -D。
  n=$((n + 1))
  ph="$(bash "$0" exports threads 2>/dev/null | grep -c '（空）' || true)"
  em="$(bash "$0" exports threads 2>/dev/null | grep -c '^EXPORT_IF_DEFINED=$' || true)"
  if [ "${ph:-1}" -eq 0 ] && [ "${em:-0}" -ge 1 ]; then
    echo "PASS | ★ exports 机器可读（无占位符；空变量是真空）"
  else
    echo "fail | exports 被渲染过了（占位符 $ph 处；空 EXPORT_IF_DEFINED 命中 $em 处）"; bad=1
  fi
  # ⑥b ★ 工单 26：`rebuild <车道>` 的车道影子前置也必须被点名
  n=$((n + 1))
  msg="$(LANE_SHIM=/nonexistent-shim bash "$0" rebuild threads --out /tmp/_zr_rb_probe --yes-rebuild 2>&1 || true)"
  if printf '%s' "$msg" | grep -q '车道影子'; then
    echo "PASS | ★ rebuild threads 缺车道影子 ⇒ 入口**点名** FATAL（工单 26）"
  else
    echo "fail | rebuild threads 缺影子时没点名（msg=${msg:0:120}）"; bad=1
  fi
  # ⑥c ★ 工单 29：link 之前必须校验"树前缀 vs 模式"
  n=$((n + 1))
  fx="$(mktemp -d)"
  printf 'prefix = /src/work/octave-install-threads\n' > "$fx/Makefile"
  msg="$(OCT="$fx" bash "$0" link product --out /tmp/_zr_pfx_probe 2>&1 || true)"
  if printf '%s' "$msg" | grep -q '树的 configure 前缀'; then
    echo "PASS | ★ link product 撞上 threads 前缀的树 ⇒ 点名 FATAL（工单 29）"
  else
    echo "fail | 树前缀不匹配时没拦（msg=${msg:0:110}）"; bad=1
  fi
  rm -rf "$fx"
  # ⑦ ★ w64 模式的隐形前置必须在入口里被点名（LANE_SHIM_W64）
  n=$((n + 1))
  msg="$(LANE_SHIM_W64=/nonexistent-w64-shim bash "$0" link w64 --out /tmp/_zr_shim_probe 2>&1 || true)"
  if printf '%s' "$msg" | grep -q '车道影子'; then
    echo "PASS | ★ w64 缺车道影子 ⇒ 入口**点名** FATAL"
  else
    echo "fail | w64 缺车道影子时入口没点名（msg=${msg:0:100}）"; bad=1
  fi
  # ⑧ ★ w64-base 模式的隐形前置必须在入口里被点名（LANE_SHIM_W64_SINGLE）
  n=$((n + 1))
  msg="$(LANE_SHIM_W64_SINGLE=/nonexistent-w64-single-shim bash "$0" link w64-base --out /tmp/_zr_shim_probe 2>&1 || true)"
  if printf '%s' "$msg" | grep -q '车道影子'; then
    echo "PASS | ★ w64-base 缺车道影子 ⇒ 入口**点名** FATAL"
  else
    echo "fail | w64-base 缺车道影子时入口没点名（msg=${msg:0:100}）"; bad=1
  fi
  rm -rf "$tmp"
  echo ""
  echo "=== relink 自证：$((n - bad)) PASS / $bad fail ==="
  return $bad
}
case "$SUB" in
  list)      cmd_list; exit 0 ;;
  selfcheck) cmd_selfcheck; exit $? ;;
  selftest)  cmd_selftest; exit $? ;;
  explain)   [ -n "$MODE" ] || { echo "FATAL: explain 要一个模式名" >&2; exit 2; }
             cmd_explain "$MODE" "$DIAG"; exit 0 ;;
  exports)   [ -n "$MODE" ] || { echo "FATAL: exports 要一个模式名" >&2; exit 2; }
             cmd_exports "$MODE"; exit 0 ;;
esac

[ -n "$MODE" ] || { echo "FATAL: 要给一个模式名（$(modes_list)）" >&2; usage >&2; exit 2; }
case "$MODE" in product|scalar|m1|threads|w64|w64-base) ;; *) echo "FATAL: 未知模式 '$MODE'（可选：$(modes_list)）" >&2; exit 2 ;; esac
[ -n "$OUT" ] || OUT="$(out_default "$MODE")"

case "$SUB" in
  link)    cmd_link "$MODE" "$OUT" "$DIAG" ;;
  verify)  cmd_verify "$MODE" "$OUT" ;;
  rebuild) cmd_rebuild "$MODE" "$OUT" "$DIAG" "$YES" ;;
esac
