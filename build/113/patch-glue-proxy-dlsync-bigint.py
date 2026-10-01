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

    python3 patch-glue-proxy-dlsync-bigint.py --check  <octave.js>   # 0=已打 1=可打 3=不适用
    python3 patch-glue-proxy-dlsync-bigint.py --apply  <octave.js>
    python3 patch-glue-proxy-dlsync-bigint.py --revert <octave.js>
    python3 patch-glue-proxy-dlsync-bigint.py --selftest

退出码是**契约**（工单 27/35 定的形状）：0=已打 ⇒ 调用方跳过；1=可打 ⇒ apply 后复查必须回 0；
3=不适用（非 MEMORY64 胶水：调用点不存在，或已经长成别的样子）。
"""
import io
import os
import re
import sys

CALL = "{__emscripten_proxy_dlsync(pthread_ptr)}"
FIXED = "{__emscripten_proxy_dlsync(BigInt(pthread_ptr))}"
MARK = "dlsync-bigint"


def counts(s):
    return s.count(CALL), s.count(FIXED)


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
        if raw == 0 and done == 0:
            print("（非 MEMORY64 胶水或形状不认识 ⇒ 不适用）")
            return 3
        return 1 if raw > 0 else 0
    if mode == "--apply":
        if raw == 0:
            print("无可打调用点（%s）" % ("已打" if done else "不适用"))
            return 0 if done else 3
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
        ("★ 非 MEMORY64 胶水（调用点不存在）必须返 3（不适用，不许硬打）",
         lambda: main(["--check", _write(_S.replace(CALL, "{__emscripten_proxy_dlsync(BigInt(ptr))}"))]) == 3),
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
