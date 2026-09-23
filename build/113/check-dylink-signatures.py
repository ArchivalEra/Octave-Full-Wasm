#!/usr/bin/env python3
# Octave-Full-Wasm — wasm 侧模块 ABI 检查：.oct 的导入签名 vs 主 wasm 的定义
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# ── 它治什么病 ──────────────────────────────────────────────────────────────
# 本项目反复撞上同一类问题：**side module（`.oct`）声明的导入签名与主模块的定义不一致**。
# wasm-ld 不做跨模块类型检查（side module 链接时主模块根本不在命令行上），
# 于是这种不一致**不会在链接期报错**，而是在运行期以各种"报错骗人"的形态出现：
#   · `TypeError: resolved is not a function`（导入解析成了 emscripten 的 stub）
#   · `TypeError: Cannot read properties of undefined (reading 'value')`
#     （`reportUndefinedSymbols()` 碰到"必需未定义"的符号时自己崩了，真名看不见）
#   · `RuntimeError: table index is out of bounds` / `null function`
#     （间接调用打到不属于自己的表槽）
# 这个脚本把两边**逐个符号比对**，直接给出「谁、声明几参、实际几参」。
#
# ── 两个必须踩对的地方（否则全是假阳性）───────────────────────────────────
# 1. **类型段可能是"递归类型组"编码**（`0x4E` 开头，内含 `0x60` functype）。
#    按老格式（直接吃 `0x60`）解析会错位，结果满屏假不匹配。
# 2. **`function` 段的索引要减去"导入函数个数"**：wasm 的函数索引空间里
#    导入函数在前。漏掉这一步，导出名 → 类型索引的映射整体偏移，
#    仍然满屏假不匹配（实测 39 个全是假的）。
#
# 用法（容器内或宿主，需要 python3）：
#   check-dylink-signatures.py <主 wasm> <side module(.oct)>
# 退出码：0 = 无签名不匹配；1 = 有不匹配（会逐条列出）
import sys


def leb(d, i):
    r = 0; s = 0
    while True:
        b = d[i]; i += 1
        r |= (b & 0x7F) << s; s += 7
        if not (b & 0x80):
            return r, i


def walk(data):
    i = 8
    while i < len(data):
        sid = data[i]; i += 1
        size, i = leb(data, i)
        yield sid, i, size
        i += size


def skip_valtype(d, j):
    b = d[j]
    if b in (0x63, 0x64):          # ref null ht / ref ht
        j += 1
        return leb(d, j)[1]
    if b == 0x6B or (0x70 <= b <= 0x7F):
        return j + 1
    return leb(d, j)[1]


def parse_types(data, off):
    """返回 [(params, results)]，能处理 rec group（0x4E）与 sub（0x50/0x4F）。"""
    out = []
    j = off
    n, j = leb(data, j)

    def comptype(j):
        b = data[j]
        if b == 0x60:
            j += 1
            np_, j = leb(data, j)
            for _ in range(np_):
                j = skip_valtype(data, j)
            nr, j = leb(data, j)
            for _ in range(nr):
                j = skip_valtype(data, j)
            return (np_, nr), j
        if b in (0x5F, 0x5E):      # struct / array
            j += 1
            cnt, j = leb(data, j)
            for _ in range(cnt):
                j = skip_valtype(data, j)
                m = data[j]; j += 1
                if m:
                    j = skip_valtype(data, j)
            return None, j
        raise ValueError("未处理的 comptype 0x%02x @%d" % (b, j))

    while n > 0:
        if data[j] == 0x4E:        # rec group
            j += 1
            k, j = leb(data, j)
            for _ in range(k):
                if data[j] in (0x50, 0x4F):
                    j += 1
                    sc, j = leb(data, j); j += sc
                t, j = comptype(j)
                if t:
                    out.append(t)
            n -= 1
        else:
            if data[j] in (0x50, 0x4F):
                j += 1
                sc, j = leb(data, j); j += sc
            t, j = comptype(j)
            if t:
                out.append(t)
            n -= 1
    return out


def skip_import(d, j, kind, types, imp, name):
    if kind == 0:                                   # func
        t, j = leb(d, j)
        imp[name] = types[t][0] if t < len(types) else -1
    elif kind == 1:                                 # table
        j = skip_valtype(d, j)
        fl = d[j]; j += 1
        _, j = leb(d, j)
        if fl:
            _, j = leb(d, j)
    elif kind == 2:                                 # memory
        fl = d[j]; j += 1
        _, j = leb(d, j)
        if fl:
            _, j = leb(d, j)
    else:                                           # global
        j = skip_valtype(d, j); j += 1
    return j


def main_wasm(path):
    data = open(path, 'rb').read()
    types, ftypes, exports, n_imp_funcs = [], [], {}, 0
    for sid, off, size in walk(data):
        if sid == 1:
            types = parse_types(data, off)
        elif sid == 2:
            j = off
            n, j = leb(data, j)
            for _ in range(n):
                ln, j = leb(data, j); j += ln
                ln, j = leb(data, j); name = data[j:j + ln].decode('utf8', 'replace'); j += ln
                kind = data[j]; j += 1
                if kind == 0:
                    n_imp_funcs += 1
                j = skip_import(data, j, kind, types, {}, name)
        elif sid == 3:
            j = off
            n, j = leb(data, j)
            for _ in range(n):
                t, j = leb(data, j); ftypes.append(t)
        elif sid == 7:
            j = off
            n, j = leb(data, j)
            for _ in range(n):
                ln, j = leb(data, j); nm = data[j:j + ln].decode('utf8', 'replace'); j += ln
                kind = data[j]; j += 1
                idx, j = leb(data, j)
                if kind == 0:
                    fi = idx - n_imp_funcs          # ★ 索引空间里有导入函数
                    if 0 <= fi < len(ftypes) and ftypes[fi] < len(types):
                        exports[nm] = types[ftypes[fi]][0]
            break
    return types, exports


def side_module(path):
    data = open(path, 'rb').read()
    types, imports = [], {}
    for sid, off, size in walk(data):
        if sid == 1:
            types = parse_types(data, off)
        elif sid == 2:
            j = off
            n, j = leb(data, j)
            for _ in range(n):
                ln, j = leb(data, j); j += ln
                ln, j = leb(data, j); name = data[j:j + ln].decode('utf8', 'replace'); j += ln
                kind = data[j]; j += 1
                j = skip_import(data, j, kind, types, imports, name)
            break
    return types, imports


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    mtypes, mexports = main_wasm(sys.argv[1])
    otypes, oimports = side_module(sys.argv[2])
    print("主 wasm: 类型 %d / 导出函数 %d" % (len(mtypes), len(mexports)))
    print("side    : 类型 %d / 函数导入 %d" % (len(otypes), len(oimports)))
    bad = [(nm, oimports[nm], mexports[nm]) for nm in sorted(oimports)
           if nm in mexports and oimports[nm] != mexports[nm]]
    print("=== 签名不匹配：%d 个 ===" % len(bad))
    for nm, a, b in bad:
        print("  %-60s side=%d 主=%d" % (nm[:60], a, b))
    if bad:
        return 1
    print("（无）—— 说明「表槽越界 / 空函数」这类运行期错误不是签名不一致造成的")
    return 0


if __name__ == "__main__":
    sys.exit(main())
