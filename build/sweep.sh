#!/bin/sh
# Octave-Full-Wasm — 全量验收扫描（A3 起**进仓库**，并改成**读 test/browser/manifest.json**）
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么搬到仓库里（`build/113/PLAN-arch.md` §1.5）：筛选逻辑（"默认只跑 accept-*、
# PROBES=1 时用 `*` 扫全部"）以前只存在于仓库外的 `/mnt/hdd/octave-wasm-build/sweep.sh`
# ⇒ **测试契约的一半在仓库外**，别人 clone 下来不知道该怎么跑、哪些套件算"日常"。
# 现在：类别 / 超时 / 要不要汇总行 / 哪些是人工套件，都写在进 git 的
# `test/browser/manifest.json` 里。
#
# 用法：
#   sh build/sweep.sh [URL] [套件名过滤器]
#     sh build/sweep.sh                                    # 默认 http://127.0.0.1:8761/，跑 accept-*
#     sh build/sweep.sh http://127.0.0.1:8768/             # 另一入口
#     PROBES=1 sh build/sweep.sh http://127.0.0.1:8761/    # 再把 probe-* 与 bench-* 跑一遍
#     sh build/sweep.sh http://127.0.0.1:8761/ 'accept-t*' # 只跑匹配 glob 的套件
# 日志：$LOGDIR/<套件>.log（默认 /mnt/hdd/octave-wasm-build/sweep-logs/<时间戳>）
# 退出码：0 = 全绿；1 = 有失败/超时；2 = 参数/清单/过滤器有问题
#
# ⚠️ 本脚本运行期间**不要**手动跑 `test/browser/run.sh` —— 它们共享 harness 里的 `_run.mjs`。
set -u

URL="${1:-http://127.0.0.1:8761/}"
FILTER="${2:-}"
HARNESS_DIR="${HARNESS:-/mnt/hdd/octave-wasm-build/harness}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
MAN="$REPO/test/browser/manifest.json"
LOGDIR="${LOGDIR:-/mnt/hdd/octave-wasm-build/sweep-logs/$(date +%Y%m%d-%H%M%S)}"
PROBES="${PROBES:-0}"

[ -f "$MAN" ] || { echo "FATAL: 缺测试清单 $MAN" >&2; exit 2; }
[ -d "$HARNESS_DIR/node_modules" ] || {
  echo "FATAL: harness 缺 node_modules（$HARNESS_DIR）—— playwright-core 装在那里" >&2; exit 2; }
mkdir -p "$LOGDIR"

# ── 选哪些套件：交给清单（用 python 读 JSON；shell 读 JSON 太容易写错）──────────────
# 落成一个临时文件，**主壳**再逐行读 —— 别用 `python | while`（那是子壳，计数器传不出来）。
SEL="$LOGDIR/.selected.tsv"
python3 - "$MAN" "$REPO" "$FILTER" "$PROBES" "$LOGDIR" >"$SEL" <<'PY'
import glob, json, os, sys
man_path, repo, flt, probes = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] == "1"
logdir = sys.argv[5]
man = json.load(open(man_path, encoding="utf-8"))
cats, exc = man["categories"], man.get("exceptions", {})
CAT = {"accept": "accept", "probe": "probe", "bench": "bench"}
names = sorted(os.path.basename(p)[:-4] for p in glob.glob(os.path.join(repo, "test/browser/*.mjs")))
skipped, rows = [], []
for name in names:
    cat = CAT.get(name.split("-", 1)[0])          # 类别**从前缀推**，清单只列例外
    if cat is None:
        continue
    c, e = cats[cat], exc.get(name, {})
    if flt:
        if not glob.fnmatch.fnmatch(name, flt):
            continue
    elif not (probes or c.get("default")):
        continue
    if e.get("manual"):
        skipped.append("%s（%s）" % (name, e.get("why", "人工套件")))
        continue
    if e.get("requires_env") and not os.environ.get(e["requires_env"]):
        skipped.append("%s（缺环境变量 %s）：%s" % (name, e["requires_env"], e.get("why", "")))
        continue
    rows.append((name, c.get("timeout", 420), 1 if c.get("summary", True) else 0))
for n, t, s in rows:
    print("%s\t%s\t%s" % (n, t, s))
with open(os.path.join(logdir, ".skipped.txt"), "w") as fh:
    fh.write("; ".join(skipped))
with open(os.path.join(logdir, ".matched.txt"), "w") as fh:
    fh.write(str(len(rows) + len(skipped)))
PY

NSEL="$(grep -c . "$SEL" || true)"
NMATCH="$(cat "$LOGDIR/.matched.txt" 2>/dev/null || echo "$NSEL")"
if [ "$NMATCH" = "0" ]; then
  echo "FATAL: 过滤器 '${FILTER:-（清单默认）}' 没有匹配到任何套件（PROBES=$PROBES）" >&2
  echo "       套件名看 test/browser/；类别/超时看 test/browser/manifest.json" >&2
  exit 2
fi
if [ "$NSEL" = "0" ]; then
  # ★ 反向断言（A3）：匹配到的**都是清单里的人工套件** ⇒ 必须**明确跳过并计数**，
  #   不许静默漏跑（"跑 0 个然后绿"是最难发现的那种退化）。
  echo "匹配到 $NMATCH 套，但**按清单全是人工套件**，本次跳过："
  cat "$LOGDIR/.skipped.txt"; echo
  echo "（人工套件的判据：不产汇总行，或依赖特定环境；详见 test/browser/manifest.json）"
  exit 0
