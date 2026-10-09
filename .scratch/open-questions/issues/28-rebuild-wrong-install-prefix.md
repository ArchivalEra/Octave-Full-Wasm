# 28: `relink.sh rebuild <车道>` 没传车道 install 前缀 ⇒ 产物烘死 product 路径（docstrings 打不开）

**What to build:** `cmd_rebuild` 调 `configure-113-full.sh` 时**不传 source / install 目录**
（`build-w64-lane.sh` 是显式传的：`configure-113-full.sh "$SRC" "$OCT_INSTALL_W64"`）
⇒ 树被配成 **product 前缀**（`/src/work/octave-install`）。于是**从那棵树重链出来的任何产物**
都烘死 product 路径，而站点资产按**车道**前缀挂载 ⇒ 运行期 `help`/docstring 全部打不开。

**Blocked by:** None

**Status:** resolved

**Settling:** `bash build/113/relink.sh rebuild threads --out <目录> --yes-rebuild`（修正后） —— rc=0 ⇒ 结算件成立、结论见该单 Answer；rc≠0 ⇒ 先修结算件（门没红＝没结案）。
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

## Answer（2026-09-30）：两条判据都实测通过

**修法**：`cmd_rebuild` 按模式把**车道 install 前缀**传给 `configure-113-full.sh` 的 `$2`
（threads → `/src/work/octave-install-threads`、w64 → `-w64`、其余 → `/src/work/octave-install`；
不传就落到默认的 product 路径 —— 那就是本单的病因），缺车道安装树则点名 FATAL；
并在 `cmd_link` 之后加一条**烘死路径自证**：产物 `octave.js` 里量到的 `/src/work/octave-install*`
必须**含本车道那一个**，否则 FATAL。

**判据 ①（产物级，脚本自证）**：
`bash relink.sh rebuild threads --out /src/websrc/rb28-out --yes-rebuild` ⇒ rc=0、`verdict=ok`，
并打出 **`✅ 烘死路径含本车道前缀（/src/work/octave-install-threads）`**（sha `ea094ed387e0e82c…`）。

**判据 ②（运行期，本单 Settling 的那条）**：把该产物装进站点（8795）后
`sh build/sweep.sh <站点>/ accept-help` ⇒ **12 PASS / 0 FAIL**（修前是 **5 PASS / 7 FAIL**）；
站点上那份产物的烘死路径实测只有 `/src/work/octave-install-threads` 一条 ✓。

**这条同时暴露的验收盲区（已写进本单正文）**：`verdict=ok` 只核对"声明 vs 产物量测"，
**不覆盖运行期路径** ⇒ 工单 26 当时"verdict=ok"的那个产物其实是**运行期坏的**。
⇒ 结论：**换车道/换产物之后，判据里必须有一条运行期套件**（本仓现成的是 `accept-help`）。
同类防线已另立 **工单 29**（`link` 之前校验树前缀与模式一致，已实现，relink 自证 10/0）。
