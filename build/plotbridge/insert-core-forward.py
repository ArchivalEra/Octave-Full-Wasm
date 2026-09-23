#!/usr/bin/env python3
# Octave-Full-Wasm — 给 plot 桥的 shim 插入"核心调用期间转发回核心"的前导（own code）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么需要它（机制与踩过的坑见 build/plotbridge/__pb_core__.m 的文件头）：
#   · 桥的每个 shim 挡住一个核心同名函数。镜像层要在"核心调用的整段期间"让这些名字
#     解析回核心实现（核心内部会按名字调被挡住的函数：__pie__/__contour__ 调 axis(h,…)、
#     __plt__/__errplot__ 调 legend(gca(),…)）。旧做法是每次摘 path（慢），现在改成
#     __pb_core__ 的深度计数 + **每个 shim 开头这段前导**。
#   · 同时**加宽 10 个 shim 的声明输出**：Octave 的**输出个数检查发生在函数体之前** ——
#     实测 `x = f()` 对"只声明 0 个输出"的 f 会直接报 "function called with too many
#     outputs"，函数体一行都没跑 ⇒ 声明少了，转发那段根本进不来。
#
# 硬自检（任一不成立就中止，且一个文件都不写）：
#   ① 每个 shim 的当前签名必须等于"原签名"或"目标签名"（防止手工漂移）；
#   ② 加宽用的输出名不得与该文件里已有的标识符同名（避免改了语义）；
#   ③ 本文件的表必须与 __pb_core__.m 里的 NAMES 名单逐字一致。
# 幂等：已经带 __PB_CORE_FORWARD__ 标记的文件直接跳过（但仍校验签名）。
#
# 用法：python3 build/plotbridge/insert-core-forward.py [--check]
#   --check 只报告不写（CI/复核用）。

import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MARK = "__PB_CORE_FORWARD__"

# 名字 → (原声明输出, 目标声明输出, 核心实现的输出个数, 声明形参, 转发实参)
#   · 目标输出 = 原输出 + 为"与核心对齐"补出来的（补出来的名字一律带 _out 后缀，
#     且由本工具在文件里查重）。
#   · 核心输出个数取自宿主机同版 Octave 11.3.0 的核心 .m（逐个 grep '^function' 得到），
#     是"核心内部最多能要几个输出"的上界，也是本文件加宽的依据。
S = {
    "area":     (["h"], ["h"], 1, ["varargin"], "varargin{:}"),
    "axis":     ([], ["lim_out"], 1, ["varargin"], "varargin{:}"),
    "bar":      (["h"], ["h"], 1, ["varargin"], "varargin{:}"),
    "barh":     (["h"], ["h"], 1, ["varargin"], "varargin{:}"),
    "clf":      ([], ["h_out"], 1, ["varargin"], "varargin{:}"),
    "contour":  (["h"], ["c_out", "h"], 2, ["varargin"], "varargin{:}"),
    "errorbar": (["h"], ["h"], 1, ["varargin"], "varargin{:}"),
    "figure":   (["h"], ["h"], 1, ["varargin"], "varargin{:}"),
    "grid":     ([], [], 0, ["varargin"], "varargin{:}"),
    "hold":     ([], [], 0, ["varargin"], "varargin{:}"),
    "legend":   ([], ["h_out", "obj_out", "plot_out", "labels_out"], 4, ["varargin"], "varargin{:}"),
    "loglog":   (["h"], ["h"], 1, ["varargin"], "varargin{:}"),
    "mesh":     (["h"], ["h"], 1, ["varargin"], "varargin{:}"),
    "pie":      (["h"], ["h"], 1, ["varargin"], "varargin{:}"),
    "plot":     (["h"], ["h"], 1, ["varargin"], "varargin{:}"),
    "plot3":    (["h"], ["h"], 1, ["varargin"], "varargin{:}"),
    # 核心 print 只声明 1 个输出（RGB），桥自己声明 2 个 ⇒ 转发时只能要 1 个。
    "print":    (["out1", "out2"], ["out1", "out2"], 1, ["varargin"], "varargin{:}"),
    "saveas":   ([], [], 0, ["h", "filename", "fmt"], "h, filename, fmt"),
    "scatter":  (["h"], ["h"], 1, ["varargin"], "varargin{:}"),
    "scatter3": (["h"], ["h"], 1, ["varargin"], "varargin{:}"),
    "semilogx": (["h"], ["h"], 1, ["varargin"], "varargin{:}"),
    "semilogy": (["h"], ["h"], 1, ["varargin"], "varargin{:}"),
    "stairs":   (["h"], ["x_out", "h"], 2, ["varargin"], "varargin{:}"),
    "stem":     (["h"], ["h"], 1, ["varargin"], "varargin{:}"),
    "subplot":  (["h"], ["h"], 1, ["varargin"], "varargin{:}"),
    "surf":     (["h"], ["h"], 1, ["varargin"], "varargin{:}"),
    "title":    ([], ["h_out"], 1, ["varargin"], "varargin{:}"),
    "xlabel":   ([], ["h_out"], 1, ["varargin"], "varargin{:}"),
    "xlim":     ([], ["lim_out"], 1, ["varargin"], "varargin{:}"),
    "ylabel":   ([], ["h_out"], 1, ["varargin"], "varargin{:}"),
    "ylim":     ([], ["lim_out"], 1, ["varargin"], "varargin{:}"),
}


