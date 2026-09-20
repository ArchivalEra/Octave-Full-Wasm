#!/usr/bin/env python3
# Octave-Full-Wasm — ARPACK F77 源净化器（! 注释→c，& 续行→定式续行）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Normalize ARPACK Fortran sources to strict F77 for f2c-2016.

Rules (verified safe for arpack-ng 3.7.0: no inline '!', no '::', no modules):
1. Lines starting with '!' in column 1 -> 'c' comment (keeps line numbers).
2. Trailing '&' continuation: drop it; force column 6 of the next line
   to '&' (fixed-form continuation). Chains handled in order.
Usage: normalize_arpack.py SRCDIR OUTDIR
  Processes *.f, debug.h, stat.h found directly in SRCDIR (and UTIL subdir
  if present -- pass each dir separately).
"""
import os
import sys


def normalize(lines):
    out = []
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i].rstrip("\n")
        if line.startswith("!"):
            line = "c" + line[1:]
        stripped = line.rstrip()
        if stripped.endswith("&") and i + 1 < n:
            line = stripped[:-1].rstrip()
            nxt = lines[i + 1].rstrip("\n")
            if len(nxt) < 6:
                nxt = nxt.ljust(6)
            lst = list(nxt)
            lst[5] = "&"
            lines[i + 1] = "".join(lst) + "\n"
        out.append(line + "\n")
        i += 1
    return out


def main():
    srcdir, outdir = sys.argv[1], sys.argv[2]
    os.makedirs(outdir, exist_ok=True)
    count = 0
    for fn in sorted(os.listdir(srcdir)):
        if fn.endswith(".f") or fn in ("debug.h", "stat.h"):
            with open(os.path.join(srcdir, fn), errors="replace") as fh:
                lines = fh.readlines()
            with open(os.path.join(outdir, fn), "w") as fh:
                fh.writelines(normalize(lines))
            count += 1
    print(f"normalized {count} files -> {outdir}")


if __name__ == "__main__":
    main()
