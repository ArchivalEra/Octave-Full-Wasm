#!/usr/bin/env python3
# Octave-Full-Wasm — **档知识单源对账器**（Einfacht #20③ C，2026-10-18）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

"""`build/lanes.json` 是档知识的**唯一声明**，本闸门把每个消费方的字面量逐条对齐。

## 为什么需要它（实测事故，不是洁癖）

三线裁决（2026-10-17）删掉 `threads` 档时，档名/架构/目录/能力前提散在至少六处：
`bridge/lane.js` 的 FILES 表与回退顺序、`build/gen-lanes.sh` 的 `has3` 探测、
`check-lane-purity.py` 的 `LANE_EXPECT`、`build/plugins.json` 的 `lane_expect`、
`bridge/assets-loader.js` 的 `/^w64/` 前缀推架构、以及几个测试套件的内联名单。
**漏改其中一处**（`test/browser/manifest.json` 里已随档删除的 `THREADS_ARTIFACT`）
⇒ 核心闸门 `probe-lane` 被 sweep **永久跳过**，而 summary 仍报 `0 FAIL`。
即 Einfacht #20③ 的原始报告：一次静默假绿。

裁决：**C（lanes.json 单源）留本仓落**（上游 `#20` 评论确认）。落地形状 = 两份东西：
  1. `build/lanes.json` —— 声明（数据，不是代码）；
  2. 本文件 —— **对账器**（「必须一致」的东西没有对账器就迟早不一致，AGENTS.md C4）。

## 对账项（逐条 fail-closed）

  R1 `bridge/lane.js` 的 FILES 键集 == lanes.json 里 `site_visible` 的档 ∪ 旧别名
  R2 lane.js 的 FILES 目录与 lanes.json 的 `site_dir` 逐条相等
  R3 lane.js 的 `order` 数组 == lanes.json 的 `precedence`
  R4 lane.js 的覆盖正则里的档名集 == lanes.json 的全部站内档名 ∪ 旧别名
  R5 `build/gen-lanes.sh` 的 `add`/`has3` 行里的档与目录 == lanes.json 的 `site_visible` 档
  R6 `check-lane-purity.py` 的 `LANE_EXPECT` == lanes.json 的 `lanes[*].arch`
  R7 `check-lane-purity.py` 的 `DEAD_LANES` 键 == lanes.json 的 `dead_lanes` 键
  R8 `build/plugins.json` 的 `lane_expect` 键 == lanes.json 的 `site_visible` 档
  R9 **死档不许出现在任何消费方的"活档"位置**（`threads` 出现在 FILES/order/expect 里 ⇒ 必红）
  R10 站点清单生成器与选档器的档集**互相包含**（单向漏一档 ⇒ 404 或永不选中）

## 用法

    python3 build/113/check-lanes-single-source.py            # 对账真仓库
    python3 build/113/check-lanes-single-source.py --selftest # 自证（三类用例齐）

退出码：0 = 全部对齐；1 = 有漂移（逐条点名）；2 = 读不到/结构坏（fail-closed）。
"""
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def repo(*parts):
    return os.path.join(REPO, *parts)


# ── 提取器（纯函数，输入是文本 ⇒ 自证不用碰真文件）────────────────────────────

def parse_lane_js(text):
    """从 bridge/lane.js 提取三样：FILES（键 ⇒ dir）、order、覆盖正则里的档名。"""
    out = {"files": {}, "order": [], "override": [], "problems": []}

    # FILES：形如  `w64-base': { lane: 'w64-base', dir: 'w64-base/',`
    #          或  w64: { lane: 'w64', dir: 'w64/',`
    m = re.search(r"var FILES = \{(.*?)\n  \};", text, re.S)
    if not m:
        out["problems"].append("lane.js 里找不到 `var FILES = {…}` 块")
    else:
        block = m.group(1)
        # 逐条目：'key': { … dir: '…' … }   （键可能带引号）
        for em in re.finditer(r"'?([A-Za-z0-9_-]+)'?\s*:\s*\{([^{}]*)\}", block):
            key, body = em.group(1), em.group(2)
            dm = re.search(r"dir:\s*'([^']*)'", body)
            out["files"][key] = dm.group(1) if dm else None

    # order 数组：var order = ['w64', 'w64-base', 'base'];
    m = re.search(r"var order = \[([^\]]*)\]", text)
    if not m:
        out["problems"].append("lane.js 里找不到 `var order = […]`（回退优先级）")
    else:
        out["order"] = re.findall(r"'([^']+)'", m.group(1))

    # 覆盖正则：/[?&]lane=(w64|w64-base|base)(?:&|$)/
    m = re.search(r"/\[\?&\]lane=\(([^)]*)\)", text)
    if not m:
        out["problems"].append("lane.js 里找不到 `?lane=` 覆盖正则")
    else:
        out["override"] = [x for x in m.group(1).split("|") if x]
    return out


