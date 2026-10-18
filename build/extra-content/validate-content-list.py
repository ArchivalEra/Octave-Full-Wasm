#!/usr/bin/env python3
# Octave-Full-Wasm — **额外内容端口校验器**（接缝 §4；产地 = 本目录）
# Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么存在：接缝 §4 定了「端口 = 应用核心的接受面」，而 §8.1 的裁决（2026-10-14）把
# **产地钉在本目录**（`build/extra-content/`）。生产者（额外内容仓 / LLVM-wasm / …）
# 出一张**表**，消费者（宿主）按**同一份形状**读它。没有这个校验器，"形状一致"就只是散文
# —— 而本仓纪律（AGENTS.md C4）：**没有对账器的"必须一致"迟早不一致**。
#
# 它做三件事（都不要求宿主在场，这是"生产者能自证"的关键）：
#   ① 形状：表的顶层与每条记录必填字段齐全、类型对；
#   ② 词表：`form` / `content` 的取值来自 **schema 文件**（单一产地，不在本文件硬编码
#      —— 防"两处各写一份枚举"那种漂移）；
#   ③ 协商规则（接缝 §2）：未知键**默认 fail-closed**（撤下该条目），除非它在表的
#      `optional_keys` 里被显式声明为可选 —— **"忽略"是礼遇，不是默认**。
#
# stdout 裸值契约（平台闸门惯例）：`ok` / `PROBLEM: …`（逐条点名）。
# 退出码：0 = 合规；1 = 不合规（逐条点名）；2 = 用法错/读不到（fail-closed，不当通过）。
#
# 用法：
#   python3 build/extra-content/validate-content-list.py --list <表.json> [--producer ID] [--site]
#   python3 build/extra-content/validate-content-list.py --selftest
#   --site    ：交付态检查（url 必须是同源相对路径；上游绝对 URL ⇒ 报）
#   --max-schema N：消费者能理解的最高 schema（更高 ⇒ 条目级 quarantine，见 §2）
import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA_PATH = os.path.join(HERE, "content-list.schema.json")
# 规范键（**从 schema 的 properties 派生**，不在这里手写第二份 —— C4 对账器的用法）
REQUIRED_TOP = ("schema", "octave")
REQUIRED_ENTRY = ("name", "version", "sha256", "url")
ALIASES = ("entries", "packs")   # 二者同义，表里只许出现一个


def _load_schema(path=SCHEMA_PATH):
    """读 schema（唯一产地）。读不到 ⇒ 抛（fail-closed，不拿空当默认）。"""
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _enum(schema, *path):
    """从 schema 里取一个 enum（形如 _enum(s,'$defs','entry','properties','form','enum')）。"""
    cur = schema
    for k in path:
        cur = cur[k]
    return list(cur)


