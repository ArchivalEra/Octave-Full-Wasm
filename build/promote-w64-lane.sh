#!/usr/bin/env bash
# Octave-Full-Wasm — **wasm64 车道（w64 / w64-base）的受管辖发运入口**（工单 30，2026-10-01）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# ── 为什么单独一个入口，而不是并进 `promote-webgl.sh` ────────────────────────────
# 两条**实测**理由（不是口味问题）：
#  ① `promote-webgl.sh` 是**产物导向**的：它会从容器 `THREADS_OUT`（默认
#     ~~`/src/websrc/m2fc-threads-out`~~ **（threads 档已删，2026-10-17 三线裁决）**。
#     （工单 19/27 的试验重链落在那里），**站点上现役线程档是 `e570905e…`**
#     ⇒ 裸跑 promote-webgl.sh 会把线程档换掉，而本批的硬判据是
#     "**base 档逐字节不许变，threads 档必须不存在**"。
#  ② w64 车道还带**自己的一套 `.oct`**（`assets/oct-w64/`、`assets/octdir-w64/`）和自己那份
#     `manifest.w64.json`（它把 install 前缀改口到 `/src/work/octave-install-w64`）
#     —— promote-webgl.sh 里没有这条路径。
# ⇒ 8761 的 w64 车道由**本脚本**加（AGENTS「8761 只由受管辖入口改」的同类物：
#   有 `--dry-run` / `--verify` / `--selftest`，且全部判据 fail-closed）。
#
# ── 判据（逐条 fail-closed）────────────────────────────────────────────────────
#   A. 进件前：目标站点的 **base 档 sha 必须等于台账**（`wasm_sha`）且**不许存在任何
#      threads 痕迹**（三线裁决：threads 档已删 —— 残留即 FATAL）。w64 批次只许**新增** w64 两格。
#   B. 容器里两份产物：`octave.build.json` 的 `verdict == "ok"`、`measured.wasm64 == true`
#      （w64 还要 `measured.threads.shared_memory == true`；w64-base 必须是 false）。
#   C. 落件后逐档核：**身份证自查**（`check-build-manifest.py --out-dir`：清单里的 sha 与磁盘
#      上的字节逐条对上）+ `w64/octave.wasm` sha == 台账 `w64_wasm_sha`（容器那份不许是别的）。
#   D. base 档 sha **逐字节未变** + threads 痕迹仍为零（再查一次 —— 防"拷错方向"/"塞回死档"）。
#   E. `lanes.js` 由 `gen-lanes.sh` **按磁盘重生成** ⇒ 必须列出四档（缺档 = 选档器 404）。
#   F. 车道 `.oct` 条数 == 基础清单的 oct/octdir 条数（与 promote-webgl 第 5 步同构），
#      且 `make-lane-manifest.py --check --lane w64` 过。
#
# 用法：
#   sh build/promote-w64-lane.sh --dry-run [站点目录]
#   sh build/promote-w64-lane.sh --verify  [站点目录]     # 只核不写（promote 之后跑）
#   sh build/promote-w64-lane.sh --selftest               # F1：夹具上证明它会红
#   sh build/promote-w64-lane.sh [站点目录]               # 真发运（缺省 8768 = siteWebGL）
#   sh build/promote-w64-lane.sh /mnt/hdd/octave-wasm-build/site       # 8761（8768 验绿之后）
#
# 环境变量（自证/本地模式用；正常发运不用设）：
#   CTR=-          本地模式：`W64_OUT` / `W64_BASE_OUT` / `LANE_OCT*` 当**宿主**路径读（不碰 docker）
#   SITE=/path     目标站点（与位置参数等价）
set -uo pipefail

