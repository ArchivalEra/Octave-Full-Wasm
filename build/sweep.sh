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
#     SWEEP_JOBS=1 sh build/sweep.sh                       # 强制串行（默认 4）
# 日志：$LOGDIR/<套件>.log（默认 /mnt/hdd/octave-wasm-build/sweep-logs/<时间戳>）
# 退出码：0 = 全绿；1 = 有失败/超时；2 = 参数/清单/过滤器有问题
#
# ★ 并行化（2026-10-05）：**只有 `accept-*` 并行**（默认 4 路，`SWEEP_JOBS` 调），
#   `probe-*` / `bench-*` **永远串行** —— bench 类要计时隔离（本机单轮方差 ±30%），
#   probe 里有的**自起固定端口**的服务（并行会撞端口）。accept-* 是"连给定 URL 跑断言"、
#   不自起服务，彼此独立、可并发（每套一次冷启动 ~10s，占全量的八成墙钟 ⇒ 并行收益大）。
#   ⚠️ 前提 = `test/browser/run.sh` 的临时副本走**每次调用唯一**文件名（同日修）——
#      旧固定 `_run.mjs` 会让并发套件互覆（HISTORY §5.14 的假失败真身）。
set -u

URL="${1:-http://127.0.0.1:8761/}"
FILTER="${2:-}"
HARNESS_DIR="${HARNESS:-/mnt/hdd/octave-wasm-build/harness}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
MAN="$REPO/test/browser/manifest.json"
LOGDIR="${LOGDIR:-/mnt/hdd/octave-wasm-build/sweep-logs/$(date +%Y%m%d-%H%M%S)}"
PROBES="${PROBES:-0}"
JOBS="${SWEEP_JOBS:-4}"
case "$JOBS" in ''|*[!0-9]*) JOBS=1 ;; esac
[ "$JOBS" -ge 1 ] 2>/dev/null || JOBS=1

[ -f "$MAN" ] || { echo "FATAL: 缺测试清单 $MAN" >&2; exit 2; }
[ -d "$HARNESS_DIR/node_modules" ] || {
  echo "FATAL: harness 缺 node_modules（$HARNESS_DIR）—— playwright-core 装在那里" >&2; exit 2; }
mkdir -p "$LOGDIR"

# ── 选哪些套件：交给清单（逻辑在 build/lib/sweep_select.py —— F4 从 heredoc 搬出来的）──
SEL="$LOGDIR/.selected.tsv"
python3 "$REPO/build/lib/sweep_select.py" "$MAN" "$REPO" "$FILTER" "$PROBES" "$LOGDIR" >"$SEL" || {
  echo "FATAL: 选片失败（清单/参数问题，见上）" >&2; exit 2; }

NSEL="$(grep -c . "$SEL" || true)"
NMATCH="$(cat "$LOGDIR/.matched.txt" 2>/dev/null || echo "$NSEL")"
if [ "$NMATCH" = "0" ]; then
  echo "FATAL: 过滤器 '${FILTER:-（清单默认）}' 没有匹配到任何套件（PROBES=$PROBES）" >&2
  echo "       套件名看 test/browser/；类别/超时看 test/browser/manifest.json" >&2
  exit 2
fi
if [ "$NSEL" = "0" ]; then
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
echo "并行   = $JOBS（仅 accept-*；probe/bench 串行）"
echo "================================================================"

TAB="$(printf '\t')"
awk -F'\t' 'NF && $1 ~ /^accept-/'  "$SEL" > "$LOGDIR/.sel-par.tsv"
awk -F'\t' 'NF && $1 !~ /^accept-/' "$SEL" > "$LOGDIR/.sel-ser.tsv"

