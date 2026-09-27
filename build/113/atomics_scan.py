#!/usr/bin/env python3
# Octave-Full-Wasm — **atomics 扫描器**：逐成员检查静态库/`.oct` 是否带 `atomics` 特征（branch threads，2026-09-27）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

"""给 wasm 归档/模块的每个成员检查 `atomics` 特征段。

## 它是干什么用的（为什么必须可复跑）

线程档（`-pthread`）的 wasm 内存是 **shared**，而 `wasm-ld` 在 shared-memory 链接上**要求链上每个
对象**都声明 `atomics`/`bulk-memory` 特征。实测错误原文：

    wasm-ld: error: --shared-memory is disallowed by fccache.o because it was
            not compiled with 'atomics' or 'bulk-memory' features.

所以"这批库重编好了没有"的唯一判据就是**逐成员扫字节**。这不是"顺手写的小工具"——
2026-09-27 的农场重编里，它一次不漏地抓出了**三个静默陷阱**（构建 rc=0、脚本的符号自检全过，
产物却是旧的）：

  1. `make` 认为无事可做（影子只改编译器、不改 Makefile ⇒ mtime 判定目标都是新的）；
  2. `emcmake`/`emconfigure` 把编译器钉成绝对路径 ⇒ 脚本自己写的 `CFLAGS` 绕过影子；
  3. `if [ ! -s $PREFIX/lib/x.a ]` 式的"已有就跳过" ⇒ 上一轮的非 atomics 产物原样留着。

三者都只在**产物**上现形（见 `PLAN-threads.md` §6 的表）。

用法：
  python3 build/113/atomics_scan.py <文件|归档> …      # 逐个报"成员数 / 缺 atomics 数"
  python3 build/113/atomics_scan.py --quiet <…>        # 只列**有缺**的（脚本里当判据用）
  python3 build/113/atomics_scan.py --selftest
退出码：0 = 全部成员都带 atomics；1 = 有缺；2 = 用法错。
"""
import os
import shutil
import subprocess
import sys
import tempfile

MARK = b"atomics"


def scan_file(path):
    """单个文件（`.o` / `.wasm` / `.oct`）：返回 (是否 wasm 对象, 是否带 atomics)。

    ⚠️ **必须读全文件**（2026-09-27 实测踩到）：第一版只读前 1MB，而 `target_features` 段在对象
    **尾部**（代码段之后）—— 树里的 `libarray_la-Array-i.o`（3.3MB）因此被**假报**成"缺 atomics"，
    差一点让我去查一个不存在的构建问题。语义上：**找到 = 证明有**（哪怕只读了前 1MB 也是证明）；
    **没找到 = 什么都不能说明**（可能读得太短）⇒ 只有读全文件，"没找到"才等于"真的没有"。
    """
    with open(path, "rb") as fh:
        b = fh.read()
    if b[:4] != b"\0asm":
        return False, None
    return True, MARK in b


