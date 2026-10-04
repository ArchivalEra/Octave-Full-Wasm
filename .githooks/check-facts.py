#!/usr/bin/env python3
# Octave-Full-Wasm — **事实闸门**（事实系统 F2，2026-09-26 起；2026-09-27 F2 收尾重写）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

"""活状态文档里的"测出来的数字"必须**只来自台账**，且台账必须**不过期**。

## 演进（为什么从"一致性"改成"唯一产地"）

第一版只做到"抄了就得抄对"：按每条事实的正则去文档里找同一个数字，不一致就报。
它按住了 `703` vs `710`、`22` vs `23` 那一类**抄错**。但它按不住两件事：
① 同一件事仍然抄在 3–6 处（`22 个环境变量` 曾 6 处；2026-09-29 已修掉该实例），改一次要改六处 —— 漏一处只是"没抄对"，
   闸门能拦，但**没人知道该去改哪几处**；
② 正则没覆盖的写法（换了个说法写同一个数）完全隐形。
所以收尾做法是：**数字只在 `HANDOFF.md` 的 `AUTO:FACTS` 块里生产一次**
（`build/facts.py --render-doc` 渲染，pre-commit 重算），正文要引用就写台账的**键名**。

## 三条规则 + 一条新鲜度

  A **正文不许出现裸数字**：活状态文档（HANDOFF/AGENTS/README/CONTEXT/DEPLOY）里，
    除 `AUTO:*` 机器块之外的部分出现"某条事实的那个数" ⇒ 报"手抄数字，改用键引用"。
  B **块必须与台账一致**：`AUTO:FACTS` 块的内容 ≠ `render_block(FACTS.json)` ⇒ 报（块过期）。
  C **引用的键必须存在**：正文写 `build/FACTS.json` 的 `键名`，键不在台账里 ⇒ 报（防止
    引用一个被删掉/写错的键 —— 那种引用看起来"有出处"，其实是假的）。
  D **台账不许过期**：台账里的部署件 sha 与**当前站点**（持久盘）不一致 ⇒ 报
    （promote 了新产物但没重跑 `build/facts.py` —— 这时文档会"与台账一致"却与产物不符）。
    读不到站点时只记 note（换了机器/没挂盘不是错）。

记录文档（`PLAN-arch.md` / `PLAN-threads.md`）**不适用 A**（它们是带日期的批次记录，
里面的数字是"当时如此"），但适用"抄了要与实测一致"这条老规则 —— 那正是它们最容易烂的地方。

用法：check-facts.py [--selftest] [--list]
"""
import json
import os
import re
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "..", "build", "lib"))
from facts_block import CITATION, block_body, extract_block, strip_blocks  # noqa: E402
from gate import Gate, root, run_quiet, selftest                          # noqa: E402

FACTS = "build/FACTS.json"
# 活状态文档（规则 A/C 生效）
LIVING_DOCS = ("STATE.md", "maintaince.md", "AGENTS.md", "README.md", "CONTEXT.md", "DEPLOY.md")
# 批次记录（只查"抄了要与实测一致"；它们是带日期的"当时如此"）
RECORD_DOCS = ("build/113/PLAN-arch.md", "build/113/PLAN-threads.md")
MARK = re.compile(r"历史|退役|留档|当时|曾经|之前|已翻案|更正|是错的|误读|实测复跑|旧版|上一个提交|回退点|基线")
HISTORICAL_SECTIONS = ("5", "9", "10")

# 每条事实的**文档规则**：正则把要核的数捕在第 1 组（第二组可选，用于成对数字如"43 套 / 1076"）
RULES = {
    # ⚠️ 收紧：数字前**不许是字母**（否则 `sha256` 里的 256 会被当成 v128 数 —— F2 首跑踩过）
    "wasm_v128": re.compile(r"v128[^\d\n]{0,16}(?<![A-Za-z])(\d{2,5})(?!\d)"),
    "exported_functions": re.compile(r"导出\s*(\d+)\s*个名字"),
    "env_vars": re.compile(r"(\d+)\s*个环境变量"),
    "accept_suites": re.compile(r"(\d+)\s*套\s*/\s*([\d,]+)\s*(?:PASS|项)"),
    # ★ 双档探针的 PASS 数（B6）：文档里写 `probe-lane.mjs` 的 PASS 就要与台账一致
    "probe_lane_pass": re.compile(r"probe-lane\.mjs[^\n]{0,24}?(\d+)\s*PASS"),
}


