#!/usr/bin/env python3
# Octave-Full-Wasm — **事实台账生成器**（事实系统 F2，2026-09-26）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# ═══════════════════════════════════════════════════════════════════════════════
# 为什么有它（实测，见架构评审 §0 与 `build/113/PLAN-arch.md` §2）
#
# 本仓的"测出来的数字"被**手抄在 3–6 处**（`22 个环境变量` 6 处、`4752` 4 处、
# `43 套 / 1076 PASS` 5 处、`1ed3e528…` 6 处），而**没有任何东西校验它们**——
# 已经烂掉四处：`703` vs `710`（导出名字数）、`13` vs `19`（探针项数，已按实测更正）、
# `23` vs `19`（同上）、`65/65` vs `64 PASS`（accept-p5-graphics）。
#
# 本脚本把"测出来的事实"收进**一份** `build/FACTS.json`，每条带**复跑命令**与**出处**。
# 它不是"消灭重复"（那要改一堆文档）——它先做到**让重复必须与实测一致**：
# `.githooks/check-facts.py` 会按每条事实的正则去活状态文档里找**同一个数字**，
# 不一致就报（带日期的历史行除外）。
#
# 用法：
#   python3 build/facts.py                       # 量一遍并写 build/FACTS.json
#   python3 build/facts.py                        # **重测并重写** build/FACTS.json（掉条会拒绝）
#   python3 build/facts.py --allow-drop           # 允许本次掉条（掉掉的键会打出来；记进 HISTORY）
#   python3 build/facts.py --render              # 把台账渲染成 markdown 机器块（打到 stdout）
#   python3 build/facts.py --render-doc [文件]   # 把机器块写进 HANDOFF.md（默认）
#   python3 build/facts.py --check               # 文档里的块是否与台账一致（陈旧 ⇒ exit 1）
#   python3 build/facts.py show [键]             # 打印某条事实（值 + 出处 + 复跑命令）
#   python3 build/facts.py --selftest            # 自证：空台账必须渲染成"空"，不许装作有事实
# ⚠️ 量不到的项**不写**（宁缺勿假）：比如最近一次全绿回归只在有 sweep-logs 的机器上有。
#
# ★ F2 收尾（2026-09-27）—— **数字只生产一次**：
#   上面的 `--render-doc` 是"测出来的数字"在活状态文档里的**唯一产地**（`AUTO:FACTS` 块）。
#   正文要引用就写 `build/FACTS.json` 的**键名**，不许手抄数字；`.githooks/check-facts.py`
#   会拦"活状态文档里出现裸数字"，也会拦"块与台账不一致"与"引用不存在的键"。
#   为什么不再满足于"抄了但抄对"：抄对了也要**有人去更新**，而"该更新哪几处"正是过去两天
#   反复出错的环节（`22`/`23` 个环境变量 6 处、`13`/`19` 项探针 2 处、`703`/`710`…）。
# ═══════════════════════════════════════════════════════════════════════════════
import json
import os
import re
import subprocess
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.environ.get("OCTAVE_SITE", "/mnt/hdd/octave-wasm-build/site")
LOGS = os.environ.get("SWEEP_LOGS", "/mnt/hdd/octave-wasm-build/sweep-logs")
OUT = os.path.join(REPO, "build", "FACTS.json")


def sha256sum(path, chunk=1 << 20):
    import hashlib
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for b in iter(lambda: fh.read(chunk), b""):
            h.update(b)
    return h.hexdigest()


def fact(value, cmd, source, note=""):
    d = {"value": value, "cmd": cmd, "source": source}
    if note:
        d["note"] = note
    return d


# ── 渲染：台账 → 活状态文档里的机器块（数字的**唯一产地**）────────────────────────
# ⚠️ 渲染函数与块标记搬去了 `build/lib/facts_block.py` —— 生成器（本文件）与闸门
#    （`.githooks/check-facts.py`）必须共用同一套渲染，否则"块对不对"两边口径会分叉。
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from facts_block import (BLOCK_BEGIN, BLOCK_END, block_body,  # noqa: E402
                         render_block)

DOC = "HANDOFF.md"


def load_ledger(path=None):
    with open(path or OUT, encoding="utf-8") as fh:
        return json.load(fh)


