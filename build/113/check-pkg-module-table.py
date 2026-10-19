#!/usr/bin/env python3
# Octave-Full-Wasm — **包模块表对账器**（2026-10-18，多 TU 批）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

"""`build/pkg-module-table.json` 与容器 `build/113/build-pkg-oct.sh` 的模块表**必须一致**。

## 为什么需要它

客户端自编 `.oct` 需要知道"这个包该编出哪几个模块、每个模块由哪些源组成"。这个知识
原来**只**存在于容器构建脚本里（一段手写的 heredoc 表）。有两种错法，都已实测：

- **客户端自己扫 DEFUN 全编** ⇒ 会编出容器**故意不列**的模块。实测：
  `miscellaneous` 的 `sample.cc` 在 11.3.0 头下编不过
  （`OCTAVE__RAND_UNIFORM()` 零参调用 vs 11.3.0 的 `rand_uniform(n, p)`），
  而容器表本来就没列它 —— 客户端会报一个"编译失败"，用户以为工具链坏了。
- **客户端硬编码** ⇒ 与容器表各写一份，迟早漂（本仓反复踩的那个形状）。

⇒ 表变成**数据**（`build/pkg-module-table.json`），容器脚本仍是**唯一产地**，
     本闸门是两个产地之间的对账器（AGENTS.md C4：没有对账器的"必须一致"迟早不一致）。

## 对账项

  R1 包集合相同
  R2 每包的模块名集合相同（顺序无关）
  R3 每模块的源清单**逐条相同且同序**（顺序影响链接顺序；容器是显式列表）
  R4 每模块的额外旗标相同
  R5 模块名必须以 `.oct` 结尾且不含路径（落盘时会嵌套建目录 ⇒ ErrnoError 44）

## 用法

    python3 build/113/check-pkg-module-table.py            # 对账真仓库
    python3 build/113/check-pkg-module-table.py --selftest

退出码：0 一致；1 漂移（逐条点名）；2 读不到/结构坏。
"""
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def repo(*p):
    return os.path.join(REPO, *p)


def parse_shell_table(text):
    """从 build-pkg-oct.sh 的 PKGS heredoc 提取 {包: [{name, sources, flags}]}。"""
    m = re.search(r"^PKGS='\n(.*?)\n'$", text, re.S | re.M)
    if not m:
        return None, "build-pkg-oct.sh 里找不到 `PKGS='…'` 块"
    out = {}
    for line in m.group(1).splitlines():
        line = line.strip()
        if not line or line.count("|") < 2:
            continue
        parts = line.split("|")
        pkg, mod = parts[0], parts[1]
        srcs = parts[2].split() if len(parts) > 2 else []
        extra = parts[3].split() if len(parts) > 3 and parts[3] else []
        out.setdefault(pkg, []).append({"name": mod + ".oct", "sources": srcs, "flags": extra})
    if not out:
        return None, "PKGS 块解析出 0 个包（格式变了？）"
    return out, None


def load_json(path):
    with open(path, encoding="utf-8") as fh:
        d = json.load(fh)
    t = d.get("module_table")
    if not isinstance(t, dict) or not t:
        return None, "pkg-module-table.json 没有 module_table（零值守卫）"
    return t, None


def reconcile(shell, data):
    """纯逻辑：两份表 ⇒ 问题列表。输入注入 ⇒ 自证不碰真文件。"""
    problems = []
    if not shell:
        problems.append("容器表为空（零值守卫）")
    if not data:
        problems.append("数据表为空（零值守卫）")
    if problems:
        return problems

    for pkg in sorted(set(shell) - set(data)):
        problems.append("R1 数据表缺包 %r（%d 个模块）" % (pkg, len(shell[pkg])))
    for pkg in sorted(set(data) - set(shell)):
        problems.append("R1 数据表多包 %r（容器不编它 ⇒ 客户端会编出没人要的模块）" % pkg)

    for pkg in sorted(set(shell) & set(data)):
        s_mods = {m["name"]: m for m in shell[pkg]}
        d_mods = {m["name"]: m for m in data[pkg]}
        for n in sorted(set(s_mods) - set(d_mods)):
            problems.append("R2 %s：数据表缺模块 %r" % (pkg, n))
        for n in sorted(set(d_mods) - set(s_mods)):
            problems.append("R2 %s：数据表多模块 %r（容器不编它）" % (pkg, n))
        for n in sorted(set(s_mods) & set(d_mods)):
            s, d = s_mods[n], d_mods[n]
            if s["sources"] != d["sources"]:
                problems.append("R3 %s/%s：源清单不同 —— 容器 %r vs 数据 %r"
                                % (pkg, n, s["sources"], d["sources"]))
            if s["flags"] != d["flags"]:
                problems.append("R4 %s/%s：额外旗标不同 —— 容器 %r vs 数据 %r"
                                % (pkg, n, s["flags"], d["flags"]))
    # R5 对**数据表的每一条**检查（不能只在"两边同名"的循环里 —— 名字坏掉时
    #   正是两边不同名的那一刻，那圈根本进不去；自证 R5/R5b 抓到过）。
    for pkg, mods in sorted(data.items()):
        for m in mods:
            n = m.get("name") or ""
            if not n.endswith(".oct"):
                problems.append("R5 %s：模块名 %r 不以 .oct 结尾" % (pkg, n))
            if "/" in n or "\\" in n:
                problems.append("R5 %s：模块名 %r 含路径分隔符（落盘会 ErrnoError 44）" % (pkg, n))
    # 零值守卫：表非空但一个模块都没解析出来
    if not any(shell.values()):
        problems.append("容器表解析出 0 个模块（格式变了？）")
    return problems


