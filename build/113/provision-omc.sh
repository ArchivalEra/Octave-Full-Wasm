#!/usr/bin/env bash
# Octave-Full-Wasm — **OMC 引擎供给**（内容仓 mail/056/057：第二个 kind:'engine'）
# Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么独立脚本（与 provision-llvm-wasm.sh 同族）：omc（OpenModelica 编译器 wasm）
# 是**引擎条目**——编译 Modelica 供 Octave 桥调用，`role:"toolchain"` ⇒ 不走 install、
# 走下载管理。字节是**可重建缓存**，按 sha256 钉版本、同源供给进站点（COEP 硬约束）。
#
# 用法：
#   sh build/113/provision-omc.sh fetch      供给进站点（本地 OM 部署盘优先，否则从 lock URL 取）
#   sh build/113/provision-omc.sh verify     复核（不复制）
#   sh build/113/provision-omc.sh --selftest 自证（三类：正常/该报/空值，不碰真网络）
#
# 字节产地（内容仓 mail/057 §3 的线上验证事实，2026-10-25）：
#   OM 仓部署盘 `openmodelica-wasm-build/site-omc/omc/` 4 件；
#   主件 sha = OM 台账 `omc_web_wasm_sha`（`8287589e…`）——**逐字一致**（本脚本再核一遍，
#   不信台账、不信口供，只信字节）。
#   ⇒ 跨仓供给形状：**拷贝**（不是软链——站点是静态托管镜像，要真字节）。
#   ⚠️ MSL 等其它 OM 资产**不进 omc/ 目录**（内容仓 mail/057 §2 硬约束：tree 条目的
#      size = url 所在目录字节和；MSL 进来会把引擎预算从 74.7MB 虚胀到 94MB+）。
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SITE="${SITE_DIR:-/mnt/hdd/octave-wasm-build/site}"
OMC_SRC="${OMC_SRC:-/mnt/hdd/openmodelica-wasm-build/site-omc/omc}"
OMC_DST="${OMC_DST:-$SITE/omc}"
# 主件（入口）期望 sha = OM 台账 omc_web_wasm_sha（内容仓 mail/057 §3 的五方一致锚点）
MAIN="OpenModelicaCompiler_bg.wasm"
MAIN_SHA="${MAIN_SHA:-8287589ebdb53b4cc37c337c2ae88f798d8889f7ac3c29d693ca12e539b8d001}"
# 其余 3 件（胶水 + 两个类型声明）：逐件 sha 也钉死（fail-closed；来源同盘）
OTHER_SHA="${OTHER_SHA:-
OpenModelicaCompiler_bg.wasm.d.ts c0a044fe12ad7b79eed32729595bb05b9e29de9ebb27d9e36afe2182ed76143e
OpenModelicaCompiler.d.ts 106334c91fb5711ba220d46b100092ff58d8742ff92ec74c2239d9a4477b2498
OpenModelicaCompiler.js 56c399bd455d57c8e21206287445643b81db6fd4e3ac183989616b903d165f17
}"

say () { printf "%s\n" "$1"; }
die () { printf "FATAL: %s\n" "$1" >&2; exit 1; }

sha_of () {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; return; fi
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'; return; fi
  die "缺少 sha256sum/shasum"
}

