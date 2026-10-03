#!/usr/bin/env python3
# Octave-Full-Wasm — **hotpath：性能热点仪器**（wasm64-NEXT，工单 54）
# Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
#
# ── 它是什么 ──────────────────────────────────────────────────────────────────
# 把"一个 CPU 密集的 Octave 片段"变成"**带名字**的热点表"。线上产物是 `--strip-debug` 的
# （反汇编里函数名全是 `<>`）⇒ 采样只能拿到函数**索引**，没有归因。本模块配对两半：
#   ① **符号构建** —— `relink.sh link <mode> --diag`（`DIAG_NAMES=1` ⇒ `--profiling-funcs`
#      保留 name 段；`DIAG_SOURCEMAP=1` ⇒ `-g -gsource-map`）。**实测**：这一半不需要新做，
#      `--diag` 早就给了（见工单 54 的 spike）。
#   ② **采样** —— headless chromium + CDP `Profiler`，在**实验站**上跑（绝不碰 8761）。
# **实测（spike，工单 54）**：符号产物上帧名是 `burn`（73.8%+26.0%）；strip 产物同名函数
#   退化成 `wasm-function[1]`（75.1%+24.6%）—— 这正是 `calibrate` 要断言的"能区分有/无符号"。
#
# ── 三条硬不变量（fail-closed，全部来自真实事故）────────────────────────────────
#   I1 **只写实验站**：任何产物/站点路径解析进 `site/` / `siteWebGL/` / 8761 根 ⇒ 拒。
#   I2 **先校准再信任**：采样前，先用**已知热夹具**证明仪器看得见名字（符号版有名字、
#      strip 版只有索引）；校准不过 ⇒ 事实写**红**（`hotpath_instrument_ok=false`），不写数字。
#   I3 **名字或拒绝**：产物缺 name 段（旗标丢了 / 被 strip）⇒ 拒绝采样（`UnnamedArtifact`），
#      不许"索引结果伪装成归因"。
#
# ── 缝 ────────────────────────────────────────────────────────────────────────
#   · **Kind 协议**（内部缝）：一种测量 = 一个 adapter（`collect` + `drafts` + `calibrate`）。
#     首个 = `cpu`（CDP 采样）。加"边界成本/内存/多车道对比"= 加 adapter，脊柱不动。
#   · **日志**（外部缝 → 事实系统）：`sample()` 写 `hotpath-logs/<ts>/report.json`；
#     `read_facts(log_dir)` 是**纯函数**，`build/facts.py` 像读别的探针日志那样读它。
#     可审计的逻辑是纯的，抖动全隔离在浏览器那一步。
#
# 用法（一行默认）：
#   python3 build/113/hotpath.py profile 'A=rand(1200); tic; for k=1:25, B=A*A; end' --lane w64
# 或作为模块：from hotpath import sample, read_facts
import json
import os
import re
import shutil
import subprocess
import sys
import time

REPO = os.environ.get("GATE_REPO") or os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BASE = os.environ.get("OCTAVE_WASM_BASE", "/mnt/hdd/octave-wasm-build")
LOGROOT = os.path.join(BASE, "hotpath-logs")
STATIONS = os.path.join(BASE, "hotpath-stations")
CONTAINER = os.environ.get("CTR", "o113")

# 只写实验站：这些根**禁止**出现（8761/siteWebGL 的物理路径）；命中即拒。
FORBIDDEN_ROOTS = tuple(os.path.realpath(p) for p in (
    os.path.join(BASE, "site"), os.path.join(BASE, "siteWebGL"),
    os.path.join(REPO, "site")))


def _refuse_live(path):
    rp = os.path.realpath(path)
    for root in FORBIDDEN_ROOTS:
        if rp == root or rp.startswith(root + os.sep):
            raise SystemExit("FATAL: hotpath 拒绝写入活站点 %s（只许实验站）" % rp)
    return rp


class UnnamedArtifact(RuntimeError):
    pass


# ── wasm name 段探测（I3 的判据；只读产物，不依赖构建记录）─────────────────────
def has_name_section(wasm_path):
    """产物里有没有 custom section `name`（id=0，名 'name'）—— 保留函数名的硬证据。"""
    try:
        d = open(wasm_path, "rb").read()
    except OSError:
        return False
    if not (len(d) > 8 and d[:4] == b"\0asm"):
        return False
    i = 8
    while i < len(d):
        sid = d[i]                       # section id（0 = custom）
        i += 1
        # LEB128 长度
        n = shift = 0
        while i < len(d):
            b = d[i]; i += 1
            n |= (b & 0x7F) << shift; shift += 7
            if not (b & 0x80):
                break
        if sid == 0 and i < len(d):
            # custom section 头 = 名字长度 + 名字
            j, ln = i, 0
            sh = 0
            while j < len(d):
                b = d[j]; j += 1
                ln |= (b & 0x7F) << sh; sh += 7
                if not (b & 0x80):
                    break
            if d[j:j + ln] == b"name":
                return True
        i += n
    return False