def living_part(path, text):
    """HANDOFF 只取活状态段落（§5/§9/§10 是历史；`## 附` 是机器块区）。"""
    if not path.endswith("STATE.md"):
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


FENCE_RE = re.compile(r"^\s*```")
INLINE_CODE_RE = re.compile(r"`[^`\n]+`")


def _naked_scan_lines(body):
    """裸数字判据要扫的行（Einfacht issue #3 ④，2026-10-01 移植）：
    **围栏代码块整段豁免、行内代码摘掉** —— 文档里的复跑命令天然带数字，
    把它当手抄值是误报。返回 [(原行号, 摘掉行内代码后的行)]；围栏开/关行本身不扫。"""
    in_fence = False
    out = []
    for i, line in enumerate(body.split("\n"), 1):
        if FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        out.append((i, INLINE_CODE_RE.sub("", line)))
    return out


def lines_of(text, path):
    """要查的行：摘掉机器块 + （HANDOFF）只留活状态段落。返回 [(行号, 行)]。"""
    body = strip_blocks(living_part(path, text))
    return list(enumerate(body.split("\n"), 1))


def check(g, facts, docs, records=None, live_shas=None):
    f = facts.get("facts") or {}
    if not g.require_nonempty(f, "事实台账（build/FACTS.json）",
                              "台账空 ⇒ 这个闸门空转（先跑 python3 build/facts.py）"):
        return g
    if not g.require_nonempty(docs, "活状态文档（扫描面）"):
        return g
    known = set(f)

    # ── 规则 B：HANDOFF 的块必须与台账一致 ────────────────────────────────────────
    ho = docs.get("STATE.md")
    if ho is None:
        g.problem("STATE.md 不在扫描面里", "块规则无从核对")
    else:
        cur = extract_block(ho)
        if cur is None:
            g.problem("STATE.md 缺 AUTO:FACTS 块标记",
                      "数字没有产地（块由 build/facts.py --render-doc 生成）")
        else:
            if cur != block_body(facts):
                g.problem("事实块与台账不一致（块过期）",
                          "STATE.md 的 AUTO:FACTS ≠ build/FACTS.json 的渲染结果"
                          "（跑 python3 build/facts.py --render-doc）")
            else:
                g.note("自动块与台账一致（%d 条事实）" % len(f))

    # ── 规则 A：活状态正文不许出现裸数字 ─────────────────────────────────────────
    a_hits = 0
    for path, text in docs.items():
        for key, rx in RULES.items():
            if key not in f:
                continue
            body = strip_blocks(living_part(path, text))
            for i, line in _naked_scan_lines(body):
                m = rx.search(line)
                if not m:
                    continue
                a_hits += 1
                if MARK.search(line):
                    g.note("%s:%d 有裸数字但行内标了历史 ⇒ 放行：%s" % (path, i, line.strip()[:60]))
                else:
                    g.problem("活状态文档里手抄了数字（%s）" % key,
                              "%s:%d 「%s」\n      改成引用台账的键名：`build/FACTS.json` 的 `%s`"
                              "（数字只在 STATE 的 AUTO:FACTS 块里生产）"
                              % (path, i, m.group(0).strip(), key))

    # ── 规则 C：正文引用的键必须存在 ─────────────────────────────────────────────
    c_hits = 0
    for path, text in docs.items():
        for i, line in lines_of(text, path):
            for key in CITATION.findall(line):
                c_hits += 1
                if key not in known:
                    g.problem("引用了不存在的事实键",
                              "%s:%d 写了 `build/FACTS.json` 的 `%s`，台账里没有这个键"
                              "（这样「有出处」是假的）" % (path, i, key))
    if c_hits == 0 and a_hits == 0:
        g.problem("事实引用机制空转",
                  "全部活状态文档里既没有键引用、也没有裸数字 ⇒ 要么文档不再写事实，"
                  "要么 RULES/CITATION 正则失效了（两条规则各 0 命中）")
    else:
        g.note("引用键 %d 处、裸数字 %d 处" % (c_hits, a_hits))

    # ── 规则（老）：记录文档里抄了的数字必须与实测一致 ─────────────────────────────
    for path, text in (records or {}).items():
        for key, rx in RULES.items():
            if key not in f:
                continue
            want = f[key]["value"]
            for i, line in lines_of(text, path):
                m = rx.search(line)
                if not m or MARK.search(line):
                    continue
                got = int(m.group(1).replace(",", ""))
                got2 = int(m.group(2).replace(",", "")) if m.lastindex and m.lastindex >= 2 else None
                want2 = f.get("accept_pass", {}).get("value") if key == "accept_suites" else None
                if got != want or (got2 is not None and want2 is not None and got2 != want2):
                    g.problem("记录文档里的数字与实测不符（%s）" % key,
                              "%s:%d 写的是 %s，实测是 %s（%s）\n      %s"
                              % (path, i, m.group(0).strip(), want, f[key]["cmd"], line.strip()[:80]))

    # ── 规则 D：台账不许过期（只在能读到站点时判）─────────────────────────────────
    if live_shas is None:
        g.note("台账新鲜度**未核对**（读不到本站点产物）")
    else:
        for key, want in sorted(live_shas.items()):
            if key not in f:
                continue
            if f[key]["value"] != want:
                g.problem("事实台账过期（%s）" % key,
                          "台账写 %s…，当前站点是 %s… ⇒ promote 之后忘了跑 python3 build/facts.py"
                          % (f[key]["value"][:12], want[:12]))
        if live_shas:
            g.note("台账新鲜度已核对（%d 件部署件）" % len(live_shas))
    return g


