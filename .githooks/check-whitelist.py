#!/usr/bin/env python3
# Octave-Full-Wasm — 白名单校验：跟踪文件必须在 .gitignore 有显式放行规则
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

"""校验白名单：每个 git 跟踪文件必须被 .gitignore 里至少一条 `!` 规则显式放行。

`!*/` 这类纯目录规则不算数（它只负责让 git 走进目录）。
通不过就 exit 1，pre-commit 直接拦。
"""
import fnmatch
import subprocess
import sys


def main():
    with open(".gitignore", encoding="utf-8") as fh:
        rules = [
            line[1:].strip()
            for line in fh
            if line.strip().startswith("!") and line.strip() != "!*/"
        ]
    out = subprocess.run(
        ["git", "ls-files"], capture_output=True, text=True, check=True
    ).stdout.splitlines()
    bad = [f for f in out if f and not any(fnmatch.fnmatch(f, r) for r in rules)]
    if bad:
        print("以下跟踪文件没有白名单放行，先改 .gitignore：", file=sys.stderr)
        for f in bad:
            print(f"  {f}", file=sys.stderr)
        return 1
    print(f"白名单覆盖 OK（{len(out)} 个文件，{len(rules)} 条放行规则）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
