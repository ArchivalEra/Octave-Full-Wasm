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


def shelf_commit():
    """货架仓的 commit（= "目录来自哪一版货架"）——pin 的承载者，写进 catalog 供见证。"""
    try:
        out = subprocess.run(["git", "-C", SHELF, "rev-parse", "HEAD"],
                             capture_output=True, text=True, timeout=20)
        return out.stdout.strip() if out.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def catalog_doc(packs, octave, gen):
    return {
        "schema": 1,
        "octave": octave,
        "generated_by": gen,
        "shelf_commit": shelf_commit(),
        "note": "Forge 按需拉取目录（客户端读它，不下载包字节）。字节在同源 assets/forge/。",
        "packs": [{k: v for k, v in p.items() if not k.startswith("_")}
                  for p in sorted(packs, key=lambda x: x["name"])],
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
    doc = catalog_doc(packs, octave, "build/forge-catalog.py")
    bad += write_catalog(a.site, doc, a.check)
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