def read_inputs():
    with open(os.path.join(root(), FACTS), encoding="utf-8") as fh:
        facts = json.load(fh)
    docs, records = {}, {}
    for rel in LIVING_DOCS:
        p = os.path.join(root(), rel)
        if os.path.exists(p):
            with open(p, encoding="utf-8", errors="replace") as fh:
                docs[rel] = fh.read()
    for rel in RECORD_DOCS:
        p = os.path.join(root(), rel)
        if os.path.exists(p):
            with open(p, encoding="utf-8", errors="replace") as fh:
                records[rel] = fh.read()
    return facts, docs, records


def live_site_shas():
    """当前站点的部署件 sha（**只 sha，不压 gz** —— 闸门不该为了核对读 36MB 的压缩）。
    读不到就返回 None（"换了机器"不是错，只记 note）。"""
    try:
        sys.path.insert(0, _HERE)
        import state_facts as HF                      # noqa: E402
        out = {}
        for rel, key in (("octave.wasm", "wasm_sha"), ("octave.js", "js_sha"),
                         ("octave.data", "data_sha")):
            p = os.path.join(HF.SITE, rel)
            if not os.path.isfile(p):
                return None
            out[key] = HF._sha256(p)
        return out
    except Exception:
        return None


def main():
    g = Gate("事实闸门", list_mode="--list" in sys.argv)
    try:
        facts, docs, records = read_inputs()
    except (OSError, ValueError) as e:
        g.problem("读不到事实台账", "%r（先跑 python3 build/facts.py）" % (e,))
        return g.finish()
    check(g, facts, docs, records, live_site_shas())
    return g.finish()


# ── 自证：合成输入下的"该红"用例（F1 契约：每个闸门必须能证明自己会红）─────────────
_LEDGER = {"generated": "T", "facts": {
    "wasm_v128": {"value": 4752, "cmd": "c", "source": "s"},
    "env_vars": {"value": 23, "cmd": "c", "source": "s"},
    "wasm_sha": {"value": "a" * 64, "cmd": "c", "source": "s"},
}}
def _doc(body, ledger=_LEDGER):
    """造一份"块正确 + 正文给定"的 HANDOFF：块必须由渲染器生成，否则规则 B 会先报。"""
    import facts_block as fb
    return fb.render_block(ledger) + "\n\n" + body


def _np(facts, docs, records=None, live=None):
    g = Gate("x")
    run_quiet(check, g, facts, docs, records, live)
    return len(g.problems)


def _problems(facts, docs, records=None, live=None):
    g = Gate("x")
    run_quiet(check, g, facts, docs, records, live)
    return g.problems


