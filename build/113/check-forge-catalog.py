#!/usr/bin/env python3
# Octave-Full-Wasm — **Forge 货架目录闸门**（设计稿 §8.2；issue 64）
# Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么存在：Forge 按需拉取把"哪些包可装"分成两层 —— **货架仓**（`shelf/` submodule，
# 只含档案：版本/sha/依赖）与 **站点目录**（`site/assets/forge-catalog.json` 生成物 + 同源字节
# `site/assets/forge/*.tar.gz`）。生成器 `build/forge-catalog.py` 出生时自证过，但**没有东西
# 盯住"committed 之后"的状态**：货架 bump 了目录没重生成、目录改了字节没跟着换、包档案说
# 纯 `.m` 而 tarball 里其实躺着一个异架构 `.oct` —— 这三种漂移都**不会**让页面打不开，
# 只会在用户 install 的那一刻才炸（或更坏：炸在 8761，而实验站是对的）。
#
# 规则（fail-closed；数据 = 货架 + 仓库 `site/` 镜像，代码 = 本文件）：
#   R1 目录的 `octave` == **fork 的 AC_INIT 版本**（`upstream/octave/configure.ac` 里读，
#      不手写 —— 与生成器同一口径；升 Octave 忘了重生成 ⇒ 这里当场红）
#   R2 每条 (name, version, sha256) 在 `shelf/packages/<name>.json` 里有**同版本同 sha**
#      的档案（pin 由货架 commit 承载 ⇒ 目录不许出现货架上没有的断言）
#   R3 每条 `url`（同源相对路径）在仓库 `site/` 镜像里**真在**，且字节 sha == 目录 sha
#      （仓库镜像 = 入库的可部署物 ⇒ "目录说有什么"必须与"committed 的字节"对上）
#   R4 `kinds` 与实际 tarball 内容一致：不含 'oct' 的包 ⇒ tarball 里**不许有 `*.oct`**
#      （v1 只卖纯 .m / m+src；带了预编译件就该在货架上被划成 'oct' 形态）
#   R6（接缝 §5④，2026-10-14）：**能力层条目**（`form:"tree"`）形状合法 —— 必须 `content:[]`
#      （裁决①）、且它的 `url` 必须在站点里**真在**。判据来源：能力层条目由 `forge-catalog.py`
#      产出（不在货架档案里）⇒ R2 不管它，本闸门必须自己盯（否则"能力层写了个不存在的 URL"没人拦）。
#      ★ **2026-10-15 翻面**：旧 R6 还要求"能力层必须有 `consumer`"—— 这与裁决②原文
#      （consumer **可选**、缺省 octave）**自相矛盾**，对 LLVM 并入的 sysroot 条目**假红**。
#      ⇒ consumer 由"必需"改为"**若存在则须是数组**"，缺省合法（见 R7a）。
#   R5（端口 schema 2，接缝 §2/§5②）：`form`/`content` 两轴与 `kinds` **一致**
#      （`content` == `kinds` 兼容视图；`form` 由 `kinds` 派生 —— 货架包恒 `pkg`）。
#      这是 R4 的推广：R4 查"kinds 与字节"，R5 查"新两轴与 kinds"（防两处各写一份漂移）
#   ★ **来源域**（2026-10-15，回应内容仓 mail/009 待确认③）：目录里住**两类**条目 ——
#      ① **货架包**（`url` 在 `assets/forge/` 下）⇒ 走 R2/R3/R4/R5；
#      ② **非货架条目**（能力层 / `--upstream` 并入的生产者表，如 LLVM 工具链）⇒ 走 **R7**。
#      按 `url` 前缀分域（域判据 = 同一条事实：字节从哪来）。旧版对非货架条目跑 R2/R4 是
#      **假红**（实测：并入 LLVM 13 条 ⇒ 26 条 PROBLEM 全是误判）。
#   R7（非货架条目，2026-10-15）：**R7a 形状** —— `form:"tree"` 的 `content` 必须空（裁决①）；
#      `consumer` 可选但若在须是数组（裁决②）。**R7b 字节** —— `url` 在站点里真在且 sha 相符
#      （fail-closed 的唯一依据；**并入生产者的表后，字节必须 stage**，否则目录指着 404）。
#   R8（跨域，全部条目，2026-10-15）：`size` 口径 sanity（裁决 2026-10-15，回应 mail/009）——
#      单文件形态 `size` == 该文件字节；`form:"tree"` 的 `size` = 整树预算 ⇒ 必须 ≥ `url` 锚。
#      `size` 不参与 fail-closed（schema 明说），本判据只拦"树比其中一件还小"这种自相矛盾。
#
# stdout 裸值契约（平台闸门惯例）：`ok` / `PROBLEM: <哪条>`；SKIP 明说退 0。
#   · 货架不在（submodule 未初始化）⇒ `SKIP:` 退 0（换机器不是错，同 plugin-check）
#   · 仓库镜像里还没有目录（Forge 未装配/未同步镜像）⇒ `SKIP:` 明说退 0
#     —— 但**目录在而任何一条对不上 ⇒ PROBLEM**（"有"就必须自洽；"没有"不许冒充通过）
# 用法：python3 build/113/check-forge-catalog.py [--site site] [--shelf shelf] ／ --selftest
import argparse
import gzip
import hashlib
import io
import json
import os
import re
import sys
import tarfile

