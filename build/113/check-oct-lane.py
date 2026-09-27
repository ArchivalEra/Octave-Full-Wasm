#!/usr/bin/env python3
# Octave-Full-Wasm — **`.oct` 车道的判据**：side module 有没有 TLS 初始化入口（B6，2026-09-27）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

"""检查 `.oct`（wasm **side module**）能不能在线程档（shared-memory 主模块）里 dlopen。

## 为什么不能沿用"扫 `atomics` 特征"

`atomics_scan.py` 的判据对**归档/对象**成立（`wasm-ld` 就是按对象的特征段拒的），但对**链接后的
wasm 模块**不成立：`.oct` 是 side module，**不带 `target_features` 段** ⇒ 用"有没有 atomics 字符串"
去判会把**全部 44 个**（包括正确编出来的）都判成"缺 atomics"（实测踩到）。

## 正确的判据（来自 B5 实验的失败原文）

`NOTES-threads.md` 的 B5 三档对照：非线程档编的 side module 载入 shared-memory 主模块时报

    TypeError: tlsInitFunc is not a function

—— 加载器要调 side module 的 **TLS 初始化入口**。所以判据是：**每个 `.oct` 都必须含
`_emscripten_tls_init`**（`-pthread` 编出来的才有）。

## 反向断言（这条判据必须能证明自己会红）

同一批检查**基础档**的 `.oct`（`assets/oct/`、`assets/octdir/`）：它们**不该**有那个入口
（否则说明"有/没有"这个信号与档无关，判据无判别力）。

用法：
  python3 build/113/check-oct-lane.py <线程档 .oct 目录或文件…> --base <基础档目录>…
      [--main-wasm <线程档主模块> --main-glue <线程档胶水>]
  python3 build/113/check-oct-lane.py --selftest
退出码：0 = 三条判据都过（或 ③ 没做的场景）；1 = 有违反；2 = 用法错。
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wasm_symbols import imports as wasm_imports, exports as wasm_exports   # noqa: E402

MARK = b"_emscripten_tls_init"

# ── 判据②：`.oct` 不许引用**两档主模块都不提供**的符号（2026-09-27 实测事故）────────────
# 现场：`accept-dldfcn` 的 `audiowrite` 崩在 `TypeError: resolved is not a function`（基础档
# 同套件 71/0 绿）。三段实测锁定机制（容器里可复跑，源见 build-oct-lane.sh 第⑧条）：
#   · `em++ -O2 -c`（带**动态** static 初始化）⇒ 目标文件里 `__cxa_guard` 出现 **0** 次
#     —— emcc 默认就是 `-fno-threadsafe-statics`（所以基础档 `.oct` 不引用它）；
#   · 加 `-pthread` ⇒ **3** 次（clang 改回线程安全静态）；
#   · 再加 `-fno-threadsafe-statics` ⇒ 回到 **0** 次。
#   而两档**主模块都不定义**这两个符号（`llvm-nm --defined-only --extern-only` 在基础/线程两份
#   `octave.wasm` 里都没有）⇒ 动态加载器把它解析成 undefined ⇒ 第一次动态静态初始化就崩。
# ⇒ 车道 `.oct` 配方必须带 `-fno-threadsafe-statics`；本条是它的**产物侧**判据（配方是"应该"，
#   产物才是"是"）。判据对**两档都查**：基础档若哪天出现，同样会在基础档主模块上崩。
UNPROVIDED = (b"__cxa_guard_acquire", b"__cxa_guard_release")


def has_tls_init(path):
    with open(path, "rb") as fh:
        return MARK in fh.read()


def unprovided_refs(path):
    with open(path, "rb") as fh:
        b = fh.read()
    return [m.decode() for m in UNPROVIDED if m in b]


def octs_in(dirs):
    out = []
    for d in dirs:
        if os.path.isfile(d) and d.endswith(".oct"):
            out.append(d)
        elif os.path.isdir(d):
            for r, _x, fs in os.walk(d):
                out += [os.path.join(r, f) for f in fs if f.endswith(".oct")]
    return sorted(out)


def _twin(path, base_set):
    """车道 `.oct` → 基础档**同模块**（目录名 oct-threads→oct、octdir-threads→octdir）。"""
    cand = path.replace("/oct-threads/", "/oct/", 1).replace("/octdir-threads/", "/octdir/", 1)
    return cand if cand in base_set else None


def check(lane, base, main_wasm=None, main_glue=None):
    """返回 (problems, notes)。"""
    problems, notes = [], []
    if not lane:
        problems.append("线程档一个 `.oct` 都没给 ⇒ 判据空转")
    if base is None:
        notes.append("⚠️ 本次**没做反向断言**（没给基础档）—— 容器侧只能做正向；"
                     "宿主侧的 stage-lane-assets.sh 会连基础档一起查")
    elif not base:
        problems.append("基础档一个 `.oct` 都没给 ⇒ **反向断言没法做**（判据可能是恒真）")
    n_ok = 0
    for p in lane:
        if has_tls_init(p):
            n_ok += 1
        else:
            problems.append("线程档缺 TLS 入口（在线程档里 dlopen 会 `tlsInitFunc is not a function`）：%s" % p)
    bad_base = [p for p in (base or []) if has_tls_init(p)]
    if bad_base:
        # 反向断言：基础档**不该**有入口。真出现了 ⇒ 说明这个信号与"哪一档"无关 ⇒ 判据无判别力
        problems.append("基础档里出现了 TLS 入口（判据失去判别力，先查清楚）：%s"
                        % ", ".join(os.path.basename(x) for x in bad_base[:3]))
    # ② 两档都不许引用主模块提供不了的符号（`__cxa_guard_*`）
    n_guard = 0
    for p in lane + (base or []):
        ms = unprovided_refs(p)
        if ms:
            problems.append("引用了**两档主模块都不提供**的 %s ⇒ 第一次动态静态初始化会"
                            "`TypeError: resolved is not a function`：%s"
                            % ("/".join(ms), os.path.basename(p)))
        else:
            n_guard += 1
    notes.append("两档 %d 个 `.oct` 都没引用 %s（判据②）"
                 % (n_guard, "/".join(m.decode() for m in UNPROVIDED)))
    # ③ **成对核对**：车道模块相对基础档**多出的**导入，必须能被线程档主模块（导出 ∪ 胶水）解析。
    #    真事故（2026-09-27，accept-forge2 的 `step`）：slicot 模块没链 `common.oct.o` ⇒ 比
    #    基础档多导入 `_Z3maxii`/`error_msg` 等 8 个，而主模块两档都不导出它们 ⇒ 首次调用崩。
    #    ⚠️ 只盯"多出的"：基础档本来就有的导入（如 `blas_*_x__` 这类**弱**符号）两档一样，
    #       不归这条管（弱导入解析成 null，没被调用就不崩 —— 基础档同款 50 个，照样 25/25）。
    if main_wasm is None or main_glue is None:
        notes.append("⚠️ 判据③**没做**（没给 --main-wasm/--main-glue）—— 容器侧没有站点产物；"
                     "宿主侧的 stage-lane-assets.sh 会带上")
    elif not os.path.isfile(main_wasm) or not os.path.isfile(main_glue):
        problems.append("判据③的输入不全：主模块/胶水至少一个不存在（%s / %s）⇒ 不许静默当通过"
                        % (main_wasm, main_glue))
    else:
        main_exp = set(wasm_exports(main_wasm))
        glue = open(main_glue, encoding="utf-8", errors="replace").read()
        base_set = set(base or [])
        if not main_exp:
            problems.append("主模块导出 0 个函数 ⇒ 判据③空转（输入给错了？：%s）" % main_wasm)
        npair = nclean = 0
        for lp in lane:
            bp = _twin(lp, base_set)
            if bp is None:
                continue
            npair += 1
            li = {n for m, n in wasm_imports(lp) if m == "env"}
            bi = {n for m, n in wasm_imports(bp) if m == "env"}
            unres = []
            for n in sorted(li - bi):
                if n in main_exp:
                    continue
                if re.search(r"(?<![A-Za-z0-9_])%s(?![A-Za-z0-9_])" % re.escape(n), glue):
                    continue
                unres.append(n)
            if unres:
                problems.append("相对基础档多出的导入里 %d 个**主模块/胶水都给不了**（%s…）⇒ 首次调用"
                                "TypeError: resolved is not a function：%s"
                                % (len(unres), unres[0], os.path.basename(lp)))
            else:
                nclean += 1
        if npair == 0:
            notes.append("⚠️ 判据③一对都没配上（目录结构没对上）⇒ 实际**没查**")
        else:
            notes.append("判据③：成对核对 %d 个模块，%d 个的「多出导入」全部可在主模块解析"
                         % (npair, nclean))
    notes.append("线程档 %d/%d 有 TLS 入口；基础档 %d 个**都没有**（反向断言成立）"
                 % (n_ok, len(lane), len(base) if base is not None else 0)
                 if (base and not bad_base) else
                 "线程档 %d/%d 有 TLS 入口（基础档那侧见上面的问题行）" % (n_ok, len(lane)))
    return problems, notes


def main(argv):
    if "--selftest" in argv:
        return selftest()
    base, lane = None, []
    main_wasm = main_glue = None
    cur = lane
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--base":
            base = []
            cur = base
        elif a == "--main-wasm":
            i += 1
            main_wasm = argv[i]
        elif a == "--main-glue":
            i += 1
            main_glue = argv[i]
        else:
            cur.append(a)
        i += 1
    if not lane:
        print(__doc__.strip().split("用法：")[-1].strip(), file=sys.stderr)
        return 2
    problems, notes = check(octs_in(lane), None if base is None else octs_in(base),
                            main_wasm, main_glue)
    for n in notes:
        print("   · %s" % n)
    for p in problems:
        print("   ✗ %s" % p, file=sys.stderr)
    return 1 if problems else 0


# ── 自证（三类：该过 / 该红 / 反向断言该红）────────────────────────────────────
def _mk(d, name, body):
    p = os.path.join(d, name)
    with open(p, "wb") as fh:
        fh.write(b"\0asm\x01\0\0\0" + body)
    return p


def selftest():
    import shutil
    import tempfile
    d = tempfile.mkdtemp()
    cases = []
    try:
        lane_ok = _mk(d, "lane_ok.oct", b"...__emscripten_tls_init...")
        lane_bad = _mk(d, "lane_bad.oct", b"...nothing...")
        base_ok = _mk(d, "base_ok.oct", b"...nothing...")
        base_bad = _mk(d, "base_bad.oct", b"...__emscripten_tls_init...")
        lane_guard = _mk(d, "lane_guard.oct",
                         b"...__emscripten_tls_init...__cxa_guard_acquire...")
        base_guard = _mk(d, "base_guard.oct", b"...__cxa_guard_release...")
        # ── 判据③ 的夹具：合成 wasm（真 import/export 段）+ 主模块导出 + 胶水 ──
        import wasm_symbols as W
        def _wasm(name, imp=(), exp=(), tls=True):
            """合成模块：**真**的 import/export 段；TLS 标记**追加在文件尾**
            （不能插在 header 与段之间 —— 那会把段 id 挤位，判据读到的就不是真段了）。"""
            body = W.make_wasm(imp, exp) + (b"...__emscripten_tls_init..." if tls else b"")
            p = os.path.join(d, name)
            with open(p, "wb") as fh:
                fh.write(body)
            return p
        for sub in ("oct-threads", "oct", "octdir-threads/statistics", "octdir/statistics"):
            os.makedirs(os.path.join(d, sub), exist_ok=True)
        main_w = _wasm("main.wasm", exp=("pthread_self", "emscripten_builtin_memalign"))
        with open(os.path.join(d, "main.js"), "w", encoding="utf-8") as fh:
            fh.write("var wasmImports={foo:function(){}};")      # 胶水提供 `foo`
        # 成对模块①：车道多出的 3 个（pthread_self=主模块导出、foo=胶水、共有的 dgemm_）
        _wasm("oct-threads/pair.oct", imp=("dgemm_", "pthread_self", "foo"))
        _wasm("oct/pair.oct", imp=("dgemm_",), tls=False)          # 基础档**没有** TLS 入口
        # 成对模块②：车道多出一个**谁都给不了**的（真事故形状）
        _wasm("octdir-threads/statistics/bad.oct", imp=("dgemm_", "who_is_this"))
        _wasm("octdir/statistics/bad.oct", imp=("dgemm_",), tls=False)
        # ⚠️ 传给 check() 的必须是**文件列表**（与 main() 里的 octs_in() 一致）——
        #    第一版这里传了目录 ⇒ IsADirectoryError（自证当场抓到）
        PAIR = [os.path.join(d, "oct-threads", "pair.oct")]
        PAIR_BASE = octs_in([os.path.join(d, "oct")])
        LANE3 = [os.path.join(d, "oct-threads", "pair.oct"),
                 os.path.join(d, "octdir-threads", "statistics", "bad.oct")]
        BASE3 = octs_in([os.path.join(d, "oct"), os.path.join(d, "octdir")])
        cases = [
            ("线程档有入口 + 基础档没有 ⇒ 全过",
             lambda: check([lane_ok], [base_ok])[0] == []),
            ("★ 线程档**缺**入口 ⇒ 必须报", lambda: bool(check([lane_bad], [base_ok])[0])),
            ("★ 基础档**有**入口 ⇒ 必须报（反向断言：判据可能无判别力）",
             lambda: bool(check([lane_ok], [base_bad])[0])),
            # ★ 判据②：本轮真事故（audiowrite 的 `resolved is not a function`）的产物侧形状
            ("★ 引用 `__cxa_guard_acquire` ⇒ 必须报（两档主模块都不提供它）",
             lambda: bool(check([lane_guard], [base_ok])[0])),
            ("★ 基础档引用它也一样报（同一条判据两档共用）",
             lambda: bool(check([lane_ok], [base_guard])[0])),
            ("★ 判据② 干净时不报（避免「恒报 = 没人看」）",
             lambda: check([lane_ok], [base_ok])[0] == []
             and any("判据②" in n for n in check([lane_ok], [base_ok])[1])),
            # ★ 判据③：真事故（slicot 少链 common.oct.o）的形状
            ("★ 车道模块多出主模块/胶水都给不了的导入 ⇒ 必须报",
             lambda: any("多出的导入" in p for p in check(
                 LANE3, BASE3, main_w, os.path.join(d, "main.js"))[0])),
            ("★ 判据③ 干净时只报成对的那些、不报其它",
             lambda: all("多出的导入" not in q for q in check(
                 PAIR, PAIR_BASE, main_w, os.path.join(d, "main.js"))[0])),
            ("★ 主模块/胶水路径不存在 ⇒ 必须报（零值守卫：不许静默当通过）",
             lambda: bool(check([lane_ok], [base_ok], "/tmp/nope.wasm", "/tmp/nope.js")[0])),
            ("★ 没给 --main-wasm ⇒ 只记「判据③没做」的 note，不算问题",
             lambda: check([lane_ok], [base_ok])[0] == []
             and any("判据③" in n and "没做" in n for n in check([lane_ok], [base_ok])[1])),
            ("**线程档为空** ⇒ 必须报（零值守卫）", lambda: bool(check([], [base_ok])[0])),
            ("**基础档为空**（给了但空）⇒ 必须报（反向断言没法做）",
             lambda: bool(check([lane_ok], [])[0])),
            ("★ 命令行不给 --base 也不许崩（`octs_in(None)` 的坑，实测踩到）",
             lambda: main([lane_ok]) in (0, 1)),
            ("★ 命令行认 --main-wasm/--main-glue（否则属性会和路径混在一起）",
             lambda: main([lane_ok, "--main-wasm", main_w, "--main-glue",
                           os.path.join(d, "main.js")]) in (0, 1)),
            ("★ 没给基础档 ⇒ 只记 note、不算问题（容器侧只能做正向）",
             lambda: check([lane_ok], None)[0] == [] and bool(check([lane_ok], None)[1])),
        ]
        bad = 0
        for name, fn in cases:
            try:
                ok = bool(fn())
            except Exception as e:                    # noqa: BLE001
                ok, name = False, "%s（异常 %r）" % (name, e)
            print("%s | %s" % ("PASS" if ok else "fail", name))
            bad += 0 if ok else 1
        print("=== check-oct-lane 自证：%d PASS / %d fail ===" % (len(cases) - bad, bad))
        return 1 if bad else 0
    finally:
        shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
