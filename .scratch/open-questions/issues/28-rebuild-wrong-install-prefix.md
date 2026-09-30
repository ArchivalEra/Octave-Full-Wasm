# 28: `relink.sh rebuild <车道>` 没传车道 install 前缀 ⇒ 产物烘死 product 路径（docstrings 打不开）

**What to build:** `cmd_rebuild` 调 `configure-113-full.sh` 时**不传 source / install 目录**
（`build-w64-lane.sh` 是显式传的：`configure-113-full.sh "$SRC" "$OCT_INSTALL_W64"`）
⇒ 树被配成 **product 前缀**（`/src/work/octave-install`）。于是**从那棵树重链出来的任何产物**
都烘死 product 路径，而站点资产按**车道**前缀挂载 ⇒ 运行期 `help`/docstring 全部打不开。

**Blocked by:** None

**Status:** resolved

**Settling:** `bash build/113/relink.sh rebuild threads --out <目录> --yes-rebuild`（修正后）
⇒ 产物 `octave.js` 里 `grep -o '/src/work/octave-install[a-z0-9_-]*/share/octave/11.3.0' | sort -u`
**必须只有 `…-threads` 一条**（不许出现裸的 `/src/work/octave-install/`）；
且把该产物装进站点后 `sh build/sweep.sh <站点>/ accept-help` ⇒ **全绿**（当前是 5 PASS / 7 FAIL）。
**反向断言**：故意用 product 前缀的产物 ⇒ `accept-help` 必须红（证明这条判据认得出错）。

**Type:** task

## 实测（2026-09-30，做工单 27 第②步时发现）

| 产物 | 烘死的 docstrings 路径 | `accept-help` |
|---|---|---|
| 现役线程档 `site/threads/octave.js` | `/src/work/octave-install-**threads**/share/octave/11.3.0` | **12 PASS / 0 FAIL**（8768） |
| 我用 `rebuild threads` 的树重链出的 E2 产物 | `/src/work/octave-install/share/octave/11.3.0`（**product**） | **5 PASS / 7 FAIL**（8795） |

站点侧证据：`site/assets/manifest.threads.json` 把 `built-in-docstrings` / `doc-cache`
**挂到** `/src/work/octave-install-threads/…` ⇒ 产物必须也指向那儿。
`/src/work/octave-install-threads` 这棵车道安装树**在容器里存在**（现役线程档就是从它建的）。

**★ 这条同时暴露了一个验收盲区**：`verdict=ok` 只核对**声明 vs 产物量测**，**不覆盖运行期路径**
⇒ 工单 26 的结算（`rebuild threads` ⇒ verdict=ok）当时"绿"了，但那产物**在运行期是坏的**
（help 打不开）。教训：**换产物/换车道之后，判据里必须有一条运行期套件**（本仓已有 `accept-help`）。
