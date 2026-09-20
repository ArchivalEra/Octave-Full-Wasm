#!/usr/bin/env python3
# Octave-Full-Wasm — 资产工具：生成资产清单 / 把一批 .m 打成单个 JS 包
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 两个子命令：
#   bundle-pkg <名称> <包目录> <挂载前缀> <输出.js>
#       把一个 Forge 包打成 JS 资产包：取 inst/ 下全部 .m + 元数据 + PKG_ADD，
#       addpath 指向 <挂载前缀>/inst（有 PKG_ADD 则记到 run 里，由 loader 执行）。
#
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
    # PKG_ADD（若源目录里有）：加载时由 loader 执行，用于 imformats 注册这类一次性初始化
    pkgadd_src = os.path.join(srcdir, "PKG_ADD")
    run = []
    if os.path.isfile(pkgadd_src):
        with open(pkgadd_src, encoding="utf-8", errors="replace") as fh:
            files[mount_prefix.rstrip("/") + "/PKG_ADD"] = fh.read()
        run = [mount_prefix.rstrip("/") + "/PKG_ADD"]
    with open(out_js, "w", encoding="utf-8") as fh:
        fh.write("// 生成物，勿手改：由 build/assets.py bundle-m 产出\n")
        fh.write("window.__OCT_ASSETS__ = window.__OCT_ASSETS__ || {};\n")
        fh.write(f"window.__OCT_ASSETS__[{json.dumps(name)}] = ")
        fh.write("{\n  addpath: [" + json.dumps(mount_prefix.rstrip("/")) + "],\n")
        if run:
            fh.write("  run: " + json.dumps(run) + ",\n")
        fh.write("  files: ")
        fh.write(json.dumps(files, ensure_ascii=False))
        fh.write("\n};\n")
    size = os.path.getsize(out_js)
    print(f"bundle-m: {name} → {out_js}（{n} 个 .m，{size} 字节）")
    return n


def bundle_pkg(name, pkgdir, mount_prefix, out_js):
    """把一个 Forge 包打成 JS 资产包。

    **布局对齐 `pkg install`**：Octave 装包时会把 `inst/` 的内容上提到包根
    （`install.m` 的 copy_files 阶段），所以运行时看到的是「包根 + 子目录」。
    包若需要把子目录挂上 path，靠的是 `inst/PKG_ADD`（统计工具箱就是这么做的：
    里面用 `mfilename("fullpath")` 取自身位置，再 addpath 各子目录）——
    因此这里必须让 PKG_ADD 落在包根，并在加载时 `run()` 它。
    src/ 留给编译车道（2B），这里只取 .m 与元数据。
    """
    files = {}
    n = 0
    inst = os.path.join(pkgdir, "inst")
    src_root = inst if os.path.isdir(inst) else pkgdir
    for cur, _dirs, names in os.walk(src_root):
        for fn in sorted(names):
            if not fn.endswith(".m"):
                continue
            rel = os.path.relpath(os.path.join(cur, fn), src_root)
            with open(os.path.join(cur, fn), encoding="utf-8", errors="replace") as fh:
                files[mount_prefix.rstrip("/") + "/" + rel.replace(os.sep, "/")] = fh.read()
            n += 1
    for meta in ("DESCRIPTION", "INDEX", "COPYING", "NEWS"):
        mp = os.path.join(pkgdir, meta)
        if os.path.isfile(mp):
            with open(mp, encoding="utf-8", errors="replace") as fh:
                files[f"{mount_prefix.rstrip('/')}/{meta}"] = fh.read()
    # PKG_ADD：忠实模拟 Octave 的 create_pkgadddel——
    #   1) 抽取 inst/*.m（顶层，glob 即字典序）里的 `## PKG_ADD: <代码>` 行
    #      （matgeom 就是靠 `## PKG_ADD: __matgeom_package_register__ (1);` 把子目录挂上 path 的，
    #        optim 靠它注册选项）
    #   2) 追加包自带的 inst/PKG_ADD 原文（statistics 走这条）
    pkgadd_lines = []
    for fn in sorted(os.listdir(src_root)):
        if not fn.endswith(".m"):
            continue
        with open(os.path.join(src_root, fn), encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if line.startswith("## PKG_ADD:"):
                    pkgadd_lines.append(line.split("## PKG_ADD:", 1)[1].strip())
    for cand in (os.path.join(src_root, "PKG_ADD"), os.path.join(pkgdir, "PKG_ADD")):
        if os.path.isfile(cand):
            with open(cand, encoding="utf-8", errors="replace") as fh:
                pkgadd_lines.append(fh.read())
            break
    run = []
    if pkgadd_lines:
        body = "\n".join(pkgadd_lines) + "\n"
        files[f"{mount_prefix.rstrip('/')}/PKG_ADD"] = body
        run = [f"{mount_prefix.rstrip('/')}/PKG_ADD"]
    with open(out_js, "w", encoding="utf-8") as fh:
        fh.write("// 生成物，勿手改：由 build/assets.py bundle-pkg 产出\n")
        fh.write("window.__OCT_ASSETS__ = window.__OCT_ASSETS__ || {};\n")
        fh.write(f"window.__OCT_ASSETS__[{json.dumps(name)}] = {{\n")
        fh.write("  addpath: " + json.dumps([mount_prefix.rstrip("/")]) + ",\n")
        if run:
            fh.write("  run: " + json.dumps(run) + ",\n")
        fh.write("  files: " + json.dumps(files, ensure_ascii=False) + "\n};\n")
    print(f"bundle-pkg: {name} → {out_js}（{n} 个 .m，{os.path.getsize(out_js)} 字节）")
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

    octdir_root = os.path.join(assets_dir, "octdir")
    if os.path.isdir(octdir_root):
        for name in sorted(os.listdir(octdir_root)):
            d = os.path.join(octdir_root, name)
            if not os.path.isdir(d):
                continue
            octs = sorted(f for f in os.listdir(d) if f.endswith(".oct"))
            if not octs:
                continue
            entry = {
                "name": name + "-oct",
                "kind": "octdir",
                "base_url": f"assets/octdir/{name}",
                "files": octs,
                "mount_dir": f"{OCTAVE_M}/forge/{name}/oct",
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

    # 包的编译件资产自动成为该包的依赖：load("struct") 会先装 struct-oct
    oct_ids = {e["name"] for e in entries if e["kind"] == "octdir"}
    for e in entries:
        if e["kind"] == "js" and (e["name"] + "-oct") in oct_ids:
            deps = list(e.get("deps", []))
            if (e["name"] + "-oct") not in deps:
                deps.append(e["name"] + "-oct")
            e["deps"] = deps

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
    if cmd == "bundle-pkg" and len(sys.argv) == 6:
        bundle_pkg(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
        return 0
    if cmd == "gen-manifest" and len(sys.argv) == 3:
        return gen_manifest(sys.argv[2])
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
