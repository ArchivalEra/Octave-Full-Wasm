#!/usr/bin/env bash
# sort-ab.sh — rust-sort 插件的 hotpath A/B（工单 63 候选③）。
# 方法学（instruments.json 登记的两条纪律都满足）：
#   · 冷启动 = 每次计时前重随机化（probe-hotpath 每轮新解释器，rand 在计时片段内）；
#   · 交错 ≥3 轮（on/off 交替，抑制机器漂移）；asc/desc 各一列。
# 用法：bash build/113/sort-ab.sh <candidate-site-dir> <baseline-site-dir> [轮数=3]
#   输出每行 `roundN on|off asc|desc wall=Xms`；判读：on 的 wall 中位 ≪ off ⇒ ADOPT。
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd)
ON=${1:?缺候选站点目录}
OFF=${2:?缺对照站点目录}
N=${3:-3}

SNIP_ASC='x=rand(2000000,1); s=sort(x);'
SNIP_DESC="x=rand(2000000,1); s=sort(x,'descend');"

for round in $(seq 1 "$N"); do
  for side in on off; do
    for tag in asc desc; do
      if [ "$side" = on ]; then dir=$ON; else dir=$OFF; fi
      if [ "$tag" = asc ]; then snip=$SNIP_ASC; else snip=$SNIP_DESC; fi
      out="/tmp/sort-ab-$side-$tag-$round.json"
      # 经 harness runner（playwright-core 装在 harness；直 node 会 ERR_MODULE_NOT_FOUND）。
      # 先收全量输出再匹配——pipefail×grep 假阴性已两次入档（§5.89）。
      raw=$(HOTPATH_DIR="$dir" HOTPATH_SNIPPET="$snip" HOTPATH_EXPECT_LANE=w64 \
        HOTPATH_OUT="$out" \
        sh "$REPO/test/browser/run.sh" "$REPO/test/browser/probe-hotpath.mjs" 2>&1 || true)
      line=$(printf '%s' "$raw" | grep -oE 'wall=[0-9]+ms' | head -1 || true)
      lane=$(printf '%s' "$raw" | grep -oE 'chosen=[a-z0-9-]+' | head -1 || true)
      echo "round$round $side $tag ${line:-wall=FAIL} ${lane}"
    done
  done
done
