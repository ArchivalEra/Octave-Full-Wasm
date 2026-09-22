#!/usr/bin/env python3
# Octave-Full-Wasm — 把装好的 m/ 树里的 .m docstring **构建期**渲染成纯文本
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

"""让 `help <mfile>` 在浏览器里可用（T1 的同一手法，扩到 .m 文件）。

用法：
  prerender-m-docstrings.py <源 m 目录> <输出 m 目录> [--scratch 临时目录] [--keep-payloads]
  prerender-m-docstrings.py --verify-desktop <源 m 目录> <输出 m 目录> <名字…>   # 与桌面版逐字对照

────────────────────────────────────────────────────────────────────────────
为什么必须**构建期**做（而不是运行期覆写 MEMFS）
  `help X` 第一次解析会把 docstring **缓存在 octave_function 对象上**
  （`octave_function::doc_string()`，help.cc:675）；运行期改文件有"谁先被解析谁赢"
  的竞态。改文件本身没有这个竞态。

为什么这样能让 `help` 工作
  · `.m` 的 docstring **永远不查 `built-in-docstrings`** —— 那条回退只在符号表和
    文件查找**都失败**时才走（help.cc:206-232 的 raw_help），所以 T1 那张表救不了 .m；
  · 而 `looks_like_texinfo` **只看抽出的 docstring 的第一行**有没有 `-*- texinfo -*-`
    （help.cc:140-153）；
  · 渲染是**确定性**的，所以"去掉标记 + 文本已经渲染好" ⇒ `help` 走 `plain text`
    分支直接打印。官方自己也这么干（`doc/interpreter/mk-doc-cache.pl:102`）。

**渲染交给官方的 `__makeinfo__`，不自己复刻它的变换**（`build/render-docstring-batch.m`）
  踩过的坑：`__makeinfo__.m` 除了调 makeinfo，还有一整套文本变换（去掉每行一个前导
  空格、`@end tex` 缩进、`@seealso`→`@xseealso` 并转义 `@`、`@ref/@xref/@pxref`、
  收尾 ` -- : `）。第一版只复刻了 makeinfo 调用，结果**20/20 与桌面逐字不同**
  （折行宽度 + 每行差一个空格）。宿主就是同版 11.3.0、`texi_macros_file()` 与站点发的
  macros.texi **逐字节相同**，所以直接调官方函数 —— 把"与桌面一致"做成构造性成立。

抽取规则（照抄 Octave 的 lexer，不是猜的）
  · 逐行：跳过前导空白，再跳过**所有**前导 `#`/`%`，其余原样（含换行）追加进当前 run
      —— `libinterp/parse-tree/lex.cc:2253-2301`（规则 23）
  · 连续整行注释 = 一个 run；**空行或代码行结束 run**（lex.cc:2352-2386）
  · run 的文本（跳过 " \\t\\n\\r"）以 Copyright / Author / SPDX-License-Identifier
    开头 ⇒ 版权块（lex.cc:5288-5303），跳过
  · **第一个非版权 run 就是 docstring**（comment-list.h:150-168 的 find_doc_comment）

交给 `__makeinfo__` 的文本 = docstring **从第一个换行符起**的剩余部分
  （`looks_like_texinfo` 是 `text.erase(0, p1)`，p1 是第一个 `\\n` 的下标 ⇒ 标记行的
  **换行符保留**，正因如此 `text(2) == " "` 那个守卫才成立。）
"""

import argparse
import os
import subprocess
import sys

COPYRIGHT_HEADS = ("Copyright", "Author", "SPDX-License-Identifier")


# ─────────────────────────────────────────────────────────────────────────────
# 抽取：完全照 lexer 的规则
# ─────────────────────────────────────────────────────────────────────────────

def comment_text_of_line(line):
    """返回 (是不是整行注释, 去掉前导空白+所有前导 #/% 之后的文本含换行)。

    `#{` / `%{` 开头的**块注释**在 lexer 里是另一种元素，这里当作"非整行注释"
    （于是也会结束当前 run），免得误当成 docstring。
    """
    s = line.lstrip(" \t")
    if not s or s[0] not in "#%":
        return False, None
    if s[:2] in ("#{", "%{"):
        return False, None
    i = 0
    while i < len(s) and s[i] in "#%":
        i += 1
    return True, s[i:]


def extract_docstring_run(lines):
    """按 Octave 的规则找出 docstring run：返回 (起, 止(不含), 文本) 或 None。"""
    i, n = 0, len(lines)
    while i < n:
        is_c, _ = comment_text_of_line(lines[i])
        if not is_c:
            i += 1
            continue
        j, parts = i, []
        while j < n:
            ok, t = comment_text_of_line(lines[j])
            if not ok:
                break
            parts.append(t)
            j += 1
        blob = "".join(parts)
        if not blob.lstrip(" \t\n\r").startswith(COPYRIGHT_HEADS):
            return i, j, blob
        i = j
    return None


