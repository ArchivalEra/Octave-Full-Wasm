#!/usr/bin/env python3
# Octave-Full-Wasm — 两个 relink 模式的参数差异表（工单 74 的输出件）
# Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么单独一个文件：在 shell 里对齐两条 `KEY  VALUE` 流（paste/join）会串味
# （实测踩过一次：两行拼成一行）。这里用 dict 做键对齐，几行代码的事。
#
# 用法：python3 build/113/explain-diff.py <relink.sh> <modeA> <modeB>
import subprocess
import sys


def params(relink, mode):
    """跑 explain 并把 KEY VALUE 收成 dict（**key 可含数字**：MEMORY64）。"""
    out = subprocess.run(["bash", relink, "explain", mode],
                         capture_output=True, text=True).stdout
    d = {}
    for ln in out.splitlines():
        parts = ln.split()
        if len(parts) >= 2 and parts[0] and (parts[0][0].isupper()):
            d[parts[0]] = " ".join(parts[1:])
    return d


def main(argv):
    if len(argv) < 3:
        print("用法：explain-diff.py <relink.sh> <modeA> <modeB>", file=sys.stderr)
        return 2
    relink, ma, mb = argv[0], argv[1], argv[2]
    a, b = params(relink, ma), params(relink, mb)
    if not a or not b:
        print("FATAL: 某个模式的 explain 为空（读不到参数组）", file=sys.stderr)
        return 2
    print("  %-18s %-28s %s" % ("key", "%s" % ma, mb))
    n = 0
    for k in sorted(set(a) | set(b)):
        va, vb = a.get(k, "(无)"), b.get(k, "(无)")
        if va != vb:
            print("  %-18s %-28s → %s" % (k, va, vb))
            n += 1
    print("  (%d 项差异)" % n)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
