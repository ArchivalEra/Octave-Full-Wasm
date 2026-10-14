#!/usr/bin/env bash
# 预编 .pyc 轮子：把 SymPy/mpmath 的字节码编进轮子（sympy-pyc-ab 与 sympy-perf 共用，2026-10-14）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 用户问题："预编译 python 是不是更好的路径 / 那试试预编译 pyc，还能快多少"
# 本脚本 = 那两个问题的**供给件**：产出 `$SERVE/pyodide/{sympy,mpmath}-pyc.whl`
# + `repacked.json`（file/sha256/bytes 逐条，供夹具改写 pyodide lock 用）。
#
# ⚠️ 三条纪律（少一条，A/B 或复跑就不可信）：
#   ① .pyc 必须用 **Pyodide 自己的 CPython** 编（magic 要匹配；宿主 Python 编的会被
#      CPython **静默拒用** ⇒ 看起来"没差别"）；
#   ② 必须 **hash 校验模式**（timestamp 模式把 mtime 写进头，浏览器 FS 里对不上 ⇒ 静默回落现编）；
#   ③ 每次**重建**（~15 s）—— 不复用陈旧的 /tmp 残留（陈旧产物是"读数不可复现"的经典来源）。
#
# 用法：sh test/fixtures/sympy-pyc-ab/prepare-pyc-wheels.sh
#   前置：serve/ 已备好（跑过一次 `test/browser/probe-pyodide-sympy.mjs` 即可）。
set -euo pipefail
FIX="$(cd "$(dirname "$0")" && pwd)"
SERVE=${SERVE:-/mnt/hdd/octave-wasm-build/symprobe/serve}
CACHE=${CACHE:-/mnt/hdd/octave-wasm-build/symprobe/cache}
BUILD=${BUILD:-/tmp/sympy-pycbuild}

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
#    ⚠️ 用 heredoc 时 `__file__` 不可靠（stdin 执行）⇒ 脚本路径当参数传进来（实测踩到）。
echo "== 重打包轮子（只加 __pycache__）"
python3 - "$CACHE" "$BUILD" "$SERVE/pyodide" "$FIX" <<'PY'
import json, os, subprocess, sys, hashlib
cache, build, pydir, fix = sys.argv[1:5]
out = {}
for top in ('sympy', 'mpmath'):
    orig = sorted(f for f in os.listdir(cache)
                  if f.startswith(top + '-') and f.endswith('.whl'))[0]
    src = os.path.join(cache, orig)
    new = top + '-pyc.whl'
    dst = os.path.join(pydir, new)
    r = subprocess.run([sys.executable, os.path.join(fix, 'repack-wheel.py'), src, build, dst])
    assert r.returncode == 0, 'repack failed'
    out[top] = {'file': new, 'sha256': hashlib.sha256(open(dst, 'rb').read()).hexdigest(),
                'bytes': os.path.getsize(dst), 'origFile': orig,
                'origSha256': hashlib.sha256(open(src, 'rb').read()).hexdigest(),
                'origBytes': os.path.getsize(src)}
json.dump(out, open(os.path.join(pydir, 'repacked.json'), 'w'), indent=1)
print('   repacked.json 写好：', {k: (v['bytes'], v['origBytes']) for k, v in out.items()})
PY
