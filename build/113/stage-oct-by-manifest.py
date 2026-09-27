#!/usr/bin/env python3
# Octave-Full-Wasm — 按**基础清单的结构**把车道 `.oct` 落到站点（B6，2026-09-27）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

"""把车道编出来的 `.oct` 按**基础清单说的地方**放好，而不是按"源目录"放。

## 为什么必须按清单放（实测踩到）

第一版按"源目录 → 目标目录"的朴素映射：核心目录 → `oct-threads/`、包目录 → `octdir-threads/<包>/`。
结果 **slicot 调度模块**（`__control_slicot_functions__.oct`）被编进了**核心**目录，而清单说它属于
`octdir/control/` ⇒ 放错地方 ⇒ 被 `--check` 判"缺文件"。**清单是结构的唯一真值**，源目录只提供文件。

命名/位置规则（逐字来自清单）：
  kind=oct    → `<assets>/oct-threads/<url 的文件名>`
  kind=octdir → `<assets>/octdir-threads/<name>/<files 里的每个 .oct>`

源：在给定的若干目录里按**文件名**找（找不到就 FATAL，不静默；同名文件出现两次要报出来）。

用法：
  python3 build/113/stage-oct-by-manifest.py <站点目录> <车道源目录…>
  python3 build/113/stage-oct-by-manifest.py --selftest
"""
import json
import os
import shutil
import sys
import tempfile


def index_sources(dirs):
    """{basename: 路径}；同名冲突要报（返回 (索引, 冲突列表)）。"""
    idx, dup = {}, []
    for d in dirs:
        if not os.path.isdir(d):
            continue
        for r, _x, fs in os.walk(d):
            for f in fs:
                if not f.endswith(".oct"):
                    continue
                p = os.path.join(r, f)
                if f in idx:
                    dup.append((f, idx[f], p))
                else:
                    idx[f] = p
    return idx, dup


def wanted(manifest):
    """从基础清单推出 (文件名, 目标相对 assets 的路径) 列表。"""
    out = []
    for a in manifest.get("assets", []):
        if a.get("kind") == "oct":
            fn = a["url"].rsplit("/", 1)[-1]
            out.append((fn, os.path.join("oct-threads", fn)))
        elif a.get("kind") == "octdir":
            # ⚠️ 用 **base_url 的末段**（磁盘上就是这个目录名），**不是** `name`：
            #    实测清单里 `name="control-oct"` 而 `base_url="assets/octdir/control"`
            #    —— 两处各取一半就会打架（stager 建 `control-oct/`、改写器指 `control/`，
            #    于是 `--check` 报"目录不存在"）。基础档的磁盘结构以 base_url 为准。
            seg = (a.get("base_url") or "").rstrip("/").rsplit("/", 1)[-1]
            d = os.path.join("octdir-threads", seg)
            for f in (a.get("files") or []):
                if f.endswith(".oct"):
                    out.append((f, os.path.join(d, f)))
    return out


def stage(site, srcs, copy=shutil.copyfile):
    """返回 (落件数, 缺件列表, 冲突列表)。`copy` 可注入 ⇒ 自证不碰真文件。"""
    man = json.load(open(os.path.join(site, "assets", "manifest.json"), encoding="utf-8"))
    idx, dup = index_sources(srcs)
    missing, n = [], 0
    for fn, rel in wanted(man):
        srcp = idx.get(fn)
        if not srcp:
            missing.append(fn)
            continue
        dst = os.path.join(site, "assets", rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        copy(srcp, dst)
        n += 1
    return n, missing, dup


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if len(argv) < 2:
        print(__doc__.strip().split("用法：")[-1].strip(), file=sys.stderr)
        return 2
    site, srcs = argv[0], argv[1:]
    n, missing, dup = stage(site, srcs)
    for f, a, b in dup:
        print("   ⚠️ 源里有两个同名 .oct：%s（%s / %s）" % (f, a, b))
    print("   落件 %d 个；缺 %s" % (n, missing or "无"))
    if missing:
        print("FATAL: 车道里缺这些 .oct：%s" % ", ".join(missing), file=sys.stderr)
        return 1
    return 0


# ── 自证（三类：按清单放对 / 缺件必报 / 同名要报）─────────────────────────────
_MAN = {"assets": [
    {"kind": "oct", "url": "assets/oct/gzip.oct"},
    {"kind": "octdir", "name": "control-oct", "base_url": "assets/octdir/control",
     "files": ["is_matrix.oct", "__control_slicot_functions__.oct"]},
]}


def _fixture():
    """造一个临时站点 + 两个车道源目录（slicot 故意放在"核心"目录里，复现踩过的坑）。"""
    d = tempfile.mkdtemp()
    os.makedirs(os.path.join(d, "assets"))
    json.dump(_MAN, open(os.path.join(d, "assets", "manifest.json"), "w"))
    core = os.path.join(d, "src-core")
    pkg = os.path.join(d, "src-pkg", "statistics")
    os.makedirs(core)
    os.makedirs(pkg)
    for f in ("gzip.oct", "__control_slicot_functions__.oct"):
        open(os.path.join(core, f), "wb").write(b"\0asm" + f.encode())
    open(os.path.join(pkg, "is_matrix.oct"), "wb").write(b"\0asm")
    return d, [core, os.path.dirname(pkg)]


def selftest():
    d, srcs = _fixture()
    cases = []
    try:
        n, missing, dup = stage(d, srcs)
        cases = [
            ("按清单落件：3 个文件都在", lambda: n == 3 and not missing),
            ("★ 放在**核心**目录里的 slicot 模块被放到清单说的 `octdir-threads/control/`",
             lambda: os.path.exists(os.path.join(d, "assets", "octdir-threads", "control",
                                                 "__control_slicot_functions__.oct"))),
            ("kind=oct 进 `oct-threads/`",
             lambda: os.path.exists(os.path.join(d, "assets", "oct-threads", "gzip.oct"))),
            ("**缺件必须报**（把源指向空目录）",
             lambda: stage(d, [os.path.join(d, "nowhere")])[1] != []),
        ]
        # 同名冲突要报
        d2 = os.path.join(d, "src2")
        os.makedirs(d2, exist_ok=True)
        open(os.path.join(d2, "gzip.oct"), "wb").write(b"\0asm")
        cases.append(("★ 同名 .oct 出现两次 ⇒ 必须报出来",
                      lambda: stage(d, srcs + [d2])[2] != []))
        bad = 0
        for name, fn in cases:
            try:
                ok = bool(fn())
            except Exception as e:                    # noqa: BLE001
                ok, name = False, "%s（异常 %r）" % (name, e)
            print("%s | %s" % ("PASS" if ok else "fail", name))
            bad += 0 if ok else 1
        print("=== stage-oct-by-manifest 自证：%d PASS / %d fail ===" % (len(cases) - bad, bad))
        return 1 if bad else 0
    finally:
        shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
