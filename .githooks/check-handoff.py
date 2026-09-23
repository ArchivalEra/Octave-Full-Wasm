#!/usr/bin/env python3
# Octave-Full-Wasm — HANDOFF 陈旧断言检查（活状态段落不得与产物矛盾）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

"""查 HANDOFF.md 的**活状态段落**里有没有与产物矛盾的断言。

## 为什么只查"活状态"

HANDOFF 里 §5.x / §9 / §10 是**历史记录（append-only）** —— 那些数字是"当时如此"，
拿来跟今天的产物比毫无意义，硬查只会逼人把历史改成现在（那就毁了记录）。
所以本工具只查：**文件头部（第一个 `## ` 之前）+ 除 5/9/10 之外的章节**，
也就是"现在是什么状态"的那部分。这条约定写在 HANDOFF 开头，改口径要同时改那里。

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
  check-handoff.py           # 违规即 exit 1（pre-commit / pre-push 用）
  check-handoff.py --list    # 只列不改、永远 exit 0（人工巡检用）
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import handoff_facts as F  # noqa: E402

DOC = "HANDOFF.md"
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
HIST_MARK = re.compile(r"历史|退役|留档|曾经的|当年的|本批之前|之前那份|那条线已")


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


def main():
    os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    text = open(DOC, encoding="utf-8").read()

    site = F.site_facts()
    sweep = F.sweep_facts()
    problems, notes = [], []

    current_shas = {}
    if site["ok"]:
        current_shas = {n: f["sha256"] for n, f in site["files"].items()}

    for lineno, line, keep in living_text(text):
        if not keep or HIST_MARK.search(line):
            # 跳过两类：① 历史章节（§5/§9/§10）；② 行内标了历史标记的行。
            # ⚠️ 曾经这里连**引用块（`>` 开头）**整段跳过，那是个洞：头部的状态行
            #    （"wasm sha …、全量 N 套 M 项"）正是最该被查的地方，而它恰好是引用块。
            #    改成只认 HIST_MARK 之后，头部那句也进检查了（"之前/历史/退役"仍是出口）。
            continue
        for tok in SHA_NEAR.findall(line):
            if current_shas and not any(tok.startswith(s[:len(tok)]) or s.startswith(tok)
                                        for s in current_shas.values()):
                problems.append((lineno, "L1 部署 sha",
                                 f"`{tok[:16]}` 不是当前任一部署件的 sha", line.strip()[:100]))
            elif not current_shas:
                notes.append((lineno, "L1 跳过", "读不到部署件，无法核对 sha", line.strip()[:80]))
        m = SUITE.search(line)
        if m and sweep.get("ok") and not DATED_RECORD.search(line):
            suites, total = int(m.group(1)), int(m.group(2).replace(",", ""))
            if (suites, total) != (sweep["suites"], sweep["pass"]):
                problems.append((lineno, "L2 套件数",
                                 f"写的是 {suites} 套 / {total} 项，最近一次全绿是 "
                                 f"{sweep['suites']} 套 / {sweep['pass']} 项", line.strip()[:100]))
        for name in RETIRED:
            if RETIRED_WORD.search(line):
                problems.append((lineno, "L3 退役名",
                                 f"活状态里出现 {name}（历史记录请放进 §5/§9/§10）",
                                 line.strip()[:100]))
        m = PENDING.search(line)
        if m and site["ok"]:
            notes.append((lineno, "L4 待办标记",
                          f"`{m.group(0)}` —— 若已上线请改掉（机器块里有当前状态）",
                          line.strip()[:100]))

    show = lambda rows: [print(f"  {l}: [{k}] {msg}\n      {txt}") for l, k, msg, txt in rows]
    if notes:
        print(f"HANDOFF 提示（{len(notes)} 条，不拦提交）：")
        show(notes)
    if problems:
        print(f"HANDOFF 陈旧断言（{len(problems)} 条，**必须改**）：", file=sys.stderr)
        for l, k, msg, txt in problems:
            print(f"  {l}: [{k}] {msg}\n      {txt}", file=sys.stderr)
        print("\n要么把断言改成当前事实（数字可从文中 AUTO:STATE 区块里取），"
              "要么把它移到 §5/§9/§10 的历史记录里。", file=sys.stderr)
        return 0 if "--list" in sys.argv else 1
    print("HANDOFF 活状态断言与产物一致")
    return 0


if __name__ == "__main__":
    sys.exit(main())