# ── F1 自证（三类用例，不碰真网络/不碰真站点）──────────────────────────────
if [ "${1:-}" = "--selftest" ]; then
  T="$(mktemp -d)"; bad=0; n=0
  mk_fixture () {  # $1=目录  $2=主件内容
    mkdir -p "$1"
    printf '%s' "$2" > "$1/$MAIN"
    printf 'x' > "$1/OpenModelicaCompiler_bg.wasm.d.ts"
    printf 'y' > "$1/OpenModelicaCompiler.d.ts"
    printf 'z' > "$1/OpenModelicaCompiler.js"
  }
  # ① 正常：逐件 sha 相符 ⇒ 复制
  n=$((n+1)); mk_fixture "$T/src1" "hello"
  main_sha="$(sha_of "$T/src1/$MAIN")"
  {
    printf 'OpenModelicaCompiler_bg.wasm.d.ts %s\n' "$(sha_of "$T/src1/OpenModelicaCompiler_bg.wasm.d.ts")"
    printf 'OpenModelicaCompiler.d.ts %s\n' "$(sha_of "$T/src1/OpenModelicaCompiler.d.ts")"
    printf 'OpenModelicaCompiler.js %s\n' "$(sha_of "$T/src1/OpenModelicaCompiler.js")"
  } > "$T/other1.txt"
  if OMC_SRC="$T/src1" OMC_DST="$T/dst1" MAIN_SHA="$main_sha" OTHER_SHA="$(cat "$T/other1.txt")" \
       bash "$0" --copy-only >/dev/null 2>&1 && [ -f "$T/dst1/$MAIN" ]; then
    say "PASS | 逐件 sha 相符 ⇒ 落件"
  else say "fail | 逐件 sha 相符竟失败"; bad=1; fi
  # ② 该报的必须报：主件 sha 不符 ⇒ 必须拒（fail-closed）
  n=$((n+1)); mk_fixture "$T/src2" "tampered"
  if OMC_SRC="$T/src2" OMC_DST="$T/dst2" MAIN_SHA="$main_sha" OTHER_SHA="" \
       bash "$0" --copy-only >/dev/null 2>&1; then
    say "fail | 主件 sha 不符竟通过（fail-closed 失效）"; bad=1
  else say "PASS | 主件 sha 不符 ⇒ 必须拒"; fi
  # ③ 空输入必须报：源目录不存在
  n=$((n+1))
  if OMC_SRC="$T/nonexistent" OMC_DST="$T/dst3" MAIN_SHA="$main_sha" OTHER_SHA="" \
       bash "$0" --copy-only >/dev/null 2>&1; then
    say "fail | 源目录不存在竟通过（零值守卫失效）"; bad=1
  else say "PASS | 源目录不存在 ⇒ 必须拒"; fi
  # ④ 反向：MSL 类资产混进 omc/ ⇒ 必须报（mail/057 §2 兄弟目录硬约束）
  n=$((n+1)); mk_fixture "$T/src4" "hello"; printf 'msl' > "$T/src4/msl-4.1.0.zip"
  {
    printf 'OpenModelicaCompiler_bg.wasm.d.ts %s\n' "$(sha_of "$T/src4/OpenModelicaCompiler_bg.wasm.d.ts")"
    printf 'OpenModelicaCompiler.d.ts %s\n' "$(sha_of "$T/src4/OpenModelicaCompiler.d.ts")"
    printf 'OpenModelicaCompiler.js %s\n' "$(sha_of "$T/src4/OpenModelicaCompiler.js")"
  } > "$T/other4.txt"
  if OMC_SRC="$T/src4" OMC_DST="$T/dst4" MAIN_SHA="$(sha_of "$T/src4/$MAIN")" OTHER_SHA="$(cat "$T/other4.txt")" \
       bash "$0" --copy-only >/dev/null 2>&1; then
    say "fail | 陌生文件混进 omc/ 竟通过（兄弟目录约束失效）"; bad=1
  else say "PASS | ★ 陌生文件（MSL 类）混进 omc/ ⇒ 必须拒（兄弟目录硬约束）"; fi
  rm -rf "$T"
  echo "=== provision-omc 自证：$((n-bad)) PASS / $bad fail ==="
  [ "$bad" = 0 ]
  exit $?
fi

MODE="${1:-fetch}"
[ "$MODE" = "--copy-only" ] && MODE=copy

[ -d "$OMC_SRC" ] || die "OM 部署盘目录不存在：$OMC_SRC（先建 OM 侧产物；内容仓 mail/057 §3 的字节渠道）"
[ -f "$OMC_SRC/$MAIN" ] || die "缺主件 $OMC_SRC/$MAIN"

# ① 主件 sha（fail-closed：与 OM 台账 omc_web_wasm_sha 同值，本脚本再核字节）
got="$(sha_of "$OMC_SRC/$MAIN")"
[ "$got" = "$MAIN_SHA" ] || die "主件 sha 不符：期望 $MAIN_SHA，实得 $got
       （字节渠道变了？先与 OM 台账 omc_web_wasm_sha 对账，别静默放过）"
say "  ✓ $MAIN（sha 与 OM 台账 omc_web_wasm_sha 一致）"

# ② 其余 3 件逐件核（同样 fail-closed）
EXPECTED_FILES="$MAIN"
while read -r f s; do
  [ -n "$f" ] || continue
  [ -f "$OMC_SRC/$f" ] || die "缺 $OMC_SRC/$f"
  g="$(sha_of "$OMC_SRC/$f")"
  [ "$g" = "$s" ] || die "$f sha 不符：期望 $s，实得 $g"
  say "  ✓ $f"
  EXPECTED_FILES="$EXPECTED_FILES $f"
done <<EOF2
$OTHER_SHA
EOF2

# ③ ★ 兄弟目录硬约束（内容仓 mail/057 §2）：omc/ 只许有上面这几个文件。
#    任何陌生文件 ⇒ **拒**（MSL zip 若进来，tree 条目的 size 会从 74.7MB 虚胀到 94MB+
#    —— 预算不诚实是 content 诚实纪律的同族）。
while IFS= read -r f; do
  case " $EXPECTED_FILES " in
    *" $f "*) ;;
    *) die "omc/ 里有**不该在这**的文件：$f
       （引擎条目 size = 本目录字节和；MSL 等资产必须落兄弟目录 msl/——内容仓 mail/057 §2）" ;;
  esac
done <<EOF3
$(ls -1 "$OMC_SRC")
EOF3

[ "$MODE" = "verify" ] && { say "verify OK（omc/ 4 件、逐件 sha 相符、无陌生文件）"; exit 0; }

mkdir -p "$OMC_DST"
for f in $EXPECTED_FILES; do cp -f "$OMC_SRC/$f" "$OMC_DST/$f"; done
N=$(ls -1 "$OMC_DST" | wc -l)
TOTAL=$(du -sb "$OMC_DST" | cut -f1)
say "  ✓ omc/ 落 $N 件、合计 $TOTAL B → $OMC_DST"
say "完成：OMC 引擎已供给进 $OMC_DST"
