#!/usr/bin/env python3
# Octave-Full-Wasm — **构建身份见证**（事实系统的 `witness` 第三档的首个实例，2026-10-02）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# ── 它见证什么 ──────────────────────────────────────────────────────────────────
# **部署件是被"仓库现役那份构建脚本"造出来的。** 便宜、只读、无副作用，每次提交都能跑。
#
# 动机（`-flto` 事故，HISTORY §5.77/§5.78）：w64 档为 NT=8 重链时，容器里的
# `/src/bin/link-web.sh` 已被上批 LTO 实验改动（`EXC_FLAGS` 多了 `-flto`），于是产物的
# `tool.script_sha256` 记成了 `2382ed34…`（≠ 仓库的 `63d8e7d7…`）—— 这条"来源漂移"
# 没有任何便宜机制能抓到，一路走到**全量浏览器回归**才炸（`accept-dldfcn` 71/0 → 44/27）。
# 事实系统此前只有两档：`replay=True`（便宜、每提交真跑）/ `replay=False`（贵、永不复查）。
# 构建产物类事实全在后一档 ⇒ 漂移看不见。本见证补上第三档。
#
# ── 判据（可复跑）──────────────────────────────────────────────────────────────
#   python3 build/113/witness-build-provenance.py w64
#     ⇒ stdout `match`                        （部署件由仓库现役 link-web.sh 构建）
#     ⇒ stdout `DRIFT: lane=w64 artifact=<sha16> repo=<sha16>`（来源漂移 ⇒ 见证失败）
#
# 退出码恒为 0：**见证的判据是 stdout 与台账的 `witness_expect` 逐字相等**，
# 不是退出码（与 `cmd` 的裸值契约同形）—— 退出码留给"脚本自己坏了"那种情况。
#
# ── 为什么默认只查"活跃车道" ────────────────────────────────────────────────────
# 仓库四档的记录工具 sha 各不相同（base `0eaa1f0e` / threads `44be7ec2` /
# w64 `63d8e7d7` / w64-base `a04488c9`）—— 因为它们**建造时间不同、link-web.sh 改过多次**。
# "产物由现役工具构建"这条不变式只对**正在迭代、随每批重链的档**成立；把旧档也硬查
# 会得到永久假红（噪声 ⇒ 最后被整闸关掉）。所以默认只查传入的那个车道；要扩到别的档
# 就把它一并重链（那是另一批的事）。**不用猜哪个档活跃：调用方（台账）显式传车道名。**
import json
import os
import sys

REPO = os.environ.get("GATE_REPO") or os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# 部署件默认读**仓库镜像 `site/`**（入库的可部署镜像，pre-commit 时一定在，且与 8761 同步）；
# 可用 SITE_DIR 覆盖成活的站点目录。
SITE = os.environ.get("SITE_DIR", os.path.join(REPO, "site"))
REPO_SCRIPT = os.path.join(REPO, "build", "113", "link-web.sh")


def sha(path, chunk=1 << 20):
    import hashlib
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for b in iter(lambda: fh.read(chunk), b""):
            h.update(b)
    return h.hexdigest()


def recorded_tool_sha(lane):
    """部署件身份证里记的构建脚本 sha（`tool.script_sha256`）。读不到 ⇒ None。"""
    p = os.path.join(SITE, lane, "octave.build.json")
    try:
        man = json.load(open(p, encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return ((man.get("tool") or {}).get("script_sha256")) or None


def verdict(lane, repo_sha=None, get=None):
    """纯逻辑（自证走这里）：返回见证输出串。"""
    get = get or recorded_tool_sha
    repo_sha = repo_sha or sha(REPO_SCRIPT)
    art = get(lane)
    if art is None:
        return "DRIFT: lane=%s artifact=<读不到 %s/%s/octave.build.json> repo=%s" % (
            lane, SITE, lane, repo_sha[:16])
    if art == repo_sha:
        return "match"
    return "DRIFT: lane=%s artifact=%s repo=%s" % (lane, art[:16], repo_sha[:16])


def selftest():
    bad = 0
    n = 0

    def case(name, cond):
        nonlocal bad, n
        n += 1
        ok = bool(cond)
        print("%s | %s" % ("PASS" if ok else "fail", name))
        bad += 0 if ok else 1

    # ① 正常不报：产物记的 sha == 仓库现役 sha ⇒ match
    case("构建身份一致 ⇒ match",
         verdict("w64", repo_sha="a" * 64, get=lambda l: "a" * 64) == "match")
    # ② 该报的必须报：漂移 ⇒ DRIFT（本单的 `-flto` 形状）
    out = verdict("w64", repo_sha="a" * 64, get=lambda l: "b" * 64)
    case("★ 来源漂移 ⇒ 必须 DRIFT", out.startswith("DRIFT") and "artifact=bbbb" in out)
    # ③ 空输入必须报：读不到身份证 ⇒ DRIFT（不是静默 match）
    case("★ 读不到部署件身份证 ⇒ 必须 DRIFT（零值守卫）",
         verdict("w64", repo_sha="a" * 64, get=lambda l: None).startswith("DRIFT"))
    print("=== witness-build-provenance 自证：%d PASS / %d fail ===" % (n - bad, bad))
    return 1 if bad else 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    lane = next((a for a in argv if not a.startswith("-")), None)
    if not lane:
        print("用法：witness-build-provenance.py <车道名>（如 w64）；--selftest", file=sys.stderr)
        return 2
    print(verdict(lane))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
