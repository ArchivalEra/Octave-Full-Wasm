#!/usr/bin/env python3
# Octave-Full-Wasm — **OpenBLAS 的 F77 返回约定补丁**（E2，2026-09-27，branch `e2-openblas`）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

"""把 OpenBLAS `interface/*.c` 的 Fortran 入口从 `void NAME(...)` 改成 `int NAME(...)` + `return 0;`。

## 为什么必须改（实测根因，证据在 `NOTES-threads.md` 的「E2 悬案：根因锁定」）

把线程版 OpenBLAS 链进主模块时 `wasm-ld` 报 **78 个 `function signature mismatch`**：

    >>> defined as (i32,i32,i32,i32,i32) -> i32   in /usr/local/lib/liblapack.a(dlaqps.o)
    >>> defined as (i32,i32,i32,i32,i32) -> void  in /openblas.a(dswap.o)

**参数完全一致，只差返回类型**：f2c 出的 LAPACK 与 Octave 自己的 `F77_RET_T` 都按
**子程序返回 `int`** 调用（C 的隐式声明 / `F77_RET_T` 就是 `int`），而 OpenBLAS 把 Fortran
入口定义成 `void`。wasm 的 `call` 指令**类型必须匹配**（不是"忽略返回值就行"）⇒ 模块过不了校验。
换 Fortran 接口宏（G77/GFORT）无效：那两个宏不动返回约定（实测 1689/0 次宏出现，报错一个不少）。

## 改哪些、不改哪些（三条都得同时成立）

| 形状 | 处理 | 为什么 |
|---|---|---|
| `void NAME(...) { … }`（`NAME` 是宏，展开成 `dgemm_` 之类） | **改**成 `int NAME(...)` + 末尾 `return 0;` | 这就是那一批子程序入口 |
| `void CNAME(...) { … }`（CBLAS 那半边） | **不许动** | CBLAS 是 C 接口，本来就返回 void |
| `FLOATRET NAME(...)` / `blasint NAME(...)` / `float`/`double`/`OPENBLAS_COMPLEX_FLOAT`（`ddot_`/`dnrm2_`/`idamax_` 这类**真函数**） | **不许动** | 它们的返回类型本来就是对的（f2c 也按函数声明） |

## 为什么不用正则硬改（上一轮的失败，两次）

1. 第一版把**函数原型** `void NAME(...);` 也当定义 ⇒ 花括号配对从声明一路跑到**下一个函数体**
   ⇒ 括号失衡、编译报 `expected identifier or '('`；
2. 第二版修了原型问题，仍有 63 个编译错 ⇒ **注释/字符串里的 `{`/`}` 骗了配对**
   （例：`interface/copy.c` 的裸计数 3 对 2）。
⇒ 本工具因此**先做 C 感知扫描**（剥注释与字符串、留掩码），只在掩码内配对花括号，并且
   `)` 之后必须紧跟 `{` 才算"定义"（否则是原型，跳过并计数）。

## 用法（容器内，作用于 OpenBLAS 源树）

    python3 patch-openblas-f77-ret.py --check  /src/work/OpenBLAS-thr/interface
    python3 patch-openblas-f77-ret.py --apply  /src/work/OpenBLAS-thr/interface
    python3 patch-openblas-f77-ret.py --revert /src/work/OpenBLAS-thr/interface
    python3 patch-openblas-f77-ret.py --selftest

`--apply` 会把每个文件的**原始返回类型 token**（含空白的原文）记进
`<dir>/.e2-f77ret-orig.json`，`--revert` 据此**逐字节**还原（判据：revert 后 sha 与备份一致）。
"""
import io
import json
import os
import re
import sys

SIDECAR = ".e2-f77ret-orig.json"
MARK = "/* E2：f2c/F77_RET_T 按 `int` 调用子程序 ⇒ OpenBLAS 这里从 void 改成 int（见 NOTES-threads 根因）*/"
INJECT = "\n  " + MARK + "\n  return 0;\n"

# 只认行首的 `void NAME(`（`NAME` 是 OpenBLAS 生成 Fortran 名的宏）。
DEF_RE = re.compile(r"(?m)^([ \t]*)void([ \t]+)NAME[ \t]*\(")
INT_RE = re.compile(r"(?m)^([ \t]*)int([ \t]+)NAME[ \t]*\(")


