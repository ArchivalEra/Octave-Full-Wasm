#!/usr/bin/env python3
# Octave-Full-Wasm — **E2：f2c 约定的 F77 薄包装生成器**（2026-09-27，branch `e2-openblas`）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

"""从链接器的 `function signature mismatch` 报文生成 F77 薄包装（把 OpenBLAS 接回既有 ABI）。

## 背景（实测，见 `NOTES-threads.md` 的 E2 节）

E2 把**线程版 OpenBLAS** 链进主模块。它的 Fortran 入口被改名成 `ob_*`
（`patch-openblas-symbol-prefix.py`），因为 OpenBLAS 的 C 接口层与我们的 f2c/Fortran 调用方
**返回约定不同**。**78 条 mismatch 实测只有五种形状**，而且全部满足"一侧参数表是另一侧的前缀"
（差额全是**拖尾 i32**：隐藏字符长度 / 结果指针）：

| # | 调用方（f2c LAPACK / qrupdate / Octave） | OpenBLAS | 规则 | 例（条数） |
|---|---|---|---|---|
| ① | `(n×i32) -> i32` | `(m×i32) -> void` | 转发前 m 个 + `return 0;` | `dgemm_`、`dswap_`（70） |
| ② | `(n×i32) -> f64` | `(n×i32) -> f32` | 转发 + 返回值**加宽** `(double)` | `sdot_`、`snrm2_`（6；f2c 里单精度函数返回 `doublereal`） |
| ③ | `(n×i32) -> i32` | `(m×i32) -> i32`（m<n） | 转发前 m 个 + 透传返回 | `lsame_`（调用方多传两个隐藏长度） |
| ④ | `(n×i32) -> f64` | `(m×i32) -> void`（m=n+1） | **sret**：给 `double[2]` 当结果区，返回 `r[0]` | `zdotu_`（复数返回，见下） |

**④ 为什么返回 `r[0]`**：当前车道里 `zdotu_` 由 gfortran/flang 编的 refblas 提供，链接器报文显示
调用方拿到的就是 `-> f64`（wasm32 下复数返回被压成一个 double）⇒ 包装返回实部**复现现状**；
要真正拿虚部得连调用方一起改（另一件事，别混进来）。

形状不在表里 ⇒ **拒绝生成**（fail-closed）；"前缀性质"被破坏同样拒绝 —— 那说明我理解的根因
覆盖不了它，别拿"全是 `void*`"的包装去硬压（会**静默算错**）。

## 用法

    python3 gen-f77-wrappers.py --from-log <链接日志> --out <wrappers.c>
    python3 gen-f77-wrappers.py --selftest
"""
import io
import re
import sys

# ★ 逐符号特例（**都必须写明原因**，且必须真的出现在日志里 —— 否则是过期名单 ⇒ 报错）：
#   `PASSTHROUGH`：按 **OpenBLAS 自己的签名**做透传包装（声明与它一致、原样转发）。
PASSTHROUGH = {
    "zdotu_": "两个调用方的约定互斥：lane 的 LAPACK 按 `(6 参) -> void`（sret）调它，"
              "qrupdate 的 `zgqvec.o` 按 `(5 参) -> f64` 调它，而 **OpenBLAS 原生是 `(6, void)`**"
              "（与 lane LAPACK 一致）。⇒ 按 OpenBLAS 的签名做**透传**包装：定义成 `(6, void)`，"
              "复现车道现状。qrupdate 那条 mismatch **是既有的**（实测：`llvm-nm` 里 qrupdate 的"
              "`zdotu_` 是 `U`（未定义引用）、车道 refblas 的定义是 `(6, void)`；拿 6 参 void 写法去"
              "链车道 refblas **0** 条 mismatch、5 参 f64 写法 **1** 条）⇒ 与 E2 换库无关，别在这里修。",
}

MISMATCH_RE = re.compile(
    r"function signature mismatch:\s*(\S+)\s*\n"
    r"\s*>>>\s*defined as\s*\(([^)]*)\)\s*->\s*(\S+)\s+in\s+(\S+)\s*\n"
    r"\s*>>>\s*defined as\s*\(([^)]*)\)\s*->\s*(\S+)\s+in\s+(\S+)")

