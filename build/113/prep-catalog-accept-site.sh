#!/usr/bin/env bash
# Octave-Full-Wasm — 造一个**货架验收用**的站点副本（T4，2026-10-12）
# Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
#
# ── 为什么需要"造一个站点"而不是直接测 8761 ─────────────────────────────────
# T4 要验的是「`pkg load <**未随站**的货架包>` ⇒ 真下载真装上」这条**新**路径。
# 但现役站点上，货架里 10 个包**全都同时随站发运**（`assets/pkg/*.js`）——
# 于是 `pkg load splines` 永远走**随站**那条老路，货架路径**一行都不会被执行**。
# 直接拿 8761 跑出来的绿是**假绿**（"测试的路径不是要验的路径"，本仓最忌讳的形状）。
#
# ⇒ 本脚本复制一份站点、把 `splines` 从**随站清单与目录里摘掉**（它仍在货架上），
#   于是那份副本上 `pkg load splines` 必须走货架：fetch 同源 tarball → sha256 →
#   引擎内建 gunzip/untar → 落盘 → pkgfix 重扫。验收套件读得懂这个前提，并在
#   **前提不成立时响亮地失败**（`describe('splines')` 非空 = 测试跑在错的路径上）。
#
# ── 同时刷新两件本批改过的胶水（否则测的还是旧代码）──────────────────────────
#   · `pkgfix`   —— 新增 `__webshelf_names__` / `__webpackage_source__`（来源判定）
#   · `webshims` —— `pkg.m` 改为"先问来源"（load 还是 install）+ 终态轮询
# ★ 挂载点**逐字读 `build/assets-meta.json`**（不许猜：`pkgfix` 挂 `m/pkg` 不是默认挂载点）。
#
# ── 用法 ────────────────────────────────────────────────────────────────────
#   sh build/113/prep-catalog-accept-site.sh [源站点] [目标目录]
#   默认：源 = /mnt/hdd/octave-wasm-build/site（8761 部署件）
#         目标 = /mnt/hdd/octave-wasm-build/site-catalog-accept
#   然后：SITE_DIR=<目标目录> node test/browser/accept-catalog-load.mjs
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="${1:-/mnt/hdd/octave-wasm-build/site}"
DST="${2:-/mnt/hdd/octave-wasm-build/site-catalog-accept}"

[ -d "$SRC/assets" ] || { echo "FATAL: 源站点不像站点（缺 assets/）：$SRC" >&2; exit 2; }
[ "$SRC" != "$DST" ] || { echo "FATAL: 源与目标相同 ⇒ 会就地改现役站点" >&2; exit 2; }

echo "== 0) 复制站点 $SRC → $DST"
mkdir -p "$DST"
# ⚠️ `-a --delete`：副本必须与源**逐字节同形**，否则"绿"可能来自上一轮的残留文件。
rsync -a --delete "$SRC/" "$DST/"

echo "== 0b) 拷**仓库里**的页面文件（本批改了 bridge/ 的两件）"
# ★ 为什么必须（我第一次就栽在这）：站点上的 `assets-loader.js` / `octave-core.js` 是
#   **上一次 promote 的产物**。本批的关键改动在**仓库**那两份里，站点那份没有 ⇒
#   复制出来的验收站点跑的是**旧页面代码** ⇒ 货架路径根本没被执行（13 条红全是这一个原因）。
#   清单与 `promote-pages.sh` 同源（那边也是从仓库 bridge/ 取），别另抄一份。
#   · assets-loader.js —— 账本新增 catalog_state/catalog_packs/install_error（来源判定靠它）
#   · octave-core.js   —— 开机后台读一次货架目录（同步入口可答的**前提**，见该文件注释）
for f in assets-loader.js octave-core.js; do
  [ -f "$REPO/bridge/$f" ] || { echo "FATAL: 仓库缺 bridge/$f" >&2; exit 2; }
  cp -p "$REPO/bridge/$f" "$DST/$f"
done
echo "   页面文件 ← 仓库 bridge/（assets-loader $(sha256sum "$DST/assets-loader.js" | cut -c1-12)、octave-core $(sha256sum "$DST/octave-core.js" | cut -c1-12)）"

