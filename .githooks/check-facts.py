#!/usr/bin/env python3
# Octave-Full-Wasm — **事实一致性闸门**（事实系统 F2，2026-09-26）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

"""查活状态文档里的"测出来的数字"是不是**与实测一致**。

## 为什么是"一致性"而不是"消灭重复"

本仓的数字被手抄在 3–6 处（`22 个环境变量` 6 处、`4752` 4 处、`43 套 / 1076 PASS` 5 处、
`1ed3e528…` 6 处），而没有任何东西校验它们 —— 已经烂掉四处：`703` vs `710`（导出名字数）、
`13` vs `19` 与 `23` vs `19`（探针项数）、`65/65` vs `64 PASS`（accept-p5-graphics）。
把每条都改成"引用键"要动一堆文档；**先做到"重复必须与实测一致"**就能把上面那类全部按住。

## 判据

`build/FACTS.json`（由 `build/facts.py` **量**出来，每条带复跑命令）是唯一真值。
本闸门按**每条事实的正则**去活状态文档里找同一个数字：

  · 找到的**等于**实测 ⇒ 放行；
  · 找到的**不等于**实测 ⇒ 报错（带日期/历史标记的行例外 —— 那是记录，不是现状）；
  · 一条事实在文档里**一次都没出现** ⇒ 只记 note（并打印命中数，这样"正则失效"会显形）。

用法：check-facts.py [--selftest] [--list]
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "build", "lib"))
from gate import Gate, root, run_quiet, selftest          # noqa: E402

FACTS = "build/FACTS.json"
LIVE_DOCS = ("HANDOFF.md", "AGENTS.md", "README.md", "CONTEXT.md", "DEPLOY.md",
             "build/113/PLAN-arch.md")
MARK = re.compile(r"历史|退役|留档|当时|曾经|之前|已翻案|更正|是错的|误读|实测复跑|旧版|上一个提交|回退点|基线")
HISTORICAL_SECTIONS = ("5", "9", "10")

# 每条事实的**文档规则**：正则必须把要核的数捕在第 1 组（第二组可选，用于成对数字如"43 套 / 1076"）
RULES = {
    # ⚠️ 收紧：数字前**不许是字母**（否则 `sha256` 里的 256 会被当成 v128 数 —— F2 首跑踩过）
    "wasm_v128": re.compile(r"v128[^\d\n]{0,16}(?<![A-Za-z])(\d{2,5})(?!\d)"),
    "exported_functions": re.compile(r"导出\s*(\d+)\s*个名字"),
    "env_vars": re.compile(r"(\d+)\s*个环境变量"),
    "accept_suites": re.compile(r"(\d+)\s*套\s*/\s*([\d,]+)\s*(?:PASS|项)"),
}


def living_part(path, text):
    """HANDOFF 只取活状态段落（§5/§9/§10 与文末 AUTO 区块是历史/机器块）。"""
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


def check(g, facts, docs):
    f = facts.get("facts") or {}
    if not g.require_nonempty(f, "事实台账（build/FACTS.json）",
                             "台账空 ⇒ 这个闸门空转（先跑 python3 build/facts.py）"):
        return g
    if not g.require_nonempty(docs, "活状态文档（扫描面）"):
        return g

    # ① sha 类事实：文档里 `sha … <hex>` 必须前缀匹配某个已登记 sha
    shas = [v["value"] for k, v in f.items() if k.endswith("_sha") and isinstance(v.get("value"), str)]
    if shas:
        near = re.compile(r"sha(?:256)?[^0-9a-f\n]{0,12}`?([0-9a-f]{8,64})", re.I)
        n = 0
        for path, text in docs.items():
            for i, line in enumerate(living_part(path, text).split("\n"), 1):
                for tok in near.findall(line):
                    n += 1
                    if not any(tok.startswith(s[:len(tok)]) or s.startswith(tok) for s in shas):
                        if MARK.search(line):
                            g.note("%s:%d sha `%s` 不是现役，但行内有历史标记 ⇒ 放行" % (path, i, tok[:16]))
                        else:
                            g.problem("sha 与实测不符",
                                      "%s:%d 写了 `%s`，而实测是 %s\n      %s"
                                      % (path, i, tok[:16], shas[0][:16], line.strip()[:90]))
        if n == 0:
            g.note("⚠️ sha 规则一次都没命中（正则失效？）")

    # ② 计数类事实：按规则逐条比
    for key, rx in RULES.items():
        if key not in f:
            continue
        want = f[key]["value"]
        hits = 0
        for path, text in docs.items():
            for i, line in enumerate(living_part(path, text).split("\n"), 1):
                m = rx.search(line)
                if not m:
                    continue
                hits += 1
                got = int(m.group(1).replace(",", ""))
                got2 = int(m.group(2).replace(",", "")) if m.lastindex and m.lastindex >= 2 else None
                want2 = f.get("accept_pass", {}).get("value") if key == "accept_suites" else None
                bad = (got != want) or (got2 is not None and want2 is not None and got2 != want2)
                if bad:
                    if MARK.search(line):
                        g.note("%s:%d 的 %s 与实测不同，但行内有历史标记 ⇒ 放行" % (path, i, key))
                    else:
                        g.problem("数字与实测不符（%s）" % key,
                                  "%s:%d 写的是 %s，实测是 %s（%s）\n      %s"
                                  % (path, i, m.group(0).strip(), want, f[key]["cmd"], line.strip()[:80]))
        g.note("%s：文档里命中 %d 处，实测 %s" % (key, hits, want))
    return g


def read_inputs():
    with open(os.path.join(root(), FACTS), encoding="utf-8") as fh:
        facts = json.load(fh)
    docs = {}
    for rel in LIVE_DOCS:
        p = os.path.join(root(), rel)
        if os.path.exists(p):
            with open(p, encoding="utf-8", errors="replace") as fh:
                docs[rel] = fh.read()
    return facts, docs


def main():
    g = Gate("事实一致性", list_mode="--list" in sys.argv)
    try:
        facts, docs = read_inputs()
    except (OSError, ValueError) as e:
        g.problem("读不到事实台账", "%r（先跑 python3 build/facts.py）" % (e,))
        return g.finish()
    check(g, facts, docs)
    return g.finish()


def _np(facts, docs):
    g = Gate("x")
    run_quiet(check, g, facts, docs)
    return len(g.problems)


_F = {"facts": {"wasm_v128": {"value": 4752, "cmd": "x"}, "env_vars": {"value": 23, "cmd": "x"}}}
_D = {"AGENTS.md": "v128 指令数 = 4752；23 个环境变量\n"}
CASES = [
    ("与实测一致 ⇒ 不报", lambda: _np(_F, _D) == 0),
    ("★ v128 写错 ⇒ 必须报", lambda: _np(_F, {"AGENTS.md": "v128 指令数 = 4700\n"}) == 1),
    ("★ 环境变量数写错（文档说 22、实测 23）⇒ 必须报",
     lambda: _np(_F, {"AGENTS.md": "22 个环境变量\n"}) == 1),
    ("带历史标记 ⇒ 放行（那是记录）",
     lambda: _np(_F, {"AGENTS.md": "本批之前 v128 是 4700\n"}) == 0),
    ("**台账为空** ⇒ 必须报（零值守卫）", lambda: _np({"facts": {}}, _D) == 1),
    ("**扫描面为空** ⇒ 必须报（零值守卫）", lambda: _np(_F, {}) == 1),
]


if __name__ == "__main__":
    sys.exit(selftest("check-facts", CASES) if "--selftest" in sys.argv else main())
