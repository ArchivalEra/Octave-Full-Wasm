# Octave-Full-Wasm

[English](README.md) · [中文](README.zh.md) · [Deutsch](README.de.md)

GNU Octave 11.3.0 编译到 WebAssembly，整个解释器跑在浏览器里。纯客户端计算：
你的代码从不在服务器上执行。

这份 README 写给**要构建、扩展或调试**本仓库的人。内容只有四项：这是什么、
该选哪条线、每条线多快、权威事实在哪。逐批历史在 [`HISTORY.md`](HISTORY.md)，
活状态在 [`STATE.md`](STATE.md)。

三份语言版本同步维护；只更新一份的推送会被 pre-push 闸门拒绝。

---

## 三条线

同一个解释器，三条独立维护的产品线。分档依据是**用户可达性 + 许可线，与性能无关**。

| 分支 | 目标 | 要求 | 自由软件 |
|---|---|---|---|
| **`wasm32-final`** | wasm32，单线程 | 无 —— **无 COI 环境下唯一能跑的线** | 是 |
| **`master`** | wasm64 + 多线程 | COI 头 + 多线程 | 是 |
| **`IllegalPerformance`** | wasm64 + 多线程 + Rust 内核 | COI 头 | 否 —— 打补丁脱离上游工具链支持 |

没有 `crossOriginIsolated` 时服务 `master`，页面会**静默**落到 wasm32 线：不报错，
只是换了一条线。站点只显示两个格：`base`（wasm32）与 `w64`（wasm64）；任何别的格名
都是死档，闸门会拦。

## 性能

墙钟秒数，越小越好。原生存照是同一台机器上的 `octave-cli` 11.3.0（预热后 5 轮中位）；
wasm 数字是交错 3 轮的中位。实测日期 2026-10-07。

原始数据：[`docs/charts/perf-data.json`](docs/charts/perf-data.json)。
叙述与日志：`HISTORY.md` §5.96、`w64-logs/bigcompare-final.log`。

![五方性能对比](docs/charts/perf-5way.svg)

| 负载 | 原生 参考 BLAS | 原生 OpenBLAS ×24 | wasm32-final | wasm64 | IllegalPerformance |
|---|---|---|---|---|---|
| dot 1e7 | 0.0082 | 0.0048 | 0.0080 | 0.0100 | 0.0110 |
| matmul 500 | 0.0257 | 0.0029 | 0.0220 | 0.0040 | 0.0050 |
| matmul 1000 | 0.1971 | 0.0089 | 0.1600 | 0.0230 | 0.0240 |
| lu 800 | 0.0415 | 0.0147 | 0.0340 | 0.0140 | 0.0150 |
| lu 1500 | 0.2598 | 0.0636 | 0.2180 | 0.0620 | 0.0720 |
| svd 400 | 0.1650 | 0.2243 | 0.1740 | 0.1550 | 0.1870 |
| sum 1e7 | 0.0086 | 0.0076 | 0.0080 | 0.0080 | 0.0090 |
| sort 2e6 | 0.2111 | 0.2020 | 0.2280 | 0.2400 | 0.1110 |
| loop 1e6 | 0.4934 | 0.5226 | 0.6220 | 0.5780 | 0.5890 |

相对原生参照的几何均值：wasm32-final 1.05×、wasm64 1.99×、IllegalPerformance 1.96×。

![IllegalPerformance 相对各基线的加速比](docs/charts/perf-speedup-IP.svg)

wasm 线在 BLAS 密集负载上快过单线程原生 Octave，原因是它带的是用 relaxed-SIMD FMA
构建的 OpenBLAS，并且多线程跑。它在 `matmul` 上**没有**快过手工调优的 24 线程原生
OpenBLAS（0.0230 秒对 0.0089 秒）。受内存带宽限制的负载（`dot`、`sum`）在各条线上
落回同一个数字。

Rust 排序的端到端 A/B 是**另一个测量**（量产品产物而非内核）：
`w64_rustsort_ab_asc_ms` 165 ms，`w64_rustsort_ab_asc_ratio` 0.506 ⇒ 2.0×。
复跑：`bash build/113/sort-ab.sh`。

## 数值正确性

结果与原生 Octave 在相同输入下比对，逐位一致而不是"接近"。

| 面 | 结论 |
|---|---|
| 初等数学（`libm`） | 与 musl 对 `sin`、`exp`、`log`、`pow` 逐位一致 |
| 排序（Rust 内核） | 22 个输入域逐位一致，含 NaN 与大量重复值 |
| 算术、`sum`、`lu`、`svd` 等 | 逐位一致 |
| BLAS/LAPACK | 同源同旗标；relaxed-SIMD FMA 改变求和顺序，这一轴按文档化的容差包络比对 |

`libm` 替换插件是**按测量否决**的：每调用几何均值 0.964（`libm_spike_geomean`），
门槛是 1.5×。复跑：`sh build/113/bench-libm-spike.sh 8`。

Rust 排序内核有两道门：差分门按 22 个输入域逐位比对；变异自证往内核里注入刻意错误，
要求差分门必须抓到（4/4 被抓）。两道都过才允许采用。
复跑：`bash test/fixtures/rustsort-spike/run-spike.sh`。

## 架构

1. **解释器**。上游 Octave 在 `upstream/octave`（分支 `wasm/11.3.0`）分叉，用
   Emscripten 6.0.12 编译。上游发版走"合并 → 重建 → 车道 SOP"；`witness-upstream-pin.py`
   在每次提交时断言容器里的树与分叉 pin 一致。

