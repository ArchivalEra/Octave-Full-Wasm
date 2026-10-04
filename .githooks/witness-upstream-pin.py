#!/usr/bin/env python3
# Octave-Full-Wasm — **上游 pin 见证**（仓库架构批 B4；Einfacht #5 witness 档的同族落地）
# Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
#
# 断言：「容器里的上游树 == build/upstream-pins.json 登记的 fork/分支/commit」。
# 为什么：submodule 指针 bump 了、容器还在用旧 tarball 树——这种漂移不进任何 git 视图，
# 只能靠"每提交把容器树戳一次章"来抓（对偶于 witness-build-inputs 的"配方文件"面）。
#
# 判据（stdout 裸值契约）：`ok` / `DRIFT: …`；退出码恒 0（同 witness-build-inputs）。
# 站点读不到（docker 不在/容器停）⇒ `SKIP: …`（同 check-facts 规则 D："换机器不是错"）。
# 未启用（无 build/upstream-pins.json）⇒ 明说未启用退 0。
# 用法：python3 .githooks/witness-upstream-pin.py ／ --selftest
import json
import os
import sys

# ⚠️ 本文件在 .githooks/ 下（两层到根），别抄 build/113/ 里那套三层 dirname
REPO = os.environ.get("GATE_REPO") or os.path.dirname(
    os.path.dirname(os.path.abspath(__file__)))
DEFAULT_SPEC = os.path.join(REPO, "build", "upstream-pins.json")


def _run(cmd):
    """runner 注入点（自证在夹具上跑，不碰真 docker）。返回 (rc, stdout)。"""
    import subprocess
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        return p.returncode, p.stdout.strip()
    except (OSError, subprocess.TimeoutExpired) as e:
        return -1, str(e)


def check(spec, run=_run):
    """纯逻辑：返回见证输出串。docker 命令按宿主现实要 sudo。"""
    pins = [p for p in (spec.get("pins") or [])
            if p.get("kind") == "toolchain" and p.get("provisioned")] + \
           [p for p in (spec.get("pins") or [])
            if p.get("kind") == "tree" and p.get("provisioned")]
    if not (spec.get("pins") or []):
        return "DRIFT: pins 为空（零值守卫：空断言面不是通过）"
    drifts, skips = [], []
    for p in pins:
        if p["kind"] == "toolchain":
            rc, out = run(["sudo", "-E", "docker", "exec", "o113", "emcc", "--version"])
            if rc != 0 or not out:
                skips.append("%s: 读不到容器 emcc" % p["name"])
                continue
            if p.get("expect_version") and p["expect_version"] not in out.splitlines()[0]:
                drifts.append("%s: emcc 版本漂移（期望 %s，容器 %s）"
                              % (p["name"], p["expect_version"], out.splitlines()[0][:40]))
        else:
            rc, out = run(["sudo", "-E", "docker", "exec", "o113",
                           "cat", os.path.join(p["container_path"], ".upstream-pin")])
            if rc != 0 or not out:
                skips.append("%s: 读不到容器树 stamp（未供给？）" % p["name"])
                continue
            parts = out.split()
            want_commit = (run(["git", "-C", os.path.join(REPO, p["submodule_path"]),
                                "rev-parse", "HEAD"])[1] or "?")
            if len(parts) < 3 or parts[2] != want_commit:
                drifts.append("%s: 容器树 commit=%s ≠ submodule pin=%s（供给后指针 bump 了？）"
                              % (p["name"], parts[2] if len(parts) > 2 else "?", want_commit[:12]))
            elif len(parts) > 3 and parts[3] not in ("0", ""):
                drifts.append("%s: 容器树带本地改动（dirty=%s）" % (p["name"], parts[3]))
    if drifts:
        return "DRIFT: " + "；".join(drifts)
    if skips:
        return "SKIP: " + "；".join(skips) + "（读不到 ⇒ 本次未核对，不是通过）"
    return "ok（%d 个 pin 全部一致）" % len(pins)


def selftest():
    ok_spec = {"pins": [
        {"name": "octave", "kind": "tree", "provisioned": True,
         "submodule_path": "upstream/octave", "container_path": "/x/oct"},
        {"name": "emsdk", "kind": "toolchain", "provisioned": True, "expect_version": "5.0.7"}]}
    empty = {"pins": []}
    def runner(stamp, emcc):
        """夹具 runner：cat 类调用回 stamp，emcc 类调用回版本串。"""
        def _r(cmd):
            joined = " ".join(cmd)
            if " cat " in joined or joined.endswith(" .upstream-pin"):
                return 0, stamp                          # 容器树 stamp（可被改坏）
            if "emcc" in joined:
                return 0, emcc
            return 0, "abc123"                           # git rev-parse = submodule 真实 pin
        return _r

    good = runner("octave wasm/11.3.0 abc123 0",
                  "emcc (Emscripten gcc/clang-like replacement) 5.0.7 (x)")
    drift_commit = runner("octave wasm/11.3.0 DEADBEEF 0",
                          "emcc (Emscripten gcc/clang-like replacement) 5.0.7 (x)")
    drift_dirty = runner("octave wasm/11.3.0 abc123 3",
                         "emcc (Emscripten gcc/clang-like replacement) 5.0.7 (x)")
    drift_ver = runner("octave wasm/11.3.0 abc123 0",
                       "emcc (Emscripten gcc/clang-like replacement) 6.0.10 (x)")
    def unread(cmd):
        joined = " ".join(cmd)
        if " cat " in joined or joined.endswith(" .upstream-pin"):
            return 1, ""                      # 读不到 stamp ⇒ SKIP
        return 0, "emcc (Emscripten gcc/clang-like replacement) 5.0.7 (x)"

    cases = [
        ("stamp commit == pin 且干净 ⇒ ok",
         lambda: check(ok_spec, run=good) == "ok（2 个 pin 全部一致）"),
        ("★ 容器树 commit ≠ pin ⇒ 必须 DRIFT（供给后指针 bump）",
         lambda: check(ok_spec, run=drift_commit).startswith("DRIFT")),
        ("★ 容器树 dirty ⇒ 必须 DRIFT（有人手改了供给树）",
         lambda: check(ok_spec, run=drift_dirty).startswith("DRIFT")),
        ("★ emcc 版本漂移 ⇒ 必须 DRIFT",
         lambda: check(ok_spec, run=drift_ver).startswith("DRIFT")),
        ("★ 读不到合法 stamp ⇒ SKIP（明说未核对，不是通过）",
         lambda: check(ok_spec, run=unread).startswith("SKIP")),
        ("★ pins 为空 ⇒ 必须 DRIFT（零值守卫）",
         lambda: check(empty).startswith("DRIFT")),
    ]
    bad = 0
    for name, fn in cases:
        ok = bool(fn())
        print("%s | %s" % ("PASS" if ok else "fail", name))
        bad += 0 if ok else 1
    print("=== witness-upstream-pin 自证：%d PASS / %d fail ===" % (len(cases) - bad, bad))
    return 1 if bad else 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    spec_path = next((a for a in argv if not a.startswith("-")), DEFAULT_SPEC)
    try:
        spec = json.load(open(spec_path, encoding="utf-8"))
    except (OSError, ValueError) as e:
        print("未启用（%s 读不了：%s）" % (spec_path, e))
        return 0
    print(check(spec))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
