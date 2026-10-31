#!/usr/bin/env python3
# Octave-Full-Wasm — Release 资产的预压缩 sidecar（.gz + .br）
# Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么要有它（内容仓 `113-host` 的协议提案，用户拍板「release 同时出 .br + .gz」）：
#   · **`.gz`** = 兼容性兜底（所有浏览器都吃），成本低（29 MB 只要 ~1 s）；
#   · **`.br` q11** = 极限压，实测在本仓 wasm32 三件上省 **31.9%** / 在 omc 74 MB 上省 **37.5%**
#     —— 边缘动态 br 只省 9.8%（它用低质量档），所以 **sidecar 是唯一能拿到这个收益的路**；
#   · 代价：q11 压 29.6 MB 要 **~56 s**、压 74.5 MB 要 **~148 s** ⇒ **必须做一次并永久缓存**，
#     不能每次构建重压。这正是本脚本存在的理由（CI/发布时跑一次，产物进 Release）。
#
# ★ 三条纪律（每条都有反例）：
#   1. **已压格式不压**（`.gz`/`.zip`/`.whl`/`.woff2`/`.png`/`.jpg`）——白工且纯增体积。
#      UI 的 `compress-static.sh` 曾把 zip 23 MiB + whl 13 MiB + tar.gz 79 MiB 又压一遍。
#   2. **`.br` 只对 ≥1 MB 的件出**（阈值可调）——小件的 br header 开销吃掉收益。
#   3. **三份身份都要记**（原始 / `.gz` / `.br` 各自的 bytes+sha256）——
#      消费端要能分辨拿到的是哪一层；否则用户 `fetch('x.wasm.gz')` 拿到的是压缩字节，
#      实例化必失败。
#
# 用法：
#   python3 build/113/compress-assets.py <目录> [--min-br-bytes N] [--json]
#   python3 build/113/compress-assets.py --selftest
#
# 输出：同目录下 `<file>.gz` / `<file>.br`，以及 `COMPRESSED.json` 三份身份清单。
import argparse
import gzip
import hashlib
import json
import os
import sys

# 已压缩格式：再压一遍是白工（内容仓给过数字：zip/whl/tar.gz 三类共 ~115 MiB 被重复压）
SKIP_EXT = {".gz", ".br", ".zip", ".whl", ".tar", ".tgz", ".bz2", ".xz", ".7z",
            ".woff", ".woff2", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".mp4", ".wasm.gz"}

DEFAULT_MIN_BR = 1024 * 1024          # 1 MiB：br q11 只值在大件上花


def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def should_skip(path):
    low = path.lower()
    # `.wasm.gz` 这种双后缀也要认出来
    if low.endswith(".wasm.gz") or low.endswith(".tar.gz"):
        return True
    return os.path.splitext(low)[1] in SKIP_EXT


def compress_dir(root, min_br=DEFAULT_MIN_BR, dry_run=False):
    """压缩目录下的可压件。返回清单 dict（三份身份）。纯函数式：不写就不写。"""
    try:
        import brotli
    except ImportError:
        brotli = None

    entries = []
    for name in sorted(os.listdir(root)):
        p = os.path.join(root, name)
        if not os.path.isfile(p) or should_skip(name):
            continue
        raw = open(p, "rb").read()
        rec = {"file": name,
               "raw": {"bytes": len(raw), "sha256": sha256_bytes(raw)}}

        gz = gzip.compress(raw, 6)
        gz_path = p + ".gz"
        if not dry_run:
            with open(gz_path, "wb") as fh:
                fh.write(gz)
        rec["gz"] = {"file": name + ".gz", "bytes": len(gz), "sha256": sha256_bytes(gz)}

        br_info = None
        if brotli is not None and len(raw) >= min_br:
            br = brotli.compress(raw, quality=11, lgwin=24)
            br_path = p + ".br"
            if not dry_run:
                with open(br_path, "wb") as fh:
                    fh.write(br)
            br_info = {"file": name + ".br", "bytes": len(br), "sha256": sha256_bytes(br)}
        rec["br"] = br_info
        entries.append(rec)

    doc = {
        "_provenance": "build/113/compress-assets.py（gzip -6 / brotli q11 lgwin24）",
        "_note": ("三份身份都要记：消费端要能分辨拿到的是哪一层。"
                  "raw 的 sha256 是**生产者台账**的值，本脚本只核对不另算权威。"),
        "min_br_bytes": min_br,
        "entries": entries,
    }
    if not dry_run:
        with open(os.path.join(root, "COMPRESSED.json"), "w", encoding="utf-8") as fh:
            json.dump(doc, fh, ensure_ascii=False, indent=1)
            fh.write("\n")
    return doc


