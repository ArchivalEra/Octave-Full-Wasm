# 64: **Forge 按需拉取插件系统**——客户端"包商店"（围绕按需下载设计，与 fork/lock 管线贴合）

**What to build:** 用户拍板（2026-10-09）：建一个**插件系统**，**与 fork 管线紧密贴合**，
去 Octave-Forge "购物"；且**设计中心 = 客户端按需拉取**（用户原话："现在他那边 8MB 拉取
单个引擎是极其亮眼的成果，我认为这个插件系统应该围绕按需下载来设计"）。

形态（设计稿 `build/113/NOTES-forge-ondemand.md` 有全文）：

```
OctaveAssets.catalog()            // 读站点货架（不下载）
OctaveAssets.install('optim')     // 依赖闭包 → 逐个 fetch+sha256 校验 → 按 pkg install 布局落盘
                                  //   → addpath → run(PKG_ADD)；用到才拉，没用到 = 0 字节
```
触发器两条：① 页面"包商店"面板；② Octave 内 `pkg load <名>`（`build/webshims/pkg.m`
**已经有**这个骨架）。

**Blocked by:** 设计稿 §6 的三个分叉点需用户拍板（A：v1 纳不纳含编译件 `.oct` 的包；
B：tarball+gzip 客户端解 vs 构建期预解包；C：catalog 生成入口）。**拍板前不开工实现。**

**Status:** resolved （2026-10-10：**v1 已跑通、验收 15/15、并发运 8761/8768/仓库 `site/`** —— 三个分叉点全部实测裁决：B=用引擎内建 gunzip+untar（不写 JS 解析器）、A=v1 覆盖全部 10 包（`src/` 是可选加速件、预编译 `.oct` 数=0）、货架=独立仓 submodule + 只上 verified。发运件与验收快照逐字节对拍；新闸门 `build/113/check-forge-catalog.py` 挂 pre-commit。**剩余：T4（`pkg load` 问 catalog）与 T8（v2 编译件按需）** —— 见设计稿 §10）

**Settling:** 不存在 —— 本工单的**第一交付物就是它**：`test/browser/accept-forge-ondemand.mjs`。
建好后按 rc 判：rc=0 ⇒ 按需装载成立（干净站点 install 后磁盘/`pkg list`/`exist` 三面可见 +
三条反向断言全过）；rc≠0 ⇒ 按需链路没通，先修链路。

**Type:** feature

## 与既有工单/机制的分界（**别读混**）

- **工单 61（部件插件，已定稿）** = **构建期**部件替换（BLAS/分配器/rust 缝，影响全站产物）。
  **本单 = 运行期**按需装载（包级，按会话）。两者共享两条铁律（不脱离 Octave 树 /
  补丁不打在补丁上），但**轴不同**、载体不同（`build/plugins.json` vs 站点 catalog）。
  ⇒ T7 要在 `CONTEXT.md` + `maintaince.md` 把这两个"插件"的术语钉死。
- **工单 58（部件清单）**：只盘了"链进来的库"，**没盘 Forge 包**——本单是它的运行期对偶。
- **UI gh#2 / P5FigureOverlayPlugin**：`SafePlotSinkPolyfill` 那套是**客户端渲染插件**
  （布局/搜索/图覆盖），与本单的"引擎侧包按需装载"不同层。**契约面**（`OctaveAssets`）
  是两仓共享的，扩 `install()` 时要照 gh#2 的惯例两边同知。

## 现状盘点（机制已有 80%，本单是收编）

| 层 | 现有件（复跑见设计稿 §9） |
|---|---|
| 采购 | `build/forge-fetch.py`（依赖递归 + **按 Octave 版本过滤** + sha256） |
| 打包 | `build/assets.py bundle-pkg`（**忠实 `pkg install` 布局**：`inst/` 上提 + PKG_ADD 抽取） |
| 编译件 | `build/113/build-pkg-oct.sh`（`src/*.cc` → wasm `.oct`） |
| 运行期装载 | `bridge/assets-loader.js`：`load()`/deps/sha256/aliases/`preloadIfHuge`（>8MB 异步） |
| Octave 触发器 | `build/webshims/pkg.m`（`pkg load <未装载>` ⇒ 触发页面装载 + pause 轮询） |
| Octave 侧名单 | `build/pkgfix/__webassets_available__/__webassets_pending__`（读 `/tmp/webassets.json`） |

**缺的两处缝**：① 客户端**没有上游货架概念**（只知随站 manifest）；② **没有运行时安装**
（Forge 包只能构建期打包成 JS 随站发，**12 MB 强制所有人下**）。

## fork/lock 管线的贴合点（用户点名）

① `catalog.octave` = **从 fork 的 `upstream/octave/configure.ac` 的 `AC_INIT` 读**（不手写）；
② 每包 `version + sha256` 钉死（沿用 `upstream-lock.json` 的 URL+sha256 家族）；
③ **witness 档**每提交真跑（catalog.octave == fork 版本；条目仍在货架）；
④ catalog 记 `generated_by`（脚本 sha）；⑤ tarball 从上游取一次落持久盘再装配。
⚠️ **包不进 `.gitmodules`**（数据资产，非源码树）⇒ 其 pin 由 catalog sha 承载，
不走 submodule 树见证。

## 交付物（T1–T8，详见设计稿 §10）

T1 catalog 生成器 · T2 站点装配（**同源** `assets/forge/`）· T3 `catalog()/install()` + tar+gzip 解包器 ·
T4 `pkg load` 先问 catalog · T5 catalog 闸门 + **对拍断言**（客户端安装器 vs `bundle-pkg` 逐文件一致）·
T6 验收 `accept-forge-ondemand.mjs`（含 3 条反向断言）+ 台账键 · T7 术语钉死（CONTEXT/maintaince）·
T8（v2）含编译件包的 `.oct` 按需。

## 硬边界（本仓一贯）

- **纯客户端**：解包/落盘/装载全在浏览器；`forge-fetch.py`/catalog 是构建期工具，无运行时端点。
- **同源**：COI（COEP: require-corp）下**跨域 fetch 会被拦** ⇒ 包必须与站点同源。
- **fail-closed**：sha256 三段（采购/装配/客户端）任一不符 = 拒绝装。
- **两处实现必有对拍**：§4 的"客户端安装器忠实 `pkg install`"= 唯一硬证据（否则必漂）。
