#!/bin/sh
# Octave-Full-Wasm — **两站点一致性闸门**（D4，2026-09-24）
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么有它：本仓一直是"8768 = 实验车道、8761 = 验收底线"，promote 就是"把 8768 的产物
# 拷到 8761"。但"两边到底一不一样"**从来只能靠人手工 sha256sum** —— 2026-09-24 那次
# `plotbridge.js` 的挂载点事故（少写一层目录、把桥文件铺到 `m/` 根上）就是这么暴露慢的。
#
# ★ 判据分两类，**别混**：
#   · `octave.{wasm,js,data}` + `index.html` + `assets-loader.js` + `VERSION`
#     —— **部署件**：两边不一致就是"有一边没 promote"，要**说清是哪一边**；
#   · `assets/m/*.js` 与 `assets/manifest.json` 里的 sha
#     —— **资产**：实验期允许不同（8768 先改），但**必须报出来**。
#
# 用法：
#   sh build/check-site-parity.sh              # 报告（有差异也 exit 0 —— "不一定是错，但要知道"）
#   sh build/check-site-parity.sh --strict     # 有任何差异就 exit 1（promote 之后该跑这个）
#
# ⚠️ 站点目录在持久盘上，不在仓库里；`SITE_A`/`SITE_B` 可以覆盖（默认 site=8761、siteWebGL=8768）。
set -u
BASE=/mnt/hdd/octave-wasm-build
A="${SITE_A:-$BASE/site}"          # 8761 = 验收底线
B="${SITE_B:-$BASE/siteWebGL}"     # 8768 = 实验车道
STRICT=0
[ "${1:-}" = "--strict" ] && STRICT=1

diffcount=0
say() { printf '%s\n' "$*"; }

sha() { [ -f "$1" ] && sha256sum "$1" | cut -c1-16 || echo "(缺)"; }

say "A = $A   （8761 验收底线）"
say "B = $B   （8768 实验车道）"
say "------------------------------------------------------------"

say "【部署件】"
for f in octave.wasm octave.js octave.data index.html assets-loader.js VERSION; do
  a=$(sha "$A/$f"); b=$(sha "$B/$f")
  if [ "$a" = "$b" ]; then
    printf '  %-16s %s  一致\n' "$f" "$a"
  else
    printf '  %-16s A=%s  B=%s  ← **不一致**\n' "$f" "$a" "$b"
    diffcount=$((diffcount + 1))
  fi
done

say "【资产：**清单里引用到的** assets/m/*.js】"
# ⚠️ 只比"清单引用到的"资产：站点目录里还会有**没被任何清单引用的遗留文件**
#    （实测：8768 上有 `p5osmesa.js` 与 `octave.js.orig` —— 退役的 OSMesa 线的残留）。
#    把它们算成"两站点不一致"会让这个闸门失去意义（每次都红，人就学会无视它）。
#    遗留文件单独在下面报出来，**不动它**（不是我建的，删之前该先问）。
referenced=$(python3 - "$A/assets/manifest.json" "$B/assets/manifest.json" 2>/dev/null <<'PY'
import json, sys, os
names = set()
for p in sys.argv[1:]:
    try:
        d = json.load(open(p, encoding='utf-8'))
    except Exception:
        continue
    xs = d if isinstance(d, list) else d.get('assets', [])
    for x in xs:
        u = x.get('url') or ''
        if u.startswith('assets/m/'):
            names.add(os.path.basename(u))
print('\n'.join(sorted(names)))
PY
)
for n in $referenced; do
  a=$(sha "$A/assets/m/$n"); b=$(sha "$B/assets/m/$n")
  if [ "$a" = "$b" ]; then
    printf '  %-16s %s  一致\n' "$n" "$a"
  else
    printf '  %-16s A=%s  B=%s  ← **不一致**\n' "$n" "$a" "$b"
    diffcount=$((diffcount + 1))
  fi
done

say "【未引用的遗留文件（**不算差异**，只是报出来）】"
for d in "$A" "$B"; do
  [ -d "$d/assets/m" ] || continue
  who=$( [ "$d" = "$A" ] && echo "A/8761" || echo "B/8768" )
  for f in "$d/assets/m"/*.js; do
    [ -f "$f" ] || continue
    n=$(basename "$f")
    if ! printf '%s\n' "$referenced" | grep -qx "$n"; then
      say "  $who: assets/m/$n （没被清单引用）"
    fi
  done
done
# 清单条目数（条目本身的 sha 在文件里，逐个比会太长；这里比"两边清单的 name→sha 映射"是否等价）
for d in "$A" "$B"; do
  [ -f "$d/assets/manifest.json" ] || { say "  ⚠️ $d/assets/manifest.json 缺失"; diffcount=$((diffcount + 1)); }
done
if [ -f "$A/assets/manifest.json" ] && [ -f "$B/assets/manifest.json" ]; then
  python3 - "$A/assets/manifest.json" "$B/assets/manifest.json" <<'PY'
import json, sys
def m(p):
    d = json.load(open(p, encoding='utf-8'))
    xs = d if isinstance(d, list) else d.get('assets', [])
    return {x['name']: x.get('sha256', '') for x in xs}
a, b = m(sys.argv[1]), m(sys.argv[2])
only_a = sorted(set(a) - set(b)); only_b = sorted(set(b) - set(a))
bad = sorted(k for k in set(a) & set(b) if a[k] != b[k])
print(f'  清单条目 A={len(a)} B={len(b)}；sha 不同的 {len(bad)} 条')
if only_a: print(f'  ⚠️ 只在 A 里：{only_a}')
if only_b: print(f'  ⚠️ 只在 B 里：{only_b}')
for k in bad[:10]:
    print(f'  {k}: A={a[k][:16]} B={b[k][:16]}  ← **不一致**')
sys.exit(3 if (only_a or only_b or bad) else 0)
PY
  [ $? -eq 3 ] && diffcount=$((diffcount + 1))
fi

say "------------------------------------------------------------"
if [ "$diffcount" = "0" ]; then
  say "两站点**完全一致**（部署件 + 资产包 + 清单）。"
  exit 0
fi
say "两站点有 $diffcount 处差异。"
say "⚠️ **这不一定是错误**：8768 本来就允许先改、promote 之后才该一致。"
say "   但你必须知道：**现在 8761 上跑的就是 A 那一列**（验收底线以 A 为准）。"
say "   刚做完 promote 的话，用 --strict 重跑本脚本，应当是 0 差异。"
[ "$STRICT" = "1" ] && exit 1
exit 0