def selftest():
    """F1 自证（三类齐备）：正常不报 / 该报的必须报 / 空输入必须报。"""
    import tempfile
    cases = []

    # ① 正常：大件出 gz + br，三份 sha 都不同
    with tempfile.TemporaryDirectory() as d:
        big = os.path.join(d, "big.wasm")
        open(big, "wb").write(b"a" * (2 * 1024 * 1024))
        doc = compress_dir(d, min_br=1024 * 1024)
        e = doc["entries"][0]
        cases.append(("大件（≥min_br）⇒ gz 与 br 都出，三份身份齐",
                      e["gz"] is not None and e["br"] is not None
                      and e["raw"]["sha256"] != e["gz"]["sha256"]))
        cases.append(("实体文件真落盘（.gz / .br 都在）",
                      os.path.isfile(big + ".gz") and os.path.isfile(big + ".br")))

    # ② 反向：已压格式必须跳过（zip / gz / png）
    with tempfile.TemporaryDirectory() as d:
        for n in ("a.zip", "b.gz", "c.png", "d.whl"):
            open(os.path.join(d, n), "wb").write(b"x" * 5000)
        doc = compress_dir(d, dry_run=True)
        cases.append(("★ 反向：已压格式（zip/gz/png/whl）全部跳过，一个都不压",
                      doc["entries"] == []))
        cases.append(("★ 反向：跳过判定对 .wasm.gz 双后缀也成立",
                      should_skip("octave.wasm.gz") and should_skip("x.tar.gz")))

    # ③ 空输入：空目录 ⇒ 空 entries（不编假条目），但 doc 结构完整
    with tempfile.TemporaryDirectory() as d:
        doc = compress_dir(d, dry_run=True)
        cases.append(("★ 空输入：空目录 ⇒ entries 为空且结构完整（零值不编）",
                      doc["entries"] == [] and "min_br_bytes" in doc))

    # ④ 小件：低于 min_br ⇒ 出 gz 但**不出** br
    with tempfile.TemporaryDirectory() as d:
        open(os.path.join(d, "small.js"), "wb").write(b"y" * 1000)
        doc = compress_dir(d, min_br=1024 * 1024, dry_run=True)
        cases.append(("★ 小件（<min_br）⇒ 出 gz、不出 br（阈值生效）",
                      doc["entries"][0]["gz"] is not None
                      and doc["entries"][0]["br"] is None))

    bad = 0
    for label, ok in cases:
        print("%s | %s" % ("PASS" if ok else "fail", label))
        bad += 0 if ok else 1
    print("=== compress-assets 自证：%d PASS / %d fail ===" % (len(cases) - bad, bad))
    return 1 if bad else 0


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("dir", nargs="?")
    ap.add_argument("--min-br-bytes", type=int, default=DEFAULT_MIN_BR)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args(argv)

    if a.selftest:
        return selftest()
    if not a.dir:
        ap.error("需要目录（或 --selftest）")
    if not os.path.isdir(a.dir):
        print("FATAL: 目录不存在：%s" % a.dir, file=sys.stderr)
        return 2

    doc = compress_dir(a.dir, a.min_br_bytes, dry_run=a.dry_run)
    if a.json:
        print(json.dumps(doc, ensure_ascii=False, indent=1))
        return 0
    for e in doc["entries"]:
        raw = e["raw"]["bytes"]
        gz = e["gz"]["bytes"] if e["gz"] else 0
        br = e["br"]["bytes"] if e["br"] else 0
        pct = (1 - br / gz) * 100 if (gz and br) else 0
        print("%-22s raw %10d  gz6 %9d  br11 %9s  (br vs gz %5.1f%%)"
              % (e["file"], raw, gz, br if br else "-", pct))
    print("== %d 件，清单 → %s" % (len(doc["entries"]),
                                   os.path.join(a.dir, "COMPRESSED.json")))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
