#!/usr/bin/env python3
# Octave-Full-Wasm — 重算 HANDOFF.md 的 AUTO:STATE 区块
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

"""重算 HANDOFF.md 里那两个标记之间的**机器块**。

    <!-- AUTO:STATE --> … <!-- /AUTO:STATE -->

为什么要有它：HANDOFF 是这份工程的"唯一活文档"（抗上下文压缩），而它最容易烂的地方
不是结论、是**数字** —— 2026-09-23 一天之内就烂过四处：部署 wasm 的 sha（`bac48adb…`
在换了带 GL 的构建之后还挂在头部）、套件数（"31 套 784" 与实测 32 套 848 并存）、
体积（"34.30MB" 与实际 35.15 MiB）、交付包名。所以把这几件**从产物直接读出来的数字**
交给机器写，人只写结论。

用法：
  update-handoff.py            # 就地重写
  update-handoff.py --check    # 只校验：会变就 exit 1（给 pre-push 用）
  update-handoff.py --quiet    # 无变化时不打印（给 hook/Stop 用）

口径与"为什么这么设计"见 `.githooks/handoff_facts.py` 的文件头。
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import handoff_facts as F  # noqa: E402

BEGIN = "<!-- AUTO:STATE -->"
END = "<!-- /AUTO:STATE -->"
DOC = "HANDOFF.md"


def render(prev):
    site = F.site_facts(prev_raw_gz=prev)
    sweep = F.sweep_facts()
    dist = F.dist_facts()
    git = F.git_facts()
    nassets = F.assets_count()

    L = [BEGIN,
         "> 本区块由 `.githooks/update-handoff.py` 重算，**不要手改**"
         "（pre-commit 会刷新并 `git add`；pre-push 会 `--check`）。",
         "",
         "| 项 | 值 |",
         "|---|---|"]

    if site["ok"]:
        for name in F.BIG_THREE:
            f = site["files"][name]
            L.append(f"| `{name}` | {F.fmt(f['raw'])} B raw / {F.fmt(f['gz'])} B gz "
                     f"| sha256 `{f['sha256'][:16]}…` |")
        L.append(f"| 三大件 gzip 合计 | **{F.fmt(site['gz_total'])} B** | |")
    else:
        L.append(f"| 部署件 | **读不到**（{site.get('why', '?')}） | |")

    if nassets is not None:
        L.append(f"| 资产条目 | {nassets} | |")

    if sweep["ok"]:
        # ★ 口径（F2 收尾 2026-09-27 定死）：表头数字 = **只数 accept-***（与 FACTS.json 的
        #   `accept_suites`/`accept_pass` 同口径）；探针/基准另写在括号里，免得同一份文档里
        #   出现两个"最近一次全绿"（PROBES=1 那轮的合计是 43+23 套）。
        ex = sweep.get("extras") or {}
        extra = ""
        if ex.get("suites") or ex.get("no_summary"):
            bits = []
            if ex.get("suites"):
                bits.append(f"探针 {ex['suites']} 套 / {F.fmt(ex['pass'])} PASS")
            if ex.get("no_summary"):
                bits.append(f"基准 {len(ex['no_summary'])} 套（按契约无汇总行）")
            extra = "（同日 PROBES=1 另跑：" + "、".join(bits) + "）"
        L.append(f"| 最近一次**全绿**回归 | `{sweep['dir']}` · **{sweep['suites']} 套 / "
                 f"{F.fmt(sweep['pass'])} PASS / 0 FAIL**{extra} | {sweep.get('url', '')} |")
    elif sweep.get("fallback"):
        f = sweep["fallback"]
        extra = f" · 缺汇总 {f['missing']} 条" if f.get("missing") else ""
        L.append(f"| 最近一次回归（**未全绿**） | `{f['dir']}` · {f['suites']} 套 / "
                 f"{F.fmt(f['pass'])} PASS / **{f['fail']} FAIL**{extra} | {f.get('url', '')} |")
    else:
        L.append(f"| 全量回归 | **读不到**（{sweep.get('why', '?')}） | |")

    if dist["ok"]:
        same = ""
        if dist.get("wasm_sha256") and site["ok"]:
            same = "**与部署件同 sha** ✓" if \
                dist["wasm_sha256"] == site["files"]["octave.wasm"]["sha256"] else "**与部署件不一致** ✗"
        tar = ""
        if dist.get("tar_bytes"):
            tar = f" · tar.zst {F.fmt(dist['tar_bytes'])} B"
            if dist.get("tar_sha256"):
                tar += f" · `{dist['tar_sha256'][:16]}…`"
        L.append(f"| 交付包 | `{dist['name']}`{tar} | 包内 wasm {'（' + same + '）' if same else '（未核对）'} |")
    else:
        L.append(f"| 交付包 | **读不到**（{dist.get('why', '?')}） | |")

    # ⚠️ 只写分支名：日期与 sha 从 HEAD 派生 ⇒ **在同一个提交里不可满足**（写进去的时候
    #    HEAD 还是旧提交，提交完就"过期" ⇒ 逼出第二个"刷新机器块"提交，或 `--no-verify`）。
    #    详见 `.githooks/handoff_facts.py::git_facts()` 的实测记录。
    L.append(f"| 仓库 | 分支 `{git['branch'] or '?'}`"
             f"（**HEAD 的 sha 与日期以 `git log -1` 为准，不写死在这里**） | |")
    L.append(END)
    return "\n".join(L)


def main():
    os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    with open(DOC, encoding="utf-8") as fh:
        text = fh.read()
    if BEGIN not in text or END not in text:
        print(f"{DOC} 缺少 {BEGIN} / {END} 区块", file=sys.stderr)
        return 2
    prev = F.parse_prev_block(text)
    pre, _, rest = text.partition(BEGIN)
    _, _, post = rest.partition(END)
    new_text = pre + render(prev) + post

    if "--check" in sys.argv:
        if new_text != text:
            print(f"{DOC} 的 AUTO:STATE 区块已过期：先提交（pre-commit 会自动重算）再推",
                  file=sys.stderr)
            return 1
        print("HANDOFF 机器块新鲜")
        return 0

    if new_text != text:
        with open(DOC, "w", encoding="utf-8") as fh:
            fh.write(new_text)
        if "--quiet" not in sys.argv:
            print("HANDOFF 机器块已重算")
    elif "--quiet" not in sys.argv:
        print("HANDOFF 机器块无变化")
    return 0


if __name__ == "__main__":
    sys.exit(main())
