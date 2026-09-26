#!/usr/bin/env python3
# Octave-Full-Wasm — `check-build-manifest.py` 的**反向断言套件**（批次 A1）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么要有它：`check-build-manifest.py` 是 **fail-closed 的判定方** —— 它说 ok，产物才可部署。
# 一个"永远说 ok"的判定器比没有判定器更糟（它会让人以为查过了）。所以它的**每一条规则**
# 都必须有一条"该拒的必须拒"的反向断言（AGENTS「事实纪律」第 4 条）。
#
# 跑法（对着一件**真产物**跑，因为文件配对那一项要重新哈希三个大件）：
#   python3 build/113/test-manifest-check.py /src/websrc/a1-verify-product
# 退出码：0 = 全部按预期；1 = 有不符预期的用例（会逐条打出来）
#
# 覆盖的用例：
#   基准   原样重判 ⇒ 必须 ok（否则后面的"拒"没有意义）
#   反证   9 条：jspi_entry / gl4es / main_module / idbfs / fontconfig / fonts /
#                simd.v128 / jspi_glue_suspending / 清单里的文件 sha（配对）
#   反证   声明里多一个**未知键** ⇒ 必须拒（拼错键名不许被静默放过）
import copy
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CHECK = os.path.join(HERE, "check-build-manifest.py")
TMP = "/tmp/a1-manifest-tamper.json"
DECL = "/tmp/a1-manifest-decl.json"


CNT = [0, 0]          # [pass, fail]


def run(man_obj, declared_obj, label, expect_rc, out_dir):
    json.dump(man_obj, open(TMP, "w"))
    json.dump(declared_obj, open(DECL, "w"))
    r = subprocess.run(["python3", CHECK, TMP, DECL, "--out-dir", out_dir],
                       capture_output=True, text=True)
    why = [l.strip() for l in r.stdout.splitlines() if l.strip().startswith("✗")]
    ok = (r.returncode == expect_rc)
    CNT[0 if ok else 1] += 1
    print("%s | %-42s rc=%d(期望%d) %s" % (
        "PASS" if ok else "fail", label, r.returncode, expect_rc,
        ":: " + (why[0][:105] if why else "(无 ✗ 行)")))
    return ok


def main(argv):
    if len(argv) < 2:
        print("用法: test-manifest-check.py <产物目录>", file=sys.stderr)
        return 2
    out_dir = argv[1]
    man_path = os.path.join(out_dir, "octave.build.json")
    man = json.load(open(man_path, encoding="utf-8"))
    if not man.get("declared"):
        print("FATAL: %s 的 declared 是 null —— 先用 `relink.sh verify <模式> --out %s` 判一次"
              % (man_path, out_dir), file=sys.stderr)
        return 2
    declared = man["declared"]
    print("清单 verdict 原值 = %s（模式 %s）" % (man["verdict"], (man.get("build") or {}).get("mode")))
    allok = run(dict(man), declared, "基准：原样重判 ⇒ ok", 0, out_dir)

    def taint(path, value):
        m = copy.deepcopy(man)
        node = m
        for k in path[:-1]:
            node = node[k]
        node[path[-1]] = value
        return m

    cases = [
        (["measured", "jspi_entry"], False, "jspi_entry → False"),
        (["measured", "gl4es", "symbol_hits"], 0, "gl4es.symbol_hits → 0"),
        (["measured", "main_module"], 1, "main_module → 1"),
        (["measured", "idbfs"], False, "idbfs → False"),
        (["measured", "fontconfig"], False, "fontconfig → False"),
        (["measured", "fonts"], ["FreeSans.otf"], "fonts 只留 1 个"),
        (["measured", "simd", "v128"], 0, "simd.v128 → 0"),
        (["measured", "jspi_glue_suspending"], 3, "胶水里出现 3 处 Suspending"),
        (["measured", "files", "octave.wasm", "sha256"], "deadbeef" * 8, "清单里的文件 sha 被改（配对）"),
    ]
    for path, val, label in cases:
        allok &= run(taint(path, val), declared, "反证：" + label, 3, out_dir)

    d = copy.deepcopy(declared)
    d["simd_typo"] = True
    allok &= run(dict(man), d, "反证：声明里多一个未知键", 3, out_dir)

    print("\n=== 反向断言总账：%s ===(%d PASS / %d fail)" % (
        "**全部按预期**" if allok else "**有不符预期的**", CNT[0], CNT[1]))
    return 0 if allok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
