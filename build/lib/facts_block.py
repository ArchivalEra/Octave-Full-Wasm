#!/usr/bin/env python3
# Octave-Full-Wasm — 事实台账 → 活状态文档的机器块（事实系统 F2，2026-09-27）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

"""`AUTO:FACTS` 块的渲染与识别 —— **生成器与闸门共用这一处**。

为什么单独一个模块：`build/facts.py`（生成）与 `.githooks/check-facts.py`（核对）
必须用同一套渲染，否则"块对不对"两边口径分叉 —— 那正是
`.githooks/handoff_facts.py` 文件头写过的那条教训（update-handoff 与 check-handoff
共用事实采集，才不会一个说新鲜一个说过期）。

**这里没有 IO**：`render_block()` 是纯函数（台账 → 文本），所以两个调用方都能自证，
`build/gates-selftest.sh` 也能给它合成输入。

设计要点：
  · **数字只在这里生产**：活状态文档正文引用 `build/FACTS.json` 的键名，不手抄数字。
  · **空台账必须显形**：渲染成一句"台账为空"，绝不渲染成一张没有行的表 ——
    "没有事实"与"事实都合规"在视觉上不能长得一样（`glue-selftest 0/0 算全过` 就是这形状）。
  · **块要可幂等重算**：同一份台账渲染两次逐字节相同（否则 pre-commit 每跑一次都改文件）。
"""
import re

BLOCK_BEGIN = "<!-- AUTO:FACTS -->"
BLOCK_END = "<!-- /AUTO:FACTS -->"
# 文档正文**引用事实**的写法：`build/FACTS.json` 的 `wasm_v128`
CITATION = re.compile(r"FACTS\.json`?\s*的\s*`([A-Za-z_][A-Za-z0-9_]*)`")
# 块标记的通用形式（AUTO:STATE 也用同一套标记，正文扫描要把两种块都摘掉）
ANY_BLOCK = re.compile(r"<!--\s*AUTO:[A-Z]+\s*-->.*?<!--\s*/AUTO:[A-Z]+\s*-->", re.S)
HEX64 = re.compile(r"^[0-9a-f]{64}$")


def fmt_val(v):
    """块里怎么显示一个值。sha 截断显示（全值在 FACTS.json 里，块不是查询入口）。"""
    if isinstance(v, bool):
        return "是" if v else "否"
    if isinstance(v, str) and HEX64.match(v):
        return "`%s…`" % v[:16]
    return "**%s**" % v


def render_block(ledger):
    """把台账渲染成 markdown 块。纯函数 ⇒ 可自证、可 `--check`。"""
    f = (ledger or {}).get("facts") or {}
    L = [BLOCK_BEGIN,
         "> 本区块由 `build/facts.py --render-doc HANDOFF.md` 从 `build/FACTS.json` 渲染，**不要手改**"
         "（pre-commit 会重算并 `git add`）。",
         "> **活状态文档里的「测出来的数字」只在这里生产**：正文要引用就写 `build/FACTS.json` 的键名"
         "（例如 `wasm_v128`），别手抄数字。",
         "> `.githooks/check-facts.py` 三条规则：块必须与台账一致 / 正文不许出现裸数字 / 引用的键必须存在。",
         ""]
    if not f:
        L += ["**⚠️ 台账为空：这不是「没有事实」，是「数字没有产地」** —— 先跑 `python3 build/facts.py`"
              "（它读持久盘产物；换了机器/没挂盘时它量不到东西，那就**别**渲染，"
              "`--check` 会报，而不是给一张空表）。", BLOCK_END]
        return "\n".join(L)
    L += ["| 键 | 值 | 复跑命令 |", "|---|---|---|"]
    for k in sorted(f):
        note = ("（%s）" % f[k]["note"]) if f[k].get("note") else ""
        # ⚠️ 复跑命令里可能有 `|`（`link-web.sh` 那条就有）—— 不转义会把表格列切碎
        cmd = (f[k].get("cmd", "") or "").replace("|", "\\|")
        L.append("| `%s` | %s%s | `%s` |" % (k, fmt_val(f[k].get("value")), note, cmd))
    L += ["", "台账生成时间 `%s`；每条的值/出处/复跑命令都在 `build/FACTS.json` 里。"
          % ledger.get("generated", "?"), BLOCK_END]
    return "\n".join(L)


def block_body(ledger):
    """块的**内容**（不带标记）—— 核对时只比内容，标记谁写的都一样。"""
    return render_block(ledger).split(BLOCK_BEGIN, 1)[1].split(BLOCK_END, 1)[0]


def strip_blocks(text):
    """摘掉所有 `AUTO:*` 块 ⇒ 剩下的才是"人写的正文"。
    正文规则（不许出现裸数字）只对这部分生效，否则块里的数字会把自己判红。"""
    return ANY_BLOCK.sub("", text)


def extract_block(text):
    """取出文档里的 `AUTO:FACTS` 块内容；没有标记返回 None（**不是空串** ——
    "没有块"与"块是空的"必须能区分）。"""
    if BLOCK_BEGIN not in text or BLOCK_END not in text:
        return None
    return text.split(BLOCK_BEGIN, 1)[1].split(BLOCK_END, 1)[0]