GOOD = {"STATE.md": _doc("现役数字见 `build/FACTS.json` 的 `wasm_v128` 与 `env_vars`。\n")}
CASES = [
    ("★ 正文只引用键、块与台账一致 ⇒ 不报", lambda: _np(_LEDGER, GOOD) == 0),
    ("★ **正文手抄数字 ⇒ 必须报**（这是本轮新增的核心否定用例）",
     lambda: _np(_LEDGER, {"STATE.md": _doc("现役 v128 计数 = 4752。\n")}) == 1),
    ("★ 抄的数字与实测**一致**也照报（「抄对了」不再是合规形态）",
     lambda: any("手抄" in p[0] for p in _problems(_LEDGER, {"STATE.md": _doc("23 个环境变量\n")}))),
    ("★ 数字写在 AUTO:FACTS 块里 ⇒ 不算手抄（块内那行确实有 4752，但块本身被豁免）",
     lambda: "**4752**" in _doc("见 `build/FACTS.json` 的 `wasm_v128`。\n")
     and not any("手抄" in p[0] for p in _problems(
         _LEDGER, {"STATE.md": _doc("见 `build/FACTS.json` 的 `wasm_v128`。\n")}))),
    ("★ **块过期 ⇒ 必须报**（块里写 4000、台账 4752）",
     lambda: any("块过期" in p[0] for p in _problems(
         _LEDGER, {"STATE.md": _doc("x\n").replace("**4752**", "**4000**")}))),
    ("★ **缺块标记 ⇒ 必须报**",
     lambda: any("缺 AUTO:FACTS" in p[0] for p in _problems(_LEDGER, {"STATE.md": "正文\n"}))),
    ("★ **引用了不存在的键 ⇒ 必须报**",
     lambda: any("不存在的事实键" in p[0] for p in _problems(
         _LEDGER, {"STATE.md": _doc("见 `build/FACTS.json` 的 `wasm_v999`。\n")}))),
    # ★★ Einfacht issue #3 ④（2026-10-01 移植）：围栏代码块/行内代码**豁免**
    ("★ 围栏代码块里的数字 ⇒ 豁免（复跑命令天然带数字）",
     lambda: _np(_LEDGER, {"STATE.md": _doc(
         "```sh\nsh build/check-deploy-sha.sh site 4752\n```\n"
         "对照 `build/FACTS.json` 的 `wasm_v128`。\n")}) == 0),
    ("★ 行内代码里的数字 ⇒ 豁免（引用键的同时行内代码豁免）",
     lambda: _np(_LEDGER, {"STATE.md": _doc(
         "对照 `build/FACTS.json` 的 `wasm_v128`，历史输出 `4752` 仅供参考。\n")}) == 0),
    ("★ 但**正文裸写**（无代码、无块）仍必须报（豁免不许变成后门）",
     lambda: _np(_LEDGER, {"STATE.md": _doc("对照输出 v128 计数 4752。\n")}) == 1),
    ("★ 引用机制空转（既无引用也无裸数字）⇒ 必须报",
     lambda: any("空转" in p[0] for p in _problems(_LEDGER, {"STATE.md": _doc("正文。\n")}))),
    ("★ **台账过期 ⇒ 必须报**（站点 sha 与台账不同）",
     lambda: any("台账过期" in p[0] for p in _problems(
         _LEDGER, GOOD, None, {"wasm_sha": "b" * 64}))),
    ("★ 台账新鲜度核对通过 ⇒ 不报",
     lambda: _np(_LEDGER, GOOD, None, {"wasm_sha": "a" * 64}) == 0),
    ("记录文档里数字与实测不符 ⇒ 报",
     lambda: any("记录文档" in p[0] for p in _problems(
         _LEDGER, GOOD, {"build/113/PLAN-arch.md": "实测 v128 = 4700\n"}))),
    ("**台账为空** ⇒ 必须报（零值守卫）", lambda: _np({"facts": {}}, GOOD) == 1),
    ("**扫描面为空** ⇒ 必须报（零值守卫）", lambda: _np(_LEDGER, {}) == 1),
]


if __name__ == "__main__":
    sys.exit(selftest("check-facts", CASES) if "--selftest" in sys.argv else main())
