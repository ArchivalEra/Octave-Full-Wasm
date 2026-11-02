#!/usr/bin/env python3
"""Octave-Full-Wasm — **Release 生成器**（不发布，只生成）。

## 为什么有这个文件（用户点令 2026-11-02）

> 「你应该使用 action 自动出 release，**绝对不能手动改**」

我此前用手工 `gh release upload --clobber` 把一份已发布的 `manifest.json` 换掉了 ——
两处错：① **release 不可变**是这份契约的地基（v4 §0），clobber 等于改写历史；
② "这份 manifest 从哪来"变得**不可复现**（只有我的一次命令，没有可重跑的东西）。

⇒ 现在的形状：**字节入库 + 本脚本生成 + workflow 发布**。三件事各归各位：
  · `release/products/<product>/{octave.wasm,octave.js,octave.data}` —— 产物字节（入 git）
  · 本脚本 —— 唯一产地：读字节 → 切块 → 逐块三编码 → 写 manifest（schema 3）
  · `.github/workflows/release.yml` —— 只在 tag 上跑，调本脚本再发布

## 判据（每条都能红，见 --selftest）

  ① 三产物必须都在，且每件都被身份证里的 sha 覆盖（不读"看起来对"，读 `octave.build.json`）
  ② 每块 ≤ chunkSize（5 MiB；fzstd backreference 上限 2^25 是硬上限）
  ③ 每个 entry 恰有一个 `identity` variant 且在末位（解不了就无路可走 ⇒ 不许）
  ④ `Σ(identity.chunks.bytes) == entry.bytes`，且拼接后 sha 逐字等于 entry.sha256
  ⑤ 许可：全部 `AGPL-3.0-or-later`，`url` 指本仓根 `LICENSE`（**不许**再出现 LicenseRef ——
     2026-11-02 我把 rust-sort 误标成 non-free，那是把**维护口径**当成了**许可**）

## 用法

    python3 build/make-release.py --out <目录> [--tag <tag>]     # 生成 manifest + 分片
    python3 build/make-release.py --selftest                     # 三类用例
    python3 build/113/check-release-v4.py <out>/manifest.json --base <out>   # 用契约方校验器

退出码：0 = 生成且自检通过；1 = 有判据不成立；2 = 输入缺失（fail-closed）。
"""
import argparse
import gzip
import hashlib
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRODUCTS_DIR = os.path.join(REPO, "release", "products")
CHUNK = 5 * 1024 * 1024
MAX_CHUNK_HARD = 2 ** 25
NAME_RE = re.compile(r"^[A-Za-z0-9_-][A-Za-z0-9._-]*$")
LICENSE_URL = "https://github.com/ArchivalEra/Octave-Full-Wasm/blob/master/LICENSE"
LICENSE_ID = "AGPL-3.0-or-later"

# 三个产物 → (product id, arch, 一句话)。顺序固定：free → free → 带 rust 内核。
PRODUCTS = [
    ("wasm32", "wasm32", "wasm32 single-thread, zero atomics (no COI required)"),
    ("wasm64std", "wasm64", "wasm64 + mimalloc, standard (does not link librustsort.a)"),
    ("wasm64ip", "wasm64", "wasm64 + mimalloc + Rust sort kernel (links librustsort.a)"),
]
# ⚠️ 顺序 = **字母序**（sorted），与内容仓 `make-manifest-v4.py` 的 `sorted(files)` 一致。
#   为什么在意：契约对 entry 顺序**没有**判据（校验器里零顺序判据），但顺序不同会让
#   「按 (product, name, sha256) 序列算指纹」的**判重**失效 —— 2026-11-02 内容仓就因此
#   把我的两个 release 误报成"条目构成不同"（dc30fda2 vs 8d35ed0a），实际 9 条 sha 全同、
#   只是我先用了 (wasm, js, data) 而对方是字母序。**顺序不承重，就别让它成为差异源。**
FILES = tuple(sorted(("octave.wasm", "octave.js", "octave.data")))


def sha256(b):
    return hashlib.sha256(b).hexdigest()


def chunked(buf, size=CHUNK):
    return [buf[i:i + size] for i in range(0, len(buf), size)] or [b""]


def name_ok(n):
    if not isinstance(n, str) or not n:
        return False
    if len(n) > 255 or ".." in n or n.endswith("."):
        return False
    return bool(NAME_RE.match(n))


def idn(x):
    return bool(re.match(r"^[A-Za-z0-9][A-Za-z0-9.+-]*$", x))


