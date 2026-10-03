#!/usr/bin/env python3
# Octave-Full-Wasm — **OpenBLAS dgemm 内核 FMA 补丁**（relaxed-simd 实验，工单 52）
# Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么存在：SIMD128 基线**没有 f64 FMA**——gemmkernel_wasm128.c 内循环是
#   `vacc = wasm_f64x2_add(vacc, wasm_f64x2_mul(a, b))`（mul/add 两条指令）。
#   relaxed-simd 的 `f64x2.relaxed_madd` 在 x86 上映射硬件 `vfmadd`——一条顶两条。
#   ⚠ 实测（工单 52）：LLVM **不会**把显式 intrinsic 的 add(mul()) 收缩成 relaxed_madd
#   （ffp-contract 只作用于源级表达式）——带 -mrelaxed-simd 编出来的内核里 relaxed_madd=0。
#   ⇒ 必须**改源码**。
#
# 语义边界（如实）：relaxed_madd 的乘加舍入是实现定义（x86 = 融合 FMA，比 mul+add
#   少一次中间舍入）——BLAS 语境可接受（x86 原生 OpenBLAS 全用 FMA，结果本就随机器差）。
#
# 用法（build-e2-lane.sh 在 E2_RELAXED_FMA=1 时把它加进 PATCHES）：
#   python3 patch-openblas-relaxed-fma.py --check /src/work/OpenBLAS-e2-w64-rsimd
#   python3 patch-openblas-relaxed-fma.py --apply /src/work/OpenBLAS-e2-w64-rsimd
# 退出码契约（同 idle-exit）：0=已打 ⇒ 跳过；1=可打 ⇒ apply 后复查；3=不可打 ⇒ FATAL。
import os
import re
import sys

REL = "kernel/wasm/gemmkernel_wasm128.c"
PAT = re.compile(
    r"wasm_f64x2_add\(\s*(\w+)\s*,\s*"
    r"wasm_f64x2_mul\(\s*(\w+)\s*,\s*(\w+)\s*\)\s*\)")


def rewrite(text):
    n = 0

    def sub(m):
        nonlocal n
        n += 1
        return "wasm_f64x2_relaxed_madd(%s, %s, %s)" % (m.group(2), m.group(3), m.group(1))

    return PAT.sub(sub, text), n


def main(argv):
    if not argv or argv[0] not in ("--apply", "--check", "--revert"):
        print("用法：patch-openblas-relaxed-fma.py --check|--apply|--revert <OpenBLAS 根目录>",
              file=sys.stderr)
        return 2
    mode, root = argv[0], (argv[1] if len(argv) > 1 else "")
    path = os.path.join(root, REL)

    if mode == "--check":
        if not os.path.isfile(path):
            print("不可打（文件不存在：%s）" % path)
            return 3
        text = open(path, encoding="utf-8").read()
        if "wasm_f64x2_relaxed_madd" in text:
            print("已打")
            return 0
        if PAT.search(text):
            print("可打")
            return 1
        print("不可打（内循环片段不符 —— 内核版本变了？）")
        return 3

    if not os.path.isfile(path):
        print("FATAL: %s 不存在" % path, file=sys.stderr)
        return 1
    text = open(path, encoding="utf-8").read()
    if mode == "--revert":
        rev, n = re.subn(r"wasm_f64x2_relaxed_madd\(\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*\)",
                         r"wasm_f64x2_add(\3, wasm_f64x2_mul(\1, \2))", text)
        if n:
            open(path, "w", encoding="utf-8").write(rev)
        print("已还原 %d 处" % n)
        return 0
    new, n = rewrite(text)
    if n == 0:
        print("无可打片段（已打或形状不符）")
        return 3
    open(path, "w", encoding="utf-8").write(new)
    print("已打 %d 处 mul+add ⇒ relaxed_madd" % n)
    return 0


def selftest():
    import tempfile
    import shutil
    bad = 0
    n = 0

    def case(name, cond):
        nonlocal bad, n
        n += 1
        ok = bool(cond)
        print("%s | %s" % ("PASS" if ok else "fail", name))
        bad += 0 if ok else 1

    sample = ("vacc00 = wasm_f64x2_add(\n    vacc00, wasm_f64x2_mul(vrow0, vcol0));\n"
              "vacc10 = wasm_f64x2_add(\n    vacc10, wasm_f64x2_mul(vrow1, vcol0));\n")
    d = tempfile.mkdtemp()
    os.makedirs(os.path.join(d, "kernel/wasm"))
    f = os.path.join(d, REL)

    open(f, "w").write(sample)
    case("未打的内核 ⇒ --check 返 1（可打）", main(["--check", d]) == 1)
    main(["--apply", d])
    new = open(f).read()
    case("apply：两处 ⇒ relaxed_madd（acc 作第三参）",
         new.count("wasm_f64x2_relaxed_madd(vrow0, vcol0, vacc00)") == 1
         and new.count("wasm_f64x2_relaxed_madd(vrow1, vcol0, vacc10)") == 1
         and "wasm_f64x2_add" not in new)
    case("已打 ⇒ --check 返 0（幂等）", main(["--check", d]) == 0)
    case("★ 缺内核文件 ⇒ --check 返 3（零值守卫）", main(["--check", tempfile.mkdtemp()]) == 3)
    open(f, "w").write("int other(void){return 0;}\n")
    case("★ 形状不认识 ⇒ --check 返 3（fail-closed）", main(["--check", d]) == 3)
    # 回环用**单行**样本：apply 会把多行规范化成单行，revert 只保证语义等价，不还原空白。
    sample1 = "vacc = wasm_f64x2_add(vacc, wasm_f64x2_mul(a, b));\n"
    open(f, "w").write(sample1)
    main(["--apply", d])
    main(["--revert", d])
    case("revert 后逐字回到单行原始形状", open(f).read() == sample1)
    shutil.rmtree(d, ignore_errors=True)
    print("=== patch-openblas-relaxed-fma 自证：%d PASS / %d fail ===" % (n - bad, bad))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(selftest() if "--selftest" in sys.argv else main(sys.argv[1:]))
