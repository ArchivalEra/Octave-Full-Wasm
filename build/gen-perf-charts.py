#!/usr/bin/env python3
"""生成 README 用的性能 SVG 柱状图（数据 = docs/charts/perf-data.json，实测留档）。
用法：python3 build/gen-perf-charts.py   → docs/charts/perf-5way.svg + perf-speedup-IP.svg"""
import json, math, os

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(REPO, "docs", "charts", "perf-data.json")
d = json.load(open(DATA, encoding="utf-8"))
work = d["workloads"]; series = d["series"]; ratios = d["ratios_IP_vs"]
COLORS = {"native ref-BLAS": "#8a8f98", "native OpenBLAS x24": "#2b6cb0",
          "wasm32-final": "#dd6b20", "wasm64-NEXT": "#38a169",
          "IllegalPerformance": "#c53030"}

def fmt(v):
    return ("%.3f" % v).rstrip("0").rstrip(".") if v < 0.01 else ("%.2f" % v).rstrip("0").rstrip(".")

# ── 图 1：分组柱（log10 纵轴）──
W, H = 1220, 460
L, R, T, B = 60, 40, 30, 96
lo, hi = 0.002, 0.7
def y(v): return T + (H-T-B) * (1 - (math.log10(v) - math.log10(lo)) / (math.log10(hi) - math.log10(lo)))
gw = (W-L-R)/len(work); bw = gw/len(series)*0.82
s = ['<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" font-family="sans-serif" font-size="11">' % (W,H)]
s.append('<rect width="100%" height="100%" fill="#fdfdfc"/>')
s.append('<text x="%d" y="18" font-size="13" font-weight="bold">Octave 11.3.0 — measured wall time (s, log scale) · lower is better</text>' % L)
for e in range(-3, 0):
    yy = y(10.0**e)
    s.append('<line x1="%d" y1="%.1f" x2="%d" y2="%.1f" stroke="#e2e2e2"/>' % (L, yy, W-R, yy))
    s.append('<text x="%d" y="%.1f" fill="#666">1e%d</text>' % (L-46, yy+4, e))
for gi, c in enumerate(work):
    x0 = L + gi*gw
    s.append('<text x="%.1f" y="%d" text-anchor="middle" fill="#333">%s</text>' % (x0+gw/2, H-B+14, c))
    for si, (name, vals) in enumerate(series.items()):
        v = vals[gi]; bh = y(lo) - y(v)
        x = x0 + (gw - bw)/2 + si*bw
        s.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" fill="%s"><title>%s / %s = %ss</title></rect>'
                 % (x, y(lo)-bh, bw-2, bh, COLORS[name], c, name, fmt(v)))
# 图例
lx = L
for name, col in COLORS.items():
    s.append('<rect x="%d" y="%d" width="11" height="11" fill="%s"/>' % (lx, H-40, col))
    s.append('<text x="%d" y="%d" fill="#333">%s</text>' % (lx+15, H-31, name))
    lx += 15 + 7*len(name) + 26
s.append('</svg>')
open(os.path.join(REPO, "docs", "charts", "perf-5way.svg"), "w").write("\n".join(s))

# ── 图 2：IllegalPerformance 相对加速比（横条，log X，1.0 基准线）──
W2, H2 = 1180, 130 + len(work)*46
L2, R2 = 150, 60
lo2, hi2 = 0.3, 9.0
def x(v): return L2 + (W2-L2-R2) * (math.log10(v) - math.log10(lo2)) / (math.log10(hi2) - math.log10(lo2))
s = ['<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" font-family="sans-serif" font-size="11">' % (W2,H2)]
s.append('<rect width="100%" height="100%" fill="#fdfdfc"/>')
s.append('<text x="%d" y="20" font-size="13" font-weight="bold">IllegalPerformance — speedup vs each baseline (x-times, log scale; 1.0 = parity) · higher is better</text>' % L2)
base4 = {k: v for k, v in ratios.items()}
x1, x2 = x(1.0), x(10.0)
s.append('<rect x="%.1f" y="34" width="%.1f" height="%d" fill="#f0f6f0"/>' % (x1, min(x2, W2-R2)-x1, H2-70))
s.append('<line x1="%.1f" y1="34" x2="%.1f" y2="%d" stroke="#999" stroke-dasharray="4,3"/>' % (x1, x1, H2-40))
s.append('<text x="%.1f" y="%d" fill="#777">1.0×</text>' % (x1+4, 46))
for e in range(-1, 1):
    xx = x(10.0**e)
    if lo2 <= 10.0**e <= hi2:
        s.append('<line x1="%.1f" y1="34" x2="%.1f" y2="%d" stroke="#e2e2e2"/>' % (xx, xx, H2-40))
for gi, c in enumerate(work):
    yy = 52 + gi*46
    s.append('<text x="%d" y="%.1f" text-anchor="end" fill="#333">%s</text>' % (L2-10, yy+12, c))
    for si, (bname, r) in enumerate(base4.items()):
        v = r  # IP 是该基线的 r 倍 = 该基线时长/IP 时长；同一 case 所有基线用同一 r（全负载几何平均）
        # 逐 case 用"基线秒/IP 秒"
        ip = series["IllegalPerformance"][gi]
        basev = series[{ "native ref-BLAS":"native ref-BLAS","native OpenBLAS x24":"native OpenBLAS x24",
                         "wasm32-final":"wasm32-final","wasm64-NEXT":"wasm64-NEXT" }[bname]][gi]
        ratio = basev/ip
        w = x(ratio) - x(1.0)
        col = "#c53030" if bname == "native OpenBLAS x24" else ["#8a8f98","#2b6cb0","#38a169"][si-1] if si else "#8a8f98"
        col = ["#8a8f98", "#2b6cb0", "#dd6b20", "#38a169"][si]
        bh = 8
        s.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%d" fill="%s"><title>%s vs %s = %.2f×</title></rect>'
                 % (x(1.0) if ratio>=1 else x(ratio), yy + si*9, abs(w), bh, col, c, bname, ratio))
for e in (-1, 0, 1):
    pass
for v, lbl in ((0.5,'0.5×'),(1.0,'1.0×'),(2.0,'2×'),(4.0,'4×'),(8.0,'8×')):
    xx = x(v)
    s.append('<text x="%.1f" y="%d" text-anchor="middle" fill="#666">%s</text>' % (xx, H2-24, lbl))
lx = L2
for si, bname in enumerate(base4):
    col = ["#8a8f98", "#2b6cb0", "#dd6b20", "#38a169"][si]
    s.append('<rect x="%d" y="%d" width="11" height="11" fill="%s"/>' % (lx, H2-14, col))
    s.append('<text x="%d" y="%d" fill="#333">vs %s</text>' % (lx+15, H2-5, bname))
    lx += 15 + 7*len(bname) + 30
s.append('</svg>')
open(os.path.join(REPO, "docs", "charts", "perf-speedup-IP.svg"), "w").write("\n".join(s))
print("SVG 已生成: docs/charts/perf-5way.svg + perf-speedup-IP.svg")