def code_mask(src):
    """返回与 src 等长的布尔表：True = 该字符在**代码**里（非注释/非字符串/非字符字面量）。

    这是本工具的核心：上一轮两次失败都出在"拿裸文本配对花括号"。
    """
    mask = bytearray(b"\x01" * len(src))
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c == "/" and i + 1 < n and src[i + 1] == "/":
            j = src.find("\n", i)
            j = n if j < 0 else j
            for k in range(i, j):
                mask[k] = 0
            i = j
        elif c == "/" and i + 1 < n and src[i + 1] == "*":
            j = src.find("*/", i + 2)
            j = n if j < 0 else j + 2
            for k in range(i, j):
                mask[k] = 0
            i = j
        elif c in ("'", '"'):
            q = c
            j = i + 1
            while j < n:
                if src[j] == "\\":
                    j += 2
                    continue
                if src[j] == q:
                    j += 1
                    break
                if src[j] == "\n":       # 未闭合的字符串字面量：到此为止（C 里非法，但别崩）
                    break
                j += 1
            for k in range(i, min(j, n)):
                mask[k] = 0
            i = j
        else:
            i += 1
    return mask


DIRECTIVE_RE = re.compile(r"(?m)^[ \t]*#[ \t]*(ifdef|ifndef|if|elif|else|endif)\b[^\n]*")
RAW_DEF_RE = re.compile(r"(?m)^[ \t]*void[ \t]+NAME[ \t]*\(")


def _cblas_then_ok(kw, cond):
    """按"**只判 CBLAS 那一项**"的政策给出 then 臂是否算代码（else 臂取反）。

    实测到的四种写法都在这里（`interface/*.c` 全覆盖）：
      `#ifndef CBLAS` → then 臂活；`#ifdef CBLAS` → then 臂死；
      `#if defined(CBLAS)` → 死；`#if !defined(CBLAS) || !defined(CONJ)` → 活（`||` 里那一项为真）。
    条件里**不含 CBLAS** ⇒ 返回 None（调用方按"两臂都算代码"处理 —— 那些是 XDOUBLE/CONJ/
    FUNCTION_PROFILE 之类的**语句级**链，实测无花括号）。
    """
    if "CBLAS" not in cond:
        return None
    if kw == "ifndef":
        return True
    if kw == "ifdef":
        return False
    neg = re.search(r"!\s*defined\s*\(\s*CBLAS\s*\)", cond)
    pos = re.search(r"(?<![!\w])defined\s*\(\s*CBLAS\s*\)", cond)
    if neg:
        return True
    if pos:
        return False
    raise ValueError("不认识的 CBLAS 条件写法：%s" % cond.strip())


def branch_mask(src):
    """返回布尔表：True = 该字符属于**CBLAS 未定义**时编译保留的分支。

    ## 为什么必须做（实测，2026-09-27）

    `interface/*.c` 是**共享函数体**写法：`#ifndef CBLAS` 那条臂开 `{`、`#else` 的 CNAME 臂也开 `{`、
    公共体在 `#endif` 之后共用末尾一个 `}` ⇒ **裸文本"两开一闭"**，花括号永远配不平。
    第一版因此把 73 个文件里的 65 个**静默跳过**（只改到 8 处）—— 那正是本仓禁止的"少数不报"。

    ## 政策（只按 CBLAS 选臂）

    · **CBLAS 那一项**：按上面的四种写法判活/死；
    · **其余条件**（XDOUBLE / CONJ / FUNCTION_PROFILE / RETURN_BY_*…）：**两臂都算代码**
      —— 它们里面是语句级内容（实测），花括号平衡；**但**这会让"同一 `NAME` 的多个返回类型分支"
      （如 `zdot.c` 的 RETURN_BY_STRUCT/STACK/默认三臂）配不平 ⇒ 那种文件**显式排除**并由
      `SKIP_FILES` 记录原因，`--check` 会把它**列出来**（不静默）。
    """
    keep = bytearray(b"\x01" * len(src))
    stack = []                     # 每层 [当前臂是否保留, then 臂是否活, else 臂是否活]
    pos = 0

    def active():
        return all(lv[0] for lv in stack)

    for m in DIRECTIVE_RE.finditer(src):
        if not active():
            for k in range(pos, m.start()):
                keep[k] = 0
        line_end = src.find("\n", m.start())
        line_end = len(src) if line_end < 0 else line_end
        for k in range(m.start(), line_end):
            keep[k] = 0
        pos = line_end
        kw = m.group(1)
        if kw in ("ifdef", "ifndef", "if"):
            outer_ok = active()
            then_ok = _cblas_then_ok(kw, m.group(0))
            if then_ok is None:
                stack.append([outer_ok, True, True])          # 非 CBLAS：两臂都算代码
            else:
                stack.append([outer_ok and then_ok, then_ok, not then_ok])
        elif kw in ("else", "elif"):
            if not stack:
                raise ValueError("孤立的 #%s" % kw)
            lv = stack[-1]
            outer = all(x[0] for x in stack[:-1])
            lv[0] = outer and lv[2]
        elif kw == "endif":
            if not stack:
                raise ValueError("孤立的 #endif")
            stack.pop()
    if stack:
        raise ValueError("预处理条件没配平（#if/#endif 数量不符）")
    if not active():
        for k in range(pos, len(src)):
            keep[k] = 0
    return keep


