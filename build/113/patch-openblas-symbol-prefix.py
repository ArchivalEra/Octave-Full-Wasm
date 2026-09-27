#!/usr/bin/env python3
# Octave-Full-Wasm — **OpenBLAS 符号前缀补丁**（E2 方案 B，2026-09-27，branch `e2-openblas`）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

"""给 OpenBLAS 的 **Fortran 入口**加一层符号前缀（默认 `ob_`），CBLAS 名不动。

## 为什么走这条路（而不是改返回类型）

`NOTES-threads.md` 的「E2 悬案」把根因锁死在**返回约定**上：f2c 的 LAPACK 与 Octave 的
`F77_RET_T` 都按"子程序返回 `int`"调用，而 OpenBLAS 把 Fortran 入口定义成 `void` ⇒ wasm 的
`call` 类型校验不过（78 个 `function signature mismatch`）。

先用**方案 A**（把 `interface/*.c` 的 `void NAME(` 改成 `int NAME(` + 补 `return 0;`）试了，
`build/113/patch-openblas-f77-ret.py` 本身工作正常（72 处、可逐字节 revert、13 条自证），
但**编不过**，原因记档：

    error: non-void function 'copy_' should return a value [-Wreturn-mismatch]
      interface/copy.c:69:  if (n <= 0) return;      ← 共享体里的**裸 return;**
      interface/copy.c:84:  return;

这些文件是**共享函数体**写法：`#ifndef CBLAS`（Fortran 臂）与 `#else`（CBLAS 臂）**共用** `#endif`
之后那段体，体里有裸 `return;`。把返回类型改成 `int` 后，共享体里的裸 `return;` 必须改成
`return 0;`，可那样又**打破 CBLAS 那趟**（它返回 `void`）⇒ 方案 A 要动共享体就得再加一层
`#ifndef CBLAS` 包裹，改动面与风险都上一个台阶。

## 本方案（B）

把 OpenBLAS 的 **Fortran 入口**统一改名（`dswap_` → `ob_dswap_`），再用一个**生成的薄包装**
提供 f2c 约定的原名（`int dswap_(...) { ob_dswap_(...); return 0; }`）：
· 包装的**参数表**机械生成（参数个数取自链接器的 `function signature mismatch` 报文，
  f2c 的 Fortran ABI 下**每个参数都是指针** ⇒ 包装里一律 `void*`，与 wasm 的 i32 一致）；
· OpenBLAS **一行 C 源码都不用改**（只改 `Makefile.system` 里生成 `-DNAME=` 的那一行）；
· CBLAS 名（`cblas_dgemm`）、汇编器名（`ASMNAME`）、错误信息里的名字（`CHAR_NAME`）**都不动**。

## 用法（容器内，作用于 OpenBLAS 源树）

    python3 patch-openblas-symbol-prefix.py --check  /src/work/OpenBLAS-e2
    python3 patch-openblas-symbol-prefix.py --apply  /src/work/OpenBLAS-e2 [ob_]
    python3 patch-openblas-symbol-prefix.py --revert /src/work/OpenBLAS-e2
    python3 patch-openblas-symbol-prefix.py --selftest
"""
import io
import os
import re
import sys

TARGET = "Makefile.system"
SIDE = ".e2-symprefix-orig.json"
# 只认这两行（Makefile.system 里生成 per-TU 名字的唯一两处；实测 grep 全树只有它们）
# ⚠️ 形状以**真实行**为准（实测：`-DASMNAME=$(FU)$(*F)` 后面**没有** `$(BU)`；第一版照
#    `-DASMFNAME` 的样子抄了 `$(BU)`，夹具也跟着抄错 ⇒ 两处一起错，是 `--check` 在真实树上
#    报"两行都没找到"才暴露的）。
LINE_RE = re.compile(r"(?m)^(CCOMMON_OPT\t\+= .*-DASMNAME=)(\$\(FU\))(\$\(\*F\))"
                     r"( -DASMFNAME=\$\(FU\))(\$\(\*F\))(\$\(BU\))"
                     r"( -DNAME=)(\$\(\*F\))(\$\(BU\))")
DONE_RE = re.compile(r"(?m)^CCOMMON_OPT\t\+= .*-DNAME=\$\(E2PREFIX\)")


def patch_text(src, prefix):
    """把 `-DNAME=$(*F)$(BU)` 改成 `-DNAME=$(E2PREFIX)$(*F)$(BU)`（只改 NAME，不动 CNAME/ASMNAME）。"""
    n = 0
    out, pos = [], 0
    for m in LINE_RE.finditer(src):
        out.append(src[pos:m.start()])
        # 只把那一行里的 ` -DNAME=$(*F)` 换成 ` -DNAME=$(E2PREFIX)$(*F)`（其余原样）
        out.append(m.group(0).replace(" -DNAME=$(*F)", " -DNAME=$(E2PREFIX)$(*F)"))
        pos = m.end()
        n += 1
    out.append(src[pos:])
    txt = "".join(out)
    if n:
        # 在文件头插一段说明 + 默认值（`?=` 允许调用方覆盖：`make E2PREFIX=ob_`）
        head = ("# ★ E2（branch e2-openblas，2026-09-27）：给 Fortran 入口加符号前缀。\n"
                "#   为什么：f2c 的 LAPACK 与 Octave 的 F77_RET_T 按 int 返回调用子程序，\n"
                "#   而 OpenBLAS 定义成 void ⇒ wasm 的 call 类型校验不过（78 个 signature mismatch）。\n"
                "#   这里只改 Fortran 名（NAME），CBLAS 名（CNAME）/汇编名（ASMNAME）不动；\n"
                "#   f2c 约定的原名由链接期生成的薄包装提供（见 build/113/e2-f77-wrappers.md）。\n"
                "#   还原：python3 /src/bin/patch-openblas-symbol-prefix.py --revert <树>\n"
                "E2PREFIX ?=\n")
        txt = head + txt
    return txt, n


