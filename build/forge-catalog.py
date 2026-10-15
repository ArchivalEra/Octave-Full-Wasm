#!/usr/bin/env python3
# Octave-Full-Wasm — **Forge 站点货架装配**（设计稿 build/113/NOTES-forge-ondemand.md）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# ── 为什么有它 ───────────────────────────────────────────────────────────────
# 客户端要"按需拉包"，需要两样东西在**站点上、且同源**（COI 的 COEP 会拦跨域 fetch）：
#   ① 包字节：`<站点>/assets/forge/<name>-<ver>.tar.gz`
#   ② 目录：  `<站点>/assets/forge-catalog.json`（客户端读它，**不下载任何东西**）
#
# 本脚本把**货架仓**（`shelf/`，submodule）翻译成 ①+②：
#   · 版本按 **fork 的 Octave 版本**过滤（从 `upstream/octave/configure.ac` 的 AC_INIT 读，
#     **不手写**——升 Octave 时这件事自动跟上，这正是"与 fork 管线贴合"的落点）；
#   · 字节从**本地缓存**取（持久盘 `third_party/forge/`，由 shelf 的 --fetch 填），
#     拷进站点并**逐字节核 sha256**（fail-closed）；
#   · `verified` 为空的包**默认不上架**（"只上我方验证过能装的"，用户裁定）。
#
# 用法（从仓库根）：
#   python3 build/forge-catalog.py --site <站点目录> [--octave-from-fork] [--allow-unverified]
#   python3 build/forge-catalog.py --site <站点目录> --check     # 只校验（不写）
#   python3 build/forge-catalog.py --selftest
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHELF = os.path.join(REPO, "shelf")
SHELF_PKGS = os.path.join(SHELF, "packages")
CACHE = os.environ.get("FORGE_CACHE", "/mnt/hdd/octave-wasm-build/third_party/forge")
CONF_AC = os.path.join(REPO, "upstream", "octave", "configure.ac")

sys.path.insert(0, SHELF)
sys.path.insert(0, os.path.join(SHELF, "tools"))


def octave_from_fork():
    """从 fork 的 configure.ac 读 Octave 版本（AC_INIT([GNU Octave], [X.Y.Z], …)）。"""
    try:
        with open(CONF_AC, encoding="utf-8", errors="replace") as fh:
            txt = fh.read()
    except OSError:
        return None
    m = re.search(r"AC_INIT\s*\(\s*\[[^\]]*\]\s*,\s*\[([0-9][0-9.]*)\]", txt)
    return m.group(1) if m else None


def sha256_file(path, chunk=1 << 20):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for b in iter(lambda: fh.read(chunk), b""):
            h.update(b)
    return h.hexdigest()


def vtuple(s):
    return tuple(int(x) for x in re.findall(r"\d+", str(s))[:3]) or (0,)


def octave_ok(need, requires):
    for r in requires or []:
        m = re.match(r"octave\s*\(\s*(>=|<=|==|>|<)\s*([\d.]+)\s*\)", r.strip())
        if not m:
            continue
        op, ver = m.group(1), vtuple(m.group(2))
        a = vtuple(need)
        if not {">=": a >= ver, "<=": a <= ver, "==": a == ver,
                ">": a > ver, "<": a < ver}[op]:
            return False
    return True


def pick_version(entry, octave):
    ok = [v for v in entry.get("versions", []) if octave_ok(octave, v.get("requires"))]
    if not ok:
        return None
    ok.sort(key=lambda v: vtuple(v["version"]), reverse=True)
    return ok[0]


def load_shelf(pkg_dir=None):
    d = pkg_dir if pkg_dir is not None else SHELF_PKGS
    out = {}
    try:
        names = sorted(os.listdir(d))
    except OSError:
        return out
    for n in names:
        if not n.endswith(".json"):
            continue
        try:
            with open(os.path.join(d, n), encoding="utf-8") as fh:
                e = json.load(fh)
        except (OSError, ValueError):
            continue
        if isinstance(e, dict) and e.get("name"):
            out[e["name"]] = e
    return out


