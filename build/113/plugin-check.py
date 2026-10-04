#!/usr/bin/env python3
# Octave-Full-Wasm — **部件插件登记闸门**（工单 61；Einfacht #9 撤回后的"使用层"落点之一）
# Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么存在：mimalloc 批次把"构建期部件替换"定型为五件套（模式表旋钮 / declared 标签 /
# 产物探针 / 双向判定 / 输入见证），但"登记表 ↔ 产物"这层一致性原来没人查——
# ① 旋钮被删/没生效 ⇒ 产物标签缺席，只有产物出生时的那道判定见过它；
# ② 有人手加旋钮没登记 ⇒ declared 多出陌生键。两条都违反"声明了必须可查"的仓纪律。
#
# 规则（fail-closed；登记表 = build/plugins.json，数据不是代码）：
#   R1 正向：lane_expect 里登记的 (键,值) 必须逐条等于现役产物 declared 的同键值；
#   R2 反向：产物 declared 里不许出现 declared_base_keys ∪ lane_expect 之外的键
#      （"链进去了却没登记"与"登记了却没生效"同罪——工单 59 malloc_drift 的登记层副本）；
#   R3 A/B 同旗标（--ab 模式，按需用）：两件产物的 declared 除显式 --allow 的轴外必须全等
#      （工单 57 混淆变量 —— 基线带 ASSERT 虚报 −39% —— 的机制化）。
#
# stdout 裸值契约：`ok` / `PROBLEM: <哪条> ...`；--ab 模式 `ok` / `MISMATCH: ...`。
# 未启用（无 build/plugins.json）⇒ 明说未启用退 0（可插拔，同 Einfacht #7 体例）。
# 站点读不到 ⇒ SKIP 明说退 0（同 check-facts 规则 D 的"换机器不是错"）。
# 用法：python3 build/113/plugin-check.py [--spec <json>] [--site <dir>] [--ab <dirA> <dirB> --allow malloc] ／ --selftest
import json
import os
import sys

REPO = os.environ.get("GATE_REPO") or os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_SPEC = os.path.join(REPO, "build", "plugins.json")
DEFAULT_SITE = os.environ.get("OCTAVE_WASM_BASE", "/mnt/hdd/octave-wasm-build") + "/site"
LANE_FILES = ("octave.build.json",)


