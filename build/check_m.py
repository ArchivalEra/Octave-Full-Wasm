#!/usr/bin/env python3
# Octave-Full-Wasm — .m 源文件的语法预检（宿主 Octave，秒级）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么有这个东西：wasm 里的 Octave 解析报错只说 "syntax error near line N"，
# 而**行号经常指向块的起始而不是真凶**（本项目在 __tf_texinfo_to_plain__.m 上
# 为此花了十几轮 bisect）。宿主 Octave 报的是同一套语法规则的**精确位置 +
# 上下文**，而且启动只要 0.6 秒。所以：先在宿主上过一遍，再进浏览器。
#
#   用法：python3 build/check_m.py <文件或目录> [...]
#         退出码 0 = 全部可解析；1 = 至少一个文件解析失败（错误原样打印）
#
# 注意：宿主 Octave（本机是 11.x）比目标版本（7.2）新，所以**通过不代表 7.2 通过**
# （新版本接受的语法更多）；但**失败几乎一定是真失败**，这正是预检要的。
# 因此本脚本是"过滤器"，不是验收——最终仍以浏览器实测为准。
import os
import re
import subprocess
import sys


def paren_balance(path):
    """先做一层括号平衡检查。

    Octave 对「括号没闭合」的报错位置极不直观（会在几十行之后才炸），
    而括号计数是纯文本、零成本、且能直接指出**第一处**负余额。这一步在
    实测中一次就定位了 bisect 十几轮没找到的真凶。
    """
    with open(path, encoding="utf-8", errors="replace") as fh:
        lines = fh.read().split("\n")
    depth = 0
    for i, line in enumerate(lines, 1):
        code = re.sub(r"'(?:[^']|'')*'", "''", line)
        code = re.sub(r'"(?:[^"\\]|\\.)*"', '""', code)
        code = re.sub(r"[#%].*$", "", code)
        depth += code.count("(") - code.count(")")
        if depth < 0:
            return i, depth, line.strip()[:70]
    return None, depth, ""


def check(path):
    bad = paren_balance(path)
    line, depth, snippet = bad
    if line is not None:
        print(f"FAIL {path}\n  括号不平衡：第 {line} 行出现多余的 ')'：{snippet}")
        return False
    if depth != 0:
        print(f"FAIL {path}\n  括号不平衡：文件结束时还差 {-depth} 个 ')'")
        return False

    # 坑 4：一个 .m 文件里只有**第一个**函数能按文件名被外部解析，其余是文件私有。
    # 这条在实测中反复咬人（辅助函数和主函数写在一起 → 调用方拿到 'xxx' undefined），
    # 而且报错发生在**调用方**，与本文件无关。所以在源头直接拦。
    with open(path, encoding="utf-8", errors="replace") as fh:
        body = fh.read()
    fns = re.findall(r"^\s*function\b[^\n=]*?([A-Za-z_]\w*)\s*(?:\(|$)", body, re.M)
    if len(fns) > 1:
        print(f"FAIL {path}\n  一个文件里有 {len(fns)} 个 function（{', '.join(fns[:4])}…）："
              f"只有第一个能被外部调用（CLIBS.md 坑 4）。拆成一函数一文件。")
        return False

    r = subprocess.run(
        ["octave-cli", "--quiet", "--eval", f"source('{os.path.abspath(path)}');"],
        capture_output=True, text=True, timeout=120)
    out = (r.stdout + r.stderr).strip()
    noise = ("does not agree with function filename", "shadows a core library function")
    lines = [ln for ln in out.split("\n") if ln.strip() and not any(k in ln for k in noise)]
    err = [ln for ln in lines if re.search(r"error|parse|syntax", ln, re.I)]
    if err:
        print(f"FAIL {path}\n  " + "\n  ".join(err[:4]))
        return False
    print(f"ok   {path}")
    return True


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    targets = []
    for a in sys.argv[1:]:
        if os.path.isdir(a):
            for root, _d, names in os.walk(a):
                targets += [os.path.join(root, n) for n in sorted(names) if n.endswith(".m")]
        else:
            targets.append(a)
    ok = True
    for t in targets:
        ok = check(t) and ok
    print(f"\n{len(targets)} 个文件：{'全部可解析' if ok else '有失败'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
