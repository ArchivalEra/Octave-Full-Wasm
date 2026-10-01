#!/usr/bin/env python3
# Octave-Full-Wasm — **OpenBLAS 的 Emscripten 可移植性补丁**（E2，2026-09-27，branch `e2-openblas`）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

"""给 OpenBLAS 打上 `driver/others/blas_server.c` 的 `__EMSCRIPTEN__` 守卫（打/撤/干跑）。

## 记录就是 patch 文件本身

补丁正文在 `build/113/openblas-emscripten.patch`（`diff -u` 出的原样 diff，`-p1` 可用）。
**为什么以 diff 为记录**：这段守卫最早是 2026-09-26 做"线程版 BLAS 缩放探针"时**手改**在
`/src/work/OpenBLAS-thr` 里的，没记档 ⇒ 2026-09-27 从**原始树**建 E2 干净副本时编译失败
（`diff -rq` 两棵树一比才现形）。手写"原文/改后"字符串对还容易抄错缩进（`\\t` 与 8 空格混用）
⇒ 直接把 diff 存成文件：既能被人 review，又能被 `patch` 精确应用/回滚。

## 它修什么（实测四条编译错）

`USE_THREAD=1` ⇒ 编 `driver/others/blas_server.c`（`-DSMP_SERVER` 的宿主线程服务器）：

    fatal error: 'sys/resource.h' file not found
    error: variable has incomplete type 'struct rlimit'
    error: call to undeclared function 'raise'
    error: use of undeclared identifier 'SIGINT'

Emscripten libc 没有它们，wasm 里也没有"进程内信号"这套语义 ⇒ 那一整段只是**给人读的诊断**
（"ulimit 太小 / 调小 OPENBLAS_NUM_THREADS"）。守卫后：失败路径**照样 `exit(EXIT_FAILURE)`**
（与 `raise` 失败时的分支一致），只是不再打印那两行 rlimit 诊断。

## 用法

    python3 patch-openblas-emscripten.py --check  /src/work/OpenBLAS-e2
    python3 patch-openblas-emscripten.py --apply  /src/work/OpenBLAS-e2
    python3 patch-openblas-emscripten.py --revert /src/work/OpenBLAS-e2
    python3 patch-openblas-emscripten.py --selftest
"""
import io
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
PATCH = os.path.join(HERE, "openblas-emscripten.patch")
MARK = "__EMSCRIPTEN__"


def _run(args, cwd):
    p = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    return p.returncode, (p.stdout + p.stderr).strip()


def state(root):
    """返回 'patched' / 'pristine' / 'unknown'：只看那个文件里有没有守卫标记。"""
    f = os.path.join(root, "driver/others/blas_server.c")
    if not os.path.isfile(f):
        return "unknown"
    s = io.open(f, encoding="utf-8", errors="replace").read()
    if "#ifndef __EMSCRIPTEN__\n#include <sys/resource.h>\n#endif" in s:
        return "patched"
    if "#include <sys/resource.h>" in s:
        return "pristine"
    return "unknown"


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if len(argv) < 2:
        print(__doc__.strip().split("用法")[-1].strip(), file=sys.stderr)
        return 2
    mode, root = argv[0], argv[1]
    if not os.path.isdir(root):
        print("FATAL: %s 不是目录" % root, file=sys.stderr)
        return 2
    st = state(root)
    if mode == "--check":
        print("blas_server.c：%s" % st)
        # ★ **退出码是契约**（工单 27 给 idle-exit 定的形状，本补丁 2026-10-01 才补上）：
        #   0 = 已打 ⇒ 调用方跳过；1 = 可打（pristine）⇒ 调用方 apply 后复查必须回 0；
        #   3 = 不可打（形状不认识）。
        #   ⚠️ 实测事故（`w64` + 线程版 OpenBLAS，本批最贵的一条）：本补丁原先一律返 0，
        #   驱动当"已打"跳过 ⇒ `blas_server.c` 的 `struct rlimit`/`raise`/`SIGINT` 在
        #   **wasm64 sysroot** 下编不过 ⇒ 少了 `blas_server.o`（它定义 `blas_cpu_number`）⇒
        #   库被打包成"缺一个成员"，**链接照过、`verdict=ok`**，而**运行期页面崩**：
        #   `bad export type for 'blas_cpu_number'`（未定义符号被当成 GOT 导入）。
        if st == "patched":
            return 0
        if st == "pristine":
            return 1
        return 3
    if mode == "--apply":
        if st == "patched":
            print("已打过（幂等）")
            return 0
        rc, out = _run(["patch", "-p1", "-N", "--forward", "-i", PATCH], root)
        print(out[:400])
        if rc != 0 or state(root) != "patched":
            print("FATAL: 打补丁失败（rc=%d）—— 源文件版本不符？" % rc, file=sys.stderr)
            return 3
        print("已打（守卫就位）")
        return 0
    if mode == "--revert":
        rc, out = _run(["patch", "-p1", "-R", "-i", PATCH], root)
        print(out[:400])
        if rc != 0 or state(root) != "pristine":
            print("FATAL: 回滚失败（rc=%d）" % rc, file=sys.stderr)
            return 3
        print("已回滚到原始（逐字节：与 /src/work/OpenBLAS-0.3.34 的那份一致）")
        return 0
    print("未知模式 %s" % mode, file=sys.stderr)
    return 2