def parse_sig(line):
    """`function [a, b] = name (p1, p2)` → (输出列表, 名字, 形参列表)"""
    body = line[len("function"):].strip()
    if "=" in body:
        lhs, rhs = body.split("=", 1)
        lhs = lhs.strip()
        outs = [] if lhs in ("", "[]") else [o.strip() for o in
                                            lhs.strip("[]").split(",") if o.strip()]
    else:
        outs, rhs = [], body
    m = re.match(r"^([A-Za-z_]\w*)\s*\((.*)\)\s*$", rhs.strip())
    if not m:
        raise ValueError("无法解析签名：%r" % line)
    name = m.group(1)
    params = [p.strip() for p in m.group(2).split(",") if p.strip()]
    return outs, name, params


def core_names():
    """从 __pb_core__.m 里解析 NAMES 名单（本工具的表必须与它一致）。"""
    src = open(os.path.join(HERE, "__pb_core__.m"), encoding="utf-8").read()
    m = re.search(r"NAMES\s*=\s*\{(.*?)\};", src, re.S)
    if not m:
        raise SystemExit("自检③ 失败：__pb_core__.m 里找不到 NAMES 名单")
    return [x.strip().strip('"') for x in m.group(1).replace("...", "").split(",") if x.strip()]


def build_block(name, target, core_nout, fwd):
    """生成要插到 function 行之后的那一整段。"""
    L = []
    A = L.append
    A("")
    A("  ## ── %s（由 build/plotbridge/insert-core-forward.py 插入，勿手改）──────" % MARK)
    A("  ## 核心调用期间（`__pb_core__` 的深度 > 0）**本名字必须解析回核心实现** —— 这是旧")
    A("  ## \"把桥目录整条从 path 上摘掉\"那套语义的逐点等价复现。核心实现内部会按名字调被桥")
    A("  ## 挡住的函数（`__pie__`/`__contour__` 调 `axis(h,…)`、`__plt__`/`__errplot__` 调")
    A("  ## `legend(gca(),…)`），所以每个挡住核心名字的 shim 都得有这一段。见 `__pb_core__.m`。")
    A("  if (__pb_in_core__ ())")
    nreq = min(core_nout, len(target))
    if nreq == 0:
        A('    __pb_core__ ("%s", %s);' % (name, fwd))
    else:
        lhs = target[0] if nreq == 1 else "[%s]" % ", ".join(target[:nreq])
        A("    if (nargout > 0)")
        A('      %s = __pb_core__ ("%s", %s);' % (lhs, name, fwd))
        A("    else")
        A('      __pb_core__ ("%s", %s);' % (name, fwd))
        A("    endif")
    A("    return;")
    A("  endif")
    if target:
        A("  ## 下面只为\"输出个数与核心实现对齐\"（核心声明几个输出，桥就得声明几个 ——")
        A("  ## Octave 的**输出个数检查发生在函数体之前**，声明少了上面那段转发根本进不来，实测）。")
        for o in target:
            A("  %s = [];" % o)
    return "\n".join(L) + "\n"