echo "== 1) 重打本批改过的两个 .m 资产（挂载点逐字读 assets-meta.json）"
for name in pkgfix webshims; do
  mount=$(python3 -c "
import json
m = json.load(open('$REPO/build/assets-meta.json', encoding='utf-8')).get('$name', {})
print(m.get('mount') or '/usr/src/octave/m/$name')
")
  python3 "$REPO/build/assets.py" bundle-m "$name" "$REPO/build/$name" "$mount" "$DST/assets/m/$name.js"
done

echo "== 2) 把 splines 从**随站清单**里摘掉（它仍留在货架上）+ 刷新两个资产的 sha"
python3 - "$DST" <<'PY'
import hashlib, io, json, os, sys
dst = sys.argv[1]
mp = os.path.join(dst, "assets", "manifest.json")
man = json.load(io.open(mp, encoding="utf-8"))

def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for b in iter(lambda: fh.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()

dropped, refreshed = 0, 0
out = []
for a in man.get("assets", []):
    if a.get("name") == "splines":
        dropped += 1
        continue
    # 重打过的两个：sha 必须跟着字节走，否则加载器 fail-closed 拒载（"资产校验失败"）
    rel = (a.get("url") or "")
    if rel.startswith("assets/m/") and os.path.basename(rel)[:-3] in ("pkgfix", "webshims"):
        p = os.path.join(dst, rel)
        if os.path.exists(p):
            new = sha256(p)
            if a.get("sha256") != new:
                refreshed += 1
                a["sha256"] = new
    out.append(a)
man["assets"] = out
with io.open(mp, "w", encoding="utf-8") as fh:
    json.dump(man, fh, indent=1, ensure_ascii=False)
    fh.write("\n")
print("   摘掉随站条目 %d 个（splines）；刷新 sha %d 条（pkgfix/webshims）" % (dropped, refreshed))
if dropped != 1:
    print("FATAL: 期望恰好摘掉 1 个 splines 条目，实得 %d（清单形状变了？）" % dropped, file=sys.stderr)
    sys.exit(1)
PY

echo "== 3) 删掉随站的 splines bundle（它在货架上，客户端要真去拉 tarball）"
rm -f "$DST/assets/pkg/splines.js"

echo "== 4) 重生成车道清单（它们从基础清单复制非 oct 条目 ⇒ 必须跟着重算）"
for lane in threads w64; do
  if [ -f "$DST/assets/manifest.$lane.json" ]; then
    python3 "$REPO/build/113/make-lane-manifest.py" "$DST/assets" --lane "$lane" >/dev/null \
      || { echo "FATAL: 重生成 manifest.$lane.json 失败" >&2; exit 1; }
    echo "   manifest.$lane.json 已重生成"
  fi
done

echo "== 5) 前提自检（这套副本到底能不能验货架路径）"
python3 - "$DST" <<'PY'
import glob, io, json, os, sys
dst = sys.argv[1]
bad = []
man = json.load(io.open(os.path.join(dst, "assets", "manifest.json"), encoding="utf-8"))
names = {a.get("name") for a in man.get("assets", [])}
if "splines" in names:
    bad.append("splines 仍在随站清单里 ⇒ `pkg load splines` 会走老路（假绿）")
if os.path.exists(os.path.join(dst, "assets", "pkg", "splines.js")):
    bad.append("assets/pkg/splines.js 还在 ⇒ 摘得不够干净")
for lane in ("threads", "w64"):
    p = os.path.join(dst, "assets", "manifest.%s.json" % lane)
    if os.path.exists(p):
        n2 = {a.get("name") for a in json.load(io.open(p, encoding="utf-8")).get("assets", [])}
        if "splines" in n2:
            bad.append("manifest.%s.json 里还有 splines" % lane)
cat = json.load(io.open(os.path.join(dst, "assets", "forge-catalog.json"), encoding="utf-8"))
packs = {p["name"]: p for p in cat.get("packs", [])}
if "splines" not in packs:
    bad.append("货架上**没有** splines ⇒ 前提就不成立（不该摘它）")
else:
    tar = os.path.join(dst, packs["splines"]["url"])
    if not os.path.exists(tar):
        bad.append("货架 tarball 不在磁盘上：%s" % tar)
    else:
        print("   货架 splines %s（%d 字节）在 %s" % (
            packs["splines"]["version"], os.path.getsize(tar), packs["splines"]["url"]))
if bad:
    for b in bad:
        print("   ✗ %s" % b, file=sys.stderr)
    sys.exit(1)
print("   ✅ 前提成立：splines 只在货架上、不在随站清单里 ⇒ 能验货架路径")
PY

echo
echo "验收站点就绪：$DST"
echo "  跑：SITE_DIR=$DST node test/browser/accept-catalog-load.mjs"
