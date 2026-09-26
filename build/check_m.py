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
    # ⚠️ 2026-09-26（F1 自证抓到）：原来是 `[^\n=]*?` —— 它**匹配不到**最常见的
    #    Octave 写法 `function y = f(x)`（`=` 把惰性量词挡住，捕获名落到 `=` 上 ⇒ 放弃）。
    #    也就是说这条闸门对仓库里绝大多数 .m 是**瞎的**。改成 `[^\n]*?`（惰性 + 回溯到
    #    `=` 之后的真函数名）后两种写法都认。
    fns = re.findall(r"^\s*function\b[^\n]*?([A-Za-z_]\w*)\s*(?:\(|$)", body, re.M)
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
    if not targets:
        # ★ 零值守卫（F1）：一个 .m 都没收集到 ⇒ 这条检查**根本没跑**，不是"全过"
        print("FAIL：**一个 .m 目标都没收集到** ⇒ 检查空转（零值守卫）")
        return 1
    ok = True
    for t in targets:
        ok = check(t) and ok
    print(f"\n{len(targets)} 个文件：{'全部可解析' if ok else '有失败'}")
    return 0 if ok else 1


# ── 自证（F1）：以子进程调自己（CLI 脚本不必重构内部，测的是真路径）────────────
def _rc(*args):
    import subprocess, tempfile, shutil
    d = tempfile.mkdtemp(prefix="gate-m-")
    try:
        paths = []
        for i, (name, body) in enumerate(args):
            fp = os.path.join(d, name)
            open(fp, "w", encoding="utf-8").write(body)
            paths.append(fp)
        if not paths:
            paths = [d]                      # 空目录 ⇒ 零目标
        return subprocess.run([sys.executable, os.path.abspath(__file__)] + paths,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode
    finally:
        shutil.rmtree(d, ignore_errors=True)


_GOOD_M = "function y = f(x)\n  y = x;\nendfunction\n"
_BAD_M = _GOOD_M + "function y = g(x)\n  y = x;\nendfunction\n"     # 最常见写法（曾漏检）
_BAD_M2 = "function f(x)\n  x;\nendfunction\nfunction g(x)\n  x;\nendfunction\n"


def _selfcheck():
    return [[("合法 .m ⇒ 通过", lambda: _rc(("ok.m", _GOOD_M)) == 0),
             ("两个 function（`function y = f(x)` 写法）⇒ 必须报", lambda: _rc(("bad.m", _BAD_M)) != 0),
             ("两个 function（`function f(x)` 写法）⇒ 必须报", lambda: _rc(("bad2.m", _BAD_M2)) != 0),
             ("**空目录（零目标）** ⇒ 必须报", lambda: _rc() != 0)]]


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        cases = _selfcheck()[0]
        bad = sum(0 if (lambda f: (f() == True))(fn) else 1 for _, fn in cases)
        for label, fn in cases:
            try: ok = bool(fn())
            except Exception as e: ok = False; label += "  ← 抛异常 %r" % e
            print("%s | check_m/%s" % ("PASS" if ok else "fail", label))
        print("\n=== check_m 自证：%d PASS / %d fail ===" % (len(cases) - bad, bad))
        sys.exit(1 if bad else 0)
    sys.exit(main())
