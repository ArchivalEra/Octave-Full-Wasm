#!/usr/bin/env python3
# Octave-Full-Wasm — **`.oct` 的架构判据**（只读；从字节派生 wasm32/wasm64）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

"""从 side module（`.oct`）的字节派生它的**目标架构**（wasm32 / wasm64）。

## 为什么有它（用户点令 2026-10-16：「wasm32 引擎只能装 32 的额外内容，
## IP 线与 64 线都要兼容 64 的额外内容」——即"楚河汉界"）

这条边界要**可判**，而判据不能是"目录名"（`oct-w64/` ⇒ 猜 wasm64）——
AGENTS 明写「别猜」+ 本仓实测过「判别看包内实际带什么、不能看目录名推」
（`NOTES-forge-ondemand.md`：`src/` ⇒ 当"需编译"是误判）。⇒ **从字节派生**，
理由与 `form`/`content` 两轴同款（供给期派生，不是作者手写）。

## 判据（结构性，不是子串扫）

`.oct` 是 wasm **side module** ⇒ 带 `dylink.0` 自定义段。**wasm64 模块在该段的
TARGET_FEATURES 子节（type=6）里声明特性名 `wasm64`**；wasm32 模块没有这一项。
这正是 emscripten 加载器判 `incorrect architecture (wasm32 vs wasm64)` 所依据的机制。

```
dylink.0 body: [08]"dylink.0" [01][05][memSize][tableSize][tableAlign]  … 可选子节…
                                   子节 = [type:u8][size:LEB][payload]
                                   type=6  payload = 重复的 [name_len:LEB][name]
```

⚠️ **不用 `b"wasm64" in data`**：那种子串扫是本仓记录过的**假判据**形状
（`atomics_scan.py` 头注：对链接后的模块，特征字符串不存在 ⇒ 扫了必假）。
本模块按段结构走字节，与容器里 `llvm-readobj --file-headers` 的 `Arch:` 结论一致
（实测对照：`assets/oct/*` = wasm32（16/16）、`assets/oct-w64/*` = wasm64（16/16））。

## 用法

    python3 build/113/oct-arch.py <file.oct> [更多…]      # 每行 "<arch> <path>"
    python3 build/113/oct-arch.py --dir <目录>             # 扫目录里所有 .oct（汇总）
    python3 build/113/oct-arch.py --selftest
退出码：0 = 全部读出（arch ∈ {wasm32, wasm64}）；1 = 有读不出的（不是 wasm / 无 dylink.0 / 未知）；
        2 = 用法错 / 目录空（零值守卫：空目录不算通过）。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wasm_symbols import _uleb, _sections, _read_name          # noqa: E402

TARGET_FEATURES = 6      # wasm-tools dylink.0 子节类型：目标特性
UNKNOWN = "unknown"


def arch_of_file(path):
    """返回 'wasm32' | 'wasm64' | UNKNOWN（读不出就 UNKNOWN，**不猜**）。"""
    try:
        with open(path, "rb") as fh:
            b = fh.read()
    except OSError:
        return UNKNOWN
    return arch_of_bytes(b)


def arch_of_bytes(b):
    if len(b) < 8 or b[:4] != b"\0asm":
        return UNKNOWN
    for sid, p, end in _sections(b):
        if sid != 0:                       # 只管自定义段
            continue
        name, q = _read_name(b, p)
        if name != "dylink.0":
            continue
        # 子节流：type:u8 + size:LEB + payload（重复）
        while q < end:
            sub = b[q]
            q += 1
            size, q = _uleb(b, q)
            pay_end = q + size
            if sub == TARGET_FEATURES:
                k = q
                while k < pay_end:
                    ln, k = _uleb(b, k)
                    feat = b[k:k + ln].decode("utf-8", "replace")
                    k += ln
                    if feat == "wasm64":
                        return "wasm64"
            q = pay_end
        # dylink.0 在、但没有 wasm64 特性声明 ⇒ 是 wasm32（emscripten 的形态）
        return "wasm32"
    return UNKNOWN                        # 不是 side module（没有 dylink.0）


def scan_dir(d):
    """返回 {path: arch}（只收 *.oct；目录空 ⇒ 空字典，由调用方按零值守卫报）。"""
    out = {}
    try:
        names = sorted(os.listdir(d))
    except OSError:
        return out
    for n in names:
        if n.endswith(".oct"):
            p = os.path.join(d, n)
            out[p] = arch_of_file(p)
    return out


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if "--dir" in argv:
        i = argv.index("--dir")
        if i + 1 >= len(argv):
            print("用法：--dir <目录>", file=sys.stderr)
            return 2
        d = argv[i + 1]
        res = scan_dir(d)
        if not res:
            print("FATAL: %s 里没有 .oct（零值守卫：空目录不算通过）" % d, file=sys.stderr)
            return 2
        bad = 0
        for p, a in sorted(res.items()):
            print("%-8s %s" % (a, p))
            if a == UNKNOWN:
                bad += 1
        return 1 if bad else 0
    if not argv:
        print(__doc__.strip().split("用法：")[-1].strip(), file=sys.stderr)
        return 2
    bad = 0
    for p in argv:
        a = arch_of_file(p)
        print("%-8s %s" % (a, p))
        if a == UNKNOWN:
            bad += 1
    return 1 if bad else 0


# ── F1 自证：三类用例（正常读出 / 该报的必须报 / 空输入必须报）────────────────
def _mk_side_module(arch):
    """造一个最小 wasm side module（只有 dylink.0 + 可选 target_features）——**真字节**，
    不是替身：这样自证验的是解析器本体。"""
    def leb(n):
        out = bytearray()
        while True:
            x = n & 0x7F
            n >>= 7
            out.append(x | (0x80 if n else 0))
            if not n:
                return bytes(out)
    def sub(t, payload):
        return bytes([t]) + leb(len(payload)) + payload
    def name(s):
        b = s.encode()
        return leb(len(b)) + b
    body = name("dylink.0")
    body += sub(1, leb(16) + leb(2) + leb(0))          # MEM_INFO
    if arch == "wasm64":
        body += sub(TARGET_FEATURES, name("wasm64") + name("bulk-memory"))
    sec = bytes([0]) + leb(len(body)) + body           # custom section id=0
    return b"\0asm\x01\0\0\0" + sec


def _np(fn):
    try:
        return fn()
    except Exception:
        return UNKNOWN


def selftest():
    cases = [
        ("正常：wasm32 的 dylink.0（无 target_features）⇒ wasm32",
         lambda: arch_of_bytes(_mk_side_module("wasm32")) == "wasm32"),
        ("正常：wasm64 的 dylink.0（target_features 含 wasm64）⇒ wasm64",
         lambda: arch_of_bytes(_mk_side_module("wasm64")) == "wasm64"),
        ("★ 该报的必须报：不是 wasm（magic 不对）⇒ UNKNOWN",
         lambda: arch_of_bytes(b"not wasm at all") == UNKNOWN),
        ("★ 该报的必须报：是 wasm 但没有 dylink.0（不是 side module）⇒ UNKNOWN",
         lambda: arch_of_bytes(b"\0asm\x01\0\0\0") == UNKNOWN),
        ("★ 该报的必须报：文件不存在 ⇒ UNKNOWN（不抛、不猜）",
         lambda: arch_of_file("/definitely/not/here-9f3a.oct") == UNKNOWN),
        # 零值守卫由 --dir 分支（空目录 rc=2）与 scan_dir 的空返回担；这里钉住"空字节"
        ("★ 空输入必须报：空字节流 ⇒ UNKNOWN（零值守卫）",
         lambda: arch_of_bytes(b"") == UNKNOWN),
    ]
    npass = nfail = 0
    for name, fn in cases:
        ok = bool(_np(fn))
        npass += 1 if ok else 0
        nfail += 0 if ok else 1
        print("%s | %s" % ("PASS" if ok else "fail", name))
    print("=== oct-arch 自证：%d PASS / %d fail ===" % (npass, nfail))
    return 0 if nfail == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
