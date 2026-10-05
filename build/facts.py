#!/usr/bin/env python3
# Octave-Full-Wasm — **事实台账生成器**（事实系统 F2，2026-09-26）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# ═══════════════════════════════════════════════════════════════════════════════
# 为什么有它（实测，见架构评审 §0 与 `build/113/PLAN-arch.md` §2）
#
# 本仓的"测出来的数字"被**手抄在 3–6 处**（`22 个环境变量` 曾 6 处 —— 该实例已于 2026-09-29 修掉，relink.sh 改为引用台账键 env_vars；`4752` 4 处、
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
#   python3 build/facts.py --accept-changes       # 允许本次**改口**（旧值→新值打出来；确认是实测出来的再按）
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
#
# ★ 两道守卫（2026-09-27，互为补充）—— **重测**这一步有两个静默的坏法，各配一道：
#   · **掉条**（键没了）：输入不在 ⇒ 事实**静默消失**。守卫 `dropped_keys` + `--allow-drop`。
#   · **改口**（值换了）：输入变了、或量错了 ⇒ 事实**静默改成另一个数**。这条更阴 ——
#     `check-facts.py` 的规则 D 只对 **3 个 sha** 回盘核对，其余 41 条的旧值一旦被覆盖，
#     **再也查不到它变过**。守卫 `changed_keys` + `--accept-changes`。
#   ⚠️ 改口守卫**只比 `value`**，不比 `cmd`/`source`/`note`：那是"复跑方式"的描述，改它们是
#   文档维护的正常动作；连它们也要显式接受 ⇒ 守卫变成噪音 ⇒ 最后被 `--accept-changes` 一律
#   糊过去，守卫就废了（这就是为什么它守住的范围要窄）。
# ═══════════════════════════════════════════════════════════════════════════════
import glob
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


def fact(value, cmd, source, note="", measured_at=None, replay=True,
         witness=None, witness_expect=None,
         calibrate=None, calibrate_expect=None):
    # ★ Einfacht issue #3 ②（2026-10-01 移植）：每条事实盖**采集时刻**戳。
    #   时间是采集结果的**记录**（渲染给人看"测龄"），不参与任何判据 ——
    #   按墙上时钟算东西会让 `--check` 永不收敛（Einfacht 的教训，照抄）。
    # ★ Einfacht issue #4 ④⑤（2026-10-02 移植）：replay 契约 —— cmd 会被
    #   `check-facts-replay` 逐字执行并要求 stdout（去首尾空白）== str(value)。
    #   两类显式豁免（**有名单、有明说**，不是静默）：需要构建产物/浏览器的重活；
    #   派生/散文式复跑方式。③ 每跑必变的量（随机填充、时间戳类）：存**一次实测采样**
    #   并在 note 里写明它怎么变（消费侧 stable 逐字判 / 不稳定档结构判）——
    #   **不许裸存**：裸存 = 这条永远红 = 噪音 = 最后整闸被关（值会变 ≠ 不能进台账）。
    # ★ 第三档：`witness`（2026-10-02，本仓实战反哺 → Einfacht）—— **贵事实的便宜见证**。
    #   动机（`-flto` 事故）：`replay=False` 的贵事实（浏览器基准、构建产物）此前只有两档 ——
    #   要么每次真跑（贵到不能进 pre-commit），要么**永不复查**。于是一条"产物没变、但产出
    #   它的工具变了"（容器 `link-web.sh` 被塞进 `-flto`）能一路走到全量回归才炸。
    #   `witness` = 一条**便宜、无害、只读**的命令，逐字执行且 stdout == `witness_expect`；
    #   它与 `replay` **正交** —— 贵事实（`replay=False`）照样可以挂见证，每提交必跑。
    #   见证的是**上下文**（"产出它的工具/输入就是你以为的那个"），不是值本身。
    #   形状契约：`witness` 与 `witness_expect` 必须**同时给或同时不给**（只给一个 ⇒ 断言
    #   不完整，采集器当场报错）。
    # ★ 第四档：**仪器校准**（Einfacht issue #6 ① 移植，2026-10-03）—— 复跑契约抓
    #   "命令死了"（rc≠0），却抓不到**仪器静默失真**：命令成功、值稳定、复跑永远"通过"，
    #   而它量的根本不是想量的。事故（本仓 relaxed-simd 实验）：`llvm-objdump -d | grep -c
    #   relaxed_madd` 在该 objdump 不认这条指令时**成功退出并返回 0** —— 两次误判"FMA 没进产物"。
    #   ⇒ 声称"产物里有没有 X"的 cmd 配一个**已知含 X 的样本**：`calibrate`（对样本跑的命令）+
    #   `calibrate_expect`（样本的已知输出）。与 replay / witness 正交，每提交真跑。
    #   `witness` / `calibrate` 两对各自**同给或同不给**（残缺形状当场报错）。
    #   `first_seen`：值不变时由 measure() 沿用旧日期、换值时取今天 —— 恒常检测
    #   （"这条 cmd 是在量，还是恒返回同一个数？"）的状态（记录，不是测量输入）。
    for _a, _b, _n in ((witness, witness_expect, "witness"),
                       (calibrate, calibrate_expect, "calibrate")):
        if (_a is None) != (_b is None):
            raise ValueError("fact(%s): `%s` 与 `%s_expect` 必须同时给或同时不给"
                             "（残缺断言比静默缺失好抓）" % (source, _n, _n))
    d = {"value": value, "cmd": cmd, "source": source,
         "measured_at": measured_at or time.strftime("%Y-%m-%dT%H:%M:%S%z"),
         "first_seen": time.strftime("%Y-%m-%d")}
    if not replay:
        d["replay"] = False
    if witness is not None:
        d["witness"] = witness
        d["witness_expect"] = witness_expect
    if calibrate is not None:
        d["calibrate"] = calibrate
        d["calibrate_expect"] = calibrate_expect
    if note:
        d["note"] = note
    return d


# ── 渲染：台账 → 活状态文档里的机器块（数字的**唯一产地**）────────────────────────
# ⚠️ 渲染函数与块标记搬去了 `build/lib/facts_block.py` —— 生成器（本文件）与闸门
#    （`.githooks/check-facts.py`）必须共用同一套渲染，否则"块对不对"两边口径会分叉。
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from facts_block import (BLOCK_BEGIN, BLOCK_END, block_body,  # noqa: E402
                         render_block)

DOC = "STATE.md"


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


def _short(v, n=24):
    """把值缩到一行（sha 只留前 16 位），给"改口"提示用。"""
    s = v if isinstance(v, str) else str(v)
    return s if len(s) <= n else (s[:16] + "…" if len(s) == 64 else s[:n] + "…")


def _accepted_keys(argv):
    """解析 `--accept-changes[=k1,k2]`（Einfacht issue #3 ①，2026-10-01 移植）：
    裸旗 ⇒ None（全收）；列键 ⇒ 集合（空串 ⇒ 空集 = 一个都不收）；没传 ⇒ False（全拒，同旧行为）。"""
    for a in argv:
        if a == "--accept-changes":
            return None
        if a.startswith("--accept-changes="):
            return {k.strip() for k in a.split("=", 1)[1].split(",") if k.strip()}
    return False


def filter_accepted(changed, accepted):
    """改口清单里**还没被接受**的部分（纯函数：自证要用）。

    `accepted=None` ⇒ 全收；`False` ⇒ 全拒；集合 ⇒ 只留未列出的键。
    """
    if accepted is None:
        return []
    if accepted is False:
        return list(changed or [])
    return [c for c in (changed or []) if c[0] not in accepted]


def changed_keys(old_facts, new_facts):
    """本次重测会把哪些键的**值**换掉（纯函数：自证要用）。返回 [(键, 旧值, 新值)]。

    与 `dropped_keys` 是一对，管两件不同的坏事：
      · 掉条 = 键没了（输入不在 ⇒ 事实静默消失）；
      · 改口 = 值换了（输入变了/量错了 ⇒ 事实静默改成另一个数）。
    后者更难发现：`check-facts.py` 只对 3 个 sha 回盘核对，其余条目没有新鲜度检查。

    ⚠️ **只比 `value`**（见文件头"两道守卫"那段）：`cmd`/`source`/`note` 是复跑方式的描述，
    改它们不该要求一次显式接受。新增的键也不算"改口"（那是新增，交给 `dropped_keys` 的反面）。
    """
    def _v(f):
        return f.get("value") if isinstance(f, dict) else f

    olds = old_facts or {}
    out = []
    for k, nv in sorted((new_facts or {}).items()):
        if k not in olds:
            continue                      # 新增的键不是"改口"
        if _v(olds[k]) != _v(nv):
            out.append((k, _v(olds[k]), _v(nv)))
    return out


