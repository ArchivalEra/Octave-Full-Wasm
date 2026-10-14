#!/usr/bin/env python3
# 把预编 .pyc 打进轮子（**部署形态**：客户端只下载、不解包重建）——A/B 夹具的 B 档（2026-10-14）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么是"打进轮子"而不是"页面里逐个写 FS"：上一轮实测（sympy-pyc-ab 第一版）B 档把
# 1532 个 .pyc 以 base64 过 JSON + 逐文件 FS.writeFile 花了 3580 ms —— 那是**交付方式的
# 开销**，不是 .pyc 的固有代价。打进轮子后，客户端只做它本来就在做的事（fetch + 解包），
# 唯一变量 = 轮子里有没有 __pycache__。
#
# 用法：python3 repack-wheel.py <源轮子> <pyc 源目录> <输出轮子>
#   例：python3 repack-wheel.py sympy-1.14.0-py3-none-any.whl /tmp/sympy-pycbuild sympy-ab.whl
#
# 判据：输出轮子里 `__pycache__/*.pyc` 条目数 == 源目录里 .pyc 数（逐条核，缺一即非零退出）。
import sys, os, zipfile, hashlib, shutil

def main():
    src, pyc_root, out = sys.argv[1], sys.argv[2], sys.argv[3]
    top = os.path.basename(src).split('-')[0]          # sympy / mpmath
    pyc_dir = os.path.join(pyc_root, top)
    if not os.path.isdir(pyc_dir):
        print(f"FATAL: 缺 {pyc_dir}", file=sys.stderr); return 2
    n_src = sum(1 for r, _, fs_ in os.walk(pyc_dir) for f in fs_ if f.endswith('.pyc'))
    shutil.copyfile(src, out)
    n_add = 0
    with zipfile.ZipFile(out, 'a', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        existing = set(z.namelist())
        for r, _, fs_ in os.walk(pyc_dir):
            for f in fs_:
                if not f.endswith('.pyc'):
                    continue
                p = os.path.join(r, f)
                rel = os.path.relpath(p, os.path.dirname(pyc_dir)).replace(os.sep, '/')
                if rel in existing:
                    continue
                z.write(p, rel)
                n_add += 1
    sz = os.path.getsize(out)
    sha = hashlib.sha256(open(out, 'rb').read()).hexdigest()
    print(f"repack {top}: +{n_add} pyc（源 {n_src}）  {sz} B  sha256 {sha}")
    if n_add != n_src:
        print("FATAL: 条目数不符（有同名冲突？）", file=sys.stderr); return 1
    return 0

if __name__ == '__main__':
    sys.exit(main())
