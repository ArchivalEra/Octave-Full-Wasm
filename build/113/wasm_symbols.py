#!/usr/bin/env python3
# Octave-Full-Wasm — **wasm 符号表读取**（只读；import/export 段的最小解析器）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

"""读 wasm 模块的 import / export 名字（不依赖 llvm-nm，宿主/容器都能跑）。

## 为什么有它

B6 验收期（2026-09-27）连续抓到两条"side module 引用了主模块给不了的符号"的事故
（`__cxa_guard_*`、slicot 的 `dgemm_` 等）。判这类问题的**真值**是符号表，不是文件大小、
不是"有没有 atomics 字符串"（后者对链接后的模块根本不存在，见 `atomics_scan.py` 头注）。
本仓已有 `llvm-nm` 这条路（容器里在 `/emsdk/upstream/bin/llvm-nm`），但宿主侧的
`stage-lane-assets.sh` 也要用 ⇒ 自带一个**零依赖**解析器当公共底座。

⚠️ 只解析 import(2)/export(7) 两段，其余段**跳过**（按 LEB 长度走）——这是刻意的小：
   判据只需要名字，不需要解析整个模块。
⚠️ **弱导入不计入问题**：emscripten 把弱导入解析成 null，没被调用就不崩。本解析器分不出
   弱/强（那在 linking 自定义段里），所以"哪些导入算问题"由调用方（`check-oct-lane.py`
   判据③）用"与基础档**同模块**的导入差集"来界定 —— 车道与基础档是同一份源码编的，
   多出来的导入才是嫌疑对象。

用法：
  python3 build/113/wasm_symbols.py imports <file.wasm> [--mod env]
  python3 build/113/wasm_symbols.py exports <file.wasm>
  python3 build/113/wasm_symbols.py --selftest
"""
import sys


def _uleb(b, p):
    r = 0
    s = 0
    while True:
        x = b[p]
        p += 1
        r |= (x & 0x7F) << s
        s += 7
        if not (x & 0x80):
            return r, p


def _sections(b):
    pos = 8
    while pos < len(b):
        sid = b[pos]
        pos += 1
        size, pos = _uleb(b, pos)
        yield sid, pos, pos + size
        pos += size


def _read_name(b, p):
    ln, p = _uleb(b, p)
    return b[p:p + ln].decode("utf-8", "replace"), p + ln


def imports(path, mods=("env",)):
    """返回 [(module, name)]；mods=None 时不过滤。"""
    with open(path, "rb") as fh:
        b = fh.read()
    if b[:4] != b"\0asm":
        raise ValueError("不是 wasm：%s" % path)
    out = []
    for sid, p, end in _sections(b):
        if sid != 2:
            continue
        n, p = _uleb(b, p)
        for _ in range(n):
            mod, p = _read_name(b, p)
            nm, p = _read_name(b, p)
            kind = b[p]
            p += 1
            if kind == 0:                      # func：typeidx
                _t, p = _uleb(b, p)
            elif kind == 1:                    # table：elemtype + limits
                p += 2
                _mn, p = _uleb(b, p)
                if b[p - 2] & 1:
                    _mx, p = _uleb(b, p)
            elif kind == 2:                    # memory：limits
                fl = b[p]
                p += 1
                _mn, p = _uleb(b, p)
                if fl & 1:
                    _mx, p = _uleb(b, p)
            elif kind == 3:                    # global：valtype + mut
                p += 2
            if mods is None or mod in mods:
                out.append((mod, nm))
        return out
    return []


def exports(path):
    with open(path, "rb") as fh:
        b = fh.read()
    if b[:4] != b"\0asm":
        raise ValueError("不是 wasm：%s" % path)
    out = []
    for sid, p, end in _sections(b):
        if sid != 7:
            continue
        n, p = _uleb(b, p)
        for _ in range(n):
            nm, p = _read_name(b, p)
            kind = b[p]
            p += 1
            _idx, p = _uleb(b, p)
            out.append(nm)
        return out
    return []


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if len(argv) < 2 or argv[0] not in ("imports", "exports"):
        print(__doc__.strip().split("用法：")[-1].strip(), file=sys.stderr)
        return 2
    mod = None
    if "--mod" in argv:
        i = argv.index("--mod")
        mod = argv[i + 1]
        argv = argv[:i] + argv[i + 2:]
    if argv[0] == "imports":
        for m, n in imports(argv[1], None if mod is None else (mod,)):
            print("%s.%s" % (m, n))
    else:
        for n in exports(argv[1]):
            print(n)
    return 0


