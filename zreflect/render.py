#!/usr/bin/env python3
"""把台账渲染成文档里的机器块 —— **数字的唯一产地**。

生成器（`facts.py`）与闸门（`check_facts.py`）必须共用这一个函数，
否则「块对不对」两边口径会分叉：生成器改了排版，闸门还按旧排版比，于是永远不一致
（或者更糟：两边都改成了宽松匹配，于是永远「一致」）。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gate import module_meta                             # noqa: E402

import re

BLOCK_BEGIN = "<!-- AUTO:FACTS -->"
BLOCK_END = "<!-- /AUTO:FACTS -->"

PREAMBLE = [
    "> 本区块由 `zreflect/facts.py --render-doc` 从 `FACTS.json` 渲染，**不要手改**"
    "（pre-commit 会重算并 `git add`）。",
    "> 正文里的「测出来的数字」只在这里生产：要引用就写 `[[键名]]`，不要手抄数字。",
]


def _fmt(v):
    if isinstance(v, str) and len(v) == 64:
        return "`%s…`" % v[:16]
    return "**%s**" % (v if isinstance(v, str) else str(v))


def render_block(ledger):
    """台账 → 机器块（含首尾标记）。**纯函数**：同一份台账渲染两次逐字节相同。"""
    from ledger import facts_of                          # noqa: PLC0415

    f = facts_of(ledger)
    lines = [BLOCK_BEGIN] + list(PREAMBLE) + [""]
    if not f:
        # 零值守卫：**空台账必须明写「为空」**，不许渲染成一张安静的空表 ——
        # 空表看起来像「一切正常」，而事实是「一条都没量到」。
        lines += ["**台账为空** —— 一条事实都没有。空不是「通过」：先查 measure() 是不是坏了。", ""]
    else:
        # 「测于」列 = 台账里的 measured_at（采集时刻的记录，纯函数输入 ——
        # 不渲染「几天前」：那会随墙上时钟变，--check 永不收敛。issue #3 ②）
        lines += ["| 键 | 值 | 测于 | 复跑命令 |", "|---|---|---|---|"]
        for k in sorted(f):
            e = f[k] if isinstance(f[k], dict) else {"value": f[k]}
            lines.append("| `%s` | %s | %s | `%s` |"
                         % (k, _fmt(e.get("value")), e.get("measured_at", "—"),
                            e.get("cmd", "?")))
        lines += ["", "%d 条事实。" % len(f)]
    lines.append(BLOCK_END)
    return "\n".join(lines)


def body_of(block):
    """取块内的正文（两端标记之间），供「块与台账一致」的比较用。"""
    if BLOCK_BEGIN not in block:
        return ""
    return block.split(BLOCK_BEGIN, 1)[1].split(BLOCK_END, 1)[0]


AUTO_PAIR_RE = re.compile(
    r"<!--\s*AUTO:[A-Za-z0-9_-]+\s*-->[\s\S]*?<!--\s*/AUTO:[A-Za-z0-9_-]+\s*-->")


def prose_of(doc_text):
    """文档里**块以外**的正文（裸数字要在这里面查）。

    ⚠️ 豁免的是**全部** `<!-- AUTO:x --> … <!-- /AUTO:x -->` 标记对，不止本模块
    写的 FACTS 那对 —— STATE.md 还有 AUTO:GATES / AUTO:STATE（别的生成器维护）。
    实测踩过：只豁免一对 ⇒ AUTO:STATE 里的机器行（如交付包字节数 `91,155,710`）
    被当正文扫，尾组 `710` 子串撞上 `exported_functions=710` ⇒ 假红（2026-10-11）。
    """
    return AUTO_PAIR_RE.sub("", doc_text)


# ── 自证 ──────────────────────────────────────────────────────────────────────
def _cases():
    full = {"facts": {"a": 4752, "s": {"value": "b" * 64, "cmd": "c"}}}
    return [
        # ① 正常不报
        ("每个键都出现在块里", lambda: all(k in render_block(full) for k in ("a", "s"))),
        ("值是原值（4752 在块里）", lambda: "**4752**" in render_block(full)),
        ("sha 截断显示（不整条摊开）", lambda: "`" + "b" * 16 + "…`" in render_block(full)),
        ("块渲染是纯函数（渲染两次逐字节相同）",
         lambda: render_block(full) == render_block(full)),
        ("prose_of 只取块以外的正文（块内的表格被排除，块外的字保留）",
         lambda: (lambda d: ("正文" in prose_of(d) and "tail" in prose_of(d)
                             and "| 键 |" not in prose_of(d) and "| 键 |" in d))(
             "正文\n" + render_block(full) + "\ntail")),
        ("没有块标记时 prose_of 退回整篇（找不到块 ≠ 可以当空）",
         lambda: prose_of("没有标记的文档") == "没有标记的文档"),
        ("★ 多个标记对**全部**豁免（别的生成器的块也不是正文）——"
         "实测：只豁免一对时，AUTO:STATE 的机器行数字被当正文假红（2026-10-11）",
         lambda: (lambda d: ("710" not in prose_of(d) and "中间" in prose_of(d)))(
             "中间\n<!-- AUTO:FACTS -->\n| 4752 |\n<!-- /AUTO:FACTS -->\n"
             "<!-- AUTO:STATE -->\n| 91,155,710 |\n<!-- /AUTO:STATE -->\n")),
        # ② 该报的必须报（渲染层的「该报」= 必须发生变化，不许是常量）
        ("★ 台账少一条 ⇒ 块跟着变（块不是常量）",
         lambda: render_block(full) != render_block({"facts": {"a": 4752}})),
        # ③ 空输入必须报
        ("★ 空台账 ⇒ 必须明写「台账为空」，且不许渲染出一张表",
         lambda: "台账为空" in render_block({"facts": {}})
         and "| 键 |" not in render_block({"facts": {}})),
        ("★ 空台账与有台账的块必须不同（空不是「都一样」）",
         lambda: render_block({"facts": {}}) != render_block(full)),
    ]


def _selftest():
    import os                                            # noqa: PLC0415
    import sys                                           # noqa: PLC0415
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from gate import module_meta, selftest                            # noqa: PLC0415
    return selftest("render（数字的唯一产地）", _cases())


MODULE = module_meta("机器块渲染", "数字的唯一产地（纯函数）", selftest=True)


if __name__ == "__main__":
    import os                                            # noqa: PLC0415
    import sys                                           # noqa: PLC0415
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    sys.exit(_selftest())
