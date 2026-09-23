#!/usr/bin/env python3
# Octave-Full-Wasm — SLICOT(control 包) ABI 对齐：补 f2c 的 CHARACTER 隐藏长度参数
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# ── 为什么需要它 ────────────────────────────────────────────────────────────
# control 包的 48 个 SLICOT 包装器（`sl_*.cc`，被 `__control_slicot_functions__.cc`
# 全部 #include 成一个 TU）用**手写声明**调用 Fortran 例程，例：
#
#     int F77_FUNC (ab08nd, AB08ND) (char& EQUIL, F77_INT& N, …, F77_INT& INFO);
#                                     ↑ 17 个显式参数，CHARACTER 的「隐藏长度」没写
#
# 而 f2c 生成的实现**每个 CHARACTER 形参都会多一个尾部 `ftnlen`**：
#
#     extern int ab08nd_(char *equil, integer *n, …, integer *info, ftnlen equil_len);
#
# 原生 x86 上 C 不检查函数指针签名，少传那几个长度参数**只是读到垃圾**（LAPACK 的
# `lsame` 只看首字符，所以"碰巧能跑"）。**wasm 的 `call_indirect` 做精确类型检查**，
# 于是这个长期潜伏的不一致第一次变成硬错误：
#
#     wasm-ld: error: function signature mismatch: dggev_
#     >>> defined as (i32 ×17) -> i32 in __control_slicot_functions__.oct.o
#     >>> defined as (i32 ×19) -> i32 in slicotlibrary.a(AB13DD.o)
#
# （与 HANDOFF §10.3 坑 13 / `patch-odepack-callback-arity.sh` 同类问题的另一个实例。）
#
# ── 做法 ────────────────────────────────────────────────────────────────────
# 只在**声明**上补尾部参数，且给它们**默认值 1**：
#
#     int F77_FUNC (ab08nd, AB08ND) (…, F77_INT& INFO, F77_INT equil_len = 1);
#
# 好处：① 调用点**一个字都不用改**（C++ 默认实参在调用处自动补齐）；
#       ② 隐藏长度恒为 1 是**对的**——包装器所有 CHARACTER 参数都是 `char&`
#          （指向单个字符，不是字符串），脚本里对此有硬自检；
#       ③ 符号名不受影响（`extern "C"`，不参与 C++ 名字修饰）。
#
# ── 自检（改之前就拒绝，不猜）──────────────────────────────────────────────
#   · 每条声明的 Δ = f2c 元数 − 包装器元数，**必须等于该声明里 CHARACTER 参数的个数**；
#   · 且必须等于 f2c 原型里的 CHARACTER 参数个数（两边口径一致才算看懂）；
#   · 包装器里出现 `char*`（可能是多字符串）就**失败退出**——那时长度不一定是 1；
#   · 不在 f2c 原型表里的符号只允许出现在下面的 OVERRIDE 表里（并写明依据）。
#
# 用法（宿主或容器内均可，纯文本处理）：
#   fix-slicot-abi.py --check <control-src> <f2c-P-dir>    # 只报告，不改
#   fix-slicot-abi.py --apply <control-src> <f2c-P-dir>    # 就地改（幂等，首次留 .orig）
#
# 实测（2026-09-23，o113）：50 条声明 → 14 条本就一致、35 条需补、1 条在 OVERRIDE。
import glob
import os
import re
import sys

# 非 SLICOT、但包装器也要调、且符号由**主模块**（LAPACK）提供的：
#   dggev_ 的真实元数由 /usr/local/lib/liblapack.a 的 dggev.o 反汇编读到
#   （该 .o 里唯一的函数定义 = 19 个 i32 参数；旁证：同 .o 导入的 lsame_ 是 4 参、
#    dlamch_ 是 2 参，都是 f2c 带隐藏长度的口径）。
OVERRIDE = {"dggev": 19}

DECL = re.compile(r"(\w[\w \t]*?)\s*F77_FUNC\s*\(\s*(\w+)\s*,\s*(\w+)\s*\)\s*\(([^;]*?)\)\s*;", re.S)
PROTO = re.compile(r"^extern\s+(\w[\w ]*?)\s(\w+)\s*\(([^;]*)\)\s*;", re.M)
TYPEWORD = re.compile(r"\b(F77_INT|char|double|float|int|long|complex)\b")
CHARR = re.compile(r"\bchar\s*[&*]")
CHARSTAR = re.compile(r"\bchar\s*\*")
# f2c 的类型名 → C 类型名（只做**拼写**归一，不掩盖真实分歧）
SAME_TYPE = {"doublereal": "double", "real": "float", "integer": "F77_INT",
             "logical": "F77_INT", "ftnlen": "F77_INT",
             "int": "F77_INT", "long": "F77_INT"}

