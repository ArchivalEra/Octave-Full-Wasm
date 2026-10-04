#!/usr/bin/env bash
# Octave-Full-Wasm — 上游供给（仓库架构批 B4）：把 upstream/ 的 submodule checkout
# 打成 tar 流入容器目标路径，并写**树指纹** stamp（witness-upstream-pin.py 核对用）。
# Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
#
# 用法：sh build/provision-upstream.sh [--into /src/work/upstream] [--only name,name]
#
# 形态：pin 在 build/upstream-pins.json（kind=tree 的才供给；kind=toolchain 的只是
# 版本断言，emsdk 那种 1.8G 的 portable SDK 不流进容器）。
# stamp 内容 = "<name> <branch> <commit> <dirty>"；容器树被手改/换源 ⇒ witness 红。
set -euo pipefail
REPO=${REPO:-/mnt/hdd/zcode-projects/Octave-Full-Wasm}
CTR=${CTR:-o113}
INTO=/src/work/upstream
ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --into) INTO="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
    *) echo "未知参数 $1" >&2; exit 2 ;;
  esac
done
[ -f "$REPO/build/upstream-pins.json" ] || { echo "FATAL: build/upstream-pins.json 不存在" >&2; exit 2; }

python3 - "$REPO" "$ONLY" <<'PY' > /tmp/provision-list.$$
import json, sys, os
spec = json.load(open(os.path.join(sys.argv[1], "build", "upstream-pins.json")))
only = set(filter(None, (sys.argv[2] or "").split(",")))
for p in spec.get("pins", []):
    if p.get("kind") != "tree":
        continue
    if only and p["name"] not in only:
        continue
    print(p["name"], p["submodule_path"], p["container_path"], p.get("branch", ""))
PY

while read -r name sub cpath branch; do
  [ -d "$REPO/$sub/.git" ] || git -C "$REPO" submodule update --init --depth 1 "$sub"
  BRANCH_ARG=""
  [ -n "$branch" ] && BRANCH_ARG="-b $branch"
  COMMIT=$(git -C "$REPO/$sub" rev-parse HEAD)
  DIRTY=$(git -C "$REPO/$sub" status --porcelain | wc -l)
  echo "== 供给 $name → $CTR:$cpath（$COMMIT，dirty=$DIRTY）"
  sudo docker exec "$CTR" mkdir -p "$(dirname "$cpath")"
  sudo docker exec "$CTR" rm -rf "$cpath"
  tar -C "$REPO/$sub" --exclude=.git -cf - . | sudo docker exec -i "$CTR" bash -c "mkdir -p '$cpath' && tar -xf - -C '$cpath'"
  printf '%s %s %s %s\n' "$name" "$branch" "$COMMIT" "$DIRTY" | \
    sudo docker exec -i "$CTR" bash -c "cat > '$cpath/.upstream-pin'"
  echo "$name $COMMIT $DIRTY" >> /tmp/provision-stamp.$$
done < /tmp/provision-list.$$
echo "== 供给完成：$(wc -l < /tmp/provision-stamp.$$) 棵树"
rm -f /tmp/provision-list.$$ /tmp/provision-stamp.$$