# ── 单套件执行体（并行/串行共用）：写 $LOGDIR/<name>.log + .disp（显示行）+ .res（p q bad）──
run_one() {
  _name="$1"; _tmo="$2"; _needs="$3"
  _log="$LOGDIR/$_name.log"
  _start=$(date +%s)
  _inputs="$(python3 "$REPO/build/lib/sweep_select.py" --inputs-for "$MAN" "$_name" 2>>"$LOGDIR/.inputs-error.txt" || true)"
  # shellcheck disable=SC2086
  env $_inputs sh "$REPO/test/browser/run.sh" "$REPO/test/browser/$_name.mjs" "$URL" >"$_log" 2>&1 &
  _runner=$!
  ( sleep "$_tmo"; kill -TERM "$_runner" 2>/dev/null; sleep 5; kill -KILL "$_runner" 2>/dev/null ) &
  _wd=$!
  wait "$_runner"; _rc=$?
  kill -TERM "$_wd" 2>/dev/null; wait "$_wd" 2>/dev/null
  [ "$_rc" = "143" ] && _rc=124
  _retried=""
  if grep -q 'Target crashed' "$_log"; then
    _retried=" [重跑]"
    mv "$_log" "$_log.crashed1"
    # shellcheck disable=SC2086
    env $_inputs sh "$REPO/test/browser/run.sh" "$REPO/test/browser/$_name.mjs" "$URL" >"$_log" 2>&1 &
    _runner=$!
    ( sleep "$_tmo"; kill -TERM "$_runner" 2>/dev/null; sleep 5; kill -KILL "$_runner" 2>/dev/null ) &
    _wd=$!
    wait "$_runner"; _rc=$?
    kill -TERM "$_wd" 2>/dev/null; wait "$_wd" 2>/dev/null
    [ "$_rc" = "143" ] && _rc=124
  fi
  _dur=$(( $(date +%s) - _start ))
  _line=$(grep -E '=== *[0-9]+ PASS / [0-9]+ FAIL *===' "$_log" | tail -1)
  _p=$(echo "$_line" | sed -n 's/.*=== *\([0-9]*\) PASS.*/\1/p')
  _q=$(echo "$_line" | sed -n 's/.* \([0-9]*\) FAIL.*/\1/p')
  if [ -z "$_p" ]; then
    _line=$(grep -E '===.*个模块：OK' "$_log" | tail -1)
    _p=$(echo "$_line" | sed -n 's/.*OK \([0-9]*\).*/\1/p')
    _q=$(echo "$_line" | sed -n 's/.*TRAP \([0-9]*\).*/\1/p')
  fi
  if [ -z "$_p" ]; then
    if [ "$_needs" = "0" ]; then
      _tail1=$(tail -1 "$_log" | cut -c1-60)
      if [ "$_rc" = "0" ]; then
        printf '%-26s （按清单无汇总行；rc=0） (%ss)%s  %s\n' "$_name" "$_dur" "$_retried" "$_tail1" >"$LOGDIR/$_name.disp"
        printf '0 0 0 0\n' >"$LOGDIR/$_name.res"
      else
        printf '%-26s rc=%s ← 见 %s\n' "$_name" "$_rc" "$_log" >"$LOGDIR/$_name.disp"
        printf '0 0 0 1\n' >"$LOGDIR/$_name.res"
      fi
      return 0
    fi
    if [ "$_rc" = "124" ]; then printf '%-26s TIMEOUT(%ss)\n' "$_name" "$_dur" >"$LOGDIR/$_name.disp"
    else printf '%-26s NO-SUMMARY (rc=%s, %ss)\n' "$_name" "$_rc" "$_dur" >"$LOGDIR/$_name.disp"; fi
    printf '0 0 0 1\n' >"$LOGDIR/$_name.res"
    return 0
  fi
  _bad=0
  if [ "$_q" = "0" ] && [ "$_rc" = "0" ]; then
    printf '%-26s %3s PASS / %s FAIL   (%ss)%s\n' "$_name" "$_p" "$_q" "$_dur" "$_retried" >"$LOGDIR/$_name.disp"
  else
    printf '%-26s %3s PASS / %s FAIL   (%ss)  ← 见 %s\n' "$_name" "$_p" "$_q" "$_dur" "$_log" >"$LOGDIR/$_name.disp"
    _bad=1
  fi
  printf '1 %s %s %s\n' "$_p" "$_q" "$_bad" >"$LOGDIR/$_name.res"
}

# 每套跑完就把它那行打印出来（流式）——别等全跑完才bulk出（长跑要进度反馈）。
show() { [ -f "$LOGDIR/$1.disp" ] && cat "$LOGDIR/$1.disp"; }

# ── ① 并行跑 accept-*（分批；批内 wait，批完即打印该批）──
if [ "$JOBS" -gt 1 ] && [ -s "$LOGDIR/.sel-par.tsv" ]; then
  _c=0; _batch=""
  while IFS="$TAB" read -r name tmo needs; do
    [ -n "$name" ] || continue
    run_one "$name" "$tmo" "$needs" &
    _batch="$_batch $name"
    _c=$((_c + 1))
    if [ $((_c % JOBS)) -eq 0 ]; then
      wait
      for _n in $_batch; do show "$_n"; done
      _batch=""
    fi
  done < "$LOGDIR/.sel-par.tsv"
  wait
  for _n in $_batch; do show "$_n"; done
else
  while IFS="$TAB" read -r name tmo needs; do
    [ -n "$name" ] || continue
    run_one "$name" "$tmo" "$needs"
    show "$name"
  done < "$LOGDIR/.sel-par.tsv"
fi

# ── ② 串行跑 probe-/bench-（计时隔离 + 固定端口）──
while IFS="$TAB" read -r name tmo needs; do
  [ -n "$name" ] || continue
  run_one "$name" "$tmo" "$needs"
  show "$name"
done < "$LOGDIR/.sel-ser.tsv"

# ── ③ 汇总：只累加 .res（逐套行已在跑的时候流式打印过）──
total_pass=0; total_fail=0; nrun=0; nbad=0; badlist=""
while IFS="$TAB" read -r name tmo needs; do
  [ -n "$name" ] || continue
  nrun=$((nrun + 1))
  if [ -f "$LOGDIR/$name.res" ]; then
    read -r _has _p _q _bad < "$LOGDIR/$name.res"
    total_pass=$((total_pass + ${_p:-0}))
    total_fail=$((total_fail + ${_q:-0}))
    if [ "${_bad:-0}" = "1" ]; then nbad=$((nbad + 1)); badlist="$badlist $name"; fi
  else
    # 没留 .res ⇒ run_one 没跑完（被 kill/异常）⇒ 必须**计为问题**，不许静默漏
    nbad=$((nbad + 1)); badlist="$badlist ${name}(无结果)"
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
