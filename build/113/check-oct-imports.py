#!/usr/bin/env python3
# Octave-Full-Wasm — 主模块"保活完整性"检查：每个 .oct 的每个导入都能解析吗？
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# ── 它治什么病 ──────────────────────────────────────────────────────────────
# `MAIN_MODULE=2` 只导出"被保活"的符号。如果某个 `.oct` 要的符号没进保活集，
# **链接期不会有任何提示**（side module 链接时主模块不在命令行上），运行期才炸，而且
# 炸出来的话术完全看不出是缺符号 —— 本项目已经踩过两次：
#   · `TypeError: Cannot read properties of undefined (reading 'value')`
#     （加载器 `reportUndefinedSymbols()` 读 `undefined.value`，真名看不见）
#   · `TypeError: resolved is not a function`（导入落到 emscripten 的 stub）
# 所以：**链完立刻查导出表**，把一类"运行期才现形"的问题变成链接期的一次失败。
#
# 与 `check-dylink-signatures.py` 的分工：那份查**签名是否一致**（参个数），
# 这份只查**保活是否完整**（名字在不在导出表里）。两者都用同一套 wasm 段解析方式；
# 若段的解析规则要改，记得两份一起改。
#
# `.oct` 的导入符号在 **IMPORT 段**（`dylink.0` 段不含符号名，CLIBS.md 那句是错的）。
#
# 用法：
#   check-oct-imports.py <主 wasm> <oct 目录或单个 .oct> [更多…] [--baseline <旧主 wasm>]
# 退出码：0 = 没有"新出现"的解析不了；1 = 有（逐条列出，并指出是哪些 .oct 在要它）
#
# ── 为什么要 `--baseline`（差分判据）────────────────────────────────────────
# 现实里有一批符号**今天就已经不在主模块导出表里**（实测 M1 站点上 67 个，几乎全在
# 自包含的 `__control_slicot_functions__.oct` 里：SLICOT 代码路径引用了本仓 LAPACK 没有
# 的 `*rfsx_`/`*geqrt3_` 等）。它们由加载器换成"一调用就抛"的 stub —— 只要没人调用就无害，
# 而今天的站点正是这么跑着的（accept-slicot 25/25）。所以**硬判据只能是相对的**：
# **M2 不许让任何东西比今天在跑的 M1 更差**。给一份 M1 的 wasm 当基线，只在
# "基线没有、新构建缺"时报失败。
# JS 库符号（`emscripten_run_script`/`abort`/`exit`/`__assert_fail`）**不看基线**：
# M1 下它们靠 JS 胶水对 side module 全可见（`tools/emscripten.py` 的 M1 分支），
# M2 下只剩 `EXPORTED_FUNCTIONS + SIDE_MODULE_IMPORTS`（这是我们**已知**的那道墙）——
# 两个 wasm 的导出表里都查不到它们，差分不出来，必须由人按这里报的名字去修。
import os
import sys

# dylink 机制名：加载器按 side module 约定提供，不来自主模块导出表
MECH = {"memory", "__indirect_function_table", "__stack_pointer",
        "__memory_base", "__table_base", "table"}
# JS 库函数：M2 下 **不是** wasm 导出 ⇒ side module 看不见。正确做法是主模块包一层
# wasm 导出（`build/main.cc` 的 `oct_js_run`），所以这里单列一类，指向那个修法。
JS_LIB = {"emscripten_run_script", "exit", "__assert_fail", "emscripten_longjmp",
          "emscripten_asm_const_int", "emscripten_get_now", "abort",
          "emscripten_notify_memory_growth"}


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
        return leb(d, j + 1)[1]
    if b == 0x6B or (0x70 <= b <= 0x7F):
        return j + 1
    return leb(d, j)[1]


def skip_descriptor(d, j, kind):
    """跳过 import/export 描述体（只关心名字，不关心类型）。"""
    if kind == 0:                                   # func: typeidx
        return leb(d, j)[1]
    if kind == 1:                                   # table: reftype + limits
        j = skip_valtype(d, j)
        fl = d[j]; j += 1
        j = leb(d, j)[1]
        return leb(d, j)[1] if fl else j
    if kind == 2:                                   # memory: limits
        fl = d[j]; j += 1
        j = leb(d, j)[1]
        return leb(d, j)[1] if fl else j
    j = skip_valtype(d, j)                          # global: valtype + mut
    return j + 1


def read_name(d, j):
    ln, j = leb(d, j)
    return d[j:j + ln].decode("utf8", "replace"), j + ln


def exports_of(path):
    """主模块的导出名集合（函数/全局/内存/表都算）。

    ⚠️ exportdesc 只是**一个索引**（funcidx/tableidx/memidx/globalidx），
    与 import 的 desc 不同（那个带 limits/typeidx）—— 两者别混用同一段跳过逻辑（实测踩过：
    混用会让名字长度读错位，解出一串乱码名字）。
    """
    d = open(path, "rb").read()
    names = set()
    for sid, off, size in walk(d):
        if sid != 7:
            continue
        j = off
        n, j = leb(d, j)
        for _ in range(n):
            nm, j = read_name(d, j)
            names.add(nm)
            j = leb(d, j + 1)[1]      # 跳过 kind 字节，再跳过它后面那个索引
        break
    return names


