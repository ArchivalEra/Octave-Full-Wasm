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



def derive_arch(tar_path, kinds=None):
    """从**包内实际带的 `.oct`** 派生目标架构（裁决 2026-10-16「楚河汉界」）。

    ⚠️ **为什么不看目录名/kinds 推**：本仓实测过「判别看包内实际带什么、不能看目录名推」
    （NOTES-forge-ondemand §分叉：`src/` ⇒ 当"需编译"是误判）。⇒ 拆开 tarball、逐个读
    `.oct` 的 `dylink.0` TARGET_FEATURES（`build/113/oct-arch.py` 同一判据）。
    返回 (arch, problems)：
      · 包内**没有** `.oct` ⇒ ("", [])（无架构概念 —— 纯 .m 包，schema 明说**不带** arch 字段）
      · 有 `.oct` 且**全部同架构** ⇒ (该架构, [])
      · 有 `.oct` 但架构**混杂**或读不出 ⇒ ("", [问题…])（fail-closed：不许猜一个值）
    """
    import tarfile
    import io as _io
    ar = None
    n_oct = 0                      # ★ 见到几个 `.oct`（N2 守卫用）
    problems = []
    try:
        tf = tarfile.open(tar_path, "r:gz")
    except (OSError, tarfile.TarError) as e:
        return "", ["读不了 tarball：%r" % (e,)]
    with tf:
        for m in tf.getmembers():
            if not (m.isfile() and m.name.endswith(".oct")):
                continue
            n_oct += 1
            try:
                fh = tf.extractfile(m)
                data = fh.read() if fh else b""
            except (OSError, KeyError) as e:
                problems.append("%s 读不出：%r" % (m.name, e))
                continue
            sys.path.insert(0, os.path.join(REPO, "build", "113"))
            from oct_arch_probe import arch_of_bytes as _aob      # 见下：薄包装，避免 import 名带横线
            a = _aob(data)
            if a == "unknown":
                problems.append("%s 的架构读不出（不是 side module？）" % m.name)
                continue
            if ar is None:
                ar = a
            elif ar != a:
                problems.append("包内 .oct 架构**混杂**：%s 是 %s，先前是 %s（不许猜一个值）"
                                % (m.name, a, ar))
    # ★ **N2 守卫**（2026-10-16，design-it-twice 的 ④ 方案发现）：调用方按 `kinds` 里的
    #   `oct` 声明**要求**我们给出架构；若声明说含 oct 而字节里**一个都没有**，此前会返回
    #   `("", [])`（问题清单空）⇒ 守卫不触发 ⇒ **空串被写进目录**（实测活体：
    #   `statistics 1.7.3` 就是这种声明，而真字节 0 个 `.oct`）。
    #   ⇒ 现在必须明说：声明与字节矛盾（判据同 R4：看字节，不看主张）。
    if (kinds and "oct" in kinds) and n_oct == 0:
        problems.append("声明含 `oct` 但包内**一个 `.oct` 都没有**（%d 个文件看过）"
                        "⇒ 声明与字节矛盾，不许写一个猜的架构" % len(list(_all_names(tar_path))))
    return (ar or "", problems)