REPO = os.environ.get("GATE_REPO") or os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for b in iter(lambda: fh.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def fork_octave_version(conf_ac):
    """从 fork 的 configure.ac 读 AC_INIT 版本（与 forge-catalog.py 同款正则）。"""
    try:
        with open(conf_ac, encoding="utf-8", errors="replace") as fh:
            m = re.search(r"AC_INIT\s*\(\s*\[[^\]]*\]\s*,\s*\[([0-9][0-9.]*)\]", fh.read())
    except OSError:
        return None
    return m.group(1) if m else None


def shelf_has(entry, shelf_dir):
    """R2 的判据：货架档案里存在 (version, sha256) 完全相同的版本。返回原因串或 None。"""
    p = os.path.join(shelf_dir, "packages", entry.get("name", "") + ".json")
    try:
        with open(p, encoding="utf-8") as fh:
            doc = json.load(fh)
    except OSError:
        return "货架上没有 %s.json" % entry.get("name")
    except ValueError:
        return "%s.json 不是合法 JSON" % entry.get("name")
    for v in doc.get("versions") or []:
        if str(v.get("version")) == str(entry.get("version")):
            if v.get("sha256") == entry.get("sha256"):
                return None
            return ("%s 版本 %s：货架 sha=%s ≠ 目录 sha=%s"
                    % (entry.get("name"), entry.get("version"),
                       str(v.get("sha256"))[:12], str(entry.get("sha256"))[:12]))
    return "货架 %s 没有版本 %s" % (entry.get("name"), entry.get("version"))


def tarball_has_oct(tar_path):
    """R4 的判据：tarball 里有没有 `*.oct` 成员。返回 (有无, 首个成员名)。"""
    with tarfile.open(tar_path, "r:gz") as tf:
        for m in tf.getmembers():
            if m.name.endswith(".oct"):
                return True, m.name
    return False, None


def check(site, shelf, repo=REPO, sha_of=sha256_file, has_oct=tarball_has_oct):
    """纯逻辑（自证注入 sha_of/has_oct）。返回 (problems, skips)。"""
    shelf_dir = os.path.join(repo, shelf) if not os.path.isabs(shelf) else shelf
    site_dir = os.path.join(repo, site) if not os.path.isabs(site) else site
    cat_path = os.path.join(site_dir, "assets", "forge-catalog.json")

    if not os.path.isdir(os.path.join(shelf_dir, "packages")):
        return [], ["货架不在（%s/packages 读不到 —— submodule 未初始化？）" % shelf]
    if not os.path.isfile(cat_path):
        return [], ["仓库镜像里没有 %s（Forge 尚未装配或镜像未同步）" % cat_path]

    problems = []
    try:
        with open(cat_path, encoding="utf-8") as fh:
            doc = json.load(fh)
    except ValueError as e:
        return ["forge-catalog.json 不是合法 JSON：%r" % (e,)], []

    packs = doc.get("packs") or []
    if not packs:
        # 零值守卫：空目录不是"一致"，是"什么都没查"（本仓最怕的退化形状）
        return ["目录里 0 个包（零值守卫：空目录不许报通过）"], []

    # R1：目录的 octave == fork 的 AC_INIT
    want = fork_octave_version(os.path.join(repo, "upstream", "octave", "configure.ac"))
    if want and str(doc.get("octave")) != want:
        problems.append("目录 octave=%s ≠ fork AC_INIT=%s（升了 Octave 没重生成？）"
                        % (doc.get("octave"), want))
    elif not want:
        problems.append("读不到 fork 的 AC_INIT 版本（upstream/octave/configure.ac 不在？）")

    for p in packs:
        name = p.get("name", "?")
        url = p.get("url") or ""
        form = p.get("form")
        # ★ **来源域**（2026-10-15 裁决，回应内容仓 mail/009）：目录里住着**两类**条目 ——
        #   ① **货架包**（`url` 在 `assets/forge/` 下，恒 `form:"pkg"`）；
        #   ② **非货架条目**：能力层（Pyodide 运行时）+ `--upstream` 并入的生产者表（LLVM 工具链）。
        #   后者的"货架档案对账"(R2)、"kinds↔tarball"(R4)、"content==kinds"(R5) **都不适用** ——
        #   对它们跑 R2/R4 是**假红**（实测：并入 LLVM 13 条后 26 条 PROBLEM，全是误判）。
        #   ⇒ 按 `url` 前缀分域，各走各的断言（域判据 = 同一条事实：字节从哪来）。
        is_shelf = url.startswith("assets/forge/")
        blob = os.path.join(site_dir, url) if url else ""
        exists = bool(url) and os.path.isfile(blob)

        if is_shelf:
            # R2：货架档案对账（pin 承载者）
            why = shelf_has(p, shelf_dir)
            if why:
                problems.append("R2 %s" % why)
            # R3：字节在仓库镜像里、且 sha 相符
            if not exists:
                problems.append("R3 %s 的字节不在仓库镜像里：%s" % (name, url))
                continue
            got = sha_of(blob)
            if got != p.get("sha256"):
                problems.append("R3 %s 字节 sha=%s ≠ 目录 sha=%s（目录改了字节没换？）"
                                % (name, got[:12], str(p.get("sha256"))[:12]))
                continue
            # R4：kinds 与实际内容一致（无 'oct' ⇒ tarball 里不许有 .oct）
            kinds = p.get("kinds") or []
            if "oct" not in kinds:
                try:
                    has, first = has_oct(blob)
                except (OSError, tarfile.TarError) as e:
                    problems.append("R4 %s 读不了 tarball：%r" % (name, e))
                    continue
                if has:
                    problems.append("R4 %s kinds=%s 却说没有编译件，tarball 里躺着 %s"
                                    % (name, kinds, first))
            # R5：两轴与 kinds 一致（content == kinds；货架包恒 form=pkg）
            content = p.get("content")
            if content is not None and list(content) != list(kinds):
                problems.append("R5 %s content=%s ≠ kinds=%s（兼容视图必须同值）"
                                % (name, content, kinds))
            if form is not None and form != "pkg":
                problems.append("R5 %s form=%r —— 货架装配的包恒为 \"pkg\"" % (name, form))
        else:
            # R7（非货架条目：能力层 / 生产者表并入）—— 与包走**不同**的断言。
            #   R7a 形状：`form:"tree"` 的 content 必须空（裁决①）；consumer **可选**
            #       （裁决②：缺省 octave。★ 翻面 2026-10-15：旧 R6 把 consumer 当**必需**，
            #        与裁决②原文"可选"自相矛盾，对 LLVM 的 sysroot 条目假红）。
            #   R7b 字节：`url` 在站点里真在、且 sha 相符（fail-closed 的唯一依据）。
            if form == "tree" and p.get("content"):
                problems.append("R7 %s 能力层（form:tree）的 content 必须为空 []：得到 %r"
                                % (name, p.get("content")))
            if "consumer" in p and not isinstance(p["consumer"], list):
                problems.append("R7 %s consumer 必须是数组：得到 %r" % (name, p["consumer"]))
            if not exists:
                problems.append("R7 %s 非货架条目的字节不在站点：%s（生产者的表并进来了，"
                                "但字节没 stage ⇒ 目录指着 404）" % (name, url))
                continue
            got = sha_of(blob)
            if p.get("sha256") and got != p["sha256"]:
                problems.append("R7 %s 字节 sha=%s ≠ 目录 sha=%s"
                                % (name, got[:12], str(p.get("sha256"))[:12]))

        # R8（跨域，全部条目）：`size` 口径 sanity（裁决 2026-10-15）——
        #   单文件形态 size == 该文件字节；`form:"tree"` 的 size = 整树预算 ⇒ **必须 ≥ url 锚**。
        #   `size` 本身不是第二断言（schema 明说），这条只拦"明显自相矛盾"（树比锚还小）。
        if exists and isinstance(p.get("size"), int):
            real = os.path.getsize(blob)
            if form == "tree":
                if p["size"] < real:
                    problems.append("R8 %s tree 的 size=%d < url 锚字节 %d（整树不可能比其中一件小）"
                                    % (name, p["size"], real))
            elif p["size"] != real:
                problems.append("R8 %s 单文件 size=%d ≠ 字节 %d" % (name, p["size"], real))
    return problems, []


def main(argv):
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--site", default="site", help="仓库镜像站点目录（默认 site/）")
    ap.add_argument("--shelf", default="shelf", help="货架仓目录（默认 shelf/）")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args(argv)
    if a.selftest:
        return _selftest()
    problems, skips = check(a.site, a.shelf)
    for s in skips:
        print("SKIP: %s" % s)
    if problems:
        for p in problems:
            print("PROBLEM: %s" % p)
        return 1
    if skips:
        return 0
    print("ok")
    return 0


# ── 三档自证（F1：正常不报 / 该报的必须报 / 空输入必须报）──────────────────────
def _mk_fixture(tmp, packs, octave="11.3.0", shelf_sha=None, blob_sha=None,
                shelf_versions=None, ac_init="11.3.0"):
    """造最小夹具：repo/upstream/octave/configure.ac + repo/shelf + repo/site。"""
    os.makedirs(os.path.join(tmp, "upstream", "octave"))
    with open(os.path.join(tmp, "upstream", "octave", "configure.ac"), "w") as fh:
        fh.write("AC_INIT([GNU Octave], [%s], [bugs])\n" % ac_init)
    shelf_dir = os.path.join(tmp, "shelf", "packages")
    os.makedirs(shelf_dir)
    blob_dir = os.path.join(tmp, "site", "assets", "forge")
    os.makedirs(blob_dir)
    for p in packs:
        vs = shelf_versions if shelf_versions is not None else [
            {"version": p["version"], "sha256": shelf_sha or p["sha256"]}]
        with open(os.path.join(shelf_dir, p["name"] + ".json"), "w") as fh:
            json.dump({"name": p["name"], "versions": vs}, fh)
        with open(os.path.join(blob_dir, os.path.basename(p["url"])), "wb") as fh:
            fh.write(blob_sha or p["sha256"].encode())
    with open(os.path.join(tmp, "site", "assets", "forge-catalog.json"), "w") as fh:
        json.dump({"schema": 1, "octave": octave, "packs": packs}, fh)
    return tmp


def _pack(name="demo", version="1.0.0", sha="a" * 64, kinds=("m",)):
    return {"name": name, "version": version, "sha256": sha,
            "url": "assets/forge/%s-%s.tar.gz" % (name, version), "kinds": list(kinds)}


def _selftest():
    import tempfile
    import shutil

    # 用**真 sha**：sha_of 用"字节本身"的 sha，所以让 pack 的 sha = sha256(字节)
    def real_sha_of(data):
        return lambda _p: hashlib.sha256(data).hexdigest()

    data = b"PKG-BYTES"
    good_sha = hashlib.sha256(data).hexdigest()
    no_oct = lambda _p: (False, None)                                  # noqa: E731
    yes_oct = lambda _p: (True, "demo-1.0.0/inst/x.oct")               # noqa: E731

    cases = []
    # ⚠️ 夹具必须活到**用例跑完**：`with TemporaryDirectory` 在退出时就删树，
    #    而用例是延后执行的 ⇒ 曾经 7/9 假红（夹具没了，报的全是"读不到"）。
    tmp = tempfile.mkdtemp(prefix="forge-cat-selftest-")
    try:
        # ① 正常不报
        d = _mk_fixture(os.path.join(tmp, "ok1"), [_pack(sha=good_sha)], blob_sha=data)
        cases.append(("正常：目录 ↔ 货架 ↔ 字节全部对上 ⇒ 不报",
                      lambda d=d: check("site", "shelf", repo=d,
                                        sha_of=real_sha_of(data), has_oct=no_oct)[0] == []))
        # ② 该报的必须报 —— 五种漂移各一条
        d = _mk_fixture(os.path.join(tmp, "bad_ver"), [_pack(sha=good_sha)], blob_sha=data,
                        ac_init="11.4.0")
        cases.append(("★ R1：fork AC_INIT 与目录 octave 不一致 ⇒ 必须报",
                      lambda d=d: any("AC_INIT" in p for p in check(
                          "site", "shelf", repo=d, sha_of=real_sha_of(data), has_oct=no_oct)[0])))
        d = _mk_fixture(os.path.join(tmp, "bad_shelf_sha"), [_pack(sha=good_sha)],
                        blob_sha=data, shelf_sha="f" * 64)
        cases.append(("★ R2：货架档案 sha 与目录不一致 ⇒ 必须报",
                      lambda d=d: any("货架 sha" in p for p in check(
                          "site", "shelf", repo=d, sha_of=real_sha_of(data), has_oct=no_oct)[0])))
        d = _mk_fixture(os.path.join(tmp, "bad_blob"), [_pack(sha=good_sha)],
                        blob_sha=b"TAMPERED!")
        # ⚠️ 这一条必须用**真的读文件算 sha** 的注入（不是常量）——否则"篡改"根本没被看见
        #    （曾经 1 条假红：注入函数恒返回期望值 ⇒ 用例自证不到 R3 的判别力）。
        cases.append(("★ R3：字节被改动（sha 不符）⇒ 必须报",
                      lambda d=d: any("字节 sha" in p for p in check(
                          "site", "shelf", repo=d, sha_of=sha256_file, has_oct=no_oct)[0])))
        d = _mk_fixture(os.path.join(tmp, "bad_oct"), [_pack(sha=good_sha, kinds=("m",))],
                        blob_sha=data)
        cases.append(("★ R4：kinds 说纯 .m 但 tarball 里有 .oct ⇒ 必须报",
                      lambda d=d: any("tarball 里躺着" in p for p in check(
                          "site", "shelf", repo=d, sha_of=real_sha_of(data), has_oct=yes_oct)[0])))
        # R5（端口 schema 2 两轴与 kinds 一致）
        d = _mk_fixture(os.path.join(tmp, "good_axes"),
                        [_pack(sha=good_sha, kinds=("m",))], blob_sha=data)
        _cat = os.path.join(d, "site", "assets", "forge-catalog.json")
        _d0 = json.load(open(_cat))
        _d0["packs"][0]["form"] = "pkg"
        _d0["packs"][0]["content"] = ["m"]
        json.dump(_d0, open(_cat, "w"))
        cases.append(("R5：form=pkg + content==kinds ⇒ 不报",
                      lambda d=d: check("site", "shelf", repo=d, sha_of=real_sha_of(data),
                                        has_oct=no_oct)[0] == []))
        d = _mk_fixture(os.path.join(tmp, "bad_content"),
                        [_pack(sha=good_sha, kinds=("m",))], blob_sha=data)
        _cat = os.path.join(d, "site", "assets", "forge-catalog.json")
        _d0 = json.load(open(_cat))
        _d0["packs"][0]["form"] = "pkg"
        _d0["packs"][0]["content"] = ["m", "src"]      # ≠ kinds（[m]）⇒ 必须报
        json.dump(_d0, open(_cat, "w"))
        cases.append(("★ R5：content ≠ kinds ⇒ 必须报",
                      lambda d=d: any("R5" in p for p in check(
                          "site", "shelf", repo=d, sha_of=real_sha_of(data), has_oct=no_oct)[0])))
        d = _mk_fixture(os.path.join(tmp, "bad_form"),
                        [_pack(sha=good_sha, kinds=("m",))], blob_sha=data)
        _cat = os.path.join(d, "site", "assets", "forge-catalog.json")
        _d0 = json.load(open(_cat))
        # ★ 翻面（2026-10-14，接缝 §5④）：`form:"tree"` 现在**合法**（能力层条目的形态，
        #   由 R6 管形状）⇒ 旧断言"form!=pkg ⇒ 必报"**已不成立**。改为断言：
        #   包**不许**用 tree 之外的其他非 pkg 值（那才是错的），且 tree 必须过 R6 形状。
        _d0["packs"][0]["form"] = "octdir"           # 包形态里没有 octdir（那是 manifest 的投送形态）
        _d0["packs"][0]["content"] = ["m"]
        json.dump(_d0, open(_cat, "w"))
        cases.append(("★ R5：包的 form 不是 pkg（且不是合法能力层 tree）⇒ 必须报",
                      lambda d=d: any("R5" in p for p in check(
                          "site", "shelf", repo=d, sha_of=real_sha_of(data), has_oct=no_oct)[0])))
        # R6/R7（接缝 §5④ + 2026-10-15 分域）：能力层/非货架条目的形状 —— 正常 / 四条反向
        def _mk_cap(d2, mutate=None):
            """造一个带能力层条目的夹具站：包（demo）+ 能力层（cap，url 在 assets/cap/）。"""
            dd = _mk_fixture(d2, [_pack(sha=good_sha)], blob_sha=data)
            blob = os.path.join(dd, "site", "assets", "cap", "cap.wasm")
            os.makedirs(os.path.dirname(blob), exist_ok=True)
            open(blob, "wb").write(data)
            catp = os.path.join(dd, "site", "assets", "forge-catalog.json")
            doc = json.load(open(catp))
            doc["packs"].append({"name": "cap", "version": "1", "sha256": good_sha,
                                 "url": "assets/cap/cap.wasm", "form": "tree",
                                 "content": [], "consumer": ["octave"], "deps": []})
            if mutate:
                mutate(doc["packs"][-1])
            json.dump(doc, open(catp, "w"))
            return dd
        d = _mk_cap(os.path.join(tmp, "cap_ok"))
        cases.append(("R7：能力层（form:tree, content=[], consumer, 字节+sha 对）⇒ 不报",
                      lambda d=d: check("site", "shelf", repo=d, sha_of=sha256_file,
                                        has_oct=no_oct)[0] == []))
        # ★ 翻面（2026-10-15，回应 mail/009 待确认②）：consumer **可选**（缺省 octave）
        d = _mk_cap(os.path.join(tmp, "cap_noconsumer"), lambda c: c.pop("consumer"))
        cases.append(("★ R7 翻面：能力层**缺 consumer 不算错**（裁决②：可选、缺省 octave）",
                      lambda d=d: check("site", "shelf", repo=d, sha_of=sha256_file,
                                        has_oct=no_oct)[0] == []))
        d = _mk_cap(os.path.join(tmp, "cap_badcontent"), lambda c: c.update(content=["wasm"]))
        cases.append(("★ R7a 反向：能力层带非空 content ⇒ 必须报（裁决①）",
                      lambda d=d: any("R7" in p and "content" in p for p in check(
                          "site", "shelf", repo=d, sha_of=sha256_file, has_oct=no_oct)[0])))
        d = _mk_cap(os.path.join(tmp, "cap_nonlist"), lambda c: c.update(consumer="octave"))
        cases.append(("★ R7a 反向：consumer 不是数组 ⇒ 必须报",
                      lambda d=d: any("R7" in p and "consumer" in p for p in check(
                          "site", "shelf", repo=d, sha_of=sha256_file, has_oct=no_oct)[0])))
        # ★ R7b：非货架条目字节不在站点 ⇒ 必须报（这是"并入生产者的表但字节没 stage"的真形状）
        d = _mk_cap(os.path.join(tmp, "cap_noblob"), lambda c: c.update(url="assets/cap/nope.wasm"))
        cases.append(("★ R7b 反向：非货架条目的字节不在站点 ⇒ 必须报（并入表指着 404）",
                      lambda d=d: any("R7" in p and "字节不在" in p for p in check(
                          "site", "shelf", repo=d, sha_of=sha256_file, has_oct=no_oct)[0])))
        # ★ R7b：非货架条目字节被改（sha 不符）⇒ 必须报
        def _tamper_cap(d2):
            dd = _mk_cap(d2)
            open(os.path.join(dd, "site", "assets", "cap", "cap.wasm"), "wb").write(b"TAMPER!")
            return dd
        d = _tamper_cap(os.path.join(tmp, "cap_tampered"))
        cases.append(("★ R7b 反向：非货架条目字节 sha 不符 ⇒ 必须报",
                      lambda d=d: any("R7" in p and "字节 sha" in p for p in check(
                          "site", "shelf", repo=d, sha_of=sha256_file, has_oct=no_oct)[0])))
        # ★ R8：size 口径 sanity（tree 的 size ≥ url 锚；单文件 size == 字节）
        d = _mk_cap(os.path.join(tmp, "cap_small_size"),
                    lambda c: c.update(size=1))            # tree 但 size < 锚字节
        cases.append(("★ R8 反向：tree 的 size < url 锚字节 ⇒ 必须报",
                      lambda d=d: any("R8" in p for p in check(
                          "site", "shelf", repo=d, sha_of=sha256_file, has_oct=no_oct)[0])))
        d = _mk_fixture(os.path.join(tmp, "bad_size"), [_pack(sha=good_sha)], blob_sha=data)
        _cat = os.path.join(d, "site", "assets", "forge-catalog.json")
        _d0 = json.load(open(_cat))
        _d0["packs"][0]["size"] = 999999                     # 单文件但 size ≠ 字节
        json.dump(_d0, open(_cat, "w"))
        cases.append(("★ R8 反向：单文件 size ≠ 字节 ⇒ 必须报",
                      lambda d=d: any("R8" in p for p in check(
                          "site", "shelf", repo=d, sha_of=sha256_file, has_oct=no_oct)[0])))
        d = _mk_fixture(os.path.join(tmp, "bad_missing"), [_pack(sha=good_sha)], blob_sha=data)
        os.remove(os.path.join(d, "site", "assets", "forge", "demo-1.0.0.tar.gz"))
        cases.append(("★ R3：目录说有的字节镜像里没有 ⇒ 必须报",
                      lambda d=d: any("不在仓库镜像里" in p for p in check(
                          "site", "shelf", repo=d, sha_of=real_sha_of(data), has_oct=no_oct)[0])))
        # ③ 空输入必须报 / 未启用如实说
        d = _mk_fixture(os.path.join(tmp, "empty"), [_pack(sha=good_sha)], blob_sha=data)
        with open(os.path.join(d, "site", "assets", "forge-catalog.json"), "w") as fh:
            json.dump({"schema": 1, "octave": "11.3.0", "packs": []}, fh)
        cases.append(("★ 空目录 ⇒ 必须报（零值守卫）",
                      lambda d=d: any("零值守卫" in p for p in check(
                          "site", "shelf", repo=d, sha_of=real_sha_of(data), has_oct=no_oct)[0])))
        d = os.path.join(tmp, "noshelf")
        os.makedirs(os.path.join(d, "site", "assets"))
        cases.append(("货架不在 ⇒ SKIP（不算通过也不算失败）",
                      lambda d=d: (lambda r: r[0] == [] and any("货架不在" in s for s in r[1]))(
                          check("site", "shelf", repo=d, sha_of=real_sha_of(data), has_oct=no_oct))))
        d = _mk_fixture(os.path.join(tmp, "nocat"), [_pack(sha=good_sha)], blob_sha=data)
        os.remove(os.path.join(d, "site", "assets", "forge-catalog.json"))
        cases.append(("目录缺席（未装配/未同步镜像）⇒ SKIP 明说",
                      lambda d=d: (lambda r: r[0] == [] and any("尚未装配" in s for s in r[1]))(
                          check("site", "shelf", repo=d, sha_of=real_sha_of(data), has_oct=no_oct))))

        bad = 0
        for label, fn in cases:
            try:
                ok = bool(fn())
            except Exception as e:                              # noqa: BLE001
                ok, label = False, "%s（异常 %r）" % (label, e)
            print("%s | %s" % ("PASS" if ok else "fail", label))
            bad += 0 if ok else 1
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print("=== check-forge-catalog 自证：%d PASS / %d fail ===" % (len(cases) - bad, bad))
    print("=== %d PASS / %d FAIL ===" % (len(cases) - bad, bad))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
