#!/usr/bin/env python3
# Octave-Full-Wasm — HANDOFF 自更新机制：**事实采集**（生成器与陈旧断言检查共用一处）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

"""从**持久盘产物**读出 HANDOFF 需要的那几件事实。

为什么单独一个模块：`.githooks/update-handoff.py`（重算 AUTO:STATE 区块）与
`.githooks/check-handoff.py`（陈旧断言检查）必须用**同一套读法**，否则两边口径会分叉。

原则（都是踩出来的）：
  · **只读持久盘**，不跑 docker（pre-commit 里不该依赖容器在跑）。
  · **不引入会自己在变的输入**：区块里不放"墙上时钟"、不放 HEAD 的 sha
    （否则同一个提交里 `--check` 永远不收敛）。用提交日期而不是当前时间。
  · 产物不在（换了机器/没挂盘）就**明确说"读不到"**，让调用方决定是警告还是跳过，
    绝不编一个数字出来。
"""
import hashlib
import inspect
import json
import os
import re
import subprocess

BUILD = os.environ.get("OCTAVE_BUILD", "/mnt/hdd/octave-wasm-build")
SITE = os.path.join(BUILD, "site")
LOGS = os.path.join(BUILD, "sweep-logs")
DIST = os.path.join(BUILD, "dist")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BIG_THREE = ("octave.wasm", "octave.js", "octave.data")


def _sha256(path, limit=None):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
            if limit and fh.tell() > limit:
                break
    return h.hexdigest()


def _gz_bytes(path):
    """**用 GNU `gzip -9`**，不用 Python 的 zlib —— 口径必须与交付一致：
    `build/make-dist.sh` 就是 `gzip -9 -k -f` 出预压件，nginx 发的是那一份
    （实测两者差 ~9KB：`gzip -9` 会写文件名头、且 deflate 实现与 zlib 略有差别）。
    文档里既然声称"交付体积"，就得用交付那条口径。"""
    p = subprocess.run(["gzip", "-9", "-c", path], capture_output=True, check=True)
    return len(p.stdout)


def site_facts(prev_raw_gz=None):
    """部署站点三大件的 sha/raw/gz。`prev_raw_gz` = {name: (raw, gz)} 上一次的测量值，
    用来**免掉每次提交都重压 36MB**：raw 与 sha 都没变就沿用上次的 gz。"""
    out = {"ok": False, "files": {}}
    if not os.path.isdir(SITE):
        out["why"] = f"没有 {SITE}"
        return out
    for name in BIG_THREE:
        p = os.path.join(SITE, name)
        if not os.path.isfile(p):
            out["why"] = f"缺 {p}"
            return out
        raw = os.path.getsize(p)
        sha = _sha256(p)
        gz = None
        if prev_raw_gz and name in prev_raw_gz:
            praw, pgz, psha = prev_raw_gz[name]
            if praw == raw and psha == sha:
                gz = pgz
        if gz is None:
            gz = _gz_bytes(p)
        out["files"][name] = {"raw": raw, "gz": gz, "sha256": sha}
    out["ok"] = True
    out["gz_total"] = sum(f["gz"] for f in out["files"].values())
    return out


def assets_count():
    mp = os.path.join(SITE, "assets", "manifest.json")
    if not os.path.isfile(mp):
        return None
    try:
        return len(json.load(open(mp, encoding="utf-8")).get("assets", []))
    except Exception:
        return None