def first_line(s):
    p = s.find("\n")
    return s if p < 0 else s[:p]


def comment_prefix(line):
    """沿用原来那一段的注释风格（空白 + 注释符）。刻意**不以空格结尾** ——
    抽取是"先跳空白、再去掉所有前导 #/%"，`##内容` 能逐字还原内容。"""
    k = 0
    while k < len(line) and line[k] in " \t":
        k += 1
    while k < len(line) and line[k] in "#%":
        k += 1
    return line[:k] or "##"


# ─────────────────────────────────────────────────────────────────────────────
# 阶段 A：抽取 + 写 payload
# ─────────────────────────────────────────────────────────────────────────────

def prepare(path):
    """返回 (状态, meta)。meta = dict(i, j, prefix, payload_path?)"""
    with open(path, "r", encoding="utf-8", errors="surrogateescape") as fh:
        lines = fh.read().splitlines(keepends=True)

    found = extract_docstring_run(lines)
    if found is None:
        return "skipped-no-docstring", None
    i, j, blob = found
    if "-*- texinfo -*-" not in first_line(blob):
        return "skipped-not-texinfo", None

    nl = blob.find("\n")
    if nl < 0:
        return "failed", "标记行之后再无内容（docstring 只有标记行）"
    return "todo", {"lines": lines, "i": i, "j": j, "prefix": comment_prefix(lines[i]),
                    "payload": blob[nl:]}


# ─────────────────────────────────────────────────────────────────────────────
# 阶段 C：写回 + 自检
# ─────────────────────────────────────────────────────────────────────────────

def apply_rendered(path, meta, rendered):
    lines, i, j, prefix = meta["lines"], meta["i"], meta["j"], meta["prefix"]
    rendered = rendered.rstrip("\n")

    if not rendered.strip():
        return "failed", "渲染结果为空"
    if "-*- texinfo -*-" in first_line(rendered):
        return "failed", "渲染结果第一行仍带 texinfo 标记（help 会继续走 makeinfo）"

    out_lines = []
    for ln in rendered.split("\n"):
        # 抽取规则是「先跳空白、再去掉所有前导 #/%」，所以内容里**缩进过的** `## xx`
        # 能无损保留（写回去 `##      ## xx`，解析器剥掉前缀后遇空格就停）；
        # 只有**第 0 列**就是 #/% 时才无解（会被一起吃）。与其静默少字符，不如明确失败。
        if ln[:1] in ("#", "%"):
            return "failed", f"渲染结果有一行在第 0 列就是注释符：{ln[:40]!r}（无法无损写回）"
        out_lines.append(prefix + ln)
    out_lines = [(x if x.endswith("\n") else x + "\n") for x in out_lines]

    out = "".join(lines[:i]) + "".join(out_lines) + "".join(lines[j:])

    again = extract_docstring_run(out.splitlines(keepends=True))
    if again is None:
        return "failed", "重写后抽不到 docstring（自检失败）"
    if again[2].rstrip("\n") != rendered:
        return "failed", "重写后抽出的文本与渲染结果不一致（自检失败）"
    if again[2].lstrip(" \t\n\r").startswith(COPYRIGHT_HEADS):
        return "failed", "重写后的 docstring 会被判成版权块（自检失败）"

    with open(path, "w", encoding="utf-8", errors="surrogateescape") as fh:
        fh.write(out)
    return "rendered", ""


# ─────────────────────────────────────────────────────────────────────────────
# 主流程
# ─────────────────────────────────────────────────────────────────────────────

