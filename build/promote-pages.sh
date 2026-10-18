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
#
# ── M_ASSETS 旋钮（2026-10-12，T4）：改过 `.m` 胶水的批次 ──────────────────────
# 页面批默认**只**同步 `bridge/` 那批文件。但有的批次同时改了 `build/*/**.m`（本批：pkgfix
# 的货架判定 + webshims 的 pkg.m）—— 那些是**资产**（打好的 bundle `assets/m/*.js`），
# 不在页面清单里。空 `M_ASSETS=""`（默认）= 老行为，逐字节不变。
#   M_ASSETS="pkgfix webshims" sh build/promote-pages.sh
# 它做的事（与 `promote-webgl.sh` 第 3 步同构，**挂载点逐字读 assets-meta.json**）：
#   ① `bundle-m` 重打包 → 两个站点 + 仓库镜像的 `assets/m/<名>.js`
#   ② `sync-js` 刷新清单（`manifest{,.w64}.json`）里那两个资产的 sha
#      ★ 漏第 ② 步的后果是加载器 **fail-closed 拒载**（"资产校验失败"）—— 实测过两次。
#   ③ **重生成车道清单**（`make-lane-manifest.py --lane w64`）：它们从基础清单复制
#      非 oct 条目 ⇒ 基础清单的 m-asset sha 一变，车道那份就陈旧（本批实测抓到）。
set -uo pipefail
REPO=${REPO:-/mnt/hdd/zcode-projects/Octave-Full-Wasm}   # 可覆盖：自证在夹具上跑
SITE=${SITE:-/mnt/hdd/octave-wasm-build/site}          # 8761（部署件）
SITE_EXP=${SITE_EXP:-/mnt/hdd/octave-wasm-build/siteWebGL}   # 8768（实验车道）
ARTIFACTS="octave.wasm octave.js octave.data"   # 空格分隔（保持 POSIX：dash 没有数组）
M_ASSETS=${M_ASSETS:-}                          # 空 = 老行为（页面批不动资产）

# ── 资产清单：从 recover-113.sh 推（不另抄）────────────────────────────────────
page_files () {
  local f
  # ⚠️ `lane.js` **必须在**（工单 23 实测：recover-113.sh 的清单漏了它 ——
  #    照它重建站点会漏掉选档器本身；promote-pages 的第一次 dry-run 就抓到这个漂移）。
  #    `lanes.js`（档清单）**不在这里**：它是**站点专属生成物**，由 gen-lanes.sh 按真实部署写。
  # ⚠️ 工单 38（2026-10-02）：嵌入接口层三件**必须**在清单里 —— 新 index.html 引用
  #    `octave-page.js`，缺它 = 站点整个坏（404）；`octave-embed.js`/`embed-demo.html`
  #    是接口层与上手页（accept-embed-api 也要取 `${URL}embed-demo.html`）。
  #    之前漏过 lane.js（工单 23）—— 同一形状：清单比页面引用少一件。
  for f in index.html assets-loader.js octave-core.js lane.js queue.js p5canvas.js \
           octave-worker.js webaudio.js webaudiorec.js webfilepick.js webnet.js \
           octave-page.js octave-embed.js embed-demo.html; do
    printf '%s\n' "$f"
  done
}
sha12 () { sha256sum "$1" 2>/dev/null | cut -c1-12 || echo "(缺)"; }

