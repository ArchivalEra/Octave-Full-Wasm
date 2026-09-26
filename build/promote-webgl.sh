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

say "2) 三大件 + 桥文件 → $SITE"
for f in octave.js octave.wasm octave.data; do
  run "sudo docker cp 'o113:$SRC_OUT/$f' '$SITE/$f'"
done
# ⚠️ 别用 `cp src/{a,b,c} dst` 这种花括号写法：用 `sh` 跑本脚本时（/bin/sh）花括号
#    不一定展开（实测踩过：报 `cp: 对 '...{a,b,c}' 调用 stat 失败`）。逐个列出来最稳。
# ⚠️ 清单必须跟着"页面会 <script src> / new Worker() 的文件"走：漏一个就是部署后 404。
#    octave-worker.js 是 C3/B5（2026-09-26）新增的 worker 宿主，`?worker=1` 会 `new Worker` 它。
for f in index.html assets-loader.js queue.js p5canvas.js webaudio.js webaudiorec.js webfilepick.js webnet.js octave-worker.js; do
  run "cp '$REPO/bridge/$f' '$SITE/$f'"
done

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
  echo "   桥资产 / webgraphics 资产 / p5canvas.js 都在"
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
echo "  2) sh /mnt/hdd/zcode-projects/Octave-Full-Wasm/build/check-site-parity.sh --strict   # 两站点一致"
echo "回退：cp -a $BAK/. $SITE/   （并把容器 $SRC_OUT 换回 $NONGL_BAK）"
