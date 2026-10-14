#!/usr/bin/env bash
# A/B 夹具：SymPy **预编译字节码（.pyc）** vs 源码轮子（2026-10-14）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 用户问题："transcript 预编译 python 是不是更好的路径，性能能快几倍吧"
#   · "Transcrypt（静态编译成 JS）"那一半 —— 判据 = SymPy 源码 eval/exec 计数
#     （探针会报；实测 eval( 340 / exec( 61，去 benchmarks/testing）⇒ 不可行，不靠本夹具。
#   · "预编译字节码"那一半 —— 本夹具量（**唯一变量 = 轮子里有没有 __pycache__**）。
#
# ⚠️ 三条纪律（少一条 A/B 就是假的）：
#   ① .pyc 必须用 **Pyodide 自己的 CPython** 编（magic 版本要匹配）；
#   ② 必须 **hash 校验模式**（timestamp 模式的 mtime 在浏览器 FS 里对不上 ⇒ CPython
#      静默拒绝 .pyc 回落到现编 ⇒ 看起来"没差别"）；
#   ③ 仪器 = `SourceFileLoader.source_to_code` 调用次数 + **被编文件名清单**
#      （B 档若仍有编译，要点名是谁，不许含糊）。
set -euo pipefail
REPO=${REPO:-$(cd "$(dirname "$0")/../../.." && pwd)}
SERVE=${SERVE:-/mnt/hdd/octave-wasm-build/symprobe/serve}
CACHE=${CACHE:-/mnt/hdd/octave-wasm-build/symprobe/cache}
BUILD=${BUILD:-/tmp/sympy-pycbuild}

# 0) 前置：上游探针已经备好 serve/（Pyodide 运行时 + sympy/mpmath 轮子）
[ -d "$SERVE/pyodide" ] || {
  echo "FATAL: 缺 $SERVE/pyodide —— 先跑 sh test/browser/run.sh test/browser/probe-pyodide-sympy.mjs" >&2
  exit 3; }
for w in sympy-1.14.0-py3-none-any.whl mpmath-1.4.1-py3-none-any.whl; do
  [ -f "$CACHE/$w" ] || { echo "FATAL: 缺 $w（$CACHE）" >&2; exit 3; }
done

# 1) 解包源码（**两个包都要**：sympy 的 import 会连带 mpmath）
rm -rf "$BUILD"; mkdir -p "$BUILD"
python3 -m zipfile -e "$CACHE/sympy-1.14.0-py3-none-any.whl" "$BUILD"
python3 -m zipfile -e "$CACHE/mpmath-1.4.1-py3-none-any.whl" "$BUILD"

# 2) 用 **Pyodide 的 python** + **hash 校验模式**编 .pyc
echo "== 预编译（Pyodide CPython，checked-hash）"
( cd "$SERVE/pyodide" && ./python - <<'PY'
import compileall
for d in ('/tmp/sympy-pycbuild/sympy', '/tmp/sympy-pycbuild/mpmath'):
    compileall.compile_dir(d, quiet=2, legacy=False,
        invalidation_mode=compileall.py_compile.PycInvalidationMode.CHECKED_HASH)
print('compileall done, magic =', __import__('importlib.util').util.MAGIC_NUMBER.hex())
PY
)
N=$(find "$BUILD" -name '*.pyc' | wc -l)
echo "   编出 .pyc = $N 个"
[ "$N" -gt 100 ] || { echo "FATAL: .pyc 数异常（$N）" >&2; exit 3; }

# 3) 重打包两个轮子（**只加 __pycache__**），并把 file/sha 写成 repacked.json
echo "== 重打包轮子（只加 __pycache__）"
FIX="$(cd "$(dirname "$0")" && pwd)"
python3 - "$CACHE" "$BUILD" "$SERVE/pyodide" "$FIX" <<'PY'
import json, os, subprocess, sys, hashlib
cache, build, pydir, fix = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
out = {}
for top in ('sympy', 'mpmath'):
    orig = [f for f in os.listdir(cache) if f.startswith(top + '-') and f.endswith('.whl')][0]
    src = os.path.join(cache, orig)
    new = top + '-pyc.whl'
    dst = os.path.join(pydir, new)
    # ⚠️ 用 heredoc 时 `__file__` 不可靠（stdin 执行）⇒ 脚本路径当作参数传进来（实测踩到）
    r = subprocess.run([sys.executable, os.path.join(fix, 'repack-wheel.py'), src, build, dst])
    assert r.returncode == 0, 'repack failed'
    out[top] = { 'file': new, 'sha256': hashlib.sha256(open(dst,'rb').read()).hexdigest(),
                 'bytes': os.path.getsize(dst), 'origFile': orig,
                 'origSha256': hashlib.sha256(open(src,'rb').read()).hexdigest(),
                 'origBytes': os.path.getsize(src) }
json.dump(out, open(os.path.join(pydir, 'repacked.json'), 'w'), indent=1)
print('   repacked.json 写好：', {k: (v['bytes'], v['origBytes']) for k, v in out.items()})
PY

# 4) 跑浏览器 A/B
cd "$REPO"
sh test/browser/run.sh test/fixtures/sympy-pyc-ab/probe-sympy-pyc-ab.mjs
