#!/usr/bin/env python3
# Octave-Full-Wasm — **N 个 relink 模式的参数差异表**（工单 74 的输出件）
# Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么单独一个文件：在 shell 里对齐多条 `KEY  VALUE` 流（paste/join）会串味
# （实测踩过一次：两行拼成一行）。这里用 dict 做键对齐，几行代码的事。
#
# ★ 2026-11-01 从"两模式"扩到"N 模式"（用户点令「标准版配方也得留着」）：
#   三产物模型 = `product` / `w64-std` / `w64`，三者差异必须**一起**看得见 ——
#   只比前两个会把"标准版与补丁版到底差在哪"藏起来，那正是本批要修的洞。
#
# 用法：python3 build/113/explain-diff.py <relink.sh> <mode> <mode> [<mode>...]
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
        print("用法：explain-diff.py <relink.sh> <mode> <mode> [<mode>...]（≥2 个）",
              file=sys.stderr)
        return 2
    relink, modes = argv[0], argv[1:]
    cols = [(m, params(relink, m)) for m in modes]
    empty = [m for m, d in cols if not d]
    if empty:
        print("FATAL: 模式 %s 的 explain 为空（读不到参数组）" % ",".join(empty),
              file=sys.stderr)
        return 2

    head = "  %-18s" % "key"
    for m, _ in cols:
        head += " %-26s" % m
    print(head)

    n = 0
    for k in sorted(set().union(*[set(d) for _, d in cols])):
        vals = [d.get(k, "(无)") for _, d in cols]
        if len(set(vals)) == 1:      # 全部相同 ⇒ 不是差异，表只关心"哪里不同"
            continue
        row = "  %-18s" % k
        for v in vals:
            row += " %-26s" % v
        print(row)
        n += 1
    print("  (%d 项差异 / %d 个模式)" % (n, len(modes)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