def main():
    check_only = "--check" in sys.argv

    names = core_names()
    if set(names) != set(S.keys()):
        raise SystemExit("自检③ 失败：__pb_core__.m 的 NAMES 与本工具的表不一致\n"
                         "  只在 .m 里：%s\n  只在 .py 里：%s"
                         % (sorted(set(names) - set(S)), sorted(set(S) - set(names))))

    errs, changed, skipped = [], [], []
    for name in sorted(S):
        orig, target, core_nout, params, fwd = S[name]
        path = os.path.join(HERE, name + ".m")
        src = open(path, encoding="utf-8").read()
        lines = src.split("\n")

        idx = next((i for i, l in enumerate(lines) if l.startswith("function")), None)
        if idx is None:
            errs.append("%s.m: 找不到 `function` 行" % name)
            continue
        outs, fname, fparams = parse_sig(lines[idx])

        if fname != name:
            errs.append("%s.m: 函数名是 %s（对不上）" % (name, fname))
            continue
        if outs not in (orig, target):
            errs.append("%s.m: 声明的输出是 %s，既不是原签名 %s 也不是目标签名 %s"
                        % (name, outs, orig, target))
            continue
        if fparams != params:
            errs.append("%s.m: 形参是 %s，期望 %s（签名漂移了？）" % (name, fparams, params))
            continue
        if MARK in src:
            # 自检④（2026-09-23 加）：**已插过前导的文件**也要核对"转发实参"与表一致。
            # 否则改了签名（例如 title/xlabel/ylabel 从 `(t, …)` 放宽到 `(varargin)`）会留下
            # 一个引用了**不存在变量**的前导 —— 那条路只在"核心内部调同名函数"时走到
            # （`__pie__` 调 `axis(h,…)` 那种），平时整个套件都可能看不出来。
            if outs != target:
                errs.append("%s.m: 已有标记但签名不是目标签名" % name)
            elif ('__pb_core__ ("%s", %s);' % (name, fwd)) not in src:
                errs.append("%s.m: 前导的转发实参与表不符（期望 `__pb_core__ (\"%s\", %s);`）"
                            % (name, name, fwd))
            else:
                skipped.append(name)
            continue

        # 自检②：补出来的输出名不能与该文件里已有的标识符重名
        added = [o for o in target if o not in outs]
        for o in added:
            if re.search(r"\b%s\b" % re.escape(o), src):
                errs.append("%s.m: 要补的输出名 %s 在文件里已存在，换个名字" % (name, o))
        if errs and errs[-1].startswith(name + ".m"):
            continue

        sig = "function " + ("[%s] = " % ", ".join(target) if len(target) > 1
                             else "%s = " % target[0] if target else "") \
              + "%s (%s)" % (name, ", ".join(params))
        new = lines[:idx] + [sig] + build_block(name, target, core_nout, fwd).split("\n") \
              + lines[idx + 1:]
        if not check_only:
            open(path, "w", encoding="utf-8").write("\n".join(new))
        changed.append("%s%s" % (name, "  (加宽输出: %s)" % ", ".join(added) if added else ""))

    print("插前导：%d 个%s，%d 个已有标记跳过" % (len(changed), "（--check 只报告）"
          if check_only else "已写入", len(skipped)))
    if changed:
        print("  " + "、".join(changed))
    if skipped:
        print("  跳过（已有标记）：" + "、".join(skipped))
    if errs:
        print("\n★ 自检失败（未写任何文件）：", file=sys.stderr)
        for e in errs:
            print("  " + e, file=sys.stderr)
        return 1
    if not check_only:
        print("\n下一步：python3 build/check_m.py build/plotbridge")
    return 0


if __name__ == "__main__":
    sys.exit(main())