def imports_of(path):
    """[(module, name)] —— `.oct` 的全部导入。"""
    d = open(path, "rb").read()
    out = []
    for sid, off, size in walk(d):
        if sid != 2:
            continue
        j = off
        n, j = leb(d, j)
        for _ in range(n):
            mod, j = read_name(d, j)
            nm, j = read_name(d, j)
            kind = d[j]; j += 1
            out.append((mod, nm))
            j = skip_descriptor(d, j, kind)
        break
    return out


def oct_files(args):
    """目录要**递归**找：`assets/octdir/<包>/*.oct` 在子目录里（第一版只列了顶层，
    于是 27 个包编译件一个都没查 —— 数量对不上就该怀疑这里）。"""
    out = []
    for a in args:
        if os.path.isdir(a):
            for root, _dirs, files in os.walk(a):
                out += [os.path.join(root, f) for f in sorted(files) if f.endswith(".oct")]
        elif a.endswith(".oct"):
            out.append(a)
        else:
            print("FATAL: 既不是目录也不是 .oct：%s" % a, file=sys.stderr)
            sys.exit(2)
    return out


def main():
    argv = list(sys.argv[1:])
    baseline = None
    js_provided = set()
    if "--baseline" in argv:
        i = argv.index("--baseline")
        if i + 1 >= len(argv):
            print("FATAL: --baseline 后面要给一个 wasm 路径", file=sys.stderr)
            return 2
        baseline = argv[i + 1]
        del argv[i:i + 2]
    if "--js-provided" in argv:
        i = argv.index("--js-provided")
        if i + 1 >= len(argv):
            print("FATAL: --js-provided 后面要给逗号分隔的名字", file=sys.stderr)
            return 2
        js_provided = {s for s in argv[i + 1].split(",") if s}
        del argv[i:i + 2]
    if len(argv) < 2:
        print(__doc__)
        return 2
    main_wasm, oargs = argv[0], argv[1:]
    ex = exports_of(main_wasm)
    base_ex = exports_of(baseline) if baseline else None
    octs = oct_files(oargs)
    if not octs:
        print("FATAL: 没找到任何 .oct", file=sys.stderr)
        return 2

    missing = {}          # 名字 → 要它的 .oct 列表（新构建里解析不了）
    jslib = {}
    provided = {}         # 由 LIB_FUNCS 显式暴露的 JS 库符号（不算失败）
    for p in octs:
        base = os.path.basename(p)
        # ★ side module **自己的**函数/数据在导入段里也会出现（`GOT.func`/`GOT.mem`，取地址用），
        #   这些由 dylink 加载器按**模块自己的导出表**解析，**不在主模块的账上**。
        #   实测：`__ode15__.oct` 390 个导入里 272 个是它自己的（SUNDIALS 的回调 + Octave 模板
        #   实例化）—— 不排掉就是满屏假阳性（第一版报告 453 个"缺导出"，绝大多数是假的）。
        own = exports_of(p)
        for mod, nm in imports_of(p):
            if mod not in ("env", "GOT.mem", "GOT.func"):
                continue      # 别家的导入（理论上没有）不算在主模块账上
            if nm in own:
                continue      # 自己定义的（加载器用它自己的导出表解析）
            if nm in MECH:
                continue
            if nm in JS_LIB:
                if nm in js_provided:
                    provided.setdefault(nm, []).append(base)   # 已用 LIB_FUNCS 显式暴露
                else:
                    jslib.setdefault(nm, []).append(base)
                continue
            if nm not in ex:
                missing.setdefault(nm, []).append(base)

    old, pre = {}, {}
    if base_ex is not None:
        # 基线**也**导不出 → 既存状态（加载器给 stub，今天的站点就这么跑着）；
        # 基线导得出、新构建导不出 → **本批引入的回归**，这才是要拦的。
        old = {k: v for k, v in missing.items() if k not in base_ex}
        missing = {k: v for k, v in missing.items() if k in base_ex}

    print("check-oct-imports: 主模块导出 %d 个名字；检查 %d 个 .oct%s"
          % (len(ex), len(octs), "（基线 %s）" % baseline if baseline else ""))
    bad = 0
    for nm, who in sorted(old.items()):
        print("  [基线也缺，非本批引入] %s  ← %s" % (nm, "、".join(sorted(set(who))[:4])))
    for nm, who in sorted(missing.items()):
        bad += 1
        print("  ★ 新缺导出: %s  ← %s" % (nm, "、".join(sorted(set(who))[:4])))
    for nm, who in sorted(provided.items()):
        print("  [LIB_FUNCS 已暴露，实测可用] %s  ← %s" % (nm, "、".join(sorted(set(who))[:4])))
    for nm, who in sorted(jslib.items()):
        bad += 1
        print("  ★ JS 库符号（M1 下对 side module 全可见，M2 下不可见；请由主模块包一个 wasm "
              "导出，照 build/main.cc 的 oct_js_run / 或走 LIB_FUNCS）: %s  ← %s"
              % (nm, "、".join(sorted(set(who))[:4])))
    if bad:
        print("★ %d 个符号在 M2 下解析不了 —— 别部署这个产物（会以 'resolved is not a "
              "function' / reading 'value' 这类看不出原因的形态在运行期炸）" % bad)
        return 1
    print("没有新出现的解析不了（基线也缺的 %d 个属既存状态）✔" % len(old))
    return 0


if __name__ == "__main__":
    sys.exit(main())
