#!/usr/bin/env python3
# Octave-Full-Wasm — **glue 的 dlsync BigInt 补丁**（工单 37，2026-10-01）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

"""给 **MEMORY64 车道的 `octave.js`** 打一个定点补丁：
`__emscripten_proxy_dlsync(pthread_ptr)` → `__emscripten_proxy_dlsync(BigInt(pthread_ptr))`。

## 根因（实测，工单 33 发运路上撞到）

Emscripten 5.0.7 的 `__emscripten_dlsync_threads`（dylink + pthread 的共享内存同步）用
**Number** 调 `__emscripten_proxy_dlsync(pthread_ptr)`；而在 **memory64** 下 `pthread_t`
是指针 = **i64**，wasm 侧签名要 BigInt ⇒ `WebAssembly.Global`/导入调用抛
`Cannot convert 70582336 to a BigInt`。wasm32 下 pthread_t 是 i32、Number 正好合法
⇒ **只有 MEMORY64 车道需要这个补丁**。

⇒ 触发条件是"**dlopen 时有存活的 pthread**"：裸 w64 树（无 OpenBLAS）dlopen 时没有
worker 在跑，循环空转，**从不触发**（这就是它藏了这么久的原因——直到把**线程版 OpenBLAS**
链进 w64，`USE_THREAD=1` 的 worker 在 dlopen 时活着，第一行就炸）。

## 用法（容器/宿主通用）

    python3 patch-glue-proxy-dlsync-bigint.py --check  <octave.js>   # 0=已打 1=可打 3=不适用 4=形状不认识
    python3 patch-glue-proxy-dlsync-bigint.py --apply  <octave.js>
    python3 patch-glue-proxy-dlsync-bigint.py --revert <octave.js>
    python3 patch-glue-proxy-dlsync-bigint.py --selftest

退出码是**契约**（工单 27/35 定的形状）：
  0=已打 ⇒ 调用方跳过；1=可打 ⇒ apply 后复查必须回 0；
  3=**不适用**（胶水里根本没有 dlsync 调用 —— 非线程 memory64 / wasm32）；
  4=**形状不认识**（胶水**有** dlsync 调用点，但不是已知形状 ⇒ 版本变了，**调用方必须 FATAL**）。

⚠ 3 与 4 必须分开（工单 56）：此前两者都返 3，于是 `link-web.sh` 的 `|| FATAL` 把
"非线程 memory64 本来就不需要这个补丁" 也当成了失败 ⇒ **w64-base 车道的符号构建被挡住**。
判据 = 胶水里有没有 `__emscripten_dlsync_threads` 这个函数。
"""
import io
import os
import re
import sys

CALL = "{__emscripten_proxy_dlsync(pthread_ptr)}"
FIXED = "{__emscripten_proxy_dlsync(BigInt(pthread_ptr))}"
FUNC = "__emscripten_dlsync_threads"     # 判 3 与 4 的锚：有没有这个 dlsync 调用点所在函数
MARK = "dlsync-bigint"


def counts(s):
    return s.count(CALL), s.count(FIXED)


