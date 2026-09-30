#!/usr/bin/env python3
"""patch-openblas-idle-exit —— 让 OpenBLAS 的空闲 worker **退出**（工单 19，2026-09-30）

为什么需要（根因，全部实测见 build/113/NOTES-threads.md 的「工单 19」节）：
  Emscripten 的 `dlopen` 必须先 `__emscripten_dlsync_threads()` —— 对**每个** pthread 发
  **同步代理**并等它应答。而 OpenBLAS（`USE_THREAD=1`）的 server 线程进了 `thread_server`
  的 `while(1)` 之后**永不返回 JS 事件循环** ⇒ 应答永远不来 ⇒ dlopen 永久阻塞（100% CPU）。
  —— 这也解释了为什么"只有 dlopen 挂"（算术/内存增长/error 都不需要 dlsync）。

修法（两处，都是小改动）：
  ① `driver/others/blas_server.c` 的空闲超时分支：由"park 等唤醒"改成**让该 worker 退出**
     （置 `queue = (queue_t)-1` 后走与 shutdown 相同的 `break` 出口），并把
     `blas_server_avail = 0` —— OpenBLAS **自带懒重建**（`exec_blas` 里
     `if (unlikely(blas_server_avail == 0)) blas_thread_init();`），所以下一次 BLAS 调用
     会自动把池建回来；
  ② `thread_timeout` 由默认约 0.27 s **加大到约 1.5 s**（否则池被反复拆建，BLAS 性能崩）。

为什么这样能修好：Emscripten 的池线程在**线程函数返回后回到 JS 事件循环**，
且 dlsync **跳过已结束的线程**（`octave.js:12196` 那个 `finishedThreads.has` 判断）
⇒ 空闲期结束、池解散之后，dlopen 就能拿到全部应答。

用法（容器内）：
  python3 patch-openblas-idle-exit.py --check   /src/work/OpenBLAS-e2   # 只看能不能打
  python3 patch-openblas-idle-exit.py --apply   /src/work/OpenBLAS-e2
  python3 patch-openblas-idle-exit.py --revert  /src/work/OpenBLAS-e2
  python3 patch-openblas-idle-exit.py --selftest                        # F1：证明它会红
"""
import os
import re
import sys

REL = "driver/others/blas_server.c"
MARK = "/* OCTAVE-WASM-IDLE-EXIT */"

# ① 空闲分支：park → 退出
OLD_PARK = """	  if (!atomic_load_queue(&thread_status[cpu].queue)) {
	    pthread_mutex_lock  (&thread_status[cpu].lock);
	    thread_status[cpu].status = THREAD_STATUS_SLEEP;"""
NEW_PARK = """	  if (!atomic_load_queue(&thread_status[cpu].queue)) {
	    %s
	    /* 空闲超时 ⇒ **退出这个 worker**（而不是永久 park）：
	       返回 JS 事件循环后，Emscripten 的 dlsync 才能拿到应答（见本脚本文件头）。 */
	    atomic_store_queue(&thread_status[cpu].queue, (blas_queue_t *)-1);
	    /* 让下一次 exec_blas 重建池（OpenBLAS 自带懒重建）。 */
	    blas_server_avail = 0;
	    continue;
	  }
	  if (0) {
	    pthread_mutex_lock  (&thread_status[cpu].lock);
	    thread_status[cpu].status = THREAD_STATUS_SLEEP;""" % MARK

# ② thread_timeout：1<<28（≈0.27s）→ 约 1.5s
OLD_TO = "#define THREAD_TIMEOUT\t28"
NEW_TO = "#define THREAD_TIMEOUT\t31   /* ≈1.5s：活跃期保有池、空闲后解散（见 OCTAVE-WASM-IDLE-EXIT） */"

def target(root):
    return os.path.join(root, REL)

def apply(root, revert=False):
    p = target(root)
    if not os.path.exists(p):
        return "FATAL: 找不到 %s" % p
    s = open(p, encoding="utf-8", errors="surrogateescape").read()
    if revert:
        if MARK not in s:
            return "已还原（没有标记）"
        s = s.replace(OLD_TO.replace("\t28", "\t31") if False else NEW_TO, OLD_TO)
        s = s.replace(NEW_PARK, OLD_PARK)
        open(p, "w", encoding="utf-8", errors="surrogateescape").write(s)
        return "已还原"
    if MARK in s:
        return "已经打过（幂等）"
    if OLD_PARK not in s or OLD_TO not in s:
        return "FATAL: 目标片段没找到（源码版本变了？先人工核）"
    s = s.replace(OLD_PARK, NEW_PARK).replace(OLD_TO, NEW_TO)
    open(p, "w", encoding="utf-8", errors="surrogateescape").write(s)
    return "已打补丁"

def selftest():
    import tempfile
    bad = n = 0
    d = tempfile.mkdtemp()
    os.makedirs(os.path.join(d, "driver/others"))
    n += 1
    # ① 正常：源码片段在 ⇒ 能打，且打完有标记
    open(target(d), "w", encoding="utf-8").write(OLD_PARK + "\n" + OLD_TO + "\n")
    r = apply(d)
    ok1 = r == "已打补丁" and MARK in open(target(d), encoding="utf-8").read()
    print(("PASS" if ok1 else "fail") + " | idle-exit/片段在 ⇒ 能打上（%s）" % r)
    bad += 0 if ok1 else 1
    n += 1
    # ② 幂等：再打一次不重复改
    r2 = apply(d)
    ok2 = r2.startswith("已经打过")
    print(("PASS" if ok2 else "fail") + " | idle-exit/重复打 ⇒ 幂等（%s）" % r2)
    bad += 0 if ok2 else 1
    n += 1
    # ③ 该报的必须报：片段不在（源码变了）⇒ 必须 FATAL
    d2 = tempfile.mkdtemp(); os.makedirs(os.path.join(d2, "driver/others"))
    open(target(d2), "w", encoding="utf-8").write("/* 完全不同的源码 */\n")
    r3 = apply(d2)
    ok3 = r3.startswith("FATAL")
    print(("PASS" if ok3 else "fail") + " | ★ 片段不在 ⇒ 必须 FATAL（%s）" % r3)
    bad += 0 if ok3 else 1
    n += 1
    # ④ 空输入必须报：文件不存在
    r4 = apply(tempfile.mkdtemp())
    ok4 = r4.startswith("FATAL")
    print(("PASS" if ok4 else "fail") + " | ★ 文件不存在 ⇒ 必须 FATAL")
    bad += 0 if ok4 else 1
    print("\n=== patch-openblas-idle-exit 自证：%d PASS / %d fail ===" % (n - bad, bad))
    return 1 if bad else 0

def main(argv):
    if "--selftest" in argv:
        return selftest()
    if not argv or argv[0] not in ("--apply", "--check", "--revert"):
        print(__doc__)
        return 2
    mode = argv[0]
    root = argv[1] if len(argv) > 1 else "/src/work/OpenBLAS-e2"
    if mode == "--check":
        p = target(root)
        s = open(p, encoding="utf-8", errors="surrogateescape").read() if os.path.exists(p) else ""
        print("可打" if (OLD_PARK in s and MARK not in s) else ("已打" if MARK in s else "不可打（片段不符）"))
        return 0
    print(apply(root, revert=(mode == "--revert")))
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