def main(argv):
    if argv and argv[0] == "--render":
        sys.stdout.write(render_block(load_ledger()) + "\n")
        return 0
    if argv and argv[0] == "--get":
        # ★ Einfacht issue #4 ④（2026-10-02 移植）：跨语言消费方的**官方只读出口**。
        #   只打印值本身（不解释、不带前缀）；消费方一律走这里，不许自己解析 JSON
        #   （uTLS-Gone 的教训：手搓 substring 解析器会把别的键上的同形值判进来）。
        if len(argv) < 2:
            print("FATAL: --get 需要一个键名：--get KEY", file=sys.stderr)
            return 2
        led = load_ledger()
        f = led.get("facts") or {}
        if argv[1] not in f:
            print("FATAL: 台账里没有键 %s" % argv[1], file=sys.stderr)
            return 2
        v = f[argv[1]].get("value")
        print(v if isinstance(v, str) else json.dumps(v, ensure_ascii=False))
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
    return measure(argv)


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
    # ★ 改口守卫（2026-09-27，与掉条守卫是一对）：值换了必须**显式接受**
    ("★ **改口 ⇒ changed_keys 必须报出来，且带旧值→新值**",
     lambda: changed_keys({"a": {"value": 1}}, {"a": {"value": 2}}) == [("a", 1, 2)]),
    ("★ 值没变（相同）⇒ 不报", lambda: changed_keys({"a": {"value": 1}}, {"a": {"value": 1}}) == []),
    ("★ **只改 cmd/source ⇒ 不报**（复跑方式的描述不是「改口」，否则守卫会变噪音）",
     lambda: changed_keys({"a": {"value": 1, "cmd": "旧", "source": "旧"}},
                          {"a": {"value": 1, "cmd": "新", "source": "新"}}) == []),
    # ★ Einfacht issue #3 ①（2026-10-01 移植）：`--accept-changes[=k1,k2]` 逐条放行
    ("★ 逐条接受：只收列出的键，未列出的仍留在改口清单",
     lambda: filter_accepted([("a", 1, 2), ("b", 3, 4)], {"a"}) == [("b", 3, 4)]),
    ("★ 裸旗 = 全收（清单空）", lambda: filter_accepted([("a", 1, 2)], None) == []),
    ("★ 没传 = 全拒（清单原样）", lambda: filter_accepted([("a", 1, 2)], False) == [("a", 1, 2)]),
    ("★ `--accept-changes=`（空列表）= 一个都不收",
     lambda: filter_accepted([("a", 1, 2)], _accepted_keys(["--accept-changes="])) == [("a", 1, 2)]),
    ("★ `_accepted_keys` 解析：裸旗/列键/没传 三态",
     lambda: _accepted_keys(["--accept-changes"]) is None
     and _accepted_keys(["--accept-changes=a,b"]) == {"a", "b"}
     and _accepted_keys([]) is False),
    ("★ 新增的键 ⇒ 不算改口（那是新增，不该被这条拦）",
     lambda: changed_keys({"a": {"value": 1}}, {"a": {"value": 1}, "b": {"value": 9}}) == []),
    ("★ 空台账起步（旧为空）⇒ 不报", lambda: changed_keys({}, {"a": {"value": 1}}) == []),
    ("★ sha 型的长值：_short 必须截断（否则 FATAL 一行能刷屏）",
     lambda: _short("a" * 64) == "a" * 16 + "…"),
]


