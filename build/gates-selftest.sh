#!/bin/sh
# Octave-Full-Wasm — **闸门自证**：每个闸门都必须能证明自己"会红"（事实系统 F1）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么有它（实测，见 `build/113/PLAN-arch.md` §2 F1 与架构评审 §0）：
#   本仓约 20 个检查器里，**只有 1 个**能证明自己会红；其余闸门的"可证伪性"只以散文记在
#   HANDOFF/PLAN/HISTORY 里 ⇒ "闸门自己坏了"这件事**没有任何东西会响**。实测到的空转：
#     · `check-site-parity.sh`：三处站点同时缺 `VERSION` ⇒ 三列都是 `(缺)` ⇒ 报"完全一致"；
#     · `check-build-manifest.py`：`declared == {}` ⇒ 给出 `verdict:"ok"`；
#     · `glue-selftest`：`0/0` 算"全过"；
#     · `check-consistency.py` 启动清单块：正则一改就匹配 0 个名字，而"0 个都合规"恒真。
#
# 本脚本跑每个闸门的 `--selftest`（合成输入下的"该红"用例），**接进 pre-commit**：
# 闸门不能证明自己会红 ⇒ 提交被拦。这不是"多一道检查"，而是**检查器本身也进了被检查的范围**。
#
# 用法：sh build/gates-selftest.sh        # 全绿 exit 0；任一闸门自证不完整 exit 1
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

# ⚠️ 新增闸门时**必须**在这里登记，并在自己的 `--selftest` 里写"该红"用例。
#    名单外的闸门 = 没人盯着的闸门 —— 那正是本脚本要消灭的情况。
LIST="$(mktemp)"
cat >"$LIST" <<'EOF'
.githooks/check-whitelist.py --selftest
.githooks/check-wants.py --selftest
.githooks/check-state.py --selftest
.githooks/check-consistency.py --selftest
.githooks/check-readiness-pattern.py --selftest
build/check-site-parity.sh --selftest
build/check_m.py --selftest
build/serve-coi.py --selftest
build/113/check-build-manifest.py --selftest
build/113/check-oct-imports.py --selftest
build/113/check-dylink-signatures.py --selftest
build/113/check-oct-lane.py --selftest
build/113/atomics_scan.py --selftest
build/113/witness-build-provenance.py --selftest
build/113/witness-build-inputs.py --selftest
.githooks/witness-upstream-pin.py --selftest
build/113/plugin-check.py --selftest
build/113/hotpath.py --selftest
build/113/wasm_symbols.py --selftest
build/113/stage-oct-by-manifest.py --selftest
build/113/make-lane-manifest.py --selftest
build/113/unpatch-ax-pthread.py --selftest
build/113/lane-shim.sh --selftest
build/113/patch-openblas-f77-ret.py --selftest
build/113/patch-openblas-symbol-prefix.py --selftest
build/113/patch-openblas-emscripten.py --selftest
build/113/patch-glue-proxy-dlsync-bigint.py --selftest
build/113/gen-f77-wrappers.py --selftest
build/113/relink.sh --selftest
build/facts.py --selftest
build/lib/sweep_select.py --selftest
build/113/lane-pick-selftest.mjs --selftest
build/promote-pages.sh --selftest
build/promote-w64-lane.sh --selftest
build/gen-lanes.sh --selftest
EOF

n=0; bad=0; badlist=""
# ⚠️ 从**文件**读，不用 `… | while`：管道是子壳，计数器传不出来（本仓实测踩过这个坑）。
while IFS= read -r line; do
  [ -n "$line" ] || continue
  script="${line%% *}"; args="${line#* }"
  [ "$args" = "$script" ] && args=""
  [ -f "$script" ] || { echo "  ❌ 闸门不存在：$script" ; bad=$((bad + 1)); badlist="$badlist(缺)$script"; continue; }
  n=$((n + 1))
  # ⚠️ 按**扩展名 + shebang** 分派：`relink.sh` 是 bash（用了进程替换/数组），
  #    用 `sh`（dash）跑会报 "Syntax error: redirection unexpected" —— 实测踩过。
  case "$script" in
    *.py) # shellcheck disable=SC2086
          out=$(python3 "$script" $args 2>&1) ;;
    *.mjs) # shellcheck disable=SC2086
          out=$(node "$script" $args 2>&1) ;;
    *)    if head -1 "$script" | grep -q 'bash'; then
            # shellcheck disable=SC2086
            out=$(bash "$script" $args 2>&1)
          else
            # shellcheck disable=SC2086
            out=$(sh "$script" $args 2>&1)
          fi ;;
  esac
  rc=$?
  summary=$(printf '%s\n' "$out" | grep -E '自证 |PASS / |=== ' | tail -1)
  if [ "$rc" = "0" ]; then
    printf '  ✅ %-42s %s\n' "$script" "$summary"
  else
    printf '  ❌ %-42s %s\n' "$script" "$summary"
    bad=$((bad + 1)); badlist="$badlist $script"
    printf '%s\n' "$out" | tail -6 | sed 's/^/       /'
  fi
done <"$LIST"
rm -f "$LIST"

echo "================================================================"
if [ "$bad" != "0" ]; then
  echo "★ 闸门自证不通过：$bad / $n 个闸门**证明不了自己会红**：$badlist"
  # ⚠️ 别在 echo 里写反引号 —— 那会被 shell 当命令替换（本行第一版就踩了：--selftest: not found）
  echo "  修法：给该闸门补 --selftest（至少三类用例：正常不报 / 该报的必须报 / 空输入必须报）"
  exit 1
fi
echo "闸门自证：$n 个闸门全部能红 ✅"
exit 0
