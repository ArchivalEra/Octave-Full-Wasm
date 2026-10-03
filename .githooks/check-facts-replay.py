#!/usr/bin/env python3
# Octave-Full-Wasm — **复跑闸门**（事实系统；Einfacht issue #2①/#4 移植，工单 37，2026-10-02）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 台账里 replay=True 的事实，其 `cmd` **逐字执行一遍**（cwd = 仓库根），
# stdout（去首尾空白）必须 == str(value)。
#
# 它挡的是机制最大的空头承诺（Einfacht issue #2① 原话）：「能复跑」若从没人真的复跑过，
# cmd 腐烂（路径移走、工具改名、命令直接报错）就会被 --render-doc 原样印进活状态文档，
# 每个闸门照绿不误。
#
# 判据：
#   · 裸值契约：stdout.strip() == str(value)。只打印"含该值的整行"⇒ 人眼可读、机器不可判 ⇒ 不符。
#   · 返回码非 0 ⇒ 报（坏命令不是"值变了"，是复跑方式本身死了）。
#   · 超时 ⇒ 报（默认 10s，FACTS_REPLAY_TIMEOUT 覆盖）——挂在 pre-commit 里的命令不许等不到。
#   · 没有 cmd / 形状不对 ⇒ 报（没复跑命令的事实是散文）。
#   · 管道不吞错：bash -o pipefail -c（`cat 没了 | wc -l` 那种"失败但绿"正是本闸要红的东西）；
#     无 bash 退回 /bin/sh 并在输出里明说 —— 判据强度随环境变化，不许静默。
# 零值守卫三条：facts 节为空/缺失 ⇒ 报；replay=True 条数 = 0 ⇒ 报（全豁免不是"通过"是"没查"）；
#   全部执行失败 ⇒ 报。
# 豁免（**有名单、有明说**，不是静默）：单条 `"replay": false` —— 名单在 build/facts.py 的
#   `_no_replay`（重活：浏览器/容器/构建/基准；派生/散文式复跑方式）；整仓出口
#   `FACTS_REPLAY=off`（明说未启用，不假装查过）。
# 边界：复跑只覆盖**不需要构建产物/服务**的事实；"每跑必变"的量（采样+稳定性标记）不许裸存
#   —— build/facts.py 的 fact() docstring 与 docs/agents/fact-system.md 有同一条。
# ⚠ 信任边界与 pre-commit 脚本本身相同：台账是仓库自己生产自己审查的文件。
import json
import os
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "build", "lib"))

from gate import Gate, root, run_quiet, selftest  # noqa: E402

FACTS = os.path.join(root(), "build", "FACTS.json")


def _timeout():
    try:
        return float(os.environ.get("FACTS_REPLAY_TIMEOUT", "10"))
    except ValueError:
        return 10.0


def read_facts():
    with open(FACTS, encoding="utf-8") as fh:
        doc = json.load(fh)
    f = doc.get("facts")
    return f if isinstance(f, dict) else {}