def derive_form(kinds):
    """投送形态（接缝 §2 / 端口 schema 2）。

    ⚠️ **口径与内容仓 `tools/forge-shelf.py` 的 `derive_form` 一致**（同一规则的唯一产地
    是端口 schema 的 enum；这里实现的是"本仓只产一种形态"的派生）：
    货架包 = **一个 tarball 整包投送** ⇒ 恒 `pkg`；`tree`/`oct`/`octdir`/`file`/`js`
    是能力层 / 编译件 / 单文件的形态，由各自的生产者出，**不是货架装配的活**。
    纯函数（自证直接喂它）。"""
    return "pkg"


def derive_axes(kinds):
    """(form, content) —— 端口 schema 2 的两轴；`content` = 旧的 `kinds`。"""
    return derive_form(kinds), list(kinds or [])


def resolve(shelf, octave, allow_unverified, cache=None):
    """货架 → 上架清单。返回 (packs, skipped)。**纯函数**（自证直接喂它）。"""
    cache = cache if cache is not None else CACHE
    packs, skipped = [], []
    for name in sorted(shelf):
        e = shelf[name]
        if not e.get("verified") and not allow_unverified:
            skipped.append("%s（未验证）" % name)
            continue
        v = pick_version(e, octave)
        if not v:
            skipped.append("%s（无兼容 Octave %s 的版本）" % (name, octave))
            continue
        src = os.path.join(cache, "%s-%s.tar.gz" % (name, v["version"]))
        packs.append({
            "name": name,
            "version": v["version"],
            "size": v.get("size") or (os.path.getsize(src) if os.path.isfile(src) else 0),
            "sha256": v["sha256"],
            "url": "assets/forge/%s-%s.tar.gz" % (name, v["version"]),  # **同源相对路径**
            "upstream_url": v.get("url", ""),
            "deps": e.get("depends") or [],
            # 端口 schema 2 两轴（接缝 §2）：`form`/`content` 从字节/kinds **派生**；
            # `kinds` **保留为兼容视图**（旧 loader 与旧套件照读 —— 判据：不改它们也全绿）。
            "form": derive_form(v.get("kinds") or []),
            "content": list(v.get("kinds") or []),
            "kinds": v.get("kinds") or [],
            "_src": src,                      # 装配时用（不进 catalog）
        })
    return packs, skipped


def assemble(packs, site, check_only=False):
    """把 tarball 拷进站点 + 写 catalog + **逐字节核 sha**。返回问题数。"""
    dest_dir = os.path.join(site, "assets", "forge")
    bad = []
    if not check_only:
        os.makedirs(dest_dir, exist_ok=True)
    for p in packs:
        src = p["_src"]
        dst = os.path.join(dest_dir, os.path.basename(p["url"]))
        if not os.path.isfile(src):
            bad.append("%s：本地缓存没有 %s（先跑 shelf 的 --fetch）" % (p["name"], src))
            continue
        got = sha256_file(src)
        if got != p["sha256"]:
            bad.append("%s：缓存字节与档案 sha 不符（%s… vs %s…）"
                       % (p["name"], got[:12], p["sha256"][:12]))
            continue
        if check_only:
            if not os.path.isfile(dst):
                bad.append("%s：站点上没有 %s（未装配）" % (p["name"], os.path.basename(dst)))
            elif sha256_file(dst) != p["sha256"]:
                bad.append("%s：站点件与档案 sha 不符" % p["name"])
            continue
        if not os.path.isfile(dst) or sha256_file(dst) != p["sha256"]:
            shutil.copy2(src, dst)
        # 拷完再核一次（fail-closed：写盘也可能出问题）
        if sha256_file(dst) != p["sha256"]:
            bad.append("%s：装配后 sha 不符（写盘坏了？）" % p["name"])
    return bad