def full_mask(src):
    """代码掩码 = "不是注释/字符串" ∧ "在当前编译分支里"。"""
    a, b = code_mask(src), branch_mask(src)
    return bytearray(1 if (a[i] and b[i]) else 0 for i in range(len(src)))


def unmatched_file_reasons(src, path="?"):
    """**失败要能说话**：返回该文件里"有 `void NAME(` 却找不到定义"的原因清单。"""
    if os.path.basename(path) in SKIP_FILES:
        return []                              # 显式跳过（原因在 SKIP_FILES 里，--check 会列出来）
    raw = len(RAW_DEF_RE.findall(src))
    try:
        found = len(_defs_with_re(src, DEF_RE, "void")) + len(_defs_with_re(src, INT_RE, "int"))
    except Exception as e:                        # noqa: BLE001
        # 解析器自己看不懂的文件 ⇒ **报出来**（不许崩、更不许当"没问题"）
        return ["%s：解析失败（%s）" % (path, e)]
    if raw == 0:
        return []
    if raw == found:
        return []
    return ["%s：裸文本 %d 处 `void NAME(`，解析出 %d 个定义" % (path, raw, found)]


def _close_paren(src, mask, i):
    """从参数表的 `(` 起，返回它的配对 `)` 的下标（掩码内配对；找不到返回 None）。"""
    depth = 0
    while i < len(src):
        if mask[i]:
            if src[i] == "(":
                depth += 1
            elif src[i] == ")":
                depth -= 1
                if depth == 0:
                    return i
        i += 1
    return None


def _close_brace(src, mask, i):
    """从函数体的 `{` 起，返回它的配对 `}` 的下标（掩码内配对）。"""
    depth = 0
    while i < len(src):
        if mask[i]:
            if src[i] == "{":
                depth += 1
            elif src[i] == "}":
                depth -= 1
                if depth == 0:
                    return i
        i += 1
    return None


def _defs_with_re(src, rx, kw):
    """返回 [(kw_start, kw_end, body_close)]：用 rx 找 `KW NAME(...) {` 的**定义**。

    · `kw_start/kw_end` 是返回类型关键字的**精确跨度**（只换这两个词，缩进/空白一律原样）；
    · 紧跟着 `)` 的**非空白字符不是 `{`** ⇒ 那是原型（`;`）⇒ 跳过 —— 上一轮的第一个失败点；
    · 匹配落在掩码外（注释/字符串里）⇒ 跳过 —— 上一轮的第二个失败点。
    """
    mask = full_mask(src)
    out = []
    for m in rx.finditer(src):
        if not mask[m.start()]:
            continue
        kw_start = m.end(1)                      # group 1 = 缩进 ⇒ 关键字紧跟其后
        kw_end = kw_start + len(kw)
        assert src[kw_start:kw_end] == kw, (src[kw_start:kw_end], kw)
        par_open = src.index("(", kw_end)
        par_close = _close_paren(src, mask, par_open)
        if par_close is None:
            continue
        j = par_close + 1
        while j < len(src) and (not mask[j] or src[j] in " \t\r\n"):
            j += 1
        if j >= len(src) or src[j] != "{":
            continue                             # 原型/声明 ⇒ 不是定义
        body = _close_brace(src, mask, j)
        if body is None:
            continue
        out.append((kw_start, kw_end, body))
    return out


def find_defs(src):
    """待改的 `void NAME(...) { … }` 定义。"""
    return _defs_with_re(src, DEF_RE, "void")


