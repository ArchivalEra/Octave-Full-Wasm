#!/usr/bin/env python3
# Octave-Full-Wasm — **翻案重现检测**（事实系统 F3，2026-09-26）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

"""查"已被推翻的断言"是不是又悄悄回到了活状态文档里。

## 为什么有它（实测代价）

本仓的"翻案"一直只是**散文**：没有索引，也没有任何东西会在被推翻的断言**重新出现**时报警。
实测到的：`build/113/PLAN-arch.md:36` 的"线程档在 Pages 上跑不起来"在**同一个文件**的 `:422`
被更正过（"那句是错的"），却一直留到 F3；而 HANDOFF 里还有它的一份副本。
更早的同类事故：`accept-hdf5` 的一条断言靠裸子串匹配**假过了几个月**（修法是 check-wants 规则 C）。

## 规矩

`build/lib/retractions.json` 是台账（每条 = 一条已被推翻的断言 + 它为什么错 + 复跑证据）。
本闸门把每条 `text` 当**搜索串**在**活状态文档**里找：

  · 找到了、且该行**带更正标记**（已翻案/更正/是错的/误读/推翻/退役/历史…）⇒ 放行（那是"记录"）；
  · 找到了、**不带**标记 ⇒ **报错**（那是"它又回来当现状了"）；
  · `HISTORY.md` **不扫**（append-only 历史，保留原文是对的）。

三个可证伪点（`--selftest`）：
  ① 台账里的串出现在活文档且无标记 ⇒ 必须报；
  ② 同一条串带更正标记 ⇒ 必须放行；
  ③ **台账为空 ⇒ 必须报**（没人维护的台账 = 这个闸门空转）。

用法：check-retractions.py [--selftest] [--list]
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "build", "lib"))
from gate import Gate, root, run_quiet, selftest          # noqa: E402

LEDGER = "build/lib/retractions.json"
# 扫哪些文件（"活状态"面）。HISTORY.md 故意不在列（append-only 历史）。
LIVE_DOCS = ("HANDOFF.md", "AGENTS.md", "CONTEXT.md", "DEPLOY.md",
             "build/113/PLAN-arch.md", "build/113/PLAN-threads.md")
# HANDOFF 里 §5/§9/§10 是历史章节（与 check-handoff.py 同一约定：那边是历史，不查）
HISTORICAL_SECTIONS = ("5", "9", "10")
MARK = re.compile(r"已翻案|翻案|更正|是错的|错话|误读|推翻|退役|历史|留档|曾经|当时|之前那份")


def living_part(path, text):
    """HANDOFF 只取活状态段落；其余文档整体算活状态。"""
    if not path.endswith("HANDOFF.md"):
        return text
    out, keep = [], True
    for ln in text.split("\n"):
        m = re.match(r"^##\s+([0-9]+)", ln)
        if m:
            keep = m.group(1) not in HISTORICAL_SECTIONS
        elif ln.startswith("## 附"):
            keep = False
        if keep:
            out.append(ln)
    return "\n".join(out)


def check(g, ledger, docs):
    """`ledger`：台账 dict；`docs`：{路径: 文本}（**注入** ⇒ 能在夹具上自证）。"""
    if not g.require_nonempty(ledger.get("retractions") or [], "翻案台账条目（build/lib/retractions.json）",
                             "台账空 = 没人维护 = 这个闸门空转（至少写一条真实翻案）"):
        return g
    if not g.require_nonempty(docs, "活状态文档（扫描面）",
                             "一个文档都没读到 ⇒ 本闸门什么也没查"):
        return g
    n_hits = 0
    for r in ledger["retractions"]:
        needle = (r.get("text") or "").strip()
        if not needle:
            g.problem("台账条目缺 text", r.get("id", "?"))
            continue
        for path, text in docs.items():
            lines = living_part(path, text).split("\n")
            for i, line in enumerate(lines, 1):
                if needle in line:
                    n_hits += 1
                    # ⚠️ 判标记看**行窗口（±2 行）**：一条"翻案记录"的常态是"先引原文、下一行说它错"
                    #    —— 只看本行会把记录本身误判成重现（F3 首跑就撞上了：我自己的 §2 F3 记录被误报）。
                    window = "\n".join(lines[max(0, i - 3):i + 2])
                    if MARK.search(window):
                        g.note("%s:%d 提到 `%s`，但**带更正标记** ⇒ 放行（那是记录）" % (path, i, needle))
                    else:
                        g.problem("翻案重现（%s）" % r.get("id", "?"),
                                  "%s:%d 出现已被推翻的断言 `%s` 且**无更正标记**\n      原文：%s"
                                  "\n      为什么错：%s\n      证据：%s"
                                  % (path, i, needle, line.strip()[:90],
                                     r.get("why", ""), r.get("evidence", "")))
    if n_hits == 0:
        g.note("活状态文档里没有出现台账中的任何断言（%d 条在册）" % len(ledger["retractions"]))
    return g


def read_inputs():
    with open(os.path.join(root(), LEDGER), encoding="utf-8") as fh:
        ledger = json.load(fh)
    docs = {}
    for rel in LIVE_DOCS:
        p = os.path.join(root(), rel)
        if os.path.exists(p):
            with open(p, encoding="utf-8", errors="replace") as fh:
                docs[rel] = fh.read()
    return ledger, docs


def main():
    g = Gate("翻案重现检测", list_mode="--list" in sys.argv)
    try:
        ledger, docs = read_inputs()
    except (OSError, ValueError) as e:
        g.problem("读不到台账", "%r" % (e,))
        return g.finish()
    check(g, ledger, docs)
    return g.finish()


def _np(ledger, docs):
    g = Gate("x")
    run_quiet(check, g, ledger, docs)
    return len(g.problems)


_LED = {"retractions": [{"id": "T-1", "text": "月亮是方的", "why": "实测是圆的", "evidence": "x"}]}
CASES = [
    ("活文档里没有该断言 ⇒ 不报", lambda: _np(_LED, {"AGENTS.md": "今天天气不错\\n"}) == 0),
    ("★ 该断言**重新出现**且无标记 ⇒ 必须报", lambda: _np(_LED, {"AGENTS.md": "结论：月亮是方的\\n"}) == 1),
    ("带更正标记出现 ⇒ 放行（那是记录）",
     lambda: _np(_LED, {"AGENTS.md": "已翻案：以前说『月亮是方的』是错的\\n"}) == 0),
    ("HISTORY 类历史章节不扫（HANDOFF §5）",
     lambda: _np(_LED, {"HANDOFF.md": "## 5. 历史\\n月亮是方的\\n"}) == 0),
    ("**台账为空** ⇒ 必须报（零值守卫）", lambda: _np({"retractions": []}, {"AGENTS.md": "x"}) == 1),
    ("**扫描面为空** ⇒ 必须报（零值守卫）", lambda: _np(_LED, {}) == 1),
]


if __name__ == "__main__":
    sys.exit(selftest("check-retractions", CASES) if "--selftest" in sys.argv else main())
