#!/usr/bin/env python3
# Octave-Full-Wasm — 给链接产物发一张**身份证**：`$OUT/octave.build.json`（D2 / 批次 A1）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 为什么要有它（`build/113/PLAN-arch.md` §1.2）：产物"带什么能力"以前只能**猜** ——
# 全仓 15 处靠 grep/parse 三件套推断"这是哪个产物"，而"用的哪个 BLAS"**根本没有判据**。
#
# ★ 设计铁律：**只记构建能量到的事实**。
#   不记"传进去的旗标组" —— 旗标转抄一遍就是又一份会漂的拷贝（历史血债：
#   `WITH_JSPI=1` 赋值了却从没进链接行，产物少了 JSPI 面而所有自检全绿）。
#   量测项拿不到时记 `null` + `notes`，**verdict 保持 `unverified`** —— 谁来负责判定？
#   由 `check-build-manifest.py`（relink.sh 的 verify 段）拿**模式的声明**去核对。
#
# 用法（容器内，link-web.sh 尾部自动调用；也可单独跑）：
#   python3 write-build-manifest.py <产物目录> <link-web.sh 路径> [模式名]
# 退出码：0 = 清单已写出（**不代表产物合格**，那要看 verdict）；2 = 连清单都写不出来
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time

OUT, LINK_SH = sys.argv[1], sys.argv[2]
MODE = sys.argv[3] if len(sys.argv) > 3 else ""
# ★ `--exports <wasm>`：**只量导出段**的见证入口（工单 59；Einfacht #9 撤回后改用 #5 的
#   witness 档满足同一需求——不新增机制，给现有量测函数开一个 stdout 裸值出口）。
#   契约：stdout 逐字 == `mimalloc` | `default` | `unknown`（读不出 ⇒ unknown，不许猜）。
EXPORTS_MODE = "--exports" in sys.argv
if EXPORTS_MODE:
    OUT = LINK_SH = None

BIG = ("octave.wasm", "octave.js", "octave.data")


def log(m):
    print("== 身份证: " + m)


def sha256_file(p, chunk=1 << 20):
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for b in iter(lambda: fh.read(chunk), b""):
            h.update(b)
    return h.hexdigest()


def read_bytes(p):
    try:
        with open(p, "rb") as fh:
            return fh.read()
    except OSError:
        return b""


def find_objdump():
    """llvm-objdump 的位置：PATH 优先，其次是 emsdk 的固定路径（实测容器里没有 /usr/src/emsdk，
    真的在 /emsdk/upstream/bin）。找不到就返回 None —— 不猜、不造数。"""
    for c in (shutil.which("llvm-objdump"), "/emsdk/upstream/bin/llvm-objdump",
              "/usr/src/emsdk/upstream/bin/llvm-objdump"):
        if c and os.path.exists(c):
            return c
    return None


def count_v128(wasm_path):
    """★ SIMD 的**唯一**可靠判据：反汇编里 v128 指令的条数。
    现役产物实测 4752；非 SIMD 那版实测 0（复跑：`llvm-objdump -d <wasm> | grep -c v128`）。
    ⚠️ 不能用 `grep -c simd128`（字符串检查是假的：产物里没有 target_features 段）。
    29MB 的 wasm 反汇编要十几秒，所以**流式逐行数**，不把整份输出读进内存。"""
    objdump = find_objdump()
    if not objdump:
        return None, "llvm-objdump 找不到（PATH 与 /emsdk/upstream/bin 都没有）"
    n = 0
    try:
        p = subprocess.Popen([objdump, "-d", wasm_path], stdout=subprocess.PIPE,
                             stderr=subprocess.DEVNULL, text=True, errors="replace")
        for line in p.stdout:
            if "v128" in line:
                n += 1
        p.wait()
    except OSError as e:
        return None, "llvm-objdump 跑不起来: %s" % e
    if p.returncode != 0:
        return None, "llvm-objdump 退出码 %d" % p.returncode
    return n, None


def count_bytes(hay, needle):
    return hay.count(needle)


