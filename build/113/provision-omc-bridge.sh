#!/usr/bin/env bash
# Octave-Full-Wasm — **OMC MATLAB 语义桥供给**（E 线；工单 70 / OM 回信 `mail/025`）
# Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么独立脚本（与 provision-omc.sh 同族，但**不同目录**）：
#   · provision-omc.sh 供的是**引擎能力层**（omc/ 根，4 件编译器字节，R14 守着
#     "size = 目录字节和" ⇒ MSL 等资产不许进）；
#   · 本脚本供的是**桥**（omc/bridge/ 子目录，12 件 .m + 宿主侧 .js）——它是
#     **两家引擎之间的运行时契约**，不进 forge-catalog.json（不走 form/consumer/files[]）。
#   两者共同构成 omc 目录树：`omc/`(4 件引擎) + `omc/bridge/`(12 件桥)。
#
# ★ 形态要点（OM `mail/025` §1 纠正了我原先的建议，实测证据在它那封信里）：
#   **铺站点目录本身不产生效果** —— `addpath` 走 **MEMFS**，站点 HTTP 路径不在其中
#   （我方独立复核：MEMFS 根只有 tmp/home/dev/proc/fonts/src/usr；站点路径 `exist` = 0；
#    MEMFS 写文件后 addpath ⇒ exist = 2）。
#   ⇒ 本脚本只负责**①字节来源**（站点 `omc/bridge/`，逐件 sha）；
#      **②运行期写 MEMFS + addpath** 是页面装配的活（bridge/octave-page.js 的 OMC 段）。
#
# 用法：
#   sh build/113/provision-omc-bridge.sh fetch      供给进站点（默认从 OM 仓工作树拷）
#   sh build/113/provision-omc-bridge.sh verify     复核（不复制）
#   sh build/113/provision-omc-bridge.sh --selftest 自证（三类：正常/该报/空值，不碰真网络）
#
# 字节产地：OM 仓 `bridge/`（12 件）+ 其 `bridge/manifest.json`（逐件 bytes + sha256，
#   那份清单有它自己的闸门 `check-bridge-manifest.py`，我方**不复算 sha、只投影**：
#   唯一产地纪律 —— 清单在谁那谁记，我方拿站点字节去**核对**，不一致是红不是重写）。
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SITE="${SITE_DIR:-/mnt/hdd/octave-wasm-build/site}"
OM_REPO="${OM_REPO:-/mnt/hdd/zcode-projects/OpenModelica-Full-Wasm}"
MANIFEST="${OMC_BRIDGE_MANIFEST:-$OM_REPO/bridge/manifest.json}"
BRIDGE_SRC="${OMC_BRIDGE_SRC:-$OM_REPO/bridge}"
DEST="${OMC_BRIDGE_DST:-$SITE/omc/bridge}"

say () { printf "%s\n" "$1"; }
die () { printf "FATAL: %s\n" "$1" >&2; exit 1; }

sha_of () {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; return; fi
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'; return; fi
  die "缺少 sha256sum/shasum"
}

# 从清单里读 (file, bytes, sha256) 三元组，每行 "file<TAB>bytes<TAB>sha256"
read_manifest () {
  python3 - "$1" <<'PY'
import json, sys
m = json.load(open(sys.argv[1], encoding="utf-8"))
es = m.get("entries")
if not isinstance(es, list) or not es:
    sys.exit("FATAL: 清单没有 entries 列表或为空（空输入不是通过）")
for e in es:
    f, b, s = e.get("file"), e.get("bytes"), e.get("sha256")
    if not f or not isinstance(b, int) or not s or len(s) != 64:
        sys.exit("FATAL: 清单项形错: %r" % (e,))
    print("%s\t%d\t%s" % (f, b, s))
PY
}

