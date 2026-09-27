#!/usr/bin/env bash
# Octave-Full-Wasm — 把车道的 `.oct` 落到站点并生成**线程档清单**（B6，2026-09-27）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么单独一步（而不是散在 promote 里）：这一批的产物是**两套 .oct**（基础档与线程档），
# 而两套的**文件名必须逐字相同**（清单按 name/url 索引），只有目录不同（`oct/` vs `oct-threads/`）。
# 判据三条，缺一条都会"看着部署成功、实际上线程档缺功能"：
#   ① 车道 `.oct` 的文件名集合 == 基础档 manifest 里的 16 条（逐字）；
#   ② 每个落地的 `.oct` 都带 atomics（否则线程档 dlopen 会失败 —— NOTES-threads B5 实测）；
#   ③ `manifest.threads.json` 与基础清单**只差 oct/octdir 的前缀**（`make-lane-manifest.py --check`）。
#
# 用法：
#   bash build/113/stage-lane-assets.sh <站点目录>
#     SITE=/mnt/hdd/octave-wasm-build/siteWebGL LANE_CORE=/src/libwork/octs-threads \
#     LANE_PKG=/src/libwork/octs-threads-pkg bash build/113/stage-lane-assets.sh
#   容器里跑（`docker exec`）时 LANE_* 用容器路径；站点目录是**宿主**路径 ⇒ 本脚本设计成
#   "容器里生成、宿主里落地"太绕 ⇒ 实际用法是**在宿主上跑**、用 docker cp 把车道 .oct 取出来。
set -euo pipefail

SITE="${1:-${SITE:-/mnt/hdd/octave-wasm-build/siteWebGL}}"
LANE_CORE="${LANE_CORE:-/mnt/hdd/octave-wasm-build/octs-threads}"
LANE_PKG="${LANE_PKG:-/mnt/hdd/octave-wasm-build/octs-threads-pkg}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"

[ -d "$SITE/assets" ] || { echo "FATAL: $SITE/assets 不存在（站点目录写错了？）" >&2; exit 2; }
[ -d "$LANE_CORE" ] || { echo "FATAL: 车道核心 .oct 不在 $LANE_CORE（先 docker cp 出来）" >&2; exit 2; }

echo "== ① 落地 .oct（oct-threads/ + octdir-threads/）"
mkdir -p "$SITE/assets/oct-threads" "$SITE/assets/octdir-threads"
cp -f "$LANE_CORE"/*.oct "$SITE/assets/oct-threads/"
if [ -d "$LANE_PKG" ]; then
  for d in "$LANE_PKG"/*/; do
    [ -d "$d" ] || continue
    mkdir -p "$SITE/assets/octdir-threads/$(basename "$d")"
    cp -f "$d"*.oct "$SITE/assets/octdir-threads/$(basename "$d")/"
  done
fi
echo "   oct-threads: $(ls "$SITE/assets/oct-threads" | wc -l) 个；octdir-threads: $(find "$SITE/assets/octdir-threads" -name '*.oct' | wc -l) 个"

echo "== ② 生成线程档清单（并从基础清单反查）"
python3 "$REPO/build/113/make-lane-manifest.py" "$SITE/assets"

echo "== ③ 判据：文件名集合 == 基础清单的 oct/octdir 条目（逐字）"
python3 - "$SITE" <<'PY'
import json, os, sys
site = sys.argv[1]
m = json.load(open(os.path.join(site, "assets", "manifest.json"), encoding="utf-8"))
want = sorted(a["url"].rsplit("/", 1)[-1] for a in m["assets"] if a.get("kind") == "oct")
want += sorted(f for a in m["assets"] if a.get("kind") == "octdir"
               for f in (a.get("files") or []) if f.endswith(".oct"))
got = []
for sub in ("oct-threads", "octdir-threads"):
    root = os.path.join(site, "assets", sub)
    for r, _d, fs in os.walk(root):
        got += [f for f in fs if f.endswith(".oct")]
got.sort()
miss = [f for f in want if f not in got]
extra = [f for f in got if f not in want]
print("   基础 %d / 车道 %d；缺 %s；多 %s" % (len(want), len(got), miss or "无", extra or "无"))
sys.exit(1 if miss else 0)
PY

echo "== ④ 判据：线程档 .oct 有 TLS 入口 **且** 基础档没有（带反向断言）"
python3 "$REPO/build/113/check-oct-lane.py" \
  "$SITE/assets/oct-threads" "$SITE/assets/octdir-threads" \
  --base "$SITE/assets/oct" "$SITE/assets/octdir"

echo "== ⑤ 判据：两档清单只差前缀（--check 自带三条）"
python3 "$REPO/build/113/make-lane-manifest.py" "$SITE/assets" --check
echo "STAGE-LANE-ASSETS-DONE"
