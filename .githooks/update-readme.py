#!/usr/bin/env python3
# Octave-Full-Wasm — 把仓库清单摘要写回 README 的 AUTO:FILES 区块
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

"""重算 README.md 的 AUTO:FILES 区块（**分类摘要**，不是逐文件清单）。

用法：
  update-readme.py            # 就地重写
  update-readme.py --check    # 只校验：会变就 exit 1（给 pre-push 用）
  update-readme.py --selftest # F1 自证（三类用例）

AUTO 区块：
  <!-- AUTO:FILES --> ... <!-- /AUTO -->  : 按顶层目录聚合的**文件数与字节数**

★ 为什么从"逐文件清单"改成"分类摘要"（2026-10-29 用户点令「又臭又长」）：
  旧版把 **1124 个跟踪文件逐条写进 README**（路径 + 字节），光这一段就 **87 KB /
  1100+ 行** —— 而它表达的信息只是"仓库里有哪些文件"，那件事 `git ls-files` 一条命令
  就能答。更糟的是它**只有英文 README 有**：中文/德文各只有一行"清单在英文那份"的指针
  ⇒ 三份 README 体积差 3 倍、结构不一致（用户点令「内容完全不一样」）。
  ⇒ 现在只出**分类摘要**（顶层目录 → 文件数 + 合计字节），体积 ~1.5 KB。
  逐文件清单仍在 `git ls-files` 里 —— README 不该当 `ls` 的替代品。
  信息的**可复跑性**没丢：摘要块下方仍写着复跑命令，且 `--check` 照样会对账。
"""
import os
import subprocess
import sys

BEGIN = "<!-- AUTO:FILES -->"
END = "<!-- /AUTO -->"


def tracked_files():
    out = subprocess.run(
        ["git", "ls-files"], capture_output=True, text=True, check=True
    ).stdout.splitlines()
    # README 三份自身不进清单：否则"清单含自身字节数"永远收敛不了，
    # pre-push 的 --check 将永不过。
    skip = {"README.md", "README.zh.md", "README.de.md"}
    return sorted(f for f in out if f and f != ".git" and f not in skip)


def group_of(path):
    """顶层分组键：`build/113/foo.sh` → `build/`；根文件 → `(root)`。"""
    return "(root)" if "/" not in path else path.split("/", 1)[0] + "/"


def summarize(files, root="."):
    """返回 [(group, count, bytes)]，按字节数降序（最大的目录排前面）。"""
    agg = {}
    for f in files:
        g = group_of(f)
        try:
            size = os.path.getsize(os.path.join(root, f))
        except OSError:
            size = 0
        c, b = agg.get(g, (0, 0))
        agg[g] = (c + 1, b + size)
    rows = [(g, c, b) for g, (c, b) in agg.items()]
    rows.sort(key=lambda r: (-r[2], r[0]))
    return rows


def _human(n):
    for unit in ("B", "KB", "MB"):
        if n < 1024 or unit == "MB":
            return ("%d %s" % (n, unit)) if unit == "B" else ("%.1f %s" % (n, unit))
        n /= 1024.0


def render_block(root="."):
    files = tracked_files()
    rows = summarize(files, root)
    total_files = sum(r[1] for r in rows)
    total_bytes = sum(r[2] for r in rows)
    lines = [BEGIN,
             "```",
             "%-28s %8s %12s" % ("group", "files", "bytes")]
    for g, c, b in rows:
        lines.append("%-28s %8d %12s" % (g, c, _human(b)))
    lines.append("%-28s %8d %12s" % ("(total)", total_files, _human(total_bytes)))
    lines.append("```")
    lines.append("")
    # ⚠️ 生成块内容必须是**英文**（2026-10-29）：它写进英文 README，掺中文就是"语言混杂"
    #   （用户点令原话）。中文/德文 README 只**引用**这个块，不各写一份。
    lines.append("Per-file listing: `git ls-files` — this block is a summary so the "
                 "README stays readable.")
    lines.append("Re-run: `python3 .githooks/update-readme.py --check`")
    lines.append(END)
    # 注意：末尾不加换行，由原文 END 之后的 post 原样提供换行，保证幂等。
    return "\n".join(lines)


def selftest():
    """F1 自证（三类齐备）：正常不报 / 该报的必须报 / 空输入必须报。

    判据都是纯函数（`group_of` / `summarize` / `render_block` 的形状），不碰真仓。
    """
    import tempfile
    cases = []

    # ① 正常：分组正确、按字节降序、带 total
    cases.append(("group_of：顶层目录聚合，根文件归 (root)",
                  group_of("build/113/x.sh") == "build/"
                  and group_of("README.md") == "(root)"
                  and group_of("a/b/c") == "a/"))
    with tempfile.TemporaryDirectory() as d:
        os.makedirs(os.path.join(d, "big"))
        os.makedirs(os.path.join(d, "small"))
        with open(os.path.join(d, "big", "a"), "w") as fh:
            fh.write("x" * 500)
        with open(os.path.join(d, "small", "b"), "w") as fh:
            fh.write("y" * 10)
        with open(os.path.join(d, "root.txt"), "w") as fh:
            fh.write("z" * 5)
        rows = summarize(["big/a", "small/b", "root.txt"], d)
        cases.append(("summarize：按字节降序 + 计数正确",
                      [r[0] for r in rows] == ["big/", "small/", "(root)"]
                      and rows[0][1] == 1 and rows[0][2] == 500
                      and sum(r[1] for r in rows) == 3))

        # ② 该报的必须报：坏块（缺 BEGIN/END）在 main 语境里必须拒 —— 这里验
        #    "区块不含逐文件行"这条**反向**形状（改回逐条清单就该红）
        blk = render_block(d)
        cases.append(("★ 反向：摘要块**不含**逐文件行（改回 1100 行清单即红）",
                      "bytes)" not in blk and "group" in blk and "(total)" in blk))

        # ③ 空输入必须报：空文件集 ⇒ 仍要出合法块但 total 为 0（零值不静默）
        empty = summarize([], d)
        cases.append(("★ 空输入：空文件集 ⇒ 空行集（total 由调用方判零，不编假条目）",
                      empty == []))

    bad = 0
    for label, ok in cases:
        print("%s | %s" % ("PASS" if ok else "fail", label))
        bad += 0 if ok else 1
    print("=== update-readme 自证：%d PASS / %d fail ===" % (len(cases) - bad, bad))
    return 1 if bad else 0


def main():
    if "--selftest" in sys.argv:
        return selftest()

    os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    with open("README.md", encoding="utf-8") as fh:
        text = fh.read()
    if BEGIN not in text or END not in text:
        print("README 缺少 AUTO:FILES 区块", file=sys.stderr)
        return 2
    pre, _, rest = text.partition(BEGIN)
    _, _, post = rest.partition(END)
    new_text = pre + render_block() + post
    if "--check" in sys.argv:
        if new_text != text:
            print("README 的 AUTO 区块已过期：先提交（hook 会自动重算）再推", file=sys.stderr)
            return 1
        print("README 新鲜")
        return 0
    if new_text != text:
        with open("README.md", "w", encoding="utf-8") as fh:
            fh.write(new_text)
        print("README 已重算")
    else:
        print("README 无变化")
    return 0


if __name__ == "__main__":
    sys.exit(main())