def capability_entries(site):
    """**能力层条目**（接缝 §2/§5④）：`form:"tree"` 的普通条目，进同一张 `deps` 图。

    ⚠️ 为什么由**装配器**产出而不是内容仓：能力层 ≠ 某个包（它是多个包共用的运行时），
    所以它不出在货架档案里；而"站点上有没有这份字节"是**装配事实**（同源托管）⇒
    装配器按 `upstream-lock.json` + 站点实际存在性产出条目。
    ⚠️ **不加 `needs` 新字段**（§2 判决）：`symbolic` 靠 `deps` 边指向本条目。

    返回 (entries, problems)。**纯读**（不写盘）—— 字节由 `provision-pyodide.sh` 供。
    """
    entries, problems = [], []
    # 目前唯一的能力层 = Pyodide（符号计算用；未来 clang 工具链走同一条）
    py_root = os.path.join(site, "assets", "pyodide")
    py_wasm = os.path.join(py_root, "pyodide", "pyodide.asm.wasm")
    if not os.path.isdir(py_root):
        problems.append("能力层缺失：assets/pyodide/ 不在站点（跑 build/113/provision-pyodide.sh fetch）")
        return entries, problems
    if not os.path.isfile(py_wasm):
        problems.append("能力层残缺：assets/pyodide/pyodide/pyodide.asm.wasm 不在")
        return entries, problems
    # 字节规模（进度/预算用；不手抄 —— 数出来）
    total = 0
    for base, _dirs, files in os.walk(py_root):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(base, f))
            except OSError:
                pass
    entries.append({
        "name": "pyodide",
        "version": "314.0.7",
        "form": "tree",
        "content": [],                       # 裁决①：能力层留空（content 只对包有意义）
        "consumer": ["octave"],              # 裁决②：消费面
        "sha256": _file_sha_or_empty(py_wasm),
        "url": "assets/pyodide/pyodide/pyodide.asm.wasm",
        "size": total,
        "deps": [],
        "note": "共享能力层（符号计算等需要真 Python 的包靠 deps 边指向它）；"
                "字节由 build/113/provision-pyodide.sh 供给，sha 见 upstream-lock.json + 该脚本",
    })
    return entries, problems


def load_upstream_table(path, validate=None):
    """读**生产者出的表**（接缝 §4 消费侧）；先校验，不合格 ⇒ **拒收**（fail-closed）。

    ⚠️ 为什么拒收而不是"尽力修"：端口纪律 = 生产者自证（§4 必做第 2 条）。宿主替他修
    ⇒ 两个产地各写一半、谁也说不清哪份对（本仓 doctrine：没有对账器的"必须一致"迟早不一致）。
    `validate` 注入校验器（自证时喂假的），返回 (entries, problems)。
    """
    problems = []
    if not os.path.isfile(path):
        return [], ["上游表不存在：%s" % path]
    try:
        doc = json.load(open(path, encoding="utf-8"))
    except (OSError, ValueError) as e:
        return [], ["上游表读不了/不是 JSON：%r" % e]
    if validate is not None:
        probs = validate(doc)
        if probs:
            return [], ["上游表未过端口校验（%s）：%d 条 —— 生产者要按 schema 2 修"
                        % (os.path.basename(path), len(probs))] + ["  · %s" % x for x in probs[:3]]
    ents = doc.get("entries") or doc.get("packs") or []
    if not ents:
        return [], ["上游表是空的（零值守卫：空表不是通过）"]
    # 转成站点条目：① **保留生产者给的一切**（含 form/content/consumer，不替他改）
    #   ② `url` 按站点前缀改写（生产者的表用站内相对路径，与宿主同源约定一致）
    out = []
    for e in ents:
        d = {k: v for k, v in e.items()}
        d.setdefault("deps", [])
        out.append(d)
    return out, problems