def scan(path):
    """归档 → 逐成员；普通文件 → 直接扫。返回 dict。"""
    if not os.path.exists(path):
        return {"path": path, "missing": True}
    if path.endswith(".a"):
        d = tempfile.mkdtemp()
        try:
            subprocess.run(["ar", "x", path], cwd=d,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            n = bad = 0
            first = ""
            for f in sorted(os.listdir(d)):
                p = os.path.join(d, f)
                if not os.path.isfile(p) or os.path.getsize(p) < 8:
                    continue
                is_wasm, ok = scan_file(p)
                if not is_wasm:
                    continue        # 空成员/非 wasm 成员（有些归档混着东西）不算
                n += 1
                if not ok:
                    bad += 1
                    first = first or f
            return {"path": path, "members": n, "missing": False,
                    "bad": bad, "example": first}
        finally:
            shutil.rmtree(d, ignore_errors=True)
    is_wasm, ok = scan_file(path)
    if not is_wasm:
        return {"path": path, "missing": False, "members": 0, "bad": 0, "example": "",
                "note": "不是 wasm"}
    return {"path": path, "missing": False, "members": 1, "bad": 0 if ok else 1,
            "example": "" if ok else os.path.basename(path)}


def main(argv):
    quiet = "--quiet" in argv
    args = [a for a in argv if not a.startswith("--")]
    if not args:
        print(__doc__.strip().split("用法：")[-1].strip(), file=sys.stderr)
        return 2
    total_bad = 0
    total_empty = 0
    for path in args:
        r = scan(path)
        if r.get("missing"):
            print("%-52s （不存在）" % path)
            total_bad += 1                     # 指定的东西不在 ⇒ 也算问题（别静默跳过）
            continue
        if r.get("note"):
            print("%-52s %s" % (path, r["note"]))
            continue
        if r["members"] == 0:
            # ★ 零值守卫：**空的**归档/模块不是"合规"，是"这批没编成"——
            #   实测里"空"与"合规"长得一模一样（0 个成员当然 0 个缺），必须分开报。
            print("%-52s ⚠️ wasm 成员 0 ⇒ 空归档/空模块（**不是合规**，是没编成）" % path)
            total_empty += 1
            continue
        total_bad += r["bad"]
        if r["bad"] or not quiet:
            print("%-52s wasm 成员 %4d，缺 atomics %4d %s"
                  % (path, r["members"], r["bad"],
                     ("例：" + r["example"]) if r["bad"] else ""))
    if total_bad or total_empty:
        if total_bad:
            print("★ 有 %d 个成员缺 atomics ⇒ shared-memory 链接会被 wasm-ld 拒（别往下走）"
                  % total_bad, file=sys.stderr)
        if total_empty:
            print("★ 有 %d 个归档/模块是**空的**（成员 0）⇒ 那不是合规，是没编成"
                  % total_empty, file=sys.stderr)
        return 1
    return 0


# ── 自证（三类：带标记 / 不带标记 / 非 wasm 与空归档不许算数）────────────────────
def _mk(d, name, body, wasm=True):
    p = os.path.join(d, name)
    with open(p, "wb") as fh:
        fh.write(b"\0asm\x01\0\0\0" if wasm else b"not a wasm")
        fh.write(body)
    return p


def _cases():
    d = tempfile.mkdtemp()
    good = _mk(d, "good.o", b"...atomics...bulk-memory...")
    bad = _mk(d, "bad.o", b"...bulk-memory...")
    junk = _mk(d, "junk.txt", b"hello", wasm=False)
    a_good = os.path.join(d, "good.a")
    a_bad = os.path.join(d, "bad.a")
    subprocess.run(["ar", "rcs", a_good, good], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(["ar", "rcs", a_bad, bad], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(["ar", "rcs", os.path.join(d, "empty.a"), ], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    # 大对象：标记放在 1.5MB 之后（复现"只读前 1MB"的假红）
    big = _mk(d, "big.o", b"\0" * (1536 * 1024) + b"...atomics...")
    return d, [
        ("★ 大对象（标记在 1MB 之后）也必须算「有 atomics」（假红回归）",
         lambda: scan(big)["bad"] == 0),
        ("带 atomics 的成员 ⇒ 缺 0", lambda: scan(good)["bad"] == 0),
        ("★ 不带 atomics ⇒ 必须报 1", lambda: scan(bad)["bad"] == 1),
        ("归档里混着好/坏 ⇒ 只数坏的", lambda: scan(a_bad)["bad"] == 1),
        ("全好的归档 ⇒ 缺 0", lambda: scan(a_good)["bad"] == 0),
        ("**非 wasm 文件 ⇒ 不算数**（否则空文件会假红）", lambda: scan(junk)["members"] == 0),
        ("空归档 ⇒ 成员 0（scan 的原始读数）",
         lambda: scan(os.path.join(d, "empty.a"))["members"] == 0),
        ("★ **空归档必须被判为问题**（零值守卫：`main` 返回非 0，不许静默通过）",
         lambda: main([os.path.join(d, "empty.a")]) == 1),
        ("★ 指定的文件不存在也算问题（`main` 返回非 0）", lambda: main(["/nope/x.a"]) == 1),
        ("不存在的文件 ⇒ 明确报 missing", lambda: scan("/nope/x.a").get("missing") is True),
    ]


def selftest():
    d, cases = _cases()
    bad = 0
    try:
        for name, fn in cases:
            try:
                ok = bool(fn())
            except Exception as e:                     # noqa: BLE001
                ok, name = False, "%s（异常 %r）" % (name, e)
            print("%s | %s" % ("PASS" if ok else "fail", name))
            bad += 0 if ok else 1
    finally:
        shutil.rmtree(d, ignore_errors=True)
    print("=== atomics_scan 自证：%d PASS / %d fail ===" % (len(cases) - bad, bad))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(selftest() if "--selftest" in sys.argv else main(sys.argv[1:]))