def measure(argv):
    """量一遍全部事实并写台账。

    ⚠️ **必须接 `argv`**（2026-09-27 实测）：两道守卫都要读 `--allow-drop` / `--accept-changes`。
    这个参数以前缺着 —— 于是 drop guard 里那句 `not in argv` 是个 **NameError**，
    只在**真的掉条时**才炸（短路的反面：不掉条就永远走不到那句）。
    后果：掉条时报的不是"掉了哪几条"，而是一段 traceback；`--allow-drop` 从来没生效过。
    "写盘被拦住了"是**顺带**的（异常早于写盘），不是守卫生效 —— 那不叫守卫，那叫故障。
    """
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

    # ── ★ 选档探针的实测汇总（B6 双档 → 工单 30 四格）：从**保存下来的探针日志**里读
    #    （facts.py 不自己开浏览器）──
    #    为什么要有这条：HANDOFF 会写"probe-lane N PASS / 0 FAIL"，那是**测出来的数字** ⇒ 按 F2 的规矩
    #    必须来自台账、并由闸门核对（否则它会静默漂移）。跑法见本条 cmd。
    #    ⚠️ 站点是**四格还是双档**决定 PASS 数（四格多 6 格：Cell 1–4 每格多两条 + Cell 6/7 各多一条）
    #    ⇒ 记录时**连站点一起记**（cmd 里的 SITE_DIR），否则"17"与"四格版"会互相冒充。
    pl = os.environ.get("PROBE_LANE_LOG", os.path.join(os.path.dirname(SITE), "probe-lane.log"))
    if os.path.exists(pl):
        try:
            txt = open(pl, encoding="utf-8", errors="replace").read()
            m = re.search(r"===\s*(\d+) PASS / (\d+) FAIL\s*===", txt)
            if m:
                facts["probe_lane_pass"] = fact(int(m.group(1)),
                                                "SITE_DIR=<站点> sh test/browser/run.sh "
                                                "test/browser/probe-lane.mjs > %s" % pl,
                                                os.path.basename(pl),
                                                "选档探针的 PASS 数（FAIL 必须 0）；站点四格/双档不同 ⇒ 看 cmd 的 SITE_DIR")
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

    # ── ★ wasm64 车道（工单 14/17/18，2026-09-28）：memory64 的实测事实 ──────────────
    # 为什么进台账：w64 那组数字（导出数 / i64 密度 / 44 个 `.oct` 有几个是 64 位）本来是**散文** ——
    #   只活在 `NOTES-wasm64.md` 与工单 Answer 里，没有任何东西拦得住它们腐烂。这组把它们上键。
    # 量什么：宿主上的 `w64-artifacts/`（docker cp 出来的产物与身份证）+ `w64-logs/`
    #   （由 `build/113/build-w64-lane.sh` 的 **facts 阶段**写的两份日志）。
    W64A = os.environ.get("W64_ARTIFACTS", os.path.join(os.path.dirname(SITE), "w64-artifacts"))
    W64L = os.environ.get("W64_LOGS", os.path.join(os.path.dirname(SITE), "w64-logs"))
    try:
        bj = json.load(open(os.path.join(W64A, "octave.build.json"), encoding="utf-8"))
        me = bj.get("measured") or {}
        facts["w64_verdict"] = fact(bj.get("verdict"),
                                    "python3 build/facts.py（读 %s/octave.build.json）" % W64A,
                                    "w64-artifacts/octave.build.json",
                                    "只有 ok 才可部署（fail-closed）")
        # ★ 64 位的**硬身份**：wasm 内存段的 limits flags bit2（`write-build-manifest.py` 解析它）。
        #   有这个键，一份 w64 产物与一份 wasm32 产物在身份证上就**分得开** ——
        #   上一批的缺口正是"分不开"。
        facts["w64_wasm64"] = fact(bool(me.get("wasm64")),
                                   "读 %s 的 measured.wasm64" % W64A,
                                   "w64-artifacts/octave.build.json",
                                   "wasm 内存段 limits flags bit2 = 1 ⇒ 真 64 位")
        facts["w64_shared_memory"] = fact(bool((me.get("threads") or {}).get("shared_memory")),
                                          "读 %s 的 measured.threads.shared_memory" % W64A,
                                          "w64-artifacts/octave.build.json",
                                          "目标形态 = memory64 **+ 多线程**（shared 是这个轴的硬身份）")
        # ★ 工单 59 发运（2026-10-04）：现役 w64 的分配器上台账（旋钮进模式表后它是产物身份的一部分；
        #   探针 = 导出段 mi_version；候选那组的 witness 见 w64_cand_malloc）。
        facts["w64_malloc"] = fact((bj.get("declared") or {}).get("malloc") or me.get("malloc"),
                                   "读 %s 的 declared.malloc / measured.malloc" % W64A,
                                   "w64-artifacts/octave.build.json",
                                   "现役 w64 的分配器（工单 59 起 = mimalloc，由 relink.sh w64 模式表声明）")
        if (me.get("simd") or {}).get("v128") is not None:
            facts["w64_v128"] = fact(me["simd"]["v128"], "读 %s 的 measured.simd.v128" % W64A,
                                    "w64-artifacts/octave.build.json")
        if me.get("exported_functions") is not None:
            # ★ **首个 calibrate 事实**（Einfacht #6 ① 移植，2026-10-03）：工单 52 的
            #   relaxed-simd FMA 指令计数。**声称"产物里有没有 X"就必须先校准仪器**——
            #   事故：`llvm-objdump -d | grep -c relaxed_madd` 在 emsdk 5.0.7 上恒为 0
            #   （该 objdump 对这条指令打印 `<unknown>`），据此两次误判。正解 = 字节级计数
            #   `fd 87 02`，并先用**已知含它的样本**（test/fixtures/relaxed_madd_min.wasm）
            #   证明仪器看得见。`cli` 命令对产物与样本跑同一段字节计数脚本。
            _rm_py = ("import sys;d=open(sys.argv[1],'rb').read();"
                      "print(d.count(bytes([0xFD,0x87,0x02])))")
            def _rm_count(_path):
                import subprocess as _sp
                try:
                    return int(_sp.run(["python3", "-c", _rm_py, _path],
                                       capture_output=True, text=True, timeout=30).stdout.strip() or 0)
                except Exception:                                     # noqa: BLE001
                    return None
            _w64wasm = os.path.join(W64A, "octave.wasm")
            _rmn = _rm_count(_w64wasm)
            if _rmn is not None:
                facts["w64_relaxed_madd"] = fact(
                    _rmn,
                    cmd=("<重活：产物 + test/fixtures/relaxed_madd_min.wasm 各数 fd 87 02>"),
                    source="%s 的字节级 f64x2.relaxed_madd 计数（×dd 87 02）" % _w64wasm,
                    note="relaxed-simd FMA 指令数（工单 52）。⚠ 量法本身有生命周期："
                         "`grep relaxed_madd` 是**被证伪的量法**（见 build/instruments.json）——"
                         "本键的 cmd 已避开它（字节级）。calibrate= 用已知含它的样本自证。",
                    replay=False,
                    calibrate="python3 -c \"import sys;d=open(sys.argv[1],'rb').read();print(d.count(bytes([0xFD,0x87,0x02])))\" test/fixtures/relaxed_madd_min.wasm",
                    calibrate_expect="1",
                )
            facts["w64_exported_functions"] = fact(me["exported_functions"],
                                                  "读 %s 的 measured.exported_functions" % W64A,
                                                  "w64-artifacts/octave.build.json")
        wf = (me.get("files") or {}).get("octave.wasm") or {}
        facts["w64_wasm_sha"] = fact(wf.get("sha256"), "sha256sum %s/octave.wasm" % W64A,
                                    "w64-artifacts/octave.wasm")
        # ★ **构建身份见证**（2026-10-02，`-flto` 事故的通用解 → 事实系统第三档 `witness`）：
        #   部署件 w64 必须由**仓库现役** `build/113/link-web.sh` 构建。值本身（是不是真由
        #   现役脚本造的）要重链才知 ⇒ `replay=False`；但这条**便宜见证**每提交必跑，能在
        #   不碰浏览器的情况下抓到"来源漂移"（容器脚本被改 / 上批实验残留）。
        #   事故形状：w64 记的 `tool.script_sha256` = `2382ed34…`（容器残留 `-flto` 的那份），
        #   仓库是 `63d8e7d7…` ⇒ 72/0→44/27 的 dlopen 回归。见 HISTORY §5.78 / 工单 41。
        # ★ 构建输入不变式（工单 53；Einfacht #6 ② "输入要有便宜的落点"）：**配方层**的见证。
        #   与 w64_build_tool_match（产物侧：部署件记的工具 sha == 仓库）互补——这条看**仓库配方
        #   本身有没有被证伪的片段 / 缺必需旗标**（-flto 漂移、丢 -sMEMORY64=1）。声明式清单
        #   build/build-inputs.json；只读、不构建、不碰容器 ⇒ 进 witness 档每提交真跑。
        facts["w64_build_recipe_ok"] = fact(
            "ok",
            cmd="python3 build/113/witness-build-inputs.py",
            source="build/build-inputs.json 的声明式检查 vs 仓库配方文件",
            note="构建**输入**的不变式（配方层）：link-web.sh 无 -flto / 含 -fwasm-exceptions；"
                 "w64 车道含 -sMEMORY64=1。把「输入」也当事实，由同一批复跑闸门核对 ——"
                 "由同一批复跑闸门每提交核对。",
            replay=False,
            witness="python3 build/113/witness-build-inputs.py",
            witness_expect="ok")
        facts["w64_build_tool_match"] = fact(
            "match",
            cmd="<重链 w64 后：python3 build/113/witness-build-provenance.py w64>",
            source="site/w64/octave.build.json 的 tool.script_sha256 vs build/113/link-web.sh",
            note="贵事实的便宜见证：部署件记录的构建脚本 sha 必须 == 仓库现役脚本。"
                 "做不到就 DRIFT（来源漂移）。注意**旧档**（base/threads/w64-base）建造时间不同、"
                 "记录 sha 各异 ⇒ 只对活跃迭代并每批重链的 w64 档断言。",
            replay=False,
            witness="python3 build/113/witness-build-provenance.py w64",
            witness_expect="match")
        facts["w64_wasm_bytes"] = fact(wf.get("bytes"), "stat -c %%s %s/octave.wasm" % W64A,
                                      "w64-artifacts/octave.wasm")
    except (OSError, ValueError) as e:
        print("⚠ 读不到 w64 身份证（%s）：%s" % (W64A, e), file=sys.stderr)
    # ★ **w64 发运候选**（工单 59，2026-10-04）：mimalloc 版产物（**未发运** —— 发运是产品决定）。
    #   为什么独立一组 `w64_cand_*`：候选不是部署件（promote 之前 `w64-artifacts/` 站着的仍是
    #   现役 FMA 版）——混进 `w64_*` 会让"现役"与"候选"互相冒充。真发运之后这组与 `w64_*`
    #   汇合（同一份产物），届时 `w64_cand_*` 可删或留作历史。
    W64C = os.environ.get("W64_CAND_ARTIFACTS",
                          os.path.join(os.path.dirname(SITE), "w64-artifacts-mimalloc"))
    try:
        bj = json.load(open(os.path.join(W64C, "octave.build.json"), encoding="utf-8"))
        me = bj.get("measured") or {}
        facts["w64_cand_verdict"] = fact(bj.get("verdict"),
                                         "python3 build/facts.py（读 %s/octave.build.json）" % W64C,
                                         "w64-artifacts-mimalloc/octave.build.json",
                                         "候选产物：verdict=ok + 全量验收全绿 ⇒ 可发运（发运=产品决定）")
        facts["w64_cand_malloc"] = fact(
            (bj.get("declared") or {}).get("malloc") or me.get("malloc"),
            "读 %s 的 declared.malloc / measured.malloc" % W64C,
            "w64-artifacts-mimalloc/octave.build.json",
            "分配器（产物探针 = 导出段里的 mi_version；工单 59；mimalloc 工单 57 实测 −27%）。"
            "★ witness = #5 档对**产物**的便宜复查（Einfacht #9 提了即撤：机制不缺，"
            "witness/calibrate 现有档位已覆盖）——每提交重读候选产物导出段，"
            "旋钮没生效/产物被换 ⇒ 见证红。",
            replay=False,
            witness="python3 build/113/write-build-manifest.py --exports %s/octave.wasm" % W64C,
            witness_expect="mimalloc")
        facts["w64_cand_exported_functions"] = fact(
            me.get("exported_functions"),
            "读 %s 的 measured.exported_functions" % W64C,
            "w64-artifacts-mimalloc/octave.build.json")
        _cf = (me.get("files") or {}).get("octave.wasm") or {}
        facts["w64_cand_wasm_sha"] = fact(_cf.get("sha256"),
                                         "sha256sum %s/octave.wasm" % W64C,
                                         "w64-artifacts-mimalloc/octave.wasm")
        facts["w64_cand_wasm_bytes"] = fact(_cf.get("bytes"),
                                           "stat -c %%s %s/octave.wasm" % W64C,
                                           "w64-artifacts-mimalloc/octave.wasm")
    except (OSError, ValueError) as e:
        print("⚠ 读不到 w64 候选身份证（%s）：%s" % (W64C, e), file=sys.stderr)
    # ★ **hotpath 性能热点仪器**（wasm64-NEXT 工单 54）：从它写的 report.json 读（**纯函数**，
    #   不重开浏览器）。这是"消费者/生产者分离"的落点 —— facts.py 只读日志，与读别的探针日志同形。
    try:
        import importlib.util as _ilu
        _hp_path = os.path.join(REPO, "build", "113", "hotpath.py")
        _spec = _ilu.spec_from_file_location("hotpath", _hp_path)
        _hp = _ilu.module_from_spec(_spec)
        _spec.loader.exec_module(_hp)
        for _k, _v in (_hp.read_facts() or {}).items():
            facts[_k] = _v        # _v 已是 fact 形状（含 measured_at/first_seen）⇒ 直接并入，别重盖
    except Exception as _e:                                          # noqa: BLE001
        print("⚠ hotpath 事实读不到（%s）：%s" % (_hp_path, _e), file=sys.stderr)
    # ★ **emcc 6 探针**（IllegalPerformance 线，2026-10-04）：emcc 5.0.7 vs 6.0.10
    #   纯工具链对比（clang 23 vs 24；dgemm/qsort/mem/bytesum 四面交错 3 轮）。
    #   结论：codegen 红利 ≈ 0（geomean 1.00）；旗标存活矩阵全绿（JSPI/MEMORY64/
    #   relaxed-simd/MAIN_MODULE 全活）。详情 build/113/NOTES-upstream.md。
    # ★ **fill spike**（工单 63 / 候选②，2026-10-04）：idx_vector::fill 91% 热点的
    #   Rust slice::fill 对照。实测 2^24 填充 9.5 vs 10.2 ms（比值 1.071，Rust 更慢）
    #   ⇒ **否决**：该热点是内存带宽绑定（134MB/9.5ms ≈ 14GB/s ≈ 带宽顶），
    #   任何实现语言都拿不到。仪器成果（差分门 G2 + 变异自证 G2b 31/31）保留。
    _rf = os.path.join(os.path.dirname(SITE), "w64-logs", "rustfill-spike.log")
    if os.path.exists(_rf):
        import re as _re3
        _m7 = _re3.search(r"比值=([0-9.]+)", open(_rf, encoding="utf-8", errors="replace").read())
        if _m7:
            facts["rust_fill_spike_ratio"] = fact(
                float(_m7.group(1)),
                "sh test/fixtures/rustfill-spike/run-spike.sh（读 w64-logs/rustfill-spike.log 的比值行）",
                "w64-logs/rustfill-spike.log",
                "Rust slice::fill / C++ 标量 fill 的 2^24 填充比值（<1 = Rust 快）；"
                "实测 >1 ⇒ 候选②否决——带宽绑定热点换语言无益",
                replay=False)

    # ★ **sort spike**（工单 63 / 候选③，2026-10-04）：Rust stable sort vs 真
    #   octave_sort<double> 内核——语义差分 22 域逐位一致 + 内核 4× 加速 ⇒ ADOPT。
    _rs = os.path.join(os.path.dirname(SITE), "w64-logs", "rustsort-spike.log")
    if os.path.exists(_rs):
        import re as _re4
        _m8 = _re4.search(r"sort 2e6: base=([0-9.]+)ms cand=([0-9.]+)ms 比值=([0-9.]+)",
                          open(_rs, encoding="utf-8", errors="replace").read())
        if _m8:
            facts["rust_sort_spike_base_ms"] = fact(float(_m8.group(1)),
                "sh test/fixtures/rustsort-spike/run-spike.sh（读 w64-logs/rustsort-spike.log）",
                "w64-logs/rustsort-spike.log",
                "octave_sort<double>（timsort）2M 随机 doubles 排序", replay=False)
            facts["rust_sort_spike_cand_ms"] = fact(float(_m8.group(2)),
                "同上", "w64-logs/rustsort-spike.log",
                "Rust driftsort（stable）同负载", replay=False)
            facts["rust_sort_spike_ratio"] = fact(float(_m8.group(3)),
                "派生：cand ÷ base", "派生（rustsort-spike.log）",
                "内核比值（<0.867 = ≥1.15× 加速门槛）；实测 0.247 = 4× ⇒ ADOPT",
                replay=False)

    # ★ **sort 落地 A/B**（工单 63 / 候选③，2026-10-05）：w64 车道端到端——候选
    #   （RUST_SORT=1：rust_sort+mimalloc+e2-openblas+wasm64 全口径）vs 同树旋钮关
    #   对照。专属站 site-illegalperf(8868)/-baseline(8869)，COI、交错 3 轮、
    #   冷启动=重随机化（instruments.json 排序纪律）。
    _ab = os.path.join(os.path.dirname(SITE), "w64-logs", "rust-sort-ab.log")
    if os.path.exists(_ab):
        import re as _re5
        _ab_txt = open(_ab, encoding="utf-8", errors="replace").read()
        _med = {}
        for _side in ("on", "off"):
            for _tag in ("asc", "desc"):
                _vals = sorted(int(_x) for _x in _re5.findall(
                    r"round\d+ %s %s wall=(\d+)ms" % (_side, _tag), _ab_txt))
                if _vals:
                    _med[(_side, _tag)] = _vals[len(_vals) // 2]
        if ("on", "asc") in _med and ("off", "asc") in _med and _med[("off", "asc")]:
            facts["w64_rustsort_ab_asc_ms"] = fact(_med[("on", "asc")],
                "bash build/113/sort-ab.sh /mnt/hdd/octave-wasm-build/site-illegalperf "
                "/mnt/hdd/octave-wasm-build/site-illegalperf-baseline 3（读 w64-logs/rust-sort-ab.log）",
                "w64-logs/rust-sort-ab.log",
                "候选（rust_sort 开）2M 随机 double 排序墙钟中位（含 rand；w64 槽 COI）", replay=False)
            facts["w64_rustsort_base_ab_ms"] = fact(_med[("off", "asc")],
                "同上", "w64-logs/rust-sort-ab.log",
                "对照（同树旋钮关）同负载墙钟中位", replay=False)
            facts["w64_rustsort_ab_asc_ratio"] = fact(
                round(_med[("on", "asc")] / _med[("off", "asc")], 3),
                "派生：候选 ÷ 对照（asc 中位）", "派生（rust-sort-ab.log）",
                "asc 端到端比值（<0.867 = ≥1.15× 门槛）⇒ 实测 2.0× ADOPT", replay=False)
        if ("on", "desc") in _med and ("off", "desc") in _med and _med[("off", "desc")]:
            facts["w64_rustsort_ab_desc_ratio"] = fact(
                round(_med[("on", "desc")] / _med[("off", "desc")], 3),
                "派生：候选 ÷ 对照（desc 中位）", "派生（rust-sort-ab.log）",
                "desc 端到端比值（同门槛）", replay=False)

    # ★ IllegalPerformance vs wasm64-NEXT 最终对比（2026-10-05）：两端 UI 逐字节同，
    #   唯一变量 = w64 载荷（rust_sort 开/关）。sort 2e6 是唯一实质差异（2.3×）。
    _vs = os.path.join(os.path.dirname(SITE), "w64-logs", "bench-IP-vs-NEXT.log")
    if os.path.exists(_vs):
        import re as _revs
        _vt = open(_vs, encoding="utf-8", errors="replace").read()
        _blocks = _vt.split("=== round")   # 每块 = "N IP\n<SPEED_JSON>...\n=== round M NEXT..."

        def _med(side, case):
            vals = []
            for b in _blocks:
                hm = _revs.match(r"\d+ (IP|NEXT)", b.strip())   # 头行形如 "1 IP ===\n<json>"
                if not hm or hm.group(1) != side:
                    continue
                m = _revs.search(r'"%s":\{"median":([0-9.]+)' % case, b)
                if m:
                    vals.append(float(m.group(1)))
            vals.sort()
            return vals[len(vals) // 2] if vals else None
        _sip = _med("IP", "sort 2e6"); _snx = _med("NEXT", "sort 2e6")
        if _sip and _snx:
            facts["ip_vs_next_sort_ip_ms"] = fact(_sip, "sh test/browser/run.sh test/browser/bench-lanes.mjs <8761> w64（读 w64-logs/bench-IP-vs-NEXT.log）", "w64-logs/bench-IP-vs-NEXT.log", "IllegalPerformance(8761) sort 2e6 中位", replay=False)
            facts["ip_vs_next_sort_next_ms"] = fact(_snx, "同（<8869>）", "w64-logs/bench-IP-vs-NEXT.log", "wasm64-NEXT(8869) sort 2e6 中位", replay=False)
            facts["ip_vs_next_sort_ratio"] = fact(round(_sip/_snx, 3), "派生：IP ÷ NEXT", "派生", "sort 2e6 比值（<1 = IP 快）", replay=False)

    # ★ locale 确定性契约（issue #4 方案 A，2026-10-05）：报错文本英文 + 数字 C locale，
    #   **四档都要过**（核心解释器决定 ⇒ 跨车道/跨分支的不变量）。
    _ll = os.path.join(os.path.dirname(SITE), "w64-logs", "locale-all-lanes.log")
    if os.path.exists(_ll):
        _lt = open(_ll, encoding="utf-8", errors="replace").read()
        _n = _lt.count("8 PASS / 0 FAIL")
        facts["locale_contract_lanes"] = fact(
            _n,
            "for l in w64 base threads w64-base; do sh test/browser/run.sh "
            "test/browser/probe-locale.mjs \"http://127.0.0.1:8761/?lane=$l\"; done "
            "（读 w64-logs/locale-all-lanes.log 的 '8 PASS / 0 FAIL' 计数）",
            "w64-logs/locale-all-lanes.log",
            "locale 确定性契约通过的车道数（应=4）。契约 = 报错英文 + 数字 C locale "
            "(sprintf('%.3f',3.14159)=='3.142')；机制 = 无 NLS .mo + interpreter.cc 强制 "
            "LC_NUMERIC/LC_TIME='C'。issue #4 方案 A 的可测形态", replay=False)

    # ★ xpow 驱动层 spike（候选④，2026-10-05）：模型化 Octave elem_xpow 驱动循环
    #   （octave_quit + 逐元素索引）vs Rust 紧循环，两者调同一 libm pow；driver_only
    #   探针量「驱动层的绝对天花板」。判据：driver_only/base < 15%（加速门槛 1.15×）。
    _xs = os.path.join(os.path.dirname(SITE), "w64-logs", "xpow-spike.log")
    if os.path.exists(_xs):
        import re as _rx
        _xt = open(_xs, encoding="utf-8", errors="replace").read()
        _md = _rx.search(r"driver_only=([0-9.]+)ms", _xt)
        _mb = _rx.search(r"base=([0-9.]+)ms", _xt)
        _mr = _rx.search(r"ratio=([0-9.]+)", _xt)
        if _md and _mb and float(_mb.group(1)) > 0:
            facts["xpow_driver_spike_pct"] = fact(
                round(float(_md.group(1)) * 100.0 / float(_mb.group(1)), 1),
                "bash test/fixtures/xpow-spike/run-spike.sh（读 w64-logs/xpow-spike.log）",
                "w64-logs/xpow-spike.log",
                "elem_xpow 驱动层（octave_quit + 逐元素索引）占 base 的百分比 = 候选④的"
                "绝对天花板；实测 ~2% ≪ 15%（1.15× 门槛）⇒ 候选④排除", replay=False)
        if _mr:
            facts["xpow_driver_spike_ratio"] = fact(float(_mr.group(1)),
                "同上（cand/base）", "w64-logs/xpow-spike.log",
                "Rust 紧循环 vs Octave 形状驱动的比值（含同一 libm pow）", replay=False)

    # ★ 三热点封口审计（工单 63 收口，2026-10-05）：现役口径符号站采样
    #   （hotpath-stations/w64-sym-current，--diag；trusted/unnamed 由 hotpath 校准闸保证）。
    _hp = os.path.join(os.path.dirname(SITE), "w64-logs", "hotpath-final3.log")
    if os.path.exists(_hp):
        _txt = open(_hp, encoding="utf-8", errors="replace").read()
        _sections = _txt.split("## snippet:")
        def _top_pct(sect, name):
            import re as _r
            m = _r.search(r"([0-9.]+)%.*?\b" + _r.escape(name) + r"\b", sect)
            return float(m.group(1)) if m else None
        for _s in _sections:
            if "x.^0.7" in _s:
                lm = sum(x for x in (_top_pct(_s, "exp_inline"), _top_pct(_s, "pow"),
                                     _top_pct(_s, "log_inline")) if x)
                dv = sum(x for x in (_top_pct(_s, "do_rc_map"), _top_pct(_s, "elem_xpow")) if x)
                facts["hotpath_xpow_libm_pct"] = fact(round(lm, 1),
                    "python3 build/113/hotpath.py profile 'x=(1:2e6)/1e6+0.1; tic; for k=1:20, "
                    "y=sqrt(x)+x.^0.7; end' --lane w64（读 w64-logs/hotpath-final3.log）",
                    "w64-logs/hotpath-final3.log",
                    "x.^y 热点里 libm 超越函数（exp+pow+log）合计自占比——IEEE 钉死不可换", replay=False)
                facts["hotpath_xpow_driver_pct"] = fact(round(dv, 1),
                    "同上（elem_xpow + do_rc_map）", "w64-logs/hotpath-final3.log",
                    "x.^y 热点里 Octave C++ 驱动（elem_xpow 逐元素 + do_rc_map 复数重启）合计——"
                    "唯一残余可缝轴（有界，候选④；需 G6 延迟断言）", replay=False)
            if "fft(x)" in _s:
                bt = _top_pct(_s, "blk_trans")
                if bt is not None:
                    facts["hotpath_fft_blktrans_pct"] = fact(bt,
                        "python3 build/113/hotpath.py profile 'x=(1:2e6)/1e6; tic; for k=1:10, "
                        "y=fft(x); end' --lane w64", "w64-logs/hotpath-final3.log",
                        "fft 热点里 blk_trans（8×8 分块转置）自占比——纯数据置换=带宽绑定", replay=False)

    # 候选产物身份证（IllegalPerformance 线专属站，**非 8761 现役**——现役 sha 仍是 w64_wasm_sha）
    _cand_wasm = "/mnt/hdd/octave-wasm-build/artifacts-w64-rust-on/octave.wasm"
    if os.path.exists(_cand_wasm):
        import hashlib as _hl
        facts["w64_rustsort_cand_sha"] = fact(
            _hl.sha256(open(_cand_wasm, "rb").read()).hexdigest(),
            "sha256sum /mnt/hdd/octave-wasm-build/artifacts-w64-rust-on/octave.wasm",
            "artifacts-w64-rust-on/octave.wasm（site-illegalperf w64 槽同源）",
            "rust-sort 候选产物 sha；发运与否 = 产品决定", replay=False)

    _e6 = os.path.join(os.path.dirname(SITE), "w64-logs", "emcc6-probe.log")
    if os.path.exists(_e6):
        import re as _re2
        _m6 = _re2.search(r"geomean\(cand6/base\) = ([0-9.]+)", open(_e6, encoding="utf-8", errors="replace").read())
        if _m6:
            facts["emcc6_probe_geomean"] = fact(
                float(_m6.group(1)),
                "sh test/fixtures/emcc6-probe/run-probe.sh 1（读 w64-logs/emcc6-probe.log 的 geomean 行）",
                "w64-logs/emcc6-probe.log",
                "emcc 6.0.10/5.0.7 每调用几何均值（<1 = 6 更快）；实测 ≈1.00 ⇒ 工具链升级无编译器红利",
                replay=False)

    # ★ **上游 pin**（仓库架构批 B4，2026-10-04）：upstream/ submodule 钉版事实。
    #   上游更新 = bump 指针/merge tag（SOP 见 build/113/NOTES-upstream.md）；
    #   容器树 == pin 的一致性由 witness-upstream-pin.py 每提交核对（.githooks/）。
    import subprocess as _sp
    def _git(*a):
        try:
            return _sp.run(["git", *a], capture_output=True, text=True, timeout=20).stdout.strip()
        except Exception:
            return ""
    _pins = _git("submodule", "status")
    if _pins:
        facts["upstream_submodule_count"] = fact(len(_pins.splitlines()),
                                                 "git submodule status | wc -l",
                                                 ".gitmodules")
        _oct = _git("-C", "upstream/octave", "rev-parse", "--short=12", "HEAD")
        if _oct:
            facts["octave_pin"] = fact(_oct,
                                       "git -C upstream/octave rev-parse --short=12 HEAD",
                                       ".gitmodules + upstream/octave",
                                       "Octave wasm 分支（tarball 生成件 + 平台补丁）的 pin")

    # ★ **libm spike**（工单 60，2026-10-04）：链接期标量 libm 替换的实测判决。
    #   门槛 = 每调用几何均值 ≥1.5（热点压降 ≥1/3 的操作化）；实测 0.991 两轮一致 ⇒ 否决。
    #   机制根因（wasm 无标量 FMA）与全部数字见 build/113/NOTES-libm.md。
    _ls = os.path.join(os.path.dirname(SITE), "w64-logs", "libm-spike-verdict.txt")
    if os.path.exists(_ls):
        _t = open(_ls, encoding="utf-8", errors="replace").read()
        import re as _re
        _m = _re.search(r"geomean\(cand/base\) = ([0-9.]+)", _t)
        if _m:
            facts["libm_spike_geomean"] = fact(
                float(_m.group(1)),
                "sh build/113/bench-libm-spike.sh 8（读 w64-logs/libm-spike-verdict.txt 的 geomean 行）",
                "w64-logs/libm-spike-verdict.txt",
                "链接期标量 libm 替换（同源重编覆盖）的每调用几何均值；≥1.5 才值得注册插件 —— "
                "实测 <1.0 ⇒ 负判决（wasm 无标量 FMA，见 NOTES-libm.md）",
                replay=False)

    # ★ **w64-base**（工单 30，2026-10-01）：四格里的第四格 —— memory64 **单线程**回退档。
    #   为什么上键：发运判据里有一条"只新增两档、base/threads 逐字节不变"，而**新那一档**的
    #   sha 原来没有任何台账项 ⇒ `promote-w64-lane.sh` 只能拿容器当参照，"部署的到底是不是
    #   验收过的那一份"就没人拦。上键之后那条判据变成"与台账比"。
    W64BA = os.environ.get("W64_BASE_ARTIFACTS", os.path.join(os.path.dirname(SITE), "w64-base-artifacts"))
    try:
        bj = json.load(open(os.path.join(W64BA, "octave.build.json"), encoding="utf-8"))
        me = bj.get("measured") or {}
        facts["w64_base_verdict"] = fact(bj.get("verdict"),
                                        "python3 build/facts.py（读 %s/octave.build.json）" % W64BA,
                                        "w64-base-artifacts/octave.build.json")
        facts["w64_base_wasm64"] = fact(bool(me.get("wasm64")),
                                        "读 %s 的 measured.wasm64" % W64BA,
                                        "w64-base-artifacts/octave.build.json",
                                        "回退档也必须是真 64 位（否则它回退的是**另一个 ABI**，不是同一档）")
        facts["w64_base_shared_memory"] = fact(bool((me.get("threads") or {}).get("shared_memory")),
                                               "读 %s 的 measured.threads.shared_memory" % W64BA,
                                               "w64-base-artifacts/octave.build.json",
                                               "单线程回退档：**不**是 shared（这是它与 w64 的分界）")
        wf = (me.get("files") or {}).get("octave.wasm") or {}
        facts["w64_base_wasm_sha"] = fact(wf.get("sha256"), "sha256sum %s/octave.wasm" % W64BA,
                                          "w64-base-artifacts/octave.wasm")
        facts["w64_base_wasm_bytes"] = fact(wf.get("bytes"), "stat -c %%s %s/octave.wasm" % W64BA,
                                            "w64-base-artifacts/octave.wasm")
    except (OSError, ValueError) as e:
        print("⚠ 读不到 w64-base 身份证（%s）：%s" % (W64BA, e), file=sys.stderr)
    # 两份日志：由 build-w64-lane.sh 的 facts 阶段写（`llvm-objdump` / `llvm-readobj` 量的）
    try:
        facts["w64_i64_insns"] = fact(int(open(os.path.join(W64L, "i64.txt"),
                                               encoding="utf-8").read().strip()),
                                      "llvm-objdump -d <w64>/octave.wasm | grep -c i64"
                                      "（由 build/113/build-w64-lane.sh facts 写出，容器内跑）",
                                      "w64-logs/i64.txt",
                                      "64 位的指令层证据（wasm32 版为 0）")
    except (OSError, ValueError):
        pass
    try:
        _p = open(os.path.join(W64L, "oct-wasm64.txt"), encoding="utf-8").read().split()
        facts["w64_oct_wasm64"] = fact(int(_p[0]),
                                       "bash build-w64-lane.sh facts（容器内；用 /emsdk/upstream/bin/"
                                       "llvm-readobj 逐个量）", "w64-logs/oct-wasm64.txt",
                                       "`.oct` 车道里 wasm64 的个数（side module 的指针宽度必须与主模块一致）")
        facts["w64_oct_files"] = fact(int(_p[1]), "同上（文件名：oct-wasm64.txt 的第二个数）",
                                      "w64-logs/oct-wasm64.txt", "车道 `.oct` 总数")
    except (OSError, ValueError, IndexError):
        pass
    # ── ★ Q3 的内存上限（2026-09-29 上键）：HANDOFF §1 的第 2 条 ────────────────────
    # 为什么要有这组：5 GiB / 8 GiB / 共享 5 GiB 原来是**一次性 `node -e` 命令 + 散文**
    #   —— 没有复跑入口，也没有闸门拦腐烂。生产者 = test/browser/probe-wasm64-mem.mjs
    #   （自托管两页：不带头的 plain 页量单线程，带头的 coi 页量 shared；照 probe_lane_pass
    #   的形状从**保存下来的探针日志**取值，facts.py 不自己开浏览器）。
    _memlog = os.environ.get("W64_MEM_LOG", os.path.join(W64L, "mem-probe.log"))
    if os.path.exists(_memlog):
        try:
            _mtxt = open(_memlog, encoding="utf-8", errors="replace").read()
            for key, pat, note in (
                ("w64_mem_5g_bytes", r"^mem5g_bytes=(\d+)$",
                 "单线程 memory64 分配 80000 页（非 COI 页，buffer 是 ArrayBuffer）"),
                ("w64_mem_8g_bytes", r"^mem8g_bytes=(\d+)$",
                 "单线程 memory64 分配 131072 页"),
                ("w64_mem_shared_5g_bytes", r"^memshared5g_bytes=(\d+)$",
                 "COI 页 shared memory64 分配 80000 页（buffer 是 SharedArrayBuffer）"),
            ):
                _m = re.search(pat, _mtxt, re.M)
                if _m:
                    facts[key] = fact(int(_m.group(1)),
                                      "sh test/browser/run.sh test/browser/probe-wasm64-mem.mjs > %s" % _memlog,
                                      os.path.basename(_memlog), note)
            _mf = re.search(r"===\s*\d+ PASS / (\d+) FAIL\s*===", _mtxt)
            if _mf:
                facts["w64_mem_probe_fail"] = fact(int(_mf.group(1)),
                                                   "同上（脚本结尾的 `=== N PASS / M FAIL ===`）",
                                                   os.path.basename(_memlog),
                                                   "内存探针 FAIL 数（必须 0；含 wasm32 上限 / index 陷阱 / "
                                                   "BigInt 三条反证）")
        except OSError as e:
            print("⚠ 读不到内存探针日志 %s：%s" % (_memlog, e), file=sys.stderr)

    # ★ **选档的引擎矩阵**（工单 30，2026-10-01）：把"哪几个引擎在四格站点上真的选到哪一档"
    #   上键。为什么必须有：这是**生产风险**那一面 —— 只有 Chromium 一格绿不足以说"能上"，
    #   而"无 memory64 的引擎会落回 threads"这条**反向断言**在真引擎上量过才作数。
    #   生产者 = test/browser/probe-browser-floor.mjs（每台引擎 4 条判据），日志落 w64-logs/。
    W64LOGD = os.path.dirname(_memlog)
    _fl = sorted(glob.glob(os.path.join(W64LOGD, "floor-*.log")))
    if _fl:
        _fp = _ff = 0
        for _f in _fl:
            try:
                _t = open(_f, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            _m = re.search(r"===\s*(\d+) PASS / (\d+) FAIL\s*===", _t)
            if _m:
                _fp += int(_m.group(1))
                _ff += int(_m.group(2))
        # ⚠️ 引擎数**按判据行的引擎名去重**数，不按日志文件数：一份日志可以跑多台引擎
        #    （实测 `floor-8761-ff-webkit.log` 一台文件里跑了 Firefox + WebKit）⇒
        #    "文件数=引擎数"会把 4 台写成 3 台。
        _eng = set()
        for _f in _fl:
            try:
                _t = open(_f, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            _eng.update(re.findall(r"^\s*(?:PASS|fail) \| (\S+) · ①", _t, re.M))
        facts["floor_matrix_engines"] = fact(len(_eng),
                                             "数 w64-logs/floor-*.log 里 `· ① 页面 ready` 判据行的引擎名（去重）",
                                             "w64-logs/floor-*.log",
                                             "跑过的引擎：Chromium 154 / Chromium 125 / Firefox / WebKit（2026-10-01 实测）")
        facts["floor_matrix_pass"] = fact(_fp, "同上（各日志结尾的 `=== N PASS / M FAIL ===` 求和）",
                                          "w64-logs/floor-*.log")
        # ★ **w64 车道的线程版 OpenBLAS 库**（工单 33，2026-10-01）：用户点名的形态
        #   （memory64 × USE_THREAD=1）。为什么先上键"库"这一半：它是**已建成的实测事实**，
        #   而"链进去的产物"那一半还被工单 34 挡着（树链不出可校验的模块）。
        _obl = os.path.join(W64LOGD, "e2-w64-build.log")
        if os.path.exists(_obl):
            try:
                _ot = open(_obl, encoding="utf-8", errors="replace").read()
                _m = re.search(r"架构断言：(\d+) 个成员全是 wasm64（wasm32=(\d+)）", _ot)
                if _m:
                    facts["w64_ob_lib_wasm64_members"] = fact(int(_m.group(1)),
                                                              "E2_LANE=w64 docker exec o113 bash /src/bin/build-e2-lane.sh "
                                                              "src patch build > w64-logs/e2-w64-build.log（读那行架构断言）",
                                                              "w64-logs/e2-w64-build.log",
                                                              "w64 车道线程版 OpenBLAS 归档里 wasm64 成员数")
                    facts["w64_ob_lib_wasm32_members"] = fact(int(_m.group(2)), "同上",
                                                              "w64-logs/e2-w64-build.log",
                                                              "必须是 0（side module 的指针宽度必须与主模块一致）")
            except (OSError, ValueError) as e:
                print("⚠ 读不到 w64 OpenBLAS 构建日志 %s：%s" % (_obl, e), file=sys.stderr)
        # ★★ **`w64` + 线程版 OpenBLAS**（工单 33，2026-10-01）：用户点名的目标形态，**已建成并实测**。
        #   为什么上键：这是本项目**目前最快的形态**（matmul 500² 0.007 s，比现役 w64 快 7.7×、
        #   比 wasm32 的 OpenBLAS 档快 2.9×），而"快多少"这种数字一旦手抄进正文就会腐烂。
        _bo = os.path.join(W64LOGD, "bench-ob-w64.log")     # 新形态（8849）
        _bs = os.path.join(W64LOGD, "bench-ship-w64.log")   # 现役 w64（8761，refblas）
        def _bench(path, case):
            try:
                t = open(path, encoding="utf-8", errors="replace").read()
            except OSError:
                return None
            m = re.search(r"^\s*%s\s+([0-9.]+)s" % re.escape(case), t, re.M)
            return float(m.group(1)) if m else None
        _ob_m, _ob_l = _bench(_bo, "matmul 500"), _bench(_bo, "lu 800")
        _sh_m = _bench(_bs, "matmul 500")
        if _ob_m is not None:
            facts["w64_ob_matmul500_s"] = fact(_ob_m,
                                              "HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh "
                                              "test/browser/bench-lanes.mjs http://127.0.0.1:8761/ w64 > w64-logs/bench-ob-w64.log",
                                              "w64-logs/bench-ob-w64.log",
                                              "现役 w64（线程版 OpenBLAS NT=8，2026-10-02 上站）的矩阵乘 500² 中位数")
        if _ob_l is not None:
            facts["w64_ob_lu800_s"] = fact(_ob_l,
                                           "同上（8761 现役那轮）", "w64-logs/bench-ob-w64.log",
                                           "现役 w64（线程版 OpenBLAS NT=8）的 lu(800) 中位数")
        if _ob_m is not None and _sh_m is not None and _ob_m > 0:
            facts["w64_ob_matmul500_speedup"] = fact(round(_sh_m / _ob_m, 1),
                                                     "派生：w64-logs/bench-ship-w64.log 的 matmul 500 ÷ w64-logs/bench-ob-w64.log 的同项",
                                                     "派生（两个 bench 日志）",
                                                     "OpenBLAS 版相对 refblas 版 w64 的加速倍数（历史对照：refblas 的现役地位已由 2026-10-02 NT=8 批取代）")
        # ★ **w64 候选（mimalloc）产品级基准**（工单 59，2026-10-04）：交错 3×3 同窗配对
        #   （候选实验站 8861 vs 现役 8761；方法论 HISTORY §5.79/§5.84：单轮方差 ±30% ⇒ 必须交错）。
        #   值 = 三轮中位数的**中位数**；诊断级的 −27%（工单 57）落到**非诊断产物**上是什么，看这里。
        def _bench3(pattern, case):
            vals = []
            for r in (1, 2, 3):
                p = os.path.join(W64LOGD, pattern % r)
                try:
                    t = open(p, encoding="utf-8", errors="replace").read()
                except OSError:
                    return None
                m = re.search(r"SPEED_JSON(\{.*\})", t)
                if not m:
                    return None
                v = (json.loads(m.group(1)).get("results") or {}).get(case, {}).get("median")
                if v is None:
                    return None
                vals.append(float(v))
            return sorted(vals)[1]                      # 三轮 ⇒ 取中位（第 2 小）
        _cm = _bench3("bench-mi2-r%d.log", "matmul 500")
        _cl = _bench3("bench-mi2-r%d.log", "lu 800")
        _co = _bench3("bench-mi2-r%d.log", "loop 1e6")
        _sm = _bench3("bench-ship2-r%d.log", "matmul 500")
        _sl = _bench3("bench-ship2-r%d.log", "lu 800")
        if _cm is not None:
            facts["w64_cand_matmul500_s"] = fact(
                _cm,
                "<交错 3 轮取中位：HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh "
                "test/browser/bench-lanes.mjs http://127.0.0.1:8861/ w64（×3 ⇒ w64-logs/bench-mi2-r1..3.log）>",
                "w64-logs/bench-mi2-r1..3.log",
                "候选（mimalloc，工单 59）产品级 matmul 500²；与现役的同窗配对见 w64_cand_vs_ship_*")
        if _cl is not None:
            facts["w64_cand_lu800_s"] = fact(
                _cl, "同上（lu 800）", "w64-logs/bench-mi2-r1..3.log",
                "候选（mimalloc）产品级 lu(800)")
        if _co is not None:
            facts["w64_cand_loop1e6_s"] = fact(
                _co, "同上（loop 1e6）", "w64-logs/bench-mi2-r1..3.log",
                "候选的纯解释器轴（分配器不该动它 —— 诚实记录，防「把好数字全记在头上」）")
        if _cm is not None and _sm is not None and _sm > 0:
            facts["w64_cand_vs_ship_matmul500"] = fact(
                round(_cm / _sm, 2),
                "派生：w64-logs/bench-mi2-r1..3.log 的中位 ÷ bench-ship2-r1..3.log 的中位",
                "派生（两组交错日志）",
                "候选/现役 的 matmul500 比值（<1 = 候选更快；同窗配对，不是跨窗对比）")
        if _cl is not None and _sl is not None and _sl > 0:
            facts["w64_cand_vs_ship_lu800"] = fact(
                round(_cl / _sl, 2),
                "派生：同上（lu 800）", "派生（两组交错日志）",
                "候选/现役 的 lu800 比值")
        # ★ **原生基线**（perf-max 图票 02，2026-10-02）：占比仪表盘的"原生"一侧。
        #   为什么上键：6.6× / 1.9× 这类倍数说不清"离顶还有多远"；**原生占比才是刻度**（图 Q1=c）。
        #   同机**同版本** Octave 11.3.0；两个后端都测都记录：netlib = 系统默认（参考实现，
        #   单线程，"用户手里的 Octave"）、openblas24 = LD_PRELOAD 0.3.34 pthread×24（天花板；
        #   与 wasm 里那份 OpenBLAS 同版本族。装包曾把系统 alternatives 自动切到 openblas，
        #   已钉回 netlib —— 基准脚本不碰 alternatives，只 preload）。
        _nbj = os.path.join(W64LOGD, "native-baseline.json")
        if os.path.exists(_nbj):
            try:
                _nb = json.load(open(_nbj, encoding="utf-8"))
                _nbob = _nb.get("backends", {}).get("openblas24", {})
                _nbnet = _nb.get("backends", {}).get("netlib", {})
                _nb_cmd = "sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）"
                for _case, _key in (("matmul500", "native_openblas_matmul500_s"),
                                    ("matmul1024", "native_openblas_matmul1024_s"),
                                    ("matmul2000", "native_openblas_matmul2000_s"),
                                    ("lu800", "native_openblas_lu800_s")):
                    _v = _nbob.get(_case, {}).get("s")
                    if _v is not None:
                        facts[_key] = fact(_v, _nb_cmd, "w64-logs/native-baseline.json",
                                           "原生天花板（OpenBLAS 0.3.34 pthread）的 %s 中位数" % _case)
                _vn = _nbnet.get("matmul500", {}).get("s")
                if _vn is not None:
                    facts["native_netlib_matmul500_s"] = fact(_vn, _nb_cmd, "w64-logs/native-baseline.json",
                                                              "系统默认 BLAS（netlib 参考实现，单线程）的 matmul 500² —— 用户手里的原生 Octave")
                # ★ 工单 45（最终结算，2026-10-03）：netlib 侧再上三个常被引用的键
                for _case, _nk in (("matmul1000", "native_netlib_matmul1000_s"),
                                   ("lu1500", "native_netlib_lu1500_s"),
                                   ("lu800", "native_netlib_lu800_s"),
                                   ("loop1e6", "native_netlib_loop1e6_s")):
                    _vv = _nbnet.get(_case, {}).get("s")
                    if _vv is not None:
                        facts[_nk] = fact(_vv, "sh build/113/bench-native.sh",
                                          "w64-logs/native-baseline.json",
                                          "netlib 参考实现的 %s（用户手里的原生 Octave；"
                                          "机器空闲时跑，重活 ⇒ replay 豁免）" % _case)
                for _case, _ok in (("matmul1000", "native_openblas_matmul1000_s"),
                                   ("lu1500", "native_openblas_lu1500_s")):
                    _vv = _nbob.get(_case, {}).get("s")
                    if _vv is not None:
                        facts[_ok] = fact(_vv, "sh build/113/bench-native.sh",
                                          "w64-logs/native-baseline.json",
                                          "原生天花板（OpenBLAS 0.3.34 pthread）的 %s 中位数；"
                                          "机器空闲时跑，重活 ⇒ replay 豁免" % _case)
                if _nbob.get("threads") is not None:
                    facts["native_openblas_threads"] = fact(_nbob["threads"], _nb_cmd, "w64-logs/native-baseline.json",
                                                            "天花板后端的线程数（占比口径的一部分，必须如实记录）")
                # 派生：浏览器 w64（线程版 OpenBLAS）占原生天花板的比值（<1 = 还有余量）与相对 netlib 的倍数
                if _ob_m and _nbob.get("matmul500", {}).get("s"):
                    facts["w64_ob_matmul500_native_ratio"] = fact(
                        round(_nbob["matmul500"]["s"] / _ob_m, 2),
                        "派生：w64-logs/native-baseline.json 的 openblas24.matmul500 ÷ w64-logs/bench-ob-w64.log 的 matmul 500",
                        "派生（原生基线 ÷ 浏览器）",
                        "浏览器 w64 占原生天花板的比值（占比仪表盘的表头）")
                if _ob_m and _vn:
                    facts["w64_ob_matmul500_vs_netlib"] = fact(
                        round(_vn / _ob_m, 1),
                        "派生：w64-logs/native-baseline.json 的 netlib.matmul500 ÷ w64-logs/bench-ob-w64.log 的 matmul 500",
                        "派生（原生基线 ÷ 浏览器）",
                        "浏览器 w64 相对『系统默认 BLAS 的原生 Octave』的倍数")
                # ★ 工单 45 最终结算的派生比值：_w1000 = 浏览器 matmul1000（bench-ob-w64.log）
                _w1000 = _bench(_bo, "matmul 1000")
                _w1500 = _bench(_bo, "lu 1500")
                _wloop = _bench(_bo, "loop 1e6")
                _obm1000 = _nbob.get("matmul1000", {}).get("s")
                _nl1000 = _nbnet.get("matmul1000", {}).get("s")
                _nl1500 = _nbnet.get("lu1500", {}).get("s")
                _nlloop = _nbnet.get("loop1e6", {}).get("s")
                if _w1000 and _obm1000:
                    facts["w64_ob_matmul1000_native_ratio"] = fact(
                        round(_obm1000 / _w1000, 2),
                        "派生：native-baseline.json 的 openblas24.matmul1000 ÷ bench-ob-w64.log 的 matmul 1000",
                        "派生（原生基线 ÷ 浏览器）",
                        "浏览器 w64 matmul1000 占原生天花板的比值（大矩阵是最吃线程的刻度）")
                if _w1000 and _nl1000:
                    facts["w64_vs_netlib_matmul1000"] = fact(
                        round(_nl1000 / _w1000, 1),
                        "派生：native-baseline.json 的 netlib.matmul1000 ÷ bench-ob-w64.log 的 matmul 1000",
                        "派生（原生基线 ÷ 浏览器）",
                        "浏览器 w64 matmul1000 相对『用户手里的原生 Octave』的倍数")
                if _w1500 and _nl1500:
                    facts["w64_vs_netlib_lu1500"] = fact(
                        round(_nl1500 / _w1500, 1),
                        "派生：native-baseline.json 的 netlib.lu1500 ÷ bench-ob-w64.log 的 lu 1500",
                        "派生（原生基线 ÷ 浏览器）",
                        "浏览器 w64 lu1500 相对『用户手里的原生 Octave』的倍数")
                if _wloop and _nlloop:
                    facts["w64_vs_netlib_loop1e6"] = fact(
                        round(_nlloop / _wloop, 2),
                        "派生：native-baseline.json 的 netlib.loop1e6 ÷ bench-ob-w64.log 的 loop 1e6",
                        "派生（原生基线 ÷ 浏览器）",
                        "浏览器解释器循环相对原生的比值（<1 = 浏览器慢 —— 纯解释器轴是唯一明确输的）")
            except (OSError, ValueError) as e:
                print("⚠ 读不到原生基线 %s：%s" % (_nbj, e), file=sys.stderr)
        # ★ **四档的堆上限与"64 位到底买到了什么"**（工单 31，2026-10-01）：
        #   为什么上键：这两条曾经都是**口号**（用户直觉"w64 更快"、我写"w64 买的是 >4 GiB 地址空间"），
        #   实测**两条都不成立**（已登记翻案 R-013）⇒ 把判据落成可复跑的探针与台账。
        _hc = os.path.join(W64LOGD, "heap-ceiling.log")
        if os.path.exists(_hc):
            try:
                _ht = open(_hc, encoding="utf-8", errors="replace").read()
                _vals = [float(x) for x in re.findall(r"上限=([0-9.]+) GiB", _ht)]
                if _vals:
                    facts["mem_live_ceiling_gib"] = fact(max(_vals),
                                                         "HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh "
                                                         "test/browser/probe-heap-ceiling.mjs http://127.0.0.1:8761/ > w64-logs/heap-ceiling.log",
                                                         "w64-logs/heap-ceiling.log",
                                                         "逐块 0.75 GiB 吃到 OOM 的**存活上限**（四档实测同为 1.49 GiB）")
                _m = re.search(r"W64_BIG_HEAP=(yes|no)", _ht)
                if _m:
                    facts["w64_big_heap"] = fact(_m.group(1) == "yes", "同上（探针结尾的 `W64_BIG_HEAP=` 行）",
                                                 "w64-logs/heap-ceiling.log",
                                                 "工单 31 的结算判据：抬了 MAXIMUM_MEMORY 之后必须变 yes")
            except (OSError, ValueError) as e:
                print("⚠ 读不到堆上限日志 %s：%s" % (_hc, e), file=sys.stderr)
        # 四档速度：只上键 w64 那两个（base 与 OpenBLAS 的已有 lane_* / e2_* 键）
        _sp = os.path.join(W64LOGD, "speed-w64.log")
        if os.path.exists(_sp):
            try:
                _st = open(_sp, encoding="utf-8", errors="replace").read()
                for key, case, note in (("w64_matmul500_s", "matmul 500",
                                         "w64 档矩阵乘 500²：比 base 慢约 1.2×（i64 指针/索引的代价）"),
                                        ("w64_lu800_s", "lu 800", "w64 档 lu(800)：比 base 慢约 1.3×")):
                    _m = re.search(r"^\s*%s\s+([0-9.]+)s" % re.escape(case), _st, re.M)
                    if _m:
                        facts[key] = fact(float(_m.group(1)),
                                          "HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh "
                                          "test/browser/bench-lanes.mjs http://127.0.0.1:8761/ w64 > w64-logs/speed-w64.log",
                                          "w64-logs/speed-w64.log", note)
            except (OSError, ValueError) as e:
                print("⚠ 读不到四档速度日志 %s：%s" % (_sp, e), file=sys.stderr)
        # ★ **交付包本身**也要端到端验（2026-10-01）：字节层"包内 wasm == 部署件"只是一半 ——
        #   包**起不起得来**、**选不选得对档**是另一半。生产者 = 包自带的 serve.py + probe-lane。
        _dp = os.path.join(W64LOGD, "dist-probe-lane.log")
        if os.path.exists(_dp):
            try:
                _dt = open(_dp, encoding="utf-8", errors="replace").read()
                _dm = re.search(r"===\s*(\d+) PASS / (\d+) FAIL\s*===", _dt)
                if _dm:
                    facts["dist_lane_probe_pass"] = fact(int(_dm.group(1)),
                                                         "cd <dist 包目录> && python3 serve.py 8788；"
                                                         "再 SITE_DIR=<dist 包目录> sh build/sweep.sh "
                                                         "http://127.0.0.1:8788/ probe-lane > w64-logs/dist-probe-lane.log",
                                                         "w64-logs/dist-probe-lane.log",
                                                         "交付包**内部**的四格选档通过数（不只是字节相同）")
                    facts["dist_lane_probe_fail"] = fact(int(_dm.group(2)), "同上", "w64-logs/dist-probe-lane.log")
            except OSError as e:
                print("⚠ 读不到交付包选档日志 %s：%s" % (_dp, e), file=sys.stderr)
        facts["floor_matrix_fail"] = fact(_ff, "同上", "w64-logs/floor-*.log",
                                          "必须 0；含「无 memory64 的引擎必须落 threads」这条反向断言")

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

    # ★ 第二道守卫：**改口**（值换了）。见文件头"两道守卫"。没有它，一次量错或输入换了，
    #   旧值就被静默覆盖 —— 而闸门只对 3 个 sha 回盘核对，其余条目再也没人知道它变过。
    changed = changed_keys((load_ledger().get("facts") or {}) if os.path.exists(OUT) else {}, facts)
    # ★ Einfacht issue #3 ①（2026-10-01 移植）：`--accept-changes[=k1,k2]` —— 裸旗全收、
    #   列键只收列出的，其余照旧拒绝。全收会把"真坏了的测量"一起洗白。
    accepted = _accepted_keys(argv)
    remaining = filter_accepted(changed, accepted)
    if remaining:
        print("FATAL: 本次重测会**改掉 %d 条事实的值**（未经接受的改口）：" % len(remaining), file=sys.stderr)
        for k, o, n in remaining:
            print("       %-24s %s → %s" % (k, _short(o), _short(n)), file=sys.stderr)
        print("       台账不写。逐条确认这些变化**是实测出来的**（不是输入不在/量错了）之后，", file=sys.stderr)
        print("       再显式 `--accept-changes`（或 `--accept-changes=k1,k2` 逐条放行）；", file=sys.stderr)
        print("       若某条是量错了，先修输入 —— 那才是真 bug。", file=sys.stderr)
        return 2
    if changed:
        print("⚠ --accept-changes：本次接受 %d 条改口：" % len(changed))
        for k, o, n in changed:
            print("       %-24s %s → %s" % (k, _short(o), _short(n)))
        if accepted not in (None, False) and remaining == []:
            pass  # 列名接受 ⇒ 全部放行（remaining 为空）
    doc = {"schema": 1, "generated": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
           "_why": "事实台账（F2）：每条 = 一个**测出来**的数字 + 复跑命令 + 出处。别手改，跑 build/facts.py。",
           "facts": facts}
    # ★ replay 契约的首轮标注（Einfacht #4 ④⑤，2026-10-02 移植，工单 37）：
    #   · sha256sum 族补字段提取 —— 裸值契约要求 stdout == 值，`sha256sum` 默认带路径列；
    #   · 重活（浏览器/容器/构建/基准）与派生/散文式复跑方式显式 `replay=False`
    #     （**有名单、有明说**的豁免 —— 不是静默；全豁免会被零值守卫红，见 check-facts-replay）。
    _no_replay = {
        # 重活：需要浏览器 / 容器 / 构建 / 基准机（REFLECT_REPLAY_TIMEOUT 会杀掉它们）
        "probe_lane_pass", "e2_threaded_oct_rc", "w64_mem_5g_bytes", "w64_mem_8g_bytes",
        "w64_mem_shared_5g_bytes", "w64_ob_lib_wasm64_members", "w64_ob_lib_wasm32_members",
        "w64_ob_matmul500_s",
        "mem_live_ceiling_gib", "w64_matmul500_s", "w64_lu800_s", "dist_lane_probe_pass",
        "native_openblas_matmul500_s", "native_openblas_matmul1024_s",
        "native_openblas_matmul2000_s", "native_openblas_lu800_s",
        "native_netlib_matmul500_s", "native_openblas_threads",
        # 派生 / 散文式复跑方式（比值、日志汇总、跨键引用）
        "e2_matmul500_ratio", "e2_lu800_ratio", "e2_matmul500_s", "e2_lu800_s",
        "lane_matmul500_s", "lane_lu800_s", "e2_threaded_matmul500_s",
        "e2_threaded_matmul500_ratio", "e2_threaded_lu800_s",
        "w64_ob_matmul500_speedup", "w64_ob_matmul500_native_ratio",
        "w64_ob_matmul500_vs_netlib", "w64_ob_lu800_s",
        "w64_ob_matmul1000_native_ratio", "w64_vs_netlib_matmul1000",
        "w64_vs_netlib_lu1500", "w64_vs_netlib_loop1e6",
        "native_netlib_matmul1000_s", "native_netlib_lu1500_s",
        "native_netlib_lu800_s", "native_netlib_loop1e6_s",
        "native_openblas_matmul1000_s", "native_openblas_lu1500_s",
        "accept_suites", "accept_pass", "probe_lane_fail",
        "floor_matrix_engines", "floor_matrix_pass", "floor_matrix_fail",
        "w64_mem_probe_fail", "dist_lane_probe_fail", "w64_big_heap",
        "w64_oct_files", "w64_oct_wasm64", "w64_i64_insns", "oct_lane_tls_init",
        "e2_single_verdict", "e2_threaded_verdict", "w64_verdict", "w64_base_verdict",
        "w64_wasm64", "w64_shared_memory", "w64_v128", "w64_exported_functions",
        "w64_malloc",
        "w64_relaxed_madd", "w64_build_recipe_ok",
        # ★ 工单 59：w64 发运候选（mimalloc）—— 同 w64_* 的散文式读法
        "w64_cand_verdict", "w64_cand_malloc", "w64_cand_exported_functions",
        "w64_cand_wasm_sha", "w64_cand_wasm_bytes",
        "w64_cand_matmul500_s", "w64_cand_lu800_s", "w64_cand_loop1e6_s",
        "w64_cand_vs_ship_matmul500", "w64_cand_vs_ship_lu800",
        "libm_spike_geomean",
        "upstream_submodule_count", "octave_pin", "emcc6_probe_geomean",
        "rust_fill_spike_ratio", "rust_sort_spike_base_ms", "rust_sort_spike_cand_ms",
        "rust_sort_spike_ratio",
        "w64_rustsort_ab_asc_ms", "w64_rustsort_base_ab_ms", "w64_rustsort_ab_asc_ratio",
        "w64_rustsort_ab_desc_ratio", "w64_rustsort_cand_sha",
        "hotpath_xpow_libm_pct", "hotpath_xpow_driver_pct", "hotpath_fft_blktrans_pct",
        "xpow_driver_spike_pct", "xpow_driver_spike_ratio", "locale_contract_lanes",
        "ip_vs_next_sort_ip_ms", "ip_vs_next_sort_next_ms", "ip_vs_next_sort_ratio",
        "w64_base_wasm64", "w64_base_shared_memory", "threads_verdict",
        "threads_shared_memory", "threads_pthread_glue", "threads_v128",
        "threads_exported_functions", "threads_blas_dir", "wasm_v128",
        "exported_functions", "fonts_count", "jspi_entry", "env_vars",
    }
    for _k in _no_replay:
        if _k in facts:
            facts[_k]["replay"] = False
    for _k, _v in facts.items():
        _c = _v.get("cmd", "")
        if _c.startswith("sha256sum ") and "|" not in _c:
            _v["cmd"] = _c + " | cut -d' ' -f1"
    # ★ first_seen 沿用（issue #6 ① 移植）：值不变 ⇒ 沿用旧日期；换值 ⇒ 今天。
    #   恒常检测的状态（"这条 cmd 是在量，还是恒返回同一个数？"）靠它。
    _old = (load_ledger().get("facts") or {}) if os.path.exists(OUT) else {}
    _today = time.strftime("%Y-%m-%d")
    for _k, _v in facts.items():
        _o = _old.get(_k)
        if isinstance(_o, dict) and _o.get("value") == _v.get("value") and _o.get("first_seen"):
            _v["first_seen"] = _o["first_seen"]
        else:
            _v.setdefault("first_seen", _today)
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
