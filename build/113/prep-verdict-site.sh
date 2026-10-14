#!/usr/bin/env bash
# 造**验收用站点**（含篡改子路径），给 accept-install-verdict 的 V3（sha-mismatch）用
# Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么需要它：V3 要断言"sha 不符 ⇒ reject 且 cause=sha-mismatch"。这要一份
# **catalog 里 sha 被改错、而字节是真的**的目录。用真站点改会污染部署件 ⇒ 复制一份。
#
# ⚠️ 同源约束（COEP 实测拦跨域）：篡改版必须与页面**同源** ⇒ 放在站点的**子路径**
#    `/verdict-tamper/` 下（不是另起端口 —— 那是另一个 origin，会被拦）。
#    套件里 base 用固定子路径 `/verdict-tamper/`（`withBase` 是 `base + 'assets/…'`）。
#
# 用法：sh build/113/prep-verdict-site.sh [源站点] [目标目录]
#   默认：源 = /mnt/hdd/octave-wasm-build/site
#         目标 = /mnt/hdd/octave-wasm-build/site-verdict
#   然后：python3 build/serve-coi.py --dir <目标> --port <P>
#          sh test/browser/run.sh test/browser/accept-install-verdict.mjs http://127.0.0.1:<P>/
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="${1:-/mnt/hdd/octave-wasm-build/site}"
DST="${2:-/mnt/hdd/octave-wasm-build/site-verdict}"
TARGET_PKG="${VERDICT_PKG:-optim}"
SUB="verdict-tamper"

[ -d "$SRC" ] || { echo "FATAL: 源站点不存在：$SRC" >&2; exit 3; }

echo "== 复制站点 → $DST"
rm -rf "$DST"; cp -a "$SRC" "$DST"

echo "== 造同源子路径 /$SUB/（篡改 $TARGET_PKG 的 sha，字节不动）"
mkdir -p "$DST/$SUB/assets/forge"
cp -a "$DST/assets/forge/." "$DST/$SUB/assets/forge/"
python3 - "$DST" "$SUB" "$TARGET_PKG" <<'PY'
import json, os, sys
dst, sub, name = sys.argv[1], sys.argv[2], sys.argv[3]
src = os.path.join(dst, "assets", "forge-catalog.json")
d = json.load(open(src, encoding="utf-8"))
hit = None
for e in d.get("packs", []):
    if e.get("name") == name:
        old = e["sha256"]
        e["sha256"] = ("0" if old[0] != "0" else "1") + old[1:]   # 仍是 64hex，必与字节不符
        hit = (old[:12], e["sha256"][:12]); break
if not hit:
    print("FATAL: 目录里没有包 %s" % name, file=sys.stderr); sys.exit(3)
out = os.path.join(dst, sub, "assets", "forge-catalog.json")
json.dump(d, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("   %s: %s… → %s…（字节未动）" % (name, hit[0], hit[1]))
PY

echo "== 校验：篡改版形状仍合法（只有 sha 与字节不符 —— 那正是 V3 要的）"
python3 "$REPO/build/extra-content/validate-content-list.py" --list "$DST/$SUB/assets/forge-catalog.json" \
  && echo "   形状 ok"
echo "== 完成：$DST（子路径 /$SUB/ 供 V3；主路径供 V1/V2/P1/P2）"