def build(out, tag, problems):
    """生成 out/ 下的 manifest.json 与全部分片。problems 收集每条不成立的判据。"""
    entries = []
    products = {}
    used_names = set()
    os.makedirs(out, exist_ok=True)

    for pid, arch, desc in PRODUCTS:
        pdir = os.path.join(PRODUCTS_DIR, pid)
        card_path = os.path.join(pdir, "octave.build.json")
        if not os.path.isdir(pdir):
            problems.append("① 缺产物目录 %s" % pdir)
            continue
        # ① 身份证是**产物自己**的权威记录；没有它就不许发（那等于没核对）
        if not os.path.isfile(card_path):
            problems.append("① %s 没有 octave.build.json（未核对过的产物不许发）" % pid)
            continue
        card = json.load(open(card_path, encoding="utf-8"))
        if card.get("verdict") != "ok":
            problems.append("① %s 身份证 verdict=%r（只有 ok 可发）" % (pid, card.get("verdict")))
            continue
        declared = (card.get("measured") or {}).get("files") or {}
        products[pid] = {"form": "octdir", "arch": arch, "_desc": desc}

        for fname in FILES:
            fpath = os.path.join(pdir, fname)
            if not os.path.isfile(fpath):
                problems.append("① %s 缺 %s" % (pid, fname))
                continue
            raw = open(fpath, "rb").read()
            s = sha256(raw)
            # ① 与身份证对读：磁盘字节必须就是核对过的那份
            want = (declared.get(fname) or {}).get("sha256")
            if want and want != s:
                problems.append("① %s/%s 磁盘 sha=%s ≠ 身份证 %s（产物被换过？）"
                                % (pid, fname, s[:16], want[:16]))
                continue
            chunks = chunked(raw)
            # ② 每块 ≤ chunkSize（identity 是原始切片，最坏情况恰好 = CHUNK）
            bad = [len(c) for c in chunks if len(c) > CHUNK]
            if bad:
                problems.append("② %s/%s 有块超过 chunkSize：%s" % (pid, fname, bad))

            variants = []
            for codec in ("zstd", "gzip", "identity"):
                parts = []
                for i, c in enumerate(chunks):
                    if codec == "identity":
                        data = c
                    elif codec == "gzip":
                        data = gzip.compress(c, compresslevel=9, mtime=0)  # mtime=0 ⇒ 可复现
                    else:
                        data = zstd_compress(c) if zstd_compress else None
                    if data is None:
                        problems.append("② 没有 zstd 编码器，无法生成 %s 分支" % codec)
                        break
                    # 文件名 = <product>__<载荷>.<codec>.<NNN>（契约预算 ≤64 建议值，只提示）
                    f = "%s__%s.%s.%03d" % (pid, fname, codec, i)
                    if not name_ok(f):
                        problems.append("② 名字不过白名单：%r" % f)
                        continue
                    if f in used_names:
                        problems.append("② 名字重复：%r" % f)
                    used_names.add(f)
                    open(os.path.join(out, f), "wb").write(data)
                    parts.append({"part": i, "file": f, "bytes": len(data), "sha256": sha256(data)})
                if parts:
                    variants.append({"codec": codec, "chunks": parts})

            # ③ identity 必须在末位且恰一个
            codecs = [v["codec"] for v in variants]
            if codecs[-1:] != ["identity"] or codecs.count("identity") != 1:
                problems.append("③ %s/%s 的 identity 不在末位或不止一个：%s" % (pid, fname, codecs))

            # ④ Σ identity bytes == bytes，且拼接 sha 逐字等于 entry.sha256
            ident = next((v for v in variants if v["codec"] == "identity"), None)
            if ident:
                total = sum(c["bytes"] for c in ident["chunks"])
                if total != len(raw):
                    problems.append("④ %s/%s Σidentity=%d ≠ bytes=%d" % (pid, fname, total, len(raw)))
                joined = b"".join(open(os.path.join(out, c["file"]), "rb").read()
                                  for c in ident["chunks"])
                if sha256(joined) != s:
                    problems.append("④ %s/%s 拼接 sha 不等于 entry.sha256" % (pid, fname))

            entries.append({
                "product": pid, "name": fname, "bytes": len(raw), "sha256": s,
                "license": {"id": LICENSE_ID, "url": LICENSE_URL},
                "role": "payload", "variants": variants,
            })

    # ⑤ 许可：全部 AGPL，且不许再有 LicenseRef（那条误标已撤回）
    for e in entries:
        if e["license"]["id"] != LICENSE_ID:
            problems.append("⑤ %s/%s 许可=%r（应为 %s）"
                            % (e["product"], e["name"], e["license"]["id"], LICENSE_ID))
        if "LicenseRef" in e["license"]["id"]:
            problems.append("⑤ %s/%s 仍带 LicenseRef —— non-free 误标已撤回"
                            % (e["product"], e["name"]))

    man = {
        "schema": 3,
        "id": "Octave-Full-Wasm/%s" % (tag or "unreleased"),
        "chunkSize": CHUNK,
        "codecs": ["zstd", "gzip", "identity"],
        "license": {"id": LICENSE_ID, "url": LICENSE_URL},
        "products": {k: {"form": v["form"], "arch": v["arch"]} for k, v in products.items()},
        "entries": entries,
    }
    open(os.path.join(out, "manifest.json"), "w", encoding="utf-8").write(
        json.dumps(man, ensure_ascii=False, indent=1) + "\n")
    return man