REPO=${REPO:-/mnt/hdd/zcode-projects/Octave-Full-Wasm}
BASE=${OCTAVE_WASM_BASE:-/mnt/hdd/octave-wasm-build}
CTR=${CTR:-o113}
W64_OUT=${W64_OUT:-/src/websrc/w64-out}
W64_BASE_OUT=${W64_BASE_OUT:-/src/websrc/w64-base-out}
LANE_OCT=${LANE_OCT:-/src/libwork/octs-w64}
LANE_OCT_PKG=${LANE_OCT_PKG:-/src/libwork/octs-w64-pkg}
LANE_OCT_HOST=${LANE_OCT_HOST:-$BASE/octs-w64}
LANE_OCT_PKG_HOST=${LANE_OCT_PKG_HOST:-$BASE/octs-w64-pkg}
# 站点上每档要落的四件（与 lane.js 的 FILES 表一致）+ 两个 pthread 夹具（验收套件按档取）
LANE_FILES="octave.js octave.wasm octave.data octave.build.json"
LANE_FIXTURES="minioct.oct dldprobe.oct"
LEDGER_BASE_KEY=wasm_sha
LEDGER_THREADS_KEY=  # threads 档已删（2026-10-17）：不再取台账键，改为死档断言
LEDGER_W64_KEY=w64_wasm_sha
LEDGER_W64B_KEY=w64_base_wasm_sha

MODE="do"; SITE_ARG=""
case "${1:-}" in
  --dry-run)  MODE=dry;    shift ;;
  --verify)   MODE=verify; shift ;;
  --selftest) MODE=selftest; shift ;;
  -h|--help)  sed -n '2,40p' "$0"; exit 0 ;;
esac
SITE="${1:-${SITE:-$BASE/siteWebGL}}"

say() { printf '== %s\n' "$*"; }
run() { if [ "$MODE" = "dry" ]; then printf '   [dry-run] %s\n' "$*"; else eval "$@"; fi; }
die() { printf 'FATAL: %s\n' "$*" >&2; exit 3; }

# ── 容器抽象（CTR=- ⇒ 本地模式，自证就在这条路上跑）────────────────────────────
ctr_cp () {   # ctr_cp <源> <目标>      源是容器路径（本地模式：宿主路径）
  if [ "$CTR" = "-" ]; then run "cp -a '$1' '$2'"; else run "sudo docker cp '$CTR:$1' '$2'"; fi
}
ctr_cp_dir () {  # ctr_cp_dir <目录> <目标目录>   —— 取整个目录内容
  if [ "$CTR" = "-" ]; then run "cp -a '$1/.' '$2/'"; else run "sudo docker cp '$CTR:$1/.' '$2/'"; fi
}
ctr_has () {  # 有且非空
  if [ "$CTR" = "-" ]; then [ -s "$1" ]; else sudo docker exec "$CTR" test -s "$1"; fi
}
ctr_peek () {  # 只读取件 —— **dry-run 也真做**（判据要在两种模式下都可复跑）
  if [ "$CTR" = "-" ]; then cp -a "$1" "$2"; else sudo docker cp "$CTR:$1" "$2"; fi
}
ctr_sha () {
  if [ "$CTR" = "-" ]; then sha256sum "$1" | cut -d' ' -f1
  else sudo docker exec "$CTR" sha256sum "$1" | cut -d' ' -f1; fi
}
ledger () {   # ledger <键>  ⇒ 台账里的值（读不到 ⇒ 空）
  python3 - "$REPO" "$1" <<'PY'
import json, os, sys
d = json.load(open(os.path.join(sys.argv[1], "build", "FACTS.json"), encoding="utf-8"))
f = d.get("facts", d)
v = f.get(sys.argv[2])
print(v.get("value") if isinstance(v, dict) else (v if v is not None else ""))
PY
}
jget () {     # jget <json 文件> <点分键>
  python3 - "$1" "$2" <<'PY'
import json, sys
try:
    cur = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception as e:                       # noqa: BLE001
    print(""); sys.exit(0)
for k in sys.argv[2].split("."):
    if isinstance(cur, dict) and k in cur: cur = cur[k]
    else: print(""); sys.exit(0)
print(cur if not isinstance(cur, bool) else ("true" if cur else "false"))
PY
}
# 身份证里记的 octave.wasm sha —— **不能走 jget 的点分路径**：键名本身带点
# （`measured.files["octave.wasm"].sha256`），点分会被切成 5 段 ⇒ 永远取到空串
# （实测：本轮自检第一跑就是这么假红的）。
card_sha () {
  python3 - "$1" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:                            # noqa: BLE001
    print(""); sys.exit(0)
print((((d.get("measured") or {}).get("files") or {}).get("octave.wasm") or {}).get("sha256") or "")
PY
}
short () { printf '%s' "${1:-}" | cut -c1-16; }
sha12 () { sha256sum "$1" 2>/dev/null | cut -c1-12 || echo "(缺)"; }

