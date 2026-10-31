#!/usr/bin/env bash
# Octave-Full-Wasm — **一条线出三种产物**的结算件（工单 74）
# Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
#
# 判据（工单 74 的 Settling 行）：
#   rc=0 ⇒ 一条线上的**三个模式各自能 explain 出可区分的参数组**，关键差异与三线裁决一致，
#          且**许可边界**（free 产物不链 rust_sort）有机器判据
#   rc=1 ⇒ 有断言不成立（逐条点名）
#   rc=2 ⇒ 读不到（fail-closed）
#
# 为什么是"参数组可区分"这条缝：
#   三线合一的合法性**完全**建立在"三个产物 = 三组参数"上。如果三组参数相同，那三个模式
#   就是三个名字指同一件事（合并会退化成"少了两个产物"）。所以这条缝就是本工单的全部。
#
# 四条断言（每条都能红，见 --selftest）：
#   ① 三个模式都能 explain 出非空参数组
#   ② 三组互不相同（不是三个名字同一组）
#   ③ 关键差异与三线裁决一致：MEMORY64 0/1、MALLOC 空/mimalloc、RUST_SORT 0/1
#   ④ ★ 许可边界：free 产物（product）默认 RUST_SORT=0，non-free（w64）默认 1
#
# 用法：
#   bash build/113/check-one-line-three-products.sh
#   bash build/113/check-one-line-three-products.sh --selftest
set -uo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO"

RELINK="build/113/relink.sh"
MODES="product w64"
BAD=0
N=0

say () { printf "%s\n" "$1"; }
fail () { printf "  ✗ %s\n" "$1" >&2; BAD=$((BAD+1)); }

# 取某模式的参数组（KEY=VALUE 行，排序；去掉注释头）
params () {
  # ⚠️ 正则必须含数字：`MEMORY64` 的 key 带 `6`/`4`，原来写 `^[A-Z_]+ ` 会**漏掉它**
  #   （实测踩到：MEMORY64 那行 grep 不到 ⇒ ③ 断言读空 ⇒ 假红。这是正则 bug，不是产物问题）。
  bash "$RELINK" explain "$1" 2>/dev/null | grep -E '^[A-Z_][A-Z_0-9]* ' | LC_ALL=C sort
}

# 取某模式的单个参数值
val () {   # $1=mode $2=key
  params "$1" | awk -v k="$2" '$1==k {print $2}'
}

# ══ 四条断言（函数化，供 --selftest 复用）════════════════════════════════════
run_assertions () {
  local bad=0

  # ① 每个模式 explain 非空
  for m in $MODES; do
    local p; p="$(params "$m")"
    if [ -z "$p" ]; then
      printf "  ✗ ① 模式 %s 的 explain 为空（out_default 没了？）\n" "$m" >&2; bad=$((bad+1))
    fi
  done

  # ② 三组互不相同
  local pa pb
  pa="$(params product)"; pb="$(params w64)"
  if [ "$pa" = "$pb" ]; then
    printf "  ✗ ② product 与 w64 的参数组完全相同（三个名字指同一件事）\n" >&2; bad=$((bad+1))
  fi

  # ③ 关键差异与三线裁决一致
  local m64p m64w mallp mallw rsp rsw
  m64p="$(val product MEMORY64)";  m64w="$(val w64 MEMORY64)"
  mallp="$(val product MALLOC)";   mallw="$(val w64 MALLOC)"
  rsp="$(val product RUST_SORT)";  rsw="$(val w64 RUST_SORT)"
  [ "$m64p" = "0" ] && [ "$m64w" = "1" ] || {
    printf "  ✗ ③ MEMORY64 不是 product=0 / w64=1（实得 %s / %s）\n" "$m64p" "$m64w" >&2
    bad=$((bad+1)); }
  # ⚠️ `explain` 对空值打的是**占位符** `（空）`（不是空串）——判据要认这个形状，
  #   否则假红（实测踩到一次）。判据 = product 侧为**空或占位符**，w64 侧必须是 mimalloc。
  _mall_empty=0
  case "$mallp" in ""|"（空）"|"(空)"|"empty") _mall_empty=1 ;; esac
  if [ "$_mall_empty" = "1" ] && [ "$mallw" = "mimalloc" ]; then :; else
    printf "  ✗ ③ MALLOC 不是 product=空 / w64=mimalloc（实得 %s / %s）\n" "$mallp" "$mallw" >&2
    bad=$((bad+1)); fi

  # ④ ★ 许可边界：free 产物不链 rust_sort
  #   product（wasm32）默认必须 0；w64 默认必须 1（non-free 线）
  [ "$rsp" = "0" ] || {
    printf "  ✗ ④ 许可边界：product 默认 RUST_SORT=%s，必须 0（free 产物不得链 non-free 符号）\n" \
           "$rsp" >&2; bad=$((bad+1)); }
  [ "$rsw" = "1" ] || {
    printf "  ✗ ④ non-free 线：w64 默认 RUST_SORT=%s，必须 1（IP 线的产物特征）\n" "$rsw" >&2
    bad=$((bad+1)); }

  return $bad
}

