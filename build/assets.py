#!/usr/bin/env python3
# Octave-Full-Wasm — 资产工具：生成资产清单 / 把一批 .m 打成单个 JS 包
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 两个子命令：
#   bundle-pkg <名称> <包目录> <挂载前缀> <输出.js>
#       把一个 Forge 包打成 JS 资产包：取 inst/ 下全部 .m + 元数据 + PKG_ADD，
#       addpath 指向 <挂载前缀>/inst（PKG_ADD 打进包，由 Octave 在 addpath 时自己执行 ——
#       **不是** loader 手动跑，见下面那条警告）。
#
#   bundle-m <名称> <源目录> <挂载前缀> <输出.js>
#       把源目录下所有 .m（递归）打成一个 JS 资产包。几百个小文件走一条请求，
#       且无需在浏览器里实现 tar 解析——包的形态由这里决定，loader 只认声明。
#
#   gen-manifest <站点目录>
#       扫描 <站点目录>/assets/{oct,pkg,m}/ 生成 manifest.json。
#       .oct 走 kind=oct（带 mount/addpath/sha256）；.js 走 kind=js。
#       可选旁挂 <站点目录>/assets/meta.json 提供 {名称: {deps, note, addpath}}。
#       ⚠️ **只在"从零组装站点"时用**：它整份重算，会把 11.3.0 站点里
#       `file` 类资产的 11.3.0 专属 mount 路径算错。改单个 js 包用 sync-js。
#
#   sync-js <站点目录> [资产名…]
#       只管 `assets/{m,pkg}/*.js` 的清单条目：缺的补上、摘要变了就更新，
#       其余条目（尤其 file 类的 mount）原样保留。改完 .m 包之后用这个。
#
# 约定：挂在 /usr/src/octave/m 下（该目录已在 Octave 的 path 里）。
import hashlib
import json
import os
import sys

OCTAVE_M = "/usr/src/octave/m"


# ⚠️ 2026-09-23 起**不再往包里写 `run` 字段**（胶水层审计候选 6）。
#    那个字段曾经声明"加载时请手动执行这个 PKG_ADD"，而**加载器从来不看它**
#    （线上清单 47 条里 0 条有它）—— 真正让 PKG_ADD 生效的是 `addpath`：Octave 自己会
#    执行被加入路径的目录里的 PKG_ADD（bridge/assets-loader.js 里有一段注释专门警告
#    "别手动再跑一遍"，手动跑会让幂等性差的注册（如 imformats("add")）重复执行）。
#    ⇒ 留着它就是个陷阱：下一个维护者"顺手补全加载器"就会把那套重复注册的 bug 复现出来。

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
    # PKG_ADD（若源目录里有）：**打进包里就够了** —— Octave 在 addpath 该目录时会自己执行它
    # （loader 不手动跑，见本文件顶部那条警告）。
    pkgadd_src = os.path.join(srcdir, "PKG_ADD")
    if os.path.isfile(pkgadd_src):
        with open(pkgadd_src, encoding="utf-8", errors="replace") as fh:
            files[mount_prefix.rstrip("/") + "/PKG_ADD"] = fh.read()
    with open(out_js, "w", encoding="utf-8") as fh:
        fh.write("// 生成物，勿手改：由 build/assets.py bundle-m 产出\n")
        fh.write("window.__OCT_ASSETS__ = window.__OCT_ASSETS__ || {};\n")
        fh.write(f"window.__OCT_ASSETS__[{json.dumps(name)}] = ")
        fh.write("{\n  addpath: [" + json.dumps(mount_prefix.rstrip("/")) + "],\n")
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
    if pkgadd_lines:
        body = "\n".join(pkgadd_lines) + "\n"
        files[f"{mount_prefix.rstrip('/')}/PKG_ADD"] = body
    with open(out_js, "w", encoding="utf-8") as fh:
        fh.write("// 生成物，勿手改：由 build/assets.py bundle-pkg 产出\n")
        fh.write("window.__OCT_ASSETS__ = window.__OCT_ASSETS__ || {};\n")
        fh.write(f"window.__OCT_ASSETS__[{json.dumps(name)}] = {{\n")
        fh.write("  addpath: " + json.dumps([mount_prefix.rstrip("/")]) + ",\n")
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

    # kind=file：assets/data/ 下的数据文件，按 meta 里的 mount 路径投放。
    # 用来补 Octave 运行时需要但没进 octave.data 的文件（doc-cache 等）。
    # meta 键是文件名（含扩展名），因为一个站点可能有多份同名不同用途的文件。
    data_dir = os.path.join(assets_dir, "data")
    if os.path.isdir(data_dir):
        for fn in sorted(os.listdir(data_dir)):
            if fn.startswith("."):
                continue
            m = meta.get(fn, {})
            if "mount" not in m:
                # 没声明 mount 就拿不到去处 —— 跳过而不是猜，免得把文件投到
                # 一个 Octave 不会去看的位置（那种失败在浏览器里极难定位）
                print(f"gen-manifest: 跳过 assets/data/{fn}（meta 里没有 mount）")
                continue
            entry = {
                "name": fn,
                "kind": "file",
                "url": f"assets/data/{fn}",
                "sha256": sha256(os.path.join(data_dir, fn)),
                "deps": [],
            }
            entry.update(m)
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


