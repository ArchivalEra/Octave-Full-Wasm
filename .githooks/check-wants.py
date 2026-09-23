#!/usr/bin/env python3
# Octave-Full-Wasm — 验收套件断言的**可证伪性检查**
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

"""查那些"让断言失去意义"的写法。

为什么要有它（2026-09-23，HANDOFF §8 待办 6）：套件里的断言长这样 ——

    async function ev(expr, label, want) {
      logs.length = 0;                       // 清掉页面 console 的捕获窗口
      r = await page.evaluate(x => Module.eval_string(x), expr);
      const full = [...logs].join(' ').replace(/\\s+/g, ' ').trim();
      const ok = r.rc === 0 && (!want || wantHit(full, want));   // ← 匹配走 wantHit
    }

匹配是**在整段页面捕获窗口里找 want**（判分靠的 eval 输出、加载器日志、warning 都在
里面）。两种坏形状会静默产生错误结论：

  ① **单个数字的 want 用裸子串匹配**：`disp(numel(findall(...)))` want='0' —— 哪怕真的漏了
     10 个对象，输出里的 `10` 也**包含** `0`，断言照样绿。`accept-hdf5` 就这么假过了几个月
     （它查的 `__have_hdf5__` 在 11.3.0 里根本不存在，靠加载器日志里的杂数字对上）。
     ⇒ 规则 **C**：ev 助手里的匹配必须走 `wantHit()`（`test/browser/*.mjs` 里那份小函数，
     单个数字按**数字边界**匹配；多字符 want 仍子串 —— Octave 打印 1.5 是 `1.5000`，
     对多字符 want 用严格词边界反而会误红）。
  ② **先截断再匹配**：拿 `slice(0, 190)` 之后的值去匹配 —— 要匹配的文本落在窗口外就**假红**
     （2026-09-23 真红过一次：默认 toolkit 换成 webgl 后，会话第一条 axes 的 FreeType warning
     带 6 行调用栈，一条就把 190 字符占满）。
     ⇒ 规则 **A**：匹配用完整输出，截断只许出现在显示里。

判定只看能客观判定的形状，不做风格判断。想要一个弱断言而且知道自己在干什么，就在那一行写
`CHECK-WANTS-OK` 并说明理由 —— 检查器认这个标记。

规则 **B**（单数字 want + 计数/探针表达式）**只报告不拦**：`wantHit` 的数字边界已经挡掉了
"计数里含这个数字"那一类，剩下的风险是噪声里出现**孤立**的同数字，靠人工复核（`--report`）。

用法：
  check-wants.py            # A/C/D 有问题 exit 1（pre-commit 用）
  check-wants.py --report   # 额外列出规则 B 的清单，仍不拦
"""
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTS = os.path.join(REPO, "test", "browser")

# 带"期望值"位置参数的断言助手（名字与参数位置都不一样，所以只认函数体里的形状）
HELPERS = ("ev", "evErr", "evOut", "evVal", "evNot")
PARAMS = {"want", "check", "expect", "unwanted"}
# 计数/探针类表达式：取值可能超过一位，单数字 want 会退化成子串游戏（规则 B）
COUNT_TOKENS = re.compile(r"\b(numel|size|length|rows|columns|num2str|exist|findall)\s*\(")
OPT_OUT = "CHECK-WANTS-OK"


def body_of(text, start):
    """从 `async function <name> (` 起按大括号配对取出函数体。"""
    i = text.index("{", start)
    depth, j = 0, i
    while j < len(text):
        if text[j] == "{":
            depth += 1
        elif text[j] == "}":
            depth -= 1
            if depth == 0:
                return text[i:j + 1], i
        j += 1
    return text[i:], i


def line_of(text, pos):
    return text.count("\n", 0, pos) + 1


def split_args(s):
    """把 `(a, b, 'c')` 的顶层参数切开（认引号/括号/模板串）。"""
    args, depth, cur, i, n = [], 0, [], 0, len(s)
    quote = None
    while i < n:
        c = s[i]
        if quote:
            cur.append(c)
            if c == "\\" and i + 1 < n:
                cur.append(s[i + 1])
                i += 2
                continue
            if c == quote:
                quote = None
        elif c in "'\"`":
            quote = c
            cur.append(c)
        elif c in "([{":
            depth += 1
            cur.append(c)
        elif c in ")]}":
            depth -= 1
            cur.append(c)
        elif c == "," and depth == 0:
            args.append("".join(cur).strip())
            cur = []
        else:
            cur.append(c)
        i += 1
    if cur:
        args.append("".join(cur).strip())
    return args


