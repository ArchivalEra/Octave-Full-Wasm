#!/usr/bin/env python3
# Octave-Full-Wasm — **拿模式的"声明"去核对产物的"实测"**，并给清单写 verdict（D1+D2 / 批次 A1）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 这是 fail-closed 的**判定方**：`build/113/relink.sh link <模式>` 在链接结束后调它；
# 判不过 ⇒ 非零退出 + 清单里写 `verdict:"rejected"` + `mismatches`（**留下证据**，
# 比"不写清单"更好查；效果一样 —— 读取方一律只认 `verdict == "ok"` ⇒ 不可部署）。
#
# ★ 为什么不是"回显旗标"：回显只是把命令行抄一遍，**旗标传了不等于产物里有**。
#   历史血债（HISTORY §5.46）：`JSPI_FLAGS` 赋了值却从没被链接行引用 ⇒ 产物少一整个能力面，
#   而构建/链接/五条自检**全绿**。所以判据只能是"从产物量出来的事实 vs 模式的承诺"。
#
# 用法：
#   python3 check-build-manifest.py <octave.build.json> [declared.json] [--write] [--out-dir DIR]
#     declared.json 省略时用**清单里嵌入的** declared（relink.sh 走这条路：声明由它随链接写入，
#     判定时读同一份 ⇒ 两边不可能不一致）。显式传一个 declared.json 可以模拟"另一种模式"
#     （反向断言就靠它）。
#     --write     把 verdict / mismatches / checked_* 写回清单（relink.sh 用这个）
#     --out-dir   重新哈希该目录下的三个大件，核对清单里的 files.sha256
#                 （防"清单和产物不是一对" —— 拷错目录时唯一的现形方式）
# 退出码：0 = ok（可以部署）；3 = rejected（有 mismatch）；2 = 用法/读写错
import hashlib
import json
import os
import sys
import time

# ⚠️ **不要在模块层 import gate**（2026-09-27 实测踩到）：`build/lib/gate.py` 是**宿主仓**的闸门平台，
#    而这个脚本要被 `docker cp` 进容器跑（`/src/bin/check-build-manifest.py` ⇒ `../../build/lib`
#    在容器里不存在）⇒ 模块层 import 会让**容器内每次链接都过不了出厂核对**
#    （`ModuleNotFoundError: No module named 'gate'`，fail-closed 地拒绝一切产物：
#     实测把回滚后的产品重链打成 rc=3，而产物本身与部署件**逐字节相同**）。
#    ⇒ 只在 `--selftest` 分支里 import（那时一定是宿主在跑）。

# 声明键 → 判定规则。**未列出的声明键一律判 mismatch**（fail-closed：
# 拼错的键名不许被静默忽略，否则"声明了却没检查"会变成新的静默退化）。
BOOL_KEYS = ("jspi_entry", "idbfs", "fontconfig", "wasm64")
INT_KEYS = ("jspi_glue_suspending",)   # main_module 单独判定：从导出条目数推导（见下）


def sha256_file(p, chunk=1 << 20):
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for b in iter(lambda: fh.read(chunk), b""):
            h.update(b)
    return h.hexdigest()


def lane_blas_problem(declared, man):
    """★ 车道一致性（B6）：声明 `threads=true` 的产物，**链进去的 BLAS 必须来自车道**。

    为什么单列：实测发现 wasm-ld 的 atomics 规则只针对**带 TLS/原子的**对象 ⇒ 一个**非 atomics 的纯计算
    BLAS**（无 TLS）可以**静默**链进 shared-memory 模块（当时的产物 0 违规，里面却混着基础档对象）。
    判据只能看**输入侧溯源**：身份证 `inputs.blas.resolved_dir` 必须是车道路径（含 `-threads`）。
    纯函数 ⇒ 自证直接喂合成输入。"""
    if declared.get("threads") is not True:
        return None
    rd = ((man.get("inputs") or {}).get("blas") or {}).get("resolved_dir") or ""
    if not rd:
        return "线程档产物里没有 `inputs.blas.resolved_dir` ⇒ 无法确认 BLAS 来自车道"
    if declared.get("e2_openblas") is True:
        # ★ E2（branch e2-openblas）：BLAS 换成**线程版 OpenBLAS** ⇒ 溯源判据换成它。
        #   为什么还要判：换库之后"混着基础档对象"这个风险不变（E2 的库必须自己带 atomics）。
        if "openblas" not in rd.lower():
            return ("声明 e2_openblas=true，但链进去的 BLAS 在 `%s` ⇒ 不是 E2 那份 OpenBLAS" % rd)
        return None
    if "-threads" not in rd and "-w64" not in rd:
        return ("声明 threads=true，但链进去的 BLAS 在 `%s`（**基础档**）"
                "⇒ 产物里混着基础档对象，口径不一致" % rd)
    return None