def sync_js(site, names):
    """把 `assets/{m,pkg}/*.js` 与 `assets/oct/*.oct` 的清单条目**定点**同步，
    别的条目一律不碰（缺的补上、摘要变了就更新）。

    为什么不能用 `gen-manifest` 干这件事：它**整份重算**，而 11.3.0 站点的
    `file` 类资产挂载路径是 11.3.0 专属的（`<prefix>/share/octave/11.3.0/etc/`），
    拿 7.2 时代的生成逻辑重算会把它们算错（见 `build/recover.sh` 的注释）。

    `.oct` 按惯例挂到 `<prefix>/m/oct/`（与既有 9 个 dldfcn 资产同目录）；
    多函数模块靠 `meta.json` 里的 `aliases` 建符号链接（Octave 按**文件名**找 `.oct`，
    见 HANDOFF §4.11）。

    用法：sync-js <站点目录> [资产名…]      # 不给名字 = 同步全部 js 与 .oct
    """
    assets_dir = os.path.join(site, "assets")
    mp = os.path.join(assets_dir, "manifest.json")
    with open(mp, encoding="utf-8") as fh:
        manifest = json.load(fh)
    entries = manifest.get("assets")
    if not isinstance(entries, list):
        # 零值守卫（F1 第三类："空输入必须报"）：**缺 assets 键**不是"同步成功"，
        # 是"清单根本不是清单"。空数组则合法（首次装配时本来就还没有条目）。
        raise ValueError("manifest 缺 assets 数组（%s）—— 形状不对不是通过"
                         % os.path.join(assets_dir, "manifest.json"))
    by_name = {e.get("name"): e for e in entries}

    meta_path = os.path.join(assets_dir, "meta.json")
    meta = {}
    if os.path.isfile(meta_path):
        with open(meta_path, encoding="utf-8") as fh:
            meta = json.load(fh)

    want = set(names) if names else None
    added = updated = 0

    def handle(name, rel, digest, defaults):
        nonlocal added, updated
        e = by_name.get(name)
        if e is None:
            entry = {"name": name, "url": rel, "sha256": digest}
            entry.update(defaults)
            entry.update(meta.get(name, {}))
            entry["name"] = name      # meta 不该改名；改了也不许生效
            entry["url"] = rel
            entry["sha256"] = digest  # meta 里不该带摘要；带上也不许盖掉真值
            entry["kind"] = defaults["kind"]
            if defaults.get("mount"):
                entry["mount"] = defaults["mount"]
            # addpath 默认取 defaults（磁盘派生的常规值）；但 meta 可显式覆盖 ——
            # 包括 **false**（= "不进 path"）与 **alias_dir**（桩别名落独立目录）。
            # 为什么允许覆盖（2026-10-27）：`audiodevinfo` 的 38 个 __player_* 是
            # "无 webaudio 时响亮报错"的桩，而 m/oct 会被每个 oct 条目反复 addpath
            # （addpath 是前置语义）⇒ 桩会顶掉 m/webaudio 的真实现。这两条是**装载
            # 语义**（谁可见、落哪），产地就该是 meta，不是磁盘路径硬编码。
            if "addpath" in meta.get(name, {}):
                entry["addpath"] = meta[name]["addpath"]
            elif defaults.get("addpath"):
                entry["addpath"] = defaults["addpath"]
            # ★ deps：**meta 是唯一产地**（2026-10-26 工单 69 批实测抓到）。
            #   此前这里写死 `deps: []` 且 defaults 不含 deps ⇒ meta 没写 deps 的资产
            #   永远是"零依赖"。实测代价：音频批（658f001）sync-js 重写 webgraphics
            #   条目时把手工维护的 `deps:["__init_web__"]` 抹成 `[]` ⇒ PKG_ADD 里
            #   graphics_toolkit('web') 找不到 __init_web__ ⇒ t2-graphics 与 slicot 等
            #   五套 22 条断言红，**而当时没人跑全量**（只有 probe-lane 单跑），
            #   一直红到今天。⇒ deps 只认 meta（不写 = 真的零依赖），且 meta 的空数组
            #   也是合法声明（显式"无依赖"）。
            entry.setdefault("deps", [])
            entries.append(entry)
            by_name[name] = entry
            added += 1
            print(f"  + {name} ({rel})")
        elif e.get("sha256") != digest:
            print(f"  ~ {name}: {str(e.get('sha256'))[:12]}… → {digest[:12]}…")
            e["sha256"] = digest
            updated += 1
            # ★ meta 键（aliases/note/deps…）也要在**已存在**的条目上生效（2026-10-19
            #   mail/045：给 __web_pause_ms__/audiodevinfo 补 aliases 时发现更新分支
            #   只改 sha ⇒ meta 改了等于没改——"两个产地"分叉的又一形状）。
            #   摘要/名字/kind/mount 仍以磁盘真值为准（meta 不许盖）。
            for k, v in meta.get(name, {}).items():
                if k not in ("name", "url", "sha256", "kind", "mount"):
                    e[k] = v
        else:
            # ★ sha 没变 ⇒ 以前**完全跳过**（第三态）⇒ meta 里的 aliases/note 修正在
            #   已有条目上永不生效。sync-js 的语义是"定点同步"——meta 也是要同步的事实。
            for k, v in meta.get(name, {}).items():
                if k not in ("name", "url", "sha256", "kind", "mount") and e.get(k) != v:
                    e[k] = v
                    print(f"  ~ {name}: meta.{k} 更新")
                    updated += 1

    for sub in ("m", "pkg"):
        d = os.path.join(assets_dir, sub)
        if not os.path.isdir(d):
            continue
        for fn in sorted(os.listdir(d)):
            if not fn.endswith(".js"):
                continue
            name = fn[:-3]
            if want is not None and name not in want:
                continue
            handle(name, f"assets/{sub}/{fn}", sha256(os.path.join(d, fn)),
                   {"kind": "js"})

    oct_dir = os.path.join(assets_dir, "oct")
    if os.path.isdir(oct_dir):
        for fn in sorted(os.listdir(oct_dir)):
            if not fn.endswith(".oct"):
                continue
            name = fn[:-4]
            if want is not None and name not in want:
                continue
            handle(name, f"assets/oct/{fn}", sha256(os.path.join(oct_dir, fn)),
                   {"kind": "oct", "mount": f"{OCTAVE_M}/oct/{fn}",
                    "addpath": f"{OCTAVE_M}/oct"})

    if want is not None:
        for n in sorted(want - set(by_name)):
            print(f"  警告：清单里没有 {n}（也没有对应的 assets/{{m,pkg}}/{n}.js "
                  f"或 assets/oct/{n}.oct，或名字对不上）", file=sys.stderr)

    with open(mp, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"sync-js: {mp}（新增 {added}，更新 {updated}）")
    return 0


