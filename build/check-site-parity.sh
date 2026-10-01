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

# ── 自证（F1，2026-09-26）────────────────────────────────────────────────────
# 判据：① 三处齐全且一致 ⇒ 通过；② **三处都缺 VERSION ⇒ 必须红**（零值守卫）；
#       ③ 一处不同 ⇒ 必须红；④ 车道 `.oct` 某一处不同 ⇒ 必须红；
#       ⑤ **三处都没有车道 .oct** ⇒ 必须红（零值守卫：分档检查不许空转）。
#       用例用 SITE_A/B/C 指向临时夹具目录，不碰真实站点。
if [ "${1:-}" = "--selftest" ]; then
  tmp="$(mktemp -d)"; fails=0; ncases=0
  mkfix() {
    mkdir -p "$1/assets/oct-threads"
    for f in octave.wasm octave.js octave.data index.html assets-loader.js octave.build.json \
             VERSION lane.js octave-core.js octave-worker.js; do
      printf 'same-%s' "$f" > "$1/$f"
    done
    mkdir -p "$1/threads"
    for f in octave.wasm octave.js octave.data octave.build.json; do
      printf 'same-thr-%s' "$f" > "$1/threads/$f"
    done
    printf '[]' > "$1/assets/manifest.json"
    printf '[]' > "$1/assets/manifest.threads.json"
    printf 'lane-oct' > "$1/assets/oct-threads/a.oct"
  }
  probe() {  # $1 = 期望（ok|red），$2 = 用例名
    ncases=$((ncases + 1))
    got="ok"
    SITE_A="$tmp/a" SITE_B="$tmp/b" SITE_C="$tmp/c" sh "$0" --strict >/dev/null 2>&1 || got="red"
    if [ "$got" = "$1" ]; then echo "PASS | $2"
    else echo "fail | $2（期望 $1 实得 $got）"; fails=$((fails + 1)); fi
  }
  mkfix "$tmp/a"; mkfix "$tmp/b"; mkfix "$tmp/c"
  probe ok "三处齐全且一致 ⇒ 通过"
  rm -f "$tmp/a/VERSION" "$tmp/b/VERSION" "$tmp/c/VERSION"
  probe red "★ 三处都缺 VERSION ⇒ 必须红"
  printf 'diff' > "$tmp/b/VERSION"
  probe red "一处内容不同 ⇒ 红"
  rm -f "$tmp/a/VERSION" "$tmp/b/VERSION" "$tmp/c/VERSION"   # 复原（下面只动车道那一层）
  printf 'lane-oct-OLD' > "$tmp/c/assets/oct-threads/a.oct"
  probe red "★ 车道 .oct 有一处是旧件 ⇒ 必须红（B6：另一套编译的 44 个 side module）"
  rm -f "$tmp/a/assets/oct-threads/a.oct" "$tmp/b/assets/oct-threads/a.oct" "$tmp/c/assets/oct-threads/a.oct"
  probe red "★ 三处都没有车道 .oct ⇒ 必须红（零值守卫：分档检查不许空转）"
  # ★ 工单 30：四格（w64/w64-base）也要进闸门 —— 一档"三处之一少了/旧了"必须红
  #   ⚠️ 先把前面用例删掉的 VERSION 复原：它三处都缺时是**红**（零值守卫）⇒ 不复原的话
  #      下面这两个 ok 用例会因为 VERSION 而红，看起来像"四格判据坏了"（自证自己先踩到）。
  for d in "$tmp/a" "$tmp/b" "$tmp/c"; do printf 'same-VERSION' > "$d/VERSION"; done
  printf 'lane-oct' > "$tmp/a/assets/oct-threads/a.oct"
  printf 'lane-oct' > "$tmp/b/assets/oct-threads/a.oct"
  printf 'lane-oct' > "$tmp/c/assets/oct-threads/a.oct"
  mkfix_w64() {
    mkdir -p "$1/w64" "$1/w64-base" "$1/assets/oct-w64"
    for f in octave.wasm octave.js octave.data octave.build.json minioct.oct dldprobe.oct; do
      printf 'same-w64-%s' "$f" > "$1/w64/$f"
      printf 'same-w64-%s' "$f" > "$1/w64-base/$f"
    done
    printf '[]' > "$1/assets/manifest.w64.json"
    printf 'lane-oct-64' > "$1/assets/oct-w64/a.oct"
  }
  mkfix_w64 "$tmp/a"; mkfix_w64 "$tmp/b"; mkfix_w64 "$tmp/c"
  probe ok "四格：三处齐全且一致 ⇒ 通过（w64 那两档也进了部署件清单）"
  rm -f "$tmp/c/w64/octave.data"
  probe red "★ 四格：C 处少了一份 w64/octave.data ⇒ 必须红（动态清单要抓的就是这个）"
  cp "$tmp/a/w64/octave.data" "$tmp/c/w64/octave.data"
  printf 'lane-oct-64-OLD' > "$tmp/b/assets/oct-w64/a.oct"
  probe red "★ 四格：w64 的 .oct 有一处是旧件 ⇒ 必须红（另一套 wasm64 side module）"
  cp "$tmp/a/assets/oct-w64/a.oct" "$tmp/b/assets/oct-w64/a.oct"
  probe ok "复原后 ⇒ 再次通过"
  rm -rf "$tmp"
  echo ""
  echo "=== check-site-parity 自证：$((ncases - fails)) PASS / $fails fail ==="
  exit $([ "$fails" = "0" ] && echo 0 || echo 1)