def already(src):
    """已打过补丁的 `int NAME(...) { … }` 定义（--check / --revert 用）。"""
    return _defs_with_re(src, INT_RE, "int")


def patch_text(src):
    """返回 (新文本, [{'orig': 原始返回类型 token}…] 按源码顺序)。"""
    defs = find_defs(src)
    if not defs:
        return src, []
    out, recs = src, []
    pos = sorted(defs, key=lambda d: -d[0])       # 从后往前改 ⇒ 前面的下标不位移
    for kw_start, kw_end, body in pos:
        # ★ 顺序要紧：`void`(4) → `int`(3) **短一字节** ⇒ 先换关键字会让后面的插入点错位一格
        #   （实测：注入块跑到函数体的 `}` **之后**，revert 也就对不上了）。所以
        #   **先在 body 处插注、再换关键字**（关键字在 body 之前，换它只影响它后面的内容，
        #   而那时注入内容已经在位、跟着一起左移一格——位置自洽）。
        out = out[:body] + INJECT + out[body:]
        out = out[:kw_start] + "int" + out[kw_end:]
        recs.append({"orig": src[kw_start:kw_end]})
    recs.reverse()
    return out, recs


def revert_text(src, recs):
    """按记录逐字节还原：先摘注入块，再把 `int` 换回记录的原始 token（从后往前）。"""
    # ⚠️ 必须替换成**空串**：INJECT 自己是 `"\n  <标记>\n  return 0;\n"`，
    #    它整段就是"插在 `}` 之前"的那几个字节 ⇒ 摘干净才是原文（留个 `\n` 会多一空行，
    #    自证第 6/8 条当场抓到）。
    out = src.replace(INJECT, "")
    defs = already(out)
    if len(defs) != len(recs):
        raise SystemExit("revert 失败：文件里有 %d 个 int 定义，记录里 %d 条"
                         % (len(defs), len(recs)))
    for (kw_start, kw_end, _body), r in zip(reversed(defs), reversed(recs)):
        out = out[:kw_start] + r["orig"] + out[kw_end:]
    return out


# ★ 显式排除（**写明原因**，不许静默跳过）：
SKIP_FILES = {
    "zdot.c": "同一 `NAME` 有三种返回类型（RETURN_BY_STRUCT / RETURN_BY_STACK / 默认）"
              "⇒ 哪一臂活取决于 OpenBLAS 的复数返回 ABI，本工具不猜；"
              "它是**函数**类入口（不在子程序 mismatch 那 78 个里）",
    "zdotu.c": "同 zdot.c",
    "zdotc.c": "同 zdot.c",
    "sdsdot.c": "真函数（FLOATRET），无需改",
    "dsdot.c": "真函数（FLOATRET），无需改",
}


def walk(d):
    """**非递归**列 d 下的 .c（`interface/lapack/` 子目录不在范围：`NO_LAPACK=1` 不编它）。"""
    for f in sorted(os.listdir(d)):
        if f.endswith(".c"):
            yield os.path.join(d, f)


def skipped_report(d):
    """返回被显式跳过的文件清单（有原因才算"跳过"，没原因就是漏改）。"""
    out = []
    for f in sorted(os.listdir(d)):
        if f.endswith(".c") and f in SKIP_FILES:
            out.append((f, SKIP_FILES[f]))
    return out


def cmd_check(d):
    ndef = nint = 0
    bad = []
    for p in walk(d):
        src = io.open(p, encoding="utf-8").read()
        try:
            a, b = len(find_defs(src)), len(already(src))
        except Exception as e:                    # noqa: BLE001
            bad.append("%s：解析失败（%s）" % (os.path.basename(p), e))
            continue
        ndef += a
        nint += b
        if a and b:
            print("   ⚠️ %s：同时有 %d 个 void 定义与 %d 个 int 定义（打过一半？）" % (p, a, b))
        bad += unmatched_file_reasons(src, os.path.basename(p))
    if bad:
        # ★ 零值守卫：**少数就是错**（上一版在这里静默跳过 65 个文件，只改到 8 处）
        print("FATAL: 有文件解析不出定义（别往下走）：", file=sys.stderr)
        for b in bad[:10]:
            print("   ✗ %s" % b, file=sys.stderr)
        return 3
    sk = skipped_report(d)
    if sk:
        print("显式跳过 %d 个文件（有原因；不在「待改」计数里）：" % len(sk))
        for f, why in sk:
            print("   · %-16s %s" % (f, why))
    print("待改（void 定义）%d 处；已改（int）%d 处" % (ndef, nint))
    if ndef == 0:
        print("⇒ 树已是「已打补丁」状态（0 处待改）")
    return 0


