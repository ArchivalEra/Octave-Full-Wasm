#!/bin/sh
# Octave-Full-Wasm — **三处一致性闸门**（D4，2026-09-24；★ 第三列 2026-09-26，批次 A0）
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么有它：本仓一直是"8768 = 实验车道、8761 = 验收底线"，promote 就是"把 8768 的产物
# 拷到 8761"。但"两边到底一不一样"**从来只能靠人手工 sha256sum** —— 2026-09-24 那次
# `plotbridge.js` 的挂载点事故（少写一层目录、把桥文件铺到 `m/` 根上）就是这么暴露慢的。
#
# ★ 为什么加了第三列（A0，2026-09-26）：仓库 `site/` 是**入库的可部署镜像**，而它与
#   `bridge/`（页面宿主的真相源）之间**没有任何同步机制**（实测：`grep -rn 'site/index.html'
#   --include='*.sh' --include='*.py' .` = 0 命中），只靠 AGENTS 里那条手工 `rsync`。
#   ⇒ 重构页面后忘了同步仓库 `site/`，**8761/8768 之间照样 parity 绿**，而入库镜像已经过期。
#   第三列把这个盲区堵上：C = 仓库 `site/`（默认取本脚本所在仓库的 `site/`）。
#
# ★ 判据分两类，**别混**：
#   · `octave.{wasm,js,data}` + `octave.build.json`（产物身份证）+ `index.html` +
#     `assets-loader.js` + `VERSION` + `assets/manifest.json`
#     —— **部署件**：三处不一致就是"有一处没同步"，要**说清是哪一处**；
#   · `assets/m/*.js` 与 `assets/manifest.json` 里的 sha
#     —— **资产**：实验期允许不同（8768 先改），但**必须报出来**。
#
# ⚠️ 只比"清单引用到的"资产与**上面那张部署件清单**：站点目录里会有**没被任何清单引用的
#    遗留文件**（实测：8768 上有 `p5osmesa.js`、`octave.js.orig`、`wtest.*`；三处之间还有
#    内容不同的非部署件 —— 实测 `matrix-android.html`：8768 那份 41386 B、8761 与仓库 33947 B）。
#    把它们算成"不一致"会让这个闸门失去意义（每次都红，人就学会无视它），所以它们**单独
#    报出来、不算差异** —— 见末尾【非部署件的内容差异】那一节。
#
# 用法：
#   sh build/check-site-parity.sh              # 报告（有差异也 exit 0 —— "不一定是错，但要知道"）
#   sh build/check-site-parity.sh --strict     # 有任何差异就 exit 1（promote 之后该跑这个）
#
# ⚠️ 站点目录在持久盘上，不在仓库里；`SITE_A`/`SITE_B`/`SITE_C` 可以覆盖
#    （默认 A=site→8761、B=siteWebGL→8768、C=仓库 `site/`）。
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
BASE=/mnt/hdd/octave-wasm-build
A="${SITE_A:-$BASE/site}"          # 8761 = 验收底线
B="${SITE_B:-$BASE/siteWebGL}"     # 8768 = 实验车道
C="${SITE_C:-$REPO/site}"          # 仓库入库镜像（`bridge/` 的下游，手工 rsync）
STRICT=0
[ "${1:-}" = "--strict" ] && STRICT=1

# 部署件清单：三处必须逐字节相同的那批
DEPLOY="octave.wasm octave.js octave.data octave.build.json index.html assets-loader.js VERSION assets/manifest.json"

diffcount=0
say() { printf '%s\n' "$*"; }

sha() { [ -f "$1" ] && sha256sum "$1" | cut -c1-16 || echo "(缺)"; }
who() { case "$1" in "$A") echo "A/8761" ;; "$B") echo "B/8768" ;; "$C") echo "C/仓库" ;; *) echo "$1" ;; esac; }

say "A = $A   （8761 验收底线）"
say "B = $B   （8768 实验车道）"
say "C = $C   （仓库入库镜像）"
say "------------------------------------------------------------"

say "【部署件】"
for f in $DEPLOY; do
  a=$(sha "$A/$f"); b=$(sha "$B/$f"); c=$(sha "$C/$f")
  if [ "$a" = "$b" ] && [ "$b" = "$c" ]; then
    printf '  %-20s %s  三处一致\n' "$f" "$a"
  else
    printf '  %-20s A=%s  B=%s  C=%s  ← **不一致**\n' "$f" "$a" "$b" "$c"
    diffcount=$((diffcount + 1))
  fi
done