fi


# 部署件清单：三处必须逐字节相同的那批
DEPLOY="octave.wasm octave.js octave.data octave.build.json index.html assets-loader.js VERSION assets/manifest.json"
# ★ B6 双档：线程档与**选档胶水**也是部署件（同名文件、子目录区分；lane.js 决定选哪一档）
#   —— 不列进来就会"8761 还在跑上一版选档逻辑/上一版线程档"而闸门全绿。
#   `octave-core.js`/`octave-worker.js` 是内核与 worker 宿主（index.html 与 worker 都 src 它），
#   它们**必须**与站点同时更新（实测：promote 前 A/C 的这两份是"选档前"的老件）。
DEPLOY="$DEPLOY lane.js octave-core.js octave-worker.js"
DEPLOY="$DEPLOY threads/octave.wasm threads/octave.js threads/octave.data threads/octave.build.json"
DEPLOY="$DEPLOY assets/manifest.threads.json"
# ★ 工单 30（2026-10-01）：其余车道**动态**进清单 —— 三处**任一处**有这一档就都核。
#   为什么不写死：闸门要在"四格站"和"双档站"上都能用（8768 先落地那半天不能假红），
#   而"一处有一处没有"恰恰是本闸门最该抓的漂移。判据是**档目录在不在**，不是清单说什么。
for _L in w64 w64-base; do
  for _d in "$A" "$B" "$C"; do
    if [ -d "$_d/$_L" ]; then
      DEPLOY="$DEPLOY $_L/octave.wasm $_L/octave.js $_L/octave.data $_L/octave.build.json"
      # 两个 pthread 夹具（验收套件**按档取**它们；缺了全量回归会红）
      DEPLOY="$DEPLOY $_L/minioct.oct $_L/dldprobe.oct"
      # 清单只有 `manifest.w64.json` 这一份（w64 与 w64-base 共用），所以只认已存在的那份
      for _m in "assets/manifest.$_L.json"; do
        for _dd in "$A" "$B" "$C"; do [ -f "$_dd/$_m" ] && { DEPLOY="$DEPLOY $_m"; break; }; done
      done
      break
    fi
  done
done