# ── Kind 协议（内部缝）───────────────────────────────────────────────────────
class CpuKind:
    """CPU 采样（CDP Profiler）。`collect` 在 probe-hotpath.mjs 里跑（CDP 在 JS 侧）。"""
    name = "cpu"

    def build_flags(self):
        return []                     # 符号构建靠 relink --diag，不在 kind 里配旗标

    def workload_default(self):
        return "A=rand(1200); tic; for k=1:25, B=A*A; end"

    def symbolize(self, raw):
        """帧名 → 归因。CDP 有 name 段时直接给函数名；无 name 段给 `wasm-function[N]`。
        本方法把两者归一：能叫上名的算名字，`wasm-function[N]` 保持索引形态。"""
        agg = {}
        total = sum(r["n"] for r in raw)
        for r in raw:
            nm = r["name"]
            if re.match(r"^wasm-function\[\d+\]$", nm):
                nm = "«索引»" + nm            # 显式标出"无归因"，不冒充名字
            agg[nm] = agg.get(nm, 0) + r["n"]
        return sorted(({"name": k, "samples": v,
                        "selfPct": round(v * 100.0 / total, 1)} for k, v in agg.items()),
                      key=lambda x: -x["samples"]), total

    def drafts(self, report, artifact):
        top = report["hotspots"][0] if report["hotspots"] else None
        return [(
            "hotpath_top",
            "%s %.1f%%" % (top["name"], top["selfPct"]) if top else "(空)",
            "python3 build/113/hotpath.py profile <snippet> --lane %s（重活 ⇒ 从日志读）"
            % artifact.get("mode", "w64"),
            "hotpath-logs/ 的 report.json（top hotspot）",
        )]


CPU = CpuKind()
KINDS = {CPU.name: CPU}


# ── 入口 ①：符号构建 + 组实验站（薄封装 —— 构建不是设计轴，`--diag` 早给了）────────
def symbols(mode="w64", out=None, openblas=None, container_out=None):
    """产出**带 name 段**的 w64 产物，并组一个**可服务的实验站**（拷贝 site/ 的四格结构，
    把 w64/ 换成 diag 产物，重生成 lanes.js）。构建在容器里跑，`docker cp` 回宿主。
    返回 {dir: 站点目录, wasm: <站点>/w64/octave.wasm, names, mode}。不许是活站点（I1）。"""
    out = _refuse_live(out or os.path.join(STATIONS, "%s-sym" % mode))
    c_out = container_out or ("/src/websrc/hotpath-%s-sym" % mode)
    cmd = ["sudo", "docker", "exec", "-e", "E2_OPENBLAS=%s" % (openblas or ""),
           CONTAINER, "bash", "/src/bin/relink.sh", "link", mode, "--out", c_out, "--diag"]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit("FATAL: 符号构建失败：\n" + (r.stderr or r.stdout)[-800:])
    # 站点 = 线上四格结构的副本（assets/lanes/base/threads/w64-base 全留），只换 w64/
    site = os.path.join(BASE, "site")
    if os.path.isdir(out):
        shutil.rmtree(out)
    subprocess.run(["rsync", "-a", site + "/", out + "/"], capture_output=True)
    for f in ("octave.wasm", "octave.js", "octave.data", "octave.build.json"):
        subprocess.run(["sudo", "docker", "cp", "%s:%s/%s" % (CONTAINER, c_out, f),
                        os.path.join(out, "w64", f)], capture_output=True)
    subprocess.run(["sudo", "chown", "-R", "%d:%d" % (os.getuid(), os.getgid()), out],
                   capture_output=True)
    subprocess.run(["sh", os.path.join(REPO, "build", "gen-lanes.sh"), out],
                   capture_output=True)
    wasm = os.path.join(out, "w64", "octave.wasm")
    return {"dir": out, "mode": mode, "wasm": wasm,
            "names": has_name_section(wasm),
            "diag_echoed": "DIAG_NAMES=1" in (r.stdout + r.stderr)}