def check_table(doc, producer=None, site=False, max_schema=None, schema=None):
    """纯函数：表 → 问题清单（[] = 合规）。**注入 schema**，自证直接喂夹具。"""
    schema = schema if schema is not None else _load_schema()
    form_enum = _enum(schema, "$defs", "entry", "properties", "form", "enum")
    content_enum = _enum(schema, "$defs", "entry", "properties", "content", "items", "enum")
    consumer_enum = _enum(schema, "$defs", "entry", "properties", "consumer", "items", "enum")
    arch_enum = _enum(schema, "$defs", "entry", "properties", "arch", "enum")
    entry_keys = set(schema["$defs"]["entry"]["properties"].keys())

    probs = []
    if not isinstance(doc, dict):
        return ["顶层必须是对象（得到 %s）" % type(doc).__name__]

    for k in REQUIRED_TOP:
        if k not in doc:
            probs.append("顶层缺必填键 %r" % k)
    if probs:
        return probs

    if not isinstance(doc["schema"], int):
        probs.append("schema 必须是整数（得到 %r）" % doc["schema"])
    if producer and doc.get("producer", {}).get("id") != producer:
        got = (doc.get("producer") or {}).get("id")
        probs.append("producer.id 不符：期望 %r，表里是 %r" % (producer, got))

    present = [a for a in ALIASES if a in doc]
    if not present:
        probs.append("缺条目数组：%s 里至少要有 %s 之一" % (list(ALIASES), list(ALIASES)))
        return probs
    if len(present) > 1:
        probs.append("同时出现 %s —— 二者同义，只许有一个" % present)

    entries = doc[present[0]]
    if not isinstance(entries, list) or not entries:
        probs.append("%s 必须是非空数组（空表不是通过 —— 零值守卫）" % present[0])
        return probs

    # 协商规则：哪些未知键被声明为可选（可被旧消费者忽略）
    optional = set(doc.get("optional_keys") or [])

    # schema 版本协商：更高 ⇒ 条目级 quarantine（这里报出来，由调用方决定 quarantine 还是拒）
    if max_schema is not None and doc["schema"] > max_schema:
        probs.append("schema=%d 高于消费者上限 %d ⇒ 全部条目 quarantine（不是静默忽略）"
                     % (doc["schema"], max_schema))

    for i, e in enumerate(entries):
        tag = "条目[%d]" % i
        if not isinstance(e, dict):
            probs.append("%s 不是对象" % tag)
            continue
        tag = "条目[%d] %r" % (i, e.get("name", "?"))
        for k in REQUIRED_ENTRY:
            if k not in e or e[k] in ("", None):
                probs.append("%s 缺必填字段 %r" % (tag, k))
        sh = e.get("sha256")
        if isinstance(sh, str) and not re.fullmatch(r"[0-9a-f]{64}", sh):
            probs.append("%s sha256 不是 64 位小写 hex（得到 %r）" % (tag, sh[:16] + "…"))
        # 词表
        if "form" in e and e["form"] not in form_enum:
            probs.append("%s form=%r 不在词表 %s 里" % (tag, e["form"], form_enum))
        if "content" in e:
            for c in e["content"]:
                if c not in content_enum:
                    probs.append("%s content 含未知值 %r（词表 %s）" % (tag, c, content_enum))
        # 裁决①（2026-10-14）：`content` 只对包有意义 ⇒ 能力层（form:tree）必须留空
        if e.get("form") == "tree" and e.get("content"):
            probs.append("%s form=tree（能力层）的 content 必须为空 []（content 只对包有意义，"
                         "裁决见 schema 的 content 描述）：得到 %r" % (tag, e["content"]))
        # 裁决②（2026-10-14）：consumer 取值（可选；缺省归 octave）
        if "consumer" in e:
            for c in e["consumer"]:
                if c not in consumer_enum:
                    probs.append("%s consumer 含未知值 %r（词表 %s）" % (tag, c, consumer_enum))
        # license（裁决 2026-10-15）：**自由字符串，只查类型** —— 混合许可要如实记
        #   （枚举会逼生产者说谎或拆条）；「写对了没」没有机器判据，不假称有。
        if "license" in e and not isinstance(e["license"], (str, dict)):
            probs.append("%s license 必须是字符串或对象（自由文本即可 —— 裁决① 2026-10-15："
                         "不收紧成 SPDX 枚举）：得到 %s" % (tag, type(e["license"]).__name__))
        # description / links（2026-10-17 规范键定稿；内容仓 mail/029 出、mail/030 Q2 裁『内联』）：
        #   包级静态描述 + 文档链接（UI 卡片首屏数据）。**只查类型/结构** ——「写对了没」没有
        #   机器判据（同 license 的诚实边界）。links 的规范结构 = {label, url}（Q2 裁决②瘦身
        #   口径）；icon 等额外键是过渡期容忍（schema additionalProperties），不作承诺。
        if "description" in e and not isinstance(e["description"], str):
            probs.append("%s description 必须是字符串（包级一条；合法缺省空串）：得到 %s"
                         % (tag, type(e["description"]).__name__))
        if "links" in e:
            if not isinstance(e["links"], list):
                probs.append("%s links 必须是数组（合法缺省 []）：得到 %s"
                             % (tag, type(e["links"]).__name__))
            else:
                for i, lk in enumerate(e["links"]):
                    if (not isinstance(lk, dict) or not isinstance(lk.get("label"), str)
                            or not isinstance(lk.get("url"), str)):
                        probs.append("%s links[%d] 必须是 {label: str, url: str}（瘦身口径；"
                                     "icon 等额外键过渡期容忍）：得到 %r" % (tag, i, lk))
                        break
        # versions[]（裁决 2026-10-16，内容仓 mail/018 §②「出，且只出已 stage 字节的版本」）：
        #   三条不变量逐条判（schema 的 versions 描述里也有全文）。
        if "versions" in e:
            vs = e["versions"]
            if not isinstance(vs, list) or not vs:
                probs.append("%s versions 必须是非空数组（零值守卫：空候选集不是通过）" % tag)
            else:
                seen_v, seen_vs = set(), set()
                for c in vs:
                    cv = c.get("version")
                    if not cv:
                        probs.append("%s 的候选缺 version" % tag)
                    elif cv in seen_v:
                        probs.append("%s 候选 version %r 重复（不变量 ①）" % (tag, cv))
                    seen_v.add(cv)
                    cs = c.get("sha256")
                    if isinstance(cs, str) and not re.fullmatch(r"[0-9a-f]{64}", cs):
                        probs.append("%s 候选 %s 的 sha256 不是 64 位小写 hex" % (tag, cv))
                    if (cv, cs) in seen_vs:
                        probs.append("%s 候选 (version,sha256) (%s,%s…) 重复（不变量 ①）" % (tag, cv, str(cs)[:8]))
                    seen_vs.add((cv, cs))
                    stage = c.get("stage", "staged")
                    if stage == "withheld":
                        if not c.get("withheld_cause"):
                            probs.append("%s 候选 %s 是 withheld 却没写 withheld_cause（不许白 withheld）" % (tag, cv))
                        if c.get("form") is not None or c.get("content") is not None or c.get("arch") is not None:
                            probs.append("%s 候选 %s 是 withheld 却带了派生轴（不变量 ③：派生不出 ⇒ 不许编）" % (tag, cv))
                    else:
                        if c.get("form") is None or c.get("content") is None:
                            probs.append("%s 候选 %s 是 staged 却缺派生轴 form/content（不变量 ③）" % (tag, cv))
                        cc = c.get("content") or []
                        if "oct" in cc and not c.get("arch"):
                            probs.append("%s 候选 %s 含 oct 却没带 arch（条目级三档语义对候选同样成立）" % (tag, cv))
                        if c.get("form") == "tree" and c.get("arch"):
                            probs.append("%s 候选 %s 是能力层（tree）却带 arch（架构与宿主无关）" % (tag, cv))
                hit = any(c.get("version") == e.get("version") and c.get("sha256") == e.get("sha256")
                          and c.get("url") == e.get("url") for c in vs)
                if not hit:
                    probs.append("%s 顶层标量 (version/sha256/url) 不等于任何候选（不变量 ②：兼容视图必须"
                                 "恰好是候选之一 —— 防两处各写一份漂移）" % tag)
        # artifacts[]（判决 2026-10-18，NOTES-release-model §4）：预编译件的三条不变量。
        #   发布单位 = (name, version, arch) 三元组；artifact **没有自己的 version**（版本锚定在条目上）。
        if "artifacts" in e:
            arts = e["artifacts"]
            if not isinstance(arts, list) or not arts:
                probs.append("%s artifacts 必须是非空数组（零值守卫：空候选集不是通过）" % tag)
            else:
                seen_id = set()
                for ai, a in enumerate(arts):
                    if not isinstance(a, dict):
                        probs.append("%s artifacts[%d] 不是对象" % (tag, ai))
                        continue
                    # ① 唯一性：(arch, octave, toolchain, recipe) 不得重复
                    ident = (a.get("arch"), a.get("octave"), a.get("toolchain"), a.get("recipe"))
                    if ident in seen_id:
                        probs.append("%s artifacts[%d] 的 (arch,octave,toolchain,recipe)=%r 重复"
                                     "（不变量 ①：一个架构一个配方只许一份 —— 要第二份必须换 recipe）"
                                     % (tag, ai, ident))
                    seen_id.add(ident)
                    # ② 版本锚定：artifact 不许自带 version 字段
                    if "version" in a:
                        probs.append("%s artifacts[%d] 带了 version=%r —— 预编译件**没有自己的版本**"
                                     "（不变量 ②：它只附着在条目顶层 version 上）"
                                     % (tag, ai, a.get("version")))
                    # ③ 不许编：arch 必须存在且在词表；staged 必须有 files；withheld 必须带 cause
                    if not a.get("arch"):
                        probs.append("%s artifacts[%d] 缺 arch（不变量 ③：架构必须由字节派生，不许省）"
                                     % (tag, ai))
                    stage = a.get("stage", "staged")
                    if stage == "withheld":
                        if not a.get("withheld_cause"):
                            probs.append("%s artifacts[%d] 是 withheld 却没写 withheld_cause（不许白 withheld）"
                                         % (tag, ai))
                    else:
                        fs = a.get("files")
                        if not isinstance(fs, list) or not fs:
                            probs.append("%s artifacts[%d] 是 staged 却没有 files（不变量 ③：逐文件 sha 是"
                                         "fail-closed 的唯一依据）" % (tag, ai))
                        else:
                            for f in fs:
                                if not isinstance(f, dict) or not f.get("name"):
                                    probs.append("%s artifacts[%d] 的 files 项缺 name" % (tag, ai))
                                    break
                                sh = f.get("sha256")
                                if not (isinstance(sh, str) and re.fullmatch(r"[0-9a-f]{64}", sh)):
                                    probs.append("%s artifacts[%d] 的文件 %r sha256 不是 64 位小写 hex"
                                                 % (tag, ai, f.get("name")))
                                    break
        # arch（裁决 2026-10-16，用户点令「楚河汉界」）：**只在"要 dlopen 进宿主的东西"上标**。
        #   三档语义（schema 的 arch 描述里也有全文）：
        #     ① 纯 .m（content 不含 oct，且 form 不是 oct/octdir）⇒ **不许带** arch（无架构概念）
        #     ② 含 .oct ⇒ **必须带**，取值 ∈ 词表
        #     ③ 能力层（form:tree）⇒ **不许带**（自带运行时，架构与宿主无关）
        if "arch" in e:
            if e["arch"] not in arch_enum:
                probs.append("%s arch=%r 不在词表 %s 里" % (tag, e["arch"], arch_enum))
            needs_arch = ("oct" in (e.get("content") or [])) or (e.get("form") in ("oct", "octdir"))
            if not needs_arch:
                why = ("能力层（form:tree）自带运行时，架构与宿主无关" if e.get("form") == "tree"
                       else "纯 .m 条目没有架构概念（任何档都能装）")
                probs.append("%s 带了 arch=%r 但本条目**不需要架构标注** —— %s（裁决 2026-10-16）"
                             % (tag, e["arch"], why))
        else:
            needs_arch = ("oct" in (e.get("content") or [])) or (e.get("form") in ("oct", "octdir"))
            if needs_arch:
                probs.append("%s 含 .oct（content/form 指明）却**没带 arch** —— 要 dlopen 进宿主的东西"
                             "必须标架构（裁决 2026-10-16）" % tag)
        # 站点态：url 必须同源相对（COEP 拦跨域）
        if site and isinstance(e.get("url"), str) and re.match(r"^[a-z]+://", e["url"]):
            probs.append("%s 站点态 url 是绝对地址（%s…）⇒ 必须同源相对"
                         % (tag, e["url"][:40]))
        # ★ 协商规则：未知键默认 fail-closed，除非显式声明 optional
        unknown = set(e.keys()) - entry_keys - optional
        if unknown:
            probs.append("%s 含未知键 %s ⇒ 撤下该条目（fail-closed；要忽略请列进表的 "
                         "optional_keys）" % (tag, sorted(unknown)))
    return probs


