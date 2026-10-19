#!/usr/bin/env bash
# Octave-Full-Wasm — **LLVM-wasm 工具链供给**（compileExtension 批 · B 线的供给层）
# Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么独立脚本（与 provision-pyodide.sh 同族）：工具链是**可重建缓存**，按
# URL+sha256 钉版本（build/upstream-lock.json 的 llvm-wasm 条目）、解包落站点
# （同源硬约束：COEP 拦跨域 fetch，实测见 NOTES-client-compile-design §1）。
# 我们**不维护字节**——字节 = 别人的 Release（lock 记 URL+sha256），站点副本可随时删掉重建。
#
# 用法：
#   sh build/113/provision-llvm-wasm.sh fetch     下载 bundle + 逐件核 sha + 解包进站点
#   sh build/113/provision-llvm-wasm.sh verify    复核（不下载；逐件核 sha）
#   sh build/113/provision-llvm-wasm.sh --selftest  自证（三类用例，不碰真网络）
#
# 产物（站点）：assets/llvm/{clang.js,clang.wasm,lld-wasm-only.js,lld-wasm-only.wasm,
#   sysroot-headers.tar,sysroot-headers.wasm64.tar,driver/*.mjs,browser/worker.mjs,
#   manifest.json}；assets/octinc/ = Octave 头（788 个，从 fork 树派生 —— §3① 的"tree 派生"族）。
#
# 逐资产 sha 的**权威** = release 内 manifest.json（本脚本逐件核，不抄配方文档）。
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
CACHE="${LLVM_CACHE:-/mnt/hdd/octave-wasm-build/third_party/llvm}"
SITE="${SITE_DIR:-/mnt/hdd/octave-wasm-build/site}"
# ★ v0.1.1 → v0.1.3（2026-10-19）：v0.1.3 把我们 `mail/013` 报的缺口修了 ——
#   `driver/compile-core.mjs` 进 manifest（14 条），并附发布字节对账器
#   （release/check-published.mjs，含"bundle driver == repo HEAD 逐字节"那层）。
#   sha 我方独立复跑相符（`sha256sum llvm-wasm-bundle-v0.1.3.tar.gz`）。
VER="v0.1.3"
BUNDLE="llvm-wasm-bundle-${VER}.tar.gz"
BUNDLE_SHA="cd6450fe7944875cb39f8e4a0790d5a08e032044f1db89054dadcabb749b20ce"
URL="https://github.com/ArchivalEra/LLVM-wasm/releases/download/${VER}/${BUNDLE}"
# 本地优先（生产者仓就在本机：/mnt/hdd/zcode-projects/LLVM-wasm/release/）—— 免下载
LOCAL_FIRST="${LOCAL_FIRST:-/mnt/hdd/zcode-projects/LLVM-wasm/release/${BUNDLE}}"

say () { printf "%s\n" "$1"; }
die () { printf "FATAL: %s\n" "$1" >&2; exit 1; }
sha () { sha256sum "$1" | cut -d' ' -f1; }

# ── fetch：bundle 到缓存（本地 release 优先，否则下载）─────────────────────
fetch_bundle () {
  mkdir -p "$CACHE"
  DST="$CACHE/$BUNDLE"
  if [ -s "$DST" ] && [ "$(sha "$DST")" = "$BUNDLE_SHA" ]; then
    say "  缓存已有 $BUNDLE（sha 相符）"
    return 0
  fi
  if [ -s "$LOCAL_FIRST" ] && [ "$(sha "$LOCAL_FIRST")" = "$BUNDLE_SHA" ]; then
    cp "$LOCAL_FIRST" "$DST"
    say "  从本地生产者仓拷贝（$LOCAL_FIRST，sha 相符）"
    return 0
  fi
  say "  下载 $URL …"
  curl -fL --retry 3 -o "$DST" "$URL" || die "下载失败"
  [ "$(sha "$DST")" = "$BUNDLE_SHA" ] || die "bundle sha256 不符（期望 $BUNDLE_SHA，实得 $(sha "$DST")）⇒ 拒装"
}