HEAD = """/* 自动生成，别手改（生成器：build/113/gen-f77-wrappers.py；规则表见该文件头注）
 *
 * E2：线程版 OpenBLAS 的 Fortran 入口被改名成 `ob_*` 且返回约定与我们的 f2c/Fortran 调用方
 * 不同，这里按**链接器量到的签名**把它接回既有 ABI。四种形状（实测 78 条的分布）：
 *   ① 调用方 i32 ↔ OpenBLAS void      ⇒ 转发 + return 0;        （子程序，70 条）
 *   ② 调用方 f64 ↔ OpenBLAS f32       ⇒ 加宽 (double)           （单精度函数，6 条）
 *   ③ 调用方 i32 ↔ OpenBLAS i32（参数更少）⇒ 转发前 m 个、返回透传 （lsame_）
 *   ④ 调用方 f64 ↔ OpenBLAS void      ⇒ sret 结果区、返回实部 r[0]（zdotu_）
 *
 * 参数一律 `void*`（f2c 的 Fortran ABI 下每个参数都是指针，wasm32 里就是 i32）；
 * OpenBLAS 要的拖尾隐藏长度补 `(void*)1`。**形状不在表里生成器会直接报错**，不会静默拼一个。
 */
"""


def parse_log(text):
    """返回 [(sym, caller_args, caller_ret, ob_args, ob_ret)]（按出现顺序去重）。"""
    out, seen = [], set()
    for m in MISMATCH_RE.finditer(text):
        sym, a1, r1, loc1, a2, r2, loc2 = m.groups()
        t1 = [x.strip() for x in a1.split(",") if x.strip()]
        t2 = [x.strip() for x in a2.split(",") if x.strip()]
        # 认哪一侧是 OpenBLAS：看**定义所在的库路径**（harvest 时那份叫 librefblas.a）
        ob1 = "openblas" in loc1.lower() or "refblas" in loc1.lower()
        ob2 = "openblas" in loc2.lower() or "refblas" in loc2.lower()
        if ob1 == ob2:
            raise SystemExit("FATAL: %s 认不出哪一侧是 OpenBLAS（%s ｜ %s）" % (sym, loc1, loc2))
        # ob2 = 第 2 侧是 OpenBLAS ⇒ 那第 1 侧就是调用方
        ca, cr = (t1, r1) if ob2 else (t2, r2)
        oa, orr = (t2, r2) if ob2 else (t1, r1)
        if sym in seen:
            continue
        seen.add(sym)
        out.append((sym, ca, cr, oa, orr))
    return out