def parse_gen_lanes(text):
    """从 build/gen-lanes.sh 提取 has3 <目录> && add <档> 的对（顺序即档序）。

    ⚠️ 目录口径：gen-lanes 里写成 `""`（根）与 `w64`（不带尾斜杠），而 lanes.json 里
    是 `""` 与 `w64/` —— **同一件事的两种写法**。这里统一归一化（去引号、去尾斜杠），
    否则对账器会对着"格式差异"报三条假红（第一版实测）。
    """
    out = {"pairs": [], "problems": []}
    for m in re.finditer(r"^has3\s+(\S*)\s+&&\s+add\s+(\S+)\s*$", text, re.M):
        d = m.group(1).strip("\"'").rstrip("/")
        out["pairs"].append((m.group(2), d))     # (档名, 归一化目录)
    if not out["pairs"]:
        out["problems"].append("gen-lanes.sh 里找不到 `has3 <dir> && add <lane>` 行")
    return out


def parse_lane_purity(text):
    """从 check-lane-purity.py 提取 LANE_EXPECT 与 DEAD_LANES。"""
    out = {"expect": {}, "dead": [], "problems": []}

    m = re.search(r"^LANE_EXPECT = \{(.*?)^\}", text, re.S | re.M)
    if not m:
        out["problems"].append("check-lane-purity.py 里找不到 `LANE_EXPECT = {…}`")
    else:
        body = "\n".join(ln.split("#", 1)[0] for ln in m.group(1).splitlines())
        for em in re.finditer(r"\"([A-Za-z0-9_-]+)\"\s*:\s*\"([^\"]+)\"", body):
            out["expect"][em.group(1)] = em.group(2)

    m = re.search(r"^DEAD_LANES = \{([^}]*)\}", text, re.S | re.M)
    if not m:
        out["problems"].append("check-lane-purity.py 里找不到 `DEAD_LANES = {…}`")
    else:
        out["dead"] = [x for x in re.findall(r"\"([A-Za-z0-9_-]+)\"\s*:", m.group(1))]
    return out


def parse_plugins(text):
    """build/plugins.json 的 lane_expect 键。"""
    out = {"lanes": [], "problems": []}
    try:
        d = json.loads(text)
    except ValueError as e:
        out["problems"].append("plugins.json 解析失败：%s" % e)
        return out
    le = d.get("lane_expect")
    if not isinstance(le, dict) or not le:
        out["problems"].append("plugins.json 没有 lane_expect（每车道期望缺位）")
    else:
        out["lanes"] = sorted(le)
    return out


# ── 对账（纯逻辑：声明 dict + 四份提取结果 ⇒ 问题列表）────────────────────────