# ── A/D：base 的 sha 守卫 + threads 死档断言（**本批的反向断言**）──────────────────
# 写成函数是为了自证能直接喂合成值（三类用例都走它，不碰真站点）。
lane_guard () {  # lane_guard <站点> <期望base> <_unused> <模式：before|after> <before_base> <_unused2>
  # ★ 三线裁决（2026-10-17）：threads 档已删 —— 本守卫对 threads 只做**死档断言**：
  #   站点上不许存在任何 threads 痕迹（目录/分档清单/分档 .oct）。出现 = FATAL。
  local site="$1" wb="$2" _wt="$3" phase="$4" bb="${5:-}" _bt="${6:-}" rc=0
  local gb
  gb="$(sha256sum "$site/octave.wasm" 2>/dev/null | cut -d' ' -f1)"
  [ -n "$gb" ] || { printf 'FATAL: %s/octave.wasm 读不到（站点目录写错了？）\n' "$site" >&2; return 1; }
  [ "$gb" = "$wb" ] || { printf 'FATAL: base 档 sha=%s ≠ 台账 %s\n' "$(short "$gb")" "$(short "$wb")" >&2; rc=1; }
  local dead
  for dead in "$site/threads" "$site/assets/oct-threads" "$site/assets/octdir-threads" "$site/assets/manifest.threads.json"; do
    [ -e "$dead" ] && { printf 'FATAL: 站点存在死档残留 %s（threads 档已删 —— wasm32 不允许多线程）\n' "$dead" >&2; rc=1; }
  done
  if [ "$phase" = after ]; then
    [ "$gb" = "$bb" ] || { printf 'FATAL: 本批不许动 base 档，但 sha 从 %s 变成了 %s\n' "$(short "$bb")" "$(short "$gb")" >&2; rc=1; }
  fi
  return "$rc"
}

# ── C：单档核（身份证 + 与容器/台账一致）────────────────────────────────────────
lane_check () {  # lane_check <站点> <档名> <期望sha 或 空>
  local site="$1" lane="$2" want="$3" d="$1/$2" rc=0 got card
  [ -s "$d/octave.wasm" ] || { echo "FATAL: $d/octave.wasm 不在" >&2; return 1; }
  for f in $LANE_FILES; do [ -s "$d/$f" ] || { echo "FATAL: 缺 $d/$f" >&2; rc=1; }; done
  got="$(sha256sum "$d/octave.wasm" | cut -d' ' -f1)"
  if [ -n "$want" ] && [ "$got" != "$want" ]; then
    echo "FATAL: $lane 档 sha=$(short "$got") ≠ 台账 $(short "$want")" >&2; rc=1
  fi
  card="$(card_sha "$d/octave.build.json")"
  [ "$card" = "$got" ] || { echo "FATAL: $lane 身份证记的 sha=$(short "$card") ≠ 磁盘 $(short "$got")（清单与产物不是一对）" >&2; rc=1; }
  [ "$(jget "$d/octave.build.json" measured.wasm64)" = true ] || { echo "FATAL: $lane 身份证没说 wasm64" >&2; rc=1; }
  echo "   $lane: sha=$(short "$got") wasm64=$(jget "$d/octave.build.json" measured.wasm64) shared=$(jget "$d/octave.build.json" measured.threads.shared_memory)"
  return "$rc"
}