def check(g, facts, have_bash):
    """纯检查逻辑（selftest 也走这里）：往 g 里记 note/problem。返回 replay 成功条数。"""
    g.require_nonempty(facts, "事实台账（build/FACTS.json 的 facts 节）")
    if not have_bash:
        g.note("⚠ 无 bash：退回 /bin/sh（pipefail 语义丢失，判据强度随环境变化 —— 明说不静默）")
    shell = ["bash", "-o", "pipefail", "-c"] if have_bash else ["/bin/sh", "-c"]
    todo = {k: v for k, v in facts.items()
            if isinstance(v, dict) and v.get("replay", True)}
    # ★ 见证档（2026-10-02，本仓实战反哺 → Einfacht）：`witness` 与 `replay` **正交** ——
    #   贵事实（`replay=False`，如浏览器基准/构建产物）挂一条**便宜见证**，每提交必跑。
    #   动机见 build/facts.py 的 fact() docstring 与 build/113/witness-build-provenance.py。
    wit = {k: v for k, v in facts.items()
           if isinstance(v, dict) and v.get("witness")}
    # ★ 第四档：**仪器校准**（Einfacht #6 ① 移植）：声称"产物里有没有 X"的 cmd 配一个
    #   已知含 X 的样本（`calibrate` + `calibrate_expect`）—— 抓"仪器静默失真"
    #   （命令成功、值稳定、复跑永远通过，而它量的根本不是想量的）。与 replay/witness 正交。
    cal = {k: v for k, v in facts.items()
           if isinstance(v, dict) and v.get("calibrate")}
    if not todo and not wit and not cal:
        g.problem("replay=True 的事实为 0、且无 witness / calibrate —— "
                  "全豁免不是「通过」，是这个闸门什么都没查")
        return 0
    if not todo:
        g.note("replay=True 的事实为 0，但台账挂 %d 条探针（witness %d / calibrate %d）"
               " ⇒ 由探针档覆盖" % (len(wit) + len(cal), len(wit), len(cal)))
    ok = 0
    for k in sorted(todo):
        v = todo[k]
        cmd = v.get("cmd")
        if not cmd or not isinstance(cmd, str):
            g.problem("%s: 没有 cmd —— 没复跑命令的事实就是散文" % k)
            continue
        try:
            p = subprocess.run(shell + [cmd], cwd=root(),
                               capture_output=True, text=True, timeout=_timeout())
            rc, out, err = p.returncode, p.stdout, p.stderr
        except subprocess.TimeoutExpired:
            g.problem("%s: 复跑超时（>%ss）—— pre-commit 里的命令不许等不到" % (k, _timeout()))
            continue
        if rc != 0:
            tail = (err or "").strip().splitlines()
            g.problem("%s: cmd 退出码 %d（复跑方式本身死了）：%s"
                      % (k, rc, tail[-1][:120] if tail else "（无 stderr）"))
            continue
        got, want = out.strip(), str(v.get("value"))
        if got != want:
            g.problem("%s: 复跑不符 —— stdout=%r ≠ 值 %r（cmd 腐烂或值过时；"
                      "重测：python3 build/facts.py，改口逐条 --accept-changes）"
                      % (k, got[:60], want[:60]))
            continue
        ok += 1
        g.note("✓ %s" % k)
    if ok == 0 and len(todo) > 1:
        # 单条失败自己就是全部故事；两条以上全死才追加"整体死亡"（别双重报告同一件事）
        g.problem("replay=True 的 %d 条全部执行失败 —— 台账的复跑方式整体死了" % len(todo))
    elif todo:
        g.note("复跑闸门：%d/%d 条逐字复现（裸值契约）" % (ok, len(todo)))
    ok += _probe_pass(g, wit, "witness", "见证", shell)
    ok += _probe_pass(g, cal, "calibrate", "仪器校准", shell)
    return ok


def _probe_pass(g, items, kind, noun, shell):
    """探针档（witness / calibrate）：逐字执行，要求 stdout == `<kind>_expect`（与 replay 正交）。
    没挂**不算失败**（机制可以逐步落地）；挂了就必须过。返回通过条数。
    witness = 来源见证；calibrate = 仪器校准（不符 = 仪器失真：先用已知正样本证明
    仪器看得见 X，再计数 —— Einfacht #6 ①）。"""
    if not items:
        return 0
    ok = 0
    for k in sorted(items):
        v = items[k]
        cmd, want = v.get(kind), v.get(kind + "_expect")
        if not isinstance(cmd, str) or not isinstance(want, str):
            g.problem("%s: %s 与 %s_expect 必须都是字符串（形状契约）" % (k, kind, kind))
            continue
        try:
            p = subprocess.run(shell + [cmd], cwd=root(),
                               capture_output=True, text=True, timeout=_timeout())
            rc, out, err = p.returncode, p.stdout, p.stderr
        except subprocess.TimeoutExpired:
            g.problem("%s: %s 超时（>%ss）" % (k, noun, _timeout()))
            continue
        if rc != 0:
            tail = (err or "").strip().splitlines()
            g.problem("%s: %s 退出码 %d：%s"
                      % (k, noun, rc, tail[-1][:120] if tail else "（无 stderr）"))
            continue
        got = out.strip()
        if got != want:
            hint = ("**见证失败（来源漂移）**" if kind == "witness"
                    else "**仪器失真**（校准不符：先用已知正样本证明仪器看得见 X，再计数）")
            g.problem("%s: %s —— %s stdout=%r ≠ 期望 %r" % (k, hint, noun, got[:80], want[:40]))
            continue
        ok += 1
        g.note("\u2713 %s %s：%s" % (kind, k, got[:40]))
    if ok == 0 and len(items) > 1:
        g.problem("%s 的 %d 条全部失败 —— %s" % (noun, len(items),
                  "贵的测量全部失去了便宜的复查" if kind == "witness" else "仪器全部失真"))
    else:
        g.note("%s档：%d/%d 条通过" % (noun, ok, len(items)))
    return ok


def main():
    if os.environ.get("FACTS_REPLAY", "").lower() == "off":
        g = Gate("check-facts-replay")
        g.note("FACTS_REPLAY=off：整仓豁免被显式声明（不假装查过）")
        return g.finish()
    g = Gate("check-facts-replay", list_mode="--list" in sys.argv)
    try:
        facts = read_facts()
    except (OSError, ValueError) as e:
        g.problem("读不到台账", "%r" % (e,))
        return g.finish()
    check(g, facts, shutil.which("bash") is not None)
    return g.finish()


