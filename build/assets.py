#!/usr/bin/env python3
# Octave-Full-Wasm — 资产工具：生成资产清单 / 把一批 .m 打成单个 JS 包
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 两个子命令：
#   bundle-m <名称> <源目录> <挂载前缀> <输出.js>
#       把源目录下所有 .m（递归）打成一个 JS 资产包。几百个小文件走一条请求，
#       且无需在浏览器里实现 tar 解析——包的形态由这里决定，loader 只认声明。
#
#   gen-manifest <站点目录>
#       扫描 <站点目录>/assets/{oct,pkg,m}/ 生成 manifest.json。
#       .oct 走 kind=oct（带 mount/addpath/sha256）；.js 走 kind=js。
#       可选旁挂 <站点目录>/assets/meta.json 提供 {名称: {deps, note, addpath}}。
#
# 约定：挂在 /usr/src/octave/m 下（该目录已在 Octave 的 path 里）。
import hashlib
import json
import os
import sys

OCTAVE_M = "/usr/src/octave/m"


def bundle_m(name, srcdir, mount_prefix, out_js):
    files = {}
    n = 0
    for root, _dirs, names in os.walk(srcdir):
        for fn in sorted(names):
            if not fn.endswith(".m"):
                continue
            full = os.path.join(root, fn)
            rel = os.path.relpath(full, srcdir)
            try:
                with open(full, encoding="utf-8") as fh:
                    content = fh.read()
            except UnicodeDecodeError:
                with open(full, encoding="latin-1") as fh:
                    content = fh.read()
            files[mount_prefix.rstrip("/") + "/" + rel.replace(os.sep, "/")] = content
            n += 1
    if not n:
        print(f"警告：{srcdir} 里没有 .m 文件", file=sys.stderr)
    with open(out_js, "w", encoding="utf-8") as fh:
        fh.write("// 生成物，勿手改：由 build/assets.py bundle-m 产出\n")
        fh.write("window.__OCT_ASSETS__ = window.__OCT_ASSETS__ || {};\n")
        fh.write(f"window.__OCT_ASSETS__[{json.dumps(name)}] = ")
        fh.write("{\n  addpath: [" + json.dumps(mount_prefix.rstrip("/")) + "],\n  files: ")
        fh.write(json.dumps(files, ensure_ascii=False))
        fh.write("\n};\n")
    size = os.path.getsize(out_js)
    print(f"bundle-m: {name} → {out_js}（{n} 个 .m，{size} 字节）")
    return n


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def gen_manifest(site):
    assets_dir = os.path.join(site, "assets")
    meta_path = os.path.join(assets_dir, "meta.json")
    meta = {}
    if os.path.isfile(meta_path):
        with open(meta_path, encoding="utf-8") as fh:
            meta = json.load(fh)

    entries = []

    oct_dir = os.path.join(assets_dir, "oct")
    if os.path.isdir(oct_dir):
        for fn in sorted(os.listdir(oct_dir)):
            if not fn.endswith(".oct"):
                continue
            name = fn[:-4]
            entry = {
                "name": name,
                "kind": "oct",
                "url": f"assets/oct/{fn}",
                "sha256": sha256(os.path.join(oct_dir, fn)),
                "mount": f"{OCTAVE_M}/oct/{fn}",
                "addpath": f"{OCTAVE_M}/oct",
                "deps": [],
            }
            entry.update(meta.get(name, {}))
            entries.append(entry)

    for sub, kind in (("pkg", "js"), ("m", "js")):
        d = os.path.join(assets_dir, sub)
        if not os.path.isdir(d):
            continue
        for fn in sorted(os.listdir(d)):
            if not fn.endswith(".js"):
                continue
            name = fn[:-3]
            entry = {
                "name": name,
                "kind": kind,
                "url": f"assets/{sub}/{fn}",
                "sha256": sha256(os.path.join(d, fn)),
                "deps": [],
            }
            entry.update(meta.get(name, {}))
            entries.append(entry)

    manifest = {"version": 1, "assets": entries}
    out = os.path.join(assets_dir, "manifest.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"gen-manifest: {out}（{len(entries)} 个资产）")
    for e in entries:
        print(f"  - {e['name']:<28} {e['kind']:<4} {e.get('note', '')}")
    return 0


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    cmd = sys.argv[1]
    if cmd == "bundle-m" and len(sys.argv) == 6:
        bundle_m(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
        return 0
    if cmd == "gen-manifest" and len(sys.argv) == 3:
        return gen_manifest(sys.argv[2])
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
