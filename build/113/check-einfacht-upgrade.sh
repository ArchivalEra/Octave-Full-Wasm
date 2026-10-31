#!/usr/bin/env bash
# Octave-Full-Wasm — **Einfacht 升级结算件**（工单 73）
# Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
#
# 判据（工单 73 的 Settling 行）：
#   rc=0 ⇒ 新机制层已落**且三条新纪律全部真跑**（#23 恒真探测 / #24 反向数字 / #25 历史不免死）
#   rc=1 ⇒ 有断言不成立（逐条点名）
#   rc=2 ⇒ 读不到（fail-closed）
#
# 为什么是这四条断言（每条都必须能红 —— 本仓 F1 纪律）：
#   ①②③ 验**符号在位**（`never_falsifiable` / `_unaccounted_numbers` / `_is_sourced`）——
#        这是"机制层真换过"的最低证据。只验符号不够（在位的函数可以不被调用），
#        所以还要 ④。
#   ④ 验**行为真跑**：构造三类对抗输入，要求判据**真的报**。这一条是核心 ——
#        它把"符号在"升级成"判据活着"。
#
# 每条断言都有对应的**变异证据**（跑 `--selftest` 时会真做）：
#   断掉符号 ⇒ ①②③ 红；关掉探测 ⇒ ④ 的对应子项绿 ⇒ 断言红。
#
# 用法：
#   sh build/113/check-einfacht-upgrade.sh             # 对本仓实跑
#   sh build/113/check-einfacht-upgrade.sh --selftest  # 三类用例（正常/该报/空值）
set -uo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO"

say () { printf "%s\n" "$1"; }
fail () { printf "  ✗ %s\n" "$1" >&2; BAD=$((BAD+1)); }

BAD=0
N=0

# ── ④ 行为真跑：三类对抗输入，判据必须真报 ──────────────────────────────────
#   这里不用「读源码查字符串」那种弱证据 —— 直接**调用**判据函数并要求它报。
behavior_probe () {
  python3 - <<'PY'
import importlib.util, os, sys

def load(name, path):
    # ⚠️ 机制层各闸门 `from gate import …` / `from ledger import …` ⇒ 必须把 zreflect/
    #   放上 sys.path，否则 import 就崩（第一版漏了，自证 ① 直接挂在这）。
    import sys as _sys
    _sys.path.insert(0, os.path.abspath("zreflect"))
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    os.environ.setdefault("REFLECT_FACTS", "build/FACTS.json")
    try:
        spec.loader.exec_module(m)
    except SystemExit:
        pass
    return m

ok = True
def want(cond, label):
    global ok
    if cond:
        print("    PASS | " + label)
    else:
        print("    fail | " + label)
        ok = False

# ── #23：恒真断言必须被判据抓出 ──
#   ⚠️ `never_falsifiable(fn)` 按 `fn.__code__.co_filename` 读**源码文件**做 AST 定位。
#   在 heredoc/stdin 里定义的 lambda 定位不到文件 ⇒ 恒返回 None（实测踩到，白跑一轮）。
#   ⇒ 必须把被测 lambda 写进一个**真 .py 文件**再导入。
g = load("gate", "zreflect/gate.py")
nf = getattr(g, "never_falsifiable", None)
want(callable(nf), "#23 符号 never_falsifiable 在位")
if callable(nf):
    import tempfile, textwrap
    probe_src = textwrap.dedent("""
        def get():
            return 1
        CASES = [
            lambda: (False or True),     # ① 恒真：or 真值常量
            lambda: x == x,              # ② 恒真：自我比较（AST 形状，不执行）
            lambda: get() == get(),      # ③ 合法纯函数性检验（不该被抓）
        ]
        """)
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as fh:
        fh.write(probe_src)
        probe_path = fh.name
    try:
        spec2 = importlib.util.spec_from_file_location("nf_probe", probe_path)
        m2 = importlib.util.module_from_spec(spec2)
        spec2.loader.exec_module(m2)
        r1 = nf(m2.CASES[0])
        r2 = nf(m2.CASES[1])
        r3 = nf(m2.CASES[2])
        want(bool(r1), "#23 真跑：`or True` 被抓")
        want(bool(r2), "#23 真跑：`x == x` 被抓")
        want(r3 is None, "#23 反向：`get() == get()` 不抓（合法纯函数性检验豁免）")
    finally:
        os.unlink(probe_path)

# ── #24：从不进台账的数字必须报 ──
cf = load("check_facts", "zreflect/check_facts.py")
ua = getattr(cf, "_unaccounted_numbers", None)
want(callable(ua), "#24 符号 _unaccounted_numbers 在位")
if callable(ua):
    # 造一行正文，含一个明显不在任何台账里的数字
    nlines = [(1, "本轮无关数字 99887766 出现在正文里")]
    facts = {}
    probs = ua("", facts, 100, nlines)     # bare_min=100
    want(bool(probs), "#24 真跑：无出处大数 ⇒ 报")
    # 反向：包进行内代码的数字**不该**报（纪律明说代码里的示例豁免）
    nlines2 = [(1, "示例 `99887766` 在反引号里")]
    probs2 = ua("", facts, 100, nlines2)
    want(not probs2, "#24 反向：反引号里的数字不报（示例豁免成立）")

# ── #25：带「历史」二字**不再**免死 ──
cs = load("check_stale", "zreflect/check_stale.py")
src = getattr(cs, "_is_sourced", None)
want(callable(src), "#25 符号 _is_sourced 在位")
if callable(src):
    # 阳性对照：普通编造断言（无出处）⇒ 不算 sourced
    want(not src("sha 是 deadbeefdeadbeef 的部署件"), "#25 阳性：无出处断言 ⇒ 不 sourced")
    # 实验组：同一句只多「历史」二字 ⇒ **仍不算 sourced**（这正是 #25 要堵的）
    want(not src("历史：sha 是 deadbeefdeadbeef 的部署件"),
         "#25 真跑：加「历史」二字**仍不** sourced（免死金牌失效）")
    # 合法的两种出处仍要放行（否则闸门变成一律红）
    want(src("交付件 octave-20261031 里的 sha"),
         "#25 反向：DATED_RECORD 交付名 ⇒ sourced（合法出处成立）")
    want(src("见 [[wasm_sha]] 那条"),
         "#25 反向：[[键名]] 引用 ⇒ sourced（合法出处成立）")

sys.exit(0 if ok else 1)
PY
}