def main(argv):
    try:
        shell_text = open(repo("build", "113", "build-pkg-oct.sh"), encoding="utf-8").read()
        shell, err1 = parse_shell_table(shell_text)
        data, err2 = load_json(repo("build", "pkg-module-table.json"))
    except (OSError, ValueError) as e:
        print("FATAL: 读不到表（%s）—— fail-closed" % e, file=sys.stderr)
        return 2
    for e in (err1, err2):
        if e:
            print("FATAL: %s" % e, file=sys.stderr)
            return 2
    problems = reconcile(shell, data)
    if problems:
        print("包模块表对账：%d 处漂移" % len(problems), file=sys.stderr)
        for p in problems:
            print("  ✗ %s" % p, file=sys.stderr)
        return 1
    n_mod = sum(len(v) for v in data.values())
    print("包模块表对账 OK（%d 包 / %d 模块，容器与数据逐条一致）" % (len(data), n_mod))
    return 0


# ── 自证（三类用例齐）────────────────────────────────────────────────────────
_SHELL = {
    "control": [{"name": "lti_input_idx.oct", "sources": ["lti_input_idx.cc"], "flags": []}],
    "geometry": [{"name": "polybool_mrf.oct",
                  "sources": ["polybool_mrf.cc", "connector.cpp"], "flags": ["-DX"]}],
}
_DATA = {
    "control": [{"name": "lti_input_idx.oct", "sources": ["lti_input_idx.cc"], "flags": []}],
    "geometry": [{"name": "polybool_mrf.oct",
                  "sources": ["polybool_mrf.cc", "connector.cpp"], "flags": ["-DX"]}],
}


def _rec(shell=None, data=None):
    return reconcile(_SHELL if shell is None else shell, _DATA if data is None else data)


CASES = [
    ("★ 正常不报：两份表逐条一致", lambda: _rec() == []),
    ("★ 反向 R1：数据表缺一个包 ⇒ 必报（客户端编不出那个包）",
     lambda: any("R1" in p and "缺包" in p for p in _rec(data={"control": _DATA["control"]}))),
    ("★ 反向 R1b：数据表多一个容器不编的包 ⇒ 必报",
     lambda: any("R1" in p and "多包" in p
                 for p in _rec(data=dict(_DATA, extra=[{"name": "x.oct", "sources": ["x.cc"], "flags": []}])))),
    ("★ 反向 R2：缺模块 ⇒ 必报", lambda: any("R2" in p and "缺模块" in p
                                              for p in _rec(data={"control": []}))),
    ("★ 反向 R2b：多容器不编的模块 ⇒ 必报（正是 sample.cc 那类）",
     lambda: any("R2" in p and "多模块" in p
                 for p in _rec(data={"control": _DATA["control"] + [
                     {"name": "sample.oct", "sources": ["sample.cc"], "flags": []}]}))),
    ("★ 反向 R3：源清单顺序不同 ⇒ 必报（链接顺序承重）",
     lambda: any("R3" in p for p in _rec(data={"control": _DATA["control"], "geometry": [
         {"name": "polybool_mrf.oct", "sources": ["connector.cpp", "polybool_mrf.cc"], "flags": ["-DX"]}]}))),
    ("★ 反向 R4：旗标不同 ⇒ 必报",
     lambda: any("R4" in p for p in _rec(data={"control": _DATA["control"], "geometry": [
         {"name": "polybool_mrf.oct", "sources": ["polybool_mrf.cc", "connector.cpp"], "flags": []}]}))),
    ("★ 反向 R5：模块名不带 .oct ⇒ 必报",
     lambda: any("R5" in p for p in _rec(data={"control": [
         {"name": "lti_input_idx", "sources": ["lti_input_idx.cc"], "flags": []}], "geometry": _DATA["geometry"]}))),
    ("★ 反向 R5b：模块名带路径 ⇒ 必报（落盘 ErrnoError 44）",
     lambda: any("R5" in p and "路径" in p for p in _rec(data={"control": [
         {"name": "a/b.oct", "sources": ["b.cc"], "flags": []}], "geometry": _DATA["geometry"]}))),
    ("★ 空输入必须报：容器表空", lambda: any("零值守卫" in p for p in _rec(shell={}))),
    ("★ 空输入必须报：数据表空", lambda: any("零值守卫" in p for p in _rec(data={}))),
    ("★ 解析器抓不到 PKGS 块 ⇒ 报错（不许把「找不到」当一致）",
     lambda: parse_shell_table("PKGS = nothing") [1] is not None),
]


def _selftest():
    n = bad = 0
    for name, fn in CASES:
        n += 1
        try:
            ok = bool(fn())
        except Exception as e:                    # noqa: BLE001 —— 自证里异常都是红
            ok = False
            name = "%s（异常 %r）" % (name, e)
        if not ok:
            bad += 1
        print("%s | check-pkg-module-table/%s" % ("PASS" if ok else "fail", name))
    print("\n=== check-pkg-module-table 自证：%d PASS / %d fail ===" % (n - bad, bad))
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(_selftest() if "--selftest" in sys.argv else main(sys.argv[1:]))
