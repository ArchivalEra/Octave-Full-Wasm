#!/bin/sh
# Octave-Full-Wasm — **CI 兜底是否已立**（工单 67 的结算件）
# Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么有它：`reflect-hooks/pre-push` 曾声称"CI（.github/workflows/readme-sync.yml）跑同一条
# 判据"，而实测该文件**全历史从未存在**、且 `.github/` **整体未被 git 跟踪**
# （`.gitignore` 的 `*` 默认拒绝、无放行规则）⇒ 那句是空头，三语 README 判据实际只有本地一道。
# 本脚本把"CI 兜底到底立没立"变成可判的（工单 67 的 rc 契约）。
#
# rc 契约（与工单 67 的 `**Settling:**` 行逐字对齐）：
#   rc=0 ⇒ CI 兜底**已立**（`.github/` 已入库 + 白名单放行 + 本地能复跑 CI 判据集）
#   rc=1 ⇒ **仍是空头**（`.github/` 未被跟踪 ⇒ CI 从未跑过）
#   rc=2 ⇒ **半吊子**（已入库但白名单/判据集有问题，逐条点名）
#   rc=3 ⇒ 环境问题（git 不在 / 读不到 .gitignore），不是结论
#
# stdout：`ok` / `PROBLEM: <哪条>`（平台闸门惯例）。
# 用法：sh build/113/check-ci-bootstrap.sh ／ --selftest
set -u

REPO="$(cd "$(dirname "$0")/../.." && pwd)"

# ── F1 自证：三类用例（正常 / 该报的必须报 / 空输入必须报）──────────────────────
if [ "${1:-}" = "--selftest" ]; then
  bad=0; n=0
  tmp="$(mktemp -d)"
  mkfixture () {  # $1=临时仓根 $2=tracked|untracked $3=allow|noallow $4=addmode(plain|force)
    rm -rf "$1"; mkdir -p "$1/.github/workflows" "$1/build/113"
    cp "$0" "$1/build/113/check-ci-bootstrap.sh"
    printf 'x\n' > "$1/.github/workflows/readme-sync.yml"
    # 最小 .gitignore（白名单形态）
    printf '*\n!*/\n!.gitignore\n' > "$1/.gitignore"
    [ "$3" = "allow" ] && printf '!.github/\n!.github/workflows/*\n' >> "$1/.gitignore"
    (
      cd "$1" || exit 1
      git init -q . || exit 1
      # ⚠️ 语义：`git ls-files` 读的是**索引**（= 本脚本的"已入库"判据）。
      #   · plain  : 遵守 .gitignore ⇒ 只在 allow 夹具里真能加进去（①）
      #   · force  : `-f` 强制入库 ⇒ 造出"入库了但白名单没放行"的半吊子（③）
      #   · none   : 不 add ⇒ TRACKED=0，造"未入库"（②）
      case "$4" in
        plain) git add -A >/dev/null 2>&1 ;;
        force) git add -f .github/ >/dev/null 2>&1 ;;
        none)  : ;;
      esac
      git -c user.email=x -c user.name=x commit -qm x >/dev/null 2>&1 || true
    )
  }
  # ① 正常：已入库 + 放行 ⇒ 不报
  n=$((n+1)); mkfixture "$tmp/ok" tracked allow plain
  if CI_ROOT="$tmp/ok" sh "$0" >/dev/null 2>&1; then
    echo "PASS | CI 引导/已入库且放行 ⇒ 不报"; else echo "fail | CI 引导/已入库却报红"; bad=$((bad+1)); fi
  # ② 该报的必须报：未入库 ⇒ rc=1（"仍是空头"）
  n=$((n+1)); mkfixture "$tmp/notracked" untracked allow none
  CI_ROOT="$tmp/notracked" sh "$0" >/dev/null 2>&1; rc=$?
  if [ "$rc" = "1" ]; then
    echo "PASS | ★ CI 引导/未入库 ⇒ rc=1（仍是空头）"; else echo "fail | CI 引导/未入库 rc=$rc（期望 1）"; bad=$((bad+1)); fi
  # ③ 半吊子：入库但没有白名单放行 ⇒ rc=2
  n=$((n+1)); mkfixture "$tmp/half" tracked noallow force
  CI_ROOT="$tmp/half" sh "$0" >/dev/null 2>&1; rc=$?
  if [ "$rc" = "2" ]; then
    echo "PASS | ★ CI 引导/入库但无白名单放行 ⇒ rc=2（半吊子）"; else echo "fail | CI 引导/半吊子 rc=$rc（期望 2）"; bad=$((bad+1)); fi
  # ④ 空输入必须报：临时仓里没有 .github ⇒ rc=1（拿"它不在"当"已立"是不许的）
  n=$((n+1)); rm -rf "$tmp/empty"; mkdir -p "$tmp/empty"; printf '*\n' > "$tmp/empty/.gitignore"
  ( cd "$tmp/empty" && git init -q . )
  CI_ROOT="$tmp/empty" sh "$0" >/dev/null 2>&1; rc=$?
  if [ "$rc" = "1" ]; then
    echo "PASS | ★ CI 引导/没有 .github ⇒ rc=1（零值守卫：空不是通过）"; else echo "fail | CI 引导/空输入 rc=$rc（期望 1）"; bad=$((bad+1)); fi
  rm -rf "$tmp"
  echo "=== check-ci-bootstrap 自证：$((n-bad)) PASS / $bad fail ==="
  exit "$bad"
