#!/usr/bin/env python3
# Octave-Full-Wasm — **选片逻辑**：哪些套件这一轮该跑、哪些按清单跳过（F4，2026-09-27）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

"""`build/sweep.sh` 读清单决定跑谁 —— **从 heredoc 搬到这里**（F4 的一部分）。

为什么搬（与 A3 搬 sweep.sh 进仓库是同一个理由的下一步）：
A3 把"怎么跑测试"从仓库外搬进了 `test/browser/manifest.json`，但**决定跑谁的代码**仍然是
`sweep.sh` 里的一段 heredoc python —— 那段代码没有任何东西能验它：
  · "缺输入的探针会被静默跳过"这件事，是**新克隆跑 `PROBES=1` 必挂**的根因
    （`probe-threads` / `probe-jspi*` 5 个探针的唯一输入在仓库外，清单里一个字都没写）；
  · 而"跑了 0 个然后绿"是本仓最怕的退化形状（见 `build/gates-selftest.sh` 文件头）。
所以：选片逻辑 = 本模块（**纯函数 + 可注入 env/文件系统探针**），`--selftest` 证明它
"缺输入时必须报跳过、不许静默"，`build/gates-selftest.sh` 登记它。

## 清单契约（`test/browser/manifest.json`）

  categories  类别默认（default/summary/timeout）—— 类别**从文件名前缀推**
  exceptions  例外（manual = 不产汇总行/需人看；why 必填）
  inputs      套件需要的**输入**：`{"kind": "path"|"env", "value": …, "env": 可选覆盖变量,
              "why": …}`。缺输入 ⇒ 跳过并**报出缺什么**（不是失败，也不是静默漏跑）。

用法：
  sweep_select.py <manifest> <repo> <filter> <probes 0|1> <logdir>   # 给 sweep.sh 用
  sweep_select.py --check-inputs <manifest>                          # 人看：每条输入在不在
  sweep_select.py --selftest
"""
import fnmatch
import json
import os
import sys

CATEGORIES = {"accept": "accept", "probe": "probe", "bench": "bench"}
INPUT_KINDS = ("path", "env")


def cat_of(name):
    return CATEGORIES.get(name.split("-", 1)[0])


def input_state(inp, env, exists=os.path.exists):
    """一条输入齐备吗？返回 None = 齐备；否则返回"缺什么"的说明。
    `exists` 可注入 ⇒ 自证里不用造真的目录。"""
    kind = inp.get("kind")
    if kind not in INPUT_KINDS:
        return "清单里的输入 kind 不认识：%r" % (kind,)
    if kind == "env":
        return None if env.get(inp.get("value")) else "缺环境变量 %s" % inp.get("value")
    # path：可用环境变量覆盖（探针自己读的就是那个变量 —— 两处口径必须一致）
    var = inp.get("env")
    val = env.get(var) or inp.get("value")
    return None if exists(val) else "缺路径 %s" % val


