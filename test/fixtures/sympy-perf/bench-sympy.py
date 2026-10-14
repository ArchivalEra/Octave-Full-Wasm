#!/usr/bin/env python3
# SymPy 基准 —— **原生（uv）与 Pyodide 共用同一份**（2026-10-14）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 用户之问（2026-10-14）："pyodide 是不是性能承重件……用原生 octave+uv 跑下对比，
#   如果性能接近我们以后就不讨论了"
# ⇒ 本文件就是那个对比的一半（Python 侧）。判据 = 同一台机、同 sympy 版本、同 ops、
#   同预热、**每轮换新符号**（防止 SymPy 的 cacheit 把第二轮变成缓存查表 —— 不换符号
#   量的是缓存不是计算）。
#
# 用法：
#   native : uv run --python 3.14 --with sympy==1.14.0 python3 bench-sympy.py
#   pyodide: 由 probe-sympy-perf-pyodide.mjs 在浏览器 worker 里 exec（同一份文件）
# 输出：一行 JSON（import 耗时 + 每个 op 的 min/median/times）。
import json
import os
import sys
import time

# ★ 公平性：两侧都强制纯 Python 整数。Pyodide 没有 gmpy2；若本机恰好装了 gmpy2，
#   SymPy 会自动用它（原生就会"免费"快一截）⇒ 显式钉住 ground types=python。
os.environ.setdefault("SYMPY_GROUND_TYPES", "python")

_OPS = []


def op(name):
    def deco(f):
        _OPS.append((name, f))
        return f
    return deco


# ── ops：覆盖 CAS 的几类（求解 / 积分 / 化简 / 展开 / 级数 / 矩阵 / 高精度 / 数值）──
# 全部接受 (x, y) 两个符号；**每轮传入新符号**，避免 SymPy 缓存污染（见文件头）。
@op("diff_exp_sin")
def _(x, y):
    from sympy import diff, sin, exp
    return diff(sin(x) * exp(x), x)


@op("diff_poly_trig")
def _(x, y):
    from sympy import diff, sin
    return diff(x ** 20 * sin(x) ** 5, x)


@op("integ_exp_sin")
def _(x, y):
    from sympy import integrate, sin, exp
    return integrate(sin(x) * exp(x), x)


@op("integ_rational")
def _(x, y):
    from sympy import integrate
    return integrate(1 / (x ** 3 + 1), x)


@op("integ_x5_exp")
def _(x, y):
    from sympy import integrate, exp
    return integrate(x ** 5 * exp(x), x)


@op("solve_system")
def _(x, y):
    from sympy import solve
    return solve([x + y - 3, x - y - 1], [x, y])


@op("solve_poly")
def _(x, y):
    from sympy import solve
    return solve(x ** 3 - 2 * x + 1, x)


@op("simplify_mix")
def _(x, y):
    from sympy import simplify, sin, cos
    return simplify(sin(x) ** 2 + cos(x) ** 2 + (x ** 3 - 1) / (x - 1))


@op("expand_big")
def _(x, y):
    from sympy import expand
    return expand((x + y + 1) ** 25)


@op("factor_cyclo")
def _(x, y):
    from sympy import factor
    return factor(x ** 30 - 1)


@op("limit_classic")
def _(x, y):
    from sympy import limit, cos
    return limit((1 - cos(x)) / x ** 2, x, 0)


@op("series14")
def _(x, y):
    from sympy import series, sin, exp
    return series(sin(x) * exp(x), x, 0, 14)


@op("matrix_det5")
def _(x, y):
    from sympy import Matrix
    M = Matrix(5, 5, lambda i, j: (i + 1) * x + (j + 1) * y + i + j + 1)
    return M.det()


@op("evalf_pi500")
def _(x, y):
    from sympy import N, pi
    return N(pi, 500)


LAMBDA_N = 100000


@op("lambdify_eval100k")
def _(x, y):
    from sympy import lambdify, sin, cos, exp
    f = lambdify(x, sin(x) * cos(x) + exp(-x) * x ** 3, modules="math")
    s = 0.0
    for i in range(LAMBDA_N):
        s += f(i * 1e-4)
    return s


def _fresh(k, tag):
    from sympy import symbols
    return symbols(f"{tag}x{k}"), symbols(f"{tag}y{k}")


def run_bench(reps=3, tag=""):
    """返回 {import_s, info, ops:{name:{min_ms,median_ms,times_ms}}}。

    `tag` 用来给符号起唯一名字（跑两轮时第二轮也要避开第一轮的缓存）。
    """
    t0 = time.perf_counter()
    import sympy
    t_import = time.perf_counter() - t0
    info = {"python": sys.version.split()[0], "sympy": sympy.__version__,
            "ground_types_env": os.environ.get("SYMPY_GROUND_TYPES")}
    try:
        import gmpy2                                                    # noqa: F401
        info["gmpy2"] = getattr(gmpy2, "version", lambda: True)()
    except Exception:
        info["gmpy2"] = False

    # 全局预热：把各 op 的**惰性 import** 都走一遍（两侧同法；否则第一个 op 替所有 op
    # 付模块加载费 ⇒ 读数不可比）。
    for name, fn in _OPS:
        x, y = _fresh(99, tag + "w")
        try:
            fn(x, y)
        except Exception:
            pass

    ops = {}
    for name, fn in _OPS:
        times = []
        for k in range(reps):
            x, y = _fresh(k, tag)
            t = time.perf_counter()
            fn(x, y)
            times.append((time.perf_counter() - t) * 1000.0)
        ts = sorted(times)
        ops[name] = {"min_ms": round(ts[0], 3),
                     "median_ms": round(ts[len(ts) // 2], 3),
                     "times_ms": [round(v, 3) for v in times]}
    return {"import_s": round(t_import, 4), "info": info, "ops": ops}


if __name__ == "__main__":
    modename = sys.argv[1] if len(sys.argv) > 1 else "native"
    reps = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    t_wall = time.perf_counter()
    out = {"mode": modename, "reps": reps, "bench": run_bench(reps=reps, tag=modename[0])}
    out["wall_s"] = round(time.perf_counter() - t_wall, 3)
    print(json.dumps(out))