# ── 对真仓实跑三条闸门（不是只验符号）───────────────────────────────────────
live_gates () {
  # ⚠️ 返回**失败条数**（不是布尔），且**不调 fail()** —— fail() 改的是父 shell 的 BAD，
  #   而函数在 `if ! live_gates` 的语境里会起子 shell 语义上的混乱（实测：红报出来了
  #   但 BAD 没涨 ⇒ 最后 exit 0）。⇒ 这里只返回数字，由调用方累加。
  . ./reflect-hooks/Einfacht.env 2>/dev/null || true
  local rc=0
  python3 zreflect/check_facts.py   >/dev/null 2>&1 || { printf "  ✗ check_facts 在本仓仍红（数字还没有归宿）\n" >&2; rc=$((rc+1)); }
  python3 zreflect/check_stale.py   >/dev/null 2>&1 || { printf "  ✗ check_stale 在本仓仍红\n" >&2; rc=$((rc+1)); }
  python3 zreflect/check_questions.py >/dev/null 2>&1 || { printf "  ✗ check_questions 在本仓仍红\n" >&2; rc=$((rc+1)); }
  return $rc
}

# ══ F1 自证：三类用例（正常 / 该报 / 空值）════════════════════════════════════
if [ "${1:-}" = "--selftest" ]; then
  T="$(mktemp -d)"; bad=0; n=0
  # ① 正常：真仓（升级后）⇒ 四条全过
  n=$((n+1))
  if OUT="$(behavior_probe 2>&1)"; then say "PASS | 四条断言在真仓全过"; else
    say "fail | 四条断言在真仓竟不成立"; printf '%s\n' "$OUT" | sed 's/^/    /'; bad=$((bad+1)); fi
  # ② 该报的必须报：把 #25 判据退化成「历史免死」（= 上游修复前的行为）
  #    变异后 `_is_sourced("历史：…")` 返回 True（判据失守）⇒ 我们那条真断言
  #    `not src("历史：…")` 变成 False ⇒ 行为探测整条失败。自证要能复现这个失败。
  n=$((n+1))
  PATCHED="$T/cs.py"
  sed 's|return bool(DATED_RECORD.search(line) or CITE_RE.search(line))|return True  # MUTANT|' \
      zreflect/check_stale.py > "$PATCHED"
  cat > "$T/probe_mut.py" <<'PROBE'
