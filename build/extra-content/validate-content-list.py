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
