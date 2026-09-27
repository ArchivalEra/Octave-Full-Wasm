#!/usr/bin/env bash
# Octave-Full-Wasm — 把**带 GL 的 web 链接产物**（gl4es → WebGL2）推到 8761 基线站点
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么要有这个脚本：2026-09-22 换基线那次是**手抄**的（PROMOTION.md 里全是"改了哪几处"），
# 手抄会漏 —— 这次就真的漏过一处：`recover.sh` 的拷贝清单里没有 `p5canvas.js`，
# 而新 `index.html` 会 `<script src="p5canvas.js">` ⇒ 断电恢复后是 404。
# 所以把"部署带 GL 的那份"固化下来，顺序与自检都在这里。
#
# 用法：
#   sh build/promote-webgl.sh                 # 真做
#   sh build/promote-webgl.sh --dry-run       # 只打印要做什么
#   SRC_OUT=/src/websrc/out-webgl2 sh build/promote-webgl.sh   # 用别的链接产物
#
# 做完之后**必须**跑全量回归（脚本最后会把命令打出来）：
#   sh /mnt/hdd/octave-wasm-build/sweep.sh http://127.0.0.1:8761/
set -euo pipefail

REPO=/mnt/hdd/zcode-projects/Octave-Full-Wasm
SITE=/mnt/hdd/octave-wasm-build/site
BAK=/mnt/hdd/octave-wasm-build/site-prewebgl-bak
SRC_OUT=${SRC_OUT:-/src/websrc/out}
GL_OUT=${GL_OUT:-/src/websrc/out-webgl}
NONGL_BAK=/src/websrc/out-nongl-bak
# 车道 `.oct` 编目：**容器里**是源（`build-oct-lane.sh` 的产物），**宿主**两份是给
# `stage-lane-assets.sh` 读的（它按清单把件铺到站点，跑在宿主上）⇒ 第 3b 步先同步再分档。
LANE_OCT_OUT="${LANE_OCT_OUT:-/src/libwork/octs-threads}"
LANE_OCT_PKG="${LANE_OCT_PKG:-/src/libwork/octs-threads-pkg}"
LANE_OCT_HOST="${LANE_OCT_HOST:-/mnt/hdd/octave-wasm-build/octs-threads}"
LANE_OCT_PKG_HOST="${LANE_OCT_PKG_HOST:-/mnt/hdd/octave-wasm-build/octs-threads-pkg}"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1
say() { echo "== $*"; }
run() { if [ "$DRY" = "1" ]; then echo "   [dry-run] $*"; else eval "$@"; fi; }

say "0) 回退点：$SITE → $BAK"
if [ -d "$BAK" ]; then
  echo "   已存在 $BAK（保留最早那份作回退点，不覆盖）"
else
  run "cp -a '$SITE' '$BAK'"
  echo "   已备份"
fi

say "1) 容器：把带 GL 的产物摆成默认输出（原样留档）"
run "sudo docker exec o113 test -s '$GL_OUT/octave.wasm'"
if sudo docker exec o113 test -e "$NONGL_BAK"; then
  echo "   已有 $NONGL_BAK（不覆盖）"
else
  run "sudo docker exec o113 cp -a '$SRC_OUT' '$NONGL_BAK'"
  echo "   无 GL 的那份已留档到 $NONGL_BAK"
fi
# ⚠️ `cp -a X/. X/`（同路径）**会以"为同一文件"退出 1**（实测），而本脚本是 `set -e`。
# `MAIN_MODULE=2` 那条车道就是 `SRC_OUT == GL_OUT`（产物直接链在 m2ft-out）⇒ 跳过这一步。
if [ "$GL_OUT" = "$SRC_OUT" ]; then
  echo "   GL_OUT == SRC_OUT（M2 车道）：跳过拷贝（同路径 cp 会失败，且本来也不需要）"
