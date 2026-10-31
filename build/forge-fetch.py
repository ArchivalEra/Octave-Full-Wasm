#!/usr/bin/env python3
# Octave-Full-Wasm — Octave Forge 取包器（依赖感知 + 版本按宿主 Octave 过滤）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么需要它：Forge 包的**最新版经常要求更新的 Octave**（例如 statistics 1.9.x 要
# Octave ≥11，而本项目的 Octave 是 7.2）。所以不能"取最新"，必须按
# `depends` 里的 `octave (>= X)` 过滤，并且递归解析包间依赖。
#
# 索引：https://gnu-octave.github.io/packages/packages.json（含每版 sha256 与依赖）
#
# 用法：
#   forge-fetch.py --octave 7.2.0 --dest <目录> [--proxy http://127.0.0.1:2080] 包名…
#   forge-fetch.py --list-compatible            # 只列出 7.2 可用的包与版本
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.request

INDEX_URL = "https://gnu-octave.github.io/packages/packages.json"
SKIP_DEPS = {"octave", "pkg"}


def vtuple(s):
    return tuple(int(x) for x in re.findall(r"\d+", str(s))[:3]) or (0,)


def check_ver(need, want):
    """need: 形如 '7.2.0'；want: 形如 'octave (>= 4.0.0)' → 是否满足"""
    m = re.match(r"octave\s*\(\s*(>=|<=|==|>|<)\s*([\d.]+)\s*\)", want)
    if not m:
        return True
    op, ver = m.group(1), m.group(2)
    a, b = vtuple(need), vtuple(ver)
    return {">=": a >= b, "<=": a <= b, "==": a == b, ">": a > b, "<": a < b}[op]


def octave_ok(need, deps):
    return all(check_ver(need, d) for d in deps if d.startswith("octave"))


def pick_version(need, entry):
    """在版本表里挑「满足 Octave 版本约束」的最新版"""
    ok = [v for v in entry.get("versions", []) if octave_ok(need, v.get("depends", []))]
    if not ok:
        return None
    ok.sort(key=lambda v: vtuple(v["id"]), reverse=True)
    return ok[0]


def load_index(proxy=None):
    cache = "/mnt/hdd/octave-wasm-build/third_party/forge/packages.json"
    if os.path.isfile(cache) and os.path.getsize(cache) > 10000:
        with open(cache, encoding="utf-8") as fh:
            return json.load(fh)
    if proxy:
        os.environ["https_proxy"] = proxy
        os.environ["http_proxy"] = proxy
    with urllib.request.urlopen(INDEX_URL, timeout=60) as r:
        data = json.loads(r.read().decode("utf-8"))
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    with open(cache, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False)
    return data


def download(url, dest, sha256=None, proxy=None):
    if os.path.isfile(dest) and sha256 and hashlib.sha256(open(dest, "rb").read()).hexdigest() == sha256:
        return "cached"
    cmd = ["curl", "-sSL", "--max-time", "600", "-o", dest, url]
    if proxy:
        cmd[1:1] = ["-x", proxy]
    subprocess.run(cmd, check=True)
    if sha256:
        got = hashlib.sha256(open(dest, "rb").read()).hexdigest()
        if got != sha256:
            return f"CHECKSUM-MISMATCH({got[:12]}!={sha256[:12]})"
    return "ok"