def revert_text(src):
    """逐字节还原：删掉我们插的文件头，并把 `$(E2PREFIX)` 去掉。"""
    out = src
    if out.startswith("# ★ E2（branch e2-openblas"):
        i = out.index("\nE2PREFIX ?=\n") + len("\nE2PREFIX ?=\n")
        out = out[i:]
    out = out.replace(" -DNAME=$(E2PREFIX)$(*F)", " -DNAME=$(*F)")
    return out


def counts(src):
    return (len(LINE_RE.findall(src)), len(DONE_RE.findall(src)))


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if len(argv) < 2:
        print(__doc__.strip().split("用法（容器内")[-1].strip(), file=sys.stderr)
        return 2
    mode, root = argv[0], argv[1]
    p = os.path.join(root, TARGET)
    if not os.path.isfile(p):
        print("FATAL: 缺 %s" % p, file=sys.stderr)
        return 2
    src = io.open(p, encoding="utf-8", errors="replace").read()
    side = os.path.join(root, SIDE)
    raw, done = counts(src)
    if mode == "--check":
        print("%s：待改 %d 行、已改 %d 行" % (TARGET, raw, done))
        if raw == 0 and done == 0:
            print("FATAL: 两处名字生成行都没找到 ⇒ 这个 OpenBLAS 版本的 Makefile 与脚本假设不符",
                  file=sys.stderr)
            return 3
        return 0
    if mode == "--apply":
        prefix = argv[2] if len(argv) > 2 else "ob_"
        if done and not raw:
            print("已打过（--revert 后再来）")
            return 0
        new, n = patch_text(src, prefix)
        if n == 0:
            print("FATAL: 一处都没改（别当成功）", file=sys.stderr)
            return 3
        io.open(p + ".e2orig", "w", encoding="utf-8").write(src)   # 备份：还原的最终依据
        io.open(p, "w", encoding="utf-8").write(new)
        with io.open(side, "w", encoding="utf-8") as fh:
            fh.write(prefix)
        print("已改 %d 行（前缀 %s）；原文件备份在 %s.e2orig" % (n, prefix, TARGET))
        return 0
    if mode == "--revert":
        bak = p + ".e2orig"
        if os.path.exists(bak):
            io.open(p, "w", encoding="utf-8").write(io.open(bak, encoding="utf-8").read())
            os.unlink(bak)
            print("已从 %s.e2orig 逐字节还原" % TARGET)
        else:
            io.open(p, "w", encoding="utf-8").write(revert_text(src))
            print("已按规则还原（没找到备份）")
        if os.path.exists(side):
            os.unlink(side)
        return 0
    print("未知模式 %s" % mode, file=sys.stderr)
    return 2


# ── 自证（六条：改对 / 只动 NAME / 幂等 / 逐字节还原 / 找不到行必须报 / 零值守卫）──────
_S = """CCOMMON_OPT\t+= -DASMNAME=$(FU)$(*F) -DASMFNAME=$(FU)$(*F)$(BU) -DNAME=$(*F)$(BU) -DCNAME=$(*F) -DCHAR_NAME=\\"$(*F)$(BU)\\"
OTHER_LINE = -DNAME=$(*F)$(BU)
"""


def selftest():
    cases = [
        ("改后出现 $(E2PREFIX)，且 -DNAME 那一项被改",
         lambda: " -DNAME=$(E2PREFIX)$(*F)$(BU)" in patch_text(_S, "ob_")[0]),
        ("★ CBLAS 名（-DCNAME=$( *F)）与汇编名（-DASMNAME=…）**一个字不动**",
         lambda: patch_text(_S, "ob_")[0].count(" -DCNAME=$(*F)") == 1
         and "-DASMNAME=$(FU)$(*F)" in patch_text(_S, "ob_")[0]),
        ("★ 只改动那一行：别的 -DNAME= 行（不是 Makefile 那两行的形状）不动",
         lambda: patch_text(_S, "ob_")[0].count("OTHER_LINE = -DNAME=$(*F)$(BU)") == 1),
        ("★ 插入的文件头带默认值 `E2PREFIX ?=`（调用方可覆盖）",
         lambda: "E2PREFIX ?=\n" in patch_text(_S, "ob_")[0]),
        ("★ `--revert` 逐字节还原", lambda: revert_text(patch_text(_S, "ob_")[0]) == _S),
        ("★ **零值守卫**：形状不符时不改（返回 0 处，调用方据此报 FATAL）",
         lambda: patch_text("nothing here\n", "ob_")[1] == 0),
    ]
    bad = 0
    for name, fn in cases:
        try:
            ok = bool(fn())
        except Exception as e:                    # noqa: BLE001
            ok, name = False, "%s（异常 %r）" % (name, e)
        print("%s | %s" % ("PASS" if ok else "fail", name))
        bad += 0 if ok else 1
    print("=== patch-openblas-symbol-prefix 自证：%d PASS / %d fail ===" % (len(cases) - bad, bad))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