else
  # ★ 防呆（2026-09-25 真踩过）：GL_OUT ≠ SRC_OUT 时这一步会把 GL_OUT **整个盖到** SRC_OUT 上。
  #   若 SRC_OUT 是刚链出来的新产物而 GL_OUT 是旧车道（例：SRC_OUT=m2fc-jspb-out、
  #   GL_OUT=out-webgl 是 9 月的旧件），新产物会被静默换成旧件 —— promote 的 sha/字体
  #   自检能露馅，但 boot 照样绿，很容易漏。⇒ GL_OUT 比 SRC_OUT 旧就当场拒绝。
  if sudo docker exec o113 bash -lc \
      "a=\$(stat -c%Y '$GL_OUT/octave.js' 2>/dev/null || echo 0); b=\$(stat -c%Y '$SRC_OUT/octave.js' 2>/dev/null || echo 0); [ \"\$a\" -lt \"\$b\" ]" ; then
    echo "FATAL: GL_OUT($GL_OUT) 的 octave.js 比 SRC_OUT($SRC_OUT) 的旧 ⇒ 拷贝会把新产物盖成旧件" >&2
    echo "       若 SRC_OUT 就是本次要部署的产物：用 M2 车道姿势 GL_OUT=$SRC_OUT 重跑本脚本" >&2
    exit 3
  fi
  run "sudo docker exec o113 cp -a '$GL_OUT'/. '$SRC_OUT'/"
fi

say "1b) 目标产物 vs 现役：**比现役旧的产物不许推上去**（2026-09-27 差点踩到）"
# 为什么加这道（实测）：本脚本的默认 `SRC_OUT=/src/websrc/out`、`GL_OUT=/src/websrc/out-webgl`
# 停在上一次带 GL 的批次（9-23，wasm 36.8MB 的**另一条车道**）；而现役基础档是 9-25 链的
# M2 SIMD 产物（`/src/websrc/m2fc-simd-out` = 改名前的 `product`）。**裸跑 promote 会把 8761
# 静默换成 9-23 那份**，而脚本内所有自检（gl4es / 字体 / 桥资产 / 开机）**照样全绿**。
# 判据：产物要变（sha 不同）时，容器里那份的构建时间必须**不早于**站点上现役那份的落件时间；
# 不满足就停（要硬推就显式 `FORCE_OLD_ARTIFACT=1`）。
DEP_WASM_SHA="$(sha256sum "$SITE/octave.wasm" 2>/dev/null | cut -d' ' -f1)"
SRC_WASM_SHA="$(sudo docker exec o113 sha256sum "$SRC_OUT/octave.wasm" | cut -d' ' -f1)"
LEDGER_SHA="$(python3 -c "
import json
d = json.load(open('$REPO/build/FACTS.json', encoding='utf-8'))
f = d.get('facts', d)
v = f.get('wasm_sha')
print(v.get('value') if isinstance(v, dict) else (v or ''))" 2>/dev/null || echo '')"
echo "   目标 $SRC_OUT/octave.wasm = $(printf "%s" "$SRC_WASM_SHA" | cut -c1-16)"
echo "   现役 $SITE/octave.wasm     = $(printf "%s" "$DEP_WASM_SHA" | cut -c1-16)"
echo "   台账 build/FACTS.json      = $(printf "%s" "$LEDGER_SHA" | cut -c1-16)（部署件变了就**必须**重渲染台账）"
if [ "$SRC_WASM_SHA" != "$DEP_WASM_SHA" ]; then
  echo "   ⚠️ 产物**会变**（这是换产物，不是纯资产/页面批）"
  if [ -n "$LEDGER_SHA" ] && [ "$LEDGER_SHA" != "$SRC_WASM_SHA" ]; then
    echo "   ⚠️ 目标 sha 与台账那条不一致 ⇒ 上线后跑 python3 build/facts.py --render + 六道闸门"
  fi
  src_t=$(sudo docker exec o113 stat -c %Y "$SRC_OUT/octave.wasm" 2>/dev/null || echo 0)
  dep_t=$(stat -c %Y "$SITE/octave.wasm" 2>/dev/null || echo 0)
  if [ "${src_t:-0}" -lt "${dep_t:-0}" ] && [ "${FORCE_OLD_ARTIFACT:-0}" != "1" ]; then
    echo "FATAL: 目标产物（$(date -d "@${src_t:-0}" '+%m-%d %H:%M')）比现役（$(date -d "@${dep_t:-0}" '+%m-%d %H:%M')）**旧** ⇒ 这是在把旧产物推上去" >&2
    echo "       本批次要部署哪条车道就把两处都指过去，例：SRC_OUT=/src/websrc/m2fc-simd-out GL_OUT=\$SRC_OUT sh build/promote-webgl.sh" >&2
    echo "       （M2 车道必须 GL_OUT=SRC_OUT；确有理由硬推时用 FORCE_OLD_ARTIFACT=1）" >&2
    exit 3
  fi
