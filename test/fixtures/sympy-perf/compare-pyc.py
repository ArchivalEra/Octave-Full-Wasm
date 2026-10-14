#!/usr/bin/env python3
# .pyc 收益对比：**源码轮子 vs 预编轮子**，四段口径分开报（2026-10-14）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 用户之问（点令原文）："那试试预编译 pyc，还能快多少"
#
# ⚠️ 关键：**只看 `import` 会答错**。`.pyc` 省的是"源码→字节码"这一步，它出现在三处：
#   ① `import sympy` 本身（SymPy 的 __init__ 会 import 一大批子模块）；
#   ② **每个 op 的首次调用**（SymPy 到处是函数内惰性 import：`integrate` 第一次用
#      才加载 `sympy.integrals`）—— 用户"第一次用某个功能"的体感在这段；
#   ③ **稳态执行**（解析表达式/解方程/化简）—— 这段**不吃 .pyc**，是纯解释器开销；
#      把它一起报出来，是为了证明"预编译不是万能药"（否则会误以为装个 .pyc 全部快 7×）。
#   另有 ④ `reimport`（同会话二次 import）：判"不预编时 CPython 会不会自己写缓存"
#   —— 原生侧恒有磁盘缓存，浏览器侧 site-packages 只读 ⇒ 每次冷启动都要重编。
#
# 用法：python3 compare-pyc.py [pyodide-source.json] [pyodide-pyc.json]
# 输出：markdown 表 + 一行 JSON。
import json
import math
import os
import sys

D = "/mnt/hdd/octave-wasm-build/w64-logs"


def load(p):
    d = json.load(open(p, encoding="utf-8"))
    b = d["bench"]
    return {"file": os.path.basename(p), "wheels": d.get("wheels"),
            "timings": d.get("timings", {}), "import_s": b["import_s"],
            "reimport_s": b.get("reimport_s"), "cold": b.get("cold_ms", {}),
            "ops": {k: v["min_ms"] for k, v in b["ops"].items()}}


def geo(xs):
    xs = [x for x in xs if x and x > 0]
    return math.exp(sum(math.log(x) for x in xs) / len(xs)) if xs else float("nan")


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(D, "sympy-perf-pyodide.json")
    pyc = sys.argv[2] if len(sys.argv) > 2 else os.path.join(D, "sympy-perf-pyodide-pyc.json")
    A, B = load(src), load(pyc)

    print("## ① import（冷启动那一段）\n")
    print("| 档 | import sympy | 二次 import（同会话） |")
    print("|---|---|---|")
    print(f"| 源码轮子 | {A['import_s']:.2f} s | {A['reimport_s']:.2f} s |")
    print(f"| .pyc 轮子 | {B['import_s']:.2f} s | {B['reimport_s']:.2f} s |")
    print(f"| **加速** | **{A['import_s'] / max(B['import_s'], 1e-9):.2f}×** | "
          f"{A['reimport_s'] / max(B['reimport_s'], 1e-9):.2f}× |")

    names = [k for k in A["cold"] if k in B["cold"]]
    print("\n## ② 每个 op 的**首次调用**（含惰性子模块加载 —— 用户体感最相关的一段）\n")
    print("| op | 源码 (ms) | .pyc (ms) | 加速 |")
    print("|---|---|---|---|")
    for n in names:
        a, b = A["cold"][n], B["cold"][n]
        print(f"| {n} | {a:.1f} | {b:.1f} | **{a / max(b, 1e-9):.2f}×** |")
    print(f"\n**首次调用几何均值：{geo([A['cold'][n] / max(B['cold'][n], 1e-9) for n in names]):.2f}×**")

    names2 = [k for k in A["ops"] if k in B["ops"]]
    print("\n## ③ 稳态执行（预热后的 min —— **.pyc 不该改变这段**，这是对照）\n")
    print("| op | 源码 (ms) | .pyc (ms) | 比值 |")
    print("|---|---|---|---|")
    for n in names2:
        a, b = A["ops"][n], B["ops"][n]
        print(f"| {n} | {a:.2f} | {b:.2f} | {a / max(b, 1e-9):.2f}× |")
    print(f"\n**稳态几何均值：{geo([A['ops'][n] / max(B['ops'][n], 1e-9) for n in names2]):.2f}×"
          f"（≈1.0 = 如预期，.pyc 不改稳态）**")

    print(f"\n## ④ 装载时间（Pyodide 装载 / 装包）\n")
    print(f"- 源码档：load {A['timings'].get('load')} ms + pkg {A['timings'].get('pkg')} ms")
    print(f"- .pyc 档：load {B['timings'].get('load')} ms + pkg {B['timings'].get('pkg')} ms")

    out = {"import_s": {"source": A["import_s"], "pyc": B["import_s"],
                        "speedup": round(A["import_s"] / max(B["import_s"], 1e-9), 2)},
           "cold_geo_speedup": round(geo([A["cold"][n] / max(B["cold"][n], 1e-9) for n in names]), 2),
           "steady_geo_ratio": round(geo([A["ops"][n] / max(B["ops"][n], 1e-9) for n in names2]), 2),
           "reimport_s": {"source": A["reimport_s"], "pyc": B["reimport_s"]}}
    print("\n" + json.dumps(out))


if __name__ == "__main__":
    main()
