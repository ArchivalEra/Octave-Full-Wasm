#!/usr/bin/env python3
# Octave-Full-Wasm — **hotpath 扫描批**（wasm64-NEXT 工单 55）：跨轴找可动点
# Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
#
# 用 hotpath 仪器扫**非 matmul** 的负载（解释器循环/索引/字符串/排序/结构体/内存），
# 看平台税之外有没有可归因的热点。复用同一个符号站（建一次，扫多次）。
# 输出：hotpath-logs/<ts>/scan.json（每片段 top 热点）+ stdout 表。
# 用法：python3 build/113/hotpath-scan.py [--station DIR] [--port 8895]
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hotpath  # noqa: E402

# 负载：每轴一个，跑 ~1.5s（够几百样本，又不拖长扫描）
# ⚠ 不许逐元素扩数组（O(n²)，能挂死仪器——实测被 struct-array 卡过）⇒ 一律**预分配**。
WORKLOADS = [
    ("loop-for",       "s=0; tic; for k=1:3e6, s=s+k; end"),
    ("loop-while",     "k=0; tic; while k<2e6, k=k+1; end"),
    ("index-gather",   "x=rand(1,1e6); idx=randi(1e6,1,3e5,1); tic; y=x(idx);"),
    ("string-cat",     "c=cell(1,2e4); for k=1:2e4, c{k}='abc'; end; tic; s=[c{:}];"),
    ("string-find",    "s=repmat('ab',1,1e5); tic; for k=1:2e3, t=find(s=='a',1); end"),
    ("sort",           "x=rand(1,3e6); tic; y=sort(x);"),
    ("struct-array",   "a=struct('x',num2cell(1:2e5),'y',num2cell(1:2e5)); tic; for k=1:2e5, a(k).x=a(k).x+1; end"),
    ("cell-array",     "c=cell(1,1e5); tic; for k=1:1e5, c{k}=k; end"),
    ("sprintf-loop",   "tic; for k=1:2e4, s=sprintf('%d', k); end"),
    ("func-handle",    "f=@(x) x*x; tic; s=0; for k=1:2e5, s=s+f(k); end"),
    ("mem-alloc",      "tic; for k=1:2e4, z=zeros(1,1000); end"),
    ("dot",            "x=rand(1,1e7); y=rand(1,1e7); tic; s=dot(x,y);"),
]


def main(argv):
    station = None
    port = 8895
    only = None
    if "--station" in argv:
        station = argv[argv.index("--station") + 1]
    if "--port" in argv:
        port = int(argv[argv.index("--port") + 1])
    if "--only" in argv:
        only = set(argv[argv.index("--only") + 1].split(","))
    if station is None:
        # 复用/建符号站
        station = os.path.join(hotpath.STATIONS, "w64-sym")
        w64 = os.path.join(station, "w64", "octave.wasm")
        if not hotpath.has_name_section(w64):
            print("建符号站（一次）…", flush=True)
            hotpath.symbols("w64", out=station,
                            openblas="/src/work/e2-openblas-lib-w64-rsimd")
    ts = time.strftime("%Y%m%d-%H%M%S")
    out = os.path.join(hotpath.LOGROOT, ts)
    os.makedirs(out, exist_ok=True)
    results = []
    for name, snippet in WORKLOADS:
        if only and name not in only:
            continue
        try:
            rep = hotpath.sample(snippet, lane="w64", port=port, top=8, profile_dir=station)
            top = rep["hotspots"][:5]
            results.append({"name": name, "snippet": snippet, "samples": rep["samples"],
                            "trusted": rep["trusted"], "unnamed_pct": rep["unnamed_pct"],
                            "hotspots": top})
            print("\n=== %-14s  samples=%d  unnamed=%.1f%%" % (name, rep["samples"], rep["unnamed_pct"]))
            for h in top:
                print("   %6.1f%%  %s" % (h["selfPct"], h["name"][:78]))
        except Exception as e:                                        # noqa: BLE001
            results.append({"name": name, "error": str(e)[:200]})
            print("\n=== %-14s  ERROR %s" % (name, str(e)[:120]))
    open(os.path.join(out, "scan.json"), "w", encoding="utf-8").write(
        json.dumps(results, ensure_ascii=False, indent=1) + "\n")
    print("\n→ %s/scan.json" % out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
