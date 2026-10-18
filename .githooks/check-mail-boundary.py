#!/usr/bin/env python3
# Octave-Full-Wasm — **mail 边界闸门**：本仓收件箱里只许有**写给本仓**的信
# Copyright (C) 2026 ArchivalEra · SPDX-License-Identifier: AGPL-3.0-or-later
#
# ── 为什么有它（2026-10-15，用户点令）──────────────────────────────────────────
# 实测事故：host 去 `LLVM-wasm/mail/` 与 `OpenModelica-Full-Wasm/mail/` 里找"写给我的信"，
# 结果那两份是**内容仓发给 LLVM 和 OM** 的往来 —— **不是写给我的**。这是越界：
# 那些是**别人的**私人通信（即使仓 public 也不该当自己的信读）。
#
# **根因不在"读错"，在"没有收件箱"**：四个仓里 content/LLVM/OM 各有 `mail/`，
# 唯独本仓没有 ⇒ 写给我的信无处可投，只能落回发信方自己的 `mail/`
# ⇒ 逼得收信方去翻**发信仓**的目录找信，一翻就越界。
#
# ⇒ **边界规则（可执行）**：
#   ① **投递**：一封信送进**收信方**的 `mail/`（不是发信方自己留档）；
#   ② **只读自己的**：每个 agent 找信/读信**只在自己仓的 `mail/`** 里；不读别仓的 `mail/`；
#   ③ 本闸门守 ① 的**收信侧不变量**：本仓 `mail/*.md`（除 `README.md`）的 `**To:**`
#      必须**指名本仓**（`host` / `Octave-Full-Wasm`）—— 否则那是**别人的信**进了我的箱子。
#
# 判据可证伪（反向）：把一封 `To: OpenModelica-Full-Wasm` 的信放进本仓 `mail/` ⇒ **必红**。
# 零值守卫：`mail/` 里一封真信都没有（只有 README）⇒ 报（"没查"不是"通过"）。
#
# stdout 裸值契约（平台闸门惯例）：`ok` / `PROBLEM: …`。退出码 0 / 1。
# 用法：python3 .githooks/check-mail-boundary.py ／ --selftest
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "build", "lib"))
from gate import Gate, root, run_quiet, selftest          # noqa: E402

MAILBOX = "mail"
# 本仓的身份 token（`**To:**` 行里出现任一 ⇒ 判定"写给我"）。
# ⚠️ 只扫收件人行，不扫正文（"host" 这词太常见，扫全文必假阳）。
OWNER_TOKENS = ("host", "octave-full-wasm")
NOT_A_LETTER = {"README.md"}          # 协议说明，不是信


def check(g, letters, owner_tokens=OWNER_TOKENS, skip=NOT_A_LETTER):
    """`letters` = {文件名: 正文}（**注入** ⇒ 自证不碰真目录）。返回 g。"""
    if not g.require_nonempty(letters, "mail/ 里的文件"):
        return g
    n = 0
    for name in sorted(letters):
        if name in skip:
            continue
        body = letters[name] or ""
        n += 1
        m = re.search(r"\*\*To:\*\*\s*(.+)", body)
        if not m:
            g.problem("信缺 `**To:**` 行", "%s（无法判定收件人）" % name)
            continue
        to = m.group(1).strip()
        if not any(t in to.lower() for t in owner_tokens):
            g.problem("不是写给本仓的信（收件人不是本仓）",
                      "%s ⇒ To: %s —— 这封是别人的往来，不该在本仓收件箱里"
                      % (name, to[:60]))
    if n == 0:
        g.problem("mail/ 里没有真信（零值守卫）",
                  "一封都没有 ⇒ 本闸门没查东西，不算通过")
    else:
        g.note("收件箱边界 OK（%d 封信，收件人全是本仓）" % n)
    return g