say "【资产：**三处清单引用到的** assets/m/*.js】"
# ⚠️ 只比"清单引用到的"资产：站点目录里还会有**没被任何清单引用的遗留文件**
#    （实测：8768 上有 `p5osmesa.js` 与 `octave.js.orig` —— 退役的 OSMesa 线的残留）。
#    把它们算成"三处不一致"会让这个闸门失去意义（每次都红，人就学会无视它）。
#    遗留文件单独在下面报出来，**不动它**（不是我建的，删之前该先问）。
referenced=$(python3 - "$A/assets/manifest.json" "$B/assets/manifest.json" "$C/assets/manifest.json" 2>/dev/null <<'PY'
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
  a=$(sha "$A/assets/m/$n"); b=$(sha "$B/assets/m/$n"); c=$(sha "$C/assets/m/$n")
  if [ "$a" = "$b" ] && [ "$b" = "$c" ]; then
    printf '  %-20s %s  三处一致\n' "$n" "$a"
  else
    printf '  %-20s A=%s  B=%s  C=%s  ← **不一致**\n' "$n" "$a" "$b" "$c"
    diffcount=$((diffcount + 1))
  fi
done

say "【未引用的遗留资产（**不算差异**，只是报出来）】"
for d in "$A" "$B" "$C"; do
  [ -d "$d/assets/m" ] || continue
  for f in "$d/assets/m"/*.js; do
    [ -f "$f" ] || continue
    n=$(basename "$f")
    if ! printf '%s\n' "$referenced" | grep -qx "$n"; then
      say "  $(who "$d"): assets/m/$n （没被清单引用）"
    fi
  done
done

# 清单条目数 + 三处的 name→sha 映射是否等价（逐个打印太长，只打不一致的键）
for d in "$A" "$B" "$C"; do
  [ -f "$d/assets/manifest.json" ] || { say "  ⚠️ $d/assets/manifest.json 缺失"; diffcount=$((diffcount + 1)); }
done
if [ -f "$A/assets/manifest.json" ] && [ -f "$B/assets/manifest.json" ] && [ -f "$C/assets/manifest.json" ]; then
  python3 - "$A/assets/manifest.json" "$B/assets/manifest.json" "$C/assets/manifest.json" <<'PY'
import json, sys
def m(p):
    d = json.load(open(p, encoding='utf-8'))
    xs = d if isinstance(d, list) else d.get('assets', [])
    return {x['name']: x.get('sha256', '') for x in xs}
maps = [m(p) for p in sys.argv[1:]]
lbl = ('A', 'B', 'C')
print('  清单条目 A=%d B=%d C=%d' % tuple(len(x) for x in maps))
bad = 0
for k in sorted(set().union(*[set(x) for x in maps])):
    vals = [x.get(k) for x in maps]
    if len(set(vals)) != 1:
        bad += 1
        if bad <= 10:
            print('  %s: %s  ← **不一致**' % (
                k, '  '.join('%s=%s' % (l, (v[:16] if v else '(缺)')) for l, v in zip(lbl, vals))))
if bad > 10:
    print('  …另有 %d 条不一致未列出' % (bad - 10))
sys.exit(3 if bad else 0)
PY
  [ $? -eq 3 ] && diffcount=$((diffcount + 1))
fi

say "【非部署件的内容差异（**只报，不算差异**）】"
say "  为什么只报：这批里有**手工维护、无生成器、无测试**的页面（实测 matrix-android.html）——"
say "  它该不该跟 8761/仓库同步是**人的决定**，闸门不替人定这件事。"
python3 - "$A" "$B" "$C" "$DEPLOY" <<'PY'
import hashlib, os, sys
A, B, C, deploy = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4].split()

def walk(root):
    out = {}
    for dirpath, _, files in os.walk(root):
        for fn in files:
            if fn.endswith('.gz'):
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, root)
            if rel in deploy or rel.startswith('assets/m/'):
                continue          # 部署件与资产在上面各自的节里比过了
            out[rel] = full
    return out

maps = [walk(x) for x in (A, B, C)]
lbl = ('A/8761', 'B/8768', 'C/仓库')
allnames = set().union(*[set(m) for m in maps])
for n in sorted(allnames):
    miss = [l for l, m in zip(lbl, maps) if n not in m]
    if miss:
        print('  只在 %s 里没有：%s' % ('/'.join(miss), n))

def h(p):
    hh = hashlib.sha256()
    with open(p, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''):
            hh.update(chunk)
    return hh.hexdigest()[:16]

shown = 0
for n in sorted(allnames):
    if any(n not in m for m in maps):
        continue
    vals = [h(m[n]) for m in maps]
    if len(set(vals)) != 1:
        shown += 1
        sizes = [os.path.getsize(m[n]) for m in maps]
        print('  %s：%s  ← 内容不同（%s 字节）' % (
            n, '  '.join('%s=%s' % (l, v) for l, v in zip(lbl, vals)),
            '/'.join(str(s) for s in sizes)))
if not shown:
    print('  （无）')
PY

say "------------------------------------------------------------"
if [ "$diffcount" = "0" ]; then
  say "三处**完全一致**（部署件 + 资产包 + 清单）。"
  exit 0
fi
say "三处有 $diffcount 处差异。"
say "⚠️ **这不一定是错误**：8768 本来就允许先改、promote 之后才该一致。"
say "   但你必须知道：**现在 8761 上跑的就是 A 那一列**（验收底线以 A 为准）；"
say "   **入库镜像以 C 那一列为准**，C 落后于 A 就意味着「仓库里那份不是现役形态」。"
say "   刚做完 promote 的话，用 --strict 重跑本脚本，应当是 0 差异。"
[ "$STRICT" = "1" ] && exit 1
exit 0