def _port_validate(doc):
    """端口校验（**复用产地的校验器，不另写一份** —— 见 build/extra-content/）。"""
    try:
        import importlib.util as _iu
        vp = os.path.join(REPO, "build", "extra-content", "validate-content-list.py")
        spec = _iu.spec_from_file_location("_vcl", vp)
        mod = _iu.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod.check_table(doc)
    except Exception as e:                                  # 校验器不可用 ⇒ fail-closed
        return ["端口校验器不可用：%r（不拿'没查'当通过）" % e]


def _file_sha_or_empty(path):
    """读 sha；读不到 ⇒ 空串（**不编** —— 采集器原则：读不到就明说）。"""
    try:
        return sha256_file(path)
    except OSError:
        return ""


def shelf_commit():
    """货架仓的 commit（= "目录来自哪一版货架"）——pin 的承载者，写进 catalog 供见证。"""
    try:
        out = subprocess.run(["git", "-C", SHELF, "rev-parse", "HEAD"],
                             capture_output=True, text=True, timeout=20)
        return out.stdout.strip() if out.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def catalog_doc(packs, octave, gen, entries_extra=None):
    extra = list(entries_extra or [])
    for p in packs:
        # ★ 接缝 §2 的落法（2026-10-14）：**不加 `needs` 字段**；`symbolic` 这类
        #   "纯 .m 但要 Python" 的包，靠 deps 边指向能力层条目（`form:"tree"`）。
        if p["name"] == "symbolic" and any(e["name"] == "pyodide" for e in extra):
            if "pyodide" not in p["deps"]:
                p["deps"] = list(p["deps"]) + ["pyodide"]
    return {
        "schema": 2,          # 接缝 §2：schema 2 加 form/content 两轴（kinds 留作兼容视图）
        "octave": octave,
        "generated_by": gen,
        "shelf_commit": shelf_commit(),
        "note": "Forge 按需拉取目录（客户端读它，不下载包字节）。字节在同源 assets/forge/。",
        # ★ 能力层条目（form:"tree"）与包**同一张 packs 表**（接缝 §2：进同一张图）。
        #  ⚠️ 客户端按 `packs` 遍历（老 loader 亦然）⇒ 能力层必须在**这里**，
        #     否则 `install('symbolic')` 的闭包走到 pyodide 时会"查无此包"。
        "packs": [{k: v for k, v in p.items() if not k.startswith("_")}
                  for p in sorted(list(packs) + extra, key=lambda x: x["name"])],
    }


def write_catalog(site, doc, check_only=False):
    out = os.path.join(site, "assets", "forge-catalog.json")
    body = json.dumps(doc, indent=1, ensure_ascii=False) + "\n"
    if check_only:
        try:
            with open(out, encoding="utf-8") as fh:
                cur = fh.read()
        except OSError:
            return ["站点上没有 forge-catalog.json（未装配）"]
        return [] if cur == body else ["forge-catalog.json 与现算不一致（跑一次不带 --check 的）"]
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(body)
    return []