def write_doc(path_rel, ledger):
    """把块写进文档（就地替换）。**没有标记就报错，不悄悄追加** ——
    悄悄追加会让"块过期"变成"有两份块"，那是更难查的坏法。"""
    p = path_rel if os.path.isabs(path_rel) else os.path.join(REPO, path_rel)
    text = open(p, encoding="utf-8").read()
    if BLOCK_BEGIN not in text or BLOCK_END not in text:
        print("%s 缺少 %s / %s 标记（第一次落地时要手工放一次）" % (p, BLOCK_BEGIN, BLOCK_END),
              file=sys.stderr)
        return 2
    pre, _, rest = text.partition(BLOCK_BEGIN)
    _, _, post = rest.partition(BLOCK_END)
    new = pre + render_block(ledger) + post
    if new != text:
        open(p, "w", encoding="utf-8").write(new)
        print("已刷新 %s 的事实块" % path_rel)
    else:
        print("%s 的事实块无变化" % path_rel)
    return 0


def check_doc(path_rel, ledger):
    p = path_rel if os.path.isabs(path_rel) else os.path.join(REPO, path_rel)
    text = open(p, encoding="utf-8").read()
    if BLOCK_BEGIN not in text or BLOCK_END not in text:
        print("%s 缺少事实块标记" % path_rel, file=sys.stderr)
        return 2
    cur = text.split(BLOCK_BEGIN, 1)[1].split(BLOCK_END, 1)[0]
    if cur != block_body(ledger):
        print("%s 的事实块与 build/FACTS.json 不一致：跑 python3 build/facts.py --render-doc"
              % path_rel, file=sys.stderr)
        return 1
    print("%s 的事实块与台账一致" % path_rel)
    return 0


def dropped_keys(old_facts, new_facts):
    """本次重测会掉掉哪些键（纯函数：自证要用）。"""
    return sorted(set(old_facts or {}) - set(new_facts or {}))


def main(argv):
    if argv and argv[0] == "--render":
        sys.stdout.write(render_block(load_ledger()) + "\n")
        return 0
    if argv and argv[0] == "--render-doc":
        return write_doc(argv[1] if len(argv) > 1 else DOC, load_ledger())
    if argv and argv[0] == "--check":
        return check_doc(argv[1] if len(argv) > 1 else DOC, load_ledger())
    if argv and argv[0] == "show":
        led = load_ledger()
        f = led.get("facts") or {}
        keys = [argv[1]] if len(argv) > 1 else sorted(f)
        rc = 0
        for k in keys:
            if k not in f:
                print("没有这条事实：%s（现有：%s）" % (k, ", ".join(sorted(f))), file=sys.stderr)
                rc = 1
                continue
            print("%-20s %s" % (k, f[k].get("value")))
            print("    出处  %s" % f[k].get("source", "?"))
            print("    复跑  %s" % f[k].get("cmd", "?"))
            if f[k].get("note"):
                print("    备注  %s" % f[k]["note"])
        return rc
    return measure()


def _block_of(ledger):
    return render_block(ledger)


_FULL = {"generated": "T", "facts": {"wasm_v128": {"value": 4752, "cmd": "c", "source": "s"},
                                     "wasm_sha": {"value": "a" * 64, "cmd": "c", "source": "s"}}}
CASES = [
    ("有台账 ⇒ 每个键都出现在块里", lambda: all(k in _block_of(_FULL) for k in _FULL["facts"])),
    ("有台账 ⇒ 值是原值（4752 出现在块里）", lambda: "**4752**" in _block_of(_FULL)),
    ("sha 截断显示（不整条摊开）", lambda: "`" + "a" * 16 + "…`" in _block_of(_FULL)),
    ("★ **空台账 ⇒ 块里必须写明「为空」**（零值守卫：不许渲染成一张空表）",
     lambda: "台账为空" in _block_of({"facts": {}}) and "| 键 |" not in _block_of({"facts": {}})),
    ("★ 块渲染是**纯函数**（同一份台账渲染两次逐字节相同）",
     lambda: _block_of(_FULL) == _block_of(_FULL)),
    ("★ 台账少一条 ⇒ 块跟着变（块不是常量）",
     lambda: _block_of(_FULL) != _block_of({"facts": {"wasm_v128": _FULL["facts"]["wasm_v128"]}})),
    # ★ 掉条守卫（2026-09-27 实测踩到：无参数跑一次就把 28 条静默缩成 17 条）
    ("★ 重测会掉条 ⇒ dropped_keys 必须报出来（写盘处据此拒绝）",
     lambda: dropped_keys({"a": 1, "b": 2}, {"a": 1}) == ["b"]),
    ("★ 不掉条（新增/相同）⇒ 不报", lambda: dropped_keys({"a": 1}, {"a": 1, "c": 3}) == []),
    ("★ 空台账起步 ⇒ 不报（第一次生成不许被自己拦住）", lambda: dropped_keys({}, {"a": 1}) == []),
]