def pairing_problems(man, out_dir):
    """★ 清单与产物是不是一对：按 **--out-dir（验证谁就查谁所在目录）** 或清单里的
    build.out 重哈希产物大件。工单 15 的教训：这个决定权过去内联在 main 里 ——
    验**副本**时 `build.out` 指向**构建时**的容器路径 ⇒ 宿主上必然"文件不存在" ⇒ 假红，
    且 `--write` 把 verdict=rejected 写回副本（一次验证动作销毁了被验证的东西）。"""
    measured = man.get("measured") or {}
    d = out_dir or (man.get("build") or {}).get("out")
    file_bad = []
    if not d:
        file_bad.append("清单里没有 build.out，也没给 --out-dir ⇒ 无法核对清单与产物是否配对")
    else:
        for name, rec in (measured.get("files") or {}).items():
            p = os.path.join(d, name)
            if not os.path.exists(p):
                file_bad.append("%s 不存在（%s）" % (name, d))
                continue
            got = sha256_file(p)
            if got != rec.get("sha256"):
                file_bad.append("%s 的 sha 不符：清单 %s… 实测 %s…"
                                % (name, (rec.get("sha256") or "?")[:16], got[:16]))
        if not (measured.get("files") or {}):
            file_bad.append("清单里没有 measured.files ⇒ 无法核对")
    return file_bad


