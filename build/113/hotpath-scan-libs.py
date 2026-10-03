#!/usr/bin/env python3
# Octave-Full-Wasm — **hotpath 库组件扫描**（wasm64-NEXT 工单 58）：找下一个"可替换部件"
# Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
# 目标与工单 55 同法：找**跨负载共同**的库级成本（分配器就是这样找到的）。
# 轴 = 库组件（libm / libc 内存 / fftw / suitesparse 稀疏 / qhull / glpk / sundials / arpack / zlib）。
# 用法：python3 build/113/hotpath-scan-libs.py [--station DIR] [--port P] [--only a,b]
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hotpath  # noqa: E402

WORKLOADS = [
    # ⚠ 量法（工单 58 修）：采样覆盖整个 eval ⇒ setup 会污染归因。⇒ setup 用**便宜确定性向量**
    #   （不用 rand），热点操作**循环多次**让热点主导。
    ("libm-sin-cos",  "x=(1:2e6)/1e6; tic; for k=1:20, y=sin(x)+cos(x); end"),
    ("libm-exp-log",  "x=(1:2e6)/1e6+0.1; tic; for k=1:20, y=exp(x)+log(x); end"),
    ("libm-sqrt-pow", "x=(1:2e6)/1e6+0.1; tic; for k=1:20, y=sqrt(x)+x.^0.7; end"),
    ("libm-atan2",    "x=(1:1e6)/1e6-0.5; y=x*2; tic; for k=1:20, z=atan2(y,x); end"),
    ("memcpy-copy",   "A=ones(200); tic; for k=1:1e5, B=A; end"),
    ("memcpy-reshape","A=ones(1000); tic; for k=1:2e4, B=reshape(A,100,100); C=A(:); end"),
    ("fft",           "x=(1:2e6)/1e6; tic; for k=1:10, y=fft(x); end"),
    ("sparse-chol",   "A=sprandsym(5e4,1e-3); A=A'*A+speye(5e4); tic; for k=1:3, R=chol(A); end"),
    ("qhull-conv",    "P=[(1:3e5)'/3e5, sin(1:3e5)', cos(1:3e5)']; tic; K=convhulln(P);"),
    ("arpack-eigs",   "A=gallery('tridiag',2e3); tic; d=eigs(A,10);"),
    ("interp-spline", "x=1:1e4; y=sin(x/1e3); xi=1:0.5:1e4; tic; for k=1:50, yi=interp1(x,y,xi,'spline'); end"),
    ("poly-many",     "tic; for k=1:3e4, c=poly([1 2 3 4]); end"),
    ("det-lu-many",   "A0=magic(20); tic; for k=1:3e4, d=det(A0); end"),
    ("sort-many",     "x=mod(1:5e5,997)/997; tic; for k=1:2e2, y=sort(x); end"),
    ("index-assign",  "A=zeros(1,1e6); tic; for k=1:5e3, A(1:2e5)=k; end"),
]


def main(argv):
    station = None; port = 8895; only = None
    if "--station" in argv: station = argv[argv.index("--station") + 1]
    if "--port" in argv: port = int(argv[argv.index("--port") + 1])
    if "--only" in argv: only = set(argv[argv.index("--only") + 1].split(","))
    if station is None:
        station = os.path.join(hotpath.STATIONS, "w64-sym")
    ts = time.strftime("%Y%m%d-%H%M%S")
    out = os.path.join(hotpath.LOGROOT, "libs-" + ts)
    os.makedirs(out, exist_ok=True)
    results = []
    for name, snippet in WORKLOADS:
        if only and name not in only: continue
        try:
            rep = hotpath.sample(snippet, lane="w64", port=port, top=8, profile_dir=station)
            results.append({"name": name, "samples": rep["samples"], "unnamed_pct": rep["unnamed_pct"],
                            "hotspots": rep["hotspots"]})
            print("\n=== %-15s samples=%d unnamed=%.1f%%" % (name, rep["samples"], rep["unnamed_pct"]))
            for h in rep["hotspots"][:5]:
                print("   %6.1f%%  %s" % (h["selfPct"], h["name"][:74]))
        except Exception as e:                                        # noqa: BLE001
            results.append({"name": name, "error": str(e)[:200]})
            print("\n=== %-15s ERROR %s" % (name, str(e)[:110]))
    open(os.path.join(out, "scan.json"), "w", encoding="utf-8").write(
        json.dumps(results, ensure_ascii=False, indent=1) + "\n")
    print("\n→ %s/scan.json" % out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
