#!/usr/bin/env python3
# Octave-Full-Wasm — `site/matrix-android.html` 的**生成器**（A2，2026-09-26）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么有它：这个页面（"浏览器矩阵自测页"——ready 后自动跑能力门、把结果写进 DOM，
# 供手机截图/无头读取）一直是**手写的**，`NOTES-threads.md` 原话是"无生成器，手工同步"。
# 后果实测过两次：它的三处副本漂了整整一个架构版本（8768 是 C6 版 700 行、8761 与仓库还是
# C6 之前的 575 行），而**没有任何测试会因此变红**（详见 PLAN-arch §1.7 / §4.9）。
# A0b 给它配了探针（`test/browser/probe-matrix-android.mjs`），这里再给它配生成器：
#   **= 当前的 bridge/index.html + 一段"自动冒烟"尾块**，每次改完页面重新生成即可。
#
# 用法：
#   python3 build/113/gen-matrix-android.py            # 用仓库 site/ 里那份的尾块重建
#   python3 build/113/gen-matrix-android.py --tail-from <旧页面> --out <输出>
# 尾块用**标记定界**（`MATRIX-TAIL-START`/`MATRIX-TAIL-END`），所以本脚本是幂等的：
# 生成出来的页面里带着同样的标记，下次再跑就是"从它自己身上取尾块"。
#
# ⚠️ 生成之后**必须**用探针在浏览器里验一遍（能编过 ≠ 能用了）：
#   cd /mnt/hdd/octave-wasm-build/harness && \
#     sh run.sh /mnt/hdd/zcode-projects/Octave-Full-Wasm/test/browser/probe-matrix-android.mjs <URL>
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
START = "<!-- MATRIX-TAIL-START"
END = "<!-- MATRIX-TAIL-END -->"


def read(p):
    with open(p, encoding="utf-8") as fh:
        return fh.read()


def extract_tail(text):
    """从旧页面里取尾块（含自己的定界标记）。取不到就抛 —— 不猜、不造。"""
    i = text.index(START)
    j = text.index(END, i) + len(END)
    return text[i:j]


def main(argv):
    tail_from = os.path.join(REPO, "site", "matrix-android.html")
    out = os.path.join(REPO, "site", "matrix-android.html")
    for k, a in enumerate(argv[1:]):
        if a == "--tail-from":
            tail_from = argv[k + 2]
        elif a == "--out":
            out = argv[k + 2]

    index = read(os.path.join(REPO, "bridge", "index.html"))
    old = read(tail_from)
    tail = extract_tail(old)
    # 自检：尾块必须真的带标记（否则说明取错了地方）
    assert START in tail and END in tail, "尾块缺定界标记"

    if "</body>" not in index:
        print("FATAL: bridge/index.html 里没有 </body>，没法插入尾块", file=sys.stderr)
        return 2
    new = index.replace("</body>", "\n" + tail + "\n</body>", 1)

    with open(out, "w", encoding="utf-8") as fh:
        fh.write(new)
    print("已生成 %s（%d 字节；= bridge/index.html（%d 字节）+ 尾块（%d 字节））"
          % (out, len(new.encode()), len(index.encode()), len(tail.encode())))
    # 顺带报一下两份的差异是否只剩"尾块"那一处 —— 这是这个生成器的意义所在
    a = set(re.findall(r'src="([^"]+)"', index))
    b = set(re.findall(r'src="([^"]+)"', new))
    if a != b:
        print("⚠️ 生成后 <script src> 集合变了：%s" % (a ^ b), file=sys.stderr)
        return 1
    print("自检：<script src> 集合与 index.html 一致（%s）" % " ".join(sorted(a)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
