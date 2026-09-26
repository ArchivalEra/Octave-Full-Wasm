#!/usr/bin/env python3
# Octave-Full-Wasm — **闸门自证台**（事实系统 F1；2026-09-26）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# ═══════════════════════════════════════════════════════════════════════════════
# 为什么有它（全部实测，见 `build/113/PLAN-arch.md` §2 与架构评审 §0）
#
# 这个仓库有很重的机械在保**产物**为真（sha 三层、三列 parity、产物身份证的
# "声明 vs 实测" + 反向断言套件），但保**闸门自己**为真的机械几乎为零：
#   · 约 20 个检查器里**只有 1 个**（`build/113/test-manifest-check.py`）能证明自己会红；
#   · ~15 个"收集-断言"式闸门**没有零值守卫** —— 输入一空就静默变绿。已实测到的样本：
#       · `check-site-parity.sh`：把 `VERSION` 从**三处站点同时**删掉 ⇒ 三列都是 `(缺)`
#         ⇒ 它报"三处完全一致"；
#       · `check-build-manifest.py`：`declared == {}` ⇒ 给出 `verdict:"ok"`；
#       · `glue-selftest`：`0/0` 算"全过"；
#       · `check-consistency.py` 的启动清单块：正则一改就匹配 0 个名字，而"0 个都合规"
#         **恒真** —— 本会话真的撞到过（闸门静默空转，没人知道）。
#
# 本模块把三件事变成结构性的：
#   ① **零值守卫** `require_nonempty()`：空集合**不是通过**，是"没查"；
#   ② **根注入** `root()`（`GATE_REPO` 可覆盖）：闸门能在**夹具树**上跑，而不是只能在真仓库上跑；
#   ③ **自证契约** `selftest()`：每个闸门必须能回答"我这样输入时**会红吗**"，
#      并由 `build/gates-selftest.sh`（接进 pre-commit）强制执行。
#
# 用法（闸门侧）：
#   from gate import Gate, root, selftest
#   def main():
#       g = Gate("check-xxx", list_mode="--list" in sys.argv)
#       ... g.note(...) / g.problem(...) / g.require_nonempty(items, "启动清单") ...
#       return g.finish()
#   if __name__ == "__main__":
#       sys.exit(selftest("check-xxx", CASES) if "--selftest" in sys.argv else main())
#
# 自证用例写什么（**这条是纪律，不是建议**）：
#   · 至少一条"正常输入 ⇒ 不报问题"（否则闸门可能是恒红，等于没有）；
#   · 至少一条"该报的必须报"（拿合成输入喂进去，断言它报了）；
#   · 至少一条**空输入必须报**（零值守卫本身的自证）。
# ═══════════════════════════════════════════════════════════════════════════════
import os
import shutil
import sys
import tempfile

# `build/lib/gate.py` → 上溯三层是仓库根
_HERE = os.path.dirname(os.path.abspath(__file__))
_DEFAULT_ROOT = os.path.dirname(os.path.dirname(_HERE))


def root():
    """仓库根。`GATE_REPO` 可覆盖 —— 那是**自证**的前提（自证要在夹具树上跑，别碰真仓库）。"""
    return os.environ.get("GATE_REPO") or _DEFAULT_ROOT


def fixture(files):
    """在临时目录里搭一棵最小假树（self-test 用）。返回根路径；调用方自己负责清理。"""
    d = tempfile.mkdtemp(prefix="gate-fixture-")
    for rel, content in files.items():
        p = os.path.join(d, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as fh:
            fh.write(content)
    return d


def cleanup(d):
    shutil.rmtree(d, ignore_errors=True)


class Gate:
    """一个闸门的运行记录：收集 notes / problems，统一输出与退出码。

    `list_mode`（`--list`）只列不改、永远 exit 0 —— 人工巡检用（沿用 check-consistency 的老约定）。
    """

    def __init__(self, name, list_mode=False):
        self.name = name
        self.list_mode = list_mode
        self.notes = []
        self.problems = []

    # ── 记账 ────────────────────────────────────────────────────────────────
    def note(self, msg):
        self.notes.append(str(msg))

    def problem(self, what, detail=""):
        self.problems.append((str(what), str(detail)))

    def require(self, ok, what, detail=""):
        """条件断言：不成立就是问题。返回该条件本身（便于串联）。"""
        if not ok:
            self.problem(what, detail)
        return bool(ok)

    def require_nonempty(self, items, what, detail=""):
        """★ **零值守卫**：空集合不是"通过"，是"没查"。

        这是本平台存在的头号理由 —— "收集-断言"式闸门在输入消失时会静默变绿
        （实测：三处站点同时缺 `VERSION` ⇒ parity 报"三处完全一致"）。
        返回非空与否；调用方可据此决定要不要继续跑后续断言。
        """
        n = len(items) if hasattr(items, "__len__") else sum(1 for _ in items)
        if n == 0:
            self.problem(
                what + "：**收集到 0 项 ⇒ 闸门会静默空转**",
                detail or "空输入不是「通过」，是「根本没查」—— 补上零值守卫，或说明为什么允许为空",
            )
            return False
        return True

    # ── 输出 ────────────────────────────────────────────────────────────────
    def finish(self):
        for n in self.notes:
            print("  · %s" % n)
        if self.problems:
            print("★ %s 不通过：" % self.name, file=sys.stderr)
            for what, detail in self.problems:
                print("  [%s] %s" % (what, detail), file=sys.stderr)
            return 0 if self.list_mode else 1
        print("%s：OK" % self.name)
        return 0


def selftest(name, cases):
    """跑一个闸门的自证用例。

    `cases`: `[(标签, 函数)]`，函数返回 **True 表示"这条确实被判成了问题/没按预期放行"**。
    ⚠️ 别把断言写松：自证用例本身也要能被证伪（拿合成输入喂，看闸门是否报）。
    """
    bad = 0
    for label, fn in cases:
        try:
            ok = bool(fn())
            err = ""
        except Exception as e:                                    # noqa: BLE001
            ok, err = False, "  ← 抛异常：%r" % (e,)
        print("%s | %s/%s%s" % ("PASS" if ok else "fail", name, label, err))
        if not ok:
            bad += 1
    print("\n=== %s 自证：%d PASS / %d fail ===" % (name, len(cases) - bad, bad))
    return 1 if bad else 0


def run_quiet(fn, *a, **kw):
    """在自证用例里跑闸门逻辑并把 stdout/stderr 吞掉，只取返回值。"""
    import contextlib
    import io
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
        return fn(*a, **kw)
