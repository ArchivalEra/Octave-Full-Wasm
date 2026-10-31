#!/usr/bin/env python3
# Octave-Full-Wasm — **带 COI 头的静态服务**（B6，2026-09-27）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

"""静态服务，可选地给每个响应加上让页面**跨源隔离**（COI）的两个头。

## 为什么需要它

线程档产物（`-pthread`）的 wasm 内存是 **shared**，而 shared memory 要求页面处于
**跨源隔离**状态才拿得到 `SharedArrayBuffer`：

    Cross-Origin-Opener-Policy: same-origin
    Cross-Origin-Embedder-Policy: require-corp

`python3 -m http.server` 发不了这两个头 ⇒ 线程档在它上面**选不中**（页面会老老实实落到
基础档）。本脚本就是"**要求宿主发 COI 头**"这条决定的本地实现 + 部署参考：
自家站点（8761/8768）用它；别人的静态托管发不了头的话，行为与不发头时一致 —— 落回基础档。

## 两档都能测（这是它存在的一半理由）

`--no-coi` 起一个**不发头**的实例，指向**同一个目录** ⇒ 同一份产物、两种头部形态，
`test/browser/probe-lane.mjs` 靠这一对服务器验"选档对不对"以及"选错档必须响亮地失败"。

## 缓存策略（2026-10-30，OM mail/030 的实测逼出来的）

**`no-cache` + `ETag`，不是"不发头"也不是 `no-store`。** 三者的实测差别（OM 在它仓量、
我方在此复核：不发头时两次刷新各传 31 MB 全量）：

| 头 | 第 2/3 次刷新 | 问题 |
|---|---|---|
| `no-store` | 全量重传 | **禁用缓存**：74 MB 每次刷新都重下 |
| 不发头 | 全量重传（无 ETag 时） | 浏览器不可重验，只能整份拿 |
| **`no-cache` + `ETag`** | **304，几百字节** | 没变就 304，变了才 200 |

为什么必须**重验**而不是"干脆允许缓存"：本仓纪律「不许用老产物」要求页面每次拿到的是
当前站点的字节 —— `no-cache` 正是"问一句"的语义（语义上等价于 must-revalidate，
但会让离线副本也重验），配 `ETag` 后代价只有几百字节。
**不发 `no-store`**（那是禁用缓存的另一头，OM 实测每次重下 74 MB）。

用法：
  python3 build/serve-coi.py --dir <站点目录> --port 8761           # 带头（线程档会被选中）
  python3 build/serve-coi.py --dir <站点目录> --port 8770 --no-coi  # 不带头（落回基础档）
  python3 build/serve-coi.py --selftest
"""
import argparse
import functools
import http.server
import os
import socketserver
import sys

COI_HEADERS = [
    ("Cross-Origin-Opener-Policy", "same-origin"),
    ("Cross-Origin-Embedder-Policy", "require-corp"),
]
# ⚠️ .wasm 必须是 application/wasm：`WebAssembly.instantiateStreaming` 只认它；
#    我们自己走 arrayBuffer 不受影响，但别的消费者（探针、第三方）会踩。
MIME = {
    ".wasm": "application/wasm",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".js.map": "application/json",
    ".data": "application/octet-stream",
    ".json": "application/json",
    ".html": "text/html; charset=utf-8",
    ".css": "text/css",
    ".otf": "font/otf",
    ".ttf": "font/ttf",
    ".svg": "image/svg+xml",
    ".png": "image/png",
}


def headers_for(path, coi=True, etag=None):
    """纯函数：给一个路径返回该加的响应头（自证直接喂它）。

    `etag` 给了才发 `ETag` + `Cache-Control: no-cache`（见文件头"缓存策略"）。
    """
    h = []
    if coi:
        h += COI_HEADERS
    if etag:
        h.append(("ETag", etag))
        h.append(("Cache-Control", "no-cache"))
    return h


def etag_for(st):
    """由 stat 结果派生的弱 ETag（size + mtime_ns）。不需要读文件内容。"""
    return 'W/"%x-%x"' % (st.st_size, st.st_mtime_ns)


def mime_for(path):
    return MIME.get(os.path.splitext(path)[1].lower()) or "application/octet-stream"


