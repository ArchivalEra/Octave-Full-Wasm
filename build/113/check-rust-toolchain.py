#!/usr/bin/env python3
# Octave-Full-Wasm — **G5：Rust 工具链不变式**（工单 63 覆盖矩阵第 5 行）
# Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么需要它（工单 63 G5 原文）：「Rust 工具链钉住了吗？」—— grilling 里人会问的一句，
# 事实化成一个可复跑的判据。判据不是"文件存在"，而是**四条不变式**：
#
#   ① `build/113/rust/rust-toolchain.toml` 的 `channel` 是**具体钉版**（不是 `stable` /
#      `nightly` 这类浮名）—— 浮名每天变，等于没钉（可复现性从根上失守）。
#   ② `Cargo.toml` 的 `crate-type` 必须是 `staticlib`（产品缝是"静态库链进车道构建"，
#      换 cdylib 会让 `octave_rust_sort_f64` 的弱符号判空机制失效 —— E4 的结论）。
#   ③ `panic` 必须是 `abort`（wasm 无 unwind；E2 实测库体检里出现 `__rust_start_panic`
#      之外的东西就意味着 unwind 被启用）。
#   ④ **两档构建脚本都存在且各自钉住 target**：wasm32 走 `wasm32-unknown-emscripten`
#      （rustc 支持），wasm64 走 `build-std` + `wasm64-unknown-unknown`（rustc 无
#      wasm64-emscripten target —— 这是评审 E0–E5 的硬事实，不是选择）。
#
# 与 G1（符号）、G2（数值）的分工：G5 只回答"工具链这个输入钉没钉住"，不碰产物内容。
#
# 用法：
#   python3 build/113/check-rust-toolchain.py             # 判据（stdout 只打 ok / 问题，rc 0/1）
#   python3 build/113/check-rust-toolchain.py --json      # 量到的值（供台账）
#   python3 build/113/check-rust-toolchain.py --selftest  # F1：三类用例（正常/该报/空输入）
#
# 事实键：`rust_patch_toolchain_ok`（值 "ok"，cmd = 本脚本）。**这是声明式一行**：
# 台账里存的是"当轮实测过"，复跑方式就在 cmd 里（事实纪律第 1 条）。
import json
import os
import re
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RUST = os.path.join(REPO, "build", "113", "rust")


def _read(p):
    with open(p, encoding="utf-8") as fh:
        return fh.read()


def check(root=RUST, build_dir=None):
    """返回 (problems, measured)。纯读（自证可喂夹具目录）。"""
    build_dir = build_dir or os.path.dirname(root)
    problems, measured = [], {}

    # ① 钉版 channel
    tc = os.path.join(root, "rust-toolchain.toml")
    if not os.path.isfile(tc):
        problems.append("缺 rust-toolchain.toml（工具链未钉版 ⇒ 换机器/换日子就是另一个编译器）")
    else:
        m = re.search(r'^\s*channel\s*=\s*"([^"]+)"', _read(tc), re.M)
        ch = m.group(1) if m else None
        measured["channel"] = ch
        if not ch:
            problems.append("rust-toolchain.toml 没有 channel")
        elif not re.match(r"^(stable|beta|nightly)-\d{4}-\d{2}-\d{2}$", ch):
            # 只认带日期的钉版；纯 "stable"/"nightly" 是浮名（每天变 ⇒ 不可复现）
            problems.append("channel=%r 不是**钉版**（要 stable-YYYY-MM-DD / nightly-YYYY-MM-DD；"
                            "浮名等于没钉）" % ch)

    # ②③ Cargo.toml 的两条产品缝不变式
    ct = os.path.join(root, "Cargo.toml")
    if not os.path.isfile(ct):
        problems.append("缺 Cargo.toml")
    else:
        s = _read(ct)
        m = re.search(r'crate-type\s*=\s*\[([^\]]*)\]', s)
        cts = re.findall(r'"([^"]+)"', m.group(1)) if m else []
        measured["crate_types"] = cts
        if "staticlib" not in cts:
            problems.append("crate-type=%r 里没有 staticlib（产品缝 = 静态库链进车道构建；"
                            "cdylib 会让弱符号判空（E4）失效）" % cts)
        m = re.search(r'^\s*panic\s*=\s*"([^"]+)"', s, re.M)
        panic = m.group(1) if m else None
        measured["panic"] = panic
        if panic != "abort":
            problems.append("profile.release.panic=%r（wasm 无 unwind ⇒ 必须 abort；E2 库体检结论）"
                            % panic)

    # ④ 两档构建脚本 + 各自的 target
    want = {
        "build-rustsort.sh": ("wasm32", r"wasm32-unknown-emscripten"),
        "build-rustsort-w64.sh": ("wasm64", r"wasm64-unknown-unknown"),
    }
    targets = {}
    for fn, (lane, pat) in want.items():
        p = os.path.join(build_dir, fn)
        if not os.path.isfile(p):
            problems.append("缺 %s（%s 档的 Rust 库构建入口）" % (fn, lane))
            continue
        s = _read(p)
        if not re.search(pat, s):
            problems.append("%s 里找不到 target `%s`（%s 档必须钉这个 target）"
                            % (fn, pat, lane))
        targets[lane] = pat
    measured["targets"] = targets

    return problems, measured