def resolve(index, need, names, plan, seen, fail):
    """递归解析依赖闭包，**把失败收集起来**而不是静默跳过。

    ★ 2026-10-31（GitRoll issue #7 / 工单 71）：原来的版本对"索引里没这个包"和
    "没有兼容宿主 Octave 的版本"两条路径都只 `continue` —— stderr 打一行就算了，
    而 `main()` **完全不看返回值**（它恒为 None）⇒ `forge-build.sh` 拿到退出码 0，
    以为全部成功，实际站点上少几个包，所有闸门都是绿的。这是**最贵的一类**：
    构建成功 + 自检绿 + 功能缺件（与"能编过 ≠ 能用了"同族）。

    现在：失败进 `fail`（调用方注入的 list），`main()` 据此非零退出并逐条点名。
    ⚠️ `fail` 是**必填**（评审抓到：给 `=None` 默认等于留一条 fail-open 后门 ——
    忘了传就静默回到旧行为，而那种"忘了传"不会报错）。本仓唯一调用点是 main()。
    """
    for name in names:
        if name in seen or name in SKIP_DEPS:
            continue
        seen.add(name)
        entry = index.get(name)
        if not entry:
            msg = f"索引里没有包: {name}"
            print(f"  ! {msg}", file=sys.stderr)
            fail.append({"name": name, "cause": "not-in-index", "why": msg})
            continue
        v = pick_version(need, entry)
        if not v:
            msg = f"{name}: 没有兼容 Octave {need} 的版本"
            print(f"  ! {msg}", file=sys.stderr)
            fail.append({"name": name, "cause": "no-compatible-version", "why": msg})
            continue
        plan.append((name, v))
        deps = [d.split()[0] for d in v.get("depends", [])]
        resolve(index, need, deps, plan, seen, fail)
    return fail


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--octave", default="7.2.0")
    ap.add_argument("--dest", default="/mnt/hdd/octave-wasm-build/third_party/forge")
    ap.add_argument("--proxy", default="http://127.0.0.1:2080")
    ap.add_argument("--list-compatible", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    # ★ 自证专用：用夹具索引文件替代网络（不碰真网络；正式用法不该传它）
    ap.add_argument("--index-fixture", default=None, help=argparse.SUPPRESS)
    ap.add_argument("packages", nargs="*")
    a = ap.parse_args(argv)

    if a.selftest:
        return selftest()

    # ★ 退出码契约（spec）：0=全部解析成功 / 1=有未解析项 / **2=环境或读索引失败**。
    #   评审抓到：原来夹具路径不存在会抛 FileNotFoundError traceback、rc=1 ——
    #   "环境问题"被伪装成"有包没解析出来"，两种失败必须能分开。
    try:
        if a.index_fixture:
            with open(a.index_fixture, encoding="utf-8") as fh:
                index = json.load(fh)
        else:
            index = load_index(a.proxy)
    except (OSError, ValueError) as e:
        print(f"FATAL: 读不到包索引（{a.index_fixture or INDEX_URL}）：{e}", file=sys.stderr)
        return 2

    if a.list_compatible:
        n = 0
        for name in sorted(index):
            v = pick_version(a.octave, index[name])
            if v:
                print(f"{name:<28} {v['id']}")
                n += 1
        print(f"\n共 {n}/{len(index)} 个包有兼容 Octave {a.octave} 的版本")
        return 0

    if not a.packages:
        ap.error("要么给包名，要么 --list-compatible")

    plan, seen = [], set()
    fail = []
    resolve(index, a.octave, a.packages, plan, seen, fail)

    # ★ 失败必须响亮（2026-10-31 / 工单 71）：三条静默路径（缺包 / 无兼容版本 /
    #   闭包为空）任何一条成立都 ⇒ 非零退出，并逐条点名。
    #   为什么不是"打 warning 继续"：退出码 0 会让下游把不完整的包集当成成功。
    #
    #   ⚠️ **行为变化（有意，评审点名要写清）**：解析失败时**不再往下下载**。
    #   旧行为是"能解析的先下、失败的打一行 warning"；但那种半套下载既没用（下游
    #   必须整体重跑）又白花带宽。代价：修好包名后要重下 —— 已下载的件**仍在缓存里**
    #   会被 `download()` 的 cached 路径复用（不删不清），所以重跑不重复下载。
    if fail:
        # ⚠️ 计数口径（评审抓到）：`fail` 是**闭包范围**（含传递依赖），`a.packages` 是
        #   **请求范围** —— 直接拿 len(fail) 对 len(a.packages) 说"请求的 N 个里 M 个失败"
        #   会把"某个依赖坏了"说成"你请求的包坏了"。两个范围分开说。
        top_failed = [f_ for f_ in fail if f_["name"] in a.packages]
        print(f"\n=== FAILED：依赖闭包解析失败 ===", file=sys.stderr)
        for f_ in fail:
            print(f"  · {f_['why']}（{f_['cause']}）", file=sys.stderr)
        print(f"解析出 {len(plan)} 个；失败 {len(fail)} 项"
              f"（其中你直接请求的 {len(a.packages)} 个里有 {len(top_failed)} 个失败）"
              f" ⇒ 拒绝成功退出", file=sys.stderr)
        return 1

    # 零值守卫：**请求了包**（含全是内建依赖的情形）却一个都没解析出来 ⇒ 空闭包不是成功。
    #   ⚠️ 这里不能用 `requested`（已滤掉 SKIP_DEPS）—— 请求 `octave pkg` 时 requested 为空，
    #   守卫就静默失效（自证当场抓到）。用原始 a.packages。
    if a.packages and not plan:
        print(f"\n=== FAILED：请求了 {len(a.packages)} 个包，但闭包为空 ===", file=sys.stderr)
        reasons = ("（请求的包全是内建依赖 octave/pkg？）"
                   if all(n in SKIP_DEPS for n in a.packages) else "")
        print(f"  · 空闭包不是成功 —— 拒绝退出 0{reasons}", file=sys.stderr)
        return 1

    os.makedirs(a.dest, exist_ok=True)

    print(f"=== 为 Octave {a.octave} 解析出 {len(plan)} 个包 ===")
    # ★ 下载层的失败也必须响亮（评审抓到的第二层静默路径）：`download()` 把
    #   `CHECKSUM-MISMATCH(...)` 当**字符串**返回，原先 main 只把它打出来就继续
    #   ⇒ 损坏的 tarball 留在盘上、退出码 0。fail-closed 的唯一依据是 sha256，
    #   所以"校验不符"必须与"解析失败"同等致命。
    dl_bad = []
    for name, v in plan:
        fn = f"{name}-{v['id']}.tar.gz"
        dest = os.path.join(a.dest, fn)
        status = download(v["url"], dest, v.get("sha256"), a.proxy)
        size = os.path.getsize(dest) if os.path.isfile(dest) else 0
        deps = ",".join(d.split()[0] for d in v.get("depends", []) if d.split()[0] not in SKIP_DEPS)
        print(f"  {name:<20} {v['id']:<10} {status:<22} {size:>9} 字节  依赖[{deps}]")
        if status.startswith("CHECKSUM-MISMATCH") or status.startswith("error"):
            dl_bad.append({"name": name, "status": status})
    if dl_bad:
        print(f"\n=== FAILED：{len(dl_bad)} 个包的字节不可信 ===", file=sys.stderr)
        for b_ in dl_bad:
            print(f"  · {b_['name']}: {b_['status']}", file=sys.stderr)
        print("fail-closed：sha256 是唯一依据，校验不符不许当成功退出", file=sys.stderr)
        return 1
    return 0


def selftest():
    """F1 自证（三类齐备）：正常不报 / 该报的必须报 / 空输入必须报。

    ★ 判据 = **进程能观测的东西**（返回码 + stderr），因为本件的缺陷就是"退出码骗人"。
    每个用例都**真调 main()**，两处外部依赖都换成夹具：
      · 索引 → `--index-fixture`（夹具 JSON）
      · 下载 → 模块级 `download` 被替换成桩（**不跑 curl、不碰网络**）
    ⚠️ 第一版只换了索引、没换下载 ⇒ 自证**真的在跑 curl**（还依赖代理 127.0.0.1:2080），
    而 docstring 写着"不走真网络" —— 评审抓到这条假话。夹具必须**两处都换**。

    形状照 `provision-omc.sh --selftest`（临时目录 + 夹具 + 三类用例 + 汇总行）。
    """
    import contextlib
    import io
    import tempfile

    cases = []

    _real_download = download

    def run(idx_doc, pkgs, octave="7.2.0", downloads_ok=True):
        """夹具索引 + 桩下载 → 真调 main()，返回 (rc, stderr 文本)。**不碰网络。**"""
        with tempfile.TemporaryDirectory() as d:
            idx_path = os.path.join(d, "packages.json")
            with open(idx_path, "w", encoding="utf-8") as fh:
                json.dump(idx_doc, fh)

            def fake_download(url, dest, sha256=None, proxy=None):
                if not downloads_ok:
                    return "CHECKSUM-MISMATCH(deadbeef!=" + str(sha256)[:8] + ")"
                with open(dest, "wb") as fh:
                    fh.write(b"fake")
                return "ok"

            buf = io.StringIO()
            globals()["download"] = fake_download
            try:
                with contextlib.redirect_stderr(buf):
                    rc = main(["--octave", octave, "--dest", d, "--index-fixture", idx_path]
                              + pkgs)
            finally:
                globals()["download"] = _real_download
            return rc, buf.getvalue()

    GOOD = {"a": {"versions": [{"id": "1.0", "depends": [], "url": "u", "sha256": "x"}]}}

    # ① 正常：请求存在的包 ⇒ rc=0
    rc, _e = run(GOOD, ["a"])
    cases.append(("正常：请求存在的包 ⇒ rc=0（不静默变成失败）", rc == 0))

    # ② 反向：索引里没有该包 ⇒ 必须非零 + 点名
    rc, err = run(GOOD, ["a", "ghost-pkg"])
    cases.append(("★ 反向：索引里没有包 ⇒ 非零且点名（工单 71 的主症状）",
                  rc != 0 and "ghost-pkg" in err))

    # ③ 反向：有包但无兼容版本 ⇒ 必须非零 + 点名原因
    NOVER = {"b": {"versions": [{"id": "9.0", "depends": ["octave (>= 9.0.0)"],
                                 "url": "u", "sha256": "x"}]}}
    rc, err = run(NOVER, ["b"], octave="7.2.0")
    cases.append(("★ 反向：无兼容版本 ⇒ 非零且点名「no-compatible-version」",
                  rc != 0 and "b" in err and "no-compatible-version" in err))

    # ④ 反向：**传递依赖**失败 ⇒ 不许因"顶层包都解析出来了"而放行
    #   （评审抓到：原用例与 ② 逐字相同，等于没测这一条；且失败计数口径也会在这里暴露）
    DEPBAD = {"a": {"versions": [{"id": "1.0", "depends": ["ghostdep"], "url": "u",
                                  "sha256": "x"}]}}
    rc, err = run(DEPBAD, ["a"])
    cases.append(("★ 反向：传递依赖缺失 ⇒ 非零（顶层包解析出来也不许放行）",
                  rc != 0 and "ghostdep" in err))

    # ④b 反向：下载字节校验不符 ⇒ 非零（评审抓到的第二层静默路径）
    rc, err = run(GOOD, ["a"], downloads_ok=False)
    cases.append(("★ 反向：checksum 不符 ⇒ 非零（fail-closed 的唯一依据是 sha256）",
                  rc != 0 and "CHECKSUM-MISMATCH" in err))

    # ⑤ 空输入：请求的包全在 SKIP_DEPS ⇒ 闭包为空 ⇒ 必须非零
    rc, err = run(GOOD, ["octave", "pkg"])
    cases.append(("★ 空输入：请求全是内建依赖 ⇒ 闭包空 ⇒ 非零（零值守卫）",
                  rc != 0 and "闭包为空" in err))

    # ⑥ 零值：不请求任何包 ⇒ argparse 报错（rc=2），不落进"成功"
    buf2 = io.StringIO()
    try:
        with contextlib.redirect_stderr(buf2):
            rc = main(["--octave", "7.2.0"])
        got = rc                     # ap.error 走 SystemExit(2)；走到这里说明没抛

    except SystemExit as e:                     # ap.error 走 SystemExit(2)
        got = e.code
    cases.append(("零值：不请求任何包 ⇒ rc=2（argparse 拒绝，不是成功）", got == 2))

    # ⑦ 环境失败：夹具索引读不到 ⇒ rc=2（**不是** rc=1 —— 环境问题与解析失败必须分开）
    buf3 = io.StringIO()
    with contextlib.redirect_stderr(buf3):
        rc = main(["--octave", "7.2.0", "--dest", "/tmp/x",
                   "--index-fixture", "/nonexistent/packages.json", "a"])
    cases.append(("★ 环境失败：索引读不到 ⇒ rc=2（与「有包没解析出来」的 rc=1 分开）", rc == 2))

    bad = 0
    for label, ok in cases:
        print("%s | %s" % ("PASS" if ok else "fail", label))
        bad += 0 if ok else 1
    print("=== forge-fetch 自证：%d PASS / %d FAIL ===" % (len(cases) - bad, bad))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