def run_batch(scratch, items):
    """items: [(idx, payload_text)]。用官方 __makeinfo__ 批量渲染。"""
    ind = os.path.join(scratch, "in")
    outd = os.path.join(scratch, "out")
    os.makedirs(ind, exist_ok=True)
    os.makedirs(outd, exist_ok=True)
    manifest = os.path.join(scratch, "manifest.tsv")
    with open(manifest, "w", encoding="utf-8") as mf:
        for idx, payload in items:
            ip = os.path.join(ind, f"{idx}.txt")
            with open(ip, "w", encoding="utf-8", errors="surrogateescape") as fh:
                fh.write(payload)
            mf.write(f"{ip}\t{os.path.join(outd, f'{idx}.txt')}\n")
    driver = os.path.join(os.path.dirname(os.path.abspath(__file__)), "render_docstring_batch.m")
    cmd = ["octave-cli", "--norc", "--no-init-file", "--eval",
           f"addpath('{os.path.dirname(driver)}'); render_docstring_batch ('{manifest}');"]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=3600)
    sys.stdout.write(r.stdout[-4000:] if r.stdout else "")
    if r.returncode != 0:
        sys.stderr.write((r.stderr or "")[-2000:])
        raise SystemExit(f"渲染驱动退出码 {r.returncode}")
    return outd


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--scratch", default="/tmp/prerender-m-docstrings")
    ap.add_argument("--verify-desktop", action="store_true")
    ap.add_argument("names", nargs="*")
    args = ap.parse_args()

    if args.verify_desktop:
        if not args.names:
            print("--verify-desktop 需要至少一个函数名", file=sys.stderr)
            return 2
        return verify_desktop(args.src, args.out, args.names)

    if not os.path.isdir(args.src):
        print(f"源目录不存在：{args.src}", file=sys.stderr)
        return 2

    # 整棵拷出去（未改动的文件逐字保留）
    if os.path.abspath(args.src) != os.path.abspath(args.out):
        os.makedirs(args.out, exist_ok=True)
        subprocess.run(["cp", "-a", f"{args.src.rstrip('/')}/.", args.out], check=True)

    counts, failures, order, items = {}, [], [], []
    n = 0
    for root, _dirs, names in os.walk(args.out):
        for fn in sorted(names):
            if not fn.endswith(".m"):
                continue
            n += 1
            p = os.path.join(root, fn)
            st, meta = prepare(p)
            counts[st] = counts.get(st, 0) + 1
            if st == "failed":
                failures.append((os.path.relpath(p, args.out), meta))
            elif st == "todo":
                order.append(p)
                items.append((str(len(items)), meta["payload"]))

    print(f"== 扫到 {n} 个 .m；待渲染 {len(items)}")
    if items:
        outd = run_batch(args.scratch, items)
        # 显式按同一顺序配对（别靠 dict 插入序对齐 —— 那种隐式依赖早晚会咬人）
        for idx, p in enumerate(order):
            rf = os.path.join(outd, f"{idx}.txt")
            counts["todo"] -= 1
            if not os.path.isfile(rf):
                counts["failed"] = counts.get("failed", 0) + 1
                failures.append((os.path.relpath(p, args.out), "渲染输出缺失"))
                continue
            with open(rf, encoding="utf-8", errors="surrogateescape") as fh:
                rendered = fh.read()
            with open(p, encoding="utf-8", errors="surrogateescape") as fh:
                meta = prepare(p)[1]
            st, msg = apply_rendered(p, meta, rendered)
            counts[st] = counts.get(st, 0) + 1
            if st == "failed":
                failures.append((os.path.relpath(p, args.out), msg))

    for k in sorted(counts):
        print(f"   {k:26} {counts[k]}")
    if failures:
        print(f"   ⚠️ 失败/异常 {len(failures)} 个（前 20）:")
        for rel, msg in failures[:20]:
            print(f"      {rel}: {msg}")
    return 1 if failures else 0


# ─────────────────────────────────────────────────────────────────────────────
# 与桌面版逐字对照（验收）
# ─────────────────────────────────────────────────────────────────────────────

def find_m_file(root, name):
    hits = []
    for r, _dirs, names in os.walk(root):
        if name + ".m" in names:
            hits.append(os.path.join(r, name + ".m"))
    return hits


def norm(t):
    return "\n".join(x.rstrip() for x in t.replace("\r\n", "\n").split("\n")).strip("\n")


def verify_desktop(orig, out, names):
    """比较：桌面 `help`（原文件 → 运行时 makeinfo） vs 重写后文件里抽出的纯文本。

    宿主机是同版 11.3.0 ⇒ 这是逐字可比的。它同时验证**抽取**（我手写的部分）与
    **写回**（是否有损）—— 渲染既然交给官方函数，就不再是变量。
    """
    ok = bad = skip = 0
    for name in names:
        o, s = find_m_file(orig, name), find_m_file(out, name)
        if len(o) != 1 or len(s) != 1:
            print(f"SKIP {name}: 原树 {len(o)} 个 / 重写树 {len(s)} 个（不唯一）")
            skip += 1
            continue
        with open(s[0], encoding="utf-8", errors="surrogateescape") as fh:
            got = extract_docstring_run(fh.read().splitlines(keepends=True))
        staged = got[2] if got else ""

        tmp = "/tmp/.vd-help.txt"
        cmd = ["octave-cli", "--norc", "--no-init-file", "--eval",
               f"addpath('{os.path.dirname(o[0])}','-begin'); h = help('{name}'); "
               f"fid = fopen('{tmp}','w'); fwrite(fid, h); fclose(fid);"]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if r.returncode != 0:
            print(f"SKIP {name}: 桌面退出码 {r.returncode}: {(r.stderr or '')[:120]}")
            skip += 1
            continue
        with open(tmp, encoding="utf-8", errors="surrogateescape") as fh:
            desk = fh.read()

        if norm(desk) == norm(staged):
            ok += 1
            print(f"OK   {name}")
        else:
            bad += 1
            print(f"DIFF {name}")
            import difflib
            for ln in list(difflib.unified_diff(norm(desk).split("\n"), norm(staged).split("\n"),
                                                "desktop", "staged", lineterm="", n=0))[:10]:
                print("     ", repr(ln))
    print(f"\n== 对照：一致 {ok}，不一致 {bad}，跳过 {skip}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