def render(pairs, exclude=None):
    """返回 (C 源码, 各规则命中数)。形状不认识就抛 SystemExit。`exclude` 可注入（自证用）。"""
    special = PASSTHROUGH if exclude is None else exclude
    seen_syms = {p[0] for p in pairs}
    stale = [k for k in special if k not in seen_syms]
    if stale:
        raise SystemExit("FATAL: 特例名单里有日志里不存在的符号 %s ⇒ 名单过期了，别当没看见"
                         % ", ".join(stale))
    lines = [HEAD]
    if special:
        lines.append("/* 逐符号特例（原因见 build/113/gen-f77-wrappers.py 的 PASSTHROUGH）：")
        for k, why in sorted(special.items()):
            lines.append(" *   %s —— %s" % (k, why))
        lines.append(" */")
    stats = {"1": 0, "2": 0, "3": 0, "4": 0}
    for sym, ca, cr, oa, orr in pairs:
        k = min(len(ca), len(oa))
        if ca[:k] != oa[:k]:
            raise SystemExit("FATAL: %s 两侧参数表不是前缀关系（(%s) vs (%s)）⇒ 拒绝生成"
                             % (sym, ",".join(ca), ",".join(oa)))
        n, m = len(ca), len(oa)
        names = ["a%d" % (i + 1) for i in range(k)]
        # 实测：差额只有两种方向 —— ①调用方**多**（隐藏字符长度，丢尾巴）②规则④里 OpenBLAS
        # 多一个（sret 结果指针，由模板补）。其它方向没见过 ⇒ 拒绝（别自己发明补参）。
        if m > n and not (cr == "f64" and orr == "void" and m == n + 1):
            raise SystemExit("FATAL: %s OpenBLAS 比调用方多 %d 个参数，且不是规则④的 sret ⇒ 拒绝生成"
                             % (sym, m - n))
        call_args = ", ".join(names)
        wargs = ", ".join("void *a%d" % (i + 1) for i in range(n))
        odecl = ", ".join(["void*"] * m)
        if sym in special:
            # 透传：声明与 OpenBLAS 一致、原样转发（不碰返回约定）
            wrapper_ret = "void" if orr == "void" else ("double" if orr == "f64" else "int")
            # ⚠️ 包装的**参数表**与**调用实参**要用**参数名**；`odecl`（类型表）只给 extern 用。
            #    （第一版把 odecl 也用在了这两处 ⇒ 生成 `void f_(void*, void*) { g_(void*, void*); }`
            #     这种根本编不过的代码；自证当场抓到。）
            par = ", ".join("void *a%d" % (i + 1) for i in range(m))
            call = ", ".join("a%d" % (i + 1) for i in range(m))
            body = ("extern %s ob_%s(%s);\n"
                    "%s %s(%s) { ob_%s(%s); }" % (wrapper_ret, sym, odecl,
                                                  wrapper_ret, sym, par, sym, call))
            lines.append(body)
            lines.append("")
            continue
        if cr == "i32" and orr == "void":
            body = ("extern void ob_%s(%s);\n"
                    "int %s(%s) { ob_%s(%s); return 0; }" % (sym, odecl, sym, wargs, sym, call_args))
            stats["1"] += 1
        elif cr == "f64" and orr == "f32":
            body = ("extern float ob_%s(%s);\n"
                    "double %s(%s) { return (double)ob_%s(%s); }"
                    % (sym, odecl, sym, wargs, sym, call_args))
            stats["2"] += 1
        elif cr == "i32" and orr == "i32":
            body = ("extern int ob_%s(%s);\n"
                    "int %s(%s) { return ob_%s(%s); }" % (sym, odecl, sym, wargs, sym, call_args))
            stats["3"] += 1
        elif cr == "f64" and orr == "void":
            # sret：OpenBLAS 把结果写到**第一个参数**指向的地方；调用方期望一个 double 返回 ⇒
            # 给一块 double[2] 当结果区、返回实部（理由见文件头注 ④）。
            body = ("extern void ob_%s(%s);\n"
                    "double %s(%s) { double r[2]; ob_%s(r, %s); return r[0]; }"
                    % (sym, odecl, sym, wargs, sym, call_args))
            stats["4"] += 1
        else:
            raise SystemExit("FATAL: %s 的返回约定不在规则表里（调用方 %s / OpenBLAS %s）⇒ 拒绝生成"
                             % (sym, cr, orr))
        lines.append(body)
        lines.append("")
    return "\n".join(lines), stats


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if "--from-log" not in argv or "--out" not in argv:
        print(__doc__.strip().split("用法")[-1].strip(), file=sys.stderr)
        return 2
    text = io.open(argv[argv.index("--from-log") + 1], encoding="utf-8",
                   errors="replace").read()
    pairs = parse_log(text)
    if not pairs:
        # 零值守卫：一条都没解析到 ⇒ **别写空文件**（"少包装"会让链接继续报错，却有产物）
        print("FATAL: 日志里一条 signature mismatch 都没解析到（日志给错了？）", file=sys.stderr)
        return 3
    emitted = len(pairs)
    src, stats = render(pairs)
    out = argv[argv.index("--out") + 1]
    io.open(out, "w", encoding="utf-8").write(src)
    print("已写出 %s：%d 个包装（①%d ②%d ③%d ④%d + 透传特例 %d：%s）"
          % (out, emitted, stats["1"], stats["2"], stats["3"], stats["4"],
             len(PASSTHROUGH), ", ".join(sorted(PASSTHROUGH))))
    return 0


# ── 自证（七条：四种形状各一条 + 统计 + 前缀性质破坏必须拒 + 形状不在表里必须拒）──────
_L = """wasm-ld: warning: function signature mismatch: dgemm_
>>> defined as (i32,i32,i32,i32,i32) -> i32   in /x/liblapack.a(a.o)
>>> defined as (i32,i32,i32,i32,i32) -> void  in /y/librefblas.a(dgemm.o)
wasm-ld: warning: function signature mismatch: sdot_
>>> defined as (i32,i32,i32,i32,i32) -> f64   in /x/liblapack.a(b.o)
>>> defined as (i32,i32,i32,i32,i32) -> f32   in /y/librefblas.a(sdot.o)
wasm-ld: warning: function signature mismatch: lsame_
>>> defined as (i32,i32,i32,i32) -> i32   in /x/liblapack.a(c.o)
>>> defined as (i32,i32) -> i32   in /y/librefblas.a(lsame.o)
wasm-ld: warning: function signature mismatch: zdotu_
>>> defined as (i32,i32,i32,i32,i32) -> f64   in /x/libqrupdate.a(d.o)
>>> defined as (i32,i32,i32,i32,i32,i32) -> void  in /y/librefblas.a(zdotu.o)
wasm-ld: warning: function signature mismatch: zdotc_
>>> defined as (i32,i32,i32,i32,i32) -> f64   in /x/libqrupdate.a(d2.o)
>>> defined as (i32,i32,i32,i32,i32,i32) -> void  in /y/librefblas.a(zdotc.o)
wasm-ld: warning: function signature mismatch: ztrsv_
>>> defined as (i32,i32,i32,i32,i32,i32,i32,i32,i32,i32,i32) -> i32   in /x/liblapack.a(e.o)
>>> defined as (i32,i32,i32,i32,i32,i32,i32,i32) -> void  in /y/librefblas.a(ztrsv.o)
"""