fi

say "2) 三大件 + 桥文件 → $SITE"
for f in octave.js octave.wasm octave.data octave.build.json; do
  # ★ A1/A2：`octave.build.json` 是**产物身份证**（页面开机读它填 Capabilities，见
  #   bridge/octave-core.js）。它必须跟产物一起走 —— 否则站点上就没有"这份产物到底带什么
  #   能力"的机器可读记录。缺了不致命（内核容忍缺席），但三列 parity 会报出来。
  run "sudo docker cp 'o113:$SRC_OUT/$f' '$SITE/$f'"
done
# ⚠️ 别用 `cp src/{a,b,c} dst` 这种花括号写法：用 `sh` 跑本脚本时（/bin/sh）花括号
#    不一定展开（实测踩过：报 `cp: 对 '...{a,b,c}' 调用 stat 失败`）。逐个列出来最稳。
# ⚠️ 清单必须跟着"页面会 <script src> / new Worker() 的文件"走：漏一个就是部署后 404。
#    octave-worker.js 是 C3/B5（2026-09-26）新增的 worker 宿主，`?worker=1` 会 `new Worker` 它。
#    octave-core.js 是 A2（2026-09-26）抽出的**内核**：页面与 worker **共用同一份**，两边都 `src` 它。
for f in index.html assets-loader.js octave-core.js lane.js queue.js p5canvas.js webaudio.js webaudiorec.js webfilepick.js webnet.js octave-worker.js; do
  run "cp '$REPO/bridge/$f' '$SITE/$f'"
done