fi

echo "URL    = $URL"
echo "过滤   = ${FILTER:-（按清单默认）}   PROBES=$PROBES"
echo "日志   = $LOGDIR"
echo "清单   = $MAN"
echo "选中   = $NSEL 套"
echo "================================================================"

total_pass=0; total_fail=0; nrun=0; nbad=0; badlist=""

while IFS='	' read -r name tmo needs; do
  [ -n "$name" ] || continue
  nrun=$((nrun + 1))
  log="$LOGDIR/$name.log"
  start=$(date +%s)
  sh "$REPO/test/browser/run.sh" "$REPO/test/browser/$name.mjs" "$URL" >"$log" 2>&1 &
  runner=$!
  # 超时用**外挂看门狗**（不用 `timeout` 包住整个 sh：POSIX `timeout` 在某些镜像里没有）
  ( sleep "$tmo"; kill -TERM "$runner" 2>/dev/null; sleep 5; kill -KILL "$runner" 2>/dev/null ) &
  watchdog=$!
  wait "$runner"; rc=$?
  kill -TERM "$watchdog" 2>/dev/null; wait "$watchdog" 2>/dev/null
  [ "$rc" = "143" ] && rc=124                     # 被 TERM ⇒ 记成超时

  # 页面偶发崩自动重跑一次（判据是日志里的 `Target crashed`）：本仓真踩过
  # （accept-forge 假失败一次，重跑 22/0）—— **别把偶发记成回归**。
  retried=""
  if grep -q 'Target crashed' "$log"; then
    retried=" [重跑]"
    echo "  ↻ $name 出现 Target crashed（页面偶发崩）⇒ 重跑一次"
    mv "$log" "$log.crashed1"
    sh "$REPO/test/browser/run.sh" "$REPO/test/browser/$name.mjs" "$URL" >"$log" 2>&1 &
    runner=$!
    ( sleep "$tmo"; kill -TERM "$runner" 2>/dev/null; sleep 5; kill -KILL "$runner" 2>/dev/null ) &
    watchdog=$!
    wait "$runner"; rc=$?
    kill -TERM "$watchdog" 2>/dev/null; wait "$watchdog" 2>/dev/null
    [ "$rc" = "143" ] && rc=124
  fi
  dur=$(( $(date +%s) - start ))

  # 标准格式： === N PASS / M FAIL ===   （取最后一条）
  line=$(grep -E '=== *[0-9]+ PASS / [0-9]+ FAIL *===' "$log" | tail -1)
  p=$(echo "$line" | sed -n 's/.*=== *\([0-9]*\) PASS.*/\1/p')
  q=$(echo "$line" | sed -n 's/.* \([0-9]*\) FAIL.*/\1/p')
  if [ -z "$p" ]; then                          # 个别套件自带汇总（pkgoct）
    line=$(grep -E '===.*个模块：OK' "$log" | tail -1)
    p=$(echo "$line" | sed -n 's/.*OK \([0-9]*\).*/\1/p')
    q=$(echo "$line" | sed -n 's/.*TRAP \([0-9]*\).*/\1/p')
  fi

  if [ -z "$p" ]; then
    if [ "$needs" = "0" ]; then
      # 清单说它**不产汇总行**（基准类）⇒ 只判 rc，并把最后一行贴出来给人看
      tail1=$(tail -1 "$log" | cut -c1-60)
      if [ "$rc" = "0" ]; then
        printf '%-26s （按清单无汇总行；rc=0） (%ss)%s  %s\n' "$name" "$dur" "$retried" "$tail1"
      else
        printf '%-26s rc=%s ← 见 %s\n' "$name" "$rc" "$log"
        nbad=$((nbad + 1)); badlist="$badlist $name"
      fi
      continue
    fi
    if [ "$rc" = "124" ]; then printf '%-26s TIMEOUT(%ss)\n' "$name" "$dur"
    else printf '%-26s NO-SUMMARY (rc=%s, %ss)\n' "$name" "$rc" "$dur"; fi
    nbad=$((nbad + 1)); badlist="$badlist $name"
    continue
  fi

  total_pass=$((total_pass + p)); total_fail=$((total_fail + q))
  if [ "$q" = "0" ] && [ "$rc" = "0" ]; then
    printf '%-26s %3s PASS / %s FAIL   (%ss)%s\n' "$name" "$p" "$q" "$dur" "$retried"
  else
    printf '%-26s %3s PASS / %s FAIL   (%ss)  ← 见 %s\n' "$name" "$p" "$q" "$dur" "$log"
    nbad=$((nbad + 1)); badlist="$badlist $name"
  fi
done < "$SEL"

SKIPPED="$(cat "$LOGDIR/.skipped.txt" 2>/dev/null || true)"
[ -n "$SKIPPED" ] && echo "按清单跳过的人工套件：$SKIPPED"

echo "================================================================"
echo "合计：$nrun 套 / $total_pass PASS / $total_fail FAIL"
if [ -n "$badlist" ]; then
  echo "有问题的套件：$badlist"
  exit 1
fi
echo "全绿"
exit 0
