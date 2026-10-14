#!/usr/bin/env python3
# Octave-Full-Wasm — **额外内容端口闸门**（接缝 §4/§5 第①步）
# Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么存在：端口（`content-list.schema.json` + `validate-content-list.py`）是
# **应用核心的接受面** —— 生产者按它出表、宿主按它读表。但"形状一致"如果只靠校验器
# **自己说**合规，就是"没有对账器的必须一致"（本仓 C4 纪律）⇒ 会漂。本闸门是那个对账器：
#   R1 **golden 必须全过** —— 三个真样件（货架真输出 / 工具链 / 运行时）逐一过校验器；
#   R2 **bad 必须全红** —— `bad/` 每个夹具都必须被拒（**反向断言**：该报错的必须报错）；
#      且 `--site` 模式对 `absolute-url-site.json` **必须**红（证明 `--site` 不是摆设）；
#   R3 **词表单一产地** —— schema 里 `form`/`content` 的 enum 就是校验器读的那份
#      （校验器不硬编码枚举 ⇒ 防"两处各写一份"）；这里断言 schema 真的有这两个 enum；
#   R4 **golden 覆盖两个形态** —— 至少一个 `form:"pkg"`（包）与一个 `form:"tree"`（能力层）
#      （接缝 §2 的关键判决：能力层是普通条目 ⇒ 样件必须体现它，否则判决没被验过）。
#
# stdout 裸值契约：`ok` / `PROBLEM: <哪条>`。退出码 0 / 1。
# 用法：python3 build/extra-content/check-content-port.py ／ --selftest
import argparse
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA = os.path.join(HERE, "content-list.schema.json")
VALIDATOR = os.path.join(HERE, "validate-content-list.py")
GOLDEN = os.path.join(HERE, "golden")
BAD = os.path.join(HERE, "bad")
PY = sys.executable or "python3"


def check(schema_path=SCHEMA, validator=VALIDATOR, golden=GOLDEN, bad=BAD):
    """纯函数式检查（路径可注入 ⇒ 自证不碰真目录）。返回问题清单。"""
    probs = []

    # R3 词表单一产地
    try:
        schema = json.load(open(schema_path, encoding="utf-8"))
        form_enum = schema["$defs"]["entry"]["properties"]["form"]["enum"]
        content_enum = schema["$defs"]["entry"]["properties"]["content"]["items"]["enum"]
    except Exception as e:
        return ["R3 schema 读不了或缺 enum：%r" % e]
    if not form_enum or not content_enum:
        probs.append("R3 schema 的 form/content enum 为空 —— 词表没有产地（零值守卫）")

    def runv(args):
        r = subprocess.run([PY, validator] + args, capture_output=True, text=True)
        return r.returncode, (r.stdout + r.stderr).strip()

    # R1 golden 必须全过
    gfiles = sorted(f for f in os.listdir(golden) if f.endswith(".json")) if os.path.isdir(golden) else []
    if not gfiles:
        probs.append("R1 golden/ 里没有样件 —— 空不是通过（零值守卫）")
    forms_seen = set()
    for f in gfiles:
        p = os.path.join(golden, f)
        rc, out = runv(["--list", p])
        if rc != 0:
            probs.append("R1 golden/%s 未过校验（rc=%d）：%s" % (f, rc, out[:160]))
        else:
            try:
                doc = json.load(open(p, encoding="utf-8"))
                for e in doc.get("entries", doc.get("packs", [])):
                    if e.get("form"):
                        forms_seen.add(e["form"])
            except Exception:
                pass

    # R2 bad 必须全红（+ --site 模式专项）
    bfiles = sorted(f for f in os.listdir(bad) if f.endswith(".json")) if os.path.isdir(bad) else []
    if not bfiles:
        probs.append("R2 bad/ 里没有反向夹具 —— 空不是通过（零值守卫）")
    for f in bfiles:
        p = os.path.join(bad, f)
        args = ["--list", p] + (["--site"] if "site" in f else [])
        rc, out = runv(args)
        if rc == 0:
            probs.append("R2 bad/%s 竟被判合规（假绿！）%s" % (f, "" if "site" in f else ""))
    # 专项：站点态夹具在 --site 下必须红
    sitespec = os.path.join(bad, "absolute-url-site.json")
    if os.path.exists(sitespec):
        rc, _ = runv(["--list", sitespec, "--site"])
        if rc == 0:
            probs.append("R2 absolute-url-site.json 在 --site 下竟合规 ⇒ --site 开关是摆设")

    # R4 golden 覆盖两个形态（pkg + tree）
    if "pkg" not in forms_seen:
        probs.append("R4 golden 里没有 form:\"pkg\" 的样件（包形态没被验过）")
    if "tree" not in forms_seen:
        probs.append("R4 golden 里没有 form:\"tree\" 的样件（能力层判决没被验过）")
    return probs


