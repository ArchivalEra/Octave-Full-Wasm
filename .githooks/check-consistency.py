#!/usr/bin/env python3
# Octave-Full-Wasm — 资产/挂载路径的**一致性检查**（胶水层审计候选 6）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

"""查那些"同一件知识写在好几处"的地方有没有走散。

为什么要有它（2026-09-23 胶水层审计候选 6）：同一批路径被构建期与运行期各记一遍 ——
挂载根 `/usr/src/octave/m` 至少在四处出现过（`build/assets.py` 的常量、
`bridge/assets-loader.js` 的常量、`build/main.cc` 里那串手写的目录、清单里每个条目的
`mount`），而**启动装载清单**又是 `bridge/index.html` 里手写的第三个名字列表。
这类"同一件事说几遍"最容易静默走散（本轮就查出两例：`webnet.js` 部署了但没人加载、
清单里的 `run` 字段写了没人读）。

检查项（客观可判，不做风格判断）：
  1. 挂载根：`build/assets.py` 与 `bridge/assets-loader.js` 声明的 OCTAVE_M 必须一致，
     且 `build/main.cc` 里出现的每个 `/usr/src/octave/...` 路径都必须挂在它下面；
  2. 启动清单：`index.html` 里 `OctaveAssets.load(...)` 用到的每个名字都必须在清单里
     （站点读不到就**明确跳过**这一项）；
  3. 11.3.0 车道里不许出现 `/7.2.0/` 路径（`build/113/*`、`recover*.sh`、
     `promote-webgl.sh`、`bridge/*`）。**`build/Makefile` 例外**：它是 7.2 车道的上游配方
     （`rwl/octave-wasm`，`OCTAVE_VER = 7.2.0`），11.3.0 容器里根本没有这个文件
     （重链走 `build/113/link-web.sh`）⇒ 它写 7.2 是对的，改它反而错。

用法：
  check-consistency.py          # 有问题 exit 1（pre-commit / pre-push 用）
  check-consistency.py --list   # 只列不改、永远 exit 0（人工巡检）
"""
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.environ.get("OCTAVE_SITE", "/mnt/hdd/octave-wasm-build/site")
LANE = ["build/113", "build/recover.sh", "build/recover-113.sh",
        "build/promote-webgl.sh", "bridge"]
SEVEN_TWO = re.compile(r"/7\.2\.0/")
OCTAVE_PATH = re.compile(r"/usr/src/octave/[A-Za-z0-9_./@+-]*")


def read(rel):
    with open(os.path.join(REPO, rel), encoding="utf-8", errors="replace") as fh:
        return fh.read()


def boot_names(html):
    """index.html 里 OctaveAssets.load(...) 用到的名字（含 CORE_DLDFCN 那种变量间接）。"""
    names = set()
    for m in re.finditer(r"OctaveAssets\.load\(\s*(\[[^\]]*\]|\w+)", html):
        arg = m.group(1)
        if arg.startswith("["):
            names.update(re.findall(r"'([^']+)'", arg))
        else:
            dm = re.search(r"(?:var\s+)?" + re.escape(arg) + r"\s*=\s*\[([^\]]*)\]", html, re.S)
            if dm:
                names.update(re.findall(r"'([^']+)'", dm.group(1)))
    return {n for n in names if n}


