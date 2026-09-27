#!/usr/bin/env python3
# Octave-Full-Wasm — **两档资产清单**：把 `.oct` 那部分分档（B6，2026-09-27）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

"""从基础清单生成**线程档清单**（`assets/manifest.threads.json`）。

## 为什么需要它（实测依据）

`NOTES-threads.md` 的 B5 实验：**非 atomics 编的 side module 在 shared-memory 主模块里连 dlopen
都过不去**（`TypeError: tlsInitFunc is not a function`）。而本站的 `.oct` 资产（`assets/oct/` 16 条 +
`assets/octdir/` 6 个包，全是 `.oct`，合计约 9MB）正是 non-atomics 编的 ⇒ **线程档必须有自己的一套
`.oct`**。其余资产（`.m` 包 / 文档 / 字体数据）两档**共用** —— 只有 `.oct` 分档，客户端下载量不变。

## 怎么分（改动面最小）

清单里每条资产都带显式 `url`（`kind:oct`）或 `base_url`（`kind:octdir`，配 `files` 列表）⇒
"分档"= **换一份清单**，把这两类的前缀指到
`assets/oct-threads/`、`assets/octdir-threads/`；**其余条目逐字不动**。加载器那边一行都不用改
（它本来就有 `init(url)` 这个注入点，内核按档传）。

用法：
  python3 build/113/make-lane-manifest.py <站点 assets 目录>            # 生成
  python3 build/113/make-lane-manifest.py <站点 assets 目录> --check    # 只校验（不写）
  python3 build/113/make-lane-manifest.py --selftest
"""
import hashlib
import io
import json
import os
import sys

REWRITE = {"oct": ("assets/oct/", "assets/oct-threads/"),
           "octdir": ("assets/octdir/", "assets/octdir-threads/")}
BASE = "manifest.json"
LANE = "manifest.threads.json"
LANE_KEYS = ("oct", "octdir")          # 只有这两类分档


def rewrite_entry(a):
    """返回 (新条目, 是否改过)。只动 oct/octdir 的路径前缀，别的键一律原样。"""
    kind = a.get("kind")
    if kind not in REWRITE:
        return dict(a), False
    old, new = REWRITE[kind]
    b = dict(a)
    changed = False
    for key in ("url", "base_url"):
        v = b.get(key)
        if isinstance(v, str) and v.startswith(old):
            b[key] = new + v[len(old):]
            changed = True
    return b, changed


def rel_to_assets(url, assets_dir):
    """清单里的 url 是**相对站点根**的（`assets/oct-threads/x.oct`），而本模块的入参是
    `<站点>/assets` ⇒ 必须把开头的 `assets/` 剥掉再接，否则得到 `assets/assets/...`
    （实测踩到：判据把**已经落好的**文件全报成"不存在"）。"""
    rel = url.split("assets/", 1)[-1] if url.startswith("assets/") else url
    return os.path.join(assets_dir, rel)


def path_of(a, assets_dir):
    """条目在磁盘上的路径（url 型取 url，octdir 型取 base_url）；取不到返回 None。"""
    if a.get("kind") == "oct":
        return rel_to_assets(a.get("url") or "", assets_dir)
    if a.get("kind") == "octdir":
        return rel_to_assets(a.get("base_url") or "", assets_dir)
    return None


def _sha_of_path(p):
    """**整文件**分块读（不是只读头 1MB —— `atomics_scan.py` 曾在截断读上假红过一次）。"""
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sync_shas(lane, assets_dir, sha_of=None, exists=os.path.exists):
    """把**改写后**的条目 sha256 按磁盘实际字节重算，返回改了几条。

    ★ 本生成器的头号陷阱（2026-09-27 实测事故）：只改 `url` 不改 `sha256` ⇒ 加载器
      **fail-closed 拒载**（"资产校验失败 webio（期望 d6efe987… 实得 4e1bde27…）"），
      线程档于是"页面能开、所有 .oct 功能全无"：accept-archive 0/20、accept-dldfcn 11/60。
      所以"生成"这一步就必须同步，不能只靠事后校验。
    """
    sha_of = sha_of or _sha_of_path
    n = 0
    for a in lane.get("assets", []):
        if a.get("kind") not in REWRITE or "sha256" not in a:
            continue
        p = path_of(a, assets_dir)
        if not p or not exists(p):
            continue                       # 缺件由 `checks()` 报，这里不掩盖
        new = sha_of(p)
        if new != a.get("sha256"):
            a["sha256"] = new
            n += 1
    return n


