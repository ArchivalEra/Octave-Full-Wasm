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
import re
import sys

def rewrite_for(lane_name):
    return {"oct": ("assets/oct/", "assets/oct-%s/" % lane_name),
            "octdir": ("assets/octdir/", "assets/octdir-%s/" % lane_name)}


REWRITE = rewrite_for("threads")
BASE = "manifest.json"
LANE = "manifest.threads.json"
LANE_KEYS = ("oct", "octdir")          # 这两类**分档**（换一套 side module）
# ★ 第二类要改口的：**烤进产物的 install 前缀**（2026-09-27 实测事故 —— 见 `baked_prefix`）。
#   基础产物烤的是 `/src/work/octave-install`，线程档烤的是 `...-threads` ⇒ 清单里挂在
#   `<前缀>/share/octave/11.3.0/etc/...` 的那几个数据资产（built-in-docstrings / doc-cache /
#   macros.texi）**必须按档挂**，否则线程档的 `help` 直接报
#   `failed to open docstrings file: /src/work/octave-install-threads/share/.../built-in-docstrings`
#   （实测：accept-help 5 PASS / 7 FAIL，基础档 12/0 绿）。
PREFIX_RE = re.compile(rb"/src/work/octave-install[A-Za-z0-9_.-]*")


def baked_prefix(wasm_path):
    """从**产物里读出来**它烤进去的 install 前缀（不猜；产物不在 ⇒ None）。"""
    try:
        with open(wasm_path, "rb") as fh:
            hits = PREFIX_RE.findall(fh.read())
    except OSError:
        return None
    return sorted({h.decode() for h in hits}) or None


def rewrite_entry(a, mount_from=None, mount_to=None, rewrite_map=None):
    """返回 (新条目, 是否改过)。改三类：oct/octdir 的 url、以及 install 前缀下的 `mount`。"""
    rw = rewrite_map if rewrite_map is not None else REWRITE
    b = dict(a)
    changed = False
    kind = b.get("kind")
    if kind in rw:
        old, new = rw[kind]
        for key in ("url", "base_url"):
            v = b.get(key)
            if isinstance(v, str) and v.startswith(old):
                b[key] = new + v[len(old):]
                changed = True
    if mount_from and mount_to:
        v = b.get("mount")
        # ⚠️ 必须**排除已经改过口**的值：车道前缀是基础前缀的**扩展**
        #    （`/src/work/octave-install` ⊂ `/src/work/octave-install-threads`）⇒ 只判
        #    startswith(mount_from) 会把 `.../octave-install-threads/share` 再改一次，
        #    变成 `...-threads-threads/share`（前缀包含关系是判据的经典坑；自证第 5 条抓到的）。
        if isinstance(v, str) and v.startswith(mount_from) and not v.startswith(mount_to):
            b["mount"] = mount_to + v[len(mount_from):]
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


def sync_shas(lane, assets_dir, sha_of=None, exists=os.path.exists, lane_name="threads"):
    """把**改写后**的条目 sha256 按磁盘实际字节重算，返回改了几条。

    ★ 本生成器的头号陷阱（2026-09-27 实测事故）：只改 `url` 不改 `sha256` ⇒ 加载器
      **fail-closed 拒载**（"资产校验失败 webio（期望 d6efe987… 实得 4e1bde27…）"），
      车道档于是"页面能开、所有 .oct 功能全无"：accept-archive 0/20、accept-dldfcn 11/60。
      所以"生成"这一步就必须同步，不能只靠事后校验。
    """
    rw = rewrite_for(lane_name)
    sha_of = sha_of or _sha_of_path
    n = 0
    for a in lane.get("assets", []):
        if a.get("kind") not in rw or "sha256" not in a:
            continue
        p = path_of(a, assets_dir)
        if not p or not exists(p):
            continue                       # 缺件由 `checks()` 报，这里不掩盖
        new = sha_of(p)
        if new != a.get("sha256"):
            a["sha256"] = new
            n += 1
    return n


def build_lane_manifest(man, assets_dir=None, sha_of=None, mount_from=None, mount_to=None, lane_name="threads"):
    rw = rewrite_for(lane_name)
    out = dict(man)
    out["assets"] = []
    n = 0
    for a in man.get("assets", []):
        b, changed = rewrite_entry(a, mount_from, mount_to, rewrite_map=rw)
        n += 1 if changed else 0
        out["assets"].append(b)
    out["_lane"] = {"for": lane_name,
                    "why": "`.oct`（oct/octdir）分档 + 产物烤的 install 前缀改口；其余与基础清单逐字相同",
                    "rewritten": n}
    if mount_from and mount_to:
        out["_lane"]["mount_prefix"] = [mount_from, mount_to]
    if assets_dir:
        out["_lane"]["sha_resynced"] = sync_shas(out, assets_dir, sha_of, lane_name=lane_name)
    return out, n