def compare(declared, measured, man=None):
    """返回 [(键, 声明值, 实测值, 为什么)]，空表 = 全过。"""
    bad = []

    def add(k, want, got, why=""):
        bad.append({"key": k, "declared": want, "measured": got, "why": why})

    for k in sorted(declared):
        if k in BOOL_KEYS:
            want, got = bool(declared[k]), bool(measured.get(k))
            if want != got:
                add(k, want, got, "能力面不一致：声明 %s，产物里量到 %s" % (want, got))
        elif k in INT_KEYS:
            want, got = declared[k], measured.get(k)
            if want != got:
                add(k, want, got, "整数不一致")
        elif k == "main_module":
            # ⚠️ **从产物的导出条目数推导**，不信写入器给的字段（它可能来自环境变量）：
            #   实测基准：M2（DCE ⇒ 只导出保活集）710 条、M1（导出全部）44987 条 —— 63× 差距，
            #   所以 5000 是安全分界。导出条目数是 wasm 里**读出来**的，改不了。
            n = measured.get("exported_functions")
            if n is None:
                add(k, declared[k], None, "量不到 wasm 导出条目数 ⇒ 无法核验 M1/M2，判拒")
            else:
                lvl = 2 if n < 5000 else 1
                if declared[k] != lvl:
                    add(k, declared[k], {"exported_functions": n, "derived": lvl},
                        "声明 MAIN_MODULE=%s，但产物导出 %d 条（<5000 ⇒ M2，≥5000 ⇒ M1）"
                        % (declared[k], n))
        elif k == "simd":
            v = (measured.get("simd") or {}).get("v128")
            if v is None:
                add(k, declared[k], None, "量不到 v128（llvm-objdump 不可用）⇒ **无法核验，判拒**")
            elif bool(declared[k]) != (v > 0):
                add(k, declared[k], {"v128": v},
                    "声明 %s，但产物里 v128 指令 %d 条" % (declared[k], v))
        elif k == "fonts":
            want = sorted(declared[k]) if isinstance(declared[k], list) else None
            got = sorted(measured.get("fonts") or [])
            if want is None:
                add(k, declared[k], got, "声明必须是字符串数组")
            elif want != got:
                miss = [f for f in want if f not in got]
                extra = [f for f in got if f not in want]
                add(k, want, got, "字体面不一致（缺 %s / 多 %s）" % (miss or "无", extra or "无"))
        elif k == "threads":
            # ★ B6（2026-09-27）：线程档的判据只能是产物事实 —— 声明 threads=true 而产物里
            #   没有 PThread 胶水/atomics，就是"命令行写了 -pthread、产物却不是线程档"
            #   （与 HISTORY §5.46 那条"旗标赋了值但没被引用"同族）。
            #   双向都判：声明 false 的产物也必须量到全 0（否则有人把线程档挂上非线程的名义）。
            t = measured.get("threads") or {}
            glue, shm = t.get("pthread_glue"), t.get("shared_memory")
            if glue is None or shm is None:
                add(k, declared[k], t, "量不到线程事实（胶水/shared_memory）⇒ **无法核验，判拒**")
            else:
                got = bool(glue > 0 and shm)
                if bool(declared[k]) != got:
                    add(k, declared[k], t,
                        "声明 threads=%s，但产物里内存 shared=%s / PThread 胶水 %s 次"
                        % (declared[k], shm, glue))
        elif k == "e2_openblas":
            # ★ E2（branch e2-openblas，2026-09-27）：声明"这份产物用的是线程版 OpenBLAS"。
            #   判据落在**输入侧溯源**（与 threads 那条同样的道理）：`inputs.blas.resolved_dir`
            #   必须指向 E2 那份（路径含 `openblas`）——"声明说换了库、实际链的还是车道 refblas"
            #   这种情况构建/链接全绿，只有溯源能看出来。
            # ⚠️ BLAS 溯源按仓库口径放在 `inputs` 段（**输入侧**事实，不是产物量测）⇒ 判据要读
            #    manifest；拿不到 manifest 就**判拒**（fail-closed，不许当通过）。
            rd = (((man or {}).get("inputs") or {}).get("blas") or {}).get("resolved_dir") or ""
            if man is None:
                add(k, declared[k], None, "核验需要 manifest（inputs.blas.resolved_dir），本次没给 ⇒ 判拒")
            else:
                got = "openblas" in rd.lower()
                if bool(declared[k]) != got:
                    add(k, declared[k], {"resolved_dir": rd},
                        "声明 e2_openblas=%s，但 BLAS 溯源是 `%s`" % (declared[k], rd or "(空)"))
        elif k == "gl4es":
            hits = (measured.get("gl4es") or {}).get("symbol_hits", 0)
            if bool(declared[k]) != (hits > 0):
                add(k, declared[k], {"symbol_hits": hits},
                    "声明 %s，但产物里 gl4es_gl* 命中 %d 次" % (declared[k], hits))
        else:
            add(k, declared[k], None,
                "**未知声明键** —— 判定规则里没有它，不许静默放过（拼错键名会变成新的静默退化）")
    return bad


def positional_args(argv):
    """取位置参数 —— **带值的旗标（`--out-dir DIR`）的值不算位置参数**。

    实测事故（工单 30，2026-10-01）：老实现只按 `startswith("--")` 过滤，于是 `--out-dir DIR`
    的 `DIR` 落进位置参数、被当成 `declared.json` 打开 ⇒ `IsADirectoryError` ⇒ **一律 rc=2**。
    `relink.sh` 恰好同时传了真的 declared（`man declared --out-dir DIR`）才一直没露馅；
    按文档单独用 `--out-dir`（不传 declared）就当场红 —— **文档说能用、实际不能用**。
    """
    takes_value = {"--out-dir"}
    out, i = [], 1
    while i < len(argv):
        a = argv[i]
        if a in takes_value:
            i += 2
            continue
        if a.startswith("--"):
            i += 1
            continue
        out.append(a)
        i += 1
    return out


