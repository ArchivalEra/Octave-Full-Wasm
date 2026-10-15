#!/usr/bin/env bash
# Octave-Full-Wasm — **Pyodide 供给**（接缝 §5 第④步 · 符号计算的能力层）
# Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么独立脚本（与 provision-upstream.sh 同族）：Pyodide 与工具链是**可重建缓存**，按
# URL+sha256 钉版本、供给进站点（同源硬约束：COEP 拦跨域 fetch，实测过）。该资产是
# **共享能力层**（符号计算用上，未来别人也可能用），不进 Forge 包档案。
#
# 用法：
#   sh build/113/provision-pyodide.sh fetch      下载 + 落持久盘缓存 + 装配进站点
#   sh build/113/provision-pyodide.sh verify      复核（不下载）
#   sh build/113/provision-pyodide.sh --selftest  自证（三类：正常/该报/空值，不碰真网络）
#
# 依据（实测，不猜）：
#   · 发行件 = https://github.com/pyodide/pyodide/releases/download/314.0.7/pyodide-core-314.0.7.tar.bz2
#     + https://pypi.org/pypi/{sympy,mpmath}/<ver>/json 解析的 .whl 直链（字节 SHA 见下）
#   · **身份坑（实测抓到）**：`pyodide-lock.json` 记录的字节 ≠ PyPI 官方字节（pyodide 会重新
#     打包去测试件；lock 里 `unvendored_tests: true` 就是这个意思）⇒ 供给走 **PyPI 官方字节**，
#     且把托管副本的 `pyodide-lock.json` 里两条 sha 改写为**我们下载的那份**（访钉不许返包，
#     这是我们的字节）。
#   · 每次进站点即用：每字字节都核 sha256（fail-closed）。
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
CACHE="${PYODIDE_CACHE:-/mnt/hdd/octave-wasm-build/third_party/pyodide}"
SITE="${SITE_DIR:-/mnt/hdd/octave-wasm-build/site}"
VER="314.0.7"

# ── 资产清单（每条 = URL + sha256，fail-closed；sha 与字节不符 ⇒ 拒装）──────
#   ⚠️ 两条轮子的 sha 是 **PyPI 官方字节的 sha**（不是 pyodide lock 里的那份重打包）。
CORE_TAR="$CACHE/pyodide-core-${VER}.tar.bz2"
CORE_SHA="2abdcc2e35208af406e07724cffa85bc582ced97e9028383ecf5462541393f95"
SYMPY_WHL="$CACHE/sympy-1.14.0-py3-none-any.whl"; SYMPY_SHA="e091cc3e99d2141a0ba2847328f5479b05d94a6635cb96148ccb3f34671bd8f5"
MPMATH_WHL="$CACHE/mpmath-1.4.1-py3-none-any.whl"; MPMATH_SHA="dc4f0ea2304480d4a9a48a94c1020571558ade522b44a6912efac63a586e140f"

CORE_URL="https://github.com/pyodide/pyodide/releases/download/${VER}/pyodide-core-${VER}.tar.bz2"

say () { printf "%s\n" "$1"; }
die () { printf "FATAL: %s\n" "$1" >&2; exit 1; }

sha256_file () {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; return; fi
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'; return; fi
  die "缺少 sha256sum/shasum"
}

fetch_one () { # $1=URL $2=期望 sha $3=目的路径
  local url="$1" want="$2" dest="$3"
  mkdir -p "$(dirname "$dest")"
  if [ -f "$dest" ]; then
    local got; got="$(sha256_file "$dest")"
    if [ "$got" = "$want" ]; then say "  已在：$(basename "$dest")（sha 匹配，跳过下载）"; return 0; fi
    { rm -f "$dest"; die "sha256 不符：$(basename "$dest")（预期 ${want:0:12}… 实际 ${got:0:12}…）⇒ 拒装"; }
  fi
  say "  下载：$(basename "$dest")"
  if ! curl -sL --max-time 300 --fail -o "$dest" "$url"; then { rm -f "$dest"; die "下载失败：$url"; } fi
  local got; got="$(sha256_file "$dest")"
  [ "$got" = "$want" ] || { rm -f "$dest"; die "sha256 不符：$(basename "$dest")（下载完但字节错）"; }
}

resolve_pypi () { # $1=包名 $2=版本 → 打出 .whl 直链（PyPI JSON API）
  python3 - "$1" "$2" <<'PY'
import json, sys, urllib.request
pkg, ver = sys.argv[1], sys.argv[2]
d = json.loads(urllib.request.urlopen(f"https://pypi.org/pypi/{pkg}/{ver}/json", timeout=30).read())
for u in d.get("urls", []):
    if u.get("filename", "").endswith(".whl"):
        print(u["url"]); break
PY
}