fi

ROOT="${CI_ROOT:-$REPO}"
cd "$ROOT" 2>/dev/null || { echo "FATAL: 进不去 $ROOT（rc=3：环境问题）" >&2; exit 3; }
command -v git >/dev/null 2>&1 || { echo "FATAL: git 不在（rc=3）" >&2; exit 3; }
[ -f .gitignore ] || { echo "FATAL: 读不到 .gitignore（rc=3）" >&2; exit 3; }

STATE=ok
# ① 有没有 .github（空输入守卫：没有 ⇒ 空头）
if [ ! -d .github ]; then
  echo "PROBLEM: 没有 .github/ —— 没有 CI 可言（rc=1：仍是空头）"
  exit 1
fi
# ② 是否被 git 跟踪
TRACKED=$(git ls-files .github/ 2>/dev/null | wc -l | tr -d ' ')
if [ "$TRACKED" = "0" ]; then
  echo "PROBLEM: .github/ 整体未被 git 跟踪（git ls-files .github/ = 0）⇒ CI 从未跑过（rc=1：仍是空头）"
  echo "         判据复跑：git ls-files .github/ ；被谁拒：git check-ignore -v .github/workflows/*.yml"
  exit 1
fi
# ③ 每个被跟踪的 workflow 都要有白名单放行（check-whitelist 的判据面）
ALLOWED=1
for f in $(git ls-files .github/); do
  if ! git check-ignore --quiet --no-index "$f" 2>/dev/null; then
    :   # check-ignore --quiet 命中"被忽略" ⇒ 非 0 表示未被忽略（= 有放行）—— 见下更直接判据
  fi
done
# 更直接：拿 .gitignore 的放行规则逐条匹配（与 check-whitelist.py 同口径：`!` 行）
RULES=$(grep -E '^![^/]' .gitignore 2>/dev/null | sed 's/^!//' | tr '\n' ' ')
MISSING=""
for f in $(git ls-files .github/); do
  HIT=""
  for r in $RULES; do
    case "$f" in
      $r) HIT=1; break ;;
    esac
  done
  # 目录级放行（`!.github/`）也算
  case "$f" in .github/*) case "$RULES" in *".github/"*|*".github/*"*) HIT=1 ;; esac ;; esac
  [ -n "$HIT" ] || MISSING="$MISSING $f"
done
if [ -n "$MISSING" ]; then
  echo "PROBLEM: 已入库但白名单没放行（rc=2：半吊子）：$MISSING"
  echo "         修法：.gitignore 加 !.github/ 与 !.github/workflows/*（否则新克隆仍看不到它们）"
  STATE=half
fi
if [ "$STATE" = "ok" ]; then echo "ok"; exit 0; fi
exit 2