# 返回类型**真的**写错、且可以安全改正的声明（逐条给依据，不做通用猜测）：
#   ab13ad：`AB13AD.f:1` 是 `DOUBLE PRECISION FUNCTION AB13AD(...)`（返回 Hankel 范数），
#           而包装器声明成 `int`。它只用 `F77_XFCN (ab13ad, AB13AD, (…));` 一句话调用
#           （`f77-fcn.h:45` 的宏展开就是 `F77_FUNC(f,F) args`，**裸调用语句、值被丢弃**），
#           所以返回类型写成什么都不影响语义——原生构建里也一直是丢的。
#           wasm 的 `call` 要做精确类型检查 ⇒ i32 结果 vs f64 结果 = 硬分歧，必须对齐。
RET_FIX = {"ab13ad": "double"}


def canon(t):
    t = t.strip().split()[-1]          # 去掉 `const`/`static` 之类前缀词
    return SAME_TYPE.get(t, t)


def nparams(params):
    depth = 0
    n = 1 if params.strip() else 0
    for ch in params:
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        elif ch == "," and depth == 0:
            n += 1
    return n


def load_protos(pdir):
    out = {}
    for f in glob.glob(os.path.join(pdir, "*.P")):
        txt = open(f, encoding="utf-8", errors="replace").read()
        for m in PROTO.finditer(txt):
            ret, sym, params = canon(m.group(1)), m.group(2).rstrip("_"), m.group(3)
            out[sym] = dict(nparams=nparams(params),
                            nchar=len(CHARSTAR.findall(params)),
                            ret=ret,
                            file=os.path.basename(f))
    return out


def include_order(src_dir):
    """派发模块 `__control_slicot_functions__.cc` 把 48 个 `sl_*.cc` 全部 #include 成
    一个 TU ⇒ **声明顺序 = include 顺序**，而且同一符号在 TU 里出现两次时，
    C++ 只允许**第一次**带默认实参（第二次是 "redefinition of default argument" 硬错误）。
    所以必须按这个顺序处理、每个符号只补第一处。"""
    disp = os.path.join(src_dir, "__control_slicot_functions__.cc")
    order = re.findall(r'^#include\s+"(sl_[\w]+\.cc)"', open(disp, encoding="utf-8").read(), re.M)
    return [os.path.join(src_dir, f) for f in order]


def scan(files):
    """按给定文件顺序扫描声明。

    ⚠️ 同一个符号可能在 TU 里被声明多次（`dggev`/`ib01ad`/`ib01cd` 各两处）。C++ 的
    两条规则同时管着这件事：
      · 同一函数的多次声明**参数类型必须一致** ⇒ 每一处都要补同样多的尾部参数；
      · 默认实参**只能出现在一处**，否则 "redefinition of default argument" ⇒
        只有**第一处**写 `= 1`，后面的写成不带默认值的形参。
    """
    found, seen, notes = [], {}, []
    for f in files:
        txt = open(f, encoding="utf-8", errors="replace").read()
        for m in DECL.finditer(txt):
            ret, low, up, params = m.group(1), m.group(2), m.group(3), m.group(4)
            if not TYPEWORD.search(params):
                continue  # 这是「调用」不是「声明」
            first = low not in seen
            if not first:
                notes.append(f"{low}: {os.path.basename(f)} 是 TU 内第 {seen[low]['n'] + 1} 处声明"
                             f"（补同样的参数、但不带默认值）")
            seen.setdefault(low, dict(n=1, nparams=nparams(params), nchar=len(CHARR.findall(params))))
            if not first:
                seen[low]["n"] += 1
            # 返回类型：抓最后一个词的位置，供 RET_FIX 替换
            rs, re_ = m.span(1)
            w = re.search(r"\w+$", ret)
            found.append(dict(file=f, sym=low, up=up, nparams=nparams(params),
                              nchar=len(CHARR.findall(params)),
                              charstar=len(CHARSTAR.findall(params)),
                              span=(m.start(4), m.end(4)), raw=params, first=first,
                              ret=canon(ret), retspan=(rs + w.start(), rs + w.end()),
                              already=f"{low}_len" in params))
    return found, notes


def check_dups(decls):
    """同一符号的多次声明，原始参数个数必须一致（否则不是「重复声明」而是真冲突）。"""
    by = {}
    bad = []
    for d in decls:
        by.setdefault(d["sym"], []).append(d)
    for sym, lst in by.items():
        ns = {d["nparams"] for d in lst}
        if len(ns) > 1:
            bad.append(f"{sym}: TU 内 {len(lst)} 处声明的参数个数不一致 {sorted(ns)} —— 真冲突，拒绝改")
    return bad