def selftest():
    src, stats = render(parse_log(_L), exclude={})          # 形状测试不看特例名单
    src2, _st2 = render(parse_log(_L))
    cases = [
        ("① 子程序：转发 + `return 0;`",
         lambda: "int dgemm_(void *a1, void *a2, void *a3, void *a4, void *a5) "
                 "{ ob_dgemm_(a1, a2, a3, a4, a5); return 0; }" in src),
        ("② 单精度函数：加宽 `(double)`",
         lambda: "double sdot_(void *a1, void *a2, void *a3, void *a4, void *a5) "
                 "{ return (double)ob_sdot_(a1, a2, a3, a4, a5); }" in src),
        ("③ `lsame_`：调用方 4 参 / OpenBLAS 2 参 ⇒ 只转发前 2 个、返回透传",
         lambda: "int lsame_(void *a1, void *a2, void *a3, void *a4) { return ob_lsame_(a1, a2); }" in src),
        ("④ `zdotc_`：sret（补结果区、返回实部）",
         lambda: "double zdotc_(void *a1, void *a2, void *a3, void *a4, void *a5) "
                 "{ double r[2]; ob_zdotc_(r, a1, a2, a3, a4, a5); return r[0]; }" in src),
        ("★ 调用方多出的**隐藏长度被丢掉**（11 参 → 转发前 8 个）",
         lambda: "int ztrsv_(void *a1, void *a2, void *a3, void *a4, void *a5, void *a6, void *a7, "
                 "void *a8, void *a9, void *a10, void *a11) "
                 "{ ob_ztrsv_(a1, a2, a3, a4, a5, a6, a7, a8); return 0; }" in src),
        ("统计：①2（dgemm_+ztrsv_）②1 ③1 ④2（zdotu_+zdotc_，不含特例时）",
         lambda: stats == {"1": 2, "2": 1, "3": 1, "4": 2}),
        ("★ **OpenBLAS 比调用方多参数、又不是规则④的 sret ⇒ 必须拒**（别自己发明补参）",
         lambda: _raises(lambda: render(parse_log(
             _L.replace(">>> defined as (i32,i32,i32,i32) -> i32   in /x/liblapack.a(c.o)",
                        ">>> defined as (i32,i32) -> i32   in /x/liblapack.a(c.o)").replace(
                 ">>> defined as (i32,i32) -> i32   in /y/librefblas.a(lsame.o)",
                 ">>> defined as (i32,i32,i32,i32) -> i32   in /y/librefblas.a(lsame.o)"))))),
        ("★ 特例符号按 **OpenBLAS 的签名**透传（`zdotu_`：`(6,void)` 原样转发）",
         lambda: "void zdotu_(void *a1, void *a2, void *a3, void *a4, void *a5, void *a6) "
                 "{ ob_zdotu_(a1, a2, a3, a4, a5, a6); }" in src2),
        ("★ 特例的**原因写进生成物头部**", lambda: "两个调用方的约定互斥" in src2[:src2.index("extern")]),
        ("★ **特例名单过期（符号不在日志里）⇒ 必须拒**",
         lambda: _raises(lambda: render(parse_log(_L.replace("zdotu_", "zzz_")), exclude={"zdotu_": "x"}))),
        ("★ **前缀性质被破坏 ⇒ 必须拒**（别静默拼一个）",
         lambda: _raises(lambda: render(parse_log(_L.replace(
             ">>> defined as (i32,i32) -> i32   in /y/librefblas.a(lsame.o)",
             ">>> defined as (i32,f64) -> i32   in /y/librefblas.a(lsame.o)"))))),
    ]
    bad = 0
    for name, fn in cases:
        try:
            ok = bool(fn())
        except Exception as e:                    # noqa: BLE001
            ok, name = False, "%s（异常 %r）" % (name, e)
        print("%s | %s" % ("PASS" if ok else "fail", name))
        bad += 0 if ok else 1
    print("=== gen-f77-wrappers 自证：%d PASS / %d fail ===" % (len(cases) - bad, bad))
    return 1 if bad else 0


def _raises(fn):
    try:
        fn()
    except SystemExit:
        return True
    return False


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