def _uleb(b, i):
    r = s = 0
    while True:
        x = b[i]
        i += 1
        r |= (x & 0x7f) << s
        if not (x & 0x80):
            return r, i
        s += 7


def mem_shared_flags(path):
    """wasm 里**每个内存**（定义的 + 导入的）的 shared 标志位（limits flags 的 bit1）。

    为什么必须这样量（★ B6 实测踩到的假判据）：
      · `b"atomics" in wasm`（特征段）**会被 wasm-opt 在 -O2 下精简掉** —— 同一份 `-pthread`
        产物，-O0 有 atomics、-O2 没有；拿它当判据会得出"线程档其实不是线程档"的错结论。
      · `grep -c PThread` 数的是**行数**，-O2 混淆把 38 行压成 1 行（实测），也不是判据。
      · 内存是不是 shared 是**链接期定死**的（memory 段的 limits flags），优化动不了它。
    实测：`-pthread` 最小样例 = [True]；现役 product `octave.wasm` = [False]。
    """
    b = read_bytes(path)
    if b[:4] != b"\0asm":
        return None
    i, out = 8, []
    while i < len(b):
        sid = b[i]
        i += 1
        size, i = _uleb(b, i)
        end = i + size
        if sid == 5:                      # memory section
            n, j = _uleb(b, i)
            for _ in range(n):
                flags, j = _uleb(b, j)
                out.append(bool(flags & 0x02))
                _mn, j = _uleb(b, j)
                if flags & 0x01:
                    _mx, j = _uleb(b, j)
        elif sid == 2:                    # import section（内存可能是导入的）
            n, j = _uleb(b, i)
            for _ in range(n):
                l, j = _uleb(b, j)
                j += l
                l, j = _uleb(b, j)
                j += l
                kind = b[j]
                j += 1
                if kind == 0x02:
                    flags, j = _uleb(b, j)
                    out.append(bool(flags & 0x02))
                    _mn, j = _uleb(b, j)
                    if flags & 0x01:
                        _mx, j = _uleb(b, j)
                elif kind == 0x00:
                    _t, j = _uleb(b, j)
                elif kind == 0x01:
                    _e, j = _uleb(b, j)
                    fl, j = _uleb(b, j)
                    _mn, j = _uleb(b, j)
                    if fl & 0x01:
                        _mx, j = _uleb(b, j)
                elif kind == 0x03:
                    j += 2
        i = end
    return out


def mem_wasm64_flags(path):
    """wasm 里每个内存（定义的 + 导入的）的 wasm64 标志位（limits flags 的 bit2 / 0x04）。
    64 位 WebAssembly 下内存索引是 i64，limits flags 包含 0x04。
    """
    b = read_bytes(path)
    if b[:4] != b"\0asm":
        return None
    i, out = 8, []
    while i < len(b):
        sid = b[i]
        i += 1
        size, i = _uleb(b, i)
        end = i + size
        if sid == 5:                      # memory section
            n, j = _uleb(b, i)
            for _ in range(n):
                flags, j = _uleb(b, j)
                out.append(bool(flags & 0x04))
                _mn, j = _uleb(b, j)
                if flags & 0x01:
                    _mx, j = _uleb(b, j)
        elif sid == 2:                    # import section
            n, j = _uleb(b, i)
            for _ in range(n):
                l, j = _uleb(b, j)
                j += l
                l, j = _uleb(b, j)
                j += l
                kind = b[j]
                j += 1
                if kind == 0x02:
                    flags, j = _uleb(b, j)
                    out.append(bool(flags & 0x04))
                    _mn, j = _uleb(b, j)
                    if flags & 0x01:
                        _mx, j = _uleb(b, j)
                elif kind == 0x00:
                    _t, j = _uleb(b, j)
                elif kind == 0x01:
                    _e, j = _uleb(b, j)
                    fl, j = _uleb(b, j)
                    _mn, j = _uleb(b, j)
                    if fl & 0x01:
                        _mx, j = _uleb(b, j)
                elif kind == 0x03:
                    j += 2
        i = end
    return out


