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
  2. 启动清单：`index.html` 里 `*.Assets.load(...)`（OctaveAssets 或实例变量 Assets）
     用到的每个名字都必须在清单里
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
import subprocess
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "build", "lib"))
# ⚠️ 别名：本文件里 `root` 已被 os.walk 的循环变量占用（实测踩过 UnboundLocalError）
from gate import root as gate_root, selftest, run_quiet, fixture, cleanup   # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.environ.get("OCTAVE_SITE", "/mnt/hdd/octave-wasm-build/site")
LANE = ["build/113", "build/recover.sh", "build/recover-113.sh",
        "build/promote-webgl.sh", "bridge"]
SEVEN_TWO = re.compile(r"/7\.2\.0/")
OCTAVE_PATH = re.compile(r"/usr/src/octave/[A-Za-z0-9_./@+-]*")


def read(rel):
    with open(os.path.join(REPO, rel), encoding="utf-8", errors="replace") as fh:
        return fh.read()


def read_or_none(rel):
    """★ F1：**读不到就返回 None，别抛** —— 会崩的闸门不能指望它报告
    （实测：空夹具树下 `read("build/assets.py")` 直接把闸门崩掉，而不是报"读不到"）。"""
    try:
        return read(rel)
    except OSError:
        return None


def boot_names(text):
    """boot 链用到的资产名（含 CORE/HELP/PKG 那种变量间接）。
    ⚠️ 两次搬迁的痕迹，别改回去：
      · 2026-09-26 C6：boot 链改走实例变量 `Assets.load(...)`（window.OctaveAssets 只是默认
        实例别名）⇒ 正则放宽为 `*.Assets.load(`；
      · 2026-09-26 A2：**清单搬进内核** `bridge/octave-core.js`（CORE_DLDFCN/HELP_ASSETS/
        PKG_ASSETS 三个数组），页面里再也没有 Assets.load 了 ⇒ 只扫 index.html 会得到
        **0 个名字**，而"0 个都合规"是**恒真**的 —— 闸门静默空转（实测踩到，本条就是修它）。
        所以两个文件都扫：内核（现在）+ 页面（万一将来又有人在页面里直接 load）。"""
    names = set()
    for m in re.finditer(r"(?:[A-Za-z_$][\w$]*\.)*Assets\.load\(\s*(\[[^\]]*\]|\w+)", text):
        arg = m.group(1)
        if arg.startswith("["):
            names.update(re.findall(r"'([^']+)'", arg))
        else:
            dm = re.search(r"(?:var\s+)?" + re.escape(arg) + r"\s*=\s*\[([^\]]*)\]", text, re.S)
            if dm:
                names.update(re.findall(r"'([^']+)'", dm.group(1)))
    # 内核里的三个常量数组（A2 之后这里是唯一真相源）
    for var in ("CORE_DLDFCN", "HELP_ASSETS", "PKG_ASSETS"):
        dm = re.search(r"var\s+" + var + r"\s*=\s*\[([^\]]*)\]", text, re.S)
        if dm:
            names.update(re.findall(r"'([^']+)'", dm.group(1)))
    return {n for n in names if n}


