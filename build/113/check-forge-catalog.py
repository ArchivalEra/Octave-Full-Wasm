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
    skips = []
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
            # R4 ★ **双向**（2026-10-16 补反方向，关 N2）：此前只有"声明无 oct ⇒ 字节不许有"，
            #   反向（"声明**含** oct ⇒ 字节里**必须**有"）不存在 ⇒ 声明可以永久说谎。
            #   实测活体：伪造一条 claim 说含 oct、字节里 0 个 .oct 的条目 ⇒ 旧闸门**放行**。
            #   而真例就在货架上：`statistics 1.7.3` 声明 `kinds:['m','oct']` 而真字节 0 个 .oct
            #   （13 个 src 文件；生产者自己的 `detect_kinds` 也判 `['m','src']`）。
            try:
                has, first = has_oct(blob)
            except (OSError, tarfile.TarError) as e:
                problems.append("R4 %s 读不了 tarball：%r" % (name, e))
                continue
            if "oct" not in kinds and has:
                problems.append("R4 %s kinds=%s 却说没有编译件，tarball 里躺着 %s"
                                % (name, kinds, first))
            if "oct" in kinds and not has:
                problems.append("R4 %s kinds=%s 说**含**编译件，但 tarball 里一个 `*.oct` 都没有"
                                "（声明与字节矛盾 —— 判据：判别看包内实际带什么，不看主张）"
                                % (name, kinds))
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

    # R9（deps 闭合，**装配态全表俱在** —— 2026-10-15，回应内容仓 mail/012/014）：
    #   内容仓能做的是**部分闭合**（它的 `--emit` 按设计是部分视图：能力层条目由本仓产出、
    #   不在它的表里），且它已拦 typo/未知名（目标 ∈ {货架包} ∪ {recipes/*.md 名}）。
    #   本闸门在**装配态**做**完整闭合**：全表俱在 ⇒ 能判"真·表内解析"。
    #   三档（★ 关键：把"合法缺席"与"缺陷"分开 —— 内容仓 mail/014 点名要求）：
    #     ① 目标在**同表**里有条目 ⇒ 闭合，OK；
    #     ② 目标不在表里，但**是已知能力层名**（`shelf/recipes/*.md` basename 派生）⇒
    #        **合法的"本站没供该能力层"**（install 时响亮失败 = 裁定过的正确行为）⇒ **note，不报**；
    #     ③ 目标既不在表里、又不是已知能力层名 ⇒ **typo / 未知目标 ⇒ 必红**。
    #   ⚠️ 诚实边界：③ 不证明"这个包真需要它"（那是 `depends` 作者的主张，同 sha256 不证明字节对）。
    table_names = {p.get("name") for p in packs if p.get("name")}
    caps = capability_names(os.path.join(shelf_dir, "recipes"))
    for p in packs:
        who = p.get("name", "?")
        for tgt in (p.get("deps") or []):
            if tgt in table_names:
                continue                                   # ① 表内闭合
            if tgt in caps:
                # ② 合法缺席：是已知能力层名，只是本站/本表没供它 —— 不是缺陷。
                #    ⚠️ 走 **stderr 的 note**，**不挤进 `skips`**（那个通道专指"环境缺件、
                #    这道闸门查不了"；R9② 是"查了、结论合法"，两者不该混）。
                print("note: R9 %s 的 deps 指向能力层 `%s`，本表未供该条目 ⇒ 合法缺席"
                      "（install 时响亮失败，非缺陷）" % (who, tgt), file=sys.stderr)
                continue                                   # ② 合法缺席
            problems.append("R9 %s 的 deps 指向 `%s` —— 既不在**同表**（%d 个条目）也不是"
                            "已知能力层名（%s）⇒ typo / 未知目标"
                            % (who, tgt, len(table_names),
                               ", ".join(sorted(caps)) or "无"))
    # R10（架构界，裁决 2026-10-16 用户点令「楚河汉界」）：**含 `.oct` 的条目的 `arch`
    #   必须与该站点**实际部署的档**一致**。判据来源 = 站点自己的 `assets/oct*` 目录里
    #   的真 `.oct` 字节（`arch_probe`，纯 stdlib 派生）—— **不问站点"你是哪档"**，
    #   因为站点可能部署多档（四格站），而"档"是**每档一个目录**的事实。
    #   ⚠️ 只在**该条目指向的字节真在站点**时判（字节不在 ⇒ R7b 已经点名了，不重复报）。
    #   反向可证伪：喂一个 arch 与站点目录相矛盾的条目 ⇒ 必红（自证里有）。
    site_arch = {}
    for lane_dir in ("oct", "oct-threads", "oct-w64", "oct-w64-base"):
        d = os.path.join(site_dir, "assets", lane_dir)
        a = arch_probe(d)
        if a:
            site_arch[lane_dir] = a
    # R11（★ 2026-10-16，design-it-twice 的 ④ 方案发现 N1）：**宿主自己产出的目录也必须
    #   过端口校验器**。为什么单列一条：在此之前，端口校验器只被用在**生产者表**（
    #   `forge-catalog.py --upstream`）上 —— 宿主**豁免了自己**（`grep validate-content-list
    #   check-forge-catalog.py` 此前为空）。⇒ 现役目录"恰好合规"是**巧合**而非判据：
    #   同一个文件在"生产者身份"下会被查、在"宿主自产"下不查。
    #   本判据复用产地的校验器（`build/extra-content/validate-content-list.py`，**不另写一份**），
    #   以 `--site` 模式跑（站点态：url 必须同源相对）。
    #   反向可证伪：把任意条目的 `arch` 改成 ""（或改成词表外的值）⇒ 必红（自证里有）。
    try:
        import importlib.util as _iu11
        _vp = os.path.join(REPO, "build", "extra-content", "validate-content-list.py")
        _spec11 = _iu11.spec_from_file_location("_vcl11", _vp)
        _mod11 = _iu11.module_from_spec(_spec11)
        _spec11.loader.exec_module(_mod11)
        port_probs = _mod11.check_table(doc, site=True)
        for _pp in port_probs[:8]:
            problems.append("R11 宿主自产目录未过端口校验（%s）" % _pp)
        if len(port_probs) > 8:
            problems.append("R11 …还有 %d 条（共 %d）" % (len(port_probs) - 8, len(port_probs)))
    except Exception as _e11:                       # 校验器不可用 ⇒ fail-closed
        problems.append("R11 端口校验器不可用：%r（不拿'没查'当通过）" % (_e11,))
    for p_ in packs:
        want = p_.get("arch")
        if not want:
            continue
        # ★ kind:'engine' 的 arch = lane 值（索引键——mail/047/031 裁决），**不是**
        #   wasm32/wasm64 架构字面量 ⇒ R10 的"对 .oct 目录字节"判据不适用
        #   （引擎的 url 指 clang.wasm，不在 assets/oct*/ 下是**设计形状**，非缺陷）。
        if p_.get("kind") == "engine":
            if want not in ("wasm32", "wasm64"):
                print("note: R10 `%s` kind:engine 的 arch=%s 是 lane 值（索引键，"
                      "非架构字面量）⇒ 跳过字节对档" % (p_.get("name"), want), file=sys.stderr)
                # ★ R14（内容仓 mail/057 §2 兄弟目录硬约束，2026-10-25）：tree 条目的
                #   `size` 必须等于 **url 所在目录**的实测字节和。动机（实测预算）：
                #   MSL zip 若被 provision 进 omc/，引擎条目闭包预算会从 74.7MB 虚胀到
                #   94MB+ —— 预算不诚实是 content 诚实纪律的同族。
                u14 = p_.get("url") or ""
                if u14:
                    d14 = os.path.join(site_dir, os.path.dirname(u14))
                    if os.path.isdir(d14):
                        actual = 0
                        for _b, _ds, _fs in os.walk(d14):
                            for _f in _fs:
                                try:
                                    actual += os.path.getsize(os.path.join(_b, _f))
                                except OSError:
                                    pass
                        declared = p_.get("size")
                        if isinstance(declared, int) and actual != declared:
                            problems.append(
                                "R14 %s 的 size=%d ≠ url 所在目录（%s）实测 %d —— "
                                "tree 条目 size 必须等于该目录字节和（兄弟目录硬约束："
                                "MSL 等资产不许混进引擎目录）"
                                % (p_.get("name"), declared, os.path.dirname(u14), actual))
                continue
        if not site_arch:
            print("note: R10 站点没有任何 assets/oct* 目录 ⇒ 无法核 `%s` 的 arch（跳过，"
                  "不是通过）" % p_.get("name"), file=sys.stderr)
            break
        # 条目带的 .oct 落在哪个档目录：看 url 前缀（站内相对）
        u = p_.get("url") or ""
        hit = [ld for ld in site_arch if ("assets/%s/" % ld) in u]
        if not hit:
            print("note: R10 `%s` 的 arch=%s 无法对档（url=%s 不在任何 assets/oct*/ 下）"
                  % (p_.get("name"), want, u), file=sys.stderr)
            continue
        for ld in hit:
            if site_arch[ld] != want:
                problems.append("R10 %s 的 arch=%s ≠ 站点 %s/ 里实际字节的架构 %s"
                                % (p_.get("name"), want, ld, site_arch[ld]))
    # R15（★ mail/090 绑定②③ + 工单 69，2026-10-26）：**files[]（下载闭包）与站点字节
    #   逐件对账**。files 的语义 = 消费者会下载的闭包（size = 目录和是另一条轴，R14；
    #   两者不等是设计，不比总量）—— 表里声明的每件 {bytes,sha256} 必须在 url 所在
    #   目录里找得到且逐字节相符。列了不在的文件 / sha 不符 / bytes 不符 ⇒ 红
    #   （fail-closed：闭包预算错一件，UI 的"还要拉多少"就骗人）。
    #   反向可证伪：篡改 files 一件 sha / 删掉一件字节 ⇒ 必红（自证里有）。
    for p in packs:
        f15 = p.get("files")
        if not f15:
            continue
        name15 = p.get("name", "?")
        if not isinstance(f15, dict):
            problems.append("R15 %s files 不是对象（map：文件名 → {bytes, sha256}）" % name15)
            continue
        u15 = p.get("url") or ""
        d15 = os.path.join(site_dir, os.path.dirname(u15))
        if not os.path.isdir(d15):
            problems.append("R15 %s 的 url 目录不在站点（%s）⇒ files 对不了账" % (name15, u15))
            continue
        for fn in sorted(f15):
            fv = f15[fn]
            fpath = os.path.join(d15, fn)
            if not isinstance(fv, dict) or not os.path.isfile(fpath):
                problems.append("R15 %s files 列了 %s 但站点 %s/ 里没有（闭包预算错件）"
                                % (name15, fn, os.path.dirname(u15)))
                continue
            got15 = sha_of(fpath)
            if got15 != fv.get("sha256"):
                problems.append("R15 %s files[%s] 声明 sha=%s… ≠ 站点字节 %s…"
                                "（fail-closed：先对生产者台账，别静默改表）"
                                % (name15, fn, str(fv.get("sha256"))[:8], got15[:8]))
            elif fv.get("bytes") != os.path.getsize(fpath):
                problems.append("R15 %s files[%s] 声明 bytes=%r ≠ 站点字节 %d"
                                % (name15, fn, fv.get("bytes"), os.path.getsize(fpath)))
    # R12（2026-10-17，内容仓 mail/029/030 —— description/links 进规范键）：
    #   **货架条目的 description/links 必须与货架档案对账**（透传键 = 单一产地；
    #   "我这侧对" ≠ "装配器吃到" —— 第五、六例教训之后的第七例对账器）。
    #   判据：站点条目的 description == 档案 upstream.description（string），
    #   links == 档案 upstream.links（逐字）。**缺省同步**：档案没有 upstream 块 ⇒
    #   站点必须是 "" / []（不许编、也不许漏键）。
    #   反向可证伪：站点 description 改一个字 ⇒ 必红（自证里有）。
    #   ⚠️ 只对货架条目（url 在 assets/forge/ 下）：能力层/生产者表条目的描述
    #   由它们自己的生产者负责（本仓货架档案不是那类条目的产地）。
    for p in packs:
        u = p.get("url") or ""
        if not u.startswith("assets/forge/"):
            continue
        name = p.get("name", "?")
        sp = os.path.join(shelf_dir, "packages", name + ".json")
        try:
            with open(sp, encoding="utf-8") as fh:
                doc = json.load(fh)
        except (OSError, ValueError):
            continue                                   # R2 已报"货架档案不在/坏"，不重复
        up = doc.get("upstream") or {}
        want_d = up.get("description", "") or ""
        want_l = up.get("links") or []
        got_d = p.get("description")
        if got_d is None:
            problems.append("R12 %s 缺 description 键（透传键必须恒在；缺省空串）"
                            % name)
        elif got_d != want_d:
            problems.append("R12 %s description 与货架档案不符（透传键 = 单一产地："
                            "站点 %r… ≠ 档案 %r…）" % (name, str(got_d)[:40], str(want_d)[:40]))
        got_l = p.get("links")
        if got_l is None:
            problems.append("R12 %s 缺 links 键（透传键必须恒在；缺省空数组）" % name)
        elif got_l != want_l:
            problems.append("R12 %s links 与货架档案不符（逐字对账；站点 %d 条 ≠ 档案 %d 条"
                            "或内容有漂）" % (name, len(got_l) if isinstance(got_l, list) else -1,
                                            len(want_l) if isinstance(want_l, list) else -1))

    # R13（★ 2026-10-18，判决 NOTES-release-model §3B / §6 第 3 步）：**预编译件发布判据**。
    #   一个 `artifacts[]` 条目声称"这个包的这一架构已发布" ⇒ 必须能被站点字节证明：
    #     B2 逐文件 sha：artifact.files 里的每个 name 在站点上真在、且 sha 相符；
    #        反向：站点目录里**多出来的** `.oct` 也必报（多一件 = 目录与发布记录不一致）；
    #     B3 架构纯度：每个 `.oct` 的**机器派生**架构 == artifact.arch（不看目录名）；
    #     B1 唯一性：同一 entry 内 (arch,octave,toolchain,recipe) 不重复（校验器也判，这里再判一次
    #        —— 站点闸门是最后一道，不依赖上游闸门跑过）。
    #   反向可证伪：把任一文件 sha 改一位 / 声明 arch 与字节不符 / 站点多一个 .oct ⇒ 必红（自证里有）。
    for p in packs:
        arts = p.get("artifacts")
        if not isinstance(arts, list):
            continue
        seen_a = set()
        for ai, a in enumerate(arts):
            if not isinstance(a, dict):
                continue
            an = p.get("name", "?")
            ident = (a.get("arch"), a.get("octave"), a.get("toolchain"), a.get("recipe"))
            if ident in seen_a:
                problems.append("R13 %s artifacts[%d] 的 (arch,octave,toolchain,recipe)=%r 重复"
                                "（B1 唯一性：一个架构一个配方只许一份）" % (an, ai, ident))
            seen_a.add(ident)
            if a.get("stage") == "withheld":
                if not a.get("withheld_cause"):
                    problems.append("R13 %s artifacts[%d] 是 withheld 却没写 cause" % (an, ai))
                continue
            arch_claim = a.get("arch")
            url = a.get("url") or ""
            d = os.path.join(site_dir, url)
            if not url or not os.path.isdir(d):
                problems.append("R13 %s artifacts[%d] 声称 staged 但站点目录不在：%s"
                                % (an, ai, url or "(无 url)"))
                continue
            want_files = {f.get("name"): f.get("sha256") for f in (a.get("files") or [])
                          if isinstance(f, dict) and f.get("name")}
            if not want_files:
                problems.append("R13 %s artifacts[%d] 是 staged 却没有 files" % (an, ai))
                continue
            have = sorted(n for n in os.listdir(d) if n.endswith(".oct"))
            for fn, want_sha in want_files.items():
                fp = os.path.join(d, fn)
                if not os.path.isfile(fp):
                    problems.append("R13 %s artifacts[%d] 记录的文件不在站点：%s" % (an, ai, fn))
                    continue
                got_sha = sha_of(fp)
                if got_sha != want_sha:
                    problems.append("R13 %s artifacts[%d] %s 的 sha=%s ≠ 记录 %s（B2 逐文件对账）"
                                    % (an, ai, fn, got_sha[:12], str(want_sha)[:12]))
                    continue
                got_arch = _arch_of_oct(fp)
                if arch_claim and got_arch and got_arch != arch_claim:
                    problems.append("R13 %s artifacts[%d] %s 的派生架构=%s ≠ 声明的 %s（B3）"
                                    % (an, ai, fn, got_arch, arch_claim))
            extra = [n for n in have if n not in want_files]
            if extra:
                problems.append("R13 %s artifacts[%d] 站点目录里有记录之外的 .oct：%s（多一件 = "
                                "目录与发布记录不一致）" % (an, ai, ", ".join(extra[:3])))
    return problems, []