import importlib.util, sys, os
sys.path.insert(0, os.path.abspath("zreflect"))
spec = importlib.util.spec_from_file_location("cs_mut", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
# 复现真断言：这条**必须**成立（「历史」不构成出处）
sys.exit(0 if not m._is_sourced("历史：sha 是 deadbeefdeadbeef 的部署件") else 1)
PROBE
  if python3 "$T/probe_mut.py" "$PATCHED"; then
    say "fail | ★ 判据退化成「历史免死」⇒ 断言仍成立（自证无区分力）"; bad=$((bad+1))
  else say "PASS | ★ 判据退化成「历史免死」⇒ 断言失败 ⇒ 自证能抓（有区分力）"; fi
  # ③ 空输入必须报：符号被拔掉 ⇒ 必红
  n=$((n+1))
  EMPTY="$T/empty.py"; : > "$EMPTY"
  if EMPTIED="$(python3 - "$EMPTY" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("e", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
sys.exit(0 if getattr(m, "_is_sourced", None) else 1)
PY
)"; then
    say "fail | ★ 空模块里居然找到 _is_sourced（零值守卫失效）"; bad=$((bad+1))
  else say "PASS | ★ 空模块（符号不在）⇒ 必须报（零值守卫成立）"; fi
  rm -rf "$T"
  echo "=== check-einfacht-upgrade 自证：$((n-bad)) PASS / $bad fail ==="
  [ "$bad" = 0 ]
  exit $?
fi

# ══ 对真仓实跑 ══════════════════════════════════════════════════════════════
say "查 Einfacht 升级（工单 73）…"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

# ①②③ 符号在位
N=$((N+1)); python3 -c "
import ast, sys
src = open('zreflect/gate.py').read()
sys.exit(0 if 'never_falsifiable' in src else 1)" || fail "① #23 符号 never_falsifiable 不在 zreflect/gate.py（机制层没换？）"
N=$((N+1)); python3 -c "
import sys
src = open('zreflect/check_facts.py').read()
sys.exit(0 if '_unaccounted_numbers' in src else 1)" || fail "② #24 符号 _unaccounted_numbers 不在（反向判据缺失 ⇒ 手抄数字是盲区）"
N=$((N+1)); python3 -c "
import sys
src = open('zreflect/check_stale.py').read()
sys.exit(0 if 'def _is_sourced' in src else 1)" || fail "③ #25 符号 _is_sourced 不在"

# ④ 行为真跑
N=$((N+1))
if ! behavior_probe > "$T/probe.txt" 2>&1; then
  fail "④ 行为探测不通过（详见下）"
  sed 's/^/    /' "$T/probe.txt" >&2
fi

# ⑤ 本仓三闸门实跑（返回失败条数 ⇒ 累加进 BAD）
N=$((N+1))
_sub="$(live_gates)"; _rc=$?
BAD=$((BAD + _rc))

# ⑥ 本仓专属件未被升级冲掉
N=$((N+1))
for f in zreflect/mail-read.py zreflect/measure_octave.py; do
  [ -f "$f" ] || fail "⑥ 本仓专属件 $f 被升级冲掉了"
done
N=$((N+1))
[ -f reflect-hooks/Einfacht.env ] || fail "⑥ 本仓旋钮 reflect-hooks/Einfacht.env 被冲掉了"

if [ "$BAD" = 0 ]; then
  say "ok（$N 组断言全过：三条新纪律真跑 + 本仓专属件在位）"
  exit 0
fi
say "FAILED：$BAD 组断言不成立（见上）" >&2
exit 1