def select(manifest, names, flt, probes, env, exists=os.path.exists):
    """选出这一轮要跑的套件。返回 `(rows, skipped, errors)`：
      rows    = [(name, timeout, needs_summary), …]
      skipped = ["名字（原因）", …]   ← **必须非静默**：sweep.sh 会把它们打出来
      errors  = ["…", …]              ← 清单本身有问题（调用方应 exit 2）"""
    cats = manifest.get("categories") or {}
    exc = manifest.get("exceptions") or {}
    inputs = manifest.get("inputs") or {}
    rows, skipped, errors = [], [], []
    missing_cats = {}                       # 类别没定义 ⇒ 汇总成一条，别刷 80 行

    # 零值守卫：清单/套件列表为空 ⇒ 这个选择器什么也证明不了（"跑了 0 个然后绿"的形状）
    if not cats:
        errors.append("清单里没有 categories（选不出任何东西）")
    if not names:
        errors.append("套件列表为空（test/browser/*.mjs 没扫到东西？）")
    if not isinstance(inputs, dict):
        errors.append("清单的 inputs 段不是对象")

    for name in sorted(names):
        cat = cat_of(name)
        if cat is None:
            continue                        # 不是测试套件命名，跳过（不算漏跑）
        if cat not in cats:
            missing_cats.setdefault(cat, []).append(name)
            continue
        c, e = cats[cat], exc.get(name, {})
        if flt:
            if not fnmatch.fnmatch(name, flt):
                continue
        elif not (probes or c.get("default")):
            continue

        # ⚠️ 两种输入机制并存 = 两处口径会分叉 ⇒ 旧的 requires_env 必须迁进 inputs，见到就报
        if "requires_env" in e:
            errors.append("%s 还在用 requires_env（已并入 inputs，请迁移）" % name)

        if e.get("manual"):
            skipped.append("%s（%s）" % (name, e.get("why", "人工套件")))
            continue
        miss = [s for s in (input_state(i, env, exists) for i in inputs.get(name, [])) if s]
        if miss:
            why = "；".join(miss)
            note = exc.get(name, {}).get("why", "")
            skipped.append("%s（%s%s）" % (name, why, "：" + note if note else ""))
            continue
        rows.append((name, c.get("timeout", 420), 1 if c.get("summary", True) else 0))
    # ⚠️ 汇总（第一版每个套件刷一条 ⇒ 清单坏掉时打出 80 行，等于没有信息）
    for cat, names_ in sorted(missing_cats.items()):
        errors.append("清单缺类别定义 %s：%d 个套件（例：%s）"
                      % (cat, len(names_), ", ".join(names_[:3])))
    return rows, skipped, errors


