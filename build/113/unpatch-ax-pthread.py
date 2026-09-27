#!/usr/bin/env python3
# Octave-Full-Wasm — 撤销 `patch-ax-pthread.sh` 的插入（B6 线程档，2026-09-27）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

"""把 `configure` 里那段"emscripten 下跳过 AX_PTHREAD"的插入**按标记精确删掉**。

## 为什么需要它

`patch-ax-pthread.sh` 实现的是**闸门③**（"不引入 COI/SharedArrayBuffer 需求"）：它把
`ax_pthread_ok=no` + `PTHREAD_CFLAGS=""` 覆盖进 `configure`，于是全树不带 `-pthread`、
wasm 内存不是 shared、浏览器侧免 `COOP/COEP`。B6（线程档）要的恰好相反 ⇒ **必须能撤**。

## 为什么"按标记删"而不是"拿原始 tarball 覆盖"

树里还有**别的**补丁必须留着（`configure-113-full.sh` 每次 configure 前做的
`-fexceptions`→`-fwasm-exceptions` 替换、`postdeps_CXX` 置空）。拿 tarball 覆盖会把它们一起抹掉，
而那两个 sed 是"每次 configure 前重做一次"的**前置处理**，抹掉后当次能过、下次就悄悄变了行为。
（原始 tarball 在容器里（`/src/probe11/octave-11.3.0.tar.xz`）—— 它是**验证**用的差分基准，不是删除工具。）

## 判据（三条，都能证伪）

  1. 标记处的块**必须长得就是本补丁插的样子**（12 行、含 `-emscripten` 与 `ax_pthread_ok=no`、
     且前一行为空行）—— 不符合就 FATAL，**不许猜着删**；
  2. 删完 `--check` 必须报"标记 0 处、ax_pthread_ok=no 0 处"；
  3. **幂等**：再跑一次必须明确说"没有标记，无需撤销"（exit 3）而不是装作删过。

用法：
  unpatch-ax-pthread.py <configure 路径>          # 撤销（无标记 ⇒ exit 3）
  unpatch-ax-pthread.py --check <configure 路径>  # 只诊断
  unpatch-ax-pthread.py --selftest                # 自证：3 类用例
"""
import io
import sys

MARK = "Octave-Full-Wasm: emscripten 下跳过 AX_PTHREAD"
BLOCK_LINES = 12          # 前导空行 + 标记 + 3 行注释 + case/*-emscripten*/3 赋值/;;/esac


def revert(text):
    """删除所有插入块。返回 `(新文本, 删除处数)`；形状不符时抛 ValueError。"""
    lines = text.split("\n")
    out, removed, i = [], 0, 0
    while i < len(lines):
        ln = lines[i]
        if ln.startswith("# " + MARK):
            if not out or out[-1].strip() != "":
                raise ValueError("标记前一行不是空行（插入点被改过），不猜")
            j = i
            while j < len(lines) and lines[j].strip() != "esac":
                j += 1
            if j >= len(lines):
                raise ValueError("找到标记但找不到配对的 esac")
            span = lines[i - 1:j + 1]
            body = "\n".join(span)
            if len(span) != BLOCK_LINES or "ax_pthread_ok=no" not in body \
                    or "*-emscripten*" not in body or "PTHREAD_CFLAGS" not in body:
                raise ValueError("标记处的块不是本补丁插的形状（%d 行）：\n%s" % (len(span), body[:400]))
            out.pop()                      # 去掉前导空行
            removed += 1
            i = j + 1
            continue
        out.append(ln)
        i += 1
    return "\n".join(out), removed


def main(argv):
    check = "--check" in argv
    argv = [a for a in argv if not a.startswith("--")]
    if not argv:
        print(__doc__.strip().split("用法：")[-1].strip(), file=sys.stderr)
        return 2
    path = argv[0]
    text = io.open(path, encoding="utf-8", errors="surrogateescape").read()
    n_mark = text.count("# " + MARK)
    if check:
        print("  %s：标记 %d 处、ax_pthread_ok=no %d 处"
              % (path, n_mark, text.count("ax_pthread_ok=no")))
        return 0 if n_mark == 0 else 1
    if n_mark == 0:
        print("  没有本补丁的标记 ⇒ 无需撤销")
        return 3
    try:
        new, removed = revert(text)
    except ValueError as e:
        print("FATAL: %s" % e, file=sys.stderr)
        return 1
    io.open(path, "w", encoding="utf-8", errors="surrogateescape").write(new)
    left = new.count("# " + MARK)
    print("  已撤销 %d 处；撤销后标记 %d 处（info：PTHREAD_CFLAGS=\"\" %d 处）"
          % (removed, left, new.count('PTHREAD_CFLAGS=""')))
    if left:
        print("FATAL: 撤销后仍能找到标记", file=sys.stderr)
        return 1
    # ⚠️ **不要**拿 `ax_pthread_ok=no` 当判据（我第一版就是，错了）：那两处是 AX_PTHREAD
    #    宏**自己的初始化**（宏体开头先置 no、再逐项试探），原始 tarball 里同样有。
    #    能证伪的判据是**差分**（与原始 tarball 比 pthread 相关行数），由
    #    `patch-ax-pthread.sh --revert` 做 —— 它是"删除工具"之外的**验证器**。
    return 0


# ── 自证（三类：该删的删掉 / 形状不对必须拒 / 幂等）────────────────────────────
_GOOD = "line1\n\n# " + MARK + "（Octave-Full-Wasm 平台补丁）\n# c1\n# c2\n# c3\n" \
        "case $host in\n  *-emscripten*)\n    ax_pthread_ok=no\n    PTHREAD_CFLAGS=\"\"\n" \
        "    PTHREAD_LIBS=\"\"\n    ;;\nesac\nline2\n"
CASES = [
    ("该删的删掉：块消失、其余原样",
     lambda: revert(_GOOD) == ("line1\nline2\n", 1)),
    ("两处覆盖都删（AX_PTHREAD 展开两遍）",
     lambda: revert(_GOOD + _GOOD)[1] == 2),
    ("**幂等**：没有标记时 removed=0（不装作删过）",
     lambda: revert("only line\n") == ("only line\n", 0)),
    ("★ 形状不对必须拒：块里没有 ax_pthread_ok=no",
     lambda: _raises("# " + MARK + "\ncase $host in\nesac\n")),
    ("★ 形状不对必须拒：标记前一行不是空行",
     lambda: _raises("notblank\n# " + MARK + "\ncase $host in\n    ax_pthread_ok=no\n" +
                     "    PTHREAD_CFLAGS=\"\"\n    ;;\nesac\n")),
    ("★ 形状不对必须拒：找不到 esac",
     lambda: _raises("\n# " + MARK + "\n# c\n")),
]


def _raises(text):
    try:
        revert(text)
        return False
    except ValueError:
        return True


if __name__ == "__main__":
    # ⚠️ gate 只在自证时才需要：这个脚本要**在容器里**跑（`docker cp` 过去），
    #    容器里没有 build/lib/gate.py ⇒ 无条件 import 会让它在容器里直接崩（实测踩到）。
    if "--selftest" in sys.argv:
        import os
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
        from gate import selftest as _st               # noqa: E402
        sys.exit(_st("unpatch-ax-pthread", CASES))
    sys.exit(main(sys.argv[1:]))