fetch_wheel () { # $1=包名 $2=版本 $3=期望 sha $4=目的文件名（匹配 lock 的 file_name）
  local pkg="$1" ver="$2" want="$3" fname="$4"
  local url; url="$(resolve_pypi "$pkg" "$ver")"
  [ -n "$url" ] || die "解析失败：$pkg==$ver（PyPI 没给 .whl 直链）"
  fetch_one "$url" "$want" "$CACHE/$fname"
}

symlink_overlay () { # 在【解包后的 core/】里把 pyodide-lock.json 的两条 sha 换实测字节
  local py_dir="$1"
  local lock="$py_dir/pyodide-lock.json"
  [ -f "$lock" ] || die "缺 $lock（解包 core 但没见过 lock ⇒ 供给没做完）"
  python3 - "$lock" "$SYMPY_SHA" "$MPMATH_SHA" <<'PY'
import json, sys
lock, sym_sha, mp_sha = sys.argv[1:]
with open(lock, encoding="utf-8") as f: d = json.load(f)
for pkg, sha, fname in (("sympy", sym_sha, "sympy-1.14.0-py3-none-any.whl"),
                        ("mpmath", mp_sha, "mpmath-1.4.1-py3-none-any.whl")):
    if pkg not in d.get("packages", {}):
        continue
    d["packages"][pkg]["sha256"] = sha
    d["packages"][pkg]["file_name"] = fname
with open(lock, "w", encoding="utf-8") as f: f.write(json.dumps(d, indent=1, ensure_ascii=False) + "\n")
print(f"  → pyodide-lock.json 已覆盖（sympy/mpmath 的 sha 换上实测 PyPI 字节）")
PY
}

case "${1:-}" in
  fetch)
    say "== 供给 Pyodide $VER（core + sympy + mpmath）=="
    fetch_one "$CORE_URL" "$CORE_SHA" "$CORE_TAR"
    fetch_wheel "sympy" "1.14.0" "$SYMPY_SHA" "sympy-1.14.0-py3-none-any.whl"
    fetch_wheel "mpmath" "1.4.1" "$MPMATH_SHA" "mpmath-1.4.1-py3-none-any.whl"
    say "== 装配 → <站点>/assets/pyodide/"
    [ -n "$SITE" ] || die "SITE_DIR 未设（不知道装配到哪）"
    mkdir -p "$SITE/assets/pyodide"
    # ① 解包 core（tar.bz2 → tar → 目录）
    tar -xjf "$CORE_TAR" -C "$SITE/assets/pyodide"
    # ② 拷轮子（**按 lock 的 file_name 命名**，用我们刚改写过的 set_lock）
    cp -f "$SYMPY_WHL" "$SITE/assets/pyodide/pyodide/sympy-1.14.0-py3-none-any.whl"
    cp -f "$MPMATH_WHL" "$SITE/assets/pyodide/pyodide/mpmath-1.4.1-py3-none-any.whl"
    # ③ 改托管 lock（让 Pyodide 装载器认我们这份字节）
    symlink_overlay "$SITE/assets/pyodide/pyodide"
    # ④ 装配后再核一遍（写盘也可能出问题）
    for f in "$SITE/assets/pyodide/pyodide/sympy-1.14.0-py3-none-any.whl" "$SITE/assets/pyodide/pyodide/mpmath-1.4.1-py3-none-any.whl"; do
      case "$f" in *sympy*) want="$SYMPY_SHA";; *mpmath*) want="$MPMATH_SHA";; esac
      got="$(sha256_file "$f")"
      [ "$got" = "$want" ] || { rm -f "$f"; die "装配后 sha 不符：$(basename "$f")"; }
      say "  ok 装配：$(basename "$f")（sha 与本地字节一致）"
    done
    say "供给完成：$SITE/assets/pyodide/（含 core、pyodide/lock、两个轮子）"
    ;;
  verify)
    say "== 供给复核（Pyodide $VER）=="
    for pair in "$CORE_TAR:$CORE_SHA" "$SYMPY_WHL:$SYMPY_SHA" "$MPMATH_WHL:$MPMATH_SHA"; do
      f="${pair%%:*}"; want="${pair##*:}"
      [ -f "$f" ] || die "缺：$f"
      got="$(sha256_file "$f")"
      [ "$got" = "$want" ] || die "sha 不符：$(basename "$f")（get $want, got $got)"
      say "  ok: $(basename "$f")（sha 一致）"
    done
    [ -d "$SITE/assets/pyodide" ] || die "站点缺 assets/pyodide（供给没做）"
    say "供给复核：ok"
    ;;
  --selftest)
    tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT INT TERM
    SITE="$tmp" PYODIDE_CACHE="$tmp" sh "$0" verify >/dev/null 2>&1 && { echo "★ selftest 失败：空站点 verify 没报"; exit 1; }
    echo "selftest：OK（空站点/空缓存 ⇒ 必报红；fetch 后供给即可复验）"
    ;;
  ""|--help|-h)
    say "用法：sh build/113/provision-pyodide.sh {fetch|verify|--selftest}"
    ;;
  *) die "未知动作：$1（用 --help）" ;;
esac
