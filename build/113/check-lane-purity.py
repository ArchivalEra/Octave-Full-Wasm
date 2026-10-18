#!/usr/bin/env python3
# Octave-Full-Wasm — **车道架构纯度闸门**（2026-10-12，用户点令）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
"""一条线 = 一个架构：**宿主、`.oct`、站点资产三者必须同档，不许混编**。

## 为什么要有它（用户点令 + 真实踩坑史）

用户 2026-10-12 定的线划分：

    master 线   → 产物 wasm64，只编 wasm64
    wasm32 线   → 产物 wasm32，只编 wasm32

理由不是洁癖，是**混编的失败模式极难看出来**（本仓三次踩坑，各是一次实测）：

  1. **wasm32 对象链进 wasm64 模式** ⇒ `wasm-ld` 报
     `ida.c.o: wasm32 object file can't be linked in wasm64 mode`
     —— 这还算好的（链接期就炸）。`__ode15__` 就因为链了 wasm32 版 sundials 挂了整批。
  2. **坏的那一侧不报错**：把 wasm32 模块塞进 wasm64 宿主，加载器只给
     `incorrect architecture (wasm32 vs wasm64)` —— 但这句来自**加载器**，
     而缺符号的形态是 `Cannot read properties of undefined (reading 'value')`，
     两者混在一起时，没人能一眼看出"是架构错还是符号缺"。
  3. **最坏的一种：宿主与 `.oct` 都"建成功"、自检全绿，运行期才炸**
     （NOTES-emsdk-upgrade §7.5/§7.6 那两个 6.x 假阳都是这个形状）。

## 判据（逐条 fail-closed）

  ① 宿主 wasm 的 `Arch` 必须等于车道声明的档（`llvm-readobj -h` 读，不猜）
  ② 该车道 `.oct` 目录里**每个** `.oct` 的 `Arch` 必须同档（0 个也算未通过 —— 零值守卫）
  ③ 站点资产目录（`assets/oct[-<lane>]`、`assets/octdir[-<lane>]`）里的 `.oct` 同档
  ④ **反向断言**：喂一个错档的 `.oct` ⇒ 必须报（自证用，证明判据不是恒真）

## 用法

    python3 build/113/check-lane-purity.py --lane w64   --host <wasm> --oct <dir>… [--site <站点>]
    python3 build/113/check-lane-purity.py --lane wasm32 --host <wasm> --oct <dir>…
    python3 build/113/check-lane-purity.py --selftest

退出码：0 = 三者同档；1 = 有混编（逐条点名）；2 = 用法错/读不到（fail-closed，不当通过）。
"""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile

READOBJ_CANDIDATES = (
    "/emsdk/upstream/bin/llvm-readobj",
    "llvm-readobj",
)

# 车道名 → 期望档。车道名里的 "w64" 一律是 wasm64；"wasm32"/"product"/"base" 是 wasm32。
# ★ 三线模型权威枚举（2026-10-17 用户点令终版）：
#   三个实验场 = 分支：wasm32-final（wasm32 单线程）/ master（wasm64 多线程）/
#   IllegalPerformance（wasm64 多线程 + Rust 补丁）。站点只是展示层：
#   base=wasm32 产物、w64/w64-base=wasm64 产物、w64-base 是回退格（不是产品线）。
#   **threads（wasm32+atomics 多线程）是畸形档，已删 —— 出现即必红。**
LANE_EXPECT = {
    # 产品线（三线）
    "wasm32-final": "wasm32",
    "master": "wasm64",
    # 站点档（展示层；base=wasm32 线产物，w64/w64-base=wasm64 线产物）
    "base": "wasm32",
    "w64": "wasm64",
    "w64-base": "wasm64",
    # 旧构建模式名（relink.sh 的产物档）
    "product": "wasm32",
    "wasm64": "wasm64",
}
DEAD_LANES = {"threads": "wasm32+atomics 多线程畸形档（三线裁决 2026-10-17 删除）—— wasm32 永远单线程"}


def expected_arch(lane):
    """车道名 ⇒ 期望架构。陌生的名字返回 None（调用方 fail-closed）。"""
    return LANE_EXPECT.get(lane)


