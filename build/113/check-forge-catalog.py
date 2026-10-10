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
        # R2：货架档案对账（pin 承载者）
        why = shelf_has(p, shelf_dir)
        if why:
            problems.append("R2 %s" % why)
        # R3：字节在仓库镜像里、且 sha 相符
        url = p.get("url") or ""
        if not url.startswith("assets/forge/"):
            problems.append("R3 %s 的 url 不是同源 assets/forge/ 前缀：%r" % (name, url))
            continue
        blob = os.path.join(site_dir, url)
        if not os.path.isfile(blob):
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