def reconcile(decl, lanejs, genlanes, purity, plugins):
    """返回问题列表（空 = 全部对齐）。所有输入都是注入的 ⇒ 自证不碰真文件。"""
    problems = []
    lanes = decl.get("lanes") or {}
    dead = decl.get("dead_lanes") or {}
    prec = decl.get("precedence") or []

    site = {n: v for n, v in lanes.items() if v.get("site_visible")}
    aliases = {n: v for n, v in lanes.items() if v.get("role") == "legacy-alias"}
    # 站点档名 + 旧别名 = "选档器认识的站内名字"
    selectable = set(site) | set(aliases)

    # 零值守卫：声明本身为空 ⇒ 什么也证明不了
    if not site:
        problems.append("lanes.json 里没有任何 site_visible 的档（零值守卫：空声明不是通过）")
    if not prec:
        problems.append("lanes.json 没有 precedence（回退优先级）")
    if not lanes:
        problems.append("lanes.json 没有 lanes（零值守卫）")

    # 提取器自身的结构问题
    for tag, got in (("lane.js", lanejs), ("gen-lanes.sh", genlanes),
                     ("check-lane-purity.py", purity), ("plugins.json", plugins)):
        for p in got.get("problems") or []:
            problems.append("%s：%s" % (tag, p))

    # R1 FILES 键集
    if lanejs.get("files"):
        got, want = set(lanejs["files"]), selectable
        if got != want:
            for n in sorted(want - got):
                problems.append("R1 lane.js FILES 缺档 %r（lanes.json 声明了、选档器会回退/404）" % n)
            for n in sorted(got - want):
                problems.append("R1 lane.js FILES 多档 %r（lanes.json 没有 ⇒ 无人管的档）" % n)

    # R2 目录
    for n, v in (lanejs.get("files") or {}).items():
        if n not in lanes:
            continue                    # R1 已点名
        want = lanes[n].get("site_dir")
        if want is not None and v != want:
            problems.append("R2 lane.js FILES[%r].dir = %r，lanes.json 声明 %r" % (n, v, want))

    # R3 order
    if lanejs.get("order") and list(lanejs["order"]) != list(prec):
        problems.append("R3 lane.js 的 order = %r，lanes.json 的 precedence = %r"
                        % (lanejs["order"], prec))

    # R4 覆盖正则：必须是"站内名字"的子集/超集对齐
    if lanejs.get("override"):
        got = set(lanejs["override"])
        if got != selectable:
            for n in sorted(selectable - got):
                problems.append("R4 `?lane=` 覆盖正则缺档 %r（显式覆盖选不到它）" % n)
            for n in sorted(got - selectable):
                problems.append("R4 `?lane=` 覆盖正则多档 %r（lanes.json 没声明）" % n)

    # R5 gen-lanes 的 (档, 目录) 对（目录已归一化：去尾斜杠）
    if genlanes.get("pairs"):
        got = set(genlanes["pairs"])
        want = {(n, (v.get("site_dir") or "").rstrip("/")) for n, v in site.items()}
        if got != want:
            for pair in sorted(want - got):
                problems.append("R5 gen-lanes.sh 缺 (档,目录) %r ⇒ 站点生成器少写一档" % (pair,))
            for pair in sorted(got - want):
                problems.append("R5 gen-lanes.sh 多 (档,目录) %r ⇒ 会写出没声明的档" % (pair,))

    # R6 LANE_EXPECT == lanes[*].arch
    #   ⚠️ 旧别名（legacy-alias）**不要求**进 LANE_EXPECT：那个表的用途是"给定车道名判
    #   期望架构"，而别名从不作为构建/部署车道名出现（`?lane=w64-threads` 在 lane.js 里
    #   就被归一到 w64 的 FILES）。要求它进表 = 逼一个不承重的名字有架构声明。
    expect_lanes = {n: v for n, v in lanes.items() if v.get("role") != "legacy-alias"}
    if purity.get("expect"):
        got = purity["expect"]
        for n, v in expect_lanes.items():
            if n not in got:
                problems.append("R6 check-lane-purity.py 的 LANE_EXPECT 缺档 %r（无从判架构）" % n)
            elif got[n] != v.get("arch"):
                problems.append("R6 LANE_EXPECT[%r] = %r，lanes.json 声明 %r"
                                % (n, got[n], v.get("arch")))
        for n in sorted(set(got) - set(expect_lanes)):
            problems.append("R6 LANE_EXPECT 多档 %r（lanes.json 没声明 ⇒ 那个名字没人管）" % n)

    # R7 DEAD_LANES 键
    if purity.get("dead") is not None:
        got, want = set(purity["dead"]), set(dead)
        if got != want:
            for n in sorted(want - got):
                problems.append("R7 check-lane-purity.py 的 DEAD_LANES 缺死档 %r" % n)
            for n in sorted(got - want):
                problems.append("R7 DEAD_LANES 多死档 %r（lanes.json 没声明）" % n)

    # R8 plugins.json lane_expect 键 == site_visible 档
    if plugins.get("lanes"):
        got, want = set(plugins["lanes"]), set(site)
        if got != want:
            for n in sorted(want - got):
                problems.append("R8 plugins.json 的 lane_expect 缺档 %r" % n)
            for n in sorted(got - want):
                problems.append("R8 plugins.json 的 lane_expect 多档 %r" % n)

    # R9 死档不许出现在"活档"位置
    for n in dead:
        if n in (lanejs.get("files") or {}):
            problems.append("R9 死档 %r 仍出现在 lane.js 的 FILES（选档器会 404 到死档）" % n)
        if n in (lanejs.get("order") or []):
            problems.append("R9 死档 %r 仍出现在 lane.js 的 order" % n)
        if n in (purity.get("expect") or {}):
            problems.append("R9 死档 %r 仍出现在 LANE_EXPECT" % n)
        if n in (plugins.get("lanes") or []):
            problems.append("R9 死档 %r 仍出现在 plugins.json 的 lane_expect" % n)
        if any(p[0] == n for p in (genlanes.get("pairs") or [])):
            problems.append("R9 死档 %r 仍会被 gen-lanes.sh 写进站点清单" % n)

    # R10 站点清单生成器与选档器互相包含（单向漏 ⇒ 404 / 永不选中）
    if genlanes.get("pairs") and lanejs.get("files"):
        g = {p[0] for p in genlanes["pairs"]}
        f = set(lanejs["files"]) - set(aliases)     # 别名不单独部署
        if g != f:
            for n in sorted(f - g):
                problems.append("R10 选档器认识 %r，但 gen-lanes.sh 永远不会写它进清单" % n)
            for n in sorted(g - f):
                problems.append("R10 gen-lanes.sh 会写 %r，但选档器的 FILES 里没有（选了就 404）" % n)
    return problems


