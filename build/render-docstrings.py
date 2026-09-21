#!/usr/bin/env python3
# Octave-Full-Wasm — 内建 docstring 的 makeinfo 渲染（宿主侧，构建期）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么有这个东西
# ----------------
# `help NAME` 的文本**就是 makeinfo 的输出**——这是官方行为，读
# `scripts/help/help.m:100-115` 与 `scripts/help/__makeinfo__.m:155` 即知：
# 格式为 texinfo 的 docstring 会被送进
#
#     system ('makeinfo --no-headers --no-warn --no-validate --plaintext --output=- FILE')
#
# 而本构建**没有 shell**（有意为之，见 HANDOFF §7），所以那条路必然失败。
#
# makeinfo 是 Perl 程序，wasm 里跑不了——**但它的输出是确定性的**：同一份
# docstring + 同一份 macros.texi，在任何机器上渲染结果一致。所以渲染这件事
# 挪到**构建期**用真的 GNU makeinfo 做，运行时只读结果。
#
# 这不是本项目发明的招数：Octave 自己就这么干。`doc/interpreter/mk-doc-cache.pl:102`
# 在构建期调 makeinfo，把渲染好的纯文本写进 doc-cache。本脚本是同一个技术用在
# built-in-docstrings 上。
#
# 让 `help` 用上这份预渲染结果：不改任何 `.m`，靠的是 Octave 自己的格式判定——
# `libinterp/corefcn/help.cc:141` 的 `looks_like_texinfo()` **只检查第一行是否含
# `-*- texinfo -*-`**。把这行标记去掉，格式就成了 "plain text"，`help` 直接打印、
# 根本不调 makeinfo。也就是说：**渲染由 makeinfo 做（官方产物），只是提前做了**。
#
#   用法：python3 build/render-docstrings.py <built-in-docstrings> <macros.texi> <输出>
#
# 失败的条目**保留原文并去标记**（宁可印得难看，也不能让一个函数没有 help），
# 且会把失败数报出来。
import os
import subprocess
import sys
import tempfile
import time

TEXINFO_MARKER = "-*- texinfo -*-"
DOC_DELIM = 0x1D


def render_one(makeinfo, macros, body):
    """把一条 texinfo docstring 渲染成纯文本；成功返回文本，失败返回 None。

    命令与上游 __makeinfo__.m 一致（--no-headers --no-warn --no-validate
    --plaintext），另加 --force：上游在首次失败时会带 --force 重试一次，
    我们直接把重试前移。
    """
    # 上游在渲染前把 @seealso 改名为 @xseealso（那样 macros.texi 里的定义不会
    # 抢先展开，而是由 __makeinfo__ 的第三个参数负责），并在这里补上同样的展开，
    # 使输出与桌面版一致。
    text = body.replace("@seealso", "@xseealso")

    # 文件顺序**必须**是 `\input texinfo` → macros → 正文 → `@bye`，与上游
    # __makeinfo__.m:130-132 完全一致（它先 `[macros_text text]`，再在**最前面**
    # 套 `\input texinfo`）。
    #
    # 把 `\input texinfo` 放到 macros 之后就错了：它必须是文档的**第一行**才被
    # makeinfo 当成命令；出现在中间时会被当作普通文本原样印进输出——本脚本的
    # 第一版就是这么错的，输出里每条都多一行 `\input texinfo`。
    payload = "\\input texinfo\n\n" + macros + "\n" + text + "\n\n@bye\n"

    with tempfile.NamedTemporaryFile("w", suffix=".texi", delete=False,
                                     encoding="utf-8") as fh:
        fh.write(payload)
        path = fh.name
    try:
        r = subprocess.run(
            [makeinfo, "--no-headers", "--no-warn", "--no-validate",
             "--plaintext", "--force", "--output=-", path],
            capture_output=True, text=True, timeout=120)
        if r.returncode != 0 or not r.stdout.strip():
            return None
        out = r.stdout
    except (subprocess.TimeoutExpired, OSError):
        return None
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass

    # 上游渲染后做的收尾清理，逐条对应 __makeinfo__.m:161-174 的 regexprep：
    #   * @deftypefn 展开后开头多一个 ":"（makeinfo 对空 category 的行为）
    #   * 结尾多余的空行
    lines = out.split("\n")
    fixed = []
    for ln in lines:
        if ln.startswith(" -- : "):
            ln = " -- " + ln[len(" -- : "):]
        fixed.append(ln)
    out = "\n".join(fixed)
    while out.endswith("\n\n"):
        out = out[:-1]
    return out.rstrip("\n")