def sweep_facts():
    """最近一次**全绿**的全量回归（没有全绿的就把最新一次如实报出来）。"""
    out = {"ok": False}
    if not os.path.isdir(LOGS):
        out["why"] = f"没有 {LOGS}"
        return out
    dirs = [d for d in os.listdir(LOGS) if os.path.isdir(os.path.join(LOGS, d))]
    if not dirs:
        out["why"] = "sweep-logs 下没有目录"
        return out
    dirs.sort(key=lambda d: os.path.getmtime(os.path.join(LOGS, d)), reverse=True)

    # 套件汇总两种形态：`=== N PASS / M FAIL ===` 与 pkgoct 的 `=== N 个模块：OK k / … ===`
    pat_a = re.compile(r"===\s*(\d+)\s*PASS\s*/\s*(\d+)\s*FAIL\s*===")
    pat_b = re.compile(r"===\s*(\d+)\s*个模块：OK\s*(\d+)\s*/")

    for d in dirs:
        logs = sorted(f for f in os.listdir(os.path.join(LOGS, d)) if f.endswith(".log"))
        if not logs:
            continue
        suites = p = f_ = missing = 0
        url = ""
        for fn in logs:
            txt = open(os.path.join(LOGS, d, fn), encoding="utf-8", errors="replace").read()
            if not url:
                m = re.search(r"^URL=(\S+)", txt, re.M)
                if m:
                    url = m.group(1)
            m = pat_a.search(txt)
            if m:
                suites += 1
                p += int(m.group(1))
                f_ += int(m.group(2))
                continue
            m = pat_b.search(txt)
            if m:
                suites += 1
                p += int(m.group(2))
                f_ += int(m.group(1)) - int(m.group(2))
                continue
            missing += 1
        clean = (f_ == 0 and missing == 0)
        rec = {"dir": d, "suites": suites, "pass": p, "fail": f_, "missing": missing,
               "url": url, "clean": clean, "mtime": os.path.getmtime(os.path.join(LOGS, d))}
        if clean:
            out.update(rec)
            out["ok"] = True
            return out
        out.setdefault("fallback", rec)
    out["ok"] = False
    out.setdefault("why", "没有一次全绿的回归")
    return out


def dist_facts():
    out = {"ok": False}
    if not os.path.isdir(DIST):
        out["why"] = f"没有 {DIST}"
        return out
    names = [d for d in os.listdir(DIST)
             if d.startswith("octave-full-wasm-site-") and os.path.isdir(os.path.join(DIST, d))]
    if not names:
        out["why"] = "dist 下没有交付包"
        return out
    names.sort(key=lambda d: os.path.getmtime(os.path.join(DIST, d)), reverse=True)
    name = names[0]
    rec = {"name": name}
    tar = os.path.join(DIST, name + ".tar.zst")
    if os.path.isfile(tar):
        rec["tar_bytes"] = os.path.getsize(tar)
        shafile = tar + ".sha256"
        if os.path.isfile(shafile):
            rec["tar_sha256"] = open(shafile, encoding="utf-8").read().split()[0]
    # 包内 wasm 是否与部署件同一份（这是"包 = 部署内容"的唯一硬证据）
    pkg_wasm = os.path.join(DIST, name, "octave.wasm")
    rec["has_wasm"] = os.path.isfile(pkg_wasm)
    if rec["has_wasm"]:
        rec["wasm_sha256"] = _sha256(pkg_wasm)
    out.update(rec)
    out["ok"] = True
    return out


def git_facts():
    def g(*a):
        try:
            return subprocess.run(["git", *a], cwd=REPO, capture_output=True, text=True,
                                  check=True).stdout.strip()
        except Exception:
            return ""
    return {"branch": g("rev-parse", "--abbrev-ref", "HEAD"),
            "head_date": g("log", "-1", "--format=%cs")}


def parse_prev_block(text):
    """从现有区块里回收上次的 (raw, gz, sha)，给 site_facts 当缓存用。"""
    prev = {}
    m = re.search(r"<!-- AUTO:STATE -->(.*?)<!-- /AUTO:STATE -->", text, re.S)
    if not m:
        return prev
    for name in BIG_THREE:
        row = re.search(re.escape(name) + r"[^\n]*?([\d,]+)\s*B raw[^\n]*?([\d,]+)\s*B gz[^\n]*?`([0-9a-f]{16})",
                        m.group(1))
        if row:
            prev[name] = (int(row.group(1).replace(",", "")), int(row.group(2).replace(",", "")),
                          row.group(3))
    return prev


def fmt(n):
    return f"{n:,}"