# ── F1 自证（三类用例，不碰真网络/不碰真站点）──────────────────────────────
if [ "${1:-}" = "--selftest" ]; then
  T="$(mktemp -d)"; bad=0; n=0
  mk_bridge () {  # $1=源目录  $2=.m 内容  $3=.js 内容
    mkdir -p "$1"
    printf '%s\n' "$2" > "$1/omc_simulate.m"
    printf '%s\n' "$3" > "$1/omc_bridge.js"
  }
  mk_manifest () {  # $1=清单路径  $2=源目录  [$3=篡改的 sha]
    python3 - "$1" "$2" "${3:-}" <<'PY'
import hashlib, json, os, sys
out, src, tamper = sys.argv[1], sys.argv[2], sys.argv[3]
es = []
for f in sorted(os.listdir(src)):
    p = os.path.join(src, f)
    b = open(p, "rb").read()
    s = tamper if (tamper and f == "omc_bridge.js") else hashlib.sha256(b).hexdigest()
    es.append({"file": f, "bytes": len(b), "sha256": s,
               "layer": "host-side" if f.endswith(".js") else "public-api"})
json.dump({"schema": 1, "addpath": "/bridge", "entries": es},
          open(out, "w"), ensure_ascii=False, indent=1)
PY
  }
  # ① 正常：逐件 sha 相符 ⇒ 落件
  n=$((n+1)); mk_bridge "$T/src1" "function r=omc_simulate(); r=1; endfunction" "// bridge"
  mk_manifest "$T/m1.json" "$T/src1"
  if OMC_BRIDGE_MANIFEST="$T/m1.json" OMC_BRIDGE_SRC="$T/src1" OMC_BRIDGE_DST="$T/dst1" \
       bash "$0" --copy-only >/dev/null 2>&1 && [ -f "$T/dst1/omc_simulate.m" ]; then
    say "PASS | 逐件 sha 相符 ⇒ 落件"
  else say "fail | 逐件 sha 相符竟失败"; bad=1; fi
  # ② 该报的必须报：清单 sha 与字节不符 ⇒ 必须拒（fail-closed）
  n=$((n+1)); mk_bridge "$T/src2" "function r=omc_simulate(); r=1; endfunction" "// tampered"
  mk_manifest "$T/m2.json" "$T/src2" "0000000000000000000000000000000000000000000000000000000000000000"
  if OMC_BRIDGE_MANIFEST="$T/m2.json" OMC_BRIDGE_SRC="$T/src2" OMC_BRIDGE_DST="$T/dst2" \
       bash "$0" --copy-only >/dev/null 2>&1; then
    say "fail | 清单 sha 不符竟通过（fail-closed 失效）"; bad=1
  else say "PASS | 清单 sha 与字节不符 ⇒ 必须拒"; fi
  # ③ 空输入必须报：清单 entries 为空
  n=$((n+1)); mkdir -p "$T/src3"; printf '{"schema":1,"entries":[]}' > "$T/m3.json"
  if OMC_BRIDGE_MANIFEST="$T/m3.json" OMC_BRIDGE_SRC="$T/src3" OMC_BRIDGE_DST="$T/dst3" \
       bash "$0" --copy-only >/dev/null 2>&1; then
    say "fail | 空清单竟通过（零值守卫失效）"; bad=1
  else say "PASS | 空清单 ⇒ 必须拒（零值守卫）"; fi
  # ④ 反向：源目录缺清单里列的文件 ⇒ 必须报（字节渠道变了别静默）
  n=$((n+1)); mk_bridge "$T/src4" "function r=omc_simulate(); r=1; endfunction" "// b"
  mk_manifest "$T/m4.json" "$T/src4"; rm -f "$T/src4/omc_bridge.js"
  if OMC_BRIDGE_MANIFEST="$T/m4.json" OMC_BRIDGE_SRC="$T/src4" OMC_BRIDGE_DST="$T/dst4" \
       bash "$0" --copy-only >/dev/null 2>&1; then
    say "fail | 缺件竟通过（清单↔字节不一致没抓到）"; bad=1
  else say "PASS | ★ 源目录缺清单列的文件 ⇒ 必须拒"; fi
  rm -rf "$T"
  echo "=== provision-omc-bridge 自证：$((n-bad)) PASS / $bad fail ==="
  [ "$bad" = 0 ]
  exit $?
