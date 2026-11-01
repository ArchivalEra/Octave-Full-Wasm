#!/usr/bin/env bash
# Octave-Full-Wasm — **一条线出三种产物**的结算件（工单 74；三产物口径 2026-11-01 修正）
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
# ★ 2026-11-01 修正（用户点令「去除我们自己补丁的 w64 标准版的配方也得留着」）：
#   本文件原来写 `MODES="product w64"`，并宣称"三个产物 = product / w64 / w64+RUST_SORT=1"。
#   **那句话是自相矛盾的**：`RUST_SORT=1` 本来就是 `w64` 的**默认值** ⇒ "第三个产物"
#   等于"第二个产物"。于是闸门只验两组，第三组从未被覆盖 —— 真缺口是**w64 标准版**
#   （不带 rust_sort 补丁，free）**没有名字**，只能靠操作员记得 `RUST_SORT=0` 环境变量。
#
#   正解 = 三个**有名字**的模式，各自对应旧三线之一：
#
#     | 模式      | 架构   | RUST_SORT | 许可     | 旧分支              |
#     |-----------|--------|-----------|----------|---------------------|
#     | `product` | wasm32 | 0         | free     | `wasm32-final`      |
#     | `w64-std` | wasm64 | **0**     | **free** | `master`            |
#     | `w64`     | wasm64 | **1**     | non-free | `IllegalPerformance`|
#
# 五条断言（每条都能红，见 --selftest）：
#   ① 三个模式都能 explain 出非空参数组
#   ② 三组**两两互不相同**（不是三个名字同一组）
#   ③ 关键差异与三线裁决一致：MEMORY64 0/1/1、MALLOC 空/mimalloc/mimalloc
#   ④ ★ 许可边界：free 产物（`product` / `w64-std`）默认 RUST_SORT=0；non-free（`w64`）=1
#   ⑤ ★ 标准版必须**真的是标准版**：`w64-std` 与 `w64` 除 RUST_SORT 外架构面逐字相同
#      （这条防的是"给了个名字、但配方其实还是带补丁的"那种假分叉）
#
# 用法：
#   bash build/113/check-one-line-three-products.sh
#   bash build/113/check-one-line-three-products.sh --selftest
set -uo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO"

RELINK="build/113/relink.sh"
# 顺序有讲究：wasm32 → wasm64 标准 → wasm64 补丁（由弱到强的许可边界）
MODES="product w64-std w64"
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

# `explain` 对空值打的是**占位符** `（空）`（不是空串）—— 判据要认这个形状，
# 否则假红（实测踩到一次）。
is_empty_val () {
  case "$1" in ""|"（空）"|"(空)"|"empty") return 0 ;; *) return 1 ;; esac
}