# ── 三档自证 ────────────────────────────────────────────────────────────────
def _selftest():
    import tempfile
    cases = []

    def mk_shelf(**kw):
        e = {"name": "demo", "depends": [], "verified": {"octave": "11.3.0"},
             "versions": [{"version": "1.0.0", "sha256": "a" * 64, "size": 10,
                           "url": "http://x", "requires": ["octave (>= 4.0.0)"],
                           "kinds": ["m"]}]}
        e.update(kw)
        return {"demo": e}

    # ① 正常不报
    cases.append(("resolve：已验证 + 兼容 ⇒ 上架，url 是**同源相对路径**",
                  lambda: (lambda r: len(r[0]) == 1 and r[0][0]["url"].startswith("assets/forge/")
                           and not r[1])(resolve(mk_shelf(), "11.3.0", False, "/nonexistent"))))
    cases.append(("octave_from_fork：读得到版本串（真仓）",
                  lambda: bool(re.match(r"^\d+\.\d+", octave_from_fork() or ""))))
    cases.append(("★ 派生：form 恒 pkg、content = kinds（端口 schema 2 两轴）",
                  lambda: (lambda p: p["form"] == "pkg" and p["content"] == ["m"]
                           and p["kinds"] == ["m"])(
                      resolve(mk_shelf(), "11.3.0", False, "/nonexistent")[0][0])))
    cases.append(("★ 兼容视图：kinds 与 content 同值（旧 loader 照读）",
                  lambda: (lambda p: p["kinds"] == p["content"])(
                      resolve(mk_shelf(versions=[{"version": "1.0.0", "sha256": "a" * 64,
                                                  "size": 1, "url": "http://x",
                                                  "requires": [], "kinds": ["m", "src"]}]),
                              "11.3.0", False, "/nonexistent")[0][0])))
    cases.append(("★ 能力层：symbolic 的 deps 边指向 form:tree 的 pyodide（§2 落法）",
                  lambda: (lambda doc: (lambda sy: sy and "pyodide" in sy["deps"])(
                      [p for p in doc["packs"] if p["name"] == "symbolic"][0])
                   if any(p["name"] == "symbolic" for p in doc["packs"]) else True)(
                      catalog_doc([{"name": "symbolic", "deps": [], "version": "1",
                                    "sha256": "a" * 64, "size": 1,
                                    "url": "assets/forge/symbolic-1.tar.gz",
                                    "form": "pkg", "content": ["m"], "kinds": ["m"], "_src": ""}],
                                  "11.3.0", "self-test",
                                  entries_extra=[{"name": "pyodide", "form": "tree",
                                                  "content": [], "deps": []}]))))
    cases.append(("★ 能力层：无能力层条目时 symbolic 的 deps **不被改**（不臆造边）",
                  lambda: (lambda doc: [p for p in doc["packs"]
                                        if p["name"] == "symbolic"][0]["deps"] == [])(
                      catalog_doc([{"name": "symbolic", "deps": [], "version": "1",
                                    "sha256": "a" * 64, "size": 1,
                                    "url": "assets/forge/symbolic-1.tar.gz",
                                    "form": "pkg", "content": ["m"], "kinds": ["m"], "_src": ""}],
                                  "11.3.0", "self-test", entries_extra=[]))))
    cases.append(("pick_version：挑满足约束的最新",
                  lambda: pick_version({"versions": [
                      {"version": "1.0.0", "requires": []},
                      {"version": "2.0.0", "requires": ["octave (>= 99)"]}]}, "11.3.0")["version"] == "1.0.0"))

    # ② 该报的必须报
    cases.append(("★ resolve：未验证的包默认**不上架**（只上验证过的）",
                  lambda: (lambda r: len(r[0]) == 0 and len(r[1]) == 1)(
                      resolve(mk_shelf(verified=None), "11.3.0", False, "/x"))))
    cases.append(("★ resolve：--allow-unverified 才带上它",
                  lambda: len(resolve(mk_shelf(verified=None), "11.3.0", True, "/x")[0]) == 1))
    cases.append(("★ resolve：Octave 版本不满足 ⇒ 不上架且**说明原因**",
                  lambda: (lambda r: len(r[0]) == 0 and "兼容" in r[1][0])(
                      resolve(mk_shelf(versions=[{"version": "9", "sha256": "b" * 64,
                                                  "requires": ["octave (>= 99)"],
                                                  "url": "http://x"}]),
                              "11.3.0", False, "/x"))))
    cases.append(("★ assemble：缓存缺文件 ⇒ 报（不是静默）",
                  lambda: len(assemble(resolve(mk_shelf(), "11.3.0", False,
                                               "/definitely-missing-9d3f")[0],
                                       tempfile.mkdtemp(), True)) == 1))
    cases.append(("★ assemble：字节与档案 sha 不符 ⇒ 报（fail-closed）",
                  lambda: (lambda d: (open(os.path.join(d, "demo-1.0.0.tar.gz"), "wb").write(b"x"),
                                      len(assemble([{"name": "demo", "version": "1.0.0",
                                                     "sha256": "a" * 64, "size": 1,
                                                     "url": "assets/forge/demo-1.0.0.tar.gz",
                                                     "_src": os.path.join(d, "demo-1.0.0.tar.gz")}],
                                                   tempfile.mkdtemp(), False)) == 1)[1])(tempfile.mkdtemp())))
    cases.append(("★ write_catalog --check：站点上没 catalog ⇒ 报",
                  lambda: len(write_catalog(tempfile.mkdtemp(), {"schema": 1}, True)) == 1))

    # ③ 空输入必须报
    cases.append(("★ resolve：空货架 ⇒ 上架清单为空（调用方按零值守卫报）",
                  lambda: resolve({}, "11.3.0", False, "/x") == ([], [])))

    bad = 0
    for label, fn in cases:
        try:
            ok = bool(fn())
        except Exception as e:                                  # noqa: BLE001
            ok, label = False, "%s（异常 %r）" % (label, e)
        print("%s | %s" % ("PASS" if ok else "fail", label))
        bad += 0 if ok else 1
    print("=== forge-catalog 自证：%d PASS / %d fail ===" % (len(cases) - bad, bad))
    print("=== %d PASS / %d FAIL ===" % (len(cases) - bad, bad))
    return 1 if bad else 0