# ⚠️ 挂载点**逐字读** `build/assets-meta.json` 的 mount —— 不许猜（`pkgfix` 挂 `m/pkg`
#    而不是默认的 `m/pkgfix`；2026-09-23 猜错过一次，把 `pkg list` 整个弄坏）。
#    ⚠️ 必须定义在**用它的地方之前**（dash 按出现顺序解析函数调用；第一次就栽在这）。
m_asset_mount () {
  python3 -c "
import json
m = json.load(open('$REPO/build/assets-meta.json', encoding='utf-8')).get('$1', {})
print(m.get('mount') or '/usr/src/octave/m/$1')
"
}

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
  # ①b ★ **真同步必须写三处**（2026-10-16 加；本批实测抓到自建以来的缺陷：
  #     真同步循环只写 $SITE + $REPO_MIRROR，**漏 $SITE_EXP** ⇒ `--verify` 比四处，
  #     于是"任何一次真同步后 verify 都不可能绿"。这条用例专锁那个形状：把仓库文件改成
  #     新内容、再真跑一次，**8768 也必须跟上**（不是只验、是真写）。
  n=$((n+1))
  for d in "$tmp/site2" "$tmp/siteexp2" "$tmp/repomirror2"; do mkdir -p "$d"; done
  for f in $(page_files); do printf 'y' > "$tmp/site2/$f"; cp "$tmp/site2/$f" "$tmp/siteexp2/$f"; cp "$tmp/site2/$f" "$tmp/repomirror2/$f"; done
  for a in $ARTIFACTS; do printf 'A' > "$tmp/site2/$a"; cp "$tmp/site2/$a" "$tmp/siteexp2/$a"; done
  for d in "$tmp/site2" "$tmp/siteexp2"; do printf '(function(g){g.__octaveLanes = ["base"];})(self);\n' > "$d/lanes.js"; done
  printf 'NEW' > "$tmp/repo/bridge/assets-loader.js"
  if REPO="$tmp/repo" SITE="$tmp/site2" SITE_EXP="$tmp/siteexp2" REPO_MIRROR="$tmp/repomirror2" \
      bash "$0" >/dev/null 2>&1 || true; then :; fi
  if diff -q "$tmp/repo/bridge/assets-loader.js" "$tmp/siteexp2/assets-loader.js" >/dev/null 2>&1; then
    echo "PASS | ★ 真同步写三处：8768（$SITE_EXP）也被写上"
  else
    echo "fail | promote-pages/**真同步漏写 8768**（--verify 比四处而同步只写两处）"; bad=1
  fi

  # ② 三大件被动过 ⇒ 必须红（页面批夹带产物）
  n=$((n+1)); printf 'B' > "$tmp/site/octave.wasm"
  if REPO="$tmp/repo" SITE="$tmp/site" SITE_EXP="$tmp/siteexp" REPO_MIRROR="$tmp/repomirror" \
      bash "$0" --verify >/dev/null 2>&1; then echo "fail | promote-pages/**产物不一致竟没报**（夹带产物没拦住）"; bad=1; else echo "PASS | ★ 三大件不一致 ⇒ 必须红"; fi
  printf 'A' > "$tmp/site/octave.wasm"
  # ③ 空输入（目标站点不存在）⇒ 必须红
  n=$((n+1)); if REPO="$tmp" SITE="$tmp/nonexistent" SITE_EXP="$tmp/siteexp" REPO_MIRROR="$tmp/repomirror" \
      bash "$0" --verify >/dev/null 2>&1; then echo "fail | promote-pages/**空/缺输入竟没报**（零值守卫失效）"; bad=1; else echo "PASS | ★ 目标站点缺失 ⇒ 必须红"; fi
  # ④ ★ M_ASSETS 批的反向断言（2026-10-12）：造一份**陈旧的车道清单**
  #    （基础清单已变、而 manifest.threads.json 还是旧的）⇒ `make-lane-manifest --check`
  #    必须红。若它不红，则"m 资产改了而车道清单没跟上"这件事**没人拦** ——
  #    那正是本批实测抓到的形状（改 webaudiorec 时车道那份陈旧、校验直接报不合格）。
  #    本脚本的 m 资产步骤里就跑同一个 --check，所以这条红 = 那道闸门有牙齿。
  n=$((n+1))
  mkdir -p "$tmp/site/assets"
  printf '[{"name":"m1","kind":"js","url":"assets/m/m1.js","sha256":"%064d"}]' 0 \
    > "$tmp/site/assets/manifest.json"
  printf '[{"name":"m1","kind":"js","url":"assets/m/m1.js","sha256":"%064d"}]' 1 \
    > "$tmp/site/assets/manifest.w64.json"
  if python3 "$(dirname "$0")/113/make-lane-manifest.py" "$tmp/site/assets" --check --lane w64 \
      >/dev/null 2>&1; then
    echo "fail | promote-pages/**陈旧的车道清单竟没报**（m 资产 sha 变更没人拦）"; bad=1
  else
    echo "PASS | ★ 陈旧的车道清单 ⇒ 必须红（m 资产改了必须重生成车道清单）"
  fi
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
  for d in "" w64 w64-base; do   # 三线裁决：threads 已删
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
  if [ -n "$M_ASSETS" ]; then
    echo "          ④（M_ASSETS 批）重打包这些 .m 胶水 → 两站 + 镜像：$M_ASSETS"
    for name in $M_ASSETS; do
      mount=$(m_asset_mount "$name")
      echo "             · $name → 挂载点 $mount（逐字读 build/assets-meta.json）"
    done
    echo "          ⑤ 刷新三份清单的 sha（sync-js）+ 重生成车道清单（make-lane-manifest）"
  fi
  exit 0
