#!/usr/bin/env bash
# Octave-Full-Wasm — **emsdk 供给**：在容器里按版本装 emsdk，并把 `/emsdk` 指向它
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# ── 为什么有它（2026-10-10）──────────────────────────────────────────────────────
# `emsdk` **已经在 fork 管线里**（`build/upstream-pins.json` 的 `kind:"toolchain"` 条目，
# `.githooks/witness-upstream-pin.py` 每提交断言「容器 emcc 版本 == expect_version」），
# **但只到"版本串断言"这一层** —— 容器里那份 SDK 是**手工解包装**的，`provision-upstream.sh`
# 明确不管它（注释：emsdk 那种 1.8G 的 portable SDK 不流进容器）。
# ⇒ 「紧随最新版 emcc」这件事**没有受管辖的入口**：只能手敲，而手敲 = 不可复现。
#
# 本脚本补上那一环，形状与 `provision-upstream.sh` 同族：
#   · **版本化安装**：每个版本装到 `/opt/emsdk-<版本>`（并存，不互相覆盖）
#   · **切换 = 换软链**：`/emsdk` 是软链，指向当前生效的那份
#   · ⚠️ 为什么用软链而不是改脚本：**36 处硬编码 `/emsdk/...`** 散在 25 个 build 脚本里
#     （`grep -rn '/emsdk' build/**/*.sh | wc -l`）。让 `/emsdk` 保持稳定路径 ⇒
#     **切换版本时那 36 处一个都不用改**（改了才有"两处口径漂移"的风险）。
#
# 用法（**宿主**上调；它自己 docker exec 进容器）：
#   sudo -E bash build/113/provision-emsdk.sh install 6.0.10     # 装一个版本（并存）
#   sudo -E bash build/113/provision-emsdk.sh use 6.0.10         # 切 /emsdk 软链
#   sudo -E bash build/113/provision-emsdk.sh status             # 当前生效的是哪份
#   bash build/113/provision-emsdk.sh --selftest                 # 自证（不碰真容器）
set -euo pipefail

CTR="${CTR:-o113}"
OPT_ROOT="${OPT_ROOT:-/opt}"
LINK="${LINK:-/emsdk}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"

# 容器里跑一段（真做时用；自证时替换成假的 runner）
crun () { sudo -E docker exec "$CTR" bash -lc "$1"; }

# ── 判据：这三个文件同时存在才算"这份 SDK 装好了" ──────────────────────────────
# 为什么查三个：emsdk 的 install 是分步的（clone → 下 node → 下 llvm/emscripten）。
# 只看目录存在会把"装到一半"当成装好了（本仓对"装了一半"有久经教训：见 build-oct 的
# 半装包根）。三个都纯在 = 至少三块主件都落了盘。
have_sdk () {  # $1 = 目录
  crun "[ -f '$1/upstream/emscripten/emscripten-version.txt' ] \
     && [ -x '$1/upstream/bin/clang' ] \
     && [ -d '$1/node' ]" >/dev/null 2>&1
}

sdk_version_of () {  # $1 = 目录 → 打印版本串（读 emscripten-version.txt，不猜）
  crun "cat '$1/upstream/emscripten/emscripten-version.txt' 2>/dev/null | tr -d '\"'"
}

# ── 纯逻辑（自证走这里，不碰真容器）──────────────────────────────────────────
# 抽成函数是为了 --selftest 能注入假 runner：**"该报的必须报"** 这类用例没法用真
# docker 造（总不能真去装一个坏 SDK）。
verdict_of () {  # $1=请求版本 $2=装完读到的版本 → ok 或错误串（纯函数）
  if [ "$1" = "$2" ]; then echo "ok"; else echo "版本不符（请求 $1，实得 $2）"; fi
}
link_action_of () {  # $1=link 存在?(0/1) $2=是软链?(0/1) → 该做什么（纯函数）
  if [ "${1:-0}" = "0" ]; then echo "create"          # 不存在 ⇒ 直接建软链
  elif [ "${2:-0}" = "1" ]; then echo "relink"        # 已是软链 ⇒ 直接改指
  else echo "backup-then-link"; fi                    # 真目录 ⇒ 先改名备份（不删）
}

if [ "${1:-}" = "--selftest" ]; then
  bad=0; n=0
  t () { n=$((n+1)); if [ "$2" = "$3" ]; then echo "PASS | $1"; else echo "fail | $1（期望 $3 实得 $2）"; bad=$((bad+1)); fi; }
  # ① 正常不报
  t "install 完成且版本一致 ⇒ ok"        "$(verdict_of 6.0.12 6.0.12)" "ok"
  t "已是软链 ⇒ 直接 relink"             "$(link_action_of 1 1)" "relink"
  t "link 不存在 ⇒ create"               "$(link_action_of 0 0)" "create"
  # ② 该报的必须报
  t "★ 装完版本不符 ⇒ 必须报"            "$(verdict_of 6.0.12 5.0.7 | grep -c 不符)" "1"
  t "★ /emsdk 是真目录 ⇒ 必须先备份（不许直接删）" "$(link_action_of 1 0)" "backup-then-link"
  # ③ 空输入必须报
  t "★ 空版本号 ⇒ 必然不符（零值守卫）"   "$(verdict_of '' 6.0.12 | grep -c 不符)" "1"
  t "★ 装完读不到版本（空）⇒ 必须报"      "$(verdict_of 6.0.12 '' | grep -c 不符)" "1"
  echo "=== provision-emsdk 自证：$((n-bad)) PASS / $bad fail ==="
  exit "$([ "$bad" = 0 ] && echo 0 || echo 1)"