def main():
    if len(sys.argv) != 4 or sys.argv[1] not in ("--check", "--apply"):
        print(__doc__)
        return 2
    mode, src_dir, pdir = sys.argv[1], sys.argv[2], sys.argv[3]
    protos = load_protos(pdir)
    files = include_order(src_dir)
    decls, notes = scan(files)
    print(f"include 顺序里 {len(files)} 个文件；TU 内声明 {len(decls)} 处；"
          f"f2c 原型 {len(protos)} 条；模式 {mode}")
    for msg in notes:
        print("  · " + msg)

    same, need, skipped, fatal = 0, [], 0, list(check_dups(decls))
    retfix = []   # (decl, 正确返回类型)
    deltas = {}   # sym -> delta（同符号的每处声明必须算出同一个 Δ）
    for d in decls:
        if d["already"]:
            skipped += 1
            continue
        p = protos.get(d["sym"])
        want = p["nparams"] if p else OVERRIDE.get(d["sym"])
        if want is None:
            fatal.append(f"{d['sym']}: 既不在 f2c 原型表里，也不在 OVERRIDE 里（无法确定元数）")
            continue
        # ---- 硬自检 A：返回类型 ----
        if p and d["ret"] != p["ret"]:
            if RET_FIX.get(d["sym"]) == p["ret"]:
                d["ret_want"] = p["ret"]
                retfix.append(d)
            else:
                fatal.append(f"{d['sym']}: 返回类型 包装器 {d['ret']} vs f2c {p['ret']}"
                             f" —— 不在 RET_FIX 表里，拒绝改")
        delta = want - d["nparams"]
        if delta == 0:
            same += 1
            continue
        # ---- 硬自检 B：Δ 必须就是 CHARACTER 的个数（两边都要对上）----
        if d["charstar"]:
            fatal.append(f"{d['sym']}: 声明里有 char*（可能是多字符串），长度不一定是 1 —— 拒绝改")
            continue
        pnchar = p["nchar"] if p else None
        if delta != d["nchar"] or (pnchar is not None and delta != pnchar):
            fatal.append(f"{d['sym']}: Δ={delta}，声明 CHARACTER={d['nchar']}，f2c CHARACTER={pnchar}"
                         f" —— 不满足『Δ==CHARACTER 个数』，拒绝改")
            continue
        if deltas.setdefault(d["sym"], delta) != delta:
            fatal.append(f"{d['sym']}: 同符号的不同声明算出不同的 Δ —— 拒绝改")
            continue
        need.append((d, delta))

    print(f"  本就一致 {same} 处；需补尾巴参数 {len(need)} 处；"
          f"返回类型要改 {len(retfix)} 处；已是打过补丁的 {skipped} 处；拒绝 {len(fatal)}")
    for msg in fatal:
        print("  ✗ " + msg)
    if fatal:
        return 1

    for d, delta in need:
        mark = "" if d["first"] else "  ← 重复声明（不带默认值）"
        print(f"  + {d['sym']:<9} +{delta}  ({os.path.basename(d['file'])}){mark}")
    for d in retfix:
        print(f"  ~ {d['sym']:<9} 返回类型 {d['ret']} → {d['ret_want']}  ({os.path.basename(d['file'])})")

    if mode == "--check":
        print("（--check：未改动）")
        return 0

    # 按文件分组、从后往前改，避免位移
    byfile = {}
    for d, delta in need:
        byfile.setdefault(d["file"], []).append(("arg", d, delta))
    for d in retfix:
        byfile.setdefault(d["file"], []).append(("ret", d, None))
    for f, items in byfile.items():
        txt = open(f, encoding="utf-8", errors="replace").read()
        if not os.path.exists(f + ".orig"):
            open(f + ".orig", "w", encoding="utf-8").write(txt)
        edits = []
        for kind, d, delta in items:
            if kind == "ret":
                edits.append((d["retspan"][0], d["retspan"][1], d["ret_want"]))
            else:
                lo, hi = d["span"]
                tail = " = 1" if d["first"] else ""
                names = ", ".join(f"F77_INT {d['sym']}_len{i + 1}{tail}" for i in range(delta))
                edits.append((hi, hi, ",\n                  " + names))
        for lo, hi, text in sorted(edits, key=lambda x: -x[0]):
            txt = txt[:lo] + text + txt[hi:]
        open(f, "w", encoding="utf-8").write(txt)
    print(f"已改 {len(byfile)} 个文件（首份留 .orig 备份）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