# ── 自证：三类用例齐备（正常不报 / 该报的必须报 / 空输入必须报）────────────────
def _good(schema):
    return {"schema": 2, "octave": "11.3.0", "producer": {"id": "x", "pin": "submodule:abc"},
            "entries": [{"name": "optim", "version": "1.6.3", "sha256": "a" * 64,
                         "url": "assets/forge/optim-1.6.3.tar.gz", "form": "pkg",
                         "content": ["m", "src"], "deps": ["statistics"]}]}


def selftest():
    schema = _load_schema()
    cases = []

    def add(name, fn, want_ok):
        cases.append((name, fn, want_ok))

    # ① 正常不报
    add("正常表 ⇒ 不报", lambda: check_table(_good(schema), schema=schema), True)
    add("兼容键 packs（单独用）⇒ 不报（别名）", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "packs": _good(schema)["entries"]},
        schema=schema), True)
    add("form=tree 的能力层条目 ⇒ 不报", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            {"name": "pyodide", "version": "314.0.7", "sha256": "b" * 64,
             "url": "assets/pyodide/core.tar.bz2", "form": "tree"}]}, schema=schema), True)
    add("声明 optional_keys 后，未知键可忽略 ⇒ 不报", lambda: check_table(
        {**_good(schema),
         "entries": [{**_good(schema)["entries"][0], "x_future": 1}],
         "optional_keys": ["x_future"]}, schema=schema), True)

    add("裁决①：form=tree 且 content=[] ⇒ 不报", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            {"name": "pyodide", "version": "1", "sha256": "b" * 64,
             "url": "assets/x.tar", "form": "tree", "content": []}]}, schema=schema), True)
    add("★ 裁决①反向：form=tree 却带 content ⇒ 必须报", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            {"name": "pyodide", "version": "1", "sha256": "b" * 64,
             "url": "assets/x.tar", "form": "tree", "content": ["wasm"]}]}, schema=schema), False)
    add("裁决②：consumer=[\"omc\"] ⇒ 不报", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            {"name": "msl", "version": "1", "sha256": "c" * 64,
             "url": "assets/msl.tar", "form": "tree", "content": [], "consumer": ["omc"]}]},
        schema=schema), True)
    add("★ 裁决②反向：consumer 未知值 ⇒ 必须报", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            {"name": "x", "version": "1", "sha256": "c" * 64,
             "url": "assets/x.tar", "consumer": ["wat"]}]}, schema=schema), False)
    # 裁决 2026-10-15（回应内容仓 mail/009 待确认②）：**「普通条目」不限制条数**
    add("★ 能力层可以有多条（LLVM 13 条形态）⇒ 不报", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            {"name": "llvm-clang.wasm", "version": "6.0.12", "sha256": "d" * 64,
             "url": "assets/llvm-wasm/clang.wasm", "form": "file"},
            {"name": "llvm-clang.js", "version": "6.0.12", "sha256": "e" * 64,
             "url": "assets/llvm-wasm/clang.js", "form": "js"},
            {"name": "llvm-sysroot.tar", "version": "6.0.12", "sha256": "f" * 64,
             "url": "assets/llvm-wasm/sysroot.tar", "form": "tree"}]}, schema=schema), True)
    add("★ 能力层缺 consumer ⇒ 不报（裁决②：consumer 可选、缺省 octave）", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            {"name": "cap", "version": "1", "sha256": "b" * 64,
             "url": "assets/cap/x.tar", "form": "tree", "content": []}]}, schema=schema), True)
    # 裁决 2026-10-15（回应内容仓 mail/009 待确认①）：license 保持自由字符串
    add("★ license 混合许可自由文本（LLVM 形态）⇒ 不报", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            {"name": "tar", "version": "1", "sha256": "a" * 64, "url": "u", "form": "tree",
             "license": "mixed (see LICENSE-LLVM.txt, LICENSE-EMSCRIPTEN.txt)"}]},
        schema=schema), True)
    add("★ license 是数字（类型错）⇒ 必须报", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            {"name": "a", "version": "1", "sha256": "a" * 64, "url": "u",
             "license": 42}]}, schema=schema), False)
    # arch（裁决 2026-10-16「楚河汉界」）：三档语义 —— 正反各钉住
    add("★ arch ①：纯 .m 不带 arch ⇒ 不报", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            {"name": "a", "version": "1", "sha256": "a" * 64, "url": "u",
             "form": "pkg", "content": ["m"]}]}, schema=schema), True)
    add("★ arch ①反向：纯 .m 带 arch ⇒ 必须报（无架构概念的东西不许标）", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            {"name": "a", "version": "1", "sha256": "a" * 64, "url": "u",
             "form": "pkg", "content": ["m"], "arch": "wasm32"}]}, schema=schema), False)
    add("★ arch ②：含 .oct 且带 arch ⇒ 不报", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            {"name": "a", "version": "1", "sha256": "a" * 64, "url": "u",
             "form": "pkg", "content": ["m", "oct"], "arch": "wasm64"}]}, schema=schema), True)
    add("★ arch ②反向：含 .oct 却不带 arch ⇒ 必须报（要 dlopen 的必须标）", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            {"name": "a", "version": "1", "sha256": "a" * 64, "url": "u",
             "form": "pkg", "content": ["m", "oct"]}]}, schema=schema), False)
    add("★ arch ②：form=oct 单文件带 arch ⇒ 不报", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            {"name": "a", "version": "1", "sha256": "a" * 64, "url": "u",
             "form": "oct", "content": [], "arch": "wasm64"}]}, schema=schema), True)
    add("★ arch ③反向：能力层带 arch ⇒ 必须报（自带运行时，架构与宿主无关）", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            {"name": "cap", "version": "1", "sha256": "a" * 64, "url": "u",
             "form": "tree", "content": [], "arch": "wasm32"}]}, schema=schema), False)
    # versions[]（裁决 2026-10-16，内容仓 mail/018）：三条不变量正反各钉住
    def _mkent(**over):
        base = {"name": "p", "version": "1.0.0", "sha256": "a" * 64, "url": "u",
                "form": "pkg", "content": ["m"]}
        base.update(over); return base
    def _mkcand(**over):
        base = {"version": "1.0.0", "sha256": "a" * 64, "url": "u",
                "stage": "staged", "form": "pkg", "content": ["m"]}
        base.update(over); return base
    add("★ versions ①：候选 version 重复 ⇒ 必须报", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            _mkent(versions=[_mkcand(), _mkcand()])]}, schema=schema), False)
    add("★ versions ①b：空候选集 ⇒ 必须报（零值守卫）", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            _mkent(versions=[])]}, schema=schema), False)
    add("★ versions ②：顶层标量不等于任何候选 ⇒ 必须报（防两处漂移）", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            _mkent(version="9.9.9", versions=[_mkcand()])]}, schema=schema), False)
    add("★ versions ②正向：顶层标量恰等于候选 ⇒ 不报", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            _mkent(versions=[_mkcand(), _mkcand(version="0.9.0", stage="withheld",
                                                withheld_cause="bytes-not-staged",
                                                form=None, content=None)])]},
        schema=schema), True)
    add("★ versions ③：staged 候选缺派生轴 ⇒ 必须报", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            _mkent(versions=[_mkcand(form=None, content=None)])]}, schema=schema), False)
    add("★ versions ③：withheld 却带派生轴 ⇒ 必须报（不许编）", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            _mkent(versions=[_mkcand(stage="withheld", withheld_cause="bytes-not-staged")])]},
        schema=schema), False)
    add("★ versions ③：withheld 没写 cause ⇒ 必须报（不许白 withheld）", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            _mkent(versions=[_mkcand(stage="withheld", form=None, content=None)])]},
        schema=schema), False)
    add("★ versions：staged 候选含 oct 必带 arch（条目级三档同判）⇒ 必须报", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            _mkent(content=["m", "oct"], versions=[_mkcand(content=["m", "oct"])])]},
        schema=schema), False)
    add("★ arch 词表：wasm128 未知 ⇒ 必须报", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            {"name": "a", "version": "1", "sha256": "a" * 64, "url": "u",
             "form": "pkg", "content": ["oct"], "arch": "wasm128"}]}, schema=schema), False)

    # description/links（2026-10-17 规范键定稿）：正反各钉住
    # artifacts[]（判决 2026-10-18，NOTES-release-model §4）：三条不变量正反各钉住
    def _mka(**over):
        base = {"arch": "wasm32", "octave": "11.3.0", "toolchain": "emcc 6.0.12", "recipe": "O2",
                "form": "octdir", "files": [{"name": "a.oct", "sha256": "a" * 64}],
                "url": "assets/octdir/p/", "stage": "staged"}
        base.update(over); return base
    add("★ artifacts：合法形状（两架构各一份）⇒ 不报", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            {**_mkent(), "artifacts": [_mka(), _mka(arch="wasm64")]}]}, schema=schema), True)
    add("★ artifacts ①反向：同 arch+配方 两份 ⇒ 必须报（唯一性）", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            {**_mkent(), "artifacts": [_mka(), _mka()]}]}, schema=schema), False)
    add("★ artifacts ②反向：artifact 自带 version ⇒ 必须报（版本锚定在条目上）", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            {**_mkent(), "artifacts": [_mka(version="1.6.3")]}]}, schema=schema), False)
    add("★ artifacts ③反向：缺 arch ⇒ 必须报（不许省派生值）", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            {**_mkent(), "artifacts": [{k: v for k, v in _mka().items() if k != "arch"}]}]},
        schema=schema), False)
    add("★ artifacts ③反向：staged 但 files 空 ⇒ 必须报（逐文件 sha 是唯一依据）", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            {**_mkent(), "artifacts": [_mka(files=[])]}]}, schema=schema), False)
    add("★ artifacts ③：withheld 带 cause 不带 files ⇒ 不报（派生不出就如实 withheld）", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            {**_mkent(), "artifacts": [{"arch": "wasm64", "form": "octdir", "files": [],
                                        "stage": "withheld", "withheld_cause": "bytes-not-staged"}]}]},
        schema=schema), True)
    add("★ description/links：规范形状 ⇒ 不报", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            {"name": "a", "version": "1", "sha256": "a" * 64, "url": "u",
             "form": "pkg", "content": ["m"], "description": "A test package.",
             "links": [{"label": "news", "url": "https://n"},
                       {"label": "repository", "url": "https://r", "icon": "fas fa-rss"}]}]},
        schema=schema), True)
    add("★ description/links：合法缺省（空串/空数组）⇒ 不报", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            {"name": "a", "version": "1", "sha256": "a" * 64, "url": "u",
             "form": "pkg", "content": ["m"], "description": "", "links": []}]},
        schema=schema), True)
    add("★ description 反向：非字符串（数字）⇒ 必须报", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            {"name": "a", "version": "1", "sha256": "a" * 64, "url": "u",
             "form": "pkg", "content": ["m"], "description": 42}]}, schema=schema), False)
    add("★ links 反向：不是数组 ⇒ 必须报", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            {"name": "a", "version": "1", "sha256": "a" * 64, "url": "u",
             "form": "pkg", "content": ["m"], "links": {"news": "https://n"}}]},
        schema=schema), False)
    add("★ links 反向：缺 url 的链接项 ⇒ 必须报（瘦身口径 {label,url}）", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            {"name": "a", "version": "1", "sha256": "a" * 64, "url": "u",
             "form": "pkg", "content": ["m"], "links": [{"label": "news"}]}]},
        schema=schema), False)

    # ② 该报的必须报
    add("★ 空表 ⇒ 必须报", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": []}, schema=schema), False)
    add("★ 缺 entries/packs ⇒ 必须报", lambda: check_table(
        {"schema": 2, "octave": "11.3.0"}, schema=schema), False)
    add("★ sha256 缺失 ⇒ 必须报", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            {"name": "a", "version": "1", "url": "u"}]}, schema=schema), False)
    add("★ sha256 长度不对 ⇒ 必须报", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            {"name": "a", "version": "1", "sha256": "abc", "url": "u"}]}, schema=schema), False)
    add("★ 未知 form ⇒ 必须报", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            {"name": "a", "version": "1", "sha256": "a" * 64, "url": "u",
             "form": "wat"}]}, schema=schema), False)
    add("★ 未知 content 值 ⇒ 必须报", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            {"name": "a", "version": "1", "sha256": "a" * 64, "url": "u",
             "content": ["m", "bogus"]}]}, schema=schema), False)
    add("★ 未知键且未声明 optional ⇒ 必须报（协商规则）", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            {"name": "a", "version": "1", "sha256": "a" * 64, "url": "u",
             "surprise": 1}]}, schema=schema), False)
    add("★ 同时有 entries 与 packs ⇒ 必须报（同义键冲突）", lambda: check_table(
        {"schema": 2, "octave": "11.3.0",
         "entries": _good(schema)["entries"],
         "packs": _good(schema)["entries"]}, schema=schema), False)
    add("★ 站点态 url 是绝对地址 ⇒ 必须报", lambda: check_table(
        {"schema": 2, "octave": "11.3.0", "entries": [
            {"name": "a", "version": "1", "sha256": "a" * 64,
             "url": "https://up.example/a.tar.gz"}]}, schema=schema, site=True), False)
    add("★ producer 不符 ⇒ 必须报", lambda: check_table(
        _good(schema), producer="other", schema=schema), False)
    add("★ schema 高于消费者上限 ⇒ 必须报（quarantine）", lambda: check_table(
        _good(schema), max_schema=1, schema=schema), False)

    # ③ 空输入必须报
    add("★ 空 dict ⇒ 必须报", lambda: check_table({}, schema=schema), False)
    add("★ 顶层不是对象 ⇒ 必须报", lambda: check_table([], schema=schema), False)
    add("★ schema 非整数 ⇒ 必须报", lambda: check_table(
        {"schema": "2", "octave": "11.3.0", "entries": _good(schema)["entries"]},
        schema=schema), False)

    npass = nfail = 0
    for name, fn, want_ok in cases:
        try:
            probs = fn()
            got_ok = (probs == [])
        except Exception as e:                      # 抛也算"报"（非空输入）
            probs, got_ok = ["EXC %r" % e], False
        ok = (got_ok == want_ok)
        npass += 1 if ok else 0
        nfail += 0 if ok else 1
        print("%s | %s%s" % ("PASS" if ok else "fail", name,
                             "" if ok else "  → %s" % (probs[:1] if probs else "（无问题，但期望报）")))
    print("=== validate-content-list 自证：%d PASS / %d fail ===" % (npass, nfail))
    return 0 if nfail == 0 else 1


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", dest="listf")
    ap.add_argument("--producer")
    ap.add_argument("--site", action="store_true")
    ap.add_argument("--max-schema", type=int)
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args(argv)

    if a.selftest:
        return selftest()
    if not a.listf:
        print("用法：validate-content-list.py --list <表.json> [--producer ID] [--site] ／ --selftest",
              file=sys.stderr)
        return 2
    if not os.path.exists(a.listf):
        print("FATAL: 表不存在：%s（读不到不算通过）" % a.listf, file=sys.stderr)
        return 2
    try:
        doc = json.load(open(a.listf, encoding="utf-8"))
    except (OSError, ValueError) as e:
        print("FATAL: 表读不了/不是 JSON：%r" % e, file=sys.stderr)
        return 2
    probs = check_table(doc, producer=a.producer, site=a.site, max_schema=a.max_schema)
    if probs:
        for p in probs:
            print("PROBLEM: %s" % p)
        return 1
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