def cmd_apply(d, force=False):
    # ★ 先整体扫一遍：任何文件解析失败 ⇒ **一处都不改**（半打补丁的树比没打更糟）
    reasons = []
    for p in walk(d):
        reasons += unmatched_file_reasons(io.open(p, encoding="utf-8").read(), os.path.basename(p))
    if reasons:
        print("FATAL: 有文件解析不出（一处都不改）：", file=sys.stderr)
        for r in reasons[:10]:
            print("   ✗ %s" % r, file=sys.stderr)
        return 3
    n = 0
    recs_all = {}
    for p in walk(d):
        if os.path.basename(p) in SKIP_FILES:
            continue
        src = io.open(p, encoding="utf-8").read()
        if already(src):
            continue
        new, recs = patch_text(src)
        if new == src:
            continue
        io.open(p, "w", encoding="utf-8").write(new)
        recs_all[os.path.basename(p)] = recs
        n += len(recs)
        print("   ✅ %-16s 改 %d 处" % (os.path.basename(p), len(recs)))
    side = os.path.join(d, SIDECAR)
    prev = {}
    if os.path.exists(side) and not force:
        prev = json.load(io.open(side, encoding="utf-8"))
    prev.update(recs_all)
    with io.open(side, "w", encoding="utf-8") as fh:
        json.dump(prev, fh, indent=1, ensure_ascii=False, sort_keys=True)
    print("== 共改 %d 处；原始 token 记在 %s（--revert 据此逐字节还原）" % (n, side))
    return 0 if n else 1


def cmd_revert(d):
    side = os.path.join(d, SIDECAR)
    if not os.path.exists(side):
        print("FATAL: 缺 %s（没法逐字节还原）" % side, file=sys.stderr)
        return 2
    recs_all = json.load(io.open(side, encoding="utf-8"))
    n = 0
    for p in walk(d):
        base = os.path.basename(p)
        if base not in recs_all:
            continue
        src = io.open(p, encoding="utf-8").read()
        out = revert_text(src, recs_all[base])
        if out != src:
            io.open(p, "w", encoding="utf-8").write(out)
            n += 1
            print("   ↩ %-16s 还原" % base)
    os.unlink(side)
    print("== 还原 %d 个文件（sidecar 已删）" % n)
    return 0


# ── 自证（九条：改对 / 三类"不许动" / 两个失败点 / 幂等 / 逐字节还原 / 零值守卫）──────
_S1 = '''#include "common.h"
#ifndef CBLAS
void NAME(blasint *N, FLOAT *x, blasint *INCX){
  if (*N <= 0) return;
  BLASLONG n = *N;
  printf("%s", "} 字符串里的花括号 { 不许骗配对");
  /* 注释里的 } 也不许骗配对 { */
  for (i = 0; i < n; i++) { y[i] += x[i]; }
}
#else
void CNAME(blasint n, FLOAT *x, blasint incx){
  return;
}
#endif
'''

_S2 = '''/* 原型在前、定义在后（上一轮的第一个失败点） */
void NAME(blasint *N, FLOAT *x);
void OTHER(void){ }
void NAME(blasint *N, FLOAT *x){
  x[0] = 1;
}
'''

_S3 = '''FLOATRET NAME(blasint *N, FLOAT *x, blasint *INCX){
  FLOATRET r = 0.0;
  return r;
}
'''

_S4 = '''void           NAME(blasint *N, FLOAT *x){
  *x = 0;
}
'''


_S5 = '''#include "common.h"
#ifndef CBLAS

void NAME(blasint *N, FLOAT *ALPHA, FLOAT *x)
{

#else

void CNAME(blasint n, FLOAT alpha, FLOAT *x)
{

#endif

  if (*N <= 0) return;
  x[0] += *ALPHA;
  return;
}
'''

_S6 = '''#ifndef CBLAS
void NAME(blasint *N, FLOAT *x)
{
  x[0] = 1;
#endif
'''