lane_manifest_check () {  # <站点> <档名>
  local site="$1" lane="$2"
  python3 "$REPO/build/113/make-lane-manifest.py" "$site/assets" --check --lane "$lane" >/dev/null 2>&1 || {
    echo "FATAL: manifest.$lane.json --check 不过（明细：python3 build/113/make-lane-manifest.py $site/assets --check --lane $lane）" >&2
    return 1; }
  python3 - "$site" "$lane" <<'PY' || return 1
import json, os, sys
site, lane = sys.argv[1], sys.argv[2]
m = json.load(open(os.path.join(site, "assets", "manifest.json"), encoding="utf-8"))["assets"]
want = sum(1 for a in m if a.get("kind") == "oct")
want += sum(len(a.get("files") or []) for a in m if a.get("kind") == "octdir")
got = 0
for sub in ("oct-%s" % lane, "octdir-%s" % lane):
    root = os.path.join(site, "assets", sub)
    got += sum(1 for r, _d, fs in os.walk(root) for f in fs if f.endswith(".oct"))
if got != want:
    print("FATAL: 站点上 %s 的 .oct 有 %d 个，基础清单要求 %d 个\n" % (lane, got, want), file=sys.stderr)
    raise SystemExit(1)
print("   assets/%s 系列：%d 个 .oct（= 基础清单的 %d 条）" % (lane, got, want))
PY
}

lanes_js_check () {  # <站点>
  python3 - "$1" <<'PY' || return 1
import json, os, re, sys
site = sys.argv[1]
p = os.path.join(site, "lanes.js")
s = open(p, encoding="utf-8").read() if os.path.exists(p) else ""
m = re.search(r"__octaveLanes\s*=\s*(\[[^\]]*\])", s)
inv = json.loads(m.group(1)) if m else []
want = ["base", "w64", "w64-base"]   # 三线裁决：threads 已删；出现 threads 也红
miss = [x for x in want if x not in inv]
dead = [x for x in inv if x == "threads"]
if miss or dead:
    print("FATAL: lanes.js 期望 %s（实际 %s；死档残留=%s）⇒ 选档器会挑到没部署的档并 404\n"
          % (want, inv, dead), file=sys.stderr)
    raise SystemExit(1)
print("   lanes.js = %s" % inv)
PY
}

verify_site () {  # <站点>  —— 只核不写
  local site="$1" rc=0 wb w64b
  wb="$(ledger $LEDGER_BASE_KEY)"
  w64b="$(ledger $LEDGER_W64B_KEY)"
  [ -n "$wb" ] || die "台账读不到 $LEDGER_BASE_KEY（$REPO/build/FACTS.json）"
  [ -d "$site" ] || die "站点目录不存在：$site"
  lane_guard "$site" "$wb" "" before || rc=1
  lane_check "$site" w64 "$(ledger $LEDGER_W64_KEY)" || rc=1
  lane_check "$site" w64-base "$w64b" || rc=1
  for lane in w64 w64-base; do
    for f in $LANE_FIXTURES; do
      [ -s "$site/$lane/$f" ] || { echo "FATAL: 缺夹具 $site/$lane/$f（验收套件按档取它）" >&2; rc=1; }
    done
    python3 "$REPO/build/113/check-build-manifest.py" "$site/$lane/octave.build.json" \
      --out-dir "$site/$lane" >/dev/null 2>&1 || {
      echo "FATAL: $lane 的出厂核对（check-build-manifest --out-dir）不过" >&2; rc=1; }
  done
  # 清单只有一份 manifest.w64.json，两档共用（见第 5 步的注释）
  lane_manifest_check "$site" w64 || rc=1
  lanes_js_check "$site" || rc=1
  return "$rc"
}

