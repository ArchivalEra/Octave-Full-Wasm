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
# 用法：python3 build/facts.py        # 量一遍并写 build/FACTS.json
# ⚠️ 量不到的项**不写**（宁缺勿假）：比如最近一次全绿回归只在有 sweep-logs 的机器上有。
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


def fact(value, cmd, source, note=""):
    d = {"value": value, "cmd": cmd, "source": source}
    if note:
        d["note"] = note
    return d


def main():
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
    sys.exit(main())