def read_inputs():
    """读本仓 `mail/*.md`（**只读本仓** —— 边界规则第 ② 条）。

    ★ 2026-10-18（采纳内容仓 mail/031 的 `read/` 提案）：未读区（`mail/*.md`）可能被
    `zreflect/mail-read.py` 归档清空（全部搬进 `mail/read/`）。此时**退而扫已读区** ——
    已读的信 `To:` 不变，同一条不变量照样成立。两处都空才返回空（零值守卫仍在，
    不会被"归档"这个合法动作变成假红）。
    ⚠️ `read/` 是子目录 ⇒ `os.listdir` 给的名字 `read` 不以 `.md` 结尾 ⇒ 天然跳过
      （所以本函数对"未读区有信"的情形行为逐字不变）。
    """
    d = os.path.join(root(), MAILBOX)
    out = {}
    if not os.path.isdir(d):
        return out
    for f in sorted(os.listdir(d)):
        if f.endswith(".md"):
            try:
                with open(os.path.join(d, f), encoding="utf-8", errors="replace") as fh:
                    out[f] = fh.read()
            except OSError:
                out[f] = ""
    if out:
        return out
    # 未读区空 ⇒ 退到已读区（read/）；两处都空时仍返回空（零值守卫由调用方判）。
    rd = os.path.join(d, "read")
    if os.path.isdir(rd):
        for f in sorted(os.listdir(rd)):
            if f.endswith(".md"):
                try:
                    with open(os.path.join(rd, f), encoding="utf-8", errors="replace") as fh:
                        out[f] = fh.read()
                except OSError:
                    out[f] = ""
    return out


def main():
    g = Gate("mail 边界", list_mode="--list" in sys.argv)
    try:
        letters = read_inputs()
    except OSError as e:
        g.problem("读不到 mail/", "%r" % (e,))
        return g.finish()
    check(g, letters)
    return g.finish()


def _np(letters):
    g = Gate("x")
    run_quiet(check, g, letters)
    return len(g.problems)


def _read_inputs_with(tree):
    """用临时目录冒充 mail/（**注入**：自证不碰真收件箱）。

    `tree` = {相对路径: {文件名: 正文}}；"read" 键 = read/ 子目录。
    返回 check() 报出的问题数（0 = 不报）。⚠️ 这里走**真** read_inputs（含退扫逻辑）
    —— 自证要验的正是那段逻辑，喂合成 dict 是验不到的。
    """
    import shutil
    import tempfile
    t = tempfile.mkdtemp()
    try:
        d = os.path.join(t, MAILBOX)
        os.makedirs(d)
        for sub, files in tree.items():
            sd = os.path.join(d, sub) if sub else d
            os.makedirs(sd, exist_ok=True)
            for name, body in files.items():
                with open(os.path.join(sd, name), "w", encoding="utf-8") as fh:
                    fh.write(body)
        saved_root = root
        try:
            globals()["root"] = lambda: t
            return _np(read_inputs())
        finally:
            globals()["root"] = saved_root
    finally:
        shutil.rmtree(t, True)


CASES = [
    ("正常：收件人是本仓 ⇒ 不报", lambda: _np({
        "001-x.md": "**To:** host（Octave-Full-Wasm）\n**From:** extra-content\n",
        "002-y.md": "**To:** Octave-Full-Wasm 管理者\n"}) == 0),
    ("★ 该报的必须报：一封 To 别的仓 ⇒ 必红（本仓曾因此越界）", lambda: _np({
        "001-x.md": "**To:** host（Octave-Full-Wasm）\n",
        "099-leak.md": "**To:** OpenModelica-Full-Wasm 管理者\n"}) == 1),
    ("该报的必须报：缺 `**To:**` 行 ⇒ 必红（无法判定收件人）", lambda: _np({
        "001-x.md": "**From:** someone\n没有收件人行\n"}) == 1),
    ("★ 空输入必须报：只有 README、没有真信 ⇒ 必红（零值守卫）", lambda: _np({
        "README.md": "# 协议说明\n"}) == 1),
    ("★ 空输入必须报：mail/ 一个文件都没有 ⇒ 必红（零值守卫）", lambda: _np({}) == 1),
    # ★ read/ 归档（2026-10-18，采纳内容仓 mail/031）：未读区被清空是**合法动作**，
    #   闸门必须退扫 read/ 而不是假红；但两处都空仍必须红（零值守卫不许被归档绕过）。
    ("★ read/ 退扫：未读区空 + read/ 里是合法信 ⇒ 不报（归档不许变成假红）",
     lambda: _read_inputs_with({"read": {"001-x.md": "**To:** host（Octave-Full-Wasm）\n"}}) == 0),
    ("★ read/ 退扫反向：未读区空 + read/ 里有 To 别的仓的信 ⇒ 必红（不变量照样成立）",
     lambda: _read_inputs_with({"read": {"099-leak.md": "**To:** OpenModelica-Full-Wasm\n"}}) == 1),
    ("★ read/ 退扫零值：未读区空 + read/ 也空 ⇒ 必红（归档不许把闸门变成恒绿）",
     lambda: _read_inputs_with({"read": {}}) == 1),
]


if __name__ == "__main__":
    sys.exit(selftest("check-mail-boundary", CASES) if "--selftest" in sys.argv else main())