def main():
    global REPO
    REPO = gate_root()     # ★ F1：`GATE_REPO` 可覆盖 ⇒ 自证能在空夹具树上跑
    problems, notes = [], []

    def guard(what, detail=""):
        """★ 零值守卫（F1）：**收集到 0 项不是通过，是没查**。
        实测教训：启动清单那条一度匹配 0 个名字，而"0 个都合规"恒真 ⇒ 闸门静默空转。"""
        problems.append((what + "：**收集到 0 项 ⇒ 闸门静默空转**", detail))

    # ── 1) 挂载根 ────────────────────────────────────────────────────────────
    py_root = (re.search(r'^OCTAVE_M\s*=\s*"([^"]+)"', read_or_none("build/assets.py") or "", re.M) or [None, None])[1]
    js_root = (re.search(r"OCTAVE_M\s*=\s*'([^']+)'", read_or_none("bridge/assets-loader.js") or "") or [None, None])[1]
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
    boot = set()
    for _src in ("bridge/octave-core.js", "bridge/index.html"):     # A2：清单在内核里
        try:
            boot |= boot_names(read(_src))
        except OSError:
            problems.append((f"{_src} 读不到", "boot 链的资产清单没地方核对了"))
    man = os.path.join(SITE, "assets", "manifest.json")
    if not os.path.exists(man):
        notes.append(f"启动清单核对**跳过**（读不到 {man}）")
    else:
        names = {a.get("name") for a in json.load(open(man, encoding="utf-8")).get("assets", [])}
        if not boot:
            guard("启动清单（boot 链装的资产名）",
                  "正则/文件结构变了？这条恒真时闸门等于没有")
        missing = sorted(n for n in boot if n not in names)
        if missing:
            problems.append(("boot 链装的名字不在清单里", ", ".join(missing)))
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
        bad = []; seen = 0
        for fn in sorted(os.listdir(mdir)):
            if not fn.endswith(".js"):
                continue
            name = fn[:-3]
            txt = open(os.path.join(mdir, fn), encoding="utf-8", errors="replace").read()
            m = re.search(r"addpath:\s*(\[[^\]]*\])", txt)
            if not m:
                continue
            seen += 1
            want = meta.get(name, {}).get("mount") or f"{py_root or '/usr/src/octave/m'}/{name}"
            got = json.loads(m.group(1))[0] if json.loads(m.group(1)) else None
            if got != want:
                bad.append(f"{name}: 部署是 {got}，声明是 {want}")
        if seen == 0:
            guard("assets/m/*.js 里带 addpath 的文件",
                  "一个都没匹配到 ⇒ 挂载点这条根本没查")
        elif bad:
            problems.append(("资产挂载点与声明不符", "; ".join(bad[:4])))
        else:
            notes.append(f"assets/m/ 里 {seen} 个包的挂载点与 assets-meta.json 声明一致")

    # ── 3) 11.3.0 车道里没有 7.2 路径 ─────────────────────────────────────────
    hits = []; scanned = 0
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
            scanned += 1
            for i, line in enumerate(txt.split("\n"), 1):
                if SEVEN_TWO.search(line):
                    hits.append(f"{os.path.relpath(f, REPO)}:{i}")
    if scanned == 0:
        guard("11.3.0 车道的文件", "一个文件都没扫到（目录改名了？）⇒ 这条根本没查")
    elif hits:
        problems.append(("11.3.0 车道里出现 /7.2.0/ 路径", ", ".join(hits[:5])))
    else:
        notes.append(f"11.3.0 车道里扫了 {scanned} 个文件，没有 /7.2.0/ 路径")

    # ── 4. 页面引用的本地文件必须在 git 里（2026-09-26 A2）────────────────────
    # ⚠️ 同一类 bug 犯过三次：p5canvas.js（09-23）、octave-worker.js（09-26 A0）、
    #    octave-core.js（A2）—— 都是"磁盘上有、部署能跑、**唯独不在 git 里**"
    #    ⇒ 新克隆/断电恢复必坏。而 check-whitelist.py 只看**已暂存**的文件，看不见被忽略的。
    #    这条从"页面依赖"这一侧反查，堵住整类。
    tracked = set()
    try:
        tracked = {l.strip() for l in subprocess.run(
            ["git", "-C", REPO, "ls-files"], stdout=subprocess.PIPE, text=True,
            check=False).stdout.splitlines() if l.strip()}
    except OSError:
        notes.append("git ls-files 取不到 ⇒ 跳过『页面引用必须入库』检查")
    if tracked:
        dangling = []; nrefs = 0
        targets = (("bridge/index.html", "html"), ("bridge/octave-worker.js", "js"))
        for rel, kind in targets:
            try:
                txt = read(rel)
            except OSError:
                continue
            refs = []
            if kind == "html":
                refs = re.findall(r'<script[^>]+src="([^"]+)"', txt)
            else:
                for grp in re.findall(r"importScripts\(([^)]*)\)", txt):
                    refs += [x.strip().strip("'\"") for x in grp.split(",")]
            for r in refs:
                if not r or r.startswith(("http:", "https:", "//", "data:")):
                    continue
                nrefs += 1
                # 引用是**相对页面**的 ⇒ 要按页面所在目录解析（bridge/xxx）
                resolved = os.path.normpath(os.path.join(os.path.dirname(rel), r))
                # 构建产物豁免：`octave.js/.wasm/.data` 由 link-web.sh 产出，**故意不在
                # bridge/**（它们住在 site/ 与容器里）—— 本检查只管**手写的**页面依赖。
                if os.path.basename(resolved) in ("octave.js", "octave.wasm", "octave.data"):
                    continue
                if resolved not in tracked:
                    dangling.append(f"{rel} → {r}（应为 {resolved}）")
        if nrefs == 0:
            guard("页面引用的本地文件（script src + importScripts）",
                  "一个引用都没抓到 ⇒ 这条根本没查")
        elif dangling:
            problems.append(("页面引用的文件不在 git 里", "; ".join(sorted(set(dangling))[:6])))
        else:
            notes.append("页面引用的本地文件都在 git 里（%d 个引用）" % nrefs)

    # ── 5. CONTEXT.md 的"证据行"必须指向**存在**的仓库路径（2026-09-26 A4）──────
    # 为什么单列：术语表最容易退化成散文("大家都知道")。约定每条术语挂一行 `证据：`，
    # 里面写仓库路径/命令；这条检查把"路径存在"变成硬要求（写不出证据的术语 ⇒ 不该在这里）。
    try:
        ctx = read("CONTEXT.md")
    except OSError:
        notes.append("没有 CONTEXT.md ⇒ 跳过『术语证据行』检查")
    else:
        bad_ev = []; nev = 0
        for line in ctx.split("\n"):
            if "证据：" not in line:
                continue
            nev += 1
            for tok in re.findall(r"`([^`]+)`", line):
                tok = tok.strip()
                if not tok or " " in tok or "/" not in tok:
                    continue                      # 命令/单名不算路径
                if tok.startswith(("http", "-", "!")):
                    continue
                if not os.path.exists(os.path.join(REPO, tok)):
                    bad_ev.append(tok)
        if nev == 0:
            guard("CONTEXT.md 的 `证据：` 行", "一行都没有 ⇒ 术语表退化成散文，这条根本没查")
        elif bad_ev:
            problems.append(("CONTEXT.md 的证据行指向不存在的路径", ", ".join(sorted(set(bad_ev))[:6])))
        else:
            notes.append("CONTEXT.md 的 %d 条证据行全部指向存在的仓库路径" % nev)

    for n in notes:
        print(f"  · {n}")
    if problems:
        print("★ 一致性检查不通过：", file=sys.stderr)
        for what, detail in problems:
            print(f"  [{what}] {detail}", file=sys.stderr)
        return 0 if "--list" in sys.argv else 1
    print("资产/挂载路径一致性：OK")
    return 0