def _all_names(tar_path):
    """tar 成员名（只为上面那条报错里的计数；读不到 ⇒ 空）。"""
    import tarfile
    try:
        with tarfile.open(tar_path, "r:gz") as tf:
            return [m.name for m in tf.getmembers()]
    except (OSError, tarfile.TarError):
        return []

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
        # 包内有没有 .oct（kinds 说 `oct` 时才去拆包 —— 拆包有成本，且纯 .m 包无架构概念）
        _kinds = v.get("kinds") or []
        need_arch = "oct" in _kinds
        arch_val, arch_problems = ("", [])
        if need_arch and os.path.isfile(src):
            arch_val, arch_problems = derive_arch(src, _kinds)
        elif need_arch:
            arch_problems = ["包字节不在本地缓存（%s）⇒ 派生不了架构" % src]
        # ★ versions[] 候选集（内容仓 mail/020 兑现 --emit 侧后的宿主侧消费）：
        #   货架档案的 `versions` 数组（全部**兼容本 Octave** 的版本）→ 站点态候选。
        #   staged 判定 = **该版字节真在站点**（装配态的事实：staged = "字节在这"，
        #   不是生产者态的"探过包"—— 同一版在它处已探、在我处未 stage ⇒ 站点态如实 withheld）。
        #   派生轴（form/content）逐候选从该版**自己的** kinds 派生（判据同条目级：
        #   看包内实际带什么）；arch 不在此处派生（含 oct 的候选需拆包，成本高 ——
        #   当前货架无含 oct 的包；等第一个真用例再加，如实留缺口）。
        _cands = []
        for _v2 in (e.get("versions") or []):
            if not octave_ok(octave, _v2.get("requires")):
                continue                       # 不兼容本 Octave 的版本不进候选集（与 pick_version 同判据）
            _vurl = "assets/forge/%s-%s.tar.gz" % (name, _v2["version"])
            _vsrc = os.path.join(cache, "%s-%s.tar.gz" % (name, _v2["version"]))
            _vk = _v2.get("kinds") or []
            if os.path.isfile(_vsrc):
                _cands.append({"version": _v2["version"], "sha256": _v2["sha256"],
                               "url": _vurl, "size": _v2.get("size") or 0,
                               "stage": "staged",
                               "form": derive_form(_vk), "content": list(_vk),
                               "upstream_url": _v2.get("url", "")})
            else:
                _cd = {"version": _v2["version"], "sha256": _v2["sha256"],
                       "stage": "withheld", "withheld_cause": "bytes-not-staged"}
                if _v2.get("requires"):
                    _cd["requires"] = list(_v2["requires"])
                _cands.append(_cd)
        packs.append({
            "name": name,
            "version": v["version"],
            "size": v.get("size") or (os.path.getsize(src) if os.path.isfile(src) else 0),
            "sha256": v["sha256"],
            "url": "assets/forge/%s-%s.tar.gz" % (name, v["version"]),  # **同源相对路径**
            "upstream_url": v.get("url", ""),
            "versions": _cands,
            "deps": e.get("depends") or [],
            # 端口 schema 2 两轴（接缝 §2）：`form`/`content` 从字节/kinds **派生**；
            # `kinds` **保留为兼容视图**（旧 loader 与旧套件照读 —— 判据：不改它们也全绿）。
            "form": derive_form(v.get("kinds") or []),
            "content": list(v.get("kinds") or []),
            "kinds": v.get("kinds") or [],
            "_src": src,                      # 装配时用（不进 catalog）
            "_arch_problems": arch_problems,  # 装配时汇总（不进 catalog）
        })
        # arch（裁决 2026-10-16）：**只在包内真带 `.oct` 时**派生并写入
        #   （纯 .m 包**不带**该字段 —— schema 明说无架构概念；校验器也拒"纯 .m 带 arch"）
        if need_arch:
            if arch_problems:
                skipped.append("%s（架构派生有问题：%s）" % (name, "; ".join(arch_problems[:2])))
                packs.pop()
                continue
            packs[-1]["arch"] = arch_val
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


def _common_dir_prefix(urls):
    """一组站内相对 url 的**公共目录前缀**（stage 映射用；如全是 assets/llvm-wasm/… ⇒ 该前缀）。"""
    dirs = [os.path.dirname(u) for u in urls if u]
    if not dirs:
        return ""
    try:
        return os.path.commonpath(dirs)
    except ValueError:
        return ""


