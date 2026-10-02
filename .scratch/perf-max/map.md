# Map · w64 极限性能（wayfinder · 2026-10-02 绘制）

> 本仓 wayfinding ops：`docs/agents/issue-tracker.md` 的「Wayfinding operations」。
> 票在 `issues/NN-<slug>.md`；`Status:` 记 open/claimed/resolved；`Blocked by: NN, NN` 表依赖。
> Frontier = open + 无未结依赖 + 未被认领，票号小者先。

## Destination

**浏览器内 Octave 的数学（线性代数）性能吃满。** 终点判据 = **已知性能杠杆清单全部拉完并实测**
（SIMD 内核 / 线程数与调度 / 链接侧优化旗标 / >2 GiB 大堆），每根杠杆出一张实测数字；
**原生占比做仪表盘**（每次实验同时报"浏览器 / 同机原生"百分比），不预设硬目标倍数。
终局：最快形态经受管辖入口 **promote 到 8761**（promote 前人工确认，HITL 点）。
性能口径 = 线代重负载（BLAS/LAPACK）；解释器标量循环如实记录、不设目标。

## Notes

- **起点的实测参照（全在 `build/FACTS.json`，正文只引用键名）**：`w64_ob_matmul500_s`
  （现役 w64 档）、`w64_ob_matmul500_speedup`、`e2_threaded_matmul500_s`（wasm32 线程版
  OpenBLAS —— **比 w64 现役还快一点**，i64 指针有代价）、`w64_big_heap`（no，大堆未兑现）、
  `mem_live_ceiling_gib`（四档同为 1.49 GiB）。
- **车道纪律**：一切构建走既有受管辖机制 —— `build/113/relink.sh` 模式表（不许手设环境变量）、
  `build/113/build-e2-lane.sh`（`E2_LANE`）、发运 `build/promote-w64-lane.sh`；新变量先进
  模式表（`explain` 落口径 + `--selfcheck`）再谈使用。
- **载体已定（2026-10-02 用户拍板，票 07）**：**单王 w64**；wasm32 线冻结于 `wasm32-final`
  分支（不发线程版库）；主线专注 w64 极限版。
- **事实纪律**照 AGENTS：数字只落 `build/FACTS.json`（`--accept-changes` 逐条接受改口）；
  推断进 `build/113/NOTES-*.md` 并注明结案实验；被推翻进 `build/lib/retractions.json`。
- **仪器已备**：`test/browser/bench-lanes.mjs`（多档竞速）、`bench-core.mjs`、`bench-dgemm.mjs`、
  `probe-heap-ceiling.mjs`（大堆判据 `W64_BIG_HEAP`）。
- 容器 `o113` 需要时先 `sudo docker start o113`；实验车道端口 8848/8849/8852，8761/8768 不动。
- research 票（01）由绘图会话放 research 子代理直接解决（wayfinder 对 research 票的例外）。
- **上一批尾巴在图外**：8761 全量 `PROBES=1`（r4）绿后的收尾序列按 `HANDOFF.md` §1c 照做；
  本图以"它已完成"为前提。

## Decisions so far

<!-- 一行一票：[票名](issues/NN-*.md)：一句话结论 -->

- [01 OpenBLAS 杠杆清单](issues/01-openblas-levers.md)：**WASM128_GENERIC 上游自带且已在用**（前提翻案）；
  真空白 = level-1/2 内核零 SIMD（L1）/ GEMM 微内核 2×2（L2）/ -O2 编译档（L4）/ 线程数 4（L6）/
  LAPACK 未编入（L5）；threads 档换线程版库 = 零代码 6.7×【实测】（L7）。杠杆 L1–L12 分级见票。
- [02 原生基线](issues/02-native-baseline.md)：同机同版本 Octave 11.3.0 双后端实测落台账
  （netlib=用户默认 / OpenBLAS 0.3.34×24=天花板，键 `native_*`）；仪表盘第一版：
  浏览器 w64 占天花板 = `w64_ob_matmul500_native_ratio`，比默认原生 Octave 快 = `w64_ob_matmul500_vs_netlib`。
- [03 大堆](issues/03-w64-big-heap.md)：`MAXIMUM_MEMORY` 进受管辖模式表（其余模式显式 2GB 不变，
  w64/w64-base = 8GB）；4GB 版实测存活 3.73 GiB 暴露"判据≥4GiB 与旋钮结构性错位" ⇒ 抬 8GB：
  **存活 7.45 GiB、`W64_BIG_HEAP=yes`**、开机 1.1 s、数值回归全绿、bench 持平、四格 33/0。
  **产物已建成、未 promote**（= 终局票 08 的人工确认点；共享 8GB 的三引擎矩阵待复核）。
