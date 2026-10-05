#!/usr/bin/env bash
# site-illegalperf.sh — **IllegalPerformance 分支专属实验站**的受管辖装配入口。
#
# 为什么存在（用户指令 2026-10-05）：分支线不得拿 /tmp 拷贝或主线站点做实验——
# 否则"傻傻分不清，归类事实也会乱"。本脚本把候选/对照产物装配进**命名站点目录**，
# 写谱系标记（SITE-ILLEGALPERF.json），幂等可重跑；FACTS/STATE 引用站点事实时
# 一律指向这里的标记，不指向 /tmp。
#
# 用法：
#   sh build/113/site-illegalperf.sh --candidate <artifact-dir>  # 候选（RUST_SORT=1）
#   sh build/113/site-illegalperf.sh --baseline  <artifact-dir>  # 对照（旋钮关）
#   sh build/113/site-illegalperf.sh --status                    # 读谱系标记
#
# 目录（持久盘）：/mnt/hdd/octave-wasm-build/site-illegalperf      （候选）
#               /mnt/hdd/octave-wasm-build/site-illegalperf-baseline（对照）
# 端口约定：8868=候选、8869=对照；**必须带头起**（serve-coi.py 默认 COI）——
#   页面在 COI 下选 w64 档，候选就住在 w64 槽。
# 四格结构保留：base(根)/threads/w64-base 槽 = 主线现状拷贝（本线未动，
#   标记里如实记 untouched）；w64 槽 = 本线产物。
set -euo pipefail
REPO=${REPO:-$(cd "$(dirname "$0")/../.." && pwd)}
BASE=${ILLEG_PERF_BASE:-/mnt/hdd/octave-wasm-build}
MAIN_SITE=$BASE/site

MODE=${1:-}
ART=${2:-}
case "$MODE" in
  --candidate) DEST=$BASE/site-illegalperf  ; KIND=candidate ;;
  --baseline)  DEST=$BASE/site-illegalperf-baseline ; KIND=baseline ;;
  --status)    for f in $BASE/site-illegalperf/SITE-ILLEGALPERF.json \
                        $BASE/site-illegalperf-baseline/SITE-ILLEGALPERF.json; do
                   [ -f "$f" ] && { echo "== $f"; cat "$f"; }; done
               exit 0 ;;
  *) echo "用法: $0 --candidate|--baseline <artifact-dir> | --status" >&2; exit 2 ;;
esac

[ -n "$ART" ] || { echo "FATAL: 缺 artifact 目录" >&2; exit 2; }
for f in octave.js octave.wasm octave.data octave.build.json; do
  [ -f "$ART/$f" ] || { echo "FATAL: $ART 缺 $f" >&2; exit 2; }
done
# 只收 verdict=ok 的产物（身份证不可部署的东东不上站）
python3 - "$ART/octave.build.json" <<'PY' || { echo "FATAL: 产物 verdict 不是 ok（不可上站）" >&2; exit 2; }
import json, sys
d = json.load(open(sys.argv[1]))
sys.exit(0 if d.get("verdict") == "ok" else 1)
PY

mkdir -p "$DEST"
rsync -a --delete "$MAIN_SITE/" "$DEST/"
# 只覆盖 w64 槽（四格结构里 base(根)/threads/w64-base 槽属主线，一个字节都不动）。
# 身份证 octave.build.json 必须随行——probe-artifact-sha 的 ③a 档内自洽判据读它
# （漏拷 = 探针拿主线旧身份证对候选字节，1 FAIL 的教训 2026-10-05）。
cp "$ART/octave.wasm" "$DEST/w64/octave.wasm"
cp "$ART/octave.js"  "$DEST/w64/octave.js"
cp "$ART/octave.data" "$DEST/w64/octave.data"
cp "$ART/octave.build.json" "$DEST/w64/octave.build.json"
git -C "$REPO" rev-parse --short=12 HEAD > "$DEST/.illegalperf-commit" 2>/dev/null || true

WASM_SHA=$(sha256sum "$ART/octave.wasm" | cut -d' ' -f1)
python3 - "$DEST/SITE-ILLEGALPERF.json" "$KIND" "$ART" "$WASM_SHA" <<'PY'
import json, sys, datetime
dest, kind, art, sha = sys.argv[1:5]
mark = {
  "branch": "IllegalPerformance",
  "kind": kind,
  "assembled_utc": datetime.datetime.now(datetime.UTC).isoformat(),
  "w64_slot": {
    "from_artifact_dir": art,
    "wasm_sha256": sha,
    "rust_sort": kind == "candidate",
    "note": "w64 槽 = 本线候选/对照；base(根)/threads/w64-base 槽 = 主线现状拷贝（untouched）"
  },
  "untouched_lanes": ["base(root)", "threads", "w64-base"],
  "ports": {"candidate": 8868, "baseline": 8869, "server": "build/serve-coi.py（COI 带头）"}
}
json.dump(mark, open(dest, "w"), ensure_ascii=False, indent=1)
PY
echo "装配完成：$DEST（$KIND，w64 槽 wasm sha $(printf '%.16s' "$WASM_SHA")…）"