def _readobj():
    for c in READOBJ_CANDIDATES:
        if os.path.isabs(c):
            if os.path.exists(c):
                return c
        elif shutil.which(c):
            return c
    return None


def arch_of(path, run=None):
    """读一个 wasm 归档/模块的架构。返回 'wasm32' / 'wasm64' / None（读不到）。

    ⚠️ `.a` 会有多行（逐成员），必须**取全集去重**而不是只看第一行 ——
    第一版只看 head -1，于是"一包 wasm32 里混进一个 wasm64"这种正好漏掉。
    """
    ro = _readobj()
    if not ro:
        return None
    if run is not None:
        rc, out = run(f"{ro} -h {path}")
    else:
        try:
            p = subprocess.run([ro, "-h", path], capture_output=True, text=True, timeout=60)
        except (OSError, subprocess.TimeoutExpired):
            return None
        rc, out = p.returncode, p.stdout
    if rc != 0:
        return None
    arches = {ln.split(":", 1)[1].strip() for ln in out.splitlines() if ln.strip().startswith("Arch:")}
    if len(arches) == 1:
        return next(iter(arches))
    if len(arches) > 1:
        return "MIXED(" + ",".join(sorted(arches)) + ")"
    return None


def octs_in(dirs):
    out = []
    for d in dirs:
        if os.path.isfile(d) and d.endswith(".oct"):
            out.append(d)
        elif os.path.isdir(d):
            for r, _x, fs in os.walk(d):
                out += [os.path.join(r, f) for f in sorted(fs) if f.endswith(".oct")]
    return sorted(out)


def check(lane, host, oct_dirs, site=None, arch_of_=arch_of):
    """纯逻辑（自证注入 arch_of_）。返回 (problems, stats)。"""
    problems, stats = [], {}
    if lane in DEAD_LANES:
        return ["车道 %r 是死档：%s" % (lane, DEAD_LANES[lane])], stats
    want = expected_arch(lane)
    if want is None:
        return ["车道名 %r 未知 ⇒ 不知道期望哪个架构（lane_expect 表里没有）" % lane], stats

    # ① 宿主
    if host:
        got = arch_of_(host)
        stats["host"] = got
        if got is None:
            problems.append("宿主读不到架构：%s（文件不在 / readobj 不可用）— fail-closed，不当通过" % host)
        elif got != want:
            problems.append("宿主架构错档：期望 %s，实得 %s（%s）" % (want, got, os.path.basename(host)))
    else:
        problems.append("没给 --host ⇒ 判据①没做（零值守卫：空断言面不是通过）")

    # ② 车道 .oct
    octs = octs_in(oct_dirs or [])
    stats["oct_total"] = len(octs)
    if not octs:
        problems.append("车道 .oct 目录里一个 .oct 都没有（零值守卫：空集合不是通过）dirs=%s" % (oct_dirs or []))
    for p in octs:
        got = arch_of_(p)
        if got != want:
            problems.append(".oct 架构错档：期望 %s，实得 %s（%s）" % (want, got, p))

    # ③ 站点资产 —— **只查本档专属目录**
    #   ⚠️ `assets/oct/` 与 `assets/octdir/` 是**基础档**的（无后缀），不属任何带后缀的车道；
    #   多档站点（8761 四格）里它们合法地装着**另一档**的 .oct ⇒ 查它们必假红
    #   （实测：第一版查了基础目录 ⇒ 8761 上 44 处假报）。
    if site:
        for sub in ("oct-%s" % lane, "octdir-%s" % lane):
            d = os.path.join(site, "assets", sub)
            if not os.path.isdir(d):
                continue
            for p in octs_in([d]):
                got = arch_of_(p)
                if got != want:
                    problems.append("站点资产架构错档：期望 %s，实得 %s（%s）"
                                    % (want, got, os.path.relpath(p, site)))
    return problems, stats


# ── 自证：三类用例齐（正常不报 / 该报的必须报 / 空输入必须报）──────────────
def _fake(arch_map):
    def f(path, run=None):
        for k, v in arch_map.items():
            if path.endswith(k):
                return v
        return None
    return f