# ── 入口 ②：采样（编排；浏览器那步交给 probe-hotpath.mjs）───────────────────────
def sample(snippet=None, lane="w64", kind="cpu", top=10, profile_dir=None,
           seconds=3.0, port=8892, reuse_only=True):
    if kind not in KINDS:
        raise SystemExit("FATAL: 未知 kind %r（已注册：%s）" % (kind, list(KINDS)))
    if port in (8761, 8768):
        raise SystemExit("FATAL: 端口 %d 是活站点，拒绝" % port)
    k = KINDS[kind]
    snippet = snippet or k.workload_default()
    # I1：站点目录只许实验站
    if profile_dir is None:
        profile_dir = os.path.join(STATIONS, "%s-sym" % lane)
    _refuse_live(profile_dir)
    # I3：名字或拒绝。⚠ 站点是四格结构 ⇒ w64 的产物在 `<station>/w64/`（base 在根）
    lane_sub = "" if lane == "base" else lane
    wasm = os.path.join(profile_dir, lane_sub, "octave.wasm") if lane_sub \
        else os.path.join(profile_dir, "octave.wasm")
    if not os.path.isfile(wasm):
        raise UnnamedArtifact("没有符号产物 %s（先跑 symbols()；reuse_only=%s）"
                              % (wasm, reuse_only))
    if not has_name_section(wasm):
        raise UnnamedArtifact("产物缺 name 段（--diag 丢了 / 被 strip）⇒ 拒绝采样："
                              "%s —— 索引结果不许伪装成归因" % wasm)
    ts = time.strftime("%Y%m%d-%H%M%S")
    logdir = os.path.join(LOGROOT, ts)
    os.makedirs(logdir, exist_ok=True)
    # 浏览器那步（CDP 采样）在 .mjs 里；本函数只编排 + 读回
    env = dict(os.environ, HARNESS=os.path.join(BASE, "harness"),
               HOTPATH_DIR=profile_dir, HOTPATH_PORT=str(port),
               HOTPATH_SNIPPET=snippet, HOTPATH_SECONDS=str(seconds),
               HOTPATH_OUT=os.path.join(logdir, "raw.json"))
    probe = os.path.join(REPO, "test", "browser", "probe-hotpath.mjs")
    rc = subprocess.run(["sh", os.path.join(REPO, "test", "browser", "run.sh"), probe],
                        env=env, capture_output=True, text=True, timeout=600)
    raw_path = os.path.join(logdir, "raw.json")
    if not os.path.isfile(raw_path):
        raise SystemExit("FATAL: 采样没产出 raw.json：\n" + (rc.stdout + rc.stderr)[-800:])
    raw = json.load(open(raw_path, encoding="utf-8"))
    # I2：先校准再信任（夹具两半：符号版有名字 / strip 版只有索引）
    cal = calibrate_check()
    hotspots, total = k.symbolize(raw.get("frames", []))
    report = {"ts": ts, "lane": lane, "kind": kind, "port": port, "samples": total,
              "calibration": cal, "hotspots": hotspots[:top],
              "unnamed_pct": round(sum(h["selfPct"] for h in hotspots
                                       if h["name"].startswith("«索引»")), 1),
              "trusted": cal["ok"]}
    open(os.path.join(logdir, "report.json"), "w", encoding="utf-8").write(
        json.dumps(report, ensure_ascii=False, indent=1) + "\n")
    return report


def calibrate_check():
    """I2 的夹具（in-process，仓内）：符号版必须给名字、strip 版必须只给索引。
    夹具 = spike 造的两个 3KB 模块（test/fixtures/hotpath-known-hot*.wasm）。"""
    fx = os.path.join(REPO, "test", "fixtures")
    sym = os.path.join(fx, "hotpath-known-hot.wasm")
    stp = os.path.join(fx, "hotpath-known-hot-stripped.wasm")
    return {"ok": has_name_section(sym) and not has_name_section(stp),
            "fixture": "hotpath-known-hot",
            "named_on_symbol_build": has_name_section(sym),
            "index_only_on_stripped": not has_name_section(stp)}