2. **车道**。同一个 wasm 按目标（wasm32、wasm64+多线程）与组件集（BLAS 口味、分配器、
   Rust 内核）分别构建。车道知识是**数据**：[`build/lanes.json`](build/lanes.json) 是
   唯一产地，`check-lanes-single-source.py` 把它与**四个消费方**对账 —— 页面选档器、
   站点生成器、纯度闸门、插件登记表。

3. **资产层**。`.oct` 模块、`.m` 包与数据文件按需拉取，写进 Octave 的内存文件系统，
   逐文件核 sha256。包要么来自货架（预编译 tarball），要么由内置 clang/lld 工具链在
   浏览器内现编。注意 `addpath` 读的是 **MEMFS**，不是站点的 HTTP 目录树 —— 要让
   Octave 看见的东西必须先写进 MEMFS。

4. **事实系统**。每条关于构建的断言都是一个台账条目，自带复跑命令。
   [`build/FACTS.json`](build/FACTS.json) 存数字，`STATE.md` 是活状态，`HISTORY.md` 是
   append-only 记录，64 道闸门（14 平台 + 50 本仓专属）核对文档、产物与台账是否一致。

可替换部件是**带契约的插件**而非构建旗标：模式表旋钮 → 产物里的声明标签 → 产物探针 →
双向闸门 → 台账条目。

## 构建与运行

```sh
# 服务一个已构建的站点（w64 车道强制要求 COI 头）
python3 build/serve-coi.py --dir /mnt/hdd/octave-wasm-build/site --port 8761
```

普通的 `python3 -m http.server` 发不出 COI 头，页面会**静默**改成服务 wasm32 车道。

从零构建需要 `o113` 容器（Emscripten 6.0.12 + Octave 分叉）与
[`build/CLIBS.md`](build/CLIBS.md) 的配方。重链已有树有**唯一入口** ——
`bash build/113/relink.sh link product`，它掌管某个模式的全部环境变量，不要手设；
`bash build/113/relink.sh explain product` 打印配方。

部署是手动的，没有 CI 自动部署，见 [`DEPLOY.md`](DEPLOY.md)。把解释器嵌进你自己的页面：
[`docs/embed-api.md`](docs/embed-api.md)。

## 仓库地图

| 路径 | 是什么 |
|---|---|
| [`STATE.md`](STATE.md) | 活状态 —— 现在什么是真的 |
| [`maintaince.md`](maintaince.md) | 方向与地图 |
| [`HISTORY.md`](HISTORY.md) | append-only 逐批记录 |
| [`CONTEXT.md`](CONTEXT.md) | 术语表 —— 每个词一条权威定义 |
| [`AGENTS.md`](AGENTS.md) | 在本仓工作者的操作契约 |
| [`build/FACTS.json`](build/FACTS.json) | 实测数字台账；每个键自带复跑命令 |
| [`build/lanes.json`](build/lanes.json) | 车道知识的唯一产地 |
| [`build/CLIBS.md`](build/CLIBS.md) | C 库构建配方 |
| `build/113/` | 构建配方、闸门、车道脚本、工程笔记 |
| `bridge/` | 浏览器侧胶水：资产加载器、选档器、worker、页面宿主 |
| `test/browser/` | 浏览器验收套件 |
| `zreflect/` | 事实系统：闸门登记表、旋钮登记表、台账 |
| `upstream/` | Octave 分叉（submodule） |
| `shelf/` | 包货架（独立仓，submodule） |
| `mail/` | 跨仓通信 —— 本仓的收件箱 |

## 仓库内容

<!-- AUTO:FILES -->
<!-- /AUTO -->

## 钩子与闸门

闸门住在 `reflect-hooks/`，经 `core.hooksPath` 挂载。`pre-commit` 重算本 README 与
`STATE.md` 的机器块，然后跑事实系统闸门、本仓专属闸门（白名单、一致性、可证伪性、
就绪反模式、邮件边界）与两套自证台。`pre-push` 额外要求三份 README 在同一批推送里
一起更新。

手工复跑：

```sh
. reflect-hooks/Einfacht.env
python3 zreflect/registry.py --run commit              # 所有声明 runs_at="commit" 的闸门
sh gates-selftest.sh && sh build/gates-selftest.sh     # 证明每道闸门都会红
```

每道闸门都带 `--selftest`。证不出会红的闸门不算闸门。

## 参与

先读 [`AGENTS.md`](AGENTS.md) —— 那是操作契约，不是风格指南。三条不可违背：
纯客户端计算（禁止任何服务端执行代码的端点）、不 force-push 不改历史、新增文件必须
同步进 `.gitignore` 白名单（否则 pre-commit 直接拒）。

## 许可

构建胶水、浏览器宿主与 Octave 分叉的修改按 AGPL-3.0-or-later 分发。Octave 本体是
GPL-3.0-or-later；BLAS/LAPACK、SuiteSparse、FFTW 等相关库各自保留自己的许可。部分
捆绑组件是 GPL-2.0-only，与 AGPL-3.0 不兼容，因此这个组合只能按 AGPL-3.0 分发。

本程序是自由软件：你可以按自由软件基金会发布的 GNU Affero 通用公共许可证条款
（第 3 版或任何更新版本）再分发和/或修改它。分发时不提供任何担保，甚至不提供
可销性或特定用途适用性的默示担保。

按 AGPL-3.0 第 13 条，通过网络与它交互的用户有权获得对应源码：本仓库就是那份源码，
且在 `o113` 容器内可完整复现。逐组件的许可与著作权见
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)。