def _np(facts):
    g = Gate("x")
    run_quiet(check, g, facts, True)
    return len(g.problems)


# ⚠ CASES 直接喂 **facts 节的内容**（check() 的入参就是它，别再包一层 {"facts": …} ——
#   第一版就包错了层，九条用例八条在测"没有 cmd"（自证先红给自己看））。
_LED = {"k1": {"value": "5", "cmd": "echo 5"},
        "k2": {"value": "6", "cmd": "echo 6", "replay": False}}
CASES = [
    ("能逐字复现的事实 ⇒ 不报", lambda: _np({"k1": {"value": "5", "cmd": "echo 5"}}) == 0),
    ("stdout ≠ 值 ⇒ 必须报", lambda: _np({"k1": {"value": "5", "cmd": "echo 6"}}) >= 1),
    ("rc≠0（坏命令）⇒ 必须报", lambda: _np({"k1": {"value": "5", "cmd": "exit 3"}}) >= 1),
    ("replay=False 被跳过、其余照查 ⇒ 不报", lambda: _np(_LED) == 0),
    ("★ 全豁免 ⇒ 必须报（零值守卫）",
     lambda: _np({"k1": {"value": "5", "cmd": "echo 6", "replay": False}}) >= 1),
    ("★ facts 节为空/缺失 ⇒ 必须报（零值守卫）", lambda: _np({}) >= 1),
    ("散文事实（无 cmd）⇒ 必须报", lambda: _np({"k1": {"value": "5"}}) >= 1),
    ("★ 两条全死 ⇒ 整体死亡守卫追加（恰好 3 个问题：2 逐条 + 1 整体）",
     lambda: _np({"k1": {"value": "5", "cmd": "echo 6"},
                  "k2": {"value": "7", "cmd": "echo 8"}}) == 3),
    # ── 见证档（witness，2026-10-02）：贵事实（replay=False）的便宜复查 ──
    ("贵事实 + 见证通过 ⇒ 不报（replay=False 不再等于「永不复查」）",
     lambda: _np({"big": {"value": "x", "cmd": "true", "replay": False,
                          "witness": "echo match", "witness_expect": "match"}}) == 0),
    ("★ 见证输出 ≠ 期望 ⇒ 必须报（来源漂移被抓）",
     lambda: _np({"big": {"value": "x", "cmd": "true", "replay": False,
                          "witness": "echo DRIFT", "witness_expect": "match"}}) >= 1),
    ("★ 见证命令 rc≠0 ⇒ 必须报",
     lambda: _np({"big": {"value": "x", "cmd": "true", "replay": False,
                          "witness": "exit 3", "witness_expect": "match"}}) >= 1),
    ("★ witness 与 witness_expect 只给一个（形状残缺）⇒ 必须报",
     lambda: _np({"big": {"value": "x", "cmd": "true", "replay": False,
                          "witness": "echo match"}}) >= 1),
    # ── 仪器校准档（calibrate，issue #6 ① 移植）──
    ("校准通过（样本已知输出对上）⇒ 不报",
     lambda: _np({"x": {"value": "5", "cmd": "true", "replay": False,
                        "calibrate": "echo 1", "calibrate_expect": "1"}}) == 0),
    ("★ 校准不符（仪器失真）⇒ 必须报",
     lambda: _np({"x": {"value": "5", "cmd": "true", "replay": False,
                        "calibrate": "echo 0", "calibrate_expect": "1"}}) >= 1),
    ("★ 校准命令 rc≠0 ⇒ 必须报",
     lambda: _np({"x": {"value": "5", "cmd": "true", "replay": False,
                        "calibrate": "exit 3", "calibrate_expect": "1"}}) >= 1),
    ("★ calibrate 与 calibrate_expect 只给一个 ⇒ 必须报（形状残缺）",
     lambda: _np({"x": {"value": "5", "cmd": "true", "replay": False,
                        "calibrate": "echo 1"}}) >= 1),
    ("★ 只有 witness 事实、没有 replay 事实 ⇒ 不报（全豁免守卫已被见证档覆盖）",
     lambda: _np({"big": {"value": "x", "cmd": "true", "replay": False,
                          "witness": "echo match", "witness_expect": "match"}}) == 0
     and _np({"big": {"value": "x", "cmd": "true", "replay": False}}) >= 1),
]

if __name__ == "__main__":
    sys.exit(selftest("check-facts-replay", CASES) if "--selftest" in sys.argv else main())