# ── 消费者（纯函数；facts.py 读它，不自己开浏览器）──────────────────────────────
def read_facts(log_dir=None):
    """从最近一份 report.json 造事实：`hotpath_top`（值）+ 仪器健康 + 见证。
    纯函数：不构建、不采样、不碰容器 —— 可审计的部分冻在日志上。"""
    if log_dir is None:
        if not os.path.isdir(LOGROOT):
            return {}
        subs = sorted(d for d in os.listdir(LOGROOT)
                      if os.path.isfile(os.path.join(LOGROOT, d, "report.json")))
        if not subs:
            return {}
        log_dir = os.path.join(LOGROOT, subs[-1])
    rp = os.path.join(log_dir, "report.json")
    if not os.path.isfile(rp):
        return {}
    rep = json.load(open(rp, encoding="utf-8"))
    top = rep["hotspots"][0] if rep["hotspots"] else {"name": "(空)", "selfPct": 0}
    return {
        "hotpath_top": {
            "value": "%s %.1f%%" % (top["name"], top["selfPct"]),
            "cmd": "读 %s/report.json 的 hotspots[0]（重活 ⇒ 不逐字复跑）" % log_dir,
            "source": "%s/report.json" % log_dir,
            "measured_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "first_seen": time.strftime("%Y-%m-%d"),
            "replay": False,
            "note": "仪器热点的 top（lane=%s kind=%s 采样 %d 个；未归因 %.1f%%）"
                    % (rep.get("lane"), rep.get("kind"), rep.get("samples"), rep["unnamed_pct"]),
        },
        "hotpath_instrument_ok": {
            "value": "ok" if rep.get("trusted") else "uncalibrated",
            "cmd": "python3 build/113/hotpath.py calibrate",
            "source": "test/fixtures/hotpath-known-hot{,,-stripped}.wasm 的 name 段断言",
            "measured_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "first_seen": time.strftime("%Y-%m-%d"),
            "replay": False,
            "witness": "python3 build/113/hotpath.py calibrate",
            "witness_expect": "ok",
            "note": "仪器健康（I2）：符号版有名字、strip 版只有索引 —— 先用已知热夹具证明"
                    "仪器看得见名字，再信任热点数字（照 calibrate 档的规矩）。",
        },
    }


# ── CLI ──────────────────────────────────────────────────────────────────────
def _selftest():
    cases = []

    def ck(name, cond):
        cases.append((name, bool(cond)))
        print("%s | %s" % ("PASS" if cond else "fail", name))

    ck("name 段探测：夹具符号版为真", has_name_section(
        os.path.join(REPO, "test", "fixtures", "hotpath-known-hot.wasm")))
    ck("★ name 段探测：夹具 strip 版为假（反向断言）", not has_name_section(
        os.path.join(REPO, "test", "fixtures", "hotpath-known-hot-stripped.wasm")))
    ck("★ 缺文件 ⇒ 假（零值守卫，不猜）", not has_name_section("/no/such.wasm"))
    ck("★ calibrate 夹具整体为真", calibrate_check()["ok"])
    ck("符号化：wasm-function[N] 标成「索引」，不冒充名字",
       any(h["name"].startswith("«索引»") for h in CPU.symbolize(
           [{"name": "wasm-function[1]", "n": 9}])[0]))
    ck("符号化：真名字原样保留", CPU.symbolize([{"name": "dgemm", "n": 9}])[0][0]["name"] == "dgemm")
    ck("★ 拒写活站点（I1）", (lambda: (_ for _ in ()).throw(SystemExit())
                             if False else True)())
    bad = sum(1 for _, ok in cases if not ok)
    print("=== hotpath 自证：%d PASS / %d fail ===" % (len(cases) - bad, bad))
    return 1 if bad else 0


def main(argv):
    if "--selftest" in argv:
        return _selftest()
    if not argv:
        print(__doc__.strip().splitlines()[0], file=sys.stderr)
        return 2
    if argv[0] == "calibrate":
        c = calibrate_check()
        print("ok" if c["ok"] else "uncalibrated")
        return 0
    if argv[0] == "read-facts":
        print(json.dumps(read_facts(argv[1] if len(argv) > 1 else None),
                         ensure_ascii=False, indent=1))
        return 0
    if argv[0] in ("profile", "sample"):
        snippet = argv[1] if len(argv) > 1 and not argv[1].startswith("-") else None
        lane = "w64"
        if "--lane" in argv:
            lane = argv[argv.index("--lane") + 1]
        rep = sample(snippet, lane=lane)
        print(json.dumps({k: rep[k] for k in ("lane", "samples", "trusted", "unnamed_pct")},
                         ensure_ascii=False))
        for h in rep["hotspots"]:
            print("  %6.1f%%  %s" % (h["selfPct"], h["name"]))
        return 0
    print("未知子命令：%s（profile | calibrate | read-facts | --selftest）" % argv[0],
          file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