class Handler(http.server.SimpleHTTPRequestHandler):
    coi = True

    def end_headers(self):
        etag = None
        p = self.translate_path(self.path)
        try:
            if os.path.isfile(p):
                etag = etag_for(os.stat(p))
        except OSError:
            etag = None
        for k, v in headers_for(self.path, self.coi, etag):
            self.send_header(k, v)
        super().end_headers()

    def send_head(self):
        """给 `SimpleHTTPRequestHandler` 补 304：客户端带 If-None-Match 且 ETag 相同时
        只回 304（几百字节），不传文件体。这是"重验"的实际兑现。"""
        path = self.translate_path(self.path)
        inm = self.headers.get("If-None-Match")
        if inm and os.path.isfile(path):
            try:
                cur = etag_for(os.stat(path))
            except OSError:
                cur = None
            if cur and inm == cur:
                # ⚠️ 只 send_response，不要重复发 ETag/Cache-Control ——
                #    end_headers() 会按当前路径再发一遍（实测会出两份同名头）。
                self.send_response(304)
                self.end_headers()
                return None
        return super().send_head()

    def log_message(self, fmt, *args):        # 保持安静（探针自己会断言，日志没用）
        pass


def main(argv):
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--dir", default=".")
    ap.add_argument("--port", type=int, default=8761)
    ap.add_argument("--bind", default="127.0.0.1")
    ap.add_argument("--no-coi", action="store_true", help="不发 COOP/COEP（测基础档）")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args(argv)

    if a.selftest:
        return selftest()
    if not os.path.isdir(a.dir):
        print("FATAL: 目录不存在：%s" % a.dir, file=sys.stderr)
        return 2
    Handler.coi = not a.no_coi
    handler = functools.partial(lambda *args, **kw: Handler(*args, directory=a.dir, **kw))
    # 允许端口复用（反复起停时不至于 TIME_WAIT 卡住；8761 经常是刚被 kill 的）
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer((a.bind, a.port), handler) as srv:
        print("服务 %s → http://%s:%d/   COI=%s%s"
              % (a.dir, a.bind, a.port, not a.no_coi,
                 "（线程档会被选中）" if not a.no_coi else "（**不发头** ⇒ 落回基础档）"),
              file=sys.stderr)
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            pass
    return 0


# ── 自证：纯函数部分（头 / MIME）。不注册进 gates-selftest（它不是闸门，是服务）──────
class _Stat:
    """自证用的 stat 替身（只有 etag_for 需要的两个字段）。"""

    def __init__(self, size, mtime_ns):
        self.st_size = size
        self.st_mtime_ns = mtime_ns