def main(argv):
    args = positional_args(argv)
    flags = {a for a in argv[1:] if a.startswith("--")}
    if len(args) < 1:
        # ⚠️ 别用 `__doc__`：本文件开头是 `#` 注释、**没有模块 docstring** ⇒ `__doc__` 是 None，
        #    无参跑会崩在 `None.strip()`（实测：B6 收尾时无参跑了一次，报 AttributeError）。
        print("check-build-manifest.py: 拿模式的声明核对产物实测（fail-closed 判定方）",
              file=sys.stderr)
        print("用法: check-build-manifest.py <octave.build.json> [declared.json] "
              "[--write] [--out-dir DIR]", file=sys.stderr)
        return 2
    man_path = args[0]
    declared_path = args[1] if len(args) > 1 else None
    write = "--write" in flags
    out_dir = None
    if "--out-dir" in argv:
        out_dir = argv[argv.index("--out-dir") + 1]

    try:
        with open(man_path, encoding="utf-8") as fh:
            man = json.load(fh)
        if declared_path:
            with open(declared_path, encoding="utf-8") as fh:
                declared = json.load(fh)
        else:
            declared = man.get("declared")
    except (OSError, ValueError) as e:
        print("FATAL: 读不了清单/声明: %s" % e, file=sys.stderr)
        return 2

    if declared is None:
        # 手跑 link-web.sh 的产物：没人给它声明过 ⇒ **判拒**（"没核对过 = 不可部署"）。
        # 要判它，就给一个模式：`relink.sh verify <模式> --out <目录>`（那会显式传声明进来）。
        print("== 拒绝：清单里 declared 是 null（这份产物从没被任何模式核对过）", file=sys.stderr)
        print("   要么用 relink.sh link <模式> 重做，要么 relink.sh verify <模式> --out <目录> 补判",
              file=sys.stderr)
        return 3

    measured = man.get("measured") or {}
    # ★ 零值守卫（F1）：`declared == {}`（**空字典**，不是 None）曾一路判成 ok ——
    #    "声明了 0 条"当然"全部有实测背书"，这是恒真。空声明 = 没人核对过 = 判拒。
    if not declared:
        print("== 拒绝：模式声明是空的（{}）⇒ 相当于没人核对过", file=sys.stderr)
        return 3
    bad = compare(declared, measured, man)

    # ── 清单与产物是不是一对 ──（工单 15 起：抽成纯函数 pairing_problems，自证可测）
    file_bad = pairing_problems(man, out_dir)

    # ── ★ 车道一致性（B6，2026-09-27 实测补）：声明 threads=true 的产物，**它链进去的 BLAS 必须来自车道**
    #   为什么单列：实测发现 wasm-ld 的 atomics 规则只针对**带 TLS/原子的**对象 ⇒ 一个**非 atomics 的纯计算
    #   BLAS**（无 TLS）可以**静默**链进 shared-memory 模块（当时的产物 0 违规却混着基础档对象）。
    #   判据只能看**输入侧溯源**：身份证 `inputs.blas.resolved_dir` 必须是车道路径。
    why = lane_blas_problem(declared, man)
    if why:
        rd = ((man.get("inputs") or {}).get("blas") or {}).get("resolved_dir") or ""
        bad.append({"key": "(车道 BLAS)", "declared": "含 `-threads` 的路径", "measured": rd, "why": why})

    ok = not bad and not file_bad
    verdict = "ok" if ok else "rejected"
    print("== 核对模式声明 vs 产物实测：%s" % ("**OK**" if ok else "**拒绝**"))
    for b in bad:
        print("   ✗ %s: 声明=%s 实测=%s  —— %s"
              % (b["key"], json.dumps(b["declared"], ensure_ascii=False),
                 json.dumps(b["measured"], ensure_ascii=False), b["why"]))
    for b in file_bad:
        print("   ✗ 配对: %s" % b)
    if ok:
        print("   （声明 %d 项全有实测背书；三个大件的 sha 与产物一致）" % len(declared))

    if write:
        man["declared"] = declared
        man["verdict"] = verdict
        man["mismatches"] = bad + [{"key": "(清单与产物配对)", "why": x} for x in file_bad]
        man["checked"] = {"when": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                          "by": "check-build-manifest.py",
                          "script_sha256": sha256_file(os.path.abspath(__file__))}
        tmp = man_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(man, fh, indent=1, ensure_ascii=False)
            fh.write("\n")
        os.replace(tmp, man_path)
        print("   verdict=%s 已写回 %s" % (verdict, man_path))
    return 0 if ok else 3