# 车道 `.oct` 分档（44 个 `-pthread` 的 side module）：不进上面那张清单（它是**集合**不是单件），
# 单独用 (相对路径, sha256) 列表比对。判据可证伪：任一处的旧件/缺件都会让列表不同。
# 工单 30：档名当参数 —— 线程档与 wasm64 档是**两套**编译产物，各比各的。
lane_list() {  # $1=站点  $2…=档名（默认 threads）
  python3 - "$@" <<'PY'
import hashlib, os, sys
site = sys.argv[1]
lanes = sys.argv[2:] or ["threads"]
for lane in lanes:
    for sub in ("assets/oct-%s" % lane, "assets/octdir-%s" % lane):
        root = os.path.join(site, sub)
        if os.path.isdir(root):
            for r, _d, fs in os.walk(root):
                for f in sorted(fs):
                    if not f.endswith(".oct"):
                        continue
                    p = os.path.join(r, f)
                    h = hashlib.sha256()
                    with open(p, "rb") as fh:
                        for c in iter(lambda: fh.read(1 << 20), b""):
                            h.update(c)
                    print("%s %s" % (os.path.relpath(p, site), h.hexdigest()))
PY
}

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
  if [ "$a" = "(缺)" ] && [ "$b" = "(缺)" ] && [ "$c" = "(缺)" ]; then
    # ★ 零值守卫（F1）：三处都缺**不是"一致"** —— 实测过：把 VERSION 从三处同时删掉，
    #   旧版会报"三处完全一致"。缺文件是"这份产物不完整"，必须红。
    printf '  %-20s 三处都缺该文件 ← **不算一致**（闸门空转）\n' "$f"
    diffcount=$((diffcount + 1))
  elif [ "$a" = "$b" ] && [ "$b" = "$c" ]; then
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
  if [ "$a" = "(缺)" ] && [ "$b" = "(缺)" ] && [ "$c" = "(缺)" ]; then
    printf '  %-20s 三处都缺该资产 ← **不算一致**\n' "$n"
    diffcount=$((diffcount + 1))
  elif [ "$a" = "$b" ] && [ "$b" = "$c" ]; then
    printf '  %-20s %s  三处一致\n' "$n" "$a"
  else
    printf '  %-20s A=%s  B=%s  C=%s  ← **不一致**\n' "$n" "$a" "$b" "$c"
    diffcount=$((diffcount + 1))
  fi
done

say "【车道 .oct 分档】"
# 分档检查按**档**做：线程档一定有（红线）；wasm64 档三处任一有才做
# （工单 30 —— 不做的话"8761 有 w64/ 而 w64 的 .oct 是旧件"这条**没人拦**）。
for _LANE in threads w64; do
  _has=0
  for _d in "$A" "$B" "$C"; do [ -d "$_d/$_LANE" ] && _has=1; done
  if [ "$_LANE" = w64 ] && [ "$_has" = 0 ]; then continue; fi
  say "  · 档 $_LANE"
  _lza="$(mktemp)"; _lzb="$(mktemp)"; _lzc="$(mktemp)"
  lane_list "$A" "$_LANE" >"$_lza"; lane_list "$B" "$_LANE" >"$_lzb"; lane_list "$C" "$_LANE" >"$_lzc"
  na=$(grep -c . "$_lza" || true); nb=$(grep -c . "$_lzb" || true); nc=$(grep -c . "$_lzc" || true)
  if [ "${na:-0}" = "0" ] && [ "${nb:-0}" = "0" ] && [ "${nc:-0}" = "0" ]; then
    # 零值守卫：三处都没有 ⇒ 不许报"一致"（分档检查空转 —— 正是 F1 要消灭的形状）
    say "    A/8761=0  B/8768=0  C/仓库=0  ← **三处都没有该档 .oct**，不算一致（闸门空转）"
    diffcount=$((diffcount + 1))
  else
    if cmp -s "$_lza" "$_lzb" && cmp -s "$_lzb" "$_lzc"; then
      printf '    %s 个文件（oct-%s+octdir-%s）  %s  三处逐字节一致\n' \
        "$nb" "$_LANE" "$_LANE" "$(sha256sum "$_lzb" | cut -c1-16)"
    else
      printf '    A=%s  B=%s  C=%s 个文件 ← **不一致**，差异前 5 行：\n' "$na" "$nb" "$nc"
      diff "$_lza" "$_lzb" 2>/dev/null | head -5 | sed 's/^/     A|B /'
      diff "$_lzb" "$_lzc" 2>/dev/null | head -5 | sed 's/^/     B|C /'
      diffcount=$((diffcount + 1))
    fi
  fi
  rm -f "$_lza" "$_lzb" "$_lzc"
done
echo ""
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