def _selftest():
    ok = []
    # ① 正常不报：三处都同档
    fak = _fake({"host64.wasm": "wasm64", "a.oct": "wasm64", "b.oct": "wasm64"})
    p, _ = check("w64", "/x/host64.wasm", ["/nope"], arch_of_=fak)
    # a/b 不在真目录里 ⇒ octs_in 收不到 ⇒ 会触发零值守卫；改用真临时目录
    d = tempfile.mkdtemp(prefix="lane-purity-")
    for n in ("a.oct", "b.oct"):
        open(os.path.join(d, n), "wb").write(b"\0asm\x01\0\0\0")
    p, st = check("w64", "/x/host64.wasm", [d], arch_of_=fak)
    ok.append(("正常不报（宿主与 .oct 同档）", p == [] and st.get("oct_total") == 2))

    # ② 该报的必须报：.oct 错档（**反向断言** —— 判据不是恒真）
    fak_bad = _fake({"host64.wasm": "wasm64", "a.oct": "wasm64", "b.oct": "wasm32"})
    p, _ = check("w64", "/x/host64.wasm", [d], arch_of_=fak_bad)
    ok.append(("★ .oct 错档必须报（wasm32 混进 wasm64 车道）",
               any("错档" in x for x in p) and "b.oct" in " ".join(p)))

    # ③ 该报的必须报：宿主错档
    fak_h = _fake({"host32.wasm": "wasm32", "a.oct": "wasm64", "b.oct": "wasm64"})
    p, _ = check("w64", "/x/host32.wasm", [d], arch_of_=fak_h)
    ok.append(("★ 宿主错档必须报", any("宿主架构错档" in x for x in p)))

    # ④ 空输入必须报：没给 host
    p, _ = check("w64", "", [d], arch_of_=fak)
    ok.append(("★ 没给 --host ⇒ 必须报（零值守卫）", any("零值守卫" in x for x in p)))

    # ⑤ 空输入必须报：.oct 目录空
    p, _ = check("w64", "/x/host64.wasm", [tempfile.mkdtemp(prefix="lane-empty-")], arch_of_=fak)
    ok.append(("★ .oct 集合为空 ⇒ 必须报（零值守卫）", any("零值守卫" in x for x in p)))

    # ⑥b 死档名必须**点名**报（三线裁决：threads 是被删除的畸形档，不是"陌生名"）
    p_dead, _s2 = check("threads", "/x/h.wasm", [tempfile.mkdtemp(prefix="lane-empty-")], arch_of_=fak)
    ok.append(("★ 死档名 threads ⇒ 必须点名畸形档（wasm32 永远单线程）",
               any("死档" in x or "畸形档" in x for x in p_dead)))
    # ⑥ 陌生车道名必须报（防止把新车道静默当通过）
    p, _ = check("bogus-lane", "/x/host64.wasm", [d], arch_of_=fak)
    ok.append(("★ 陌生车道名 ⇒ 必须报", any("未知" in x for x in p)))

    shutil.rmtree(d, ignore_errors=True)
    n = sum(1 for _, v in ok if v)
    for name, v in ok:
        print("%s | check-lane-purity/%s" % ("PASS" if v else "fail", name))
    print("\n=== check-lane-purity 自证：%d PASS / %d fail ===" % (n, len(ok) - n))
    return 0 if n == len(ok) else 1


def main(argv=None):
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--lane", required=True)
    ap.add_argument("--host", default="")
    ap.add_argument("--oct", nargs="*", default=[])
    ap.add_argument("--site", default="")
    a = ap.parse_args(argv)
    problems, stats = check(a.lane, a.host, a.oct, site=a.site or None)
    want = expected_arch(a.lane)
    print("check-lane-purity: 车道 %s（期望 %s）宿主=%s .oct 数=%d"
          % (a.lane, want, stats.get("host"), stats.get("oct_total", 0)))
    if problems:
        for x in problems:
            print("  ★ %s" % x)
        print("★ %d 处架构不纯 —— 一条线只许一个架构（用户点令 2026-10-12）" % len(problems))
        return 1
    print("三处同档（宿主 / .oct / 站点资产）✔")
    return 0


if __name__ == "__main__":
    sys.exit(_selftest() if "--selftest" in sys.argv[1:] else main())