def load_manifest(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def suite_names(repo):
    d = os.path.join(repo, "test", "browser")
    if not os.path.isdir(d):
        return []
    return sorted(f[:-4] for f in os.listdir(d) if f.endswith(".mjs"))


def check_inputs(manifest, env, exists=os.path.exists):
    """`--check-inputs`：把所有声明的输入列出来（人/新机器用："要跑齐全套，我缺什么"）。"""
    out = []
    for name in sorted(manifest.get("inputs") or {}):
        for inp in manifest["inputs"][name]:
            out.append((name, inp.get("kind"), inp.get("value"), input_state(inp, env, exists)))
    return out


def resolved_inputs(manifest, name, env, exists=os.path.exists):
    """给一个套件，返回 `{环境变量: 解析后的值}` —— **由 sweep.sh 用 `env` 传给子进程**。

    为什么需要它（**2026-09-28 实测踩到，差点骗过复核**）：F4 声明了输入的 `value`（标准默认）
    与 `env`（覆盖变量名），但**没有任何人把它导出给子进程** ⇒ 探针只能退回**它自己内部的默认**。
    实测代价：`SITE_DIR=site-w64 … probe-lane` 那次，探针照样按自己的默认起了 `siteWebGL` 的服务，
    打出 17 PASS —— **全是另一个站点的成绩**，而日志里只有 `dir=…` 一行出卖它。
    这就是"两处口径"的形状：清单说一套、探针内部默认说另一套，而**没人对齐它们**。

    规则：
      · 只导 `kind="path"` 且**写了 `env` 变量名**的（`kind="env"` 靠继承，本来就在环境里；
        没写变量名的 ⇒ 探针自己找，没有口径可对齐）；
      · 值 = 环境变量覆盖（优先）否则声明的 `value` —— 与 `input_state` **同一口径**（不许分叉）。
    """
    out = {}
    for inp in (manifest.get("inputs") or {}).get(name, []):
        if inp.get("kind") != "path":
            continue
        var = inp.get("env")
        if not var:
            continue
        val = env.get(var) or inp.get("value")
        if val:
            out[var] = val
    return out


def emit_inputs(pairs):
    """把 `{VAR: 值}` 变成 `env` 能吃的 `VAR=值` 词。

    ★ **值里有空白就拒绝**（返回值里的第二个元素是原因）：sweep.sh 是用 `env $inputs sh …` 传的，
    未加引号的展开会把带空格的路径拆成两个词 ⇒ **静默传错一个更长的值**。
    宁可在这里响亮失败（换个不含空白的路径，或改传递方式），也不要静默传错。
    """
    lines, bad = [], []
    for k, v in sorted(pairs.items()):
        if any(c.isspace() for c in v) or not v:
            bad.append("%s 的值里有空白/为空（%r）⇒ 本接线方式撑不住" % (k, v))
            continue
        lines.append("%s=%s" % (k, v))
    return lines, bad


def main(argv):
    if argv and argv[0] == "--inputs-for":
        # `sweep.sh` 在**每个套件启动前**调它，把清单声明的输入对齐给探针（见 resolved_inputs 的长注释）
        if len(argv) < 3:
            print("用法：sweep_select.py --inputs-for <manifest> <套件名>", file=sys.stderr)
            return 2
        man = load_manifest(argv[1])
        lines, bad = emit_inputs(resolved_inputs(man, argv[2], os.environ))
        for b in bad:
            print("FATAL: %s" % b, file=sys.stderr)
        if bad:
            return 3                      # ★ 响亮失败：不许静默传错
        for ln in lines:
            print(ln)
        return 0

    if argv and argv[0] == "--check-inputs":
        man = load_manifest(argv[1])
        rows = check_inputs(man, os.environ)
        bad = 0
        for name, kind, val, state in rows:
            if state:
                bad += 1
                print("  ✗ %-24s %-5s %-50s %s" % (name, kind, val, state))
            else:
                print("  ✓ %-24s %-5s %s" % (name, kind, val))
        print("输入齐备性：%d / %d 条满足" % (len(rows) - bad, len(rows)))
        return 0 if rows else 2       # 一条输入都没声明 ⇒ 契约空转 ⇒ 非零

    if len(argv) < 5:
        print(__doc__.strip().split("用法：")[-1], file=sys.stderr)
        return 2
    man_p, repo, flt, probes, logdir = argv[0], argv[1], argv[2], argv[3] == "1", argv[4]
    try:
        man = load_manifest(man_p)
    except (OSError, ValueError) as e:
        print("FATAL: 清单读不了（%s）：%r" % (man_p, e), file=sys.stderr)
        return 2
    rows, skipped, errors = select(man, suite_names(repo), flt, probes, os.environ)
    if errors:
        print("FATAL: 清单有问题：" + "；".join(errors), file=sys.stderr)
        return 2
    for n, t, s in rows:
        print("%s\t%s\t%s" % (n, t, s))
    if logdir:
        with open(os.path.join(logdir, ".skipped.txt"), "w", encoding="utf-8") as fh:
            fh.write("; ".join(skipped))
        with open(os.path.join(logdir, ".matched.txt"), "w", encoding="utf-8") as fh:
            fh.write(str(len(rows) + len(skipped)))
    return 0


# ── 自证（F1 契约：每个闸门必须能证明自己会红）──────────────────────────────────
_MAN = {
    "categories": {"accept": {"default": True, "summary": True, "timeout": 420},
                   "probe": {"default": False, "summary": True, "timeout": 420},
                   "bench": {"default": False, "summary": False, "timeout": 900}},
    "exceptions": {"probe-a": {"manual": True, "why": "无汇总行"},
                   "probe-b": {}, "accept-x": {}},
    "inputs": {"probe-b": [{"kind": "path", "env": "P_DIR", "value": "/外/部/目录",
                            "why": "产物在仓库外"}],
               "probe-c": [{"kind": "env", "value": "PLAYWRIGHT_BROWSERS_PATH", "why": "要另装浏览器"}]},
}
_NAMES = ["accept-x", "probe-a", "probe-b", "probe-c", "bench-d", "helper.mjs"]
_NOEXIST = lambda _p: False        # noqa: E731   —— 造"路径不存在"的探针
_ALLEXIST = lambda _p: True        # noqa: E731


def _sel(names=None, probes=True, env=None, exists=_ALLEXIST, flt=""):
    return select(_MAN, names or _NAMES, flt, probes, env or {}, exists)


CASES = [
    ("默认（probes=False）只选 accept ⇒ 别的类别不算漏跑",
     lambda: [r[0] for r in _sel(probes=False)[0]] == ["accept-x"]),
    ("PROBES=1 且输入齐备（含环境变量那类）⇒ 探针都进来",
     lambda: set(r[0] for r in _sel(env={"PLAYWRIGHT_BROWSERS_PATH": "/x"})[0])
     >= {"accept-x", "probe-b", "probe-c", "bench-d"}),
    ("★ **缺路径输入 ⇒ 跳过并报出缺什么**（新克隆的根因：不许静默漏跑）",
     lambda: any("缺路径 /外/部/目录" in s and s.startswith("probe-b") for s in _sel(exists=_NOEXIST)[1])),
    ("★ **缺环境变量输入 ⇒ 跳过并报出变量名**",
     lambda: any("PLAYWRIGHT_BROWSERS_PATH" in s for s in _sel()[1])),
    ("★ 输入齐备时**不许**把它跳过（反向：别把跳过写成恒真）",
     lambda: not any(s.startswith("probe-b") for s in _sel(exists=_ALLEXIST)[1])),
    ("★ 路径输入可用环境变量覆盖（探针读什么，清单就声明什么）",
     lambda: not any(s.startswith("probe-b")
                     for s in _sel(env={"P_DIR": "/别处"}, exists=lambda p: p == "/别处")[1])
     and any(s.startswith("probe-b") for s in _sel(exists=_NOEXIST)[1])),
    ("人工套件 ⇒ 跳过且带理由", lambda: any("无汇总行" in s for s in _sel()[1])),
    ("非套件命名（helper.mjs）既不入 rows 也不算跳过",
     lambda: all("helper" not in s for s in _sel()[1]) and
     all(r[0] != "helper" for r in _sel()[0])),
    ("★ 清单里残留 requires_env ⇒ **报错**（两套机制并存必然分叉）",
     lambda: any("requires_env" in e for e in select(
         {"categories": _MAN["categories"], "exceptions": {"accept-x": {"requires_env": "X"}}},
         ["accept-x"], "", True, {})[2])),
    ("★ 未知 kind ⇒ 报错，不许当齐备",
     lambda: input_state({"kind": "magic", "value": "x"}, {}) is not None),
    ("★ **空套件列表必须报错**（零值守卫：跑了 0 个然后绿）",
     lambda: any("套件列表为空" in e for e in select(_MAN, [], "", True, {})[2])),
    ("**清单缺 categories** ⇒ 报错（零值守卫）",
     lambda: any("没有 categories" in e for e in select({}, _NAMES, "", True, {})[2])),
    ("过滤器只选匹配的（accept-x 之外都不进来）",
     lambda: [r[0] for r in _sel(probes=True, flt="accept-*")[0]] == ["accept-x"]),
    ("★ 过滤器匹配不到任何东西时 rows 为空（由 sweep.sh 判 FATAL，不是这里静默绿）",
     lambda: _sel(flt="nothing-*")[0] == []),
    # ★ F4 接线（2026-09-28）：声明了输入，还必须有东西**把它对齐给探针** —— 否则探针退回
    #   自己的内部默认，你会拿另一个站点的成绩当这个站点的（实测踩过，见 resolved_inputs）
    ("★ `--inputs-for` 用**声明值**填变量（探针不必再依赖自己的内部默认）",
     lambda: resolved_inputs(_MAN, "probe-b", {}, exists=_ALLEXIST) == {"P_DIR": "/外/部/目录"}),
    ("★ 环境变量覆盖优先（与 input_state **同一口径**，不许分叉）",
     lambda: resolved_inputs(_MAN, "probe-b", {"P_DIR": "/别处"}, exists=_ALLEXIST) == {"P_DIR": "/别处"}),
    ("`kind=env` 不导出（变量本来就靠继承）",
     lambda: resolved_inputs(_MAN, "probe-c", {"PLAYWRIGHT_BROWSERS_PATH": "/x"}) == {}),
    ("path 输入**没写 env 变量名** ⇒ 不导出（没有口径可对齐）",
     lambda: resolved_inputs({"inputs": {"s": [{"kind": "path", "value": "/x"}]}},
                             "s", {}, exists=_ALLEXIST) == {}),
    ("★ **值里有空白 ⇒ 拒绝**（`env $inputs` 未加引号展开会静默传错，宁可响亮失败）",
     lambda: emit_inputs({"A": "/a b"})[1] != [] and emit_inputs({"A": "/ok"})[1] == []),
    ("★ 空值也拒绝（`VAR=` 会让探针以为设过了）", lambda: emit_inputs({"A": ""})[1] != []),
]


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from gate import selftest as _st            # noqa: E402
    sys.exit(_st("sweep_select", CASES) if "--selftest" in sys.argv else main(sys.argv[1:]))
