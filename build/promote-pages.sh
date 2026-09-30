#!/bin/bash
# Octave-Full-Wasm — **页面资产批**的受管辖入口（工单 20，2026-09-30）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么要有它：`build/promote-webgl.sh` 是**产物（GL wasm）导向**的 —— 改的只是页面 JS
# （`bridge/*.js` / `index.html`）时它有两条都不合适：① 它会把 `/src/websrc/out-webgl` 那份
# **产物**一起推上去；② 它的守卫（"目标产物比现役旧就拒"）会**正确拒绝**这类批次
# ⇒ 于是"只同步页面资产"这件事**没有入口**，只能手 `cp` —— 而那正是 AGENTS.md 点名的
# 危险动作形状（"为了试页面改动顺手 cp 进 8761"那次把 8761 弄坏了）。
#
# 判据（与 promote-webgl.sh 同构，守卫换成"三大件必须逐字节不变"）：
#   · 资产清单**从 `build/recover-113.sh` 的 <script src>/importScripts 清单推**（单一真相源）；
#   · `--dry-run`  只打印要做什么（含三方 sha）；
#   · 真跑：把清单里的文件从**仓库 bridge/** 同步到目标站点 + 仓库 `site/` 镜像；
#   · `--verify`    四处（仓库 bridge/ · 8761 · 8768 · 仓库 site/）逐文件 sha 一致
#                   **且三大件在四处逐字节相同**（页面批不许夹带产物 ⇒ 夹带即红）。
#
# 用法：
#   sh build/promote-pages.sh --dry-run
#   sh build/promote-pages.sh --verify
#   sh build/promote-pages.sh --selftest     # F1：证明它会红（夹具上做，不碰真站点）
#   sh build/promote-pages.sh                # 真同步（会先备份被覆盖的文件）
set -uo pipefail
REPO=${REPO:-/mnt/hdd/zcode-projects/Octave-Full-Wasm}   # 可覆盖：自证在夹具上跑
SITE=${SITE:-/mnt/hdd/octave-wasm-build/site}          # 8761（部署件）
SITE_EXP=${SITE_EXP:-/mnt/hdd/octave-wasm-build/siteWebGL}   # 8768（实验车道）
ARTIFACTS="octave.wasm octave.js octave.data"   # 空格分隔（保持 POSIX：dash 没有数组）

# ── 资产清单：从 recover-113.sh 推（不另抄）────────────────────────────────────
page_files () {
  local f
  # ⚠️ `lane.js` **必须在**（工单 23 实测：recover-113.sh 的清单漏了它 ——
  #    照它重建站点会漏掉选档器本身；promote-pages 的第一次 dry-run 就抓到这个漂移）。
  #    `lanes.js`（档清单）**不在这里**：它是**站点专属生成物**，由 gen-lanes.sh 按真实部署写。
  for f in index.html assets-loader.js octave-core.js lane.js queue.js p5canvas.js \
           octave-worker.js webaudio.js webaudiorec.js webfilepick.js webnet.js; do
    printf '%s\n' "$f"
  done
}
sha12 () { sha256sum "$1" 2>/dev/null | cut -c1-12 || echo "(缺)"; }

MODE=""
case "${1:-}" in
  --dry-run)  MODE=dry ;;
  --verify)   MODE=verify ;;
  --selftest) MODE=selftest ;;
  "")         MODE=do ;;
  *) echo "用法: $0 [--dry-run|--verify|--selftest]" >&2; exit 2 ;;
esac