_S7 = '''#ifndef CBLAS
void NAME(blasint *N, FLOAT *x)
{
  x[0] = 1;
}
/* 条件没配平（没有 #endif）⇒ 解析失败也要报出来，不许崩 */
'''


def selftest():
    cases = []

    def _p(src):
        new, recs = patch_text(src)
        return new, recs

    def _patched_ok(src):
        """用**解析器自己**判定：改完不应再有待改定义；注入块必须落在函数体内部。"""
        new, recs = _p(src)
        if find_defs(new) or len(already(new)) != 1 or len(recs) != 1:
            return False
        _ks, _ke, body = already(new)[0]
        return MARK in new[:body]

    cases += [
        ("真定义被改成 int 且补了 return 0;", lambda: _patched_ok(_S1)),
        ("★ **原型不许动**（`void NAME(...);` ⇒ 原样）",
         lambda: _p(_S2)[0].count("void NAME(blasint *N, FLOAT *x);") == 1),
        ("★ 注释/字符串里的花括号不骗配对（改后的 return 0; 落在**函数体**里）",
         lambda: "y[i] += x[i];" in _p(_S1)[0]
         and _p(_S1)[0].index("return 0;") > _p(_S1)[0].index("y[i] += x[i];")),
        ("★ CBLAS 那半边（CNAME）**一个字不动**",
         lambda: _p(_S1)[0].count("void CNAME(") == 1),
        ("★ 真函数（FLOATRET）**一个字不动**", lambda: _p(_S3)[0] == _S3),
        ("★ 多余空白的写法（`void   NAME(`）也能改，且还原**逐字节**",
         lambda: "int" + _S4[_S4.index("void") + 4:_S4.index("NAME(")] + "NAME(" in _p(_S4)[0]
         and revert_text(_p(_S4)[0], _p(_S4)[1]) == _S4),
        ("★ 幂等：连打两次，结果逐字节相同（`int NAME(` 不重复改、`return 0;` 不重复注入）",
         lambda: (lambda first: patch_text(first[0])[0] == first[0])(_p(_S1))),
        ("★ `--revert` 逐字节还原（单文件）", lambda: revert_text(_p(_S1)[0], _p(_S1)[1]) == _S1),
        ("★ **零值守卫**：没有可改之处 ⇒ 报 0 处（不许静默当成功）",
         lambda: _p(_S3)[1] == []),
        # ★ 真结构（interface/*.c 的共享函数体写法）：丢 CNAME 臂后必须正好找到 1 个定义
        ("★ 共享体写法（`#ifndef CBLAS` 臂开 `{`、`#else` 臂也开 `{`、公共体共用 `}`）"
         "⇒ 正好 1 个定义、改的是 NAME 那半边、CNAME 一个字不动，且逐字节可还原",
         lambda: (len(_p(_S5)[1]) == 1
                  and _p(_S5)[0].count("void CNAME(") == 1
                  and "int NAME(" in _p(_S5)[0]
                  and revert_text(_p(_S5)[0], _p(_S5)[1]) == _S5)),
        ("★ 配不平的文件**必须报出来**（少数即错，不许静默跳过）",
         lambda: bool(unmatched_file_reasons(_S6, "bad.c"))),
        ("★ 正常文件不报", lambda: unmatched_file_reasons(_S1, "ok.c") == []),
        ("★ 条件不配平的文件**报出来**（工具自己不许崩）",
         lambda: bool(unmatched_file_reasons(_S7, "broken.c"))),
    ]
    bad = 0
    for name, fn in cases:
        try:
            ok = bool(fn())
        except Exception as e:                    # noqa: BLE001
            ok, name = False, "%s（异常 %r）" % (name, e)
        print("%s | %s" % ("PASS" if ok else "fail", name))
        bad += 0 if ok else 1
    print("=== patch-openblas-f77-ret 自证：%d PASS / %d fail ===" % (len(cases) - bad, bad))
    return 1 if bad else 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if len(argv) < 2:
        print(__doc__.strip().split("用法（容器内")[-1].strip(), file=sys.stderr)
        return 2
    mode, d = argv[0], argv[1]
    if not os.path.isdir(d):
        print("FATAL: %s 不是目录" % d, file=sys.stderr)
        return 2
    if mode == "--check":
        return cmd_check(d)
    if mode == "--apply":
        return cmd_apply(d, force="--force" in argv)
    if mode == "--revert":
        return cmd_revert(d)
    print("未知模式 %s" % mode, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