def main():
    problems, notes = [], []

    # ── 1) 挂载根 ────────────────────────────────────────────────────────────
    py_root = (re.search(r'^OCTAVE_M\s*=\s*"([^"]+)"', read("build/assets.py"), re.M) or [None, None])[1]
    js_root = (re.search(r"OCTAVE_M\s*=\s*'([^']+)'", read("bridge/assets-loader.js")) or [None, None])[1]
    if not py_root or not js_root:
        problems.append(("挂载根常量读不到", f"assets.py={py_root!r} loader={js_root!r}"))
    elif py_root != js_root:
        problems.append(("挂载根两处不一致", f"assets.py={py_root!r} loader={js_root!r}"))
    else:
        notes.append(f"挂载根：assets.py 与 loader 都是 {py_root}")

    if py_root:
        paths = sorted(set(OCTAVE_PATH.findall(read("build/main.cc"))))
        if len(paths) < 10:
            problems.append(("main.cc 里的 octave 路径太少，检查可能失效", f"{len(paths)} 条"))
        stray = [p for p in paths if not p.startswith(py_root)]
        if stray:
            problems.append(("main.cc 有路径没挂在挂载根下", ", ".join(stray[:3])))
        else:
            notes.append(f"main.cc 的 {len(paths)} 条路径都在 {py_root} 下")

    # ── 2) 启动清单 ⊆ 清单 ───────────────────────────────────────────────────
    boot = boot_names(read("bridge/index.html"))
    man = os.path.join(SITE, "assets", "manifest.json")
    if not os.path.exists(man):
        notes.append(f"启动清单核对**跳过**（读不到 {man}）")
    else:
        names = {a.get("name") for a in json.load(open(man, encoding="utf-8")).get("assets", [])}
        missing = sorted(n for n in boot if n not in names)
        if missing:
            problems.append(("index.html 装的名字不在清单里", ", ".join(missing)))
        else:
            notes.append(f"启动清单 {len(boot)} 个名字都在清单里（清单共 {len(names)} 条）")

    # ── 2b) 每个 assets/m/*.js 的 addpath 必须等于 assets-meta.json 的声明 ───
    # 为什么要有这条：**挂载点一旦猜错，症状是"某个函数解析不到"而不是"装不上"**
    # （2026-09-23 实测：把 pkgfix 猜成 m/pkgfix ⇒ private get_description 解析不到 ⇒
    #  `pkg list` 整个坏掉，而加载器一声不响）。
    meta_path = os.path.join(REPO, "build", "assets-meta.json")
    mdir = os.path.join(SITE, "assets", "m")
    if not (os.path.exists(meta_path) and os.path.isdir(mdir)):
        notes.append("挂载点核对**跳过**（读不到 assets-meta.json 或站点 assets/m/）")
    else:
        meta = json.load(open(meta_path, encoding="utf-8"))
        bad = []
        for fn in sorted(os.listdir(mdir)):
            if not fn.endswith(".js"):
                continue
            name = fn[:-3]
            txt = open(os.path.join(mdir, fn), encoding="utf-8", errors="replace").read()
            m = re.search(r"addpath:\s*(\[[^\]]*\])", txt)
            if not m:
                continue
            want = meta.get(name, {}).get("mount") or f"{py_root or '/usr/src/octave/m'}/{name}"
            got = json.loads(m.group(1))[0] if json.loads(m.group(1)) else None
            if got != want:
                bad.append(f"{name}: 部署是 {got}，声明是 {want}")
        if bad:
            problems.append(("资产挂载点与声明不符", "; ".join(bad[:4])))
        else:
            notes.append(f"assets/m/ 里各包的挂载点与 assets-meta.json 声明一致")

    # ── 3) 11.3.0 车道里没有 7.2 路径 ─────────────────────────────────────────
    hits = []
    for entry in LANE:
        p = os.path.join(REPO, entry)
        files = []
        if os.path.isdir(p):
            for root, _d, names in os.walk(p):
                files += [os.path.join(root, n) for n in names]
        elif os.path.isfile(p):
            files = [p]
        for f in files:
            try:
                txt = open(f, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            for i, line in enumerate(txt.split("\n"), 1):
                if SEVEN_TWO.search(line):
                    hits.append(f"{os.path.relpath(f, REPO)}:{i}")
    if hits:
        problems.append(("11.3.0 车道里出现 /7.2.0/ 路径", ", ".join(hits[:5])))
    else:
        notes.append("11.3.0 车道里没有 /7.2.0/ 路径")

    for n in notes:
        print(f"  · {n}")
    if problems:
        print("★ 一致性检查不通过：", file=sys.stderr)
        for what, detail in problems:
            print(f"  [{what}] {detail}", file=sys.stderr)
        return 0 if "--list" in sys.argv else 1
    print("资产/挂载路径一致性：OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
