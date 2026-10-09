#!/usr/bin/env python3
# Octave-Full-Wasm — **事实台账入口（兼容壳）**
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# ── 为什么这里只剩一个壳（2026-10-09）────────────────────────────────────────
# 事实系统已采纳**完全重构后的 Einfacht**：机制在 `zreflect/`（vendored 上游），
# 本仓的**数据层**在 `zreflect/measure_octave.py`。数字只能有一个产地 —— 留两份
# 生成器就是本仓反复打击的"同一件知识写两处、必然走散"。
#
# 所以本文件**不再自己量**：它只把 argv 转给 `zreflect/facts.py`（并补上本仓的
# 默认旋钮口径，使不带环境变量直接跑也与钩子一致）。老脚本/文档里写
# `python3 build/facts.py …` 的照旧能用；真正干活的只有 `zreflect/facts.py`。
#
# 复跑方式（与壳等价）：
#   REFLECT_FACTS=build/FACTS.json REFLECT_DOC=STATE.md python3 zreflect/facts.py …
import os
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENTRY = os.path.join(REPO, "zreflect", "facts.py")

# 本仓默认口径（reflect-hooks/Einfacht.env 是钩子的权威来源；这里给手工直跑兜底）
DEFAULTS = {
    "REFLECT_FACTS": "build/FACTS.json",
    "REFLECT_DOC": "STATE.md",
}
env = dict(os.environ)
for k, v in DEFAULTS.items():
    env.setdefault(k, v)

sys.exit(subprocess.run([sys.executable, ENTRY] + sys.argv[1:],
                        cwd=REPO, env=env).returncode)
