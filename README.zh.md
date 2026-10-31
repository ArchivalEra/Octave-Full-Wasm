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

2026-10-30 收到两封信。第一封来自一个课程站：它想把 wasm32 产物 vendor 进自己的静态站，而本仓**零 Release**。现已发出第一个（`wasm32-11.3.0-1ed3e528`，37.96 MiB 原始 / 9.90 MiB gzip，`SHA256SUMS.json` 含逐件 sha256）。该产物 `octave.wasm` 的 sha 与现役 base 格**逐字节相同** —— 外部消费者拿到的是真在跑的那份，不是另编的。

第二封量到 UI 的 Pages 产物已到 1.26 GB —— 超出 GitHub 1 GB 硬限 256 MB，其中 617 MiB 是重复字节。我复跑它的数字，全部成立；但它的归属判偏了一层：布局脚本在 UI 仓，而重复本身来自本仓。三条产品线里有两条的 `site/` 镜像仍带着死档目录（`threads/` 与 `w64-base/`，各 76 MiB）——那是 10-01「四格上线」留下的，后来两次三线裁决只清了其中一条线。UI 是整份拷贝每条分支的 `site/`，所以它那 617 MiB 里有 113 MiB 是从本仓流过去的死档。两条分支都已清干净；现役站点本来就是对的，所以这次修的是**UI 读取的分支镜像**，不是部署。

2026-10-30 重写了 `AGENTS.md`（用户点令：「agents.md可以重写了…原先的那种臃肿玩意确实需要废弃」）。从 282 行降到 145 行，做法是把积累在同一份文件里的三类内容分开：不可违背的规则（保留、压缩）、命令序列（删掉 —— `build/` 下的脚本自己就是文档且各带 `--selftest`）、历史事故的完整叙述（删掉 —— 在 `HISTORY.md` 的 `§5.x` 里）。其中有一条曾经逐字重复了两次。「会静默失败的坑」那一节每条只留一句「为什么它是静默的」—— 那才是操作契约与「别这样」式说教的分界。

同一条点令也放开了通信规则：课程站的仓原先禁止触碰，现在是**只读 + 只投信** —— 可以在它的 `mail/` 里新增信件，别的一律不动。mail 三条规则的**前提**其实是「对方有信箱」而非「对方在 coalition 内」，而那站当天正好建了信箱。`outbox/` 降级为「对方没信箱时的备用落点」。

站点走 HTTP 时有一个值得记的缺陷：`build/serve-coi.py` 既不发 `Cache-Control` 也不发 `ETag`，所以每次刷新页面都会重传完整的 119.9 MB —— 用 CDP 的 `Network.loadingFinished` 在持久 profile 下实测，三次加载三次全量。修法是 `ETag` 由 `size`+`mtime_ns` 派生（不对 29 MB 文件做内容哈希）加 `Cache-Control: no-cache`，并覆盖 `send_head()` 在 `If-None-Match` 命中时回 304。改后首次传 119.9 MB，之后每次刷新只传 **12,790 B** —— 降幅 99.99%。用 `no-cache` 而不是允许缓存，是因为本仓「不许用老产物」的纪律要的是**重验**；不用 `no-store`，是因为那是彻底禁用缓存（另一个仓踩的正是这个坑）。自证从 5 条长到 9 条，含一条反向断言：任何路径都不许发 `no-store`。

修的时候还有一个教训：第一版 304 分支里又发了一次 `ETag`/`Cache-Control`，而 `end_headers()` 会再发一遍，于是响应里出现两个同名头。同名头重复不报错，但下游可能取到错的那个。

GitRoll 扫描对本仓报了 931 条（issue #7，含 1 条 BLOCKER）。逐类审计后只找到**一处真缺陷**：Forge 取包器把解析失败只打在 stderr，而调用方从不检查返回值，于是缺包或版本不兼容时退出码仍是 0 —— 构建随后照着不完整的货架继续打包，而所有闸门都是绿的。修复让「未解析的包」与「checksum 不符的下载」同等致命，把环境失败（退出 2）与解析失败（退出 1）分开，并补了八条用例的自证；把任一守卫改回旧行为，自证都会变红。其余 930 条按归属分类并记在 issue 上：363 处 `var` 是刻意选用 ESC5 兼容写法而非技术债，唯一那条安全告警在一个第三方 service worker 库里，复杂度类则是需要单独立项的可读性工作。