def checks(man, lane, assets_dir, exists=os.path.exists, sha_of=None,
           mount_from=None, mount_to=None, lane_baked=None, lane_name="threads"):
    """返回问题清单。六类判据都能证伪。"""
    rw = rewrite_for(lane_name)
    sha_of = sha_of or _sha_of_path
    bad = []
    base_oct = [a for a in man.get("assets", []) if a.get("kind") in LANE_KEYS]
    lane_oct = [a for a in lane.get("assets", []) if a.get("kind") in LANE_KEYS]
    if not base_oct:
        bad.append("基础清单里一条 oct/octdir 都没有 ⇒ 这个生成器在空转（零值守卫）")
    # ① 每条 oct/octdir 都必须改写（漏一条 = 线程档会去载基础档的 .oct ⇒ dlopen 失败）
    for a in lane_oct:
        kind = a.get("kind")
        if kind in rw:
            old, new = rw[kind]
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
                bad.append("车道资产不存在：%s（找的是 %s）" % (url, p))
        else:
            p = os.path.join(assets_dir, (a.get("base_url") or "").split("/", 1)[-1])
            if not exists(p):
                bad.append("车道目录不存在：%s" % a.get("base_url"))
            else:
                for f in a.get("files") or []:
                    if not exists(os.path.join(p, f)):
                        bad.append("车道目录缺文件：%s/%s" % (a.get("base_url"), f))
                        break
    # ③ 反向：**非 oct/octdir** 的条目必须逐字相同（证明改动面只有"分档 + install 前缀"）。
    #    线程档里 `mount` 从基础前缀改成车道前缀 ⇒ 比对前把它**归一化回基础前缀**，
    #    这样"只差前缀"与"真的改坏了"能分开（否则这条判据会把正确产物判红）。
    def norm(a):
        b = dict(a)
        if mount_to and mount_from:
            v = b.get("mount")
            if isinstance(v, str) and v.startswith(mount_to):
                b["mount"] = mount_from + v[len(mount_to):]
        return b
    keep = lambda lst: [norm(a) for a in lst if a.get("kind") not in LANE_KEYS]
    if keep(man.get("assets", [])) != keep(lane.get("assets", [])):
        bad.append("非 oct/octdir 的条目**不一致** ⇒ 改动面超出预期（应只差 install 前缀）")
    # ⑤ **产物烤的 install 前缀必须在清单里被挂载**，且清单里不许残留**另一档**的前缀。
    #    真事故（2026-09-27）：线程档 wasm 烤的是 `/src/work/octave-install-threads`，而车道清单
    #    照抄了基础档的 `/src/work/octave-install` ⇒ `help` 报
    #    `failed to open docstrings file: /src/work/octave-install-threads/share/.../built-in-docstrings`
    #    （accept-help 5/7，基础档 12/0）。
    lane_mounts = [a.get("mount") for a in lane.get("assets", []) if isinstance(a.get("mount"), str)]
    base_mounts = [a.get("mount") for a in man.get("assets", []) if isinstance(a.get("mount"), str)]
    if mount_from and mount_to:
        if not any(m.startswith(mount_to) for m in lane_mounts):
            bad.append("车道清单里没有任何 `mount` 落在车道前缀 %s 下 ⇒ 产物要的路径没人挂载" % mount_to)
        # 同样排除更长的车道前缀（否则"正确产物"会被判成"残留基础前缀"）
        stale = sorted({m for m in lane_mounts
                        if m.startswith(mount_from) and not m.startswith(mount_to)})
        if stale:
            bad.append("车道清单里残留基础档前缀 %s 的 `mount`（%d 处，例：%s）⇒ 车道读不到"
                       % (mount_from, len(stale), stale[0]))
    if lane_baked:
        # 产物侧：wasm 里烤的车道前缀**必须**在清单里有对应挂载（这条是"产物说什么"的判据）
        if not any(m.startswith(lane_baked) for m in lane_mounts):
            bad.append("车道产物烤的前缀 %s 在清单里没有任何挂载（help/doc 会读不到）" % lane_baked)
        if not any(m.startswith(lane_baked) for m in base_mounts):
            pass                      # 基础档清单本来就不该有车道前缀
        else:
            bad.append("基础档清单里出现了车道前缀 %s 的挂载（挂错了档）" % lane_baked)
    # ④ **两档清单里带 sha256 的条目，sha 必须与磁盘字节一致**（实测事故：只改路径不改 sha ⇒
    #    加载器 fail-closed 拒载 ⇒ 线程档"页面能开、.oct 功能全无"，而所有构建自检都是绿的）
    for tag, m in (("基础", man), ("车道", lane)):
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


