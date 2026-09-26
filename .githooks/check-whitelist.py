#!/usr/bin/env python3
# Octave-Full-Wasm — 白名单校验：跟踪文件必须在 .gitignore 有显式放行规则
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

"""校验白名单：每个 git 跟踪文件必须被 .gitignore 里至少一条 `!` 规则显式放行。

`!*/` 这类纯目录规则不算数（它只负责让 git 走进目录）。
通不过就 exit 1，pre-commit 直接拦。

★ 2026-09-26（事实系统 F1）：接入 `build/lib/gate.py` ——
  · 加了**零值守卫**（0 条规则 / 0 个跟踪文件都算"没查"，不是"通过"）；
  · 逻辑抽成 `check(g, rules, files)`，**输入注入** ⇒ 能在夹具树上自证；
  · `--selftest` 跑三条用例（正常放行 / 该报的必须报 / 空输入必须报）。
"""
import fnmatch
import os
import subprocess
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "build", "lib"))
from gate import Gate, root, run_quiet, selftest          # noqa: E402


def check(g, rules, files):
    """规则与跟踪文件**注入**进来（这样自证才不用碰真仓库）。"""
    if not g.require_nonempty(rules, "白名单规则（.gitignore 里的 `!` 行）"):
        return g
    if not g.require_nonempty(files, "git 跟踪文件（git ls-files）"):
        return g
    bad = [f for f in files if f and not any(fnmatch.fnmatch(f, r) for r in rules)]
    for f in bad[:20]:
        g.problem("跟踪文件没有白名单放行", "%s（先改 .gitignore）" % f)
    if len(bad) > 20:
        g.problem("跟踪文件没有白名单放行（余下略）", "共 %d 个" % len(bad))
    if not bad:
        g.note("白名单覆盖 OK（%d 个文件，%d 条放行规则）" % (len(files), len(rules)))
    return g


def read_inputs():
    with open(os.path.join(root(), ".gitignore"), encoding="utf-8") as fh:
        rules = [line[1:].strip() for line in fh
                 if line.strip().startswith("!") and line.strip() != "!*/"]
    out = subprocess.run(["git", "-C", root(), "ls-files"], capture_output=True,
                         text=True, check=True).stdout.splitlines()
    return rules, out


def main():
    g = Gate("白名单覆盖", list_mode="--list" in sys.argv)
    try:
        rules, files = read_inputs()
    except (OSError, subprocess.CalledProcessError) as e:
        g.problem("读不到输入", "%r" % (e,))
        return g.finish()
    check(g, rules, files)
    return g.finish()


def _np(rules, files):
    """返回 check() 报了几个问题（自证用；异常吞在 run_quiet 里）。"""
    g = Gate("x")
    run_quiet(check, g, rules, files)
    return len(g.problems)


CASES = [
    ("正常输入 ⇒ 不报问题", lambda: _np(["build/*", "README.md"], ["build/a.sh", "README.md"]) == 0),
    ("该报的必须报（文件没有对应规则）", lambda: _np(["build/*"], ["build/a.sh", "秘密.txt"]) == 1),
    ("**空规则** ⇒ 必须报（零值守卫）", lambda: _np([], ["a"]) == 1),
    ("**空文件表** ⇒ 必须报（零值守卫）", lambda: _np(["a"], []) == 1),
]


if __name__ == "__main__":
    sys.exit(selftest("check-whitelist", CASES) if "--selftest" in sys.argv else main())