def stage_upstream_bytes(site, entries, bytes_dir, check_only=False):
    """把**生产者表**引用的字节从本地目录 stage 进站点，逐件核 sha256（fail-closed）。

    ⚠️ **为什么必须 stage**（2026-10-15，回应内容仓 mail/009 待确认③ 的落地）：生产者的表用
    **站内相对 url** 指字节（如 `assets/llvm-wasm/clang.wasm`），而 COEP 拦跨域 ⇒ 字节必须
    **同源在站点上**。只并表不 stage ⇒ 目录指着 **404** —— 站点闸门 R7b 会拦
    （实测：并入 LLVM 13 条未 stage ⇒ 13 条 R7b 全红，见 `check-forge-catalog.py`）。

    映射：去掉所有 url 的**公共目录前缀**后，从 `bytes_dir` 找同名文件（保子目录）；
    前缀推断失败时退回 basename。返回问题清单（[] = 全部 stage 成功）。
    """
    problems = []
    if not entries:
        return problems
    prefix = _common_dir_prefix([e.get("url") or "" for e in entries])
    for e in entries:
        u = e.get("url") or ""
        if not u:
            problems.append("stage %s：条目没有 url（无从 stage）" % e.get("name"))
            continue
        tail = u[len(prefix):].lstrip("/") if prefix and u.startswith(prefix) else os.path.basename(u)
        src = os.path.join(bytes_dir, tail)
        if not os.path.isfile(src):
            alt = os.path.join(bytes_dir, os.path.basename(u))     # 退一步：按 basename 找
            if os.path.isfile(alt):
                src = alt
            else:
                problems.append("stage %s：bytes_dir 里找不到 %s（试过 %s）"
                                % (e.get("name"), tail, src))
                continue
        want = e.get("sha256")
        got = sha256_file(src)
        if want and got != want:
            problems.append("stage %s：字节 sha=%s ≠ 表 sha=%s（拒绝 stage）"
                            % (e.get("name"), got[:12], str(want)[:12]))
            continue
        dst = os.path.join(site, u)
        if check_only:
            if not os.path.isfile(dst) or sha256_file(dst) != (want or got):
                problems.append("stage %s：站点上没有 %s 或 sha 不符（未 stage）" % (e.get("name"), u))
            continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if not os.path.isfile(dst) or sha256_file(dst) != (want or got):
            shutil.copy2(src, dst)
        if sha256_file(dst) != (want or got):                      # 拷完再核一次（fail-closed）
            problems.append("stage %s：写盘后 sha 不符" % (e.get("name")))
    return problems


def shelf_commit():
    """货架仓的 commit（= "目录来自哪一版货架"）——pin 的承载者，写进 catalog 供见证。"""
    try:
        out = subprocess.run(["git", "-C", SHELF, "rev-parse", "HEAD"],
                             capture_output=True, text=True, timeout=20)
        return out.stdout.strip() if out.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""



def adapt_versions_for_site(entry, site, staged_check):
    """把生产者态的 `versions[]` 改成**站点态**（内容仓 mail/020 §④2 的"staged 语义对表"）。

    两段式（与条目级同款，mail/005 裁决）：
      · 生产者态的候选 `url` 是**上游绝对 URL**（重取入口）；
      · 站点态必须**同源相对**（COEP 拦跨域）⇒ 逐候选改写
        `assets/forge/<name>-<version>.tar.gz`。
    **staged 的重算（它 020 §④2 请裁决）**：装配态的 staged = **该版字节真被 stage 进站点**
    （`staged_check(site, url)`，与条目级 R3 同判据）——不是照抄生产者态的 staged。
    两种态**各自如实**（生产者态 staged = "探过包"；站点态 staged = "字节在这"）——
    同一版在它处已探、在我处未 stage ⇒ 站点态如实转 `withheld`（withheld_cause="bytes-not-staged"）。
    生产者态是 withheld 的**直接照抄**（它没探 ⇒ 我这边也没有它的派生轴，不许编）。
    **站点上没有该版字节却要写 staged ⇒ 是谎言** ⇒ 反向断言在 check-forge-catalog 候选化里。
    """
    vs = entry.get("versions")
    if not isinstance(vs, list) or not vs:
        return None                      # 没有 versions[] 的表（老表/货架路径）⇒ 不加键
    out = []
    for c in vs:
        d = {k: v for k, v in c.items()}
        ver = d.get("version")
        if not ver:
            continue
        local_url = "assets/forge/%s-%s.tar.gz" % (entry.get("name"), ver)
        if d.get("stage") == "staged":
            if staged_check(site, local_url):
                d["url"] = local_url          # 同源改写（重取入口留在 upstream_url 里，若生产者给了）
                d.setdefault("upstream_url", c.get("url", ""))
            else:
                d = {"version": ver, "sha256": d.get("sha256", ""),
                     "stage": "withheld", "withheld_cause": "bytes-not-staged"}
                if c.get("requires"):
                    d["requires"] = list(c["requires"])
        else:                                  # 生产者态 withheld ⇒ 照抄（不带派生轴）
            d.pop("form", None); d.pop("content", None); d.pop("arch", None)
            d.pop("url", None)                  # 生产者的绝对 URL 在 withheld 上没有意义（不可取）
        out.append(d)
    return out or None