# ── 自证（F1；三类用例：正常不报 / 该报的必须报 / 空输入必须报）────────────────
selftest () {
  local tmp bad=0 n=0
  tmp="$(mktemp -d)"
  trap "rm -rf '$tmp'" EXIT
  mkfix () {  # mkfix <站点>（base + 空 manifest；threads 死档不存在才是"正常"）
    local d="$1"
    mkdir -p "$d/assets"
    printf 'BASE' > "$d/octave.wasm"
    printf '[]' > "$d/assets/manifest.json"
  }
  bs="$(printf 'BASE' | sha256sum | cut -d' ' -f1)"
  # ① 正常：base 与台账一致且无 threads 痕迹 ⇒ 不报
  n=$((n+1)); mkfix "$tmp/ok"
  if lane_guard "$tmp/ok" "$bs" "" before >/dev/null 2>&1; then
    echo "PASS | lane_guard：base 与台账一致且无死档 ⇒ 放行"
  else echo "fail | lane_guard 正常用例竟然报错"; bad=$((bad+1)); fi
  # ② 该报的必须报：base 被换过 ⇒ 必须红（本批的反向断言）
  n=$((n+1)); mkfix "$tmp/bad"; printf 'OTHER' > "$tmp/bad/octave.wasm"
  if lane_guard "$tmp/bad" "$bs" "" before >/dev/null 2>&1; then
    echo "fail | ★ base 档被换过却没报（反向断言失效）"; bad=$((bad+1))
  else echo "PASS | ★ base 档 sha 不等于台账 ⇒ 必须红"; fi
  # ③ 该报的必须报：死档残留（threads/ 目录）⇒ 必须红（三线裁决的反向断言）
  n=$((n+1)); mkfix "$tmp/dead"; mkdir -p "$tmp/dead/threads"; printf 'THR' > "$tmp/dead/threads/octave.wasm"
  if lane_guard "$tmp/dead" "$bs" "" before >/dev/null 2>&1; then
    echo "fail | ★ threads 死档残留却没报"; bad=$((bad+1))
  else echo "PASS | ★ threads 死档残留 ⇒ 必须红（wasm32 不允许多线程）"; fi
  # ④ 空输入必须报：站点目录不存在 ⇒ lane_guard 必须红
  n=$((n+1))
  if lane_guard "$tmp/nonexistent" "$bs" "" before >/dev/null 2>&1; then
    echo "fail | ★ 站点不存在却没报（零值守卫失效）"; bad=$((bad+1))
  else echo "PASS | ★ 站点目录不存在 ⇒ 必须红"; fi
  # ⑤ 空输入必须报：lanes.js 缺档或含死档 ⇒ 必须红
  n=$((n+1)); mkdir -p "$tmp/lanes"
  printf '(function(g){g.__octaveLanes = ["base","threads"];})(self);\n' > "$tmp/lanes/lanes.js"
  if lanes_js_check "$tmp/lanes" >/dev/null 2>&1; then
    echo "fail | ★ 含死档 threads 的清单竟通过"; bad=$((bad+1))
  else echo "PASS | ★ lanes.js 含 threads（死档）或缺档 ⇒ 必须红"; fi
  n=$((n+1)); : > "$tmp/lanes/lanes.js"
  if lanes_js_check "$tmp/lanes" >/dev/null 2>&1; then
    echo "fail | ★ 空 lanes.js 竟通过"; bad=$((bad+1))
  else echo "PASS | ★ 空 lanes.js ⇒ 必须红"; fi
  # ⑥ 该报的必须报：身份证 sha 与磁盘不符 ⇒ lane_check 必须红
  n=$((n+1)); mkdir -p "$tmp/card/w64"
  for f in $LANE_FILES; do printf 'x' > "$tmp/card/w64/$f"; done
  printf '%s' '{"measured":{"wasm64":true,"files":{"octave.wasm":{"sha256":"deadbeef"}}}}' \
    > "$tmp/card/w64/octave.build.json"
  if lane_check "$tmp/card" w64 "" >/dev/null 2>&1; then
    echo "fail | ★ 身份证与磁盘不符却没报"; bad=$((bad+1))
  else echo "PASS | ★ 身份证 sha ≠ 磁盘字节 ⇒ 必须红"; fi
  echo "=== promote-w64-lane 自证：$((n-bad)) PASS / $bad fail ==="
  [ "$bad" = 0 ] || exit 1
  return 0
}

