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

    measured = {
        # ⚠️ **量出来的**，不是读环境变量猜的（曾经的 bug：手跑时清单写死 main_module=1）
        "exported_functions": count_wasm_exports(os.path.join(OUT, "octave.wasm")),
        "simd": {"v128": v128, "impl": "llvm-objdump|unavailable" if v128 is None else "llvm-objdump"},
        "jspi_entry": b"eval_wait" in js,
        "jspi_glue_suspending": count_bytes(js, b"new WebAssembly.Suspending"),
        "gl4es": {"symbol_hits": count_bytes(wasm, b"gl4es_gl")},
        "osmessa_residue": count_bytes(wasm, b"OSMesaMakeCurrent"),
        "idbfs": b'"IDBFS"' in js,
        "fontconfig": b"FONTCONFIG_FILE" in wasm,
        "fonts": font_names,
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
    log("已写出 %s（verdict=unverified；等 relink.sh verify 判定）" % os.path.join(OUT, "octave.build.json"))
    if notes:
        log("notes: " + " | ".join(notes))
    return 0


if __name__ == "__main__":
    sys.exit(main())