def main(argv):
    if "--selftest" in argv:
        return _selftest()
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--site", required=True)
    ap.add_argument("--octave", default="")
    ap.add_argument("--allow-unverified", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--upstream", action="append", default=[],
                    help="生产者出的表（可多次）；经端口校验后并入 catalog")
    a = ap.parse_args(argv)

    octave = a.octave or octave_from_fork()
    if not octave:
        print("FATAL: 读不到 Octave 版本（upstream/octave/configure.ac 不在？）——"
              "用 --octave 显式给。", file=sys.stderr)
        return 2
    shelf = load_shelf()
    if not shelf:
        print("FATAL: 货架是空的（shelf/packages/ 一个档案都没有）——"
              "空输入不是通过：先 git submodule update --init shelf", file=sys.stderr)
        return 2
    packs, skipped = resolve(shelf, octave, a.allow_unverified)
    if not packs:
        print("FATAL: 解析出 0 个可上架的包（跳过：%s）——空上架清单不是通过"
              % "; ".join(skipped), file=sys.stderr)
        return 2
    bad = assemble(packs, a.site, a.check)
    # 接缝 §5④：能力层条目（form:"tree"）—— 缺字节**不是致命**（站点可能没供 Pyodide，
    #   那只是"能力层缺席"，包本身仍可装）⇒ 报为 **note**，不进 `bad`（fail-closed 的边界：
    #   致命的只有"包字节与档案不符"）。
    cap, cap_problems = capability_entries(a.site)
    # ★ 接缝 §5⑤：生产者出的表（如 LLVM-wasm 的工具链）—— 校验通过才并入（fail-closed）
    for up in a.upstream:
        yents, yprobs = load_upstream_table(up, validate=_port_validate)
        if yprobs:
            # ⚠️ 不合格 = **明说并跳过**（不是静默收，也不是致命退出：站点仍要能装包）
            for x in yprobs:
                print("  warn: %s" % x, file=sys.stderr)
        else:
            cap.extend(yents)
            print("  上游表并入 %d 条：%s" % (len(yents), up))
    doc = catalog_doc(packs, octave, "build/forge-catalog.py", entries_extra=cap)
    bad += write_catalog(a.site, doc, a.check)
    for c in cap_problems:
        print("  note: %s" % c, file=sys.stderr)
    if bad:
        print("FATAL: %d 个问题：" % len(bad), file=sys.stderr)
        for b in bad:
            print("  · %s" % b, file=sys.stderr)
        return 1
    verb = "校验" if a.check else "装配"
    print("%s完成：%d 个包上架（Octave %s）" % (verb, len(packs), octave))
    if skipped:
        print("  跳过 %d 个：%s" % (len(skipped), "; ".join(skipped)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
