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
  python3 build/113/check-oct-lane.py --selftest
退出码：0 = 线程档全有入口 **且** 基础档全没有；1 = 有违反；2 = 用法错。
"""
import os
import sys

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


def check(lane, base):
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
    notes.append("线程档 %d/%d 有 TLS 入口；基础档 %d 个**都没有**（反向断言成立）"
                 % (n_ok, len(lane), len(base) if base is not None else 0)
                 if (base and not bad_base) else
                 "线程档 %d/%d 有 TLS 入口（基础档那侧见上面的问题行）" % (n_ok, len(lane)))
    return problems, notes


def main(argv):
    if "--selftest" in argv:
        return selftest()
    base, lane = None, []
    cur = lane
    for a in argv:
        if a == "--base":
            base = []
            cur = base
            continue
        cur.append(a)
    if not lane:
        print(__doc__.strip().split("用法：")[-1].strip(), file=sys.stderr)
        return 2
    problems, notes = check(octs_in(lane), None if base is None else octs_in(base))
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
            ("**线程档为空** ⇒ 必须报（零值守卫）", lambda: bool(check([], [base_ok])[0])),
            ("**基础档为空**（给了但空）⇒ 必须报（反向断言没法做）",
             lambda: bool(check([lane_ok], [])[0])),
            ("★ 命令行不给 --base 也不许崩（`octs_in(None)` 的坑，实测踩到）",
             lambda: main([lane_ok]) in (0, 1)),
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