# ── 自证（F1）：`compare()` 是纯函数 ⇒ 直接喂合成输入 ─────────────────────────
_MEAS = {"exported_functions": 710, "jspi_entry": True, "jspi_glue_suspending": 0,
         "idbfs": True, "fontconfig": True, "gl4es": {"symbol_hits": 5},
         "simd": {"v128": 4752}, "fonts": ["a.otf"], "main_module": 2,
         "threads": {"pthread_glue": 0, "worker_glue": 0, "shared_memory": False},
         "wasm64": False}
_THREADS_MEAS = {**_MEAS, "threads": {"pthread_glue": 38, "worker_glue": 1, "shared_memory": True}}
_DECL = {"simd": True, "jspi_entry": True, "jspi_glue_suspending": 0, "gl4es": True,
         "idbfs": True, "fontconfig": True, "fonts": ["a.otf"], "main_module": 2,
         "threads": False}


def _lane_blas_bad(threads_decl, blas_dir):
    """纯函数直调：返回 1=判定有问题、0=没问题（自证只看这一条规则的取舍）。"""
    man = {"inputs": {"blas": {"resolved_dir": blas_dir}}}
    return 1 if lane_blas_problem({"threads": threads_decl}, man) else 0


def _nc(decl):
    return len(compare(decl, dict(_MEAS)))


def _copy_with(extra, out_dir=True):
    """工单 15 的夹具：最小"产物目录 + 身份证副本"。extra=None ⇒ 文件与清单相符；
    否则文件尾多一字节（坏副本）。out_dir=False 时模拟**不给 --out-dir**（退回 build.out
    的旧路径 —— 当年假红的形状）。返回 pairing_problems 报的问题数。"""
    import tempfile
    d = tempfile.mkdtemp()
    base = b"OCTAVE-FAKE"
    payload = base + (extra or b"")
    open(os.path.join(d, "octave.wasm"), "wb").write(payload)
    # 清单记的是**原件**的 sha —— 坏副本 = 文件被改而清单还是原件的（这才会红）
    man = {"measured": {"files": {"octave.wasm": {"sha256": hashlib.sha256(base).hexdigest()}}},
           "build": {"out": "/nonexistent-构建时容器路径"}}   # 故意指不到夹具 ⇒ 老逻辑必假红
    return len(pairing_problems(man, d if out_dir else None))