# ══ 五条断言（函数化，供 --selftest 复用）════════════════════════════════════
run_assertions () {
  local bad=0

  # ① 每个模式 explain 非空
  for m in $MODES; do
    local p; p="$(params "$m")"
    if [ -z "$p" ]; then
      printf "  ✗ ① 模式 %s 的 explain 为空（out_default 没了？）\n" "$m" >&2; bad=$((bad+1))
    fi
  done

  # ② 三组**两两**互不相同（不只是首尾比 —— 三个名字里任意两个撞车都算退化）
  #   ⚠️ 每对**只报一次**：第一版用 "i$j 含 j$i" 去重，在 bash 里对 (a,ab) 这种前缀关系
  #     会误判 ⇒ 同一对报两遍（实测：坏桩下 w64-std/w64 那对刷了两行）。
  #     改用**下标**去重（j 只从 i 之后取），简单且不会误判。
  local _modes _nm _i _j pa pb
  _modes=($MODES); _nm=${#_modes[@]}
  for (( _i=0; _i<_nm; _i++ )); do
    for (( _j=_i+1; _j<_nm; _j++ )); do
      pa="$(params "${_modes[$_i]}")"; pb="$(params "${_modes[$_j]}")"
      if [ "$pa" = "$pb" ]; then
        printf "  ✗ ② 模式 %s 与 %s 的参数组完全相同（两个名字指同一件事）\n" \
               "${_modes[$_i]}" "${_modes[$_j]}" >&2
        bad=$((bad+1))
      fi
    done
  done

  # ③ 关键差异与三线裁决一致
  local m64p m64s m64w mallp malls mallw rsp rss rsw
  m64p="$(val product MEMORY64)";  m64s="$(val w64-std MEMORY64)";  m64w="$(val w64 MEMORY64)"
  mallp="$(val product MALLOC)";   malls="$(val w64-std MALLOC)";   mallw="$(val w64 MALLOC)"
  rsp="$(val product RUST_SORT)";  rss="$(val w64-std RUST_SORT)";  rsw="$(val w64 RUST_SORT)"

  [ "$m64p" = "0" ] && [ "$m64s" = "1" ] && [ "$m64w" = "1" ] || {
    printf "  ✗ ③ MEMORY64 不是 product=0 / w64-std=1 / w64=1（实得 %s / %s / %s）\n" \
           "$m64p" "$m64s" "$m64w" >&2
    bad=$((bad+1)); }
  if is_empty_val "$mallp" && [ "$malls" = "mimalloc" ] && [ "$mallw" = "mimalloc" ]; then :; else
    printf "  ✗ ③ MALLOC 不是 product=空 / w64-std=mimalloc / w64=mimalloc（实得 %s / %s / %s）\n" \
           "$mallp" "$malls" "$mallw" >&2
    bad=$((bad+1)); fi

  # ④ ★ 许可边界：**两个** free 产物不链 rust_sort，non-free 那个才链
  [ "$rsp" = "0" ] || {
    printf "  ✗ ④ 许可边界：product 默认 RUST_SORT=%s，必须 0（free 产物不得链 non-free 符号）\n" \
           "$rsp" >&2; bad=$((bad+1)); }
  [ "$rss" = "0" ] || {
    printf "  ✗ ④ 许可边界：**w64-std 默认 RUST_SORT=%s，必须 0**（标准版是 free 产物；\n" \
           "$rss" >&2; bad=$((bad+1)); }
  [ "$rsw" = "1" ] || {
    printf "  ✗ ④ non-free 线：w64 默认 RUST_SORT=%s，必须 1（IP 线的产物特征）\n" "$rsw" >&2
    bad=$((bad+1)); }

  # ⑤ ★ 标准版与补丁版只在 RUST_SORT 上分叉 —— 其余架构面必须逐字相同。
  #   防的是"起了个名字但配方没真分叉"（或反过来：标准版被顺手去掉了 -pthread）。
  local fd fs d
  fd="$(mktemp)"; fs="$(mktemp)"
  bash "$RELINK" exports w64     > "$fd" 2>/dev/null || true
  bash "$RELINK" exports w64-std > "$fs" 2>/dev/null || true
  # ⚠️ `set -euo pipefail` 下 **`diff` 有差异时返回 1**，赋值会继承 ⇒ 当场杀脚本。
  #   管道首环节必须 `|| true`（本仓老坑，自证里踩过两次）。
  d="$( { diff "$fd" "$fs" 2>/dev/null || true; } | awk '/^[<>]/ && !/^[<>] RUST_SORT=/' | wc -l)"
  rm -f "$fd" "$fs"
  if [ "$d" -ne 0 ]; then
    printf "  ✗ ⑤ w64-std 与 w64 在 RUST_SORT 之外还有 %s 行差异（标准版配方分叉了）\n" "$d" >&2
    bad=$((bad+1))
  fi

  return $bad
}

# ══ F1 自证：三类用例（正常 / 该报 / 空值）════════════════════════════════════
if [ "${1:-}" = "--selftest" ]; then
  T="$(mktemp -d)"; bad=0; n=0

  # ① 正常：真仓 ⇒ 五条全过
  n=$((n+1))
  if OUT="$(run_assertions 2>&1)"; then
    say "PASS | 真仓：三个模式参数组可区分 + 许可边界成立 + 标准版真分叉"
  else
    say "fail | 真仓五条断言不成立"; printf '%s\n' "$OUT" | sed 's/^/    /'; bad=$((bad+1))
  fi

  # ② 该报的必须报：桩 —— 两个模式回同一组参数（模拟"几个名字指同一件事"）
  n=$((n+1))
  cat > "$T/mkstub.sh" <<'STUB'
#!/usr/bin/env bash
# 桩：三个模式全回同一组参数
case "$2" in product|w64|w64-std) printf 'MEMORY64 0\nMALLOC \nRUST_SORT 0\n' ;; esac
STUB
  chmod +x "$T/mkstub.sh"
  export RELINK="$T/mkstub.sh"
  if run_assertions >/dev/null 2>&1; then
    say "fail | ★ 多个模式回同一组参数 ⇒ 断言仍全过（无区分力）"; bad=$((bad+1))
  else say "PASS | ★ 多个模式回同一组参数 ⇒ ②/③/④ 必红（有区分力）"; fi
  export RELINK="build/113/relink.sh"

  # ②b ★ 该报的必须报：**标准版被偷偷带了补丁**（w64-std 的 RUST_SORT 回 1）
  #     这正是本批要防的形状：起了个"标准版"的名字、配方却还是带补丁的。
  n=$((n+1))
  cat > "$T/stdpatched.sh" <<'STUB'
#!/usr/bin/env bash
# 桩：标准版与补丁版一模一样（假分叉）
case "$2" in
  product) printf 'MEMORY64 0\nMALLOC \nRUST_SORT 0\n' ;;
  w64|w64-std) printf 'MEMORY64 1\nMALLOC mimalloc\nRUST_SORT 1\n' ;;
esac
STUB
  chmod +x "$T/stdpatched.sh"
  export RELINK="$T/stdpatched.sh"
  if run_assertions >/dev/null 2>&1; then
    say "fail | ★ 标准版带补丁（RUST_SORT=1）⇒ 断言仍全过（许可边界失守）"; bad=$((bad+1))
  else say "PASS | ★ 标准版带补丁 ⇒ ②/④ 必红（许可边界有牙齿）"; fi
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
  python3 build/113/explain-diff.py "$RELINK" product w64-std w64
  say ""
  say "ok（三个产物 = 三组可区分参数；free/non-free 边界成立；标准版真分叉）"
  exit 0
fi
say "FAILED：$RC 组断言不成立（见上）" >&2
exit 1