fi

# ── 真同步 ───────────────────────────────────────────────────────────────────
ts=$(date +%Y%m%d-%H%M%S); bak="/mnt/hdd/octave-wasm-build/page-bak-$ts"
mkdir -p "$bak"
for f in $(page_files); do [ -f "$SITE/$f" ] && cp -p "$SITE/$f" "$bak/" ; done
echo ""
echo "── ③ 已备份被覆盖的页面文件 → $bak"
# ⚠️ **三处都要写**（2026-10-16 修一处自建以来的缺陷）：`--verify` 比的是**四处**
#   （仓库 bridge/ · 8761 · 8768 · 仓库镜像），而真同步循环此前只写 `$SITE` + `$REPO_MIRROR`
#   ⇒ **`--verify` 在任何一次真同步后都不可能绿**（8768 永远落后）。实测抓到：
#   本批同步后 `--verify` 报 "siteWebGL/assets-loader.js 与仓库不一致"（8768 从未被写过）。
for f in $(page_files); do
  cp -p "$REPO/bridge/$f" "$SITE/$f" && cp -p "$REPO/bridge/$f" "$SITE_EXP/$f" \
    && cp -p "$REPO/bridge/$f" "$REPO_MIRROR/$f"
done
echo "   已同步 $(page_files | wc -l) 个文件到 8761 / 8768 / 仓库镜像"