# ── 自证（F1）───────────────────────────────────────────────────────────────
# 判据：**把闸门指向一棵几乎空的夹具树，它必须报**（而不是"没东西可查"就绿）。
# 这条一次性覆盖上面全部零值守卫 —— 任何一个被撤掉，这里就会少报一处。
FIXTURE = {
    "CONTEXT.md": "# 术语表（故意一条 `证据：` 行都没有）\n",
    "bridge/index.html": "<script src=\"a.js\"></script>\n",
    "bridge/octave-worker.js": "importScripts('b.js');\n",
    "build/113/keep.txt": "",
}


def _empty_tree_rc():
    d = fixture(FIXTURE)
    old = os.environ.get("GATE_REPO")
    os.environ["GATE_REPO"] = d
    try:
        return run_quiet(main)
    finally:
        if old is None:
            os.environ.pop("GATE_REPO", None)
        else:
            os.environ["GATE_REPO"] = old
        cleanup(d)


CASES = [
    ("真仓库 ⇒ 通过（不是恒红）", lambda: run_quiet(main) == 0),
    ("★ 空夹具树 ⇒ **必须红**（零值守卫全体生效）", lambda: _empty_tree_rc() != 0),
]


if __name__ == "__main__":
    sys.exit(selftest("check-consistency", CASES) if "--selftest" in sys.argv else main())