fi

case "${1:-}" in
  install)
    VER="${2:?用法: provision-emsdk.sh install <版本，如 6.0.10>}"
    DIR="$OPT_ROOT/emsdk-$VER"
    echo "== 装 emsdk $VER → $DIR =="
    if have_sdk "$DIR"; then
      echo "   已存在且完整（版本 $(sdk_version_of "$DIR")）⇒ 跳过下载"
    else
      # 已经 clone 过就只 update（/opt/emsdk-6 这类）；否则 clone
      if crun "[ -d '$DIR/.git' ]"; then
        echo "   已有 git 树 ⇒ fetch"
        crun "cd '$DIR' && git fetch --tags --depth 1 origin tag $VER 2>&1 | tail -2 || true"
      else
        echo "   clone emsdk 仓 → $DIR"
        crun "git clone --depth 1 https://github.com/emscripten-core/emsdk.git '$DIR' 2>&1 | tail -2"
      fi
      echo "   emsdk install $VER（下载 node/llvm/emscripten，约 1–2 GB，慢）"
      crun "cd '$DIR' && ./emsdk install $VER 2>&1 | tail -6"
      crun "cd '$DIR' && ./emsdk activate $VER 2>&1 | tail -3"
    fi
    # ★ fail-closed：装完必须能读出**恰好这个版本**，否则不许说成功
    got="$(sdk_version_of "$DIR")"
    if [ "$got" != "$VER" ]; then
      echo "FATAL: 装完读到版本 '$got'，期望 '$VER'（install 没成功？）" >&2
      exit 3
    fi
    echo "   ✅ $DIR 就绪（版本 $got）"
    ;;

  use)
    VER="${2:?用法: provision-emsdk.sh use <版本>}"
    DIR="$OPT_ROOT/emsdk-$VER"
    have_sdk "$DIR" || { echo "FATAL: $DIR 没装好（先 install $VER）" >&2; exit 3; }
    got="$(sdk_version_of "$DIR")"
    [ "$got" = "$VER" ] || { echo "FATAL: $DIR 的版本是 '$got' ≠ '$VER'" >&2; exit 3; }
    echo "== 切 $LINK → $DIR =="
    # ⚠️ 切换前先记下"旧的是什么"，失败要能说清（并留一条回退命令）
    OLD="$(crun "readlink -f '$LINK' 2>/dev/null || echo '(不是软链)'")"
    echo "   旧: $OLD"
    # 只允许在「$LINK 是软链」或「$LINK 不存在」时切换：
    # 若是真目录（本仓现状），**先备份改名**而不是直接删 —— 里面可能有人手改的东西。
    if crun "[ -e '$LINK' ] && [ ! -L '$LINK' ]"; then
      BAK="$LINK.orig-$(date +%Y%m%d-%H%M%S)"
      echo "   ⚠️ $LINK 是真目录（不是软链）⇒ 原样改名为 $BAK（不删）"
      crun "mv '$LINK' '$BAK'"
      echo "   （回退：mv '$BAK' '$LINK'）"
    fi
    crun "ln -sfn '$DIR' '$LINK'"
    echo "   ✅ $LINK → $DIR"
    echo "   下一步：witness 会断言容器 emcc 版本；若与 pins 不符，跑"
    echo "     python3 build/upstream-pins-bump.py prepare   （或手工改 expect_version）"
    ;;

  status)
    echo "== emsdk 现状 =="
    echo -n "   $LINK → "; crun "readlink -f '$LINK' 2>/dev/null || echo '(真目录/缺失)'"
    echo -n "   容器 emcc: "; crun "emcc --version 2>/dev/null | head -1"
    echo "   已装版本（$OPT_ROOT）："
    crun "for d in $OPT_ROOT/emsdk-*; do [ -d \"\$d\" ] && echo \"     \$(basename \$d)  →  \$(cat \$d/upstream/emscripten/emscripten-version.txt 2>/dev/null | tr -d '\\\"')\"; done"
    echo -n "   pins 期望: "; python3 -c "
import json,sys
try:
    d=json.load(open('$REPO/build/upstream-pins.json'))
    for p in d['pins']:
        if p.get('name')=='emsdk': print(p.get('expect_version'))
except Exception as e: print('(读不到)')
"
    ;;
  "") echo "用法: provision-emsdk.sh {install <版本>|use <版本>|status|--selftest}" >&2; exit 2 ;;
  *)  echo "未知子命令：$1" >&2; exit 2 ;;
esac