def classify(s, raw, done):
    """返回契约码：0=已打 / 1=可打 / 3=不适用（无 dlsync）/ 4=形状不认识（有 dlsync 但形状变）。"""
    if raw > 0:
        return 1
    if done > 0:
        return 0
    return 4 if FUNC in s else 3


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if len(argv) < 2 or argv[0] not in ("--check", "--apply", "--revert"):
        print(__doc__.strip().split("## 用法")[-1].strip(), file=sys.stderr)
        return 2
    mode, path = argv[0], argv[1]
    if not os.path.isfile(path):
        print("FATAL: 缺 %s" % path, file=sys.stderr)
        return 2
    s = io.open(path, encoding="utf-8", errors="replace").read()
    raw, done = counts(s)
    if mode == "--check":
        print("octave.js：可打 %d 处、已打 %d 处" % (raw, done))
        code = classify(s, raw, done)
        if code == 3:
            print("（无 dlsync 调用点 ⇒ 非线程 memory64 / wasm32 ⇒ 不适用）")
        elif code == 4:
            print("（有 dlsync 调用点但形状不认识 ⇒ 版本变了？调用方应 FATAL）")
        return code
    if mode == "--apply":
        code = classify(s, raw, done)
        if code in (0, 3, 4):
            print("无可打调用点（%s）" % ("已打" if code == 0 else
                                     "不适用（无 dlsync）" if code == 3 else "形状不认识"))
            return code
        s2 = s.replace(CALL, FIXED)
        io.open(path, "w", encoding="utf-8", errors="replace").write(s2)
        d2, done2 = counts(io.open(path, encoding="utf-8", errors="replace").read())
        print("已打 %d 处（余可打 %d）" % (done2, d2))
        return 0
    if mode == "--revert":
        if done == 0:
            print("没有已打的补丁")
            return 0
        io.open(path, "w", encoding="utf-8", errors="replace").write(s.replace(FIXED, CALL))
        print("已还原")
        return 0
    return 2


_S = 'function __emscripten_dlsync_threads(){if(ENVIRONMENT_IS_PTHREAD)return proxyToMainThread(28,0,2);const callingThread=PThread.currentProxiedOperationCallerThread;if(callingThread){return dlsyncThreadsAsync()}for(const ptr of Object.keys(PThread.pthreads)){const pthread_ptr=Number(ptr);if(!PThread.finishedThreads.has(pthread_ptr))' + CALL + '}}'


def selftest():
    bad = 0
    cases = [
        ("★ 未打的 MEMORY64 胶水必须返 1（可打）—— 返 0 会被驱动当「已打」跳过",
         lambda: main(["--check", _write(_S)]) == 1),
        ("★ 已打的胶水必须返 0（驱动据此跳过）",
         lambda: main(["--check", _write(_S.replace(CALL, FIXED))]) == 0),
        ("★ 有 dlsync 但形状不认识 ⇒ 必须返 4（调用方 FATAL，不是「不适用」——工单 56）",
         lambda: main(["--check", _write(_S.replace(CALL, "{__emscripten_proxy_dlsync(BigInt(ptr))}"))]) == 4),
        ("★ 无 dlsync 函数（非线程 memory64 / wasm32）⇒ 必须返 3（真不适用，放行）",
         lambda: main(["--check", _write("function other(){return 1}")]) == 3),
        ("★ apply 在「无 dlsync」上也返 3（不是 0，别被当成已打）",
         lambda: main(["--apply", _write("function other(){return 1}")]) == 3),
        ("★ apply 在「形状不认识」上返 4（不硬打）",
         lambda: main(["--apply", _write(_S.replace(CALL, "{__emscripten_proxy_dlsync(BigInt(ptr))}"))]) == 4),
        ("apply 后：调用点变成 BigInt 且其余字节不动",
         lambda: _apply_writes(_S).endswith(FIXED + "}}")),
        ("revert 后：逐字节回到未打状态",
         lambda: _revert_writes(_S.replace(CALL, FIXED)) == _S),
    ]
    for name, fn in cases:
        try:
            ok = bool(fn())
        except Exception as e:                    # noqa: BLE001
            ok, name = False, "%s（异常 %r）" % (name, e)
        print("%s | %s" % ("PASS" if ok else "fail", name))
        bad += 0 if ok else 1
    print("=== patch-glue-proxy-dlsync-bigint 自证：%d PASS / %d fail ===" % (len(cases) - bad, bad))
    return 1 if bad else 0


def _write(text):
    import tempfile
    d = tempfile.mkdtemp()
    p = os.path.join(d, "octave.js")
    io.open(p, "w", encoding="utf-8").write(text)
    return p


def _apply_writes(text):
    p = _write(text)
    main(["--apply", p])
    return io.open(p, encoding="utf-8").read()


def _revert_writes(text):
    p = _write(text)
    main(["--revert", p])
    return io.open(p, encoding="utf-8").read()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