# ── 自证：三类用例齐备 ────────────────────────────────────────────────────────
def selftest():
    cases = []

    def add(name, fn, want_ok):
        cases.append((name, fn, want_ok))

    # ① 正常不报（真目录）
    add("正常：真 golden 全过 + bad 全红 ⇒ 不报", lambda: check(), True)

    # ② 该报的必须报 —— 用临时夹具造"坏"
    def with_tmp(mutate):
        def fn():
            with tempfile.TemporaryDirectory() as d:
                g = os.path.join(d, "golden"); b = os.path.join(d, "bad")
                os.makedirs(g); os.makedirs(b)
                # 复制真 golden/bad
                import shutil
                for f in os.listdir(GOLDEN): shutil.copy(os.path.join(GOLDEN, f), g)
                for f in os.listdir(BAD): shutil.copy(os.path.join(BAD, f), b)
                mutate(g, b)
                return check(schema_path=SCHEMA, validator=VALIDATOR, golden=g, bad=b)
        return fn

    def drop_tree(g, b):            # 删掉唯一的 tree 样件 ⇒ R4 必须报
        os.remove(os.path.join(g, "runtime.json"))
        os.remove(os.path.join(g, "toolchain.json"))
    add("★ golden 缺 tree 形态 ⇒ 必须报（R4）", with_tmp(drop_tree), False)

    def make_bad_green(g, b):       # 把 bad 换成 golden 的内容 ⇒ bad 竟合规 ⇒ R2 必须报
        import shutil
        for f in os.listdir(b):
            shutil.copy(os.path.join(g, "shelf.json"), os.path.join(b, f))
    add("★ bad 全是合规表（假绿）⇒ 必须报（R2）", with_tmp(make_bad_green), False)

    def empty_golden(g, b):         # 清空 golden ⇒ 零值守卫必须报
        import shutil
        shutil.rmtree(g); os.makedirs(g)
    add("★ golden 空 ⇒ 必须报（R1 零值守卫）", with_tmp(empty_golden), False)

    def empty_bad(g, b):
        import shutil
        shutil.rmtree(b); os.makedirs(b)
    add("★ bad 空 ⇒ 必须报（R2 零值守卫）", with_tmp(empty_bad), False)

    # ③ 空输入必须报
    def bad_schema():
        with tempfile.TemporaryDirectory() as d:
            sp = os.path.join(d, "s.json"); open(sp, "w").write("{}")
            return check(schema_path=sp)
    add("★ schema 空/缺 enum ⇒ 必须报（R3）", bad_schema, False)

    npass = nfail = 0
    for name, fn, want_ok in cases:
        try:
            probs = fn(); got = (probs == [])
        except Exception as e:
            probs, got = ["EXC %r" % e], False
        ok = (got == want_ok)
        npass += 1 if ok else 0; nfail += 0 if ok else 1
        print("%s | %s%s" % ("PASS" if ok else "fail", name,
                             "" if ok else "  → %s" % (probs[:2] if probs else "（期望报但没报）")))
    print("=== check-content-port 自证：%d PASS / %d fail ===" % (npass, nfail))
    return 0 if nfail == 0 else 1


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args(argv)
    if a.selftest:
        return selftest()
    probs = check()
    if probs:
        for p in probs:
            print("PROBLEM: %s" % p)
        return 1
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