# ── m 资产（`M_ASSETS` 非空时）：重打包 + 刷 sha + 重生成车道清单 ──────────────
# ⚠️ 放在**页面文件之后**：`$bak` 在上面才建好（第一版把这步写在前面 ⇒ `cp` 到不存在的
#    目录、静默失败）。备份也复用同一个 `bak`。
if [ -n "$M_ASSETS" ]; then
  echo ""
  echo "── ③b m 资产批：重打包 + 刷 sha + 车道清单（$M_ASSETS）"
  for name in $M_ASSETS; do
    [ -d "$REPO/build/$name" ] || { echo "FATAL: 缺源目录 $REPO/build/$name" >&2; exit 2; }
    mount=$(m_asset_mount "$name")
    [ -f "$SITE/assets/m/$name.js" ] && cp -p "$SITE/assets/m/$name.js" "$bak/assets-m-$name.js"
    python3 "$REPO/build/assets.py" bundle-m "$name" "$REPO/build/$name" "$mount" "$SITE/assets/m/$name.js" \
      || { echo "FATAL: bundle-m $name 失败" >&2; exit 1; }
    cp -p "$SITE/assets/m/$name.js" "$SITE_EXP/assets/m/$name.js"
    cp -p "$SITE/assets/m/$name.js" "$REPO_MIRROR/assets/m/$name.js"
  done
  # ★ sha 刷新**一次**（`sync-js` 会扫整个 assets/m 与 assets/pkg ⇒ 循环里反复跑是浪费，
  #   且第一版写在循环内 ⇒ 每个名字各跑一遍全部资产）。
  #   漏这一步的后果：加载器 **fail-closed 拒载**（"资产校验失败"）—— 实测过两次。
  python3 "$REPO/build/assets.py" sync-js "$SITE" $M_ASSETS \
    || { echo "FATAL: sync-js 失败" >&2; exit 1; }
  for d in "$SITE_EXP" "$REPO_MIRROR"; do
    cp -p "$SITE/assets/manifest.json" "$d/assets/manifest.json"
  done
  # 车道清单从基础清单复制非 oct 条目 ⇒ 基础那份的 m-asset sha 一变，车道那份就陈旧。
  for lane in w64; do   # 三线裁决：threads 清单已随档删除
    for d in "$SITE" "$SITE_EXP" "$REPO_MIRROR"; do
      [ -f "$d/assets/manifest.$lane.json" ] || continue
      python3 "$REPO/build/113/make-lane-manifest.py" "$d/assets" --lane "$lane" >/dev/null \
        || { echo "FATAL: 重生成 $d 的 manifest.$lane.json 失败" >&2; exit 1; }
    done
  done
  # ★ 反向断言两条：
  #   ① 车道清单必须与磁盘字节一致（漏重生成 ⇒ 红）
  #   ② 三个站点的 m-asset 必须逐字节相同（拷贝漏一处 ⇒ 红）
  for lane in w64; do
    for d in "$SITE" "$SITE_EXP" "$REPO_MIRROR"; do
      [ -f "$d/assets/manifest.$lane.json" ] || continue
      python3 "$REPO/build/113/make-lane-manifest.py" "$d/assets" --check --lane "$lane" >/dev/null 2>&1 \
        || { echo "FATAL: $d 的 manifest.$lane.json --check 不过（m 资产 sha 没跟上？）" >&2; exit 1; }
    done
  done
  for name in $M_ASSETS; do
    a=$(sha256sum "$SITE/assets/m/$name.js" | cut -d' ' -f1)
    for pair in "$SITE_EXP:$name" "$REPO_MIRROR:$name"; do
      p="${pair%%:*}"; b=$(sha256sum "$p/assets/m/$name.js" 2>/dev/null | cut -d' ' -f1)
      [ "$a" = "$b" ] || { echo "FATAL: $p/assets/m/$name.js 与 8761 不一致（拷贝漏了？）" >&2; exit 1; }
    done
    # 清单里那条 sha 必须等于磁盘字节（否则加载器拒载 —— 这条是上面 sync-js 的反向断言）
    m=$(python3 -c "
import json,io
d=json.load(io.open('$SITE/assets/manifest.json',encoding='utf-8'))
print(next((x['sha256'] for x in d['assets'] if x['name']=='$name'), ''))")
    [ "$a" = "$m" ] || { echo "FATAL: $name 清单 sha($m) != 磁盘($a) ⇒ 加载器会拒载" >&2; exit 1; }
  done
  echo "   已同步 $(echo $M_ASSETS | wc -w) 个 m 资产 + 三份清单 + 车道清单（两站 + 镜像，逐字节核过）"
fi

sh "$REPO/build/gen-lanes.sh" "$SITE" || { echo "FATAL: 生成 $SITE/lanes.js 失败" >&2; exit 1; }
cp -p "$SITE/lanes.js" "$REPO_MIRROR/lanes.js"
echo ""
echo "── ④ 复核（本脚本的 --verify）──"
SITE="$SITE" SITE_EXP="$SITE_EXP" REPO_MIRROR="$REPO_MIRROR" bash "$0" --verify