def _arch_of_oct(path):
    """`.oct` 的架构（判据唯一产地 = `build/113/oct-arch.py`；读不出 ⇒ ""）。"""
    try:
        import importlib.util as _iu
        vp = os.path.join(REPO, "build", "113", "oct-arch.py")
        spec = _iu.spec_from_file_location("_oa13", vp)
        mod = _iu.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod.arch_of_file(path)
    except Exception:
        return ""


def arch_probe(d):
    """目录里 `.oct` 的架构（全部同档才返回它；目录空/混杂/读不出 ⇒ ""）。
    判据复用 `build/113/oct-arch.py`（纯 stdlib，与装配器同一产地）。"""
    try:
        import importlib.util as _iu
        vp = os.path.join(REPO, "build", "113", "oct-arch.py")
        spec = _iu.spec_from_file_location("_oa", vp)
        mod = _iu.module_from_spec(spec)
        spec.loader.exec_module(mod)
    except Exception:
        return ""
    try:
        names = [n for n in sorted(os.listdir(d)) if n.endswith(".oct")]
    except OSError:
        return ""
    if not names:
        return ""                       # 目录空 ⇒ 不表态（不是 wasm32）
    got = set()
    for n in names:
        got.add(mod.arch_of_file(os.path.join(d, n)))
    return got.pop() if len(got) == 1 and "unknown" not in got else ""