if [ "$MODE" = selftest ]; then selftest; exit $?; fi

# ── --verify：只核不写 ────────────────────────────────────────────────────────
if [ "$MODE" = verify ]; then
  say "verify $SITE"
  if verify_site "$SITE"; then echo "✅ 三格齐备（base/w64/w64-base）且无 threads 痕迹"; exit 0; fi
  exit 3
fi

# ── 真发运 / dry-run ─────────────────────────────────────────────────────────
say "目标站点 $SITE（模式 $MODE；容器 $CTR）"
[ -d "$SITE" ] || die "站点目录不存在：$SITE"
WB="$(ledger $LEDGER_BASE_KEY)"
W64W="$(ledger $LEDGER_W64_KEY)"; W64BW="$(ledger $LEDGER_W64B_KEY)"
[ -n "$WB" ] || die "台账读不到 $LEDGER_BASE_KEY"
BEFORE_B="$(sha256sum "$SITE/octave.wasm" | cut -d' ' -f1)"

say "0) 进件前守卫：base 等于台账 + 无 threads 痕迹（**本批只许新增 w64 两格**）"
echo "   base    现值 $(short "$BEFORE_B") / 台账 $(short "$WB")"
lane_guard "$SITE" "$WB" "" before || die "站点现状与台账不符（或有 threads 死档残留）⇒ 别在本批动它（先把站点修回台账态）"

say "1) 容器产物与身份证核对（verdict / wasm64 / shared）"
for pair in "w64:$W64_OUT:true" "w64-base:$W64_BASE_OUT:false"; do
  lane="${pair%%:*}"; rest="${pair#*:}"; out="${rest%%:*}"; want_shared="${rest##*:}"
  ctr_has "$out/octave.wasm" || die "容器里没有 $out/octave.wasm"
  tx="$(mktemp)"; ctr_peek "$out/octave.build.json" "$tx" >/dev/null 2>&1 || true
  v="$(jget "$tx" verdict)"; m64="$(jget "$tx" measured.wasm64)"; shm="$(jget "$tx" measured.threads.shared_memory)"
  # docker cp 落的件属 root ⇒ 普通 rm 会 EPERM（实测刷屏），本地模式才是普通 rm
  if [ "$CTR" = "-" ]; then rm -f "$tx"; else sudo rm -f "$tx"; fi
  echo "   $lane：verdict=$v wasm64=$m64 shared=$shm"
  [ "$v" = ok ] || die "$lane 产物 verdict=$v（只有 ok 可部署）"
  [ "$m64" = true ] || die "$lane 产物 measured.wasm64 不是 true"
  [ "$shm" = "$want_shared" ] || die "$lane 的 shared_memory=$shm（应为 $want_shared）"
  echo "   容器 sha=$(ctr_sha "$out/octave.wasm" | cut -c1-16)"
done

say "2) 落两档四件 → $SITE/{w64,w64-base}/"
for pair in "w64:$W64_OUT" "w64-base:$W64_BASE_OUT"; do
  lane="${pair%%:*}"; out="${pair#*:}"
  run "mkdir -p '$SITE/$lane'"
  for f in $LANE_FILES; do ctr_cp "$out/$f" "$SITE/$lane/$f"; done
  for f in $LANE_FIXTURES; do ctr_cp "$LANE_OCT/$f" "$SITE/$lane/$f"; done
done

say "3) 车道 .oct + manifest.w64.json（按清单落件，不按目录映射）"
if [ "$CTR" = "-" ]; then
  LO="$LANE_OCT"; LOP="$LANE_OCT_PKG"