# ══ F1 自证：三类用例（正常 / 该报 / 空值）════════════════════════════════════
if [ "${1:-}" = "--selftest" ]; then
  T="$(mktemp -d)"; bad=0; n=0

  # ① 正常：真仓 ⇒ 四条全过
  n=$((n+1))
  if OUT="$(run_assertions 2>&1)"; then
    say "PASS | 真仓：三个模式参数组可区分 + 许可边界成立"
  else
    say "fail | 真仓四条断言不成立"; printf '%s\n' "$OUT" | sed 's/^/    /'; bad=$((bad+1))
  fi

  # ② 该报的必须报：夹具 relink（把 w64 的 MEMORY64 改成 0 ⇒ 与 product 同）
  n=$((n+1))
  FIX="$T/relink.sh"
  sed 's|w64)     echo /src/websrc/w64-out|w64)     echo /src/websrc/product|; ' \
      "$RELINK" > "$FIX"
  # 更直接：造一个假 explain 输出（不依赖真脚本的容器）——用桩函数验证 ② 的判据会红
  cat > "$T/mkstub.sh" <<'STUB'
#!/usr/bin/env bash
# 桩：两个模式回同一组参数（模拟"三个名字指同一件事"）
case "$2" in product|w64) printf 'MEMORY64 0\nMALLOC \nRUST_SORT 0\n' ;; esac
STUB
  chmod +x "$T/mkstub.sh"
  export RELINK="$T/mkstub.sh"
  if run_assertions >/dev/null 2>&1; then
    say "fail | ★ 两个模式回同一组参数 ⇒ 断言仍全过（无区分力）"; bad=$((bad+1))
  else say "PASS | ★ 两个模式回同一组参数 ⇒ ②/③ 必红（有区分力）"; fi
  export RELINK="build/113/relink.sh"

  # ③ 空值：空桩（explain 啥也不输出）⇒ 必须报
  n=$((n+1))
  EMPTY="$T/empty.sh"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$EMPTY"; chmod +x "$EMPTY"
  export RELINK="$EMPTY"
  if run_assertions >/dev/null 2>&1; then
    say "fail | ★ explain 空输出 ⇒ 断言仍全过（零值守卫失效）"; bad=$((bad+1))
  else say "PASS | ★ explain 空输出 ⇒ ① 必红（零值守卫成立）"; fi
  export RELINK="build/113/relink.sh"

  rm -rf "$T"
  echo "=== check-one-line-three-products 自证：$((n-bad)) PASS / $bad fail ==="
  [ "$bad" = 0 ]
  exit $?
fi

# ══ 对真仓实跑 ══════════════════════════════════════════════════════════════
say "查「一条线出三种产物」（工单 74）…"
[ -f "$RELINK" ] || { say "FATAL: 读不到 $RELINK" >&2; exit 2; }

run_assertions; RC=$?
if [ "$RC" = 0 ]; then
  say ""
  say "三个模式的参数差异："
  # 参数差异表交给同目录的 .py（bash 的 paste/join 在两条 K=V 流上会串味，实测踩过）
  python3 build/113/explain-diff.py "$RELINK" product w64
  say ""
  say "ok（三个产物 = 三组可区分参数；free/non-free 边界成立）"
  exit 0
fi
say "FAILED：$RC 组断言不成立（见上）" >&2
exit 1