# ── 自证（合成 wasm：解析正确 / 坏文件必须报 / 空段不炸）─────────────────────────
def _uleb_bytes(n):
    out = bytearray()
    while True:
        b7 = n & 0x7F
        n >>= 7
        if n:
            out.append(b7 | 0x80)
        else:
            out.append(b7)
            return bytes(out)


def _name_bytes(s):
    b = s.encode()
    return _uleb_bytes(len(b)) + b


def _sect(sid, payload):
    return bytes([sid]) + _uleb_bytes(len(payload)) + payload


def make_wasm(import_names=(), export_names=()):
    """合成一个只带 import/export 两段的 wasm（自证夹具；不是合法可执行模块，够解析即可）。"""
    imp = _uleb_bytes(len(import_names))
    for n in import_names:
        imp += _name_bytes("env") + _name_bytes(n) + b"\x00" + _uleb_bytes(0)
    exp = _uleb_bytes(len(export_names))
    for n in export_names:
        exp += _name_bytes(n) + b"\x00" + _uleb_bytes(0)
    return b"\0asm\x01\0\0\0" + _sect(2, imp) + _sect(7, exp)


def selftest():
    import os
    import tempfile
    cases = []
    fd, p = tempfile.mkstemp(suffix=".wasm")
    with os.fdopen(fd, "wb") as fh:
        fh.write(make_wasm(("dgemm_", "foo"), ("bar",)))
    cases = [
        ("导入按序解析（module/name）", lambda: imports(p) == [("env", "dgemm_"), ("env", "foo")]),
        ("导出按序解析", lambda: exports(p) == ["bar"]),
        ("空导入/空导出模块 ⇒ 空列表不炸", lambda: (
            lambda q: imports(q) == [] and exports(q) == [])((
                lambda: (lambda fd2, q: (os.close(fd2), q)[1])(
                    os.open(q := p + "2", os.O_CREAT | os.O_WRONLY),
                    q))()
        ) if True else None),
    ]
    # 上面第三条绕得太厉害，直接补一个干净版本
    q = p + ".empty"
    with open(q, "wb") as fh:
        fh.write(make_wasm())
    cases[2] = ("空导入/空导出模块 ⇒ 空列表不炸",
                lambda: imports(q) == [] and exports(q) == [])
    bad_p = p + ".bad"
    with open(bad_p, "wb") as fh:
        fh.write(b"not-wasm")
    cases += [
        ("★ 非 wasm 文件 ⇒ 必须报错（不许当空表静默通过）",
         lambda: _raises(lambda: imports(bad_p))),
        ("★ 魔数对但**截断**的段长度 ⇒ 必须报错（不许静默返回半份）",
         lambda: _raises(lambda: imports(p + ".trunc"))),
    ]
    with open(p + ".trunc", "wb") as fh:
        fh.write(b"\0asm\x01\0\0\0" + _sect(2, _uleb_bytes(3) + _name_bytes("env")))
    bad = 0
    for name, fn in cases:
        try:
            ok = bool(fn())
        except Exception as e:                    # noqa: BLE001
            ok, name = False, "%s（异常 %r）" % (name, e)
        print("%s | %s" % ("PASS" if ok else "fail", name))
        bad += 0 if ok else 1
    print("=== wasm_symbols 自证：%d PASS / %d fail ===" % (len(cases) - bad, bad))
    for q in (p, p + "2", q, bad_p, p + ".trunc"):
        try:
            os.unlink(q)
        except OSError:
            pass
    return 1 if bad else 0


def _raises(fn):
    try:
        fn()
    except Exception:                             # noqa: BLE001
        return True
    return False


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