def _e2e_cases():
    """★ **端到端**自证：真起一个临时服务、真发 HTTP 请求、真看状态码与体长。

    为什么必须有这一段（2026-10-30，OM `mail/032` 的自查点醒）：上面那批全是**纯字符串
    断言**（`headers_for` 里有没有那个键），它们只证明"头拼对了"，证明不了
    "带 `If-None-Match` 时服务**真的**回 304、**真的**不传文件体"。
    **测了头 ≠ 测了行为** —— 闸门可以是绿的，而绿的语义是假的。
    同族前例：`bad.join` 那条崩溃（套件崩了不出汇总行，看起来像挂死）。
    """
    import http.client
    import tempfile
    import threading

    cases = []

    def _serve_once(tmpdir):
        """起一个临时服务（端口 0 = 内核分配），返回 (port, shutdown_fn)。"""
        socketserver.TCPServer.allow_reuse_address = True
        handler = functools.partial(lambda *a, **kw: Handler(*a, directory=tmpdir, **kw))
        srv = socketserver.TCPServer(("127.0.0.1", 0), handler)
        t = threading.Thread(target=srv.serve_forever, daemon=True)
        t.start()
        return srv.server_address[1], lambda: (srv.shutdown(), srv.server_close())

    def _req(port, path, hdrs):
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        c.request("GET", path, headers=hdrs)
        r = c.getresponse()
        body = r.read()
        h = dict(r.getheaders())
        c.close()
        return r.status, body, h

    def _with_tmp(fn):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "a.bin"), "wb") as fh:
                fh.write(b"x" * 4096)
            port, stop = _serve_once(d)
            try:
                return fn(port)
            finally:
                stop()

    def _same_etag_304(port):
        st, _b, h = _req(port, "/a.bin", {})
        et = h.get("ETag")
        if not et:
            return False
        st2, body2, h2 = _req(port, "/a.bin", {"If-None-Match": et})
        return st2 == 304 and len(body2) == 0

    def _mismatch_200(port):
        st, body, _h = _req(port, "/a.bin", {"If-None-Match": 'W/"deadbeef-0"'})
        return st == 200 and len(body) == 4096

    def _no_conditional_200(port):
        st, body, h = _req(port, "/a.bin", {})
        return st == 200 and len(body) == 4096 and h.get("Cache-Control") == "no-cache"

    def _304_headers_not_duplicated(port):
        """★ 反向：304 响应里 ETag/Cache-Control 各只许一份（实测踩过重复发的坑）。"""
        st, _b, h = _req(port, "/a.bin", {})
        et = h.get("ETag")
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        c.request("GET", "/a.bin", headers={"If-None-Match": et})
        r = c.getresponse()
        r.read()
        names = [k.lower() for k, _v in r.getheaders()]
        c.close()
        return names.count("etag") <= 1 and names.count("cache-control") <= 1

    cases.append(("★ 端到端：同 ETag ⇒ 真回 304 且体长 0",
                  lambda: _with_tmp(_same_etag_304)))
    cases.append(("★ 端到端：ETag 不匹配 ⇒ 200 且真传 4096 B（不许恒 304）",
                  lambda: _with_tmp(_mismatch_200)))
    cases.append(("★ 端到端：不带条件 ⇒ 200 全量 + Cache-Control: no-cache",
                  lambda: _with_tmp(_no_conditional_200)))
    cases.append(("★ 端到端反向：304 响应里 ETag/Cache-Control 各只一份（防重复发）",
                  lambda: _with_tmp(_304_headers_not_duplicated)))
    return cases


CASES = [
    ("带头 ⇒ 两个头都在", lambda: dict(headers_for("/x", True)) ==
     {"Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp"}),
    ("★ 不带头 ⇒ 一个头都不加（否则 8770 那台就测不出基础档）",
     lambda: headers_for("/x", False) == []),
    (".wasm ⇒ application/wasm", lambda: mime_for("/a/octave.wasm") == "application/wasm"),
    (".data ⇒ 二进制（不是 text/plain）", lambda: mime_for("/octave.data") == "application/octet-stream"),
    ("未知扩展名 ⇒ 二进制兜底", lambda: mime_for("/x.weird") == "application/octet-stream"),
    # ★ 缓存三态（2026-10-30，OM mail/030 实测逼出来的）：正 / 反 / 空
    ("给了 etag ⇒ 发 ETag + Cache-Control: no-cache",
     lambda: dict(headers_for("/x", True, 'W/"1-2"')).get("Cache-Control") == "no-cache"
     and dict(headers_for("/x", True, 'W/"1-2"')).get("ETag") == 'W/"1-2"'),
    ("★ 反向：任何路径都**不许**发 no-store（那是禁用缓存，实测每次重下 74 MB）",
     lambda: all("no-store" not in v
                 for coi in (True, False) for et in (None, 'W/"1-2"')
                 for _k, v in headers_for("/x", coi, et))),
    ("★ 空输入：没给 etag ⇒ 不发任何缓存头（不许编一个假 ETag）",
     lambda: [k for k, _ in headers_for("/x", True, None) if k in ("ETag", "Cache-Control")] == []),
    ("etag_for 由 size+mtime 派生且稳定（同一 stat 两次同值）",
     lambda: (lambda st: etag_for(st) == etag_for(st))(_Stat(1234, 5678))),
] + _e2e_cases()


def selftest():
    bad = 0
    for name, fn in CASES:
        try:
            ok = bool(fn())
        except Exception as e:                        # noqa: BLE001
            ok, name = False, "%s（异常 %r）" % (name, e)
        print("%s | %s" % ("PASS" if ok else "fail", name))
        bad += 0 if ok else 1
    print("=== serve-coi 自证：%d PASS / %d fail ===" % (len(CASES) - bad, bad))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