def check_file(path):
    with open(path, encoding="utf-8", errors="replace") as fh:
        text = fh.read()
    name = os.path.relpath(path, REPO)
    lines = text.splitlines()
    hard, soft = [], []

    def opted(pos):
        ln = line_of(text, pos)
        return OPT_OUT in lines[ln - 1] if ln - 1 < len(lines) else False

    # ── A / C：ev 助手的函数体 ─────────────────────────────────────────
    for m in re.finditer(r"async function\s+(\w+)\s*\(", text):
        fname = m.group(1)
        body, off = body_of(text, m.start())
        truncated = set()
        for stmt in body.split(";"):
            if ".slice(" not in stmt:
                continue
            am = re.search(r"(?:const|let|var)\s+(\w+)\s*=", stmt)
            if am:
                truncated.add(am.group(1))
        # A：被截断的变量又拿去做匹配
        for var in sorted(truncated):
            for um in re.finditer(r"\b%s\.includes\s*\(" % re.escape(var), body):
                if not opted(off + um.start()):
                    hard.append((line_of(text, off + um.start()), "A 先截断再匹配",
                                 "`%s()` 里 `%s` 是 slice 之后的值 —— 要匹配的文本落在窗口外就假红；"
                                 "改成「匹配用完整输出（full）、显示才截断」" % (fname, var)))
        # C：拿整段捕获窗口做裸子串匹配
        for im in re.finditer(r"\b[\w.]+\.includes\s*\(\s*(\w+)\s*\)", body):
            if im.group(1) in PARAMS and not opted(off + im.start()):
                hard.append((line_of(text, off + im.start()), "C 裸子串匹配",
                             "`%s()` 用 `%s.includes(%s)` 直接在整段捕获窗口里找子串 —— "
                             "单个数字的 want 会被别处的数字满足；改用 `wantHit(...)`"
                             % (fname, im.group(0).split(".")[0], im.group(1))))

    # ── D：用了 wantHit 就必须有定义（每个套件自成一体，harness 会把它拷走）──
    if "wantHit(" in text and "function wantHit" not in text:
        hard.append((1, "D 缺 wantHit 定义",
                     "这个套件调了 wantHit 却没定义它（harness 把脚本单独拷到 _run.mjs 跑，"
                     "不能用相对 import）"))

    # ── B（只报告）：单数字 want + 计数/探针表达式 ──────────────────────
    for m in re.finditer(r"\bawait\s+(%s)\s*\(" % "|".join(HELPERS), text):
        depth, i = 1, m.end()
        while i < len(text) and depth:
            if text[i] == "(":
                depth += 1
            elif text[i] == ")":
                depth -= 1
            i += 1
        args = split_args(text[m.end():i - 1])
        if len(args) < 3 or opted(m.start()):
            continue
        if not re.fullmatch(r"['\"]\d['\"]|\d", args[2].strip()):
            continue
        cm = COUNT_TOKENS.search(" ".join(args[:2]))
        if cm:
            soft.append((line_of(text, m.start()), "B 单数字 want",
                         "want=%s 对上的是 `%s(...)` 的值；数字边界已经挡住『计数里含这个数字』，"
                         "剩下的风险是噪声里出现孤立的同数字" % (args[2].strip(), cm.group(1))))
    return name, hard, soft


def main():
    report = "--report" in sys.argv
    files = sorted(f for f in os.listdir(TESTS)
                   if f.startswith("accept-") and f.endswith(".mjs"))
    nhard, nsoft = 0, 0
    for f in files:
        name, hard, soft = check_file(os.path.join(TESTS, f))
        nsoft += len(soft)
        if hard:
            nhard += len(hard)
            print(name)
            for ln, rule, why in hard:
                print("  %s:%d  [%s] %s" % (name, ln, rule, why))
        if report and soft:
            print(name)
            for ln, rule, why in soft:
                print("  %s:%d  [%s] %s" % (name, ln, rule, why))
    if nhard:
        print("\n%d 处硬问题（规则 A/C/D）。确实要保留就在那一行写 `%s` 并说明理由。"
              % (nhard, OPT_OUT))
    else:
        print("check-wants: 规则 A/C/D 全过（%d 个套件）；规则 B 待人工复核 %d 处%s"
              % (len(files), nsoft, "" if report else "（--report 可列出）"))
    return 1 if nhard else 0


if __name__ == "__main__":
    sys.exit(main())