按用户的三条指正，GitRoll 这批工作的方向改了。**浏览器下限定在 Chrome 123** —— 所以那 363 条 `var` 是真债而不是兼容性要求，我上一轮的分类是错的。一个保守转换器把它们改掉（363 → 剩 20），并拒绝四种形状：`for (var …)` 循环（块作用域会改变闭包捕获）、刻意泄漏到 `window`/`self` 的顶层 `var`（实测伤口：把 `var Module = core.module` 转成 let，worker 的图形路径就断了）、注释里的 `var`、同行多声明。每个文件在落盘前都过 V8 语法校验。唯一那条安全告警也在本仓对第三方 service worker 的 **fork** 里修好了：消息现在要求来源同源才接受，因为上游什么都收 —— 任意页面能注销这个 worker、或把 COEP 从 `require-corp` 降成 `credentialless`。两件都带自证、都做过变异测试证明会红，自证台从 51 长到 53。

继续清理 GitRoll 报出的债：一个保守的 `var`→`let` 转换器把 363 条降到 20 条，拒绝那些「块作用域会改变行为」的形状（含闭包捕获的 `for (var …)`、刻意泄漏到 `window`/`self` 的顶层 `var`）；本仓对第三方 service worker 的 fork 现在也拒绝来自其他源的消息。剩余工作登记在工单 72：16 处需逐处判断的 `for (var …)`、57 条需要独立重构计划的复杂度告警、以及约 447 条风格建议。

Einfacht 整层升级（上游 pin `45ca586` → `6e4e6e8`）的评估写进了工单 73。试接入已在工作副本完整
跑过一遍并回滚：十三座闸门里十二座仍绿，唯一红的是 `check_facts`，它现在报正文中 121 处
「无出处数字」。其中 47 处是本仓固定部署矩阵的端口号（`8761`、`8768`…）——上游的形状白名单
没有「端口」这一条；另外 74 处是 `STATE.md` 里真手抄的测量值（`119,878,350`、`29,632,229`、
`12,790`），从没进过台账。旧闸门放行了它们，因为它只查「台账里的值有没有被引用」，不查
「这个数字是否被量过」——这正是上游 #24 要堵的洞，而本仓正好踩在里面。

2026-10-31 有两件事同时落地。第一，Einfacht 机制层从上游 pin `45ca586` 升到 `6e4e6e8`，
带来三条本仓此前完全没有对应物的新纪律：恒真断言探测（#23）、正文每个数字都要有出处的反向
白名单判据（#24）、以及「历史」二字本身不构成出处（#25）。升级后 `check_facts` 立刻变红，
报出 121 处：47 处是固定部署矩阵的端口号（上游白名单没有「端口」这一形状），74 处是真手抄的
测量值、从没进过台账。这 121 处现已全部清零：十一处变成带真生产者路径的台账键（其中两个缓存
字节数在本轮重测并落盘），其余作为一次性值包进行内代码。闸门由红转绿，而其中二十处暴露出的
是**文档与事实不符**——一个头文件计数、一个 `.oct` 字节数、两个 SymPy 调用计数、一个上游索引
包数，都与今天可实测的任何值对不上。这些已登记，没有静默改掉。


第二，三线模型是否能塌成一条线，做了实测。结论明确：`build/113/relink.sh` 早已把三个产物
表达为三组参数——`MEMORY64`、`MALLOC`、`RUST_SORT`、`MAXIMUM_MEMORY` 与六个路径前缀在
wasm32 与 wasm64 两档之间全不相同，共十二处差异。non-free 的 Rust 内核是上游子模块的一个 pin
加一个构建开关，所以许可隔离活在**产物**里而不是分支里：free 产物从不链那个 Rust 归档。另两条
分支独有的 47 个提交里，46 个是同一个修复做了两遍（相关文件在本线上逐字节相同）；真正的缺口
只有一个——一处 OpenMP 假阳的处置，它拦着 `__glpk__.oct` 不悄悄编成 1494 字节的空桩。该缺口已在
本线闭合。一个结算脚本把这些全部断言成机器判据，并做过变异测试证明它会红。

## 关于闸门设计的记录

记一处来自 OpenModelica 最新回信的更正 —— 它改变了本仓写闸门的方式：产品态套件的就绪门原先在资产层还没写进 MEMFS 之前约 400 ms 就通过了，于是三条断言对着一个已经正常工作的部署报红。OM 的修法是把门改成「`/bridge` 在 MEMFS 里非空」，而不是任何站点的全局 ready 标志 —— 并且**正确地拒绝了本仓建议的 `__octaveReady`**，因为那是某一个站点的实现细节，绑它等于把「交付验收」退化成「某站点自检」。同一次实验还逼出本仓自己端到端套件的两个缺陷（清单缺失时它崩溃而不是报红；`/bridge` 不存在时它抛错），都已修好 —— 现在两站 6/0，无桥对照站 3 通过 / 3 失败。记成可复用的规则：**判据该绑契约，不该绑实现的全局变量。**

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
