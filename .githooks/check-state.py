#!/usr/bin/env python3
# Octave-Full-Wasm — STATE 陈旧断言检查（活状态段落不得与产物矛盾）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

"""查 HANDOFF.md 的**活状态段落**里有没有与产物矛盾的断言。

## 为什么只查"活状态"

2026-09-24 起 HANDOFF 拆成两份：**`HANDOFF.md` = 活状态**（本工具只查它）与
**`HISTORY.md` = 历史**（append-only；`§5.x`/`§9`/`§10` 都在那边，本工具完全不看 ——
那里的数字是"当时如此"，拿来跟今天的产物比毫无意义，硬查只会逼人把历史改成现在，那就毁了记录）。
在 `HANDOFF.md` 里仍保留 `§5`/`§9`/`§10` 编号的豁免（现在的 `§5` 只是一段"历史已拆到
`HISTORY.md`"的指路），所以判定照旧：**文件头部（第一个 `## ` 之前）+ 除 5/9/10 之外的章节**，
也就是"现在是什么状态"的那部分。这条约定写在两份文档的开头，改口径要同时改那边。

## 规则（都是今天真实烂过的）

  L1 **部署 sha**：活状态里凡是 `sha` 后面跟的十六进制串，必须是当前部署件的
     （wasm/js/data 三者之一）。烂法：换了带 GL 的构建，头部还挂着 `bac48adb…`。
  L2 **套件数**：活状态里 `N 套 … M 项/PASS` 必须等于最近一次**全绿**回归。
     烂法："31 套 784" 与实测 "32 套 848" 同时存在（README/HANDOFF/DEPLOY 各一份）。
  L3 **退役名**：活状态里不得出现已退役组件名（当前只剩 `osmesa`）。
     烂法：OSMesa 退役后，正文与测试注释里仍有未标注历史的后端引用。
  L4 **待办标记**：活状态里出现 `未上线` / `还没上` / `未做` 时，点出所在行。
     烂法：早就上线了，§8 还写着"仍未上 8761"。

用法：
  check-state.py           # 违规即 exit 1（pre-commit / pre-push 用）
  check-state.py --list    # 只列不改、永远 exit 0（人工巡检用）
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import state_facts as F  # noqa: E402
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "build", "lib"))
from gate import Gate, selftest          # noqa: E402

DOC = "STATE.md"
HISTORICAL_SECTIONS = ("5", "9", "10")   # 见文件头：这些是 append-only 的历史记录
RETIRED = ("osmesa",)                    # 退役组件名（加新名字时同步 HANDOFF 开头那段）

SHA_NEAR = re.compile(r"sha(?:256)?[^0-9a-f]{0,12}`?([0-9a-f]{8,64})", re.I)
SUITE = re.compile(r"(\d+)\s*套[^\n]{0,16}?([\d,]+)\s*(?:项|PASS)")
PENDING = re.compile(r"未上线|还没上|没上 8761|仍未上")
# 一条**带出处**的记录（指名了提交或某天的交付包）就是历史条目，不是"当前状态"断言：
# 例如 §2.1 的批次表里 "包内 14 套 402 项全绿 | dist/...-20260921" —— 那批次当时确实如此。
# ⚠️ 只认这两种**明确**出处：交付包名（含日期）与**反引号里的 commit sha**。
#    第一版还加了一个宽松的 `\b[0-9a-f]{7,40}\b`，结果"一条含过期 sha 的假断言"被当成
#    "带出处的历史条目"整行豁免 —— L2 就这么漏过去了（实测）。
DATED_RECORD = re.compile(r"octave-full-wasm-site-\d{8}|`[0-9a-f]{7,40}`")
# 退役名只在**独立成词**时才算问题：`graphics-osmesa` 分支名、`NOTES-p5-osmesa.md` 文件名
# 都是在**指路**（历史留档），不是"当前后端"的断言。
RETIRED_WORD = re.compile(r"(?<![-\w])osmesa(?![-\w.])", re.I)
# **行内历史标记**：活状态段落里引用旧值是允许的，只要该行**自己说清是历史**
# （这套约定写在 HANDOFF 开头）。没有这个出口，人只能把历史删掉或把章节挪走，
# 那反而毁掉记录 —— 而机制的目的是"不许**悄悄**留在那儿当现状"。
HIST_MARK = re.compile(r"历史|退役|留档|曾经的|当年的|当时的|本批之前|之前那份|那条线已"
                        r"|收口前|当时")


def section_is_living(heading):
    """只有**明确**的历史章节与机器块附录不算活状态；其余（含无编号的章节）一律算。
    这条"默认从严"是踩出来的：第一版只把"带数字且不在 (5,9,10) 里"的章节当活状态，
    于是"## 附 · …"之类无编号的段落继承了上一节的状态判定 —— 往那儿塞一条过时断言
    检查器就视而不见。"""
    m = re.match(r"^##\s+([0-9]+)", heading)
    if m:
        return m.group(1) not in HISTORICAL_SECTIONS
    if heading.startswith("## 附"):
        return False      # 文末那个机器维护的 AUTO:STATE 区块（由 update-handoff.py 负责）
    return True


def living_text(text):
    """文件头部 + 活状态章节。返回 [(行号, 行, 是否活状态), …]。"""
    out = []
    lines = text.split("\n")
    keep = True
    for i, ln in enumerate(lines):
        if re.match(r"^##\s+", ln):
            keep = section_is_living(ln)
        out.append((i + 1, ln, keep))
    return out


def check_living(text, current_shas, sweep):
    """把**活状态**里与产物矛盾的断言找出来。返回 `(problems, notes)`。

    ★ 输入全部**注入**（文档文本 + sha 表 + 回归事实）—— 这样自证才能在合成输入上跑，
    而不是只能对着真仓库跑（F1 的要求：闸门的逻辑必须能在夹具上被证伪）。
    """
    problems, notes = [], []
    # ⚠️ 只数**非空行**：空文档在 `living_text()` 里仍会产出一行（空行）——
    #    第一版守卫只判 `if not rows`，于是"空文档"照样通过（自证用例当场抓到）。
    rows = [r for r in living_text(text) if r[2] and r[1].strip()]
    if not rows:
        problems.append((0, "零值守卫", "活状态里**没有一行非空文本** ⇒ 闸门空转",
                         "文档为空/结构变了？先确认 living_text() 还能认出活状态"))
        return problems, notes
    sha_hits = suite_hits = 0
    for lineno, line, _ in rows:
        if HIST_MARK.search(line):
            # 行内标了历史标记的行是允许的（见文件头那段约定）
            continue
        for tok in SHA_NEAR.findall(line):
            sha_hits += 1
            if current_shas and not any(tok.startswith(s[:len(tok)]) or s.startswith(tok)
                                        for s in current_shas.values()):
                problems.append((lineno, "L1 部署 sha",
                                 "`%s` 不是当前任一部署件的 sha" % tok[:16], line.strip()[:100]))
            elif not current_shas:
                notes.append((lineno, "L1 跳过", "读不到部署件 ⇒ **无法核对 sha**", line.strip()[:80]))
        m = SUITE.search(line)
        if m:
            suite_hits += 1
        if m and sweep.get("ok") and not DATED_RECORD.search(line):
            suites, total = int(m.group(1)), int(m.group(2).replace(",", ""))
            if (suites, total) != (sweep["suites"], sweep["pass"]):
                problems.append((lineno, "L2 套件数",
                                 "写的是 %d 套 / %d 项，最近一次全绿是 %d 套 / %d 项"
                                 % (suites, total, sweep["suites"], sweep["pass"]),
                                 line.strip()[:100]))
        elif m and not sweep.get("ok"):
            # ★ F1：以前这里是**静默**跳过（`if m and sweep.get("ok")`）—— 事实读不到时
            #   整类检查悄悄消失。现在至少要说出来。
            notes.append((lineno, "L2 跳过", "读不到最近一次全绿回归 ⇒ **无法核对套件数**",
                          line.strip()[:80]))
        for name in RETIRED:
            if RETIRED_WORD.search(line):
                problems.append((lineno, "L3 退役名",
                                 "活状态里出现 %s（历史记录请放进 §5/§9/§10）" % name,
                                 line.strip()[:100]))
        m = PENDING.search(line)
        if m and current_shas:
            notes.append((lineno, "L4 待办标记",
                          "`%s` —— 若已上线请改掉（机器块里有当前状态）" % m.group(0),
                          line.strip()[:100]))
    # ★ 零值守卫 2（F1）：两条事实链**都**读不到 ⇒ 这个闸门此刻什么也证明不了 ⇒ 红
    if not current_shas and not sweep.get("ok"):
        problems.append((0, "闸门空转", "部署件与回归事实**都**读不到 ⇒ 本闸门当前零覆盖",
                         "先把事实来源接上（或明确说明为什么允许空跑）"))
    # ★ F2 收尾（2026-09-27）：L1/L2 的**可查对象**消失了 —— 这是设计行为（数字只在机器块里
    #   生产，正文不许手抄），但**必须说出来**：否则"规则还在、只是没东西可查"会伪装成"通过"。
    #   块本身的数字由 `update-handoff.py`（生成）与 `check-facts.py`（核对）管。
    if sha_hits == 0 or suite_hits == 0:
        which = " / ".join([n for n, c in (("L1 sha", sha_hits), ("L2 套件数", suite_hits)) if c == 0])
        notes.append((0, "覆盖说明",
                      "活状态正文里没有 %s 的可查对象（F2 之后数字只在 AUTO 块与 FACTS 台账里）"
                      "⇒ 这两条规则本次没查东西，**不是**它们通过了" % which,
                      "块与台账的一致性由 check-facts.py 管"))
    return problems, notes


def main():
    os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    text = open(DOC, encoding="utf-8").read()
    site = F.site_facts()
    sweep = F.sweep_facts()
    current_shas = {n: f["sha256"] for n, f in site["files"].items()} if site["ok"] else {}
    # ★ 四格车道（工单 30/33，2026-10-02）：子目录档的 wasm **也是部署件**——
    #   不收进来，正文里写 `w64` 档的 sha（如 `ddec34a0…`）会被 L1 当成“不是任一部署件的 sha”
    #   误报（实测：w64+线程版 OpenBLAS 发运那一批）。 lane 目录存在才收。
    if site["ok"]:
        for _lane in ("threads", "w64", "w64-base"):
            _lp = os.path.join(F.SITE, _lane, "octave.wasm")
            if os.path.isfile(_lp):
                current_shas[_lane + "/octave.wasm"] = F._sha256(_lp)
    problems, notes = check_living(text, current_shas, sweep)

    show = lambda rows: [print("  %s: [%s] %s\n      %s" % (l, k, msg, txt)) for l, k, msg, txt in rows]
    if notes:
        print("STATE 提示（%d 条，不拦提交）：" % len(notes))
        show(notes)
    if problems:
        print("STATE 陈旧断言（%d 条，**必须改**）：" % len(problems), file=sys.stderr)
        for l, k, msg, txt in problems:
            print("  %s: [%s] %s\n      %s" % (l, k, msg, txt), file=sys.stderr)
        print("\n要么把断言改成当前事实（数字可从文中 AUTO:STATE 区块里取），"
              "要么把它移进 HISTORY.md。", file=sys.stderr)
        return 0 if "--list" in sys.argv else 1
    print("STATE 活状态断言与产物一致")
    return 0


# ── 自证（F1）───────────────────────────────────────────────────────────────
_SHA_A = "a" * 64
_SHA_B = "b" * 64
_SWEEP_OK = {"ok": True, "suites": 43, "pass": 1076}
_HEAD = "# HANDOFF\n\n## 0. 铁律\n\n"


def _nprob(text, shas=None, sweep=None):
    p, _ = check_living(text, shas if shas is not None else {"wasm": _SHA_A},
                        sweep if sweep is not None else _SWEEP_OK)
    return len(p)


def _notes(text, shas=None, sweep=None):
    _, n = check_living(text, shas if shas is not None else {"wasm": _SHA_A},
                        sweep if sweep is not None else _SWEEP_OK)
    return n


CASES = [
    ("合成文档 + 一致的 sha/套件数 ⇒ 不报",
     lambda: _nprob(_HEAD + "wasm sha `%s…`，全量 43 套 / 1076 项全绿\n" % _SHA_A[:16]) == 0),
    ("陈旧 sha ⇒ 必须报（L1）",
     lambda: _nprob(_HEAD + "wasm sha `%s…`\n" % _SHA_B[:16]) >= 1),
    ("陈旧套件数 ⇒ 必须报（L2）",
     lambda: _nprob(_HEAD + "全量 31 套 / 784 项全绿\n") >= 1),
    ("退役名 ⇒ 必须报（L3）",
     lambda: _nprob(_HEAD + "默认后端是 OSMesa\n") >= 1),
    ("行内标了历史标记 ⇒ 放行（这是约定，不是漏洞）",
     lambda: _nprob(_HEAD + "本批之前 wasm sha `%s…`\n" % _SHA_B[:16]) == 0),
    ("**空文档** ⇒ 必须报（零值守卫：闸门空转）", lambda: _nprob("") >= 1),
    ("**两条事实链都读不到** ⇒ 必须报（零值守卫 2）",
     lambda: _nprob(_HEAD + "全量 43 套 / 1076 项全绿\n", shas={}, sweep={"ok": False}) >= 1),
    ("★ 正文不写数字（F2 之后）⇒ 必须**声明** L1/L2 本次没有可查对象，不许静默通过",
     lambda: any(k == "覆盖说明" for _, k, _, _ in _notes(_HEAD + "数字见文末两个 AUTO 块。\n"))),
]


if __name__ == "__main__":
    sys.exit(selftest("check-handoff", CASES) if "--selftest" in sys.argv else main())