def count_wasm_exports(path):
    """量 wasm **导出段**的条目数 —— 这是 `MAIN_MODULE=1/2` 唯一可测的判据。
    为什么不能读环境变量 `MAIN_MODULE_LEVEL`：那只是"命令行上传过什么"，
    漏传/手跑时会**猜**出一个值写进清单（实测踩过：清单写 main_module=1，
    而产物其实是 M2）。导出段（section 7）在 code 段之前 ⇒ 跳过前面的节即可，很快。
    实测基准（2026-09-26）：M2 产物 710 条（只导出保活集）、M1 产物 44987 条（导出全部），
    63× 差距 ⇒ 判定方用 5000 分界。"""
    def uleb(fh):
        r = sh = 0
        while True:
            b = fh.read(1)
            if not b:
                return None
            b = b[0]
            r |= (b & 0x7F) << sh
            if not (b & 0x80):
                return r
            sh += 7
    try:
        with open(path, "rb") as fh:
            if fh.read(4) != b"\0asm":
                return None
            fh.read(4)
            while True:
                h = fh.read(1)
                if not h:
                    return None
                sid = h[0]
                size = uleb(fh)
                if size is None:
                    return None
                if sid == 7:
                    return uleb(fh)
                fh.seek(size, 1)
    except OSError:
        return None


def wasm_export_names(path):
    """读 wasm **导出段（section 7）的名字**。分配器探针的量测面（工单 59）：
    `-Wl,--export-if-defined=mi_version` 只在真链了 mimalloc 时产出该导出
    （mimalloc 归档定义 `mi_version`、dlmalloc 没有 —— llvm-nm 实测；未定义 ⇒ lld 静默忽略），
    而 strip 过的产物**导出表还在** ⇒ 这是"从产物读出用的哪个分配器"的窗口
    （§5.46：只信命令行旗标不算验收）。返回 None = 读不出（不许猜，判定方会判拒）。
    探针只认 mimalloc：dlmalloc/emmalloc 都量成 "default" —— 工单 61 插件系统
    将来注册新分配器适配器时，在这里加它自己的探针符号。"""
    def uleb(fh):
        r = sh = 0
        while True:
            b = fh.read(1)
            if not b:
                return None
            b = b[0]
            r |= (b & 0x7F) << sh
            if not (b & 0x80):
                return r
            sh += 7
    try:
        with open(path, "rb") as fh:
            if fh.read(4) != b"\0asm":
                return None
            fh.read(4)
            while True:
                h = fh.read(1)
                if not h:
                    return None
                sid = h[0]
                size = uleb(fh)
                if size is None:
                    return None
                if sid == 7:
                    n = uleb(fh)
                    names = []
                    for _ in range(n):
                        ln = uleb(fh)
                        names.append(fh.read(ln).decode("utf-8", errors="replace"))
                        fh.read(1)          # kind
                        uleb(fh)            # index
                    return names
                fh.seek(size, 1)
    except OSError:
        return None


def blas_resolved(extra_ldflags, js_dir="/usr/local/lib"):
    """**"用的哪个 BLAS"以前没有判据** —— 这里给出来：按链接行的搜索顺序（EXTRA_LDFLAGS 的
    `-L` 先、`/usr/local/lib` 后，见 link-web.sh:526 在 LIBS 之前）取**第一个**含
    librefblas.a 的目录，并记下两个归档的 sha。
    ⚠️ 这是"输入侧的溯源"，不是产物量测 —— 放在 `inputs` 段里，别混进 `measured`。"""
    dirs = re.findall(r"-L(\S+)", extra_ldflags or "")
    if js_dir not in dirs:
        dirs.append(js_dir)
    for d in dirs:
        r = os.path.join(d, "librefblas.a")
        l = os.path.join(d, "liblapack.a")
        if os.path.exists(r):
            return {"resolved_dir": d, "search_order": dirs,
                    "librefblas": {"path": r, "sha256": sha256_file(r),
                                   "bytes": os.path.getsize(r)},
                    "liblapack": ({"path": l, "sha256": sha256_file(l),
                                   "bytes": os.path.getsize(l)} if os.path.exists(l) else None)}
    return {"resolved_dir": None, "search_order": dirs,
            "note": "搜索顺序里没有任何目录含 librefblas.a"}