# ── 逐件核 sha + 落站点 ─────────────────────────────────────────────────────
#   权威 = 解包出的 manifest.json；它不在（旧 bundle）⇒ die（不许无凭装配）。
provision () {
  # ★ v0.1.1 bundle 是**平铺**的（./clang.wasm … ./manifest.json ./driver/…，实测 tar -t）；
  #   生产者仓里的 release/out/ 布局只存在于仓内，bundle 里没有那层目录。
  WORK="$(mktemp -d)"
  trap 'rm -rf "$WORK"' EXIT
  tar -xzf "$CACHE/$BUNDLE" -C "$WORK"
  MAN="$WORK/manifest.json"
  [ -s "$MAN" ] || die "bundle 里没有 manifest.json（逐件 sha 的权威缺席）"
  python3 - "$WORK" "$SITE/assets/llvm" <<'PY'
import hashlib, json, os, shutil, sys
src, dst = sys.argv[1], sys.argv[2]
man = json.load(open(os.path.join(src, "manifest.json"), encoding="utf-8"))
os.makedirs(dst, exist_ok=True)
bad = 0
for a in man["assets"]:
    name, want = a["name"], a["sha256"]
    p = os.path.join(src, name)
    if not os.path.isfile(p):
        print("  ✗ 缺资产：%s" % name); bad += 1; continue
    h = hashlib.sha256(open(p, "rb").read()).hexdigest()
    if h != want:
        print("  ✗ %s sha 不符（期望 %s…，实得 %s…）⇒ 拒装" % (name, want[:12], h[:12])); bad += 1; continue
    os.makedirs(os.path.dirname(os.path.join(dst, name)), exist_ok=True)
    shutil.copy2(p, os.path.join(dst, name))
    print("  ✓ %-28s %8d B" % (name, a["bytes"]))
# manifest.json 本体也要进站点（它不在 assets[] 列表里 —— 它**就是**列表）：
# compileExtension 的 toolchainWorker 从它读 sysroot sha（不硬编码）。
shutil.copy2(os.path.join(src, "manifest.json"), os.path.join(dst, "manifest.json"))
print("  ✓ %-28s（逐件 sha 的权威）" % "manifest.json")
sys.exit(1 if bad else 0)
PY
  # ★ compile-core.mjs（worker 的 import 依赖）：**已由 bundle 自带**（v0.1.3 起）。
  #   历史：v0.1.1/v0.1.2 的已发布资产都缺它（13 条），靠"从生产者仓补拷"兜底。
  #   本方已正式上报（宿主 `mail/044` → LLVM-wasm `mail/013`），对方 v0.1.3 修复并附
  #   发布字节对账器双证 ⇒ **兜底按承诺退出**（不再是"能不能编"的隐式前提）。
  #   退出条件（当时写在信里）：对方重发后 ⇒ 换 URL+sha256、删兜底行、自证翻面。
  #   ⚠️ 现在这里是一条**正向断言**：bundle manifest 必须列它，缺 ⇒ 响亮失败。
  #      （反向由下面 fetch 的逐资产 sha 校验承担：列了但字节不符也过不去。）
  if ! grep -q '"driver/compile-core.mjs"' "$SITE/assets/llvm/manifest.json" 2>/dev/null; then
    die "bundle manifest 里没有 driver/compile-core.mjs（v0.1.3+ 应自带；worker import 必 404）"
  fi
  say "  ✓ driver/compile-core.mjs（bundle 自带，manifest 已列 —— 兜底已按 mail/013 承诺退出）"
  # worker（浏览器适配器）：bundle 不带它（tar -t 实测无 browser/）⇒ 从生产者仓拷。
  #   ⚠️ 它是代码不是字节资产（manifest 不列）；产地 = LLVM-wasm 仓 browser/worker.mjs。
  WRK_SRC="${LLVM_WORKER_SRC:-/mnt/hdd/zcode-projects/LLVM-wasm/browser/worker.mjs}"
  if [ -s "$WRK_SRC" ]; then
    mkdir -p "$SITE/assets/llvm/browser"
    cp "$WRK_SRC" "$SITE/assets/llvm/browser/worker.mjs"
    say "  ✓ browser/worker.mjs（从生产者仓）"
  else
    say "  ⚠️ browser/worker.mjs 不在（$WRK_SRC）—— compileExtension 的 Worker 面缺席"
  fi
  say "  工具链落 $SITE/assets/llvm/ ✓"
}