if [ "$MODE" = "selftest" ]; then
  # 三类用例：① 一致的夹具 ⇒ 不报；② 夹具里三大件被动过 ⇒ 必须红；③ 空输入 ⇒ 必须红
  bad=0; n=0
  tmp="$(mktemp -d)"; mkdir -p "$tmp/repo/bridge" "$tmp/site" "$tmp/siteexp" "$tmp/repomirror"
  for f in $(page_files); do printf 'x' > "$tmp/repo/bridge/$f"; cp "$tmp/repo/bridge/$f" "$tmp/site/$f"; cp "$tmp/repo/bridge/$f" "$tmp/siteexp/$f"; cp "$tmp/repo/bridge/$f" "$tmp/repomirror/$f"; done
  for a in $ARTIFACTS; do printf 'A' > "$tmp/site/$a"; cp "$tmp/site/$a" "$tmp/siteexp/$a"; done
  # 档清单（生成物）：夹具站点里也要有一份，且声明与磁盘一致（只有 base）
  for d in "$tmp/site" "$tmp/siteexp"; do printf '(function(g){g.__octaveLanes = ["base"];})(self);\n' > "$d/lanes.js"; done
  # ① 正常不报
  n=$((n+1)); if ! REPO="$tmp/repo" SITE="$tmp/site" SITE_EXP="$tmp/siteexp" REPO_MIRROR="$tmp/repomirror" \
      bash "$0" --verify >/dev/null 2>&1; then echo "fail | promote-pages/一致的夹具竟红"; bad=1; else echo "PASS | promote-pages/一致的夹具 ⇒ 不报"; fi
  # ② 三大件被动过 ⇒ 必须红（页面批夹带产物）
  n=$((n+1)); printf 'B' > "$tmp/site/octave.wasm"
  if REPO="$tmp/repo" SITE="$tmp/site" SITE_EXP="$tmp/siteexp" REPO_MIRROR="$tmp/repomirror" \
      bash "$0" --verify >/dev/null 2>&1; then echo "fail | promote-pages/**产物不一致竟没报**（夹带产物没拦住）"; bad=1; else echo "PASS | ★ 三大件不一致 ⇒ 必须红"; fi
  printf 'A' > "$tmp/site/octave.wasm"
  # ③ 空输入（目标站点不存在）⇒ 必须红
  n=$((n+1)); if REPO="$tmp" SITE="$tmp/nonexistent" SITE_EXP="$tmp/siteexp" REPO_MIRROR="$tmp/repomirror" \
      bash "$0" --verify >/dev/null 2>&1; then echo "fail | promote-pages/**空/缺输入竟没报**（零值守卫失效）"; bad=1; else echo "PASS | ★ 目标站点缺失 ⇒ 必须红"; fi
  rm -rf "$tmp"
  echo "=== promote-pages 自证：$((n-bad)) PASS / $bad fail ==="
  exit "$bad"
fi

REPO_MIRROR=${REPO_MIRROR:-$REPO/site}
fail=0

echo "════ promote-pages（$MODE）════"
echo "  清单来源：build/recover-113.sh 的 <script src>/importScripts 清单（$(page_files | wc -l) 个文件）"
echo "  仓库 $REPO/bridge  →  站点 $SITE  +  仓库镜像 $REPO_MIRROR"

echo ""
echo "── ① 三方 sha（仓库 bridge/ · 8761 · 8768 · 仓库 site/）──"
for f in $(page_files); do
  a=$(sha12 "$REPO/bridge/$f"); b=$(sha12 "$SITE/$f"); c=$(sha12 "$SITE_EXP/$f"); d=$(sha12 "$REPO_MIRROR/$f")
  same="✓"
  { [ "$a" = "$b" ] && [ "$a" = "$c" ] && [ "$a" = "$d" ]; } || same="✗"
  printf '   %-20s 仓库:%-14s 8761:%-14s 8768:%-14s 镜像:%-14s %s\n' "$f" "$a" "$b" "$c" "$d" "$same"
done

echo ""
echo "── ①b 档清单 lanes.js（生成物）：声明必须与磁盘上真实部署的档**一致** ──"
check_lanes () {  # $1=站点目录
  _s="$1"; _bad=0
  if [ ! -f "$_s/lanes.js" ]; then
    echo "   ✗ $_s/lanes.js 缺失（页面引用它 ⇒ 会 404）"; return 1
  fi
  for d in "" threads w64 w64-base; do
    _p="$_s"; [ -n "$d" ] && _p="$_s/$d"
    if [ -f "$_p/octave.js" ] && [ -f "$_p/octave.wasm" ] && [ -f "$_p/octave.data" ]; then
      _name=base; [ -n "$d" ] && _name="$d"
      grep -q "\"$_name\"" "$_s/lanes.js" || { echo "   ✗ $_s 上有 $_name 档但 lanes.js 没声明"; _bad=1; }
    else
      _name=base; [ -n "$d" ] && _name="$d"
      grep -q "\"$_name\"" "$_s/lanes.js" && [ "$_name" != base ] && { echo "   ✗ lanes.js 声明了 $_name 但站点上没有这一档（会导致 404）"; _bad=1; }
    fi
  done
  [ "$_bad" = 0 ] && echo "   ✓ $_s/lanes.js 的声明与磁盘一致（$(sed -n 's/.*__octaveLanes = \[\(.*\)\];.*/\1/p' "$_s/lanes.js")）"
  return "$_bad"
}
for _site in "$SITE" "$SITE_EXP"; do
  check_lanes "$_site" || fail=$((fail+1))