def catalog_doc(packs, octave, gen, entries_extra=None, site=None):
    extra = list(entries_extra or [])
    # ★ 依赖边**全部来自数据**（接缝 §2 的落法，2026-10-15 内容仓 mail/011 起）：
    #   能力层需求由**生产者**在货架档案的 `depends` 里声明（如 `symbolic` 的
    #   `depends: ["pyodide"]`），`resolve()` 读它 ⇒ 这里**不再按包名硬编码**。
    #   ⚠️ 为什么删（实测教训）：旧代码 `if p["name"] == "symbolic" and …: p["deps"] += ["pyodide"]`
    #   是**按包名硬编码** —— 下一个"纯 .m 但要运行时"的包（`pythonic`）落地时得回来改代码，
    #   而"加内容 = 加一行数据、不改代码"正是本协议的全部意义（内容仓 mail/011）。
    #   ⚠️ 前置（内容仓 mail/012 认下）：边在**新 pin** 里才有，所以删硬编码必须与 bump
    #   `shelf/` pin **同批** —— 否则 `resolve()` 从旧 pin 读到空 `depends` ⇒ 静默断。
    # ★ versions[] 装配态（内容仓 mail/020 兑现 --emit 侧后）：条目级候选集透传进站点表，
    #   url 同源改写、staged 按**站点字节**重算（见 adapt_versions_for_site）。老表（无 versions）
    #   零影响 —— 键只在有候选集时出现（向后兼容）。
    if site is not None:
        for _p in list(packs) + extra:
            _vs = adapt_versions_for_site(_p, site,
                                          lambda s, u: os.path.isfile(os.path.join(s, u)))
            if _vs is not None:
                _p["versions"] = _vs
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
    # ★ 翻面（2026-10-15，内容仓 mail/011：删掉按包名硬编码的边）——
    #   旧用例断的是"硬编码造边"，行为变了 ⇒ 按纪律**改断言、不改检查器**：
    #   现在断的是"**来自货架档案的 `depends` 边流过** `catalog_doc()`"。
    cases.append(("★ 能力层的边来自货架档案的 `depends`（§2 落法：加内容=加数据，不改代码）",
                  lambda: (lambda doc: (lambda sy: sy and "pyodide" in sy["deps"])(
                      [p for p in doc["packs"] if p["name"] == "symbolic"][0])
                   if any(p["name"] == "symbolic" for p in doc["packs"]) else True)(
                      catalog_doc([{"name": "symbolic", "deps": ["pyodide"], "version": "1",
                                    "sha256": "a" * 64, "size": 1,
                                    "url": "assets/forge/symbolic-1.tar.gz",
                                    "form": "pkg", "content": ["m"], "kinds": ["m"], "_src": ""}],
                                  "11.3.0", "self-test",
                                  entries_extra=[{"name": "pyodide", "form": "tree",
                                                  "content": [], "deps": []}]))))
    cases.append(("★ 无 `depends` 时 deps 保持空 —— `catalog_doc()` 不臆造边",
                  lambda: (lambda doc: [p for p in doc["packs"]
                                        if p["name"] == "symbolic"][0]["deps"] == [])(
                      catalog_doc([{"name": "symbolic", "deps": [], "version": "1",
                                    "sha256": "a" * 64, "size": 1,
                                    "url": "assets/forge/symbolic-1.tar.gz",
                                    "form": "pkg", "content": ["m"], "kinds": ["m"], "_src": ""}],
                                  "11.3.0", "self-test", entries_extra=[]))))
    cases.append(("★ 翻面关键：**货架的 `depends` 流过 resolve()**（删硬编码后边仍到得了目录）",
                  lambda: (lambda p: p["deps"] == ["pyodide"])(
                      resolve(mk_shelf(depends=["pyodide"]), "11.3.0", False, "/nonexistent")[0][0])))
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

    # 上游表字节 stage（接缝 §5⑤ 收口；2026-10-15）—— 形状齐备：正常 / 该报 / 空输入
    import hashlib as _hl
    _bytes = b"LLVM-BLOB-CONTENT"
    _bsha = _hl.sha256(_bytes).hexdigest()

    def _stage_fixture(with_bytes=True, sha=None, url="assets/llvm-wasm/clang.wasm",
                       tail="clang.wasm"):
        bd = tempfile.mkdtemp()
        if with_bytes:
            os.makedirs(os.path.join(bd, os.path.dirname(tail)), exist_ok=True)
            open(os.path.join(bd, tail), "wb").write(_bytes)
        site = tempfile.mkdtemp()
        ent = [{"name": "llvm-clang", "version": "1", "form": "file",
                "url": url, "sha256": sha or _bsha}]
        return bd, site, ent

    def _stage_ok():
        bd, site, ent = _stage_fixture()
        probs = stage_upstream_bytes(site, ent, bd, check_only=False)
        dst = os.path.join(site, "assets/llvm-wasm/clang.wasm")
        return probs == [] and os.path.isfile(dst) and _hl.sha256(open(dst, "rb").read()).hexdigest() == _bsha
    cases.append(("stage：字节 stage 进站点 + sha 相符 ⇒ 无问题", _stage_ok))

    def _stage_missing():
        bd, site, ent = _stage_fixture(with_bytes=False)
        return len(stage_upstream_bytes(site, ent, bd, check_only=False)) == 1
    cases.append(("★ stage：bytes_dir 缺该文件 ⇒ 报", _stage_missing))

    def _stage_badsha():
        bd, site, ent = _stage_fixture(sha="f" * 64)
        return len(stage_upstream_bytes(site, ent, bd, check_only=False)) == 1
    cases.append(("★ stage：本地字节 sha ≠ 表 sha ⇒ 拒绝并报（fail-closed）", _stage_badsha))

    def _stage_checkonly():
        bd, site, ent = _stage_fixture()
        # check_only 且站点没 stage ⇒ 报（且**不写盘**）
        probs = stage_upstream_bytes(site, ent, bd, check_only=True)
        return len(probs) == 1 and not os.path.isfile(
            os.path.join(site, "assets/llvm-wasm/clang.wasm"))
    cases.append(("★ stage：--check 且站点未 stage ⇒ 报，且不写盘", _stage_checkonly))

    cases.append(("★ stage：空条目 ⇒ 无问题（零值不报错，由调用方 guard）",
                  lambda: stage_upstream_bytes(tempfile.mkdtemp(), [], tempfile.mkdtemp()) == []))

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
    ap.add_argument("--upstream-bytes", action="append", default=[],
                    help="该表的**字节本地目录**（与上一次 --upstream 配对）；给了就 stage 进站点")
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
    #   `--upstream-bytes <目录>`（可选，与 --upstream 配对应）：把表引用的字节 stage 进站点
    #   ⇒ 目录不指着 404（R7b）。缺字节目录 ⇒ 明说"未 stage"，不静默（站点闸门会拦）。
    bytes_dir = a.upstream_bytes[0] if a.upstream_bytes else None
    for up in a.upstream:
        yents, yprobs = load_upstream_table(up, validate=_port_validate)
        if yprobs:
            # ⚠️ 不合格 = **明说并跳过**（不是静默收，也不是致命退出：站点仍要能装包）
            for x in yprobs:
                print("  warn: %s" % x, file=sys.stderr)
        else:
            if bytes_dir:
                sb = stage_upstream_bytes(a.site, yents, bytes_dir, check_only=a.check)
                if sb:
                    bad += sb
                else:
                    print("  上游表 stage 字节 %d 件：%s" % (len(yents), bytes_dir))
            else:
                print("  note: 上游表并入 %d 条，**未给 --upstream-bytes ⇒ 未 stage 字节**"
                      "（站点闸门 R7b 会拦 404）；%s" % (len(yents), up), file=sys.stderr)
            cap.extend(yents)
            print("  上游表并入 %d 条：%s" % (len(yents), up))
    doc = catalog_doc(packs, octave, "build/forge-catalog.py", entries_extra=cap, site=a.site)
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
