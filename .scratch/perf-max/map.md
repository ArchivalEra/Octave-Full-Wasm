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
- **载体决定缓发**（grilling Q2=b）：调优实验 w64 与 wasm32-threads 两条 E2 配方都跑；
  改选档排序 / 发运 threads 档（工单 27）是终点前的人工决策（票 07），中途不做。
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

## Not yet specified

- 若票 04 证明**内核形态**是主杠杆：OpenBLAS WASM 专有内核（WASM128_GENERIC 一族）的维护
  状态、可配置面、与 emscripten pthread 的兼容边界 —— 可能引出更深的构建票。
- 原生占比出来后，若浏览器与原生的主要差距落在 **JS↔wasm 边界 / 内存布局**而非内核，
  可能引出"边界开销"实验票（这正是 Q1 选杠杆清空制的理由：天花板未知，拍百分比容易虚）。
- 票 03 若兑现 >2 GiB：大堆下解释器/BLAS 的实际行为差异（临时矩阵策略、索引宽度）待观察。
- 双王若成立（票 07）：wasm32 threads 档的完整验收与发运配方 —— 那时才够格立票。

## Out of scope

- **图形与嵌入线**（E6 wasm 侧去单例、教材站嵌入）：另一张图。
- **部署托管与 Firefox SW 兜底**：部署线；本图终点止于 8761。
- **真机手测（工单 12）/ 回放闸门移植（工单 37）**：独立 ready 票，图外照旧推进。
- **加载体积 / 首屏优化**：本图只如实记录产物体积变化，不设优化目标。
