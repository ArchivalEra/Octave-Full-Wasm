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


def headers_for(path, coi=True):
    """纯函数：给一个路径返回该加的响应头（自证直接喂它）。"""
    h = []
    if coi:
        h += COI_HEADERS
    return h


def mime_for(path):
    return MIME.get(os.path.splitext(path)[1].lower()) or "application/octet-stream"


class Handler(http.server.SimpleHTTPRequestHandler):
    coi = True

    def end_headers(self):
        for k, v in headers_for(self.path, self.coi):
            self.send_header(k, v)
        super().end_headers()

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
CASES = [
    ("带头 ⇒ 两个头都在", lambda: dict(headers_for("/x", True)) ==
     {"Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp"}),
    ("★ 不带头 ⇒ 一个头都不加（否则 8770 那台就测不出基础档）",
     lambda: headers_for("/x", False) == []),
    (".wasm ⇒ application/wasm", lambda: mime_for("/a/octave.wasm") == "application/wasm"),
    (".data ⇒ 二进制（不是 text/plain）", lambda: mime_for("/octave.data") == "application/octet-stream"),
    ("未知扩展名 ⇒ 二进制兜底", lambda: mime_for("/x.weird") == "application/octet-stream"),
]


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
