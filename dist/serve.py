#!/usr/bin/env python3
"""Octave-Full-Wasm 站点本地/自托管服务脚本（纯静态，零服务端计算）。

与 python -m http.server 的差别，恰好是这类站点真正踩坑的三点：
  1. `.wasm` 必须回 `application/wasm`，否则浏览器放弃流式编译、退化报错；
  2. 有 `.gz` 同名文件且客户端接受 gzip 时直接发 `.gz`（nginx gzip_static 的等价物），
     —— 本包体积的大头全靠这一步，别让服务器现压；
  3. `.oct` 按 `application/octet-stream` 发（浏览器要 fetch 它进 wasm 文件系统）。

★ 4（B6 起）：**默认发跨源隔离头** `Cross-Origin-Opener-Policy: same-origin` +
  `Cross-Origin-Embedder-Policy: require-corp` —— 站点里带**线程档**（`threads/`），页面按这两个头
  判断"能不能用 SharedArrayBuffer"；**不发**的话页面会**静默**落回基础档（不报错，只是没线程）。
  想专门测"基础档那一侧"（或本来就打算把这份包当纯静态站点发），用 `--no-coi`。

用法：python3 serve.py [端口] [目录] [--no-coi]
"""
import gzip
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

MIME = {
    ".wasm": "application/wasm",
    ".oct": "application/octet-stream",
    ".m": "text/plain; charset=utf-8",
    ".data": "application/octet-stream",
    ".js": "text/javascript; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".texi": "text/plain; charset=utf-8",
}


class Handler(SimpleHTTPRequestHandler):
    # 默认发跨源隔离头（B6：线程档的物理前提）。`--no-coi` 时关掉 —— 那正是
    # "宿主不发头 ⇒ 页面落基础档"那条回退路径的**本地复现方式**。
    NO_COI = False

    def end_headers(self):
        if not self.NO_COI:
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()

    def guess_type(self, path):
        ext = os.path.splitext(path)[1].lower()
        return MIME.get(ext, super().guess_type(path))

    def send_head(self):
        accept = self.headers.get("Accept-Encoding", "") or ""
        path = self.translate_path(self.path)
        if "gzip" not in accept or path.endswith(".gz"):
            return super().send_head()
        if not os.path.isfile(path) or not os.path.isfile(path + ".gz"):
            return super().send_head()
        try:
            f = open(path + ".gz", "rb")
        except OSError:
            return super().send_head()
        fs = os.fstat(f.fileno())
        self.send_response(200)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(fs.st_size))
        self.send_header("Last-Modified", self.date_time_string(fs.st_mtime))
        self.send_header("Vary", "Accept-Encoding")
        self.end_headers()
        return f

    def log_message(self, fmt, *args):  # 安静一点，但保留错误
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    args = [a for a in sys.argv[1:] if a != "--no-coi"]
    no_coi = "--no-coi" in sys.argv[1:]
    port = int(args[0]) if len(args) > 0 else 8080
    root = args[1] if len(args) > 1 else os.path.dirname(os.path.abspath(__file__))
    Handler.NO_COI = no_coi
    handler = partial(Handler, directory=root)
    print("serving %s on http://127.0.0.1:%d/  (wasm MIME + gzip_static%s)"
          % (root, port, "；--no-coi：不发跨源隔离头 ⇒ 页面会落基础档" if no_coi
             else "；已发 COOP/COEP ⇒ 线程档可用"))
    ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()


if __name__ == "__main__":
    main()
