#!/usr/bin/env python3
"""重算 README.md 的 AUTO 区块。

用法：
  update-readme.py            # 就地重写
  update-readme.py --check    # 只校验：会变就 exit 1（给 pre-push 用）
AUTO 区块：
  <!-- AUTO:FILES --> ... <!-- /AUTO -->  : git 跟踪文件清单（路径 + 字节数）
"""
import subprocess
import sys

BEGIN = "<!-- AUTO:FILES -->"
END = "<!-- /AUTO -->"


def tracked_files():
    out = subprocess.run(
        ["git", "ls-files"], capture_output=True, text=True, check=True
    ).stdout.splitlines()
    return sorted(f for f in out if f and f != ".git")


def render_block(root="."):
    import os

    lines = [BEGIN]
    for f in tracked_files():
        p = os.path.join(root, f)
        try:
            size = os.path.getsize(p)
        except OSError:
            size = -1
        lines.append(f"- `{f}` ({size} bytes)")
    lines.append(END)
    return "\n".join(lines) + "\n"


def main():
    import os

    os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    with open("README.md", encoding="utf-8") as fh:
        text = fh.read()
    if BEGIN not in text or END not in text:
        print("README 缺少 AUTO:FILES 区块", file=sys.stderr)
        return 2
    pre, _, rest = text.partition(BEGIN)
    _, _, post = rest.partition(END)
    new_text = pre + render_block() + post
    if "--check" in sys.argv:
        if new_text != text:
            print("README 的 AUTO 区块已过期：先提交（hook 会自动重算）再推", file=sys.stderr)
            return 1
        print("README 新鲜")
        return 0
    if new_text != text:
        with open("README.md", "w", encoding="utf-8") as fh:
            fh.write(new_text)
        print("README 已重算")
    else:
        print("README 无变化")
    return 0


if __name__ == "__main__":
    sys.exit(main())
