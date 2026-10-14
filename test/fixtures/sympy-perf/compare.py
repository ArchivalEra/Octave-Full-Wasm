#!/usr/bin/env python3
# 三边对比：**原生 CPython**（uv）vs **浏览器 Pyodide** vs **原生 Octave+symbolic**（2026-10-14）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 用户之问（点令原文）："我需要你给我个明确的答案，pyodide 是不是性能承重件，
#   你可以用原生 octave+uv 跑下对比，如果性能接近我们以后就不讨论了"
#
# 判据（三边各自的语义，读数字前先对齐）：
#   · native-cpython : `uv run --python 3.14 --with sympy` 跑 bench-sympy.py（**同二分**）
#   · pyodide        : 同一份 bench-sympy.py 在浏览器 worker 里（`probe-sympy-perf-pyodide.mjs`）
#   · native-octave  : 宿主机 Octave 11.3.0 + Forge `symbolic` 3.2.2
#                      ⚠️ **两种 IPC 必须分开报**（实测差 50 倍）：
#                        · `popen2`（**持久** Python 进程）= 与"浏览器里常驻一个 Pyodide"
#                          语义对齐的那档 ⇒ **这才是可比的那一档**
#                        · `system`（每次调用新起 Python 进程）—— 它量的是**进程启动**，
#                          不是 CAS 性能；报出来只为说明"为什么不能拿它当基准"
#
# 用法：python3 compare.py [native.json] [pyodide.json] [octave-popen2.log] [octave-system.log]
# 输出：markdown 表 + 一行 JSON（给台账用）
import json
import os
import re
import sys

DEFAULT = "/mnt/hdd/octave-wasm-build/w64-logs"


def load_native(path):
    d = json.load(open(path, encoding="utf-8"))
    return {"info": d["bench"]["info"], "ops": {k: v["min_ms"] for k, v in d["bench"]["ops"].items()},
            "wall_s": d.get("wall_s")}


def load_pyodide(path):
    d = json.load(open(path, encoding="utf-8"))
    return {"info": d["bench"]["info"], "ops": {k: v["min_ms"] for k, v in d["bench"]["ops"].items()},
            "timings": d.get("timings")}


def load_octave(path):
    """从 octave bench 日志里抠 `name ms` 行。

    ⚠️ 首个 op 那行带 `OCT|` 前缀（脚本的 printf 把标记和第一个名字连在一行）——
    第一版 regex 没容忍它 ⇒ `diff_exp_sin` 整列缺失（实测抓到的小瑕疵，已修）。
    """
    ops, rt = {}, None
    for line in open(path, encoding="utf-8", errors="replace"):
        s = line.strip().removeprefix("OCT|")
        m = re.match(r"^([a-z_0-9]+)\s+([\d.]+)\s*$", s)
        if not m:
            m2 = re.match(r"^roundtrip3\s+([\d.]+)", s)
            if m2:
                rt = float(m2.group(1))
            continue
        ops[m.group(1)] = float(m.group(2))
    return {"ops": ops, "roundtrip3_ms": rt}


def main():
    base = DEFAULT
    npath = sys.argv[1] if len(sys.argv) > 1 else os.path.join(base, "sympy-perf-native.json")
    ppath = sys.argv[2] if len(sys.argv) > 2 else os.path.join(base, "sympy-perf-pyodide.json")
    op2 = sys.argv[3] if len(sys.argv) > 3 else "/tmp/oct-popen2.log"
    osy = sys.argv[4] if len(sys.argv) > 4 else "/tmp/oct-system.log"

    nat, pyd = load_native(npath), load_pyodide(ppath)
    o_p2 = load_octave(op2) if os.path.exists(op2) else {"ops": {}}
    o_sy = load_octave(osy) if os.path.exists(osy) else {"ops": {}}

    names = [k for k in nat["ops"] if k in pyd["ops"]]
    rows = []
    for n in names:
        a, b = nat["ops"][n], pyd["ops"][n]
        o = o_p2["ops"].get(n)
        rows.append((n, a, b, b / a if a else float("nan"), o, (o / a if o and a else None)))

    print(f"原生 CPython {nat['info']['python']} / sympy {nat['info']['sympy']}"
          f"  vs  Pyodide {pyd['info']['python']} / sympy {pyd['info']['sympy']}")
    print(f"（原生 Octave 侧：symbolic 3.2.2 + sympy {nat['info']['sympy']}；"
          f"popen2 持久 IPC / system 一次性 IPC 两档分开报）\n")
    print("| op | native CPython (ms) | Pyodide (ms) | Pyodide÷native | native Octave popen2 (ms) | Oct÷native | **Oct÷Pyodide** |")
    print("|---|---|---|---|---|---|---|")
    for n, a, b, r, o, orr in rows:
        o_s = f"{o:.2f}" if o else "—"
        r_s = f"{orr:.2f}" if orr else "—"
        x = f"**{o / b:.2f}×**" if o and b else "—"
        print(f"| {n} | {a:.2f} | {b:.2f} | **{r:.2f}×** | {o_s} | {r_s} | {x} |")

    # 几何均值（跳零值：evalf_pi500 是 0.01ms 级，比值噪声大）
    import math
    rs = [r for n, a, b, r, o, orr in rows if a > 0.5 and n != "evalf_pi500"]
    geo = math.exp(sum(math.log(x) for x in rs) / len(rs)) if rs else float("nan")
    print(f"\n**Pyodide ÷ native CPython：几何均值 {geo:.2f}×**（{len(rs)} 项，跳过 <0.5ms 的噪声项）")
    if o_sy["ops"]:
        rs2 = [o_sy["ops"][n] / nat["ops"][n] for n in names if n in o_sy["ops"] and nat["ops"][n] > 0.5]
        if rs2:
            g2 = math.exp(sum(math.log(x) for x in rs2) / len(rs2))
            print(f"（对照）native Octave **system** IPC ÷ native CPython：几何均值 **{g2:.1f}×** "
                  f"—— 它量的是进程启动费，不是 CAS 性能")
    print(f"\n冷启动（浏览器侧）：Pyodide 装载 {pyd['timings']['load']} ms + 装 sympy 包 "
          f"{pyd['timings']['pkg']} ms")

    out = {"geo_pyodide_over_native": round(geo, 3),
           "ops": {n: {"native": a, "pyodide": b, "ratio": round(r, 3),
                       "octave_popen2": o, "oct_over_native": (round(orr, 3) if orr else None)}
                   for n, a, b, r, o, orr in rows},
           "cold_start_ms": pyd["timings"]}
    print("\n" + json.dumps({"geo": out["geo_pyodide_over_native"]}))


if __name__ == "__main__":
    main()