def measure():
    facts = {}

    # ── 产物侧：读**产物身份证**（A1 起它在 site/ 里；读数不用重链）────────────────
    man_p = os.path.join(SITE, "octave.build.json")
    if os.path.exists(man_p):
        try:
            man = json.load(open(man_p, encoding="utf-8"))
            me = man.get("measured", {})
            if me.get("simd", {}).get("v128") is not None:
                facts["wasm_v128"] = fact(me["simd"]["v128"],
                                          "读 %s 的 measured.simd.v128" % man_p, "site/octave.build.json",
                                          "SIMD 判据；非 SIMD 那版是 0")
            if me.get("exported_functions") is not None:
                facts["exported_functions"] = fact(me["exported_functions"],
                                                   "读 %s 的 measured.exported_functions" % man_p,
                                                   "site/octave.build.json",
                                                   "M2 保活集大小（M1 约 44987）")
            if me.get("fonts"):
                facts["fonts_count"] = fact(len(me["fonts"]),
                                            "读 %s 的 measured.fonts" % man_p, "site/octave.build.json")
            facts["jspi_entry"] = fact(bool(me.get("jspi_entry")),
                                       "读 %s 的 measured.jspi_entry" % man_p, "site/octave.build.json",
                                       "B 姿势的可挂起入口在不在")
        except (OSError, ValueError) as e:
            print("⚠ 读不到产物身份证（%s）：%s" % (man_p, e), file=sys.stderr)

    # ── 部署件 sha（磁盘层；HTTP/页面层由 check-deploy-sha.sh / probe-artifact-sha.mjs 管）──
    # ⚠️ **每个站点产物都要登记**：闸门的 sha 规则是"文档里的 sha 必须是**某个**已登记的 sha"
    #    —— 只登记 wasm 会把 `octave.js` 的 sha、矩阵页的 sha 全当成错（F2 首跑就踩了）。
    for rel, key in (("octave.wasm", "wasm_sha"), ("octave.js", "js_sha"),
                     ("octave.data", "data_sha"), ("octave.build.json", "build_json_sha"),
                     ("matrix-android.html", "matrix_page_sha")):
        p_ = os.path.join(SITE, rel)
        if not os.path.exists(p_):
            continue
        h = subprocess.run(["sha256sum", p_], stdout=subprocess.PIPE, text=True).stdout.split()[0]
        facts[key] = fact(h, "sha256sum %s" % p_, "site/%s" % rel)
        if rel == "octave.wasm":
            facts["wasm_bytes"] = fact(os.path.getsize(p_), "stat -c%%s %s" % p_, "site/octave.wasm")

    # ── 构建侧：link-web.sh 读多少个环境变量（模式表必须全覆盖它们 —— relink --selfcheck 管集合，
    #    这里管**数量**：六处文档都写着"22 个"，加第 23 个变量时它们会一起变错而构建全绿）──────
    lw = os.path.join(REPO, "build", "113", "link-web.sh")
    if os.path.exists(lw):
        txt = open(lw, encoding="utf-8", errors="replace").read()
        names = {m for m in re.findall(r"\$\{([A-Za-z0-9_]+):[-+]", txt)}
        names -= {"1"}                      # 位置参数不算
        # 脚本内数组/局部量不算环境变量：它们在文件里被赋成 `NAME=(...)`
        local_arrays = {m for m in re.findall(r"^\s*([A-Za-z_][A-Za-z0-9_]*)=\(", txt, re.M)}
        names -= local_arrays
        facts["env_vars"] = fact(len(names),
                                 "grep -oE '\\$\\{[A-Za-z0-9_]+:[-+]' %s | sort -u（去掉位置参数）" % lw,
                                 "build/113/link-web.sh")

    # ── 回归侧：最近一次**全绿**的 accept 扫描（本机有 sweep-logs 才算）────────────────
    try:
        dirs = sorted((d for d in os.listdir(LOGS) if d.startswith("2026")), reverse=True)
    except OSError:
        dirs = []
    # ⚠️ 只认"**全绿且够全**"的那一次：否则量出来的不是文档里那种"最近一次全绿回归"
    #    （实测踩过：随手取最新目录 ⇒ 42 套 / 1049 PASS，那是一次带过滤/未跑完的扫描）。
    for d in dirs[:12]:
        suites = total = fails = 0
        try:
            # ⚠️ 只数 `accept-*`：这样"最近一次全绿"与文档里那个口径一致（PROBES=1 那轮会多出探针）
            logs = [f for f in os.listdir(os.path.join(LOGS, d))
                    if f.startswith("accept-") and f.endswith(".log")]
        except OSError:
            continue
        for f in logs:
            txt = open(os.path.join(LOGS, d, f), encoding="utf-8", errors="replace").read()
            # ⚠️ **两种汇总格式都要认**（与 build/sweep.sh 同规则）—— 复算时漏了第二种，
            #    结果数出 42 套 / 1049 PASS（差的那 27 项正是 accept-113-pkgoct 的 `个模块：OK` 格式）。
            m = re.findall(r"=== *(\d+) PASS / (\d+) FAIL *===", txt)
            if m:
                suites += 1
                total += int(m[-1][0])
                fails += int(m[-1][1])
                continue
            m2 = re.findall(r"===.*个模块：OK *(\d+)", txt)
            if m2:
                suites += 1
                total += int(m2[-1])
                f2 = re.findall(r"TRAP *(\d+)", txt)
                fails += int(f2[-1]) if f2 else 0
        if suites >= 40 and fails == 0:
            facts["accept_suites"] = fact(suites, "数 %s/%s 里带汇总行的套件（且 0 FAIL）" % (LOGS, d),
                                          "sweep-logs/%s" % d)
            facts["accept_pass"] = fact(total, "同上，把每个套件的 PASS 相加", "sweep-logs/%s" % d,
                                        "最近一次**全绿**扫描的 PASS 合计")
            break

    # ── ★ 线程档车道（B6，branch `threads`，2026-09-27）─────────────────────────────
    #    为什么这些也要进台账：线程档的每个数字（sha / 共享内存 / 导出面 / BLAS 来自哪）都是
    #    **测出来的**；文档引用它们时必须是**键引用**而不是手抄（F2 的规矩）。
    #    量不到就不写（换了机器/没建过车道 ⇒ 台账里没有这些键，文档引用键会被闸门抓出来）。
    # 线程档在哪：优先 `THREADS_OUT`（容器内路径）；否则 `<站点>/threads/`（**promote 后**的形态）；
    # 车道验证阶段站点还是 `siteWebGL` ⇒ 用 `LANE_SITE=` 指过去（本脚本在**宿主**跑）。
    TW = os.environ.get("THREADS_OUT")
    tw_man = (os.path.join(TW, "octave.build.json") if TW
              else os.path.join(os.environ.get("LANE_SITE", SITE), "threads", "octave.build.json"))
    if os.path.exists(tw_man):
        try:
            tm = json.load(open(tw_man, encoding="utf-8"))
            tme = tm.get("measured", {}) or {}
            th = tme.get("threads") or {}
            facts["threads_verdict"] = fact(tm.get("verdict"),
                                            "读 %s 的 verdict" % tw_man, "m2fc-threads-out/octave.build.json",
                                            "只有 ok 才可部署（fail-closed）")
            if th:
                facts["threads_shared_memory"] = fact(bool(th.get("shared_memory")),
                                                      "读 %s 的 measured.threads.shared_memory" % tw_man,
                                                      "m2fc-threads-out/octave.build.json",
                                                      "wasm 内存段的 shared 位；线程档的硬身份")
                facts["threads_pthread_glue"] = fact(th.get("pthread_glue"),
                                                     "读 %s 的 measured.threads.pthread_glue" % tw_man,
                                                     "m2fc-threads-out/octave.build.json",
                                                     "基础档实测是 0")
            v = (tme.get("simd") or {}).get("v128")
            if v is not None:
                facts["threads_v128"] = fact(v, "读 %s 的 measured.simd.v128" % tw_man,
                                             "m2fc-threads-out/octave.build.json",
                                             "线程档也带 SIMD（两轴不互斥）")
            if tme.get("exported_functions") is not None:
                facts["threads_exported_functions"] = fact(
                    tme["exported_functions"], "读 %s 的 measured.exported_functions" % tw_man,
                    "m2fc-threads-out/octave.build.json")
            bd = ((tm.get("inputs") or {}).get("blas") or {}).get("resolved_dir")
            if bd:
                facts["threads_blas_dir"] = fact(bd, "读 %s 的 inputs.blas.resolved_dir" % tw_man,
                                                 "m2fc-threads-out/octave.build.json",
                                                 "**必须含 `-threads`**（判据见 check-build-manifest.lane_blas_problem）")
            pw = os.path.join(os.path.dirname(tw_man), "octave.wasm")
            if os.path.exists(pw):
                facts["threads_wasm_sha"] = fact(sha256sum(pw), "sha256sum %s" % pw,
                                                 "m2fc-threads-out/octave.wasm")
                facts["threads_wasm_bytes"] = fact(os.path.getsize(pw), "stat -c%%s %s" % pw,
                                                   "m2fc-threads-out/octave.wasm")
        except (OSError, ValueError) as e:
            print("⚠ 读不到线程档身份证（%s）：%s" % (tw_man, e), file=sys.stderr)

    # ── ★ `.oct` 分档（站点侧，B6）：两档各多少条 + 车道那套是否都有 TLS 入口 ────────
    LANE_SITE = os.environ.get("LANE_SITE", SITE)   # 车道站点（验证期 = siteWebGL；promote 后 = site）
    for sub, key, why in (("oct-threads", "oct_lane_files", "线程档 `assets/oct-threads/` 条数"),
                          ("octdir-threads", "oct_lane_octdir_files",
                           "线程档 `assets/octdir-threads/` 条数"),
                          ("oct", "oct_base_files", "基础档 `assets/oct/` 条数"),
                          ("octdir", "octdir_base_files", "基础档 `assets/octdir/` 条数")):
        base_sub = "oct" if sub.startswith("oct-") else ("octdir" if sub.startswith("octdir-") else sub)
        d = os.path.join(LANE_SITE if sub.endswith("-threads") else SITE, "assets", sub)
        if not os.path.isdir(d):
            continue
        n = sum(1 for _r, _x, fs in os.walk(d) for f in fs if f.endswith(".oct"))
        facts[key] = fact(n, "find %s -name '*.oct' | wc -l" % d, "site/assets/%s" % sub, why)
    _lane_octs = []
    for sub in ("oct-threads", "octdir-threads"):
        d = os.path.join(LANE_SITE, "assets", sub)
        if os.path.isdir(d):
            _lane_octs += [os.path.join(r, f) for r, _x, fs in os.walk(d) for f in fs
                           if f.endswith(".oct")]
    if _lane_octs:
        ok = sum(1 for x in _lane_octs if b"_emscripten_tls_init" in open(x, "rb").read())
        facts["oct_lane_tls_init"] = fact(ok, "python3 build/113/check-oct-lane.py "
                                               "<站点>/assets/oct-threads <站点>/assets/octdir-threads "
                                               "--base <站点>/assets/oct <站点>/assets/octdir",
                                          "site/assets/oct-threads + octdir-threads",
                                          "每个都必须有（没有在线程档里 dlopen 会 tlsInitFunc 不是函数）；"
                                          "分母见 oct_lane_files + oct_lane_octdir_files")

    # ── ★ 双档探针的实测汇总（B6）：从**保存下来的探针日志**里读（facts.py 不自己开浏览器）──
    #    为什么要有这条：HANDOFF 会写"probe-lane N PASS / 0 FAIL"，那是**测出来的数字** ⇒ 按 F2 的规矩
    #    必须来自台账、并由闸门核对（否则它会静默漂移）。跑法见本条 cmd。
    pl = os.environ.get("PROBE_LANE_LOG", os.path.join(os.path.dirname(SITE), "probe-lane.log"))
    if os.path.exists(pl):
        try:
            txt = open(pl, encoding="utf-8", errors="replace").read()
            m = re.search(r"===\s*(\d+) PASS / (\d+) FAIL\s*===", txt)
            if m:
                facts["probe_lane_pass"] = fact(int(m.group(1)),
                                                "SITE_DIR=siteWebGL sh test/browser/run.sh "
                                                "test/browser/probe-lane.mjs > %s" % pl,
                                                os.path.basename(pl),
                                                "双档探针的 PASS 数（FAIL 必须 0）")
                facts["probe_lane_fail"] = fact(int(m.group(2)),
                                                "同上（脚本结尾的 `=== N PASS / M FAIL ===`）",
                                                os.path.basename(pl))
        except OSError as e:
            print("⚠ 读不到探针日志 %s：%s" % (pl, e), file=sys.stderr)

    # ── E2（branch `e2-openblas`）：线程版 OpenBLAS 链进主模块的实测事实 ─────────────────
    # 为什么进台账：E2 的**收益**与**否证**都是"数字/结论"，正文里手抄一次就会腐烂（本仓一天
    # 抓到过 5 处）。产物与日志都落在持久盘（`e2-artifacts/`、`e2-logs/`），本组按它们量。
    E2A = os.environ.get("E2_ARTIFACTS", os.path.join(os.path.dirname(SITE), "e2-artifacts"))
    E2L = os.environ.get("E2_LOGS", os.path.join(os.path.dirname(SITE), "e2-logs"))

    def _e2_buildjson(variant):
        return os.path.join(E2A, variant, "octave.build.json")

    for tag, variant in (("e2_single", "single"), ("e2_threaded", "threaded")):
        try:
            bj = json.load(open(_e2_buildjson(variant), encoding="utf-8"))
            m = (bj.get("measured") or {}).get("files") or {}
            w = (m.get("octave.wasm") or {})
            facts[tag + "_verdict"] = fact(bj.get("verdict"),
                                           "python3 build/facts.py（读 %s）" % _e2_buildjson(variant),
                                           os.path.basename(_e2_buildjson(variant)))
            facts[tag + "_wasm_sha"] = fact(w.get("sha256"),
                                            "sha256sum %s/%s/octave.wasm" % (E2A, variant),
                                            "octave.wasm")
            facts[tag + "_wasm_bytes"] = fact(w.get("bytes"),
                                              "stat -c %%s %s/%s/octave.wasm" % (E2A, variant),
                                              "octave.wasm")
        except (OSError, ValueError) as e:
            print("⚠ 读不到 E2 %s 的身份证：%s" % (variant, e), file=sys.stderr)

    def _bench_median(log, label):
        """从 bench-core 的日志里取某个用例的中位数（秒）。

        两种日志形状都认（实测都要认）：正常收尾有 `BENCH_JSON{…}` 一行；**被超时收尾**的那种
        只有打印行（`<用例>           0.0060s  (0.011, 0.005, 0.006)`）⇒ 用正则兜底，
        否则"线程版那一轮"的数字会被静默丢掉（那就变成"没测过"，比测到更糟）。
        """
        path = os.path.join(E2L, log)
        try:
            with open(path, encoding="utf-8", errors="replace") as fh:
                text = fh.read()
        except OSError:
            return None
        for line in text.splitlines():
            if line.startswith("BENCH_JSON"):
                try:
                    r = json.loads(line[len("BENCH_JSON"):]).get("results") or {}
                except ValueError:
                    r = {}
                for k, v in r.items():
                    if label in k:
                        return v.get("median")
        # 标签可能**在行中**（例 `矩阵分解 lu(800)   0.0200s (…)`）⇒ 别要求行首就是标签
        m = re.search(r"(?m)^[^\n]*?" + re.escape(label) + r"[^\n]*?\s([0-9.]+)s\s*\(", text)
        return float(m.group(1)) if m else None

    e2_mat = _bench_median("e2-measure-s.log", "矩阵乘")
    lane_mat = _bench_median("lane-bench.log", "矩阵乘")
    e2_lu = _bench_median("e2-measure-s.log", "lu(")
    lane_lu = _bench_median("lane-bench.log", "lu(")
    for k, v, cmd in (("e2_matmul500_s", e2_mat, "E2 单线程站点跑 bench-core.mjs（见 NOTES 的 A/B 表）"),
                      ("lane_matmul500_s", lane_mat, "现役车道站点跑同一个 bench-core.mjs"),
                      ("e2_lu800_s", e2_lu, "同 E2 那一行"),
                      ("lane_lu800_s", lane_lu, "同车道那一行")):
        if v is not None:
            facts[k] = fact(v, cmd, "e2-logs/%s" % ("e2-measure-s.log" if k.startswith("e2_") else "lane-bench.log"))
    if e2_mat and lane_mat:
        facts["e2_matmul500_ratio"] = fact(round(lane_mat / e2_mat, 2),
                                           "上面两行的比值（车道 / E2）", "派生")
    if e2_lu and lane_lu:
        facts["e2_lu800_ratio"] = fact(round(lane_lu / e2_lu, 2),
                                       "上面两行的比值（车道 / E2）", "派生")
    # 线程版的 bench（注意：它那一轮**超时收尾**，只有前几项有数；后面几项缺 ⇒ 如实缺）
    t_mat = _bench_median("e2-bench.log", "矩阵乘")
    t_lu = _bench_median("e2-bench.log", "lu(")
    if t_mat is not None:
        facts["e2_threaded_matmul500_s"] = fact(t_mat,
            "E2 线程版站点跑 bench-core.mjs（该轮 300s 超时收尾，只到前几项）", "e2-logs/e2-bench.log")
    if t_lu is not None:
        facts["e2_threaded_lu800_s"] = fact(t_lu, "同上", "e2-logs/e2-bench.log")
    if t_mat and lane_mat:
        facts["e2_threaded_matmul500_ratio"] = fact(round(lane_mat / t_mat, 1),
                                                    "车道 / 线程版（派生）", "派生")
    try:
        rc = open(os.path.join(E2L, "e2-oct-threaded.rc"), encoding="utf-8").read().strip()
        facts["e2_threaded_oct_rc"] = fact(int(rc),
                                           "timeout 600 sh test/browser/run.sh ...accept-113-oct.mjs <E2 线程版站点>; echo $?",
                                           "e2-logs/e2-oct-threaded.rc")
    except (OSError, ValueError):
        pass

    # ★ 零值守卫（2026-09-27 实测踩到）：本脚本**无参数运行就会重写台账**，而某些事实的输入
    #   现在不在（例：8761 站点此刻没有 `threads/` ⇒ 8 条线程档事实测不出来）⇒ 一次手滑就把
    #   台账从 28 条**静默缩成 17 条**（闸门靠"引用键不存在"才抓到）。⇒ 掉条就拒绝，除非显式
    #   `--allow-drop`（那时把掉掉的键打出来，留痕）。
    dropped = dropped_keys((load_ledger().get("facts") or {}) if os.path.exists(OUT) else {}, facts)
    if dropped and "--allow-drop" not in argv:
        print("FATAL: 本次会从台账里**掉掉 %d 条事实**（输入不在？）：%s"
              % (len(dropped), ", ".join(dropped)), file=sys.stderr)
        print("       台账不写。要么把输入准备好（例：站点上要有 `threads/`），", file=sys.stderr)
        print("       要么显式 `--allow-drop`（并把掉掉的键记进 HISTORY）。", file=sys.stderr)
        return 2
    if dropped:
        print("⚠ --allow-drop：本次掉掉 %d 条：%s" % (len(dropped), ", ".join(dropped)), file=sys.stderr)
    doc = {"schema": 1, "generated": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
           "_why": "事实台账（F2）：每条 = 一个**测出来**的数字 + 复跑命令 + 出处。别手改，跑 build/facts.py。",
           "facts": facts}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    print("已写出 %s（%d 条事实）" % (OUT, len(facts)))
    for k, v in sorted(facts.items()):
        print("  %-20s %s" % (k, v["value"]))
    return 0


if __name__ == "__main__":
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
    from gate import selftest as _st            # noqa: E402
    sys.exit(_st("facts.py 渲染", CASES) if "--selftest" in sys.argv else main(sys.argv[1:]))