def _load_declared(d):
    """读产物身份证的 declared；读不到 ⇒ None（调用方决定判不判）。"""
    p = os.path.join(d, "octave.build.json")
    try:
        man = json.load(open(p, encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return man.get("declared")


def check_registry(spec):
    """纯逻辑（自证走这里）：登记表自身的形状守卫。返回 None=过，str=问题。"""
    if not isinstance(spec.get("plugins"), list) or not spec["plugins"]:
        return "登记表没有 plugins（零值守卫：空登记表 = 没人被盯）"
    if not isinstance(spec.get("declared_base_keys"), list) or not spec["declared_base_keys"]:
        return "登记表没有 declared_base_keys（没有基础键清单 ⇒ R2 反向断言无从判）"
    if not isinstance(spec.get("lane_expect"), dict) or not spec["lane_expect"]:
        return "登记表没有 lane_expect（每车道期望缺位 ⇒ R1 无从判）"
    for pl in spec["plugins"]:
        for f in ("name", "lanes", "declared_label", "probe", "applied"):
            if not pl.get(f):
                return "插件 %r 缺字段 %s（why/probe 必填——没理由的登记没人敢删）" % (pl.get("name"), f)
    return None


def check_site(spec, site, read_declared=_load_declared):
    """R1+R2 对现役站点。返回 [问题字符串]（空 = 全过）。read_declared 可注入（自证）。"""
    problems = []
    base = set(spec.get("declared_base_keys") or [])
    lane_expect = spec.get("lane_expect") or {}
    for lane, expect in sorted(lane_expect.items()):
        d = site if lane == "base" else os.path.join(site, lane)
        declared = read_declared(d)
        if declared is None:
            problems.append("%s: 读不到产物身份证（octave.build.json / declared）" % lane)
            continue
        for k, want in (expect or {}).items():
            got = declared.get(k)
            if got != want:
                problems.append("%s: 登记的 %s=%r 在产物 declared 里是 %r（旋钮没生效？）"
                                % (lane, k, want, got))
        for k in sorted(declared):
            if k in base or k in (expect or {}):
                continue
            problems.append("%s: declared 出现未登记的插件键 %r（链进去了却没登记）" % (lane, k))
    return problems


def check_ab(spec, dir_a, dir_b, allow, read_declared=_load_declared):
    """R3：A/B 两件 declared 除 --allow 轴外必须全等。返回 [差异字符串]。"""
    a, b = read_declared(dir_a), read_declared(dir_b)
    if a is None or b is None:
        return ["A/B 两件产物至少一件读不到 declared（%s / %s）" % (dir_a, dir_b)]
    keys = sorted(set(a) | set(b))
    allow = set(allow or [])
    out = []
    for k in keys:
        if k in allow:
            continue
        if a.get(k) != b.get(k):
            out.append("declared.%s: A=%r B=%r（非 --allow 轴不一致 ⇒ A/B 混淆变量）"
                       % (k, a.get(k), b.get(k)))
    return out


def _selftest():
    import tempfile
    n = bad = 0
    d = tempfile.mkdtemp()

    def lane_dir(root, lane, declared):
        p = os.path.join(root, "" if lane == "base" else lane)
        os.makedirs(p, exist_ok=True)
        json.dump({"declared": declared},
                  open(os.path.join(p, "octave.build.json"), "w"))
        return root

    def rd(files):
        return lambda p: files.get(p)

    spec = {"declared_base_keys": ["main_module", "fonts"],
            "lane_expect": {"base": {}, "w64": {"malloc": "mimalloc"}},
            "plugins": [{"name": "mimalloc", "lanes": ["w64"], "knob": "MALLOC",
                         "declared_label": {"malloc": "mimalloc"},
                         "probe": "mi_version", "applied": "-sMALLOC"}]}
    root = lane_dir(os.path.join(d, "s1"), "base", {"main_module": 2, "fonts": []})
    lane_dir(root, "w64", {"main_module": 2, "fonts": [], "malloc": "mimalloc"})
    files1 = {os.path.join(root, "octave.build.json"): {"main_module": 2, "fonts": []},
              os.path.join(root, "w64", "octave.build.json"): {"main_module": 2, "fonts": [], "malloc": "mimalloc"}}

    def mkread(files):
        # 注入读取器的契约与 _load_declared 相同：收**目录**，自己拼文件名
        return lambda p: files.get(os.path.join(p, "octave.build.json"))

    cases = [
        ("登记表形状守卫：合规 ⇒ 过",
         lambda: check_registry(spec) is None),
        ("★ 登记表空 plugins ⇒ 必须报（零值守卫）",
         lambda: check_registry({"plugins": [], "declared_base_keys": ["a"], "lane_expect": {}}) is not None),
        ("★ 插件缺 probe/why ⇒ 必须报（没理由的登记没人敢删）",
         lambda: check_registry({"plugins": [{"name": "x"}], "declared_base_keys": ["a"], "lane_expect": {"base": {}}}) is not None),
        ("R1+R2：登记与产物一致 ⇒ 过",
         lambda: check_site(spec, root, read_declared=mkread(files1)) == []),
        ("★ R1 正向：登记 malloc 但产物没有 ⇒ 必须报（旋钮没生效）",
         lambda: any("旋钮没生效" in x for x in check_site(
             spec, root, read_declared=mkread({**files1,
             os.path.join(root, "w64", "octave.build.json"): {"main_module": 2, "fonts": []}})))),
        ("★ R2 反向：产物多出未登记键 ⇒ 必须报（链进去了却没登记）",
         lambda: any("未登记" in x for x in check_site(
             spec, root, read_declared=mkread({**files1,
             os.path.join(root, "w64", "octave.build.json"): {"main_module": 2, "fonts": [], "malloc": "mimalloc", "libm": "sleef"}})))),
        ("★ R1：产物身份证读不到 ⇒ 必须报（不许当通过）",
         lambda: any("读不到" in x for x in check_site(spec, root, read_declared=mkread({})))),
        ("★ R3 A/B：仅 --allow 轴不同 ⇒ 过（这正是 A/B 该有的形状）",
         lambda: check_ab(spec, "A", "B", ["malloc"],
                          read_declared=mkread({"A/octave.build.json": {"malloc": "mimalloc", "simd": True},
                                                "B/octave.build.json": {"malloc": "default", "simd": True}})) == []),
        ("★ R3 A/B：非 allow 轴不同 ⇒ 必须报（混淆变量）",
         lambda: check_ab(spec, "A", "B", ["malloc"],
                          read_declared=mkread({"A/octave.build.json": {"malloc": "mimalloc", "simd": True},
                                                "B/octave.build.json": {"malloc": "mimalloc", "simd": False}})) != []),
        ("★ R3 A/B：读不到 declared ⇒ 必须报",
         lambda: check_ab(spec, "A", "B", [], read_declared=mkread({})) != []),
    ]
    for name, fn in cases:
        ok = bool(fn())
        print("%s | %s" % ("PASS" if ok else "fail", name))
        n += 1
        bad += 0 if ok else 1
    import shutil
    shutil.rmtree(d, ignore_errors=True)
    print("=== plugin-check 自证：%d PASS / %d fail ===" % (n - bad, bad))
    return 1 if bad else 0


def main(argv):
    if "--selftest" in argv:
        return _selftest()
    spec_path = DEFAULT_SPEC
    if "--spec" in argv:
        spec_path = argv[argv.index("--spec") + 1]
    if not os.path.isfile(spec_path):
        print("未启用（%s 不存在 ⇒ 明说未启用退 0，可插拔）" % spec_path)
        return 0
    try:
        spec = json.load(open(spec_path, encoding="utf-8"))
    except (OSError, ValueError) as e:
        print("PROBLEM: 登记表读不了/解析不了 %s：%s" % (spec_path, e))
        return 1
    shape = check_registry(spec)
    if shape:
        print("PROBLEM: %s" % shape)
        return 1
    if "--ab" in argv:
        i = argv.index("--ab")
        da, db = argv[i + 1], argv[i + 2]
        allow = argv[argv.index("--allow") + 1].split(",") if "--allow" in argv else []
        mis = check_ab(spec, da, db, allow)
        if mis:
            for x in mis:
                print("MISMATCH: %s" % x)
            return 1
        print("ok（A/B 两件 declared 除 %s 外全等）" % (",".join(allow) or "（无）"))
        return 0
    site = argv[argv.index("--site") + 1] if "--site" in argv else DEFAULT_SITE
    if not os.path.isdir(site):
        print("SKIP: 读不到站点 %s（换了机器/没挂盘 ⇒ 本次未核对，不是通过）" % site)
        return 0
    problems = check_site(spec, site)
    if problems:
        for x in problems:
            print("PROBLEM: %s" % x)
        return 1
    print("ok（插件登记表 ↔ 现役产物 declared 逐车道一致）")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