def selftest():
    import tempfile
    cases = []

    def mk(root, toolchain=None, cargo=None, scripts=None, bdir=None):
        os.makedirs(root, exist_ok=True)
        bdir = bdir or os.path.dirname(root)
        if toolchain is not None:
            with open(os.path.join(root, "rust-toolchain.toml"), "w") as fh:
                fh.write(toolchain)
        if cargo is not None:
            with open(os.path.join(root, "Cargo.toml"), "w") as fh:
                fh.write(cargo)
        for fn, body in (scripts or {}).items():
            with open(os.path.join(bdir, fn), "w") as fh:
                fh.write(body)
        return bdir

    GOOD_TC = '[toolchain]\nchannel = "nightly-2026-10-01"\ncomponents = ["rust-src"]\n'
    GOOD_CARGO = ('[package]\nname="x"\n[lib]\ncrate-type = ["staticlib"]\n'
                  '[profile.release]\npanic = "abort"\n')
    S32 = 'rustc --target wasm32-unknown-emscripten\n'
    S64 = 'cargo build -Z build-std --target wasm64-unknown-unknown\n'

    with tempfile.TemporaryDirectory() as tmp:
        # ① 正常：四条全对 ⇒ 不报
        r1 = os.path.join(tmp, "ok", "rust")
        mk(r1, GOOD_TC, GOOD_CARGO, {"build-rustsort.sh": S32, "build-rustsort-w64.sh": S64})
        p, meas = check(r1)
        cases.append(("四条不变式全对 ⇒ 不报（并量出 channel/targets）",
                      p == [] and meas.get("channel") == "nightly-2026-10-01"
                      and meas.get("panic") == "abort"))

        # ② 反向：浮名 channel ⇒ 必报
        r2 = os.path.join(tmp, "float", "rust")
        mk(r2, '[toolchain]\nchannel = "nightly"\n', GOOD_CARGO,
           {"build-rustsort.sh": S32, "build-rustsort-w64.sh": S64})
        cases.append(("★ channel 是浮名 nightly ⇒ 必报（等于没钉）",
                      any("不是**钉版**" in x for x in check(r2)[0])))

        # ③ 反向：crate-type 不是 staticlib ⇒ 必报（E4 弱符号判空的缝）
        r3 = os.path.join(tmp, "cdylib", "rust")
        mk(r3, GOOD_TC, '[package]\nname="x"\n[lib]\ncrate-type = ["cdylib"]\n'
                        '[profile.release]\npanic = "abort"\n',
           {"build-rustsort.sh": S32, "build-rustsort-w64.sh": S64})
        cases.append(("★ crate-type 缺 staticlib ⇒ 必报（cdylib 让弱符号判空失效）",
                      any("staticlib" in x for x in check(r3)[0])))

        # ④ 反向：panic 不是 abort ⇒ 必报
        r4 = os.path.join(tmp, "unwind", "rust")
        mk(r4, GOOD_TC, '[package]\nname="x"\n[lib]\ncrate-type = ["staticlib"]\n'
                        '[profile.release]\npanic = "unwind"\n',
           {"build-rustsort.sh": S32, "build-rustsort-w64.sh": S64})
        cases.append(("★ panic=unwind ⇒ 必报（wasm 无 unwind）",
                      any("panic" in x for x in check(r4)[0])))

        # ⑤ 反向：w64 脚本钉错 target（用 wasm64-unknown-emscripten，rustc 不存在）⇒ 必报
        r5 = os.path.join(tmp, "badtarget", "rust")
        mk(r5, GOOD_TC, GOOD_CARGO,
           {"build-rustsort.sh": S32,
            "build-rustsort-w64.sh": 'cargo build --target wasm64-unknown-emscripten\n'})
        cases.append(("★ w64 脚本钉 wasm64-unknown-emscripten（rustc 无此 target）⇒ 必报",
                      any("wasm64" in x and "target" in x for x in check(r5)[0])))

        # ⑥ 空输入必须报：目录空 ⇒ 三件缺件都要点名（不是"零问题通过"）
        r6 = os.path.join(tmp, "empty", "rust")
        os.makedirs(r6)
        p6, _ = check(r6)
        cases.append(("★ 空目录 ⇒ 必须报（缺 toolchain/Cargo/两脚本，逐条点名）",
                      len([x for x in p6 if "缺" in x]) >= 4))

        bad = 0
        for label, ok in cases:
            print("%s | %s" % ("PASS" if ok else "fail", label))
            bad += 0 if ok else 1
    print("=== check-rust-toolchain 自证：%d PASS / %d fail ===" % (len(cases) - bad, bad))
    return 1 if bad else 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    problems, measured = check()
    if "--json" in argv:
        print(json.dumps({"ok": not problems, "measured": measured,
                          "problems": problems}, ensure_ascii=False, indent=1))
        return 0 if not problems else 1
    if problems:
        print("G5 rust 工具链不变式：%d 个问题" % len(problems), file=sys.stderr)
        for p in problems:
            print("  · %s" % p, file=sys.stderr)
        return 1
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