# ── 读真仓库 ────────────────────────────────────────────────────────────────

def read_all():
    with open(repo("build", "lanes.json"), encoding="utf-8") as fh:
        decl = json.load(fh)
    def _r(*p):
        with open(repo(*p), encoding="utf-8") as fh:
            return fh.read()
    return (decl,
            parse_lane_js(_r("bridge", "lane.js")),
            parse_gen_lanes(_r("build", "gen-lanes.sh")),
            parse_lane_purity(_r("build", "113", "check-lane-purity.py")),
            parse_plugins(_r("build", "plugins.json")))


def main(argv):
    try:
        decl, lanejs, genlanes, purity, plugins = read_all()
    except (OSError, ValueError) as e:
        print("FATAL: 读不到声明/消费方（%s）—— fail-closed，不当通过" % e, file=sys.stderr)
        return 2
    problems = reconcile(decl, lanejs, genlanes, purity, plugins)
    n_site = len([1 for v in (decl.get("lanes") or {}).values() if v.get("site_visible")])
    if problems:
        print("档知识单源对账：%d 处漂移" % len(problems), file=sys.stderr)
        for p in problems:
            print("  ✗ %s" % p, file=sys.stderr)
        return 1
    print("档知识单源对账 OK（%d 个站内档 / %d 个车道名 / %d 个死档 / 4 个消费方全部对齐）"
          % (n_site, len(decl.get("lanes") or {}), len(decl.get("dead_lanes") or {})))
    return 0


# ── 自证（三类用例齐：正常不报 / 该报的必须报 / 空输入必须报）──────────────────
_DECL = {
    "dead_lanes": {"threads": "畸形档"},
    "precedence": ["w64", "w64-base", "base"],
    "lanes": {
        "base": {"arch": "wasm32", "site_dir": "", "site_visible": True, "role": "product"},
        "w64": {"arch": "wasm64", "site_dir": "w64/", "site_visible": True, "role": "product"},
        "w64-base": {"arch": "wasm64", "site_dir": "w64-base/", "site_visible": True,
                     "role": "fallback"},
        "w64-threads": {"arch": "wasm64", "site_dir": "w64/", "site_visible": False,
                        "role": "legacy-alias"},
        "product": {"arch": "wasm32", "site_dir": None, "site_visible": False,
                    "role": "build-mode"},
    },
}

_LANEJS_OK = """\
  var FILES = {
    w64: { lane: 'w64', dir: 'w64/' },
    'w64-threads': { lane: 'w64', dir: 'w64/' },
    'w64-base': { lane: 'w64-base', dir: 'w64-base/' },
    base: { lane: 'base', dir: '' }
  };
      var order = ['w64', 'w64-base', 'base'];
      var m = /[?&]lane=(w64|w64-threads|w64-base|base)(?:&|$)/.exec(q);
"""
_GEN_OK = """\
has3 ""          && add base
has3 w64         && add w64
has3 w64-base    && add w64-base
"""
_PURITY_OK = """\
LANE_EXPECT = {
    "base": "wasm32",
    "w64": "wasm64",
    "w64-base": "wasm64",
    "product": "wasm32",
}
DEAD_LANES = {"threads": "wasm32+atomics 多线程畸形档"}
"""
_PLUGINS_OK = '{"lane_expect": {"base": {}, "w64": {}, "w64-base": {}}}'


def _rec(lanejs=None, gen=None, purity=None, plugins=None, decl=None):
    return reconcile(
        decl or _DECL,
        parse_lane_js(lanejs if lanejs is not None else _LANEJS_OK),
        parse_gen_lanes(gen if gen is not None else _GEN_OK),
        parse_lane_purity(purity if purity is not None else _PURITY_OK),
        parse_plugins(plugins if plugins is not None else _PLUGINS_OK))