done

echo ""
echo "── ② 三大件必须逐字节不变（页面批不许夹带产物）──"
for a in $ARTIFACTS; do
  s1=$(sha256sum "$SITE/$a" 2>/dev/null | cut -d' ' -f1)
  s2=$(sha256sum "$SITE_EXP/$a" 2>/dev/null | cut -d' ' -f1)
  s1c=$(printf '%s' "$s1" | cut -c1-12); s2c=$(printf '%s' "$s2" | cut -c1-12)
  if [ -z "$s1" ] || [ -z "$s2" ]; then
    echo "   ✗ $a 缺失（$SITE 或 $SITE_EXP）"; fail=$((fail+1)); continue
  fi
  if [ "$s1" = "$s2" ]; then echo "   ✓ $a 与 8768 一致（${s1c}…）"
  else echo "   ✗ $a **两站不一致**：8761=${s1c}… 8768=${s2c}… ⇒ 这是换产物批，走 promote-webgl.sh"; fail=$((fail+1)); fi
done

if [ "$MODE" = "verify" ]; then
  for f in $(page_files); do
    a=$(sha256sum "$REPO/bridge/$f" 2>/dev/null | cut -d' ' -f1)
    for pair in "$SITE:$f" "$SITE_EXP:$f" "$REPO_MIRROR:$f"; do
      p="${pair%%:*}"; ff="${pair##*:}"
      b=$(sha256sum "$p/$ff" 2>/dev/null | cut -d' ' -f1)
      [ -n "$a" ] && [ "$a" = "$b" ] || { echo "   ✗ $p/$ff 与仓库不一致"; fail=$((fail+1)); }
    done
  done
  echo ""
  if [ "$fail" = 0 ]; then echo "✅ 页面资产四处一致，三大件未动 ⇒ 页面批可提交"; exit 0
  else echo "❌ $fail 处不一致 ⇒ 别提交（先修）"; exit 1; fi
fi

if [ "$MODE" = "dry" ]; then
  echo ""
  echo "[dry-run] 接下来会：① 备份 $SITE 下清单里的文件到 page-bak-<时间戳>/；"
  echo "          ② 从仓库 bridge/ 拷清单到 $SITE 与 $REPO_MIRROR；③ 重跑本脚本 --verify"
  exit 0
fi

# ── 真同步 ───────────────────────────────────────────────────────────────────
ts=$(date +%Y%m%d-%H%M%S); bak="/mnt/hdd/octave-wasm-build/page-bak-$ts"
mkdir -p "$bak"
for f in $(page_files); do [ -f "$SITE/$f" ] && cp -p "$SITE/$f" "$bak/" ; done
echo ""
echo "── ③ 已备份被覆盖的页面文件 → $bak"
for f in $(page_files); do
  cp -p "$REPO/bridge/$f" "$SITE/$f" && cp -p "$REPO/bridge/$f" "$REPO_MIRROR/$f"
done
echo "   已同步 $(page_files | wc -l) 个文件到 8761 与仓库镜像"
sh "$REPO/build/gen-lanes.sh" "$SITE" || { echo "FATAL: 生成 $SITE/lanes.js 失败" >&2; exit 1; }
cp -p "$SITE/lanes.js" "$REPO_MIRROR/lanes.js"
echo ""
echo "── ④ 复核（本脚本的 --verify）──"
SITE="$SITE" SITE_EXP="$SITE_EXP" REPO_MIRROR="$REPO_MIRROR" bash "$0" --verify
