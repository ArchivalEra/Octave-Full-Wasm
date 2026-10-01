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


def _no_summary_names():
    """**按契约**不产 `=== N PASS / M FAIL ===` 的套件（类别级 `summary:false` + 清单里 manual 的）。

    ★ F4 暴露的坑（2026-09-27 实测）：`PROBES=1` 的那轮是**全绿**的，但 `bench-core` /
    `bench-dgemm` 按契约没有汇总行 ⇒ 旧逻辑把它们记成 `missing` ⇒ `clean=False` ⇒
    AUTO:STATE 会把一次全绿运行写成"**未全绿**（缺汇总 2 条）"。契约在
    `test/browser/manifest.json`（A3 搬进仓库的那份），这里必须读它，而不是硬编码。
    读不到清单时退回旧行为（宁可说"缺汇总"，也不要凭空说它齐）。"""
    try:
        man = json.load(open(os.path.join(REPO, "test/browser/manifest.json"), encoding="utf-8"))
    except (OSError, ValueError):
        return set()
    out = set()
    for name, e in (man.get("exceptions") or {}).items():
        if e.get("manual") or e.get("summary") is False:
            out.add(name)
    for cat, c in (man.get("categories") or {}).items():
        if c.get("summary") is False:
            out.add("@" + cat)
    return out


def sweep_facts():
    """最近一次**全绿**的全量回归（没有全绿的就把最新一次如实报出来）。

    ★ 口径（F2 收尾，2026-09-27 定死）：表头那对数字**只数 `accept-*`** —— 那是"验收底线"的
    口径，也是 `build/FACTS.json` 的 `accept_suites`/`accept_pass` 的口径（两处必须同口径，
    否则同一份文档里会出现两个"最近一次全绿"）。探针/基准另计，放进 `extras` 供文档单独写。"""
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
    no_sum = _no_summary_names()

    for d in dirs:
        # ★ 只认**套件日志**：`sweep.sh` 的记簿文件（`.inputs-error.txt` 等）以 `.` 开头，
        #   不是套件。实测（2026-10-01）：旧版把 `.inputs-error.log` 记成"缺汇总行的套件"
        #   ⇒ 一次全绿 PROBES=1 扫描被判 `clean=False` ⇒ AUTO:STATE 静默退回上一轮旧扫描，
        #   与 AUTO:FACTS（accept_*）**同一份文档两个口径**。
        logs = sorted(f for f in os.listdir(os.path.join(LOGS, d))
                      if f.endswith(".log") and not f.startswith("."))
        if not logs:
            continue
        suites = p = f_ = missing = 0                      # 表头 = accept-*
        xs = xp = xf = 0                                   # extras = 探针等
        x_no_sum = []
        url = ""
        for fn in logs:
            name = fn[:-4]
            is_accept = name.startswith("accept-")
            txt = open(os.path.join(LOGS, d, fn), encoding="utf-8", errors="replace").read()
            if not url:
                m = re.search(r"^URL=(\S+)", txt, re.M)
                if m:
                    url = m.group(1)
            ma, mb = pat_a.search(txt), pat_b.search(txt)
            if ma or mb:
                if ma:
                    sp, sf = int(ma.group(1)), int(ma.group(2))
                else:
                    sp, sf = int(mb.group(2)), int(mb.group(1)) - int(mb.group(2))
                if is_accept:
                    suites += 1
                    p += sp
                    f_ += sf
                else:
                    xs += 1
                    xp += sp
                    xf += sf
                continue
            if name in no_sum or ("@" + name.split("-", 1)[0]) in no_sum:
                x_no_sum.append(name)                      # 按契约没有汇总行 ⇒ 不是"缺"
                continue
            missing += 1
        clean = (f_ == 0 and xf == 0 and missing == 0)
        rec = {"dir": d, "suites": suites, "pass": p, "fail": f_, "missing": missing,
               "extras": {"suites": xs, "pass": xp, "fail": xf, "no_summary": x_no_sum},
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
    """区块里放的仓库事实。**只有分支名** —— 见下面这条实测教训。

    ★ 为什么不放 HEAD 的提交日期（2026-09-27 实测，F2 收尾）：
    `git log -1 --format=%cs` 在**同一个提交里**永远自相矛盾 —— pre-commit 重算时 HEAD 还是
    旧提交（写进去的是昨天的日期），提交完成后日期变了 ⇒ `pre-push` 的 `--check` 必然报
    "已过期"。那就只剩两条路：每个跨日期边界的提交都补一个"机器块刷新"提交，
    或者 `--no-verify`（本仓**禁用**）。所以日期这个字段是**机制上不可满足**的输入，删掉。
    区块里改用一句"以 `git log -1` 为准"，读者照样拿得到，而且不再逼人做假动作。
    同一条纪律在文件头写着：**不引入会自己在变的输入**（墙上时钟、HEAD 的 sha）——
    从 HEAD 派生的日期属于同一类。"""
    def g(*a):
        try:
            return subprocess.run(["git", *a], cwd=REPO, capture_output=True, text=True,
                                  check=True).stdout.strip()
        except Exception:
            return ""
    return {"branch": g("rev-parse", "--abbrev-ref", "HEAD")}


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