CASES = [
    ("★ 正常不报：四份消费方与声明逐条对齐", lambda: _rec() == []),
    # —— 该报的必须报 ——
    ("★ 反向 R1：lane.js 少一档 ⇒ 必报（选了就回退/404）",
     lambda: any("R1" in p and "缺档" in p
                 for p in _rec(lanejs=_LANEJS_OK.replace(
                     "    'w64-base': { lane: 'w64-base', dir: 'w64-base/' },\n", "")))),
    ("★ 反向 R2：FILES 目录漂一个字 ⇒ 必报",
     lambda: any("R2" in p for p in _rec(lanejs=_LANEJS_OK.replace("dir: 'w64/'", "dir: 'w64x/'", 1)))),
    ("★ 反向 R3：order 与 precedence 不同 ⇒ 必报",
     lambda: any("R3" in p for p in _rec(lanejs=_LANEJS_OK.replace(
         "['w64', 'w64-base', 'base']", "['base', 'w64']")))),
    ("★ 反向 R4：覆盖正则漏一档 ⇒ 必报（显式覆盖选不到）",
     lambda: any("R4" in p and "缺档" in p for p in _rec(
         lanejs=_LANEJS_OK.replace("(w64|w64-threads|w64-base|base)", "(w64|base)")))),
    ("★ 反向 R5：gen-lanes 少写一档 ⇒ 必报（站点清单少一档）",
     lambda: any("R5" in p and "缺" in p
                 for p in _rec(gen=_GEN_OK.replace("has3 w64-base    && add w64-base\n", "")))),
    ("★ 反向 R6：LANE_EXPECT 架构写错 ⇒ 必报（判据错档）",
     lambda: any("R6" in p for p in _rec(purity=_PURITY_OK.replace('"w64": "wasm64"', '"w64": "wasm32"')))),
    ("★ 反向 R6b：LANE_EXPECT 缺一个车道名 ⇒ 必报",
     lambda: any("R6" in p and "缺档" in p for p in _rec(purity=_PURITY_OK.replace(
         '    "product": "wasm32",\n', "")))),
    ("★ 反向 R7：DEAD_LANES 漏了死档 ⇒ 必报（畸形档会重新合法）",
     lambda: any("R7" in p for p in _rec(purity=_PURITY_OK.replace(
         'DEAD_LANES = {"threads": "wasm32+atomics 多线程畸形档"}', "DEAD_LANES = {}")))),
    ("★ 反向 R8：plugins.json 的 lane_expect 缺档 ⇒ 必报",
     lambda: any("R8" in p for p in _rec(plugins='{"lane_expect": {"base": {}}}'))),
    ("★ 反向 R9：死档回到 lane.js 的 FILES ⇒ 必报（会 404 到死档）",
     lambda: any("R9" in p for p in _rec(lanejs=_LANEJS_OK.replace(
         "    base: { lane: 'base', dir: '' }",
         "    base: { lane: 'base', dir: '' },\n    threads: { lane: 'threads', dir: 'threads/' }")))),
    ("★ 反向 R9b：死档回到 LANE_EXPECT ⇒ 必报",
     lambda: any("R9" in p for p in _rec(purity=_PURITY_OK.replace(
         '    "product": "wasm32",', '    "product": "wasm32",\n    "threads": "wasm32",')))),
    ("★ 反向 R10：gen-lanes 写得出、选档器不认识 ⇒ 必报（选了 404）",
     lambda: any("R10" in p for p in _rec(gen=_GEN_OK + "has3 bogus && add bogus\n"))),
    # —— 空输入必须报 ——
    ("★ 空声明（没有 site_visible 档）⇒ 必报（零值守卫）",
     lambda: any("零值守卫" in p for p in _rec(decl={"lanes": {}, "precedence": [], "dead_lanes": {}}))),
    ("★ 消费方块整个缺失 ⇒ 必报（不许把「找不到」当对齐）",
     lambda: any("找不到" in p for p in _rec(lanejs="// empty", gen="", purity="", plugins="{}"))),
]


def _selftest():
    n = bad = 0
    for name, fn in CASES:
        n += 1
        try:
            ok = bool(fn())
        except Exception as e:                    # noqa: BLE001 —— 自证里任何异常都是红
            ok = False
            name = "%s（异常：%r）" % (name, e)
        if not ok:
            bad += 1
        print("%s | check-lanes-single-source/%s" % ("PASS" if ok else "fail", name))
    print("\n=== check-lanes-single-source 自证：%d PASS / %d fail ===" % (n - bad, bad))
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(_selftest() if "--selftest" in sys.argv else main(sys.argv[1:]))