# ── 自证（机制用**运行时生成的小补丁**验；记录本身做内容断言）────────────────────────
def _rc_check(fixture_text):
    """把夹具写进临时树，跑 `--check`，返回 rc（CLI 级：测**退出码契约**）。"""
    d = tempfile.mkdtemp()
    os.makedirs(os.path.join(d, "driver/others"))
    io.open(os.path.join(d, "driver/others/blas_server.c"), "w", encoding="utf-8").write(fixture_text)
    try:
        return main(["--check", d])
    finally:
        import shutil
        shutil.rmtree(d, ignore_errors=True)


def selftest():
    cases = []
    tmp = tempfile.mkdtemp()
    try:
        # ① 机制：造一个小补丁（同形状：改一行 + 加三行），打/干跑/撤销都要能证明
        a = os.path.join(tmp, "a")
        os.makedirs(os.path.join(a, "sub"))
        f = os.path.join(a, "sub", "x.c")
        io.open(f, "w", encoding="utf-8").write("line1\nline2\nline3\n")
        mk = os.path.join(tmp, "mk")
        os.makedirs(os.path.join(mk, "sub"))
        io.open(os.path.join(mk, "sub", "x.c"), "w", encoding="utf-8").write(
            "line1\n#ifdef FIX\nline2\n#endif\nline3\n")
        small = os.path.join(tmp, "small.patch")
        # ⚠️ 必须在 `tmp` 里用**相对路径**跑 diff：否则补丁头部是绝对路径，`-p1` 剥一层后
        #    剩下的路径在目标树里对不上（自证第一版就栽在这：rc!=0、内容没变）。
        with io.open(small, "w", encoding="utf-8") as fh:
            subprocess.run(["diff", "-u", "a/sub/x.c", "mk/sub/x.c"], cwd=tmp, stdout=fh)
        orig = io.open(f, encoding="utf-8").read()

        rc1, _ = _run(["patch", "-p1", "-N", "-i", small], a)
        after = io.open(f, encoding="utf-8").read()
        rc2, _ = _run(["patch", "-p1", "-N", "-i", small], a)          # 已打过 ⇒ 必须拒绝
        rc3, _ = _run(["patch", "-p1", "-R", "-i", small], a)
        back = io.open(f, encoding="utf-8").read()
        cases += [
            ("小补丁能打上（rc=0 且内容变了）", lambda: rc1 == 0 and after != orig),
            ("★ 同一补丁再打一次 ⇒ **必须被拒**（`-N`：只许前进）", lambda: rc2 != 0),
            ("★ `-R` 回滚**逐字节**回到原文", lambda: rc3 == 0 and back == orig),
        ]
        # ② 记录本身：文件在、非空、内容是这件事
        cases += [
            ("补丁文件存在且非空", lambda: os.path.getsize(PATCH) > 200),
            ("★ 记录里的确是这件事（含 __EMSCRIPTEN__ 与 struct rlimit）",
             lambda: MARK in io.open(PATCH, encoding="utf-8").read()
             and "struct rlimit" in io.open(PATCH, encoding="utf-8").read()),
            ("★ 记录带 `a/` `b/` 前缀（`-p1` 可用）",
             lambda: io.open(PATCH, encoding="utf-8").read().startswith("--- a/")),
        ]
        # ★★ 退出码契约（2026-10-01；缺它 ⇒ 驱动跳过补丁 ⇒ 库缺成员 ⇒ 运行期页面崩）
        cases += [
            ("★ `--check`：**未打**（pristine）必须返 1（可打）—— 返 0 会被驱动当\"已打\"跳过",
             lambda: _rc_check("#include <sys/resource.h>\nint x;\n") == 1),
            ("★ `--check`：**已打**必须返 0",
             lambda: _rc_check("#ifndef __EMSCRIPTEN__\n#include <sys/resource.h>\n#endif\n") == 0),
            ("★ `--check`：**形状不认识**必须返 3（不可打，别硬打）",
             lambda: _rc_check("int nothing_here;\n") == 3),
        ]
        bad = 0
        for name, fn in cases:
            try:
                ok = bool(fn())
            except Exception as e:                    # noqa: BLE001
                ok, name = False, "%s（异常 %r）" % (name, e)
            print("%s | %s" % ("PASS" if ok else "fail", name))
            bad += 0 if ok else 1
        print("=== patch-openblas-emscripten 自证：%d PASS / %d fail ===" % (len(cases) - bad, bad))
        return 1 if bad else 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