fi

MODE="${1:-fetch}"
[ "$MODE" = "--copy-only" ] && MODE=copy

[ -f "$MANIFEST" ] || die "清单不存在：$MANIFEST（OM 仓未就绪？它的 bridge/manifest.json 是产地）"
[ -d "$BRIDGE_SRC" ] || die "桥源目录不存在：$BRIDGE_SRC"

TABLE="$(read_manifest "$MANIFEST")" || die "清单读不出（见上）"
NFILES="$(printf '%s\n' "$TABLE" | grep -c . || true)"
[ "$NFILES" -gt 0 ] || die "清单 0 件（零值守卫：空不是通过）"

# ── ① 逐件核 sha + bytes（fail-closed；清单是产地，我方只核对不另算）──────────
while IFS="$(printf '\t')" read -r f want_bytes want_sha; do
  [ -n "$f" ] || continue
  src="$BRIDGE_SRC/$f"
  [ -f "$src" ] || die "清单列了 $f 但源目录没有：$src（字节渠道变了？先核 OM 的 manifest）"
  got_sha="$(sha_of "$src")"
  got_bytes="$(wc -c < "$src" | tr -d ' ')"
  [ "$got_sha" = "$want_sha" ] || die "$f sha 不符：清单 $want_sha，实得 $got_sha
       （谁对谁错先对 OM 的 bridge/manifest.json，别静默放过）"
  [ "$got_bytes" = "$want_bytes" ] || die "$f 字节数不符：清单 $want_bytes，实得 $got_bytes"
  say "  ✓ $f（$got_bytes B）"
done <<EOF2
$TABLE
EOF2

# ── ② 反向：源目录有别的东西 ⇒ 报（清单是闭包，多一件说明清单漏记了）──────────
EXTRA="$(python3 - "$BRIDGE_SRC" "$MANIFEST" <<'PY'
import json, os, sys
src, mp = sys.argv[1], sys.argv[2]
want = {e["file"] for e in json.load(open(mp, encoding="utf-8"))["entries"]}
# 清单文件自己不列入 entries（它是产地，不是交付件）—— 按 basename 排除它
skip = {os.path.basename(mp)}
have = {f for f in os.listdir(src)
        if os.path.isfile(os.path.join(src, f)) and f not in skip}
extra = sorted(have - want)
print("\n".join(extra))
PY
)"
if [ -n "$EXTRA" ]; then
  die "bridge/ 里有清单没记的文件：$EXTRA
       （清单是交付闭包 —— 漏记 = 消费者拿不到，或多铺了不该铺的）"
fi

[ "$MODE" = "verify" ] && { say "verify OK（$NFILES 件、逐件 sha+bytes 相符、无清单外文件）"; exit 0; }

mkdir -p "$DEST"
for f in $(printf '%s\n' "$TABLE" | cut -f1); do cp -f "$BRIDGE_SRC/$f" "$DEST/$f"; done
# ★ 清单本身也落站点（2026-10-29 实测抓到）：页面装配要**读清单**才知道要拉哪 12 件
#   （硬编码 12 个名字会漂）。清单不在 entries 里（它是产地不是交付件），但**必须可 fetch**。
cp -f "$MANIFEST" "$DEST/manifest.json"
say "  ✓ omc/bridge/ 落 $NFILES 件 + 清单 → $DEST"
say "完成：E 线桥字节已供给（**注意**：站点目录只是字节来源；运行期必须由页面写进"
say "      MEMFS 再 addpath —— 见 bridge/octave-page.js 的 OMC 装配段）"