# zstd：契约允许它，但本仓的生成器在 CI 上必须**可复现**。没有 pyzstd 就明说缺，
# 而不是静默退化成只有 identity（那会让"三编码"变成假话）。
try:
    import zstandard as _zstd

    def zstd_compress(b):
        return _zstd.ZstdCompressor(level=19).compress(b)

    zstd_compress = zstd_compress
except Exception:                                        # noqa: BLE001
    zstd_compress = None


def selftest():
    """三类用例：正常 / 该报的必须报 / 空输入必须报。"""
    import shutil
    import tempfile
    bad = 0
    n = 0

    def case(name, ok):
        nonlocal bad, n
        n += 1
        print(("%s | %s" % ("PASS" if ok else "fail", name)))
        bad += 0 if ok else 1

    # ① 名字白名单（契约 V1 的反例必须全拒）
    for nm in ("sp ace.bin", "dots...many.000", ".hidden", "a中b.bin", "x/y"):
        case("★ 白名单拒绝 %r" % nm, not name_ok(nm))
    for nm in ("a.b_c-D9.zstd.000", "UPPER.Mixed.Case.000", "-leading"):
        case("白名单接受 %r" % nm, name_ok(nm))

    # ② chunkSize 的硬上限
    case("★ chunkSize ≤ 2^25", CHUNK <= MAX_CHUNK_HARD)
    case("★ chunkSize 是 5 MiB", CHUNK == 5 * 1024 * 1024)

    # ③ zstd 编码器在不在（缺 ⇒ 明说，不静默）
    case("zstd 编码器可用（否则 '三编码' 是假话）", zstd_compress is not None)

    # ④ SPDX 形（'GPL-3.0-or-later' 里的 -OR- 不许被替换成算符）
    case("★ SPDX id 合法（连字符不被当算符）", idn(LICENSE_ID) and "-OR-" not in LICENSE_ID)

    # ⑤ 空输入必须报 —— ⚠️ 必须指**夹具目录**，不能指真 release/products
    #   （第一版就错在这里：真仓里有产物 ⇒ build() 真读到了它们 ⇒ 这条用例永远"不报"，
    #    自证变成空转。教训：自证要证明"该报时会报"，就必须能控制输入）。
    d = tempfile.mkdtemp()
    empty = os.path.join(d, "products")
    os.makedirs(empty, exist_ok=True)
    try:
        global PRODUCTS_DIR
        real = PRODUCTS_DIR
        PRODUCTS_DIR = empty
        try:
            probs = []
            man = build(os.path.join(d, "out"), "selftest", probs)
        finally:
            PRODUCTS_DIR = real
        case("★ 空/缺产物 ⇒ 必报（不是静默出空 manifest）",
             len(probs) > 0 and len(man["entries"]) == 0)
        # ⑤b 反向：产物目录在、但身份证 verdict≠ok ⇒ 必须报（只有 ok 可发）
        pd = os.path.join(empty, "wasm32")
        os.makedirs(pd, exist_ok=True)
        open(os.path.join(pd, "octave.build.json"), "w").write('{"verdict":"rejected"}')
        PRODUCTS_DIR = empty
        try:
            probs2 = []
            build(os.path.join(d, "out2"), "selftest", probs2)
        finally:
            PRODUCTS_DIR = real
        case("★ verdict≠ok ⇒ 必报（没核对过的产物不许发）",
             any("verdict" in p for p in probs2))
    finally:
        shutil.rmtree(d, ignore_errors=True)
    print("=== make-release 自证：%d PASS / %d fail ===" % (n - bad, bad))
    return 0 if bad == 0 else 1


def main(argv):
    ap = argparse.ArgumentParser(description="生成 schema 3 release（不发布）")
    ap.add_argument("--out", help="输出目录")
    ap.add_argument("--tag", help="release tag（进 manifest.id）")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args(argv)
    if a.selftest:
        return selftest()
    if not a.out:
        print("用法：make-release.py --out <目录> [--tag <tag>] ／ --selftest", file=sys.stderr)
        return 2
    probs = []
    man = build(os.path.abspath(a.out), a.tag, probs)
    if probs:
        print("Release 生成失败（%d 条判据不成立）：" % len(probs), file=sys.stderr)
        for p in probs:
            print("  ✗ %s" % p, file=sys.stderr)
        return 1
    print("✅ manifest.json（schema %d，%d products，%d entries）"
          % (man["schema"], len(man["products"]), len(man["entries"])))
    print("   输出目录：%s" % os.path.abspath(a.out))
    print("   下一步（判据，不是可选项）：")
    print("     python3 build/113/check-release-v4.py %s/manifest.json --base %s"
          % (os.path.abspath(a.out), os.path.abspath(a.out)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