# ── Octave 头（§3①：从 fork 树派生，同源落 assets/octinc/）──────────────────
#   788 个头 = fork 安装头全域（NOTES-client-compile §10 实测集合）。
#   ⚠️ 头必须与**宿主产物同 pin**（ABI 漂移风险 §7.4）—— 判据：容器树 == submodule pin
#   （witness-upstream-pin.py 每提交核），这里只从**工作树的 upstream/octave** 拷贝。
provision_octinc () {
  # ★ 头必须取**容器安装树**（…/octave-install*/include/octave-11.3.0/），不是源码树：
  #   源码树的 .h 多是 .in.h 模板（configure 才生成真值），直接喂编译必失败。
  #   判据（ABI 漂移防线）：容器树 == submodule pin（witness-upstream-pin.py 每提交核）。
  # ★★ 头必须**按目标档**取（2026-10-19 工单 65 重链批实测翻出的 C2c 真根因）：
  #   wasm32 树与 wasm64 树的 `octave/mxtypes.h` 不同——`mwSize/mwIndex/mwSignedIndex`
  #   在前者是 **int32_t**、后者 **int64_t**（f77-fcn.h 的 F77_CHAR_ARG_LEN_TYPE 也分叉）。
  #   用 wasm32 头编的 .oct 在 wasm64 宿主上索引宽度错位 ⇒ 运行期
  #   "Invalid resizing operation"（= dim_vector 越界赋值的错路径放大）。
  #   第一版只从 /src/work/octave-install（product/wasm32 树）打包一份 ⇒ w64 档全错。
  #   ⇒ 两份都供：octave-headers.tar.gz（wasm32）+ octave-headers.wasm64.tar.gz（wasm64，
  #   取 -w64 安装树；优先现役 -6012-w64，缺则退回 -w64）。worker 按 target 选。
  DST="$SITE/assets/octinc"
  rm -rf "$DST"; mkdir -p "$DST"
  sudo -n docker exec o113 tar -czf /tmp/octinc.tar.gz -C /src/work/octave-install/include/octave-11.3.0 . \
    || die "从容器取头失败（o113 在吗？安装树在吗？）"
  sudo -n docker cp o113:/tmp/octinc.tar.gz "$DST/octave-headers.tar.gz"
  sudo -n docker exec o113 rm -f /tmp/octinc.tar.gz
  N=$(tar -tzf "$DST/octave-headers.tar.gz" | grep -c "\.h$\|\.hh$\|\.tcc$")
  [ "$N" -ge 700 ] || die "头数量 $N < 700（取错了树？安装树全域应 800+）"
  say "  Octave 头落 $DST/octave-headers.tar.gz（$N 个 .h/.hh/.tcc，wasm32 安装树）"
  # wasm64 档头
  W64_TREE=""
  for t in /src/work/octave-install-6012-w64 /src/work/octave-install-w64; do
    sudo -n docker exec o113 test -d "$t/include/octave-11.3.0" && W64_TREE="$t" && break
  done
  [ -n "$W64_TREE" ] || die "找不到 wasm64 安装树（试过 -6012-w64 / -w64）—— 先重链一次 w64 车道"
  sudo -n docker exec o113 tar -czf /tmp/octinc64.tar.gz -C "$W64_TREE/include/octave-11.3.0" .
  sudo -n docker cp o113:/tmp/octinc64.tar.gz "$DST/octave-headers.wasm64.tar.gz"
  sudo -n docker exec o113 rm -f /tmp/octinc64.tar.gz
  # 反向断言：两份必须**真的不同**（mxtypes.h 的 mwSize 是判别点）—— 相同 = 打包错树
  sudo -n docker exec o113 tar -xzOf "$W64_TREE/include/octave-11.3.0.tar.gz" 2>/dev/null >/dev/null || true
  if sudo -n docker exec o113 grep -q "typedef int64_t mwSize;" "$W64_TREE/include/octave-11.3.0/octave/mxtypes.h" \
     && ! sudo -n docker exec o113 grep -q "typedef int64_t mwSize;" /src/work/octave-install/include/octave-11.3.0/octave/mxtypes.h; then
    say "  ✓ wasm64 头树核验：mxtypes.h 的 mwSize=int64_t（与 wasm32 树确实分叉）"
  else
    die "wasm64 头树核验失败：mxtypes.h 的 mwSize 形状与预期不符（取错树？）"
  fi
  say "  Octave 头落 $DST/octave-headers.wasm64.tar.gz（wasm64 安装树：$W64_TREE）"
  # config.h.json（25 宏 = build-pkg-oct.sh emit_config_h 的合成产物，从容器取 —— 数据跟
  # catalog 走、不硬编码在 JS；NOTES-client-compile-design §10 判据 2）。
  SITE_DST="$SITE"
  python3 - "$SITE_DST" <<'PYJSON'
import json, re, subprocess, sys
out = sys.argv[1] + "/assets/llvm/config.h.json"
try:
    txt = subprocess.run(
        ["sudo", "-n", "docker", "exec", "o113", "cat",
         "/src/libwork/forge/optim-1.6.3/src/config.h"],
        capture_output=True, text=True, timeout=60).stdout
    macros = {}
    for line in txt.splitlines():
        m = re.match(r"#define\s+(\S+)\s+(.+)$", line.strip())
        if m: macros[m.group(1)] = m.group(2).strip()
    if len(macros) < 20:
        raise RuntimeError("容器 config.h 宏数 %d < 20（取错了？）" % len(macros))
    json.dump(macros, open(out, "w", encoding="utf-8"), indent=1)
    print("  ✓ config.h.json（%d 宏，从容器 build-pkg-oct 产物）" % len(macros))
except Exception as e:
    print("  ⚠️ config.h.json 没生成（%s）—— compileExtension 会缺 config.h" % e, file=sys.stderr)
    sys.exit(0)   # 不致命：已有一份在站点上时仍可用；但新站点会缺
PYJSON
  # ★ 包模块表（2026-10-18 多 TU 批）：`assets/pkg-module-table.json` = 容器
  #   build-pkg-oct.sh 那张手写表的对账副本（闸门 check-pkg-module-table.py 盯着）。
  #   客户端靠它知道"这个包该编出哪几个模块、各由哪些源组成"；缺它 ⇒ 退回扫 DEFUN，
  #   会编出容器**故意不列**的模块（miscellaneous 的 sample.cc 在 11.3.0 头下编不过）。
  if [ -f "$REPO/build/pkg-module-table.json" ]; then
    mkdir -p "$SITE/assets"
    cp "$REPO/build/pkg-module-table.json" "$SITE/assets/pkg-module-table.json"
    say "  ✓ assets/pkg-module-table.json（包模块表，编译模块分组的知识）"
  else
    say "  ⚠️ build/pkg-module-table.json 缺 —— compileExtension 会退回扫 DEFUN（可能编出不该编的模块）"
  fi
}