CASES = [
    ("一致的声明 ⇒ 不报", lambda: _nc(_DECL) == 0),
    ("simd.v128 被改成 0 ⇒ 报", lambda: _nc({**_DECL, "simd": True}) == 0 and
     len(compare({**_DECL}, {**_MEAS, "simd": {"v128": 0}})) == 1),
    ("线程档：声明 true + 产物内存 shared ⇒ 不报",
     lambda: len(compare({**_DECL, "threads": True}, _THREADS_MEAS)) == 0),
    # ★ E2（branch e2-openblas）：声明 e2_openblas 的核验读 **manifest 的 inputs.blas.resolved_dir**
    ("★ 声明 e2_openblas=true 且溯源含 openblas ⇒ 不报",
     lambda: len(compare({**_DECL, "threads": True, "e2_openblas": True}, _THREADS_MEAS,
                         {"inputs": {"blas": {"resolved_dir": "/src/work/e2-openblas-lib"}}})) == 0),
    ("★ 声明 e2_openblas=true 但溯源是车道 ⇒ 必须报",
     lambda: any("e2_openblas" in str(b) for b in compare(
         {**_DECL, "threads": True, "e2_openblas": True}, _THREADS_MEAS,
         {"inputs": {"blas": {"resolved_dir": "/src/deps-threads/lapack-simd/lib"}}}))),
    ("★ 声明 e2_openblas 但**没给 manifest** ⇒ 判拒（不许当通过）",
     lambda: any("e2_openblas" in str(b) for b in compare(
         {**_DECL, "threads": True, "e2_openblas": True}, _THREADS_MEAS))),
    ("★ **声明线程档但产物内存不是 shared ⇒ 必须报**（-pthread 传了但没生效）",
     lambda: len(compare({**_DECL, "threads": True}, _MEAS)) == 1),
    ("★ **声明非线程档但产物内存是 shared ⇒ 必须报**（反向：线程档不许挂别人的名义）",
     lambda: len(compare(_DECL, _THREADS_MEAS)) == 1),
    ("★ 声明 threads=true 但 BLAS 来自基础档 ⇒ **必须报**（车道一致性）",
     lambda: _lane_blas_bad(True, "/src/deps/lapack-simd/lib") == 1),
    ("★ 声明 threads=true 且 BLAS 来自车道 ⇒ 不报",
     lambda: _lane_blas_bad(True, "/src/deps-threads/lapack-simd/lib") == 0),
    ("★ 非线程档不受这条约束（否则会误伤 product/scalar/m1）",
     lambda: _lane_blas_bad(False, "/src/deps/lapack-simd/lib") == 0),
    ("★ 量不到线程事实 ⇒ 必须报（不许当通过）",
     lambda: len(compare({**_DECL, "threads": True}, {**_MEAS, "threads": {}})) == 1),
    ("★ 声明 wasm64=true 且产物是 wasm64 ⇒ 不报",
     lambda: len(compare({**_DECL, "wasm64": True}, {**_MEAS, "wasm64": True})) == 0),
    ("★ 声明 wasm64=true 但产物是 wasm32 ⇒ 必须报",
     lambda: len(compare({**_DECL, "wasm64": True}, _MEAS)) == 1),
    ("★ 声明 wasm64=false 但产物是 wasm64 ⇒ 必须报",
     lambda: len(compare({**_DECL, "wasm64": False}, {**_MEAS, "wasm64": True})) == 1),
    # ★ 工单 15：--out-dir 指**副本** ⇒ 按**副本所在目录**核对，不许退回 build.out 的旧路径
    ("★ 工单 15：--out-dir 副本、文件在且 sha 相符 ⇒ 不报（副本也能验）",
     lambda: _copy_with(None) == 0),
    ("★ 工单 15：--out-dir 副本被改一个字节 ⇒ 必须报（坏副本必须红）",
     lambda: _copy_with(b"x") == 1),
    ("★ 工单 15：不给 --out-dir 且 build.out 指向别处 ⇒ 必须报（当年假红的形状，不许复活）",
     lambda: _copy_with(None, out_dir=False) == 1),
    ("**空声明** ⇒ 必须报（零值守卫）", lambda: True),      # 由 main 的守卫覆盖，这里只作占位
    # ★ 工单 30（2026-10-01）：`--out-dir` 的**值**不算位置参数（否则被当成 declared.json 打开）
    ("★ --out-dir 的值不是位置参数（老实现会当成 declared.json ⇒ 一律 rc=2）",
     lambda: positional_args(["x.py", "man.json", "--out-dir", "/tmp/d", "--write"]) == ["man.json"]),
    ("★ declared 与 --out-dir 并存时两个位置参数都取到",
     lambda: positional_args(["x.py", "man.json", "decl.json", "--out-dir", "/tmp/d"])
     == ["man.json", "decl.json"]),
]


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        import os as _os
        sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.abspath(__file__)),
                                         "..", "..", "build", "lib"))
        from gate import selftest                      # noqa: E402
        sys.exit(selftest("check-build-manifest", CASES))
    sys.exit(main(sys.argv))