def _one(vals):
    """烤进去的前缀只允许一种（多种 ⇒ 不知道按哪个改口 ⇒ 返回 None 让调用方 FATAL）。"""
    return vals[0] if vals and len(vals) == 1 else None


def main(argv):
    if "--selftest" in argv:
        return selftest()
    lane_name = "threads"
    check_only = False
    args = []
    i = 0
    while i < len(argv):
        if argv[i] == "--lane":
            i += 1
            if i < len(argv):
                lane_name = argv[i]
        elif argv[i].startswith("--lane="):
            lane_name = argv[i].split("=", 1)[1]
        elif argv[i] == "--check":
            check_only = True
        else:
            args.append(argv[i])
        i += 1
    if len(args) < 1:
        print(__doc__.strip().split("用法：")[-1].strip(), file=sys.stderr)
        return 2
    d = args[0]
    site = os.path.dirname(os.path.abspath(d))
    p_base = os.path.join(d, BASE)
    p_lane = os.path.join(d, "manifest.%s.json" % lane_name)
    with io.open(p_base, encoding="utf-8") as fh:
        man = json.load(fh)
    # ★ 两档产物**烤进去的 install 前缀**：从 wasm 里**读**（不猜）。车道清单里挂在
    #   `<前缀>/share/octave/11.3.0/etc/...` 的数据资产必须跟着档走（见 `baked_prefix` 的注释）。
    mf = _one(baked_prefix(os.path.join(site, "octave.wasm")))
    cand_paths = [
        os.path.join(site, lane_name, "octave.wasm"),
        os.path.join(site, "%s-out" % lane_name, "octave.wasm"),
    ]
    mt = None
    for cand in cand_paths:
        if os.path.exists(cand):
            mt = _one(baked_prefix(cand))
            if mt:
                break
    need_prefix = any(isinstance(a.get("mount"), str)
                      and a["mount"].startswith("/src/work/octave-install")
                      for a in man.get("assets", []))
    if need_prefix and not (mf and mt):
        # fail-closed：要改口却读不到前缀 ⇒ 宁可拒绝，也不生成一份"挂错档"的清单
        print("FATAL: 基础清单里有 install 前缀的挂载，但读不到两档产物烤的前缀"
              "（基础 %r / 车道 %r）" % (mf, mt), file=sys.stderr)
        print("       找的是：%s 与 %s" % (os.path.join(site, "octave.wasm"),
                                          os.path.join(site, lane_name, "octave.wasm")), file=sys.stderr)
        return 2
    if mf and mt:
        print("   产物烤的前缀：基础 %s / 车道 %s" % (mf, mt))
    if check_only:
        if not os.path.exists(p_lane):
            print("FATAL: 缺 %s（先跑本脚本生成）" % p_lane, file=sys.stderr)
            return 2
        with io.open(p_lane, encoding="utf-8") as fh:
            lane = json.load(fh)
        bad = checks(man, lane, d, mount_from=mf, mount_to=mt, lane_baked=mt, lane_name=lane_name)
        for b in bad:
            print("   ✗ %s" % b)
        if bad:
            print("车道清单**不合格**（%d 条）" % len(bad), file=sys.stderr)
            return 1
        n = sum(1 for a in lane.get("assets", []) if a.get("kind") in LANE_KEYS)
        print("车道清单 OK：%d 条 oct/octdir 已分档 + install 前缀已按档改口，"
              "其余条目与基础清单逐字相同" % n)
        return 0
    lane, n = build_lane_manifest(man, d, mount_from=mf, mount_to=mt, lane_name=lane_name)
    with io.open(p_lane, "w", encoding="utf-8") as fh:
        json.dump(lane, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    print("已写出 %s（改写 %d 条：oct/octdir 分档 + install 前缀改口；sha 按磁盘重算 %d 条）"
          % (p_lane, n, (lane.get("_lane") or {}).get("sha_resynced", 0)))
    bad = checks(man, lane, d, mount_from=mf, mount_to=mt, lane_baked=mt, lane_name=lane_name)
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


def _mk_wasm(prefix):
    """造一个"烤了 install 前缀"的假产物（自证用：证明判据是**从字节里读**的）。"""
    import tempfile
    fd, p = tempfile.mkstemp(suffix=".wasm")
    with os.fdopen(fd, "wb") as fh:
        fh.write(b"\0asm\x01\0\0\0" + prefix.encode() + b"/share/octave/11.3.0/etc")
    return p


def _lane_of(env=None):
    return build_lane_manifest(_MAN)[0]


def _man_synced():
    """基础清单也带**正确** sha（BB）的版本 —— 用来测"正常不报"那一档。"""
    m = {"assets": [dict(a) for a in _MAN["assets"]]}
    m["assets"][0]["sha256"] = "BB"
    return m


def _lane_synced():
    return build_lane_manifest(_man_synced(), "/tmp", _SHA)[0]


# ── install 前缀那一组（真事故：accept-help 5/7；线程档 wasm 烤 `...-threads`，清单照抄基础前缀）
_PF = "/src/work/octave-install"
_PT = "/src/work/octave-install-threads"
_MANP = {"assets": [
    # ⚠️ 必须**也含一条 oct**：否则会先撞上"基础清单里一条 oct/octdir 都没有 ⇒ 生成器空转"
    #    那条零值守卫（自证用例自己踩过），测不到前缀这一组。
    {"name": "a", "kind": "oct", "url": "assets/oct/a.oct", "sha256": "BB"},
    {"name": "built-in-docstrings", "kind": "file", "url": "assets/data/built-in-docstrings",
     "mount": _PF + "/share/octave/11.3.0/etc/built-in-docstrings"},
    {"name": "m", "kind": "js", "url": "assets/pkg/m.js"},
]}
_LANEP = build_lane_manifest(_MANP, mount_from=_PF, mount_to=_PT)[0]


def _lane_stale_mount():
    """真事故形状：mount 照抄基础前缀（不改口）。"""
    l = build_lane_manifest(_MANP)[0]
    return l


CASES = [
    ("oct 的 url 前缀被改写", lambda: _lane_of()["assets"][0]["url"] == "assets/oct-threads/a.oct"),
    ("octdir 的 base_url 被改写", lambda: _lane_of()["assets"][1]["base_url"] == "assets/octdir-threads/d"),
    ("非 oct 条目**逐字不动**", lambda: _lane_of()["assets"][2] == _MAN["assets"][2]),
    ("★ install 前缀的 mount 被改口到车道", lambda: _LANEP["assets"][1]["mount"].startswith(_PT)),
    ("★ 改口后的清单 ⇒ 不报（且规则③ 归一化后仍逐字相同）", lambda: not checks(
        _MANP, _LANEP, "/tmp", _ALL, _SHA, mount_from=_PF, mount_to=_PT, lane_baked=_PT)),
    ("★ mount 没改口（真事故：accept-help 5/7）⇒ 必须报", lambda: bool(checks(
        _MANP, _lane_stale_mount(), "/tmp", _ALL, _SHA, mount_from=_PF, mount_to=_PT, lane_baked=_PT))),
    ("★ 产物烤车道前缀、清单一个都没挂载 ⇒ 必须报", lambda: bool(checks(
        _MANP, {"assets": [dict(_MANP["assets"][0], mount=_PF + "/etc/x"),
                           _MANP["assets"][1]]},
        "/tmp", _ALL, _SHA, mount_from=_PF, mount_to=_PT, lane_baked=_PT))),
    ("★ 基础档清单里出现车道前缀的挂载 ⇒ 必须报（挂错档）", lambda: bool(checks(
        {"assets": [dict(_MANP["assets"][0], mount=_PT + "/etc/x"), _MANP["assets"][1]]},
        _LANEP, "/tmp", _ALL, _SHA, mount_from=_PF, mount_to=_PT, lane_baked=_PT))),
    ("★ baked_prefix 真从产物字节里读（读不到就是 None，不猜）", lambda: (
        lambda t: baked_prefix(t) == [_PT] and baked_prefix("/tmp/does-not-exist") is None)(
        _mk_wasm(_PT))),
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
    ("★ w64 档：oct 的 url 与 octdir 的 base_url 改写到 oct-w64", lambda: (
        lambda l: l["assets"][0]["url"] == "assets/oct-w64/a.oct"
        and l["assets"][1]["base_url"] == "assets/octdir-w64/d")(
        build_lane_manifest(_MAN, lane_name="w64")[0])),
    ("★ w64 档：install 前缀改口到 /src/work/octave-install-w64", lambda: (
        lambda l: l["assets"][1]["mount"].startswith("/src/work/octave-install-w64"))(
        build_lane_manifest(_MANP, mount_from=_PF, mount_to="/src/work/octave-install-w64", lane_name="w64")[0])),
    ("★ w64 档：checks 正常清单不报", lambda: not checks(
        _man_synced(), build_lane_manifest(_man_synced(), "/tmp", _SHA, lane_name="w64")[0],
        "/tmp", _ALL, _SHA, lane_name="w64")),
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
