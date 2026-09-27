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