else
  run "mkdir -p '$LANE_OCT_HOST' '$LANE_OCT_PKG_HOST'"
  ctr_cp_dir "$LANE_OCT" "$LANE_OCT_HOST"
  ctr_cp_dir "$LANE_OCT_PKG" "$LANE_OCT_PKG_HOST"
  run "sudo chown -R \$(id -u):\$(id -g) '$LANE_OCT_HOST' '$LANE_OCT_PKG_HOST'"
  LO="$LANE_OCT_HOST"; LOP="$LANE_OCT_PKG_HOST"
fi
run "python3 '$REPO/build/113/stage-oct-by-manifest.py' '$SITE' '$LO' '$LOP' --lane w64"
run "python3 '$REPO/build/113/make-lane-manifest.py' '$SITE/assets' --lane w64"

say "4) lanes.js：按磁盘重生成（生成物，不许手改）"
run "sh '$REPO/build/gen-lanes.sh' '$SITE'"

if [ "$MODE" = dry ]; then
  echo
  echo "（dry-run：跳过自检与收尾）"
  exit 0
fi

say "5) 自检"
rc=0
lane_guard "$SITE" "$WB" "" after "$BEFORE_B" || rc=1
lane_check "$SITE" w64 "$W64W" || rc=1
lane_check "$SITE" w64-base "$W64BW" || rc=1
for lane in w64 w64-base; do
  for f in $LANE_FIXTURES; do
    [ -s "$SITE/$lane/$f" ] || { echo "FATAL: 缺夹具 $SITE/$lane/$f" >&2; rc=1; }
  done
  python3 "$REPO/build/113/check-build-manifest.py" "$SITE/$lane/octave.build.json" \
    --out-dir "$SITE/$lane" >/dev/null 2>&1 || { echo "FATAL: $lane 出厂核对不过" >&2; rc=1; }
done
# ⚠️ 清单**只有一份** `assets/manifest.w64.json`：w64 与 w64-base **共用**它
#    （lane.js 的 FILES 表两档都指它 —— 差的是主产物，`.oct` 那套是同一批 wasm64 side module）
lane_manifest_check "$SITE" w64 || rc=1
lanes_js_check "$SITE" || rc=1
# ★ 架构纯度（用户点令 2026-10-12）：本批只许 wasm64 —— 宿主 / `.oct` / 站点资产三处同档。
#   为什么放在这：混编的失败模式是"宿主与 .oct 都建成功、自检全绿、运行期才炸"
#   （NOTES-emsdk-upgrade §7.5/§7.6 两个 6.x 假阳都是这个形状），而发运是最后一道闸。
#   反向断言见 check-lane-purity.py --selftest（喂错档的 .oct 必须红）。
for lane in w64 w64-base; do
  python3 "$REPO/build/113/check-lane-purity.py" --lane "$lane" \
    --host "$SITE/$lane/octave.wasm" \
    --oct "$SITE/assets/oct-$lane" "$SITE/assets/octdir-$lane" || {
      echo "FATAL: $lane 架构不纯（宿主与 .oct 不同档）⇒ 别上线" >&2; rc=1; }
done
# 落件属 root（docker cp）⇒ 把站点归还给当前用户（与 promote-webgl.sh 第 4 步同构）
run "sudo chown -R \$(id -u):\$(id -g) '$SITE'"
[ "$rc" = 0 ] || die "自检没过 ⇒ **别上线**（站点可能已是半成品：重跑本脚本或从备份回滚）"
echo "   ✅ w64 两格齐、base 未动、无 threads 痕迹、清单与 .oct 条数自洽、lanes.js 三格"

echo
echo "下一步（**必须**）："
echo "  1) sh $REPO/build/check-boot.sh <URL> 30000          # 开机自检（30 秒；不过就别往下走）"
echo "  2) SITE_DIR=$SITE PROBES=1 sh $REPO/build/sweep.sh <URL> probe-lane"
echo "  3) sh $REPO/build/sweep.sh <URL>                     # 全量"
echo "  回滚：rm -rf $SITE/w64 $SITE/w64-base $SITE/assets/oct-w64 $SITE/assets/octdir-w64 \\"
echo "          $SITE/assets/manifest.w64.json && sh $REPO/build/gen-lanes.sh $SITE"