def main():
    if EXPORTS_MODE:
        _p = sys.argv[sys.argv.index("--exports") + 1]
        _n = wasm_export_names(_p) if os.path.exists(_p) else None
        print("mimalloc" if (_n and "mi_version" in _n)
              else ("default" if _n is not None else "unknown"))
        return 0
    notes = []
    if not os.path.isdir(OUT):
        print("FATAL: 产物目录不存在: %s" % OUT, file=sys.stderr)
        return 2
    missing = [f for f in BIG if not os.path.exists(os.path.join(OUT, f))]
    if missing:
        print("FATAL: 产物目录里缺 %s（链接没成功？）" % ", ".join(missing), file=sys.stderr)
        return 2

    files = {}
    for f in BIG:
        p = os.path.join(OUT, f)
        files[f] = {"sha256": sha256_file(p), "bytes": os.path.getsize(p)}
        log("%s %s (%d B)" % (f, files[f]["sha256"][:16], files[f]["bytes"]))

    js = read_bytes(os.path.join(OUT, "octave.js"))
    wasm = read_bytes(os.path.join(OUT, "octave.wasm"))

    # ── 量测：能力面（每一项都是"从产物里读出来"，不是"命令行上传过"）──
    font_names = sorted({m.decode() for m in
                         re.findall(rb"Free(?:Sans|Mono)[A-Za-z]*\.otf", js)})
    v128, v128_note = count_v128(os.path.join(OUT, "octave.wasm"))
    if v128_note:
        notes.append("simd.v128: " + v128_note)

    # ★ 工单 59：分配器（从导出段量 —— 探针 mi_version 只在真链 mimalloc 时存在；
    #   读不出 ⇒ None，判定方对 None 判拒，不许猜）。
    exp_names = wasm_export_names(os.path.join(OUT, "octave.wasm"))
    if exp_names is None:
        malloc_val = None
        notes.append("malloc: 导出段读不出 ⇒ 无法核验分配器（判定方会判拒）")
    else:
        malloc_val = "mimalloc" if "mi_version" in exp_names else "default"

    # ★ 工单 63：rust-sort 插件（导出段量 —— 探针 octave_rust_sort_f64 只在真链
    #   librustsort.a 时被 --export-if-defined 导出；旋钮关 ⇒ 不存在 ⇒ None = 未发运态）。
    rust_sort_val = ("f64-stable"
                     if (exp_names is not None and "octave_rust_sort_f64" in exp_names)
                     else None)

    measured = {
        # ⚠️ **量出来的**，不是读环境变量猜的（曾经的 bug：手跑时清单写死 main_module=1）
        "exported_functions": count_wasm_exports(os.path.join(OUT, "octave.wasm")),
        "malloc": malloc_val,
        "rust_sort": rust_sort_val,
        "simd": {"v128": v128, "impl": "llvm-objdump|unavailable" if v128 is None else "llvm-objdump"},
        "jspi_entry": b"eval_wait" in js,
        "jspi_glue_suspending": count_bytes(js, b"new WebAssembly.Suspending"),
        "gl4es": {"symbol_hits": count_bytes(wasm, b"gl4es_gl")},
        "osmessa_residue": count_bytes(wasm, b"OSMesaMakeCurrent"),
        "idbfs": b'"IDBFS"' in js,
        "fontconfig": b"FONTCONFIG_FILE" in wasm,
        # ★ 线程档事实（B6，2026-09-27）：量三个**产物侧**信号，不读环境变量。
        #   决定性的是 `shared_memory`（内存段 limits flags，链接期定死、优化动不了）；
        #   `pthread_glue` 是旁证。**别用** `b"atomics" in wasm`（-O2 会被精简掉）与
        #   `grep -c PThread`（数行数，混淆后失真）—— 两个假判据都实测踩过，见函数注释。
        "threads": {"pthread_glue": count_bytes(js, b"PThread"),
                    "worker_glue": count_bytes(js, b"new Worker"),
                    "shared_memory": any(mem_shared_flags(os.path.join(OUT, "octave.wasm")) or [])},
        "fonts": font_names,
        "wasm64": any(mem_wasm64_flags(os.path.join(OUT, "octave.wasm")) or []),
        "preload_atftp_misplaced": b'filename:"/ftp@' in js,
        "files": files,
    }

    # ── 输入侧溯源（不是能力声明，是"喂了什么进去"）──
    baseline = os.environ.get("BASELINE_WASM", "")
    inputs = {
        "link_web_sh": {"path": LINK_SH, "sha256": sha256_file(LINK_SH)},
        "blas": blas_resolved(os.environ.get("EXTRA_LDFLAGS", "")),
        "keep_list": ({"path": os.environ["KEEP_LIST"],
                       "sha256": sha256_file(os.environ["KEEP_LIST"]),
                       "lines": sum(1 for _ in open(os.environ["KEEP_LIST"]))}
                      if os.environ.get("KEEP_LIST") and os.path.exists(os.environ["KEEP_LIST"])
                      else None),
        "baseline_wasm": ({"path": baseline, "sha256": sha256_file(baseline)}
                          if baseline and os.path.exists(baseline) else None),
    }
    if baseline and not os.path.exists(baseline):
        notes.append("BASELINE_WASM 指向的文件不存在: %s（保活闸门这次没得比）" % baseline)

    try:
        emcc = subprocess.run(["em++", "--version"], stdout=subprocess.PIPE,
                              stderr=subprocess.DEVNULL, text=True,
                              timeout=60).stdout.splitlines()[0]
    except Exception as e:                                  # noqa: BLE001
        emcc = "unavailable: %s" % e
        notes.append("emcc 版本量不到: %s" % e)

    # declared 由 relink.sh 通过 BUILD_DECLARED 传进来（模式的声明）。
    # 手跑 link-web.sh 时它是 null ⇒ verdict 只能是 unverified ⇒ **不可部署**
    # （"没核对过 = 不可部署"这条不变式的落点；判定方是 check-build-manifest.py）。
    declared = None
    if os.environ.get("BUILD_DECLARED"):
        try:
            declared = json.loads(os.environ["BUILD_DECLARED"])
        except ValueError as e:
            print("FATAL: BUILD_DECLARED 不是合法 JSON: %s" % e, file=sys.stderr)
            return 2

    man = {
        "schema": 1,
        "tool": {"name": "link-web.sh", "script_sha256": inputs["link_web_sh"]["sha256"],
                 "emcc": emcc,
                 "manifest_writer": {"name": "write-build-manifest.py",
                                     "script_sha256": sha256_file(os.path.abspath(__file__))}},
        "build": {"when": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "out": os.path.abspath(OUT),
                  "mode": MODE or None},
        "declared": declared,
        "measured": measured,
        "inputs": inputs,
        "notes": notes,
        "verdict": "unverified",
    }
    tmp = os.path.join(OUT, "octave.build.json.tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(man, fh, indent=1, ensure_ascii=False, sort_keys=False)
        fh.write("\n")
    os.replace(tmp, os.path.join(OUT, "octave.build.json"))
    log("导出条目 = %s（M2 基准 710 / M1 基准 44987）" % measured["exported_functions"])
    log("分配器 = %s（探针 = 导出段里的 mi_version：mimalloc 有、dlmalloc 无 —— 工单 59）"
        % measured["malloc"])
    _t = measured["threads"]
    log("线程事实 = 内存 shared=%s / PThread 胶水 %s 次 / new Worker %s 次 ⇒ %s"
        % (_t["shared_memory"], _t["pthread_glue"], _t["worker_glue"],
           "线程档（需 COOP/COEP）" if (_t["pthread_glue"] > 0 and _t["shared_memory"])
           else "非线程档（任何静态托管都能跑）"))
    log("已写出 %s（verdict=unverified；等 relink.sh verify 判定）" % os.path.join(OUT, "octave.build.json"))
    if notes:
        log("notes: " + " | ".join(notes))
    return 0


if __name__ == "__main__":
    sys.exit(main())