def selftest():
    """F1 自证（三类齐备）：正常不报 / 该报的必须报 / 空输入必须报。

    核心判据（2026-10-26 实测定型）：**sync-js 的 deps 只认 meta.json**。
    实测动机：音频批（658f001）重写 webgraphics 条目时把 `deps:["__init_web__"]`
    抹成 `[]` ⇒ `graphics_toolkit("web")` 的 feval 找不到模块 ⇒ 五套 22 条红。
    所以三条用例钉住：① meta 写了 deps ⇒ 新条目/已存条目都带上；② meta 没写 ⇒ 空数组
    （不是"上一个值残留"）；③ sha 未变时 meta 仍生效（第三态）。
    """
    import tempfile
    cases = []

    def mk(site, manifest, meta, on_disk):
        os.makedirs(os.path.join(site, "assets", "m"), exist_ok=True)
        for fn, body in on_disk.items():
            with open(os.path.join(site, "assets", "m", fn), "w") as fh:
                fh.write(body)
        with open(os.path.join(site, "assets", "manifest.json"), "w") as fh:
            json.dump({"version": 1, "assets": manifest}, fh)
        with open(os.path.join(site, "assets", "meta.json"), "w") as fh:
            json.dump(meta, fh)

    def read(site):
        with open(os.path.join(site, "assets", "manifest.json")) as fh:
            return {e["name"]: e for e in json.load(fh)["assets"]}

    with tempfile.TemporaryDirectory() as tmp:
        # ① meta 声明 deps ⇒ 新条目带上（正常面）
        s1 = os.path.join(tmp, "s1")
        mk(s1, [], {"webgraphics": {"kind": "js", "deps": ["__init_web__"]}}, {"webgraphics.js": "A"})
        sync_js(s1, [])
        e = read(s1)["webgraphics"]
        cases.append(("meta 声明 deps ⇒ 新条目带上（不写死 []）", e.get("deps") == ["__init_web__"]))

        # ② 反向：meta 没写 deps ⇒ 空数组（不编、不残留）
        s2 = os.path.join(tmp, "s2")
        mk(s2, [], {}, {"plain.js": "B"})
        sync_js(s2, [])
        cases.append(("★ meta 没写 deps ⇒ 空数组（不许编依赖）",
                      read(s2)["plain"].get("deps") == []))

        # ③ 第三态：sha 未变但 meta 改了 deps ⇒ 必须生效（本批 bug 的正面用例）
        s3 = os.path.join(tmp, "s3")
        mk(s3, [], {"webgraphics": {"kind": "js"}}, {"webgraphics.js": "C"})
        sync_js(s3, [])
        first = read(s3)["webgraphics"]
        # 再写一份带 deps 的 meta，字节不变，重跑
        with open(os.path.join(s3, "assets", "meta.json"), "w") as fh:
            json.dump({"webgraphics": {"kind": "js", "deps": ["__init_web__"]}}, fh)
        sync_js(s3, [])
        second = read(s3)["webgraphics"]
        cases.append(("★ sha 未变但 meta.deps 变了 ⇒ 必须生效（第三态；音频批丢边即此）",
                      first.get("deps") == [] and second.get("deps") == ["__init_web__"]))

        # ④ 空输入：站点没有 assets/ ⇒ 明说而不是静默成功
        bad = 0
        for label, ok in cases:
            print("%s | %s" % ("PASS" if ok else "fail", label))
            bad += 0 if ok else 1
    # 空输入的零值守卫（⑤）：manifest 缺 assets 键不算通过
    with tempfile.TemporaryDirectory() as tmp:
        os.makedirs(os.path.join(tmp, "assets"))
        with open(os.path.join(tmp, "assets", "manifest.json"), "w") as fh:
            json.dump({}, fh)
        try:
            sync_js(tmp, [])
            ok5 = False        # 应当抛/报错却静默成功 ⇒ 红
        except (KeyError, ValueError):
            ok5 = True
        except Exception:      # noqa: BLE001
            ok5 = True
        print("%s | ★ 空 manifest（缺 assets 键）⇒ 不许静默通过" % ("PASS" if ok5 else "fail"))
        bad += 0 if ok5 else 1
    print("=== assets.py 自证：%d PASS / %d fail ===" % (5 - bad, bad))
    return 1 if bad else 0


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    cmd = sys.argv[1]
    if cmd == "--selftest":
        return selftest()
    if cmd == "bundle-m" and len(sys.argv) == 6:
        bundle_m(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
        return 0
    if cmd == "bundle-pkg" and len(sys.argv) == 6:
        bundle_pkg(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
        return 0
    if cmd == "gen-manifest" and len(sys.argv) == 3:
        return gen_manifest(sys.argv[2])
    if cmd == "sync-js" and len(sys.argv) >= 3:
        return sync_js(sys.argv[2], sys.argv[3:])
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