say "2b) ★ 双档（B6）：线程档 → $SITE/threads/"
# 为什么不把它并进第 2 步：它是**另一份产物**（同名文件、子目录区分，见 bridge/lane.js），
# 而且**必须拿它自己的身份证核对**再落件 —— 线程档 verdict != ok 就**不许**上线（fail-closed）。
# 产物不在 ⇒ 只部署基础档（明确跳过并打印；双档是"该有"，但站点只跑基础档也能活）。
THREADS_OUT="${THREADS_OUT:-/src/websrc/m2fc-threads-out}"
# LANE_ON：本批次到底部不部署线程档（第 2b 与第 3b 步共用这一条判据）。
# ⚠️ 不许用"站点上有没有 threads/ 目录"当判据 —— 那正是**上一次遗留**的形状（dry-run 下也会
#    走错分支）。判据只能是"容器里有没有通过身份证核对的线程档产物"。
LANE_ON=0
if sudo docker exec o113 test -s "$THREADS_OUT/octave.wasm" 2>/dev/null; then
  LANE_ON=1
  # ⚠️ 身份证**取回宿主再读**：别在 `docker exec` 里套引号跑 python（本仓为此踩过引号地狱）。
  tmpx="$(mktemp)"
  sudo docker cp "o113:$THREADS_OUT/octave.build.json" "$tmpx" >/dev/null 2>&1 || true
  tv=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('verdict'))" "$tmpx" 2>/dev/null || echo "?")
  sudo rm -f "$tmpx"   # docker cp 落的件属 root ⇒ 普通 rm 会 EPERM（实测刷屏）
  if [ "$tv" != "ok" ]; then
    echo "FATAL: 线程档产物的身份证 verdict=$tv（**只有 ok 才可部署**）" >&2
    echo "       先跑：bash build/113/relink.sh verify threads --out $THREADS_OUT" >&2
    exit 3
  fi
  run "mkdir -p '$SITE/threads'"
  for f in octave.js octave.wasm octave.data octave.build.json; do
    run "sudo docker cp 'o113:$THREADS_OUT/$f' '$SITE/threads/$f'"
  done
  echo "   线程档已落件（verdict=ok）"
  # 两份 octave.data 与 `lane.js` 的声明必须**自洽**（判据从 "lane.js 说什么" 反过来查，
  # 而不是假设它指向根目录 —— 旧版本写死了那个假设，2026-09-27 lane.js 改成指
  # `threads/octave.data` 之后它就成了"永远 FATAL"的假判据）。
  # ⚠️ 实测事实：两份的 sha **不同**（基础 9,712,174 B / 线程 9,712,190 B），所以必须两份都在。
  a=$(sudo docker exec o113 sha256sum "$SRC_OUT/octave.data" | cut -c1-16)
  b=$(sudo docker exec o113 sha256sum "$THREADS_OUT/octave.data" | cut -c1-16)
  # 从 lane.js 的 `threads: { … data: '…' … }` 里取线程档的 data 路径（**按块取**，不用
  # `head -1`：那张表里 base 那行的 data 也叫 `data:`，顺序一换就会取错 —— 判据不许依赖行序）。
  lane_data=$(python3 - "$REPO/bridge/lane.js" <<'PY'
import re, sys
s = open(sys.argv[1], encoding='utf-8').read()
m = re.search(r"threads:\s*\{[^}]*?data:\s*'([^']+)'", s, re.S)
print(m.group(1) if m else '')
PY
)
  if [ -z "$lane_data" ]; then
    echo "FATAL: 从 bridge/lane.js 里取不到线程档的 data 路径（零值守卫：解析失败不许当通过）" >&2
    exit 3
  fi
  case "$lane_data" in
    threads/*)
      # 查**源**（容器里那份），不查站点那份：站点那份是同一步里的 `run` 拷过去的，
      # dry-run 下不会真的落件 —— 判据要在两种模式下都可复跑。
      if ! sudo docker exec o113 test -s "$THREADS_OUT/octave.data"; then
        echo "FATAL: lane.js 声明线程档的 data 是 '$lane_data'，但站点上没有这个文件" >&2
        echo "       （两份 data sha 不同：基础 $a / 线程 $b ⇒ 不能共用根目录那份）" >&2
        exit 3
      fi
      if [ "$a" = "$b" ]; then
        echo "   ℹ️ 两档 octave.data 同 sha（$a）；lane.js 仍各自取一份（多花 9.7MB，但不错）"
      else
        echo "   两档 octave.data 不同 sha（基础 $a / 线程 $b）⇒ 各自一份，lane.js 指 '$lane_data' ✓"
      fi
      ;;
    *)
      # lane.js 指根目录那份 ⇒ 只有两档同 sha 才允许（否则线程档**静默取错内容**）
      if [ "$a" != "$b" ]; then
        echo "FATAL: 两档 octave.data 的 sha **不同**（基础 $a / 线程 $b），而 lane.js 的线程档 data" >&2
        echo "       指的是 '$lane_data'（根目录那份）⇒ 线程档会**静默取到基础档的数据文件**。" >&2
        echo "       修法：把 bridge/lane.js 的 threads.data 改成 'threads/octave.data'，重跑本次 promote。" >&2
        exit 3
      fi
      echo "   两档 octave.data 同 sha（$a）⇒ lane.js 共用根目录那份 ✓"
      ;;
  esac
else
  echo "   （线程档产物不在 $THREADS_OUT ⇒ 本次只部署基础档；要双档先跑 relink.sh link threads）"
  # ★ 复核时补的洞：产物缺席时**清掉站点上遗留的 threads/** —— 否则"上一次部署的线程档"
  #   会继续留在站点上，而 lane.js 只看 COI 就选它 ⇒ 跑的是**旧线程档**（部署态与实际不符）。
  if [ -d "$SITE/threads" ]; then
    echo "   ⚠️ 站点上还有遗留的 $SITE/threads/ ⇒ 清掉（本次不部署线程档，留着就是旧件）"
    run "rm -rf '$SITE/threads'"
  fi
fi

say "3) 资产：**源在仓库**的那几个 .m 包重新打包 + 刷新清单摘要"
# 为什么必须重打：这些包的源就在仓库里（站点上的是生成物）；不重打就等于部署了**旧代码**。
# 名单是**显式**的：只有"源在仓库、且会被本批次改动"的那些才在这里重打 ——
#   · 别的（`assets/pkg/*`、`assets/oct/*`、`assets/octdir/*`）来自 vendor/容器，重打要另取源；
#   · 所以「最近改过哪个胶水目录」就得在下面加一行（漏了就是部署旧件，且不会报错）。
# ⚠️ 别用 gen-manifest：它整份重算，会把 11.3.0 站点里 file 类资产的专属 mount 路径算错。
# ⚠️ 挂载点**从 `build/assets-meta.json` 的 `mount` 读**，默认才是 `/usr/src/octave/m/<名字>`。
#    不许猜：`pkgfix` 就**不是**默认的（它必须挂 `m/pkg`，否则解析不到 private `get_description`
#    ⇒ `pkg list` 整个坏掉）。2026-09-23 我正是猜错这个，被全量回归当场抓住。
M_ASSETS="plotbridge:build/plotbridge webgraphics:build/webgraphics webfile:build/webfile pkgfix:build/pkgfix webaudio:build/webaudio webshims:build/webshims"
NAMES=""
for pair in $M_ASSETS; do
  name="${pair%%:*}"; dir="${pair#*:}"
  mount=$(python3 -c "
import json
m = json.load(open('$REPO/build/assets-meta.json', encoding='utf-8')).get('$name', {})
print(m.get('mount') or '/usr/src/octave/m/$name')
")
  echo "   $name → 挂载点 $mount"
  run "python3 '$REPO/build/assets.py' bundle-m $name '$REPO/$dir' $mount '$SITE/assets/m/$name.js'"
  NAMES="$NAMES $name"
done
run "python3 '$REPO/build/assets.py' sync-js '$SITE'$NAMES"

say "3b) ★ 双档（B6）：.oct 分档 + 线程档夹具 → $SITE/assets/{oct-threads,octdir-threads}"
# 为什么必须单独一步：线程档的 `.oct`（44 个 `-pthread` side module）**文件名与基础档逐字相同**，
# 只差目录（`oct-threads/`、`octdir-threads/`），而加载器按 `manifest.threads.json` 的 sha
# **fail-closed** 校验 ⇒ 漏这一步（或落成旧一套）的表现是"页面能开、线程档 .oct 功能全无"
#（实测：8768 首跑 accept-archive 0/20、accept-dldfcn 11/60 —— 那一片红只有一个真因）。
# ⚠️ 顺序：必须在本脚本第 3 步（重打 .m 资产 + `sync-js` **刷新 manifest.json 摘要**）**之后** ——
#    线程档清单是从基础清单生成的，先做就会带着旧的 assets/m sha 上线。
if [ "$LANE_ON" = "1" ]; then
  # ① 先把容器里的车道编目**同步到宿主**（否则用的是上一次 docker cp 的旧件 —— 本批刚在
  #    "清单指旧 sha"上栽过一次，判据必须落在**字节**上）。
  run "sudo docker cp 'o113:$LANE_OCT_OUT/.' '$LANE_OCT_HOST/'"
  run "sudo docker cp 'o113:$LANE_OCT_PKG/.' '$LANE_OCT_PKG_HOST/'"
  run "sudo chown -R \$(id -u):\$(id -g) '$LANE_OCT_HOST' '$LANE_OCT_PKG_HOST'"
  # ② 分档落地 + 生成 manifest.threads.json：四步判据全 fail-closed（文件名集合逐字、
  #    每个 .oct 有 TLS 入口、基础档反向没有、两档清单只差前缀 **且 sha 与磁盘一致**）。
  run "LANE_CORE='$LANE_OCT_HOST' LANE_PKG='$LANE_OCT_PKG_HOST' bash '$REPO/build/113/stage-lane-assets.sh' '$SITE'"
  # ③ 两个夹具（pthread 版 side module）：验收套件**按档取**它们
  #    （accept-113-oct 取 threads/minioct.oct、accept-full 取 threads/dldprobe.oct）
  #    ⇒ 8761 双档跑全量回归时缺它们就是红。
  for f in minioct.oct dldprobe.oct; do
    run "sudo docker cp 'o113:$LANE_OCT_OUT/$f' '$SITE/threads/$f'"
  done
  echo "   车道 .oct 分档 + 夹具已落件（判据见 stage-lane-assets.sh）"
else
  # ★ 与第 2b 步同理：本次不部署线程档时**清掉**遗留分档 —— 否则"上一次的线程 .oct"留在
  #   站点上，三处 parity 与人工核对都会对不上。
  for p in "$SITE/assets/oct-threads" "$SITE/assets/octdir-threads" "$SITE/assets/manifest.threads.json"; do
    if [ -e "$p" ]; then
      echo "   ⚠️ 本次不部署线程档 ⇒ 清掉遗留 $p"
      run "rm -rf '$p'"
    fi
  done
fi

say "4) VERSION"
run "echo octave-11.3.0 > '$SITE/VERSION'"
run "sudo chown -R \$(id -u):\$(id -g) '$SITE'"

say "5) 自检：部署件 sha 与容器一致 + 桥里有新机制 + 清单核对"
if [ "$DRY" = "0" ]; then
  a=$(sudo docker exec o113 sha256sum "$SRC_OUT/octave.wasm" | cut -d' ' -f1)
  b=$(sha256sum "$SITE/octave.wasm" | cut -d' ' -f1)
  [ "$a" = "$b" ] || { echo "FATAL: 站点 wasm sha 与容器不一致" >&2; exit 3; }
  echo "   octave.wasm sha256 = $a（两侧一致）"
  grep -q '__pb_core__' "$SITE/assets/m/plotbridge.js" \
    || { echo "FATAL: 站点 plotbridge 资产里没有新桥的 __pb_core__（打包没生效？）" >&2; exit 3; }
  grep -q 'loaded_graphics_toolkits' "$SITE/assets/m/webgraphics.js" \
    || { echo "FATAL: 站点 webgraphics 资产还是旧 PKG_ADD" >&2; exit 3; }
  [ -f "$SITE/p5canvas.js" ] || { echo "FATAL: 缺 p5canvas.js（index.html 会 404）" >&2; exit 3; }
  # ★ A2（2026-09-26）：octave-core.js 是**内核**（页面与 worker 共用）—— index.html 与
  #   octave-worker.js 都依赖它，缺了就是 404 + 整页起不来。与 p5canvas.js 同类，必须点名查。
  [ -f "$SITE/octave-core.js" ] || { echo "FATAL: 缺 octave-core.js（index.html/octave-worker.js 都会 404）" >&2; exit 3; }
  echo "   桥资产 / webgraphics 资产 / p5canvas.js / octave-core.js 都在"
  # ★ B6 双档：线程档的 `.oct` 分档必须**真的**在站点上。判据不写死数字（会腐烂），
  #   而是从基础清单**反查应有条数**（oct 条数 + octdir 各包的 files 数）—— 条数对不上、
  #   清单缺、夹具缺、或 `manifest.threads.json` 自检不过，一律 fail-closed 不上线。
  if [ "$LANE_ON" = "1" ]; then
    want=$(python3 - "$SITE/assets/manifest.json" <<'PY'
import json, sys
a = json.load(open(sys.argv[1], encoding='utf-8'))['assets']
n = sum(1 for x in a if x.get('kind') == 'oct')
n += sum(len(x.get('files') or []) for x in a if x.get('kind') == 'octdir')
print(n)
PY
)
    got=$(find "$SITE/assets/oct-threads" "$SITE/assets/octdir-threads" -name '*.oct' 2>/dev/null | wc -l)
    if [ "$got" != "$want" ]; then
      echo "FATAL: 站点上的车道 .oct 有 $got 个，基础清单要求 $want 个（分档没落全）" >&2
      exit 3
    fi
    [ -s "$SITE/assets/manifest.threads.json" ] || { echo "FATAL: 缺 assets/manifest.threads.json" >&2; exit 3; }
    for f in minioct.oct dldprobe.oct; do
      if [ ! -s "$SITE/threads/$f" ]; then
        echo "FATAL: 缺线程档夹具 threads/$f（验收套件按档取它，缺了 8761 全量会红）" >&2
        exit 3
      fi
    done
    python3 "$REPO/build/113/make-lane-manifest.py" "$SITE/assets" --check >/dev/null || {
      echo "FATAL: 线程档清单 --check 不过（再跑一次看明细：build/113/make-lane-manifest.py $SITE/assets --check）" >&2
      exit 3
    }
    echo "   车道 .oct $got 个（= 基础清单的 $want 条）+ 夹具 + manifest.threads.json（--check 过）✓"
  fi
  grep -qa 'gl4es_gl' "$SITE/octave.wasm" || { echo "FATAL: 站点 wasm 里没有 gl4es（不是带 GL 的那份）" >&2; exit 3; }
  echo "   站点 wasm 带 gl4es ✓"
  # FreeType（批次 D）：`EXPECT_FREETYPE=1` 时要求产物里有字体预载记录。
  # 为什么值得单列一条：**没预载字体的表现是"文字空白"**，在浏览器里很难一眼看出是
  # "没编 FreeType"还是"字体路径不对"（HISTORY §5.26）。
  if grep -q 'FreeSans.otf' "$SITE/octave.js" 2>/dev/null; then
    echo "   带 FreeType 字体预载 ✓（$(grep -o 'FreeSans[A-Za-z]*\.otf' "$SITE/octave.js" | sort -u | tr '\n' ' ')）"
  elif [ "${EXPECT_FREETYPE:-0}" = "1" ]; then
    echo "FATAL: EXPECT_FREETYPE=1 但 octave.js 里没有 FreeSans.otf 的预载记录" >&2; exit 3
  else
    echo "   （无 FreeType 字体预载 —— 这是不带文字渲染的那条车道）"
  fi
else
  echo "   [dry-run] 跳过自检"
fi

echo
echo "下一步（**必须**）："
# D8（2026-09-24）：**开机自检**放在最前面。坏产物的失败模式是**页面根本起不来**
#（G1 那次就是：绑定坏 + 有人在开机路径上调它 ⇒ 卡死），而全量 sweep 只能靠"每个套件各自
# 超时"才发现 —— 又慢又吵（40×最多 420 s）。这条 30 秒就能给结论。
if [ "$DRY" = "0" ] && curl -s --noproxy '*' -o /dev/null --max-time 5 http://127.0.0.1:8761/ 2>/dev/null; then
  echo "== D8 开机自检（8761，上限 30 s）"
  if sh "$REPO/build/check-boot.sh" http://127.0.0.1:8761/ 30000; then
    echo "   开机自检 ✓"
  else
    echo "FATAL: 开机自检没过 ⇒ **先回退**，别拿这个产物去跑验收" >&2
    exit 4
  fi
else
  echo "  （8761 上没有服务 / dry-run ⇒ 跳过开机自检；上线前手动跑：sh build/check-boot.sh http://127.0.0.1:8761/）"
fi
echo "  1) sh /mnt/hdd/octave-wasm-build/sweep.sh http://127.0.0.1:8761/      # 全量"
echo "  2) sh /mnt/hdd/zcode-projects/Octave-Full-Wasm/build/check-site-parity.sh --strict   # 三处一致（8761/8768/仓库 site）"
echo "回退：cp -a $BAK/. $SITE/   （并把容器 $SRC_OUT 换回 $NONGL_BAK）"
