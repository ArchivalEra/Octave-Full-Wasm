#!/usr/bin/env python3
# Octave-Full-Wasm — **构建输入不变式的见证**（工单 53；Einfacht #6 ② "输入要有便宜的落点" 的本仓实例）
# Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么存在：产物出生前，它的**配方**就应该是可查的事实。今天两起事故都发生在配方层而不是产物层
#   （① `-flto` 漂移进 link-web.sh 的 EXC_FLAGS → 页面 dlopen 崩；② w64 车道少了
#   `-sMEMORY64=1` → 混编 wasm32 对象）。两者都**只读仓库文件就能查**——所以放进 witness 档
#   每提交真跑，不构建、不碰容器、不依赖产物。
#
# **声明式**（数据不是代码）：检查项在 build/build-inputs.json（path / must_contain /
#   must_not_contain / why）—— 换仓库、换车道只改数据，不改本脚本（Einfacht 的"可插拔"形状）。
#
# 判据（stdout 裸值契约，同 witness）：`ok` ⇒ 全过；`DRIFT: …` ⇒ 有输入漂移。
# 退出码恒 0（判据是 stdout，不是 rc）——与 witness-build-provenance.py 同形。
# 用法：python3 build/113/witness-build-inputs.py [清单路径]  ／ --selftest
import json
import os
import sys

REPO = os.environ.get("GATE_REPO") or os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_SPEC = os.path.join(REPO, "build", "build-inputs.json")


def check(spec, read=None):
    """纯逻辑（自证走这里）：返回见证输出串。read(path)->str|None 可注入。"""
    read = read or (lambda p: open(p, encoding="utf-8", errors="replace").read()
                    if os.path.isfile(p) else None)
    checks = (spec or {}).get("checks") or []
    if not checks:
        return "DRIFT: 清单里没有 checks（零值守卫：空清单不是通过）"
    for c in checks:
        path = c.get("path")
        if not path:
            return "DRIFT: 检查项缺 path: %r" % (c,)
        text = read(os.path.join(REPO, path) if not os.path.isabs(path) else path)
        if text is None:
            return "DRIFT: 读不到配方文件 %s（输入落点不存在）" % path
        for needle in (c.get("must_contain") or []):
            if needle not in text:
                return "DRIFT: %s 缺少必需片段 %r（%s）" % (path, needle, c.get("why", "")[:60])
        for needle in (c.get("must_not_contain") or []):
            if needle in text:
                return "DRIFT: %s 出现被证伪的片段 %r（%s）" % (path, needle, c.get("why", "")[:60])
    return "ok"


def selftest():
    import tempfile
    d = tempfile.mkdtemp()

    def mk(p, t):
        f = os.path.join(d, p)
        os.makedirs(os.path.dirname(f), exist_ok=True)
        open(f, "w").write(t)
        return f

    def rd(files):
        return lambda p: files.get(os.path.basename(p))

    ok_spec = {"checks": [{"path": "x.sh", "must_contain": ["GOOD"],
                            "must_not_contain": ["BAD"], "why": "w"}]}
    bad_spec = {"checks": [{"path": "x.sh", "must_contain": ["GOOD"],
                             "must_not_contain": ["-flto"], "why": "w"}]}
    miss_spec = {"checks": [{"path": "nope.sh", "must_contain": ["GOOD"], "why": "w"}]}
    empty = {"checks": []}
    cases = [
        ("配方合规 ⇒ ok",
         lambda: check(ok_spec, read=rd({"x.sh": "echo GOOD\n"})) == "ok"),
        ("★ must_not_contain 命中 ⇒ 必须 DRIFT（-flto 形状）",
         lambda: check(bad_spec, read=rd({"x.sh": "echo GOOD -flto\n"})).startswith("DRIFT")),
        ("★ must_contain 缺失 ⇒ 必须 DRIFT（-sMEMORY64=1 形状）",
         lambda: check(ok_spec, read=rd({"x.sh": "echo OTHER\n"})).startswith("DRIFT")),
        ("★ 读不到配方文件 ⇒ 必须 DRIFT（零值守卫：读不到就明说）",
         lambda: check(miss_spec, read=rd({})).startswith("DRIFT")),
        ("★ 清单里没有 checks ⇒ 必须 DRIFT（零值守卫：空清单不是通过）",
         lambda: check(empty).startswith("DRIFT")),
    ]
    bad = 0
    for name, fn in cases:
        ok = bool(fn())
        print("%s | %s" % ("PASS" if ok else "fail", name))
        bad += 0 if ok else 1
    import shutil
    shutil.rmtree(d, ignore_errors=True)
    print("=== witness-build-inputs 自证：%d PASS / %d fail ===" % (len(cases) - bad, bad))
    return 1 if bad else 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    spec_path = next((a for a in argv if not a.startswith("-")), DEFAULT_SPEC)
    try:
        spec = json.load(open(spec_path, encoding="utf-8"))
    except (OSError, ValueError) as e:
        print("DRIFT: 读不到/解析不了清单 %s：%s" % (spec_path, e))
        return 0
    print(check(spec))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