def main():
    if len(sys.argv) != 4:
        print(__doc__)
        return 2
    src, macros_path, out_path = sys.argv[1:4]

    makeinfo = "makeinfo"
    try:
        v = subprocess.run([makeinfo, "--version"], capture_output=True, text=True,
                           timeout=30)
        print(f"用 {v.stdout.splitlines()[0]}")
    except (OSError, subprocess.TimeoutExpired, IndexError):
        print("找不到 makeinfo：它是 Perl 程序，本步骤必须在**宿主**上跑。",
              file=sys.stderr)
        return 1

    macros = open(macros_path, encoding="utf-8", errors="replace").read()
    data = open(src, "rb").read()

    # 文件布局：文本头，0x1d，之后每条是 "name\n@c 来源\n<body>"，条目之间用 0x1d 分隔。
    #
    # ⚠️ 最后一条**不能**再跟一个 0x1d。多加一个分隔符会产生一个**空的尾条目**，
    # 而 libinterp/corefcn/help.cc:626-660 的解析循环遇到空条目时不会推进文件位置
    # （`while (file && (c = file.get()) != eof)` 在 EOF 前一个字符就退出了，
    # 外层 `while (! file.eof())` 于是**死循环**）——症状是 `help sin` 整个挂住、
    # 浏览器测试超时。实测代价：两次超时排查。
    head, _, rest = data.partition(bytes([DOC_DELIM]))
    if not rest:
        print(f"{src} 里没有 0x1d 分隔符——不是 built-in-docstrings 格式？",
              file=sys.stderr)
        return 1
    entries = rest.split(bytes([DOC_DELIM]))

    # 尾随的空段（原文件正常不会再有，但切分结果里可能是空串）直接丢掉，
    # 保证输出与输入**分隔符数量一致**。
    while entries and not entries[-1].strip():
        entries.pop()

    pieces = []
    rendered = kept = skipped = 0
    t0 = time.time()

    for ent in entries:
        if not ent.strip():
            skipped += 1
            pieces.append(ent)
            continue
        parts = ent.split(b"\n", 2)
        if len(parts) < 3:
            skipped += 1
            pieces.append(ent)
            continue
        name_line, c_line, body = parts
        text = body.decode("utf-8", "replace")

        # 已经是纯文本（或 html）的条目原样留下——只处理 texinfo 的。
        if TEXINFO_MARKER not in text:
            skipped += 1
            pieces.append(ent)
            continue

        # 去掉标记行本身：这是让 help 走 "plain text" 分支的关键，
        # 也是 help.cc 判定格式的唯一依据。
        body_src = "\n".join(
            ln for ln in text.split("\n") if ln.strip() != TEXINFO_MARKER)

        result = render_one(makeinfo, macros, body_src)
        if result is None:
            # 渲染失败：保留去掉标记的原文，条目仍然可读
            kept += 1
            result = body_src.strip("\n")
            print(f"  警告：{name_line.decode('utf-8', 'replace')} 渲染失败，保留原文",
                  file=sys.stderr)
        else:
            rendered += 1

        pieces.append(name_line + b"\n" + c_line + b"\n"
                      + result.encode("utf-8"))

    out = head + bytes([DOC_DELIM]) + bytes([DOC_DELIM]).join(pieces)
    open(out_path, "wb").write(out)

    # 结构自检：输出与输入的**分隔符数量必须一致**。多一个或少一个都会让
    # 上游 C++ 的解析循环行为异常（多一个 = 空尾条目 = 死循环，见上面的注释）。
    n_in = data.count(bytes([DOC_DELIM]))
    n_out = out.count(bytes([DOC_DELIM]))
    if n_in != n_out:
        print(f"结构自检失败：输入 {n_in} 个分隔符，输出 {n_out} 个——"
              f"数量必须一致（差一个就会让 help 挂住或丢条目）", file=sys.stderr)
        return 1

    dt = time.time() - t0
    print(f"render-docstrings: {rendered} 条经 makeinfo 渲染，{kept} 条保留原文，"
          f"{skipped} 条非 texinfo 未动；{dt:.1f}s")
    print(f"  {src} → {out_path}")
    print(f"  {os.path.getsize(src)} → {os.path.getsize(out_path)} 字节")
    return 0


if __name__ == "__main__":
    sys.exit(main())