- [07 载体与发运决策](issues/07-carrier-and-ship-decision.md)：**用户拍板 —— 单王 w64**。
  wasm32 线冻结于 `wasm32-final` 分支（不发线程版库，工单 27 同结）；lane.js 排序不变
  （w64 本就是最快交付形态）；终局形态 = w64 合体版（-O3 + 8GB），发运令已下（票 08）。
- [08 终局发运](issues/08-final-ship.md)：**已发运** —— 8761 现役 w64 = `-O3 + 8GB` 合体版
  （sha `3b0d5e2f…`）；8854 先验 + 8761 r6 双全绿（74 套/1351 PASS）、SHA 三层、四格 33/0；
  台账 `w64_big_heap`=yes / `mem_live_ceiling_gib`=7.45。**图到达目的地**；
  剩余杠杆（L1/L2 内核、票 05/06）属"下一张图/后续批次"。
- [06 链接旗标](issues/06-link-flags.md)：三杠杆零采纳 —— 链接 -O3 ❌（metadce 剥 .oct 支撑符号，
  三连实验不可持续修复）/ 后置 wasm-opt ❌（体积 +1%、速度噪声）/ LTO 边际（单题 10% 不复现为普遍优势）。
  **现役 -O2 管线 = emcc 5.0.7 的甜点**。
- [05 线程数](issues/05-thread-tuning.md)：**翻面 —— NT=8 全面胜出**（matmul500 2.0× / matmul1000
  2.2×，占原生天花板 ~60%）。"NT=4 甜点"初判死于工单 40 定位的调用方反模式（bench 就绪循环
  boot 中途调 feval × 建池窗口竞态）；调用方已修（bench-lanes 两段式就绪），NT=8 解锁。
  NT=8 上站：**尝试后失败、已回滚（2026-10-02）** —— `a69170ec…` 发运后全量抓出
  确定性回归（`accept-dldfcn` 71/0→44/27），回滚到 NT=4。见票 05 补记 + 新票 41。
- [04 OpenBLAS 实验](issues/04-openblas-simd-kernels.md)：L4 转正（-O3 编译档，已含于现役）；
  L5 **翻案不采纳**（OpenBLAS 内置 LAPACK = f2c 标量，现役 lapack-simd 本就是 SIMD 版，
  +13MB 载荷）；L1/L2/L3 → **票 39**。
- [39 SIMD 内核开发](issues/39-openblas-simd-kernel-dev.md)：**负判决收口（2026-10-02 深夜）** ——
  L1 = 内存墙（dot 不可复现 ≥1.3×）；L2 = **4×2 手写内核慢 8-13×**（wasm64 寄存器压力 +
  memory64 逐次边界检查；Claude 复核三盲区——lane 语义/C 寻址/B copy——修正后仍负）；
  L3 推定同理。**自动向量化 generic 2×2 = wasm64 实用最优**；L2 seds 独立门控默认关。

**图状态**：目的地「数学性能吃满（杠杆清空 + 原生占比仪表盘）」**到达** ——
可配置面与手写面杠杆全部实测清空（01–08 全结，含 39 的负判决）；性能图终态 =
现役 8761 = `-O3 + 8GB + NT=4`（sha `3b0d5e2f…`；NT=8 尝试上站因破 dlopen 已回滚，
见票 05/40 补记、新票 41 与 HANDOFF §1d）。

## Not yet specified

- 若票 04 证明**内核形态**是主杠杆：OpenBLAS WASM 专有内核（WASM128_GENERIC 一族）的维护
  状态、可配置面、与 emscripten pthread 的兼容边界 —— 可能引出更深的构建票。
- 原生占比出来后，若浏览器与原生的主要差距落在 **JS↔wasm 边界 / 内存布局**而非内核，
  可能引出"边界开销"实验票（这正是 Q1 选杠杆清空制的理由：天花板未知，拍百分比容易虚）。
- 票 03 若兑现 >2 GiB：大堆下解释器/BLAS 的实际行为差异（临时矩阵策略、索引宽度）待观察。
- ~~双王若成立（票 07）：wasm32 threads 档的完整验收与发运配方~~ —— **已出雾**（票 07 决策：
  单王 w64，wasm32 冻结；这条不再会立票）。

## Out of scope

- **图形与嵌入线**（E6 wasm 侧去单例、教材站嵌入）：另一张图。
- **部署托管与 Firefox SW 兜底**：部署线；本图终点止于 8761。
- **真机手测（工单 12）/ 回放闸门移植（工单 37）**：独立 ready 票，图外照旧推进。
- **加载体积 / 首屏优化**：本图只如实记录产物体积变化，不设优化目标。
