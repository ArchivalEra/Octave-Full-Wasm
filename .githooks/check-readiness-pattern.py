#!/usr/bin/env python3
# Octave-Full-Wasm — **就绪反模式闸门**（工单 40/42 的机器化教训，2026-10-03）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# ── 它拦什么 ────────────────────────────────────────────────────────────────────
# 测试套件在 **boot 完成前**轮询解释器（`Module?.feval?.('strcat', …)` 探针）是
# AGENTS 红线"execute_interp() 之前不许碰解释器"的反模式：NT=4 产物上早期调用干净抛错
# ⇒ 一直没人发现；**NT=8 上会撞 OpenBLAS 建池窗口 ⇒ 主线程卡死、套件零输出挂死**。
# 机制取证见 `.scratch/open-questions/issues/40-nt8-feval-deadlock.md`；修复形状 =
# **两段式就绪**（先等 `window.__octaveReady === true`，再碰 feval）。
#
# 实测代价（为什么要有这道闸）：工单 40 修 bench-lanes 时只修了"当时红过的"套件，
# **还有 4 个套件带着旧反模式漏网**（bench-core / bench-dgemm / probe-heap-ceiling /
# probe-want-matcher）—— NT=8 上站批的全量回归在 bench-dgemm 上挂死才发现。
# 本闸门把"两段式"变成机器化断言：**凡含 feval 就绪轮询的套件，必须含 `__octaveReady`**。
#
# 判据（可复跑）：`python3 .githooks/check-readiness-pattern.py`
#   · 扫 `test/browser/*.mjs`；
#   · 文件含 `Module?.feval?.('strcat'`（就绪轮询签名）**且不含** `__octaveReady` ⇒ 红；
#   · 只含普通 feval（就绪之后的工作调用）不红 —— 本闸只管**就绪轮询**这一种形状。
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "build", "lib"))
from gate import Gate, fixture, cleanup, root, selftest  # noqa: E402

POLL = "Module?.feval?.('strcat'"
READY = "__octaveReady"


def scan(testdir, poll=POLL, ready=READY):
    """纯逻辑（自证走这里）：返回反模式文件名列表（相对 testdir）。"""
    bad = []
    if not os.path.isdir(testdir):
        return None                                   # None = 目录不存在（零值守卫）
    for name in sorted(os.listdir(testdir)):
        if not name.endswith(".mjs"):
            continue
        try:
            text = open(os.path.join(testdir, name), encoding="utf-8",
                        errors="replace").read()
        except OSError:
            continue
        if poll in text and ready not in text:
            bad.append(name)
    return bad


def main():
    g = Gate("check-readiness-pattern", list_mode="--list" in sys.argv)
    testdir = os.path.join(root(), "test", "browser")
    bad = scan(testdir)
    if bad is None:
        g.problem("test/browser/ 目录不存在 —— 没扫到任何东西 = 这个闸门什么都没查")
        return g.finish()
    found = [n for n in os.listdir(testdir) if n.endswith(".mjs")]
    g.require_nonempty(found, "test/browser/ 的 .mjs 套件")
    if bad:
        for name in bad:
            g.problem("%s: 含 feval 就绪轮询但无 __octaveReady 两段式（NT=8 下会挂死）"
                      " ⇒ 修法见 test/browser/bench-lanes.mjs 的两段式样例" % name)
    else:
        g.note("就绪反模式：%d 个 .mjs 里 0 个（凡 feval 轮询皆两段式）" % len(found))
    return g.finish()


def _np(files):
    """在临时夹具上跑 scan（自证用）。files 的键 = 相对 test/browser/ 的文件名。"""
    d = fixture({"test/browser/" + k: v for k, v in files.items()})
    try:
        return scan(os.path.join(d, "test", "browser")) or []
    finally:
        cleanup(d)


CASES = [
    ("两段式套件 ⇒ 不报",
     lambda: _np({"a.mjs": "if (await page.evaluate(() => window.__octaveReady === true)) {}\n"
                           "await page.evaluate(() => { try { return !!window.Module?.feval?.('strcat', ['a','b'], 1); } catch { return false; } });\n"}) == []),
    ("★ feval 轮询但无 __octaveReady ⇒ 必须报（本闸存在的理由）",
     lambda: _np({"bad.mjs": "while (Date.now() - t0 < 300000) { const ok = await page.evaluate(() => { try { return !!window.Module?.feval?.('strcat', ['a', 'b'], 1); } catch { return false; } }); }\n"}) == ["bad.mjs"]),
    ("普通 feval（工作调用，非就绪轮询）⇒ 不报",
     lambda: _np({"work.mjs": "const r = await page.evaluate(() => window.Module.feval('disp', ['hi'], 1));\n"}) == []),
    ("非 .mjs 文件不进扫描 ⇒ 不报",
     lambda: _np({"helper.js": POLL, "readme.md": POLL}) == []),
    ("★ test/browser/ 一个 .mjs 都没有 ⇒ main() 必须红（零值守卫，经 GATE_REPO 夹具实测）",
     lambda: _main_rc({"readme.md": "x"}) != 0),
    ("★ test/browser/ 整个缺失 ⇒ main() 必须红（零值守卫）",
     lambda: _main_rc({}) != 0),
]


def _main_rc(files):
    """把夹具当 GATE_REPO 跑 main()，返回其退出码（零值守卫的真实验证）。"""
    import subprocess
    d = fixture({"test/browser/" + k: v for k, v in files.items()})
    try:
        env = dict(os.environ, GATE_REPO=d)
        p = subprocess.run([sys.executable, os.path.abspath(__file__)],
                           env=env, capture_output=True, text=True, timeout=30)
        return p.returncode
    finally:
        cleanup(d)


if __name__ == "__main__":
    sys.exit(selftest("check-readiness-pattern", CASES) if "--selftest" in sys.argv else main())