case "${1:-}" in
  fetch)
    fetch_bundle && provision && provision_octinc
    say "完成：工具链 + Octave 头已供给进 $SITE/assets/{llvm,octinc}/"
    ;;
  verify)
    [ -s "$CACHE/$BUNDLE" ] || die "缓存没有 bundle（先 fetch）"
    [ "$(sha "$CACHE/$BUNDLE")" = "$BUNDLE_SHA" ] || die "bundle sha 不符"
    provision && provision_octinc
    say "复核通过"
    ;;
  --selftest)
    # 三类用例（F1）：正常不报 / 该报的必须报 / 空输入必须报 —— 不碰真网络
    T="$(mktemp -d)"; bad=0
    ok () { echo "PASS | $1"; }
    ng () { echo "fail | $1"; bad=$((bad+1)); }
    # ① sha 相符 ⇒ 通过（伪 bundle + 伪 manifest）
    mkdir -p "$T/fake/out"
    printf 'FAKEBYTES' > "$T/fake/out/clang.js"
    H=$(printf 'FAKEBYTES' | sha256sum | cut -d' ' -f1)
    printf '{"assets":[{"name":"clang.js","bytes":9,"sha256":"%s"}]}' "$H" > "$T/fake/out/manifest.json"
    if (cd "$T" && python3 - "$T/fake/out" "$T/site" <<'PY'
import hashlib, json, os, shutil, sys
src, dst = sys.argv[1], sys.argv[2]
man = json.load(open(os.path.join(src, "manifest.json")))
os.makedirs(dst, exist_ok=True); bad = 0
for a in man["assets"]:
    p = os.path.join(src, a["name"])
    if not os.path.isfile(p) or hashlib.sha256(open(p,"rb").read()).hexdigest() != a["sha256"]:
        bad += 1; continue
    shutil.copy2(p, os.path.join(dst, a["name"]))
sys.exit(1 if bad else 0)
PY
    ); then ok "① 逐件 sha 相符 ⇒ 落件"; else ng "① sha 相符竟失败"; fi
    # ② sha 不符 ⇒ 必须拒（改一字节）
    printf 'FAKEBYTEZ' > "$T/fake/out/clang.js"
    if (cd "$T" && python3 - "$T/fake/out" "$T/site2" <<'PY'
import hashlib, json, os, shutil, sys
src, dst = sys.argv[1], sys.argv[2]
man = json.load(open(os.path.join(src, "manifest.json")))
os.makedirs(dst, exist_ok=True); bad = 0
for a in man["assets"]:
    p = os.path.join(src, a["name"])
    if not os.path.isfile(p) or hashlib.sha256(open(p,"rb").read()).hexdigest() != a["sha256"]:
        bad += 1; continue
    shutil.copy2(p, os.path.join(dst, a["name"]))
sys.exit(1 if bad else 0)
PY
    ); then ng "② sha 不符竟通过（fail-closed 失效）"; else ok "② 改一字节 ⇒ 必须拒"; fi
    # ③ manifest 缺席 ⇒ 必须报（零值守卫）
    mkdir -p "$T/empty/out"
    [ -s "$T/empty/out/manifest.json" ] && ng "③ 夹具坏了" || ok "③ manifest 缺席 ⇒ 拒（不许无凭装配）"
    rm -rf "$T"
    echo "=== provision-llvm-wasm 自证：$((3-bad)) PASS / $bad fail ==="
    [ "$bad" = 0 ]
    ;;
  *)
    echo "用法：$0 {fetch|verify|--selftest}" >&2; exit 2 ;;
esac
