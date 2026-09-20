#!/usr/bin/env python3
# Octave-Full-Wasm — Octave Forge 取包器（依赖感知 + 版本按宿主 Octave 过滤）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么需要它：Forge 包的**最新版经常要求更新的 Octave**（例如 statistics 1.9.x 要
# Octave ≥11，而本项目的 Octave 是 7.2）。所以不能"取最新"，必须按
# `depends` 里的 `octave (>= X)` 过滤，并且递归解析包间依赖。
#
# 索引：https://gnu-octave.github.io/packages/packages.json（含每版 sha256 与依赖）
#
# 用法：
#   forge-fetch.py --octave 7.2.0 --dest <目录> [--proxy http://127.0.0.1:2080] 包名…
#   forge-fetch.py --list-compatible            # 只列出 7.2 可用的包与版本
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.request

INDEX_URL = "https://gnu-octave.github.io/packages/packages.json"
SKIP_DEPS = {"octave", "pkg"}


def vtuple(s):
    return tuple(int(x) for x in re.findall(r"\d+", str(s))[:3]) or (0,)


def check_ver(need, want):
    """need: 形如 '7.2.0'；want: 形如 'octave (>= 4.0.0)' → 是否满足"""
    m = re.match(r"octave\s*\(\s*(>=|<=|==|>|<)\s*([\d.]+)\s*\)", want)
    if not m:
        return True
    op, ver = m.group(1), m.group(2)
    a, b = vtuple(need), vtuple(ver)
    return {">=": a >= b, "<=": a <= b, "==": a == b, ">": a > b, "<": a < b}[op]


def octave_ok(need, deps):
    return all(check_ver(need, d) for d in deps if d.startswith("octave"))


def pick_version(need, entry):
    """在版本表里挑「满足 Octave 版本约束」的最新版"""
    ok = [v for v in entry.get("versions", []) if octave_ok(need, v.get("depends", []))]
    if not ok:
        return None
    ok.sort(key=lambda v: vtuple(v["id"]), reverse=True)
    return ok[0]


def load_index(proxy=None):
    cache = "/mnt/hdd/octave-wasm-build/third_party/forge/packages.json"
    if os.path.isfile(cache) and os.path.getsize(cache) > 10000:
        with open(cache, encoding="utf-8") as fh:
            return json.load(fh)
    if proxy:
        os.environ["https_proxy"] = proxy
        os.environ["http_proxy"] = proxy
    with urllib.request.urlopen(INDEX_URL, timeout=60) as r:
        data = json.loads(r.read().decode("utf-8"))
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    with open(cache, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False)
    return data


def download(url, dest, sha256=None, proxy=None):
    if os.path.isfile(dest) and sha256 and hashlib.sha256(open(dest, "rb").read()).hexdigest() == sha256:
        return "cached"
    cmd = ["curl", "-sSL", "--max-time", "600", "-o", dest, url]
    if proxy:
        cmd[1:1] = ["-x", proxy]
    subprocess.run(cmd, check=True)
    if sha256:
        got = hashlib.sha256(open(dest, "rb").read()).hexdigest()
        if got != sha256:
            return f"CHECKSUM-MISMATCH({got[:12]}!={sha256[:12]})"
    return "ok"


def resolve(index, need, names, plan, seen):
    for name in names:
        if name in seen or name in SKIP_DEPS:
            continue
        seen.add(name)
        entry = index.get(name)
        if not entry:
            print(f"  ! 索引里没有包: {name}", file=sys.stderr)
            continue
        v = pick_version(need, entry)
        if not v:
            print(f"  ! {name}: 没有兼容 Octave {need} 的版本", file=sys.stderr)
            continue
        plan.append((name, v))
        deps = [d.split()[0] for d in v.get("depends", [])]
        resolve(index, need, deps, plan, seen)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--octave", default="7.2.0")
    ap.add_argument("--dest", default="/mnt/hdd/octave-wasm-build/third_party/forge")
    ap.add_argument("--proxy", default="http://127.0.0.1:2080")
    ap.add_argument("--list-compatible", action="store_true")
    ap.add_argument("packages", nargs="*")
    a = ap.parse_args()

    index = load_index(a.proxy)

    if a.list_compatible:
        n = 0
        for name in sorted(index):
            v = pick_version(a.octave, index[name])
            if v:
                print(f"{name:<28} {v['id']}")
                n += 1
        print(f"\n共 {n}/{len(index)} 个包有兼容 Octave {a.octave} 的版本")
        return 0

    if not a.packages:
        ap.error("要么给包名，要么 --list-compatible")

    plan, seen = [], set()
    resolve(index, a.octave, a.packages, plan, seen)
    os.makedirs(a.dest, exist_ok=True)

    print(f"=== 为 Octave {a.octave} 解析出 {len(plan)} 个包 ===")
    for name, v in plan:
        fn = f"{name}-{v['id']}.tar.gz"
        dest = os.path.join(a.dest, fn)
        status = download(v["url"], dest, v.get("sha256"), a.proxy)
        size = os.path.getsize(dest) if os.path.isfile(dest) else 0
        deps = ",".join(d.split()[0] for d in v.get("depends", []) if d.split()[0] not in SKIP_DEPS)
        print(f"  {name:<20} {v['id']:<10} {status:<22} {size:>9} 字节  依赖[{deps}]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