def capability_names(recipes_dir):
    """已知能力层名 = `recipes/*.md` 的 basename（与内容仓同款产地：**每家能力层必须有一份配方**）。
    读不到目录 ⇒ []（宁缺勿假 —— 那会让 R9 的 ② 档失效，退化成"能力层边全是 typo"的严判）。"""
    try:
        return {n[:-3] for n in os.listdir(recipes_dir) if n.endswith(".md")}
    except OSError:
        return set()


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
                shelf_versions=None, ac_init="11.3.0", recipes=None):
    """造最小夹具：repo/upstream/octave/configure.ac + repo/shelf + repo/site。"""
    os.makedirs(os.path.join(tmp, "upstream", "octave"))
    with open(os.path.join(tmp, "upstream", "octave", "configure.ac"), "w") as fh:
        fh.write("AC_INIT([GNU Octave], [%s], [bugs])\n" % ac_init)
    shelf_dir = os.path.join(tmp, "shelf", "packages")
    os.makedirs(shelf_dir)
    if recipes:
        rec_dir = os.path.join(tmp, "shelf", "recipes")
        os.makedirs(rec_dir)
        for r in recipes:
            open(os.path.join(rec_dir, r + ".md"), "w").write("# %s\n" % r)
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
            "url": "assets/forge/%s-%s.tar.gz" % (name, version), "kinds": list(kinds),
            # 2026-10-17 起 resolve() 恒产透传键（缺省空值不省键）⇒ 夹具同形（R12 对账）
            "description": "", "links": []}


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
        # R9（完整闭合，2026-10-15，回应内容仓 mail/012/014）—— 三档：
        #   ① 表内闭合 / ② 合法缺席（已知能力层名）/ ③ typo ⇒ 必红
        def _r9_probs(d):
            return check("site", "shelf", repo=d, sha_of=sha256_file, has_oct=no_oct)[0]
        # ① 正常：deps 指向同表内条目 ⇒ 不报
        d = _mk_fixture(os.path.join(tmp, "r9_ok"), [
            _pack(name="a", sha=good_sha), _pack(name="b", sha=good_sha)], blob_sha=data)
        _cat = os.path.join(d, "site", "assets", "forge-catalog.json")
        _d0 = json.load(open(_cat)); _d0["packs"][0]["deps"] = ["b"]
        json.dump(_d0, open(_cat, "w"))
        cases.append(("R9：deps 指向**同表**条目 ⇒ 不报（表内闭合）",
                      lambda d=d: _r9_probs(d) == []))
        # ② 合法缺席：deps 指向**已知能力层名**（recipes/pyodide.md 声明）⇒ 不报
        d = _mk_fixture(os.path.join(tmp, "r9_cap"), [_pack(name="a", sha=good_sha)],
                        blob_sha=data, recipes=["pyodide"])
        _cat = os.path.join(d, "site", "assets", "forge-catalog.json")
        _d0 = json.load(open(_cat)); _d0["packs"][0]["deps"] = ["pyodide"]
        json.dump(_d0, open(_cat, "w"))
        cases.append(("★ R9 ②：deps 指向**已知能力层名**（未供）⇒ 不报（合法缺席，非缺陷）",
                      lambda d=d: _r9_probs(d) == []))
        # ③ typo：deps 指向既不在表、又不是能力层名的东西 ⇒ 必红
        d = _mk_fixture(os.path.join(tmp, "r9_typo"), [_pack(name="a", sha=good_sha)],
                        blob_sha=data, recipes=["pyodide"])
        _cat = os.path.join(d, "site", "assets", "forge-catalog.json")
        _d0 = json.load(open(_cat)); _d0["packs"][0]["deps"] = ["pyodid"]
        json.dump(_d0, open(_cat, "w"))
        cases.append(("★ R9 ③ 反向：deps 是 typo / 未知名 ⇒ 必须报（这正是 R9 要抓的）",
                      lambda d=d: any("R9" in p for p in _r9_probs(d))))
        # ③b 反面：没有 recipes 目录（能力层名集为空）⇒ 同一 typo 仍必红（② 档不假阳）
        d = _mk_fixture(os.path.join(tmp, "r9_norec"), [_pack(name="a", sha=good_sha)],
                        blob_sha=data)
        _cat = os.path.join(d, "site", "assets", "forge-catalog.json")
        _d0 = json.load(open(_cat)); _d0["packs"][0]["deps"] = ["pyodide"]
        json.dump(_d0, open(_cat, "w"))
        cases.append(("★ R9 ③b：无 recipes 目录 ⇒ 能力层名集空 ⇒ 该 dep 判 typo 必红（不拿空当合法）",
                      lambda d=d: any("R9" in p for p in _r9_probs(d))))

        # ★ R4 反方向（N2，2026-10-16）：claim 含 oct 而字节里 0 个 ⇒ 必红
        def _r4_rev(d2):
            import io as _io4, tarfile as _tf4
            buf = _io4.BytesIO()
            with _tf4.open(fileobj=buf, mode="w:gz") as tf:
                b = b"function y=f(); end"
                ti = _tf4.TarInfo("x/inst/f.m"); ti.size = len(b)
                tf.addfile(ti, _io4.BytesIO(b))
            blob = buf.getvalue()
            return _mk_fixture(d2, [_pack(name="pkgx", sha=hashlib.sha256(blob).hexdigest(),
                                          kinds=("m", "oct"))], blob_sha=blob)
        d = _r4_rev(os.path.join(tmp, "r4_rev"))
        cases.append(("★ R4 反向（N2）：kinds 说含 oct 但字节里 0 个 .oct ⇒ 必须报",
                      lambda d=d: any("R4" in p and "含" in p for p in check(
                          "site", "shelf", repo=d, sha_of=sha256_file, has_oct=tarball_has_oct)[0])))

        # R11（★ N1）：宿主自产目录必须过端口校验器 —— 正反各一
        d = _mk_fixture(os.path.join(tmp, "r11_ok"), [_pack(sha=good_sha)], blob_sha=data)
        cases.append(("R11：宿主自产目录合规 ⇒ 不报（现役形状）",
                      lambda d=d: _r9_probs(d) == []))
        d = _mk_fixture(os.path.join(tmp, "r11_bad"), [_pack(sha=good_sha)], blob_sha=data)
        _cat = os.path.join(d, "site", "assets", "forge-catalog.json")
        _d0 = json.load(open(_cat))
        _d0["packs"][0]["arch"] = ""            # ← 词表外的值（N2 的真形态就是空串）
        json.dump(_d0, open(_cat, "w"))
        cases.append(("★ R11 反向：宿主自产目录的 arch 是空串 ⇒ 必须报（关 N1 后门）",
                      lambda d=d: any("R11" in p for p in _r9_probs(d))))

        # R10（架构界，2026-10-16）—— 用**真字节**造夹具（真 wasm side module）
        def _mk_oct(arch):
            import importlib.util as _iu
            vp = os.path.join(REPO, "build", "113", "oct-arch.py")
            spec = _iu.spec_from_file_location("_oa2", vp)
            mod = _iu.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod._mk_side_module(arch)
        def _r10_fixture(tmp2, oct_arch_in_site, entry_arch):
            # ⚠️ 用**真字节 + 真 sha**：R10 读的是站点里 .oct 的实际字节，所以这条条目的
            #   `url`/`sha256` 必须与该字节自洽（否则先被 R7 的 sha 判据拦下，测不到 R10）。
            blob = _mk_oct(oct_arch_in_site)
            d2 = _mk_fixture(tmp2, [_pack(name="pkgx", sha=hashlib.sha256(blob).hexdigest(),
                                          kinds=("m", "oct"))], blob_sha=blob)
            od = os.path.join(d2, "site", "assets", "oct-w64")
            os.makedirs(od)
            octp = os.path.join(od, "a.oct")
            open(octp, "wb").write(blob)
            catp = os.path.join(d2, "site", "assets", "forge-catalog.json")
            doc = json.load(open(catp))
            doc["packs"][0]["url"] = "assets/oct-w64/a.oct"
            doc["packs"][0]["sha256"] = hashlib.sha256(blob).hexdigest()
            doc["packs"][0]["content"] = ["m", "oct"]
            doc["packs"][0]["kinds"] = ["m", "oct"]
            doc["packs"][0]["arch"] = entry_arch
            # 货架档案也要与 (version, sha) 对上（R2）—— 改名避开与 demo 碰撞
            shelf_p = os.path.join(d2, "shelf", "packages", "pkgx.json")
            json.dump({"name": "pkgx", "versions": [
                {"version": doc["packs"][0]["version"],
                 "sha256": hashlib.sha256(blob).hexdigest()}]}, open(shelf_p, "w"))
            json.dump(doc, open(catp, "w"))
            return d2
        d = _r10_fixture(os.path.join(tmp, "r10_ok"), "wasm64", "wasm64")
        cases.append(("R10：条目 arch=wasm64 且站点 oct-w64/ 里是真 wasm64 ⇒ 不报",
                      lambda d=d: _r9_probs(d) == []))
        d = _r10_fixture(os.path.join(tmp, "r10_bad"), "wasm32", "wasm64")
        cases.append(("★ R10 反向：条目说 wasm64 而站点 oct-w64/ 里实际是 wasm32 ⇒ 必须报",
                      lambda d=d: any("R10" in p for p in _r9_probs(d))))
        d = _r10_fixture(os.path.join(tmp, "r10_bad2"), "wasm64", "wasm32")
        cases.append(("★ R10 反向：条目说 wasm32 而站点实际是 wasm64 ⇒ 必须报",
                      lambda d=d: any("R10" in p for p in _r9_probs(d))))

        # R12（2026-10-17，description/links 对账）—— 正反各钉住
        def _r12_fixture(tmp2, site_desc, site_links, shelf_upstream=None, drop_keys=False):
            d2 = _mk_fixture(tmp2, [_pack(sha=good_sha)], blob_sha=data)
            if shelf_upstream is not None:
                sp = os.path.join(d2, "shelf", "packages", "demo.json")
                doc = json.load(open(sp))
                doc["upstream"] = shelf_upstream
                json.dump(doc, open(sp, "w"))
            catp = os.path.join(d2, "site", "assets", "forge-catalog.json")
            cd = json.load(open(catp))
            if drop_keys:
                cd["packs"][0].pop("description", None)
                cd["packs"][0].pop("links", None)
            else:
                cd["packs"][0]["description"] = site_desc
                cd["packs"][0]["links"] = site_links
            json.dump(cd, open(catp, "w"))
            return d2
        _UP = {"description": "A demo package.",
               "links": [{"label": "news", "url": "https://n"}]}
        d = _r12_fixture(os.path.join(tmp, "r12_ok"),
                         "A demo package.", _UP["links"], shelf_upstream=_UP)
        cases.append(("R12：description/links 与货架档案逐字一致 ⇒ 不报",
                      lambda d=d: _r9_probs(d) == []))
        d = _r12_fixture(os.path.join(tmp, "r12_ok_empty"), "", [], shelf_upstream=None)
        cases.append(("R12：档案无 upstream 块 ⇒ 站点是空串/空数组 ⇒ 不报（缺省同步）",
                      lambda d=d: _r9_probs(d) == []))
        d = _r12_fixture(os.path.join(tmp, "r12_drift"),
                         "A demo package (drifted).", _UP["links"], shelf_upstream=_UP)
        cases.append(("★ R12 反向：站点 description 漂了一个字 ⇒ 必须报（透传键单一产地）",
                      lambda d=d: any("R12" in p and "description" in p for p in _r9_probs(d))))
        d = _r12_fixture(os.path.join(tmp, "r12_drop"), None, None,
                         shelf_upstream=_UP, drop_keys=True)
        cases.append(("★ R12 反向：透传键整个缺失 ⇒ 必须报（缺省 = 空值，不是缺键）",
                      lambda d=d: any("R12" in p and "缺" in p for p in _r9_probs(d))))

        # R13（2026-10-18，预编译件发布判据）—— 正反各钉住
        def _r13_fixture(tmp2, mutate=None):
            d2 = _mk_fixture(tmp2, [_pack(sha=good_sha)], blob_sha=data)
            od = os.path.join(d2, "site", "assets", "octdir", "demo")
            os.makedirs(od)
            blob = _mk_oct("wasm32")
            fn = os.path.join(od, "a.oct")
            open(fn, "wb").write(blob)
            art = {"arch": "wasm32", "form": "octdir", "url": "assets/octdir/demo/",
                   "stage": "staged", "octave": "11.3.0", "toolchain": "t", "recipe": "O2",
                   "files": [{"name": "a.oct",
                              "sha256": hashlib.sha256(blob).hexdigest(),
                              "size": len(blob)}]}
            catp = os.path.join(d2, "site", "assets", "forge-catalog.json")
            cd = json.load(open(catp))
            cd["packs"][0]["artifacts"] = [art]
            if mutate:
                mutate(cd["packs"][0], od, blob)
            json.dump(cd, open(catp, "w"))
            return d2
        d = _r13_fixture(os.path.join(tmp, "r13_ok"))
        cases.append(("R13：artifact 与站点字节逐文件对账 ⇒ 不报",
                      lambda d=d: _r9_probs(d) == []))
        d = _r13_fixture(os.path.join(tmp, "r13_badsha"),
                         lambda pk, od, b: pk["artifacts"][0]["files"][0].update(sha256="b" * 64))
        cases.append(("★ R13 反向：记录 sha 与站点字节不符 ⇒ 必须红（B2）",
                      lambda d=d: any("R13" in p and "B2" in p for p in _r9_probs(d))))
        d = _r13_fixture(os.path.join(tmp, "r13_badarch"),
                         lambda pk, od, b: pk["artifacts"][0].update(arch="wasm64"))
        cases.append(("★ R13 反向：声明 arch 与字节派生不符 ⇒ 必须红（B3）",
                      lambda d=d: any("R13" in p and "B3" in p for p in _r9_probs(d))))
        d = _r13_fixture(os.path.join(tmp, "r13_extra"),
                         lambda pk, od, b: open(os.path.join(od, "extra.oct"), "wb").write(b"X"))
        cases.append(("★ R13 反向：站点目录多一个记录外的 .oct ⇒ 必须红（目录↔记录不一致）",
                      lambda d=d: any("R13" in p and "记录之外" in p for p in _r9_probs(d))))
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

        # ★ R14（mail/057 §2 兄弟目录硬约束）：engine 条目 size == url 目录实测和；
        #   混进别的资产（MSL zip）⇒ 必红。
        def _r14_fixture(tmp3, extra=0):
            d3 = _mk_fixture(tmp3, [_pack(sha=good_sha)], blob_sha=data)
            omcd = os.path.join(d3, "site", "omc")
            os.makedirs(omcd)
            open(os.path.join(omcd, "OpenModelicaCompiler_bg.wasm"), "wb").write(b"OMW")
            if extra:
                open(os.path.join(omcd, "msl-4.1.0.zip"), "wb").write(b"Z" * extra)
            catp = os.path.join(d3, "site", "assets", "forge-catalog.json")
            cd = json.load(open(catp))
            cd["packs"].append({
                "name": "omc", "version": "unversioned", "form": "tree",
                "kind": "engine", "role": "toolchain", "arch": "omc",
                "content": [], "consumer": ["octave"],
                "sha256": hashlib.sha256(b"OMW").hexdigest(),
                "url": "omc/OpenModelicaCompiler_bg.wasm",
                "size": 3, "deps": []})
            json.dump(cd, open(catp, "w"))
            return d3

        d14ok = _r14_fixture(os.path.join(tmp, "r14_ok"))
        cases.append(("R14：engine 条目 size == url 目录实测和 ⇒ 不报（兄弟目录干净）",
                      lambda d=d14ok: not any("R14" in p for p in check(
                          "site", "shelf", repo=d, sha_of=sha256_file, has_oct=no_oct)[0])))
        d14bad = _r14_fixture(os.path.join(tmp, "r14_bad"), extra=5)
        cases.append(("★ R14 反向：MSL 类资产混进 omc/ ⇒ size 与目录实测不符 ⇒ 必须报"
                      "（兄弟目录硬约束）",
                      lambda d=d14bad: any("R14" in p for p in check(
                          "site", "shelf", repo=d, sha_of=sha256_file, has_oct=no_oct)[0])))

        # ★ R15（mail/090 + 工单 69，2026-10-26）：files[] 与站点字节逐件对账 ——
        #   正常投影不报；篡改 sha / 列缺件 ⇒ 必红。
        def _r15_fixture(tmp3, tamper=None, drop=None):
            d3 = _mk_fixture(tmp3, [_pack(sha=good_sha)], blob_sha=data)
            omcd = os.path.join(d3, "site", "omc")
            os.makedirs(omcd)
            open(os.path.join(omcd, "OpenModelicaCompiler_bg.wasm"), "wb").write(b"OMW")
            open(os.path.join(omcd, "OpenModelicaCompiler.js"), "wb").write(b"JS")
            f15 = {"OpenModelicaCompiler_bg.wasm":
                   {"bytes": 3, "sha256": hashlib.sha256(b"OMW").hexdigest()},
                   "OpenModelicaCompiler.js":
                   {"bytes": 2, "sha256": hashlib.sha256(b"JS").hexdigest()}}
            if tamper:
                f15[tamper]["sha256"] = "f" * 64
            if drop:
                f15[drop] = {"bytes": 9, "sha256": "a" * 64}   # 站点里没有的文件
            catp = os.path.join(d3, "site", "assets", "forge-catalog.json")
            cd = json.load(open(catp))
            cd["packs"].append({
                "name": "omc", "version": "unversioned", "form": "tree",
                "kind": "engine", "role": "toolchain", "arch": "omc",
                "content": [], "consumer": ["omc"],
                "sha256": hashlib.sha256(b"OMW").hexdigest(),
                "url": "omc/OpenModelicaCompiler_bg.wasm",
                "size": 5, "deps": [], "files": f15})
            json.dump(cd, open(catp, "w"))
            return d3

        d15ok = _r15_fixture(os.path.join(tmp, "r15_ok"))
        cases.append(("R15：files[] 与站点字节逐件相符（.d.ts 不列，和≠size 是设计）⇒ 不报",
                      lambda d=d15ok: not any("R15" in p for p in check(
                          "site", "shelf", repo=d, sha_of=sha256_file, has_oct=no_oct)[0])))
        d15sha = _r15_fixture(os.path.join(tmp, "r15_sha"), tamper="OpenModelicaCompiler.js")
        cases.append(("★ R15 反向：files 一件 sha 与站点字节不符 ⇒ 必须报（fail-closed）",
                      lambda d=d15sha: any("R15" in p and "OpenModelicaCompiler.js" in p
                                           for p in check(
                                               "site", "shelf", repo=d, sha_of=sha256_file,
                                               has_oct=no_oct)[0])))
        d15ghost = _r15_fixture(os.path.join(tmp, "r15_ghost"), drop="ghost.js")
        cases.append(("★ R15 反向：files 列了站点没有的文件 ⇒ 必须报（闭包预算错件）",
                      lambda d=d15ghost: any("R15" in p and "ghost.js" in p for p in check(
                          "site", "shelf", repo=d, sha_of=sha256_file, has_oct=no_oct)[0])))

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