def build_lane_manifest(man, assets_dir=None, sha_of=None):
    out = dict(man)
    out["assets"] = []
    n = 0
    for a in man.get("assets", []):
        b, changed = rewrite_entry(a)
        n += 1 if changed else 0
        out["assets"].append(b)
    out["_lane"] = {"for": "threads",
                    "why": "只有 `.oct`（oct/octdir）分档；其余与基础清单逐字相同",
                    "rewritten": n}
    if assets_dir:
        out["_lane"]["sha_resynced"] = sync_shas(out, assets_dir, sha_of)
    return out, n


def checks(man, lane, assets_dir, exists=os.path.exists, sha_of=None):
    """返回问题清单。四类判据都能证伪。"""
    sha_of = sha_of or _sha_of_path
    bad = []
    base_oct = [a for a in man.get("assets", []) if a.get("kind") in LANE_KEYS]
    lane_oct = [a for a in lane.get("assets", []) if a.get("kind") in LANE_KEYS]
    if not base_oct:
        bad.append("基础清单里一条 oct/octdir 都没有 ⇒ 这个生成器在空转（零值守卫）")
    # ① 每条 oct/octdir 都必须改写（漏一条 = 线程档会去载基础档的 .oct ⇒ dlopen 失败）
    for a in lane_oct:
        kind = a.get("kind")
        old, new = REWRITE[kind]
        for key in ("url", "base_url"):
            v = a.get(key)
            if isinstance(v, str) and v.startswith(old):
                bad.append("%s 的 %s 未被改写（仍是 %s）" % (a.get("name"), key, v))
    # ② 改写后的路径必须真实存在（目录型看目录）
    for a in lane_oct:
        kind = a.get("kind")
        if kind == "oct":
            url = a.get("url", "")
            p = rel_to_assets(url, assets_dir)
            if not exists(p):
                bad.append("线程档资产不存在：%s（找的是 %s）" % (url, p))
        else:
            p = os.path.join(assets_dir, (a.get("base_url") or "").split("/", 1)[-1])
            if not exists(p):
                bad.append("线程档目录不存在：%s" % a.get("base_url"))
            else:
                for f in a.get("files") or []:
                    if not exists(os.path.join(p, f)):
                        bad.append("线程档目录缺文件：%s/%s" % (a.get("base_url"), f))
                        break
    # ③ 反向：**非 oct/octdir** 的条目必须逐字相同（证明"只差 .oct"）
    keep = lambda lst: [a for a in lst if a.get("kind") not in LANE_KEYS]
    if keep(man.get("assets", [])) != keep(lane.get("assets", [])):
        bad.append("非 oct/octdir 的条目**不一致** ⇒ 分档改动面超出预期（应逐字相同）")
    # ④ **两档清单里带 sha256 的条目，sha 必须与磁盘字节一致**（实测事故：只改路径不改 sha ⇒
    #    加载器 fail-closed 拒载 ⇒ 线程档"页面能开、.oct 功能全无"，而所有构建自检都是绿的）
    for tag, m in (("基础", man), ("线程档", lane)):
        for a in m.get("assets", []):
            if a.get("kind") not in LANE_KEYS or "sha256" not in a:
                continue
            p = path_of(a, assets_dir) or ""
            if not exists(p):
                continue                   # 缺件由 ② / 落地判据负责
            got = sha_of(p)
            if got != a.get("sha256"):
                bad.append("%s清单的 %s 的 sha256 与磁盘不符（清单 %s… 磁盘 %s…）"
                           % (tag, a.get("name"), str(a.get("sha256"))[:12], str(got)[:12]))
    return bad


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if len(argv) < 1:
        print(__doc__.strip().split("用法：")[-1].strip(), file=sys.stderr)
        return 2
    d = argv[0]
    p_base, p_lane = os.path.join(d, BASE), os.path.join(d, LANE)
    with io.open(p_base, encoding="utf-8") as fh:
        man = json.load(fh)
    if "--check" in argv:
        if not os.path.exists(p_lane):
            print("FATAL: 缺 %s（先跑本脚本生成）" % p_lane, file=sys.stderr)
            return 2
        with io.open(p_lane, encoding="utf-8") as fh:
            lane = json.load(fh)
        bad = checks(man, lane, d)
        for b in bad:
            print("   ✗ %s" % b)
        if bad:
            print("线程档清单**不合格**（%d 条）" % len(bad), file=sys.stderr)
            return 1
        n = sum(1 for a in lane.get("assets", []) if a.get("kind") in LANE_KEYS)
        print("线程档清单 OK：%d 条 oct/octdir 已分档，其余条目与基础清单逐字相同" % n)
        return 0
    lane, n = build_lane_manifest(man, d)
    with io.open(p_lane, "w", encoding="utf-8") as fh:
        json.dump(lane, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    print("已写出 %s（改写 %d 条 oct/octdir，sha 按磁盘重算 %d 条）"
          % (p_lane, n, (lane.get("_lane") or {}).get("sha_resynced", 0)))
    bad = checks(man, lane, d)
    for b in bad:
        print("   ⚠️ %s" % b)
    return 1 if bad else 0


# ── 自证（三类：改写正确 / 漏改必须被抓 / 空清单必须报）────────────────────────
_MAN = {"assets": [
    {"name": "a", "kind": "oct", "url": "assets/oct/a.oct", "sha256": "AA"},
    {"name": "d", "kind": "octdir", "base_url": "assets/octdir/d", "files": ["x.oct"]},
    {"name": "m", "kind": "js", "url": "assets/pkg/m.js"},
]}
_ALL = lambda _p: True                                    # noqa: E731
# 假 sha：`BB` 就是"磁盘上的真实字节"，用来构造"清单写 AA / 磁盘是 BB"的事故形状。
_SHA = lambda _p: "BB"                                    # noqa: E731


def _lane_of(env=None):
    return build_lane_manifest(_MAN)[0]


def _man_synced():
    """基础清单也带**正确** sha（BB）的版本 —— 用来测"正常不报"那一档。"""
    m = {"assets": [dict(a) for a in _MAN["assets"]]}
    m["assets"][0]["sha256"] = "BB"
    return m


def _lane_synced():
    return build_lane_manifest(_man_synced(), "/tmp", _SHA)[0]


CASES = [
    ("oct 的 url 前缀被改写", lambda: _lane_of()["assets"][0]["url"] == "assets/oct-threads/a.oct"),
    ("octdir 的 base_url 被改写", lambda: _lane_of()["assets"][1]["base_url"] == "assets/octdir-threads/d"),
    ("非 oct 条目**逐字不动**", lambda: _lane_of()["assets"][2] == _MAN["assets"][2]),
    ("★ 漏改一条 ⇒ --check 必须报", lambda: bool(checks(
        _MAN, {"assets": [_MAN["assets"][0], _MAN["assets"][1], _MAN["assets"][2]]},
        "/tmp", _ALL, _SHA))),
    ("★ 改写后路径不存在 ⇒ 必须报", lambda: bool(checks(
        _MAN, _lane_of(), "/tmp", lambda p: False, _SHA))),
    ("★ 非 oct 条目被改动 ⇒ 必须报（证明分档只动 .oct）", lambda: bool(checks(
        _MAN, {"assets": [dict(_MAN["assets"][0], url="assets/oct-threads/a.oct"),
                          _MAN["assets"][1], dict(_MAN["assets"][2], url="x.js")]},
        "/tmp", _ALL, _SHA))),
    # ★ 本轮真事故的形状：只换路径、sha 留着基础档的 ⇒ 加载器 fail-closed 拒载（必须报）
    ("★ 只改路径不改 sha ⇒ **必须报**（8768 首跑 0/20 的真因）", lambda: bool(checks(
        _man_synced(), _lane_of(), "/tmp", _ALL, _SHA))),
    ("★ sha 按磁盘重算过 ⇒ 不报", lambda: not checks(
        _man_synced(), _lane_synced(), "/tmp", _ALL, _SHA)),
    ("★ sync_shas 真的把 sha 换成了磁盘值（返回条数也计）", lambda: (
        lambda l: sync_shas(l, "/tmp", _SHA, _ALL) == 1
        and l["assets"][0]["sha256"] == "BB")(_lane_of())),
    ("★ sync_shas 在**没有 oct 条目**时不空转报成功", lambda: sync_shas(
        {"assets": [{"name": "m", "kind": "js", "url": "x.js", "sha256": "AA"}]}, "/tmp", _SHA, _ALL) == 0),
    ("正常清单（路径都在 + sha 一致）⇒ 不报", lambda: not checks(
        _man_synced(), _lane_synced(), "/tmp", _ALL, _SHA)),
    ("**空清单** ⇒ 必须报（零值守卫：生成器空转）", lambda: bool(checks(
        {"assets": []}, {"assets": []}, "/tmp", _ALL, _SHA))),
]


def selftest():
    bad = 0
    for name, fn in CASES:
        try:
            ok = bool(fn())
        except Exception as e:                    # noqa: BLE001
            ok, name = False, "%s（异常 %r）" % (name, e)
        print("%s | %s" % ("PASS" if ok else "fail", name))
        bad += 0 if ok else 1
    print("=== make-lane-manifest 自证：%d PASS / %d fail ===" % (len(CASES) - bad, bad))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
