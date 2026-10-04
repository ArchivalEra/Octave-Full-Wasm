#!/usr/bin/env python3
# Octave-Full-Wasm — 给 ZCode 的 SessionStart hook 用：把 HANDOFF 的当前状态注入会话上下文
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

"""输出 hook 的**严格 JSON**（`hookSpecificOutput.additionalContext`），把"该读哪份文档 +
当前部署状态"送进新会话的上下文。

为什么值得装：本项目的 HANDOFF 就是为"抗上下文压缩"写的，而 `SessionStart` 的匹配值里
正好有 `compact` —— 压缩之后重新出发时，这一句会重新提醒 agent 去读 §8。
**仍然以 AGENTS.md 为准**：那条指令是每次都加载的，本 hook 只是把"当前状态"带上。

⚠️ 未验证项（如实记）：ZCode 的 hook stdout 走严格 JSON 校验，本脚本按
`hookSpecificOutput.hookEventName = "SessionStart"` + `additionalContext` 的形态输出。
若某次升级改了 schema，这个 hook 会被记成 failed（无害，日志里可见），
`AGENTS.md` 那条规则不受影响。第一次用 `SessionStart` 之后，去 ZCode 日志里核对一次。
"""
import json
import os
import re
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def state_lines():
    doc = os.path.join(REPO, "HANDOFF.md")
    if not os.path.isfile(doc):
        return []
    text = open(doc, encoding="utf-8").read()
    m = re.search(r"<!-- AUTO:STATE -->(.*?)<!-- /AUTO:STATE -->", text, re.S)
    if not m:
        return []
    rows = []
    for line in m.group(1).split("\n"):
        line = line.strip()
        if not line.startswith("|") or line.startswith("|---"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if cells and cells[0] in ("项",) or not cells:
            continue
        rows.append(" · ".join(c for c in cells if c))
    return rows


def main():
    # 先把机器块刷新（静默），这样注入的就是**当前**状态
    subprocess.run([sys.executable, os.path.join(REPO, ".githooks", "update-state.py"),
                    "--quiet"], cwd=REPO, capture_output=True)
    ctx = ["[STATE] 本仓库是浏览器版 Octave（wasm）。接续工作**先读 maintaince.md（方向）与 STATE.md（活状态）**"
           "（指路牌版：§0 现在是什么 / §1 下一步 / §2 指针表；记忆架构规约 = "
           "docs/agents/memory.md），规则在 AGENTS.md（每次自动载入），"
           "历史与过程在 HISTORY.md（append-only）。",
           "当前活状态（由 .githooks/update-state.py 从持久盘产物重算，**别手写**）："]
    ctx += ["  · " + r for r in state_lines()]
    ctx.append("改动前先读 AGENTS.md 的三条不可违背；验收底线是 8761 永不退化（先在 8768 上验）。")
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart",
                                             "additionalContext": "\n".join(ctx)}},
                     ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
