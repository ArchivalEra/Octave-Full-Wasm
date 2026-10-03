# 57: **分配器杠杆**：线程档的 pthread 锁税（16%，已证实）—— 换 `-sMALLOC=emmalloc`/mimalloc

**What to build:** 工单 55 的扫描发现**已由结案实验证实**（`NOTES-hotpath.md`）：同一
`func-handle` 负载，`w64`（线程档）里 `__pthread_mutex_trylock_owner` 占 **16%**，
`w64-base`（单线程档）里 **0.0%** ⇒ **线程安全分配器在（几乎全单线程的）分配路径上收的税**，
无竞争也付（matmul 里 BLAS 线程忙、不分配 ⇒ 锁 0%；分配密集负载 ⇒ 锁 16%）。
本单 = 试**换分配器**把这个税降下来（**不动接口、不重写解释器**，只换链接期一个选择）。

**Blocked by:** None

**Status:** resolved（2026-10-03：**mimalloc 成立** —— 同旗标交错 3 轮：墙钟 **1016→740 ms
（−27%）**、pthread 锁 **10.3%→0%**、体积仅 +0.2%、数值 79/0 + dldfcn 71/0 全绿。
发运是产品决定）

**Settling:** 用 `relink.sh` 在 w64 上加 `-sMALLOC=emmalloc`（或 mimalloc）重链 → hotpath 复扫
同一批分配负载（`func-handle`/`loop`/`struct-array`）：
`__pthread_mutex_*` 合计 **≈0** 且 `dlmalloc`/`dlfree` 占比下降且**墙钟降** ⇒ 采纳候选；
否则如实记为"分配器不是这块税的出口"。

## Answer

（2026-10-03 结案。同旗标 `DIAG_NAMES=1` 建两版，交错 3 轮，同一 `func-handle` 负载。）

| 分配器 | 墙钟（3 轮 / 中位） | alloc | **pthread 锁** | wasm 体积 |
|---|---|---|---|---|
| dlmalloc | 1003 / 1016 / 1047 ms → **1016** | 30.6% | **10.3%** | 33.97 MB |
| **mimalloc** | 740 / 748 / 718 ms → **740** | 21.3% | **0.0%** | 34.04 MB（+0.2%） |

**⇒ mimalloc 采纳为发运候选**：墙钟 **−27%**、锁税 **归零**（per-thread heap）、体积 +0.2%、
**数值 79/0 + dldfcn 71/0 全绿**（不是"快而错"）。`struct-array`/`loop-for` 复跑也确认锁 0%。

**⚠ 抓到的混淆变量（已更正，记进 NOTES）**：第一版报 −39%，是因为 dlmalloc 基线用了
`relink --diag` **全套**（含 `DIAG_ASSERT` 运行期断言）而 mimalloc 版只设 `DIAG_NAMES=1`
⇒ 断言让基线虚慢。**同旗标**重测后真实差 = **−27%**。**教训**：A/B 必须同构建旗标
（`-flto`/`--diag` 同族的坑）——建议做成不变量：A/B 两件的 `octave.build.json.declared` 必须相同。

**发运前待办**（本批只到"实测成立 + 候选产物"）：
1. `-sMALLOC=mimalloc` 进 **`relink.sh` 模式表**（本次手驱动 ⇒ `declared=null`，不可发布）；
2. **全量验收**（含 `accept-dldfcn` + 探针）在 mimalloc 产物上跑；
3. 发运 = **产品决定**（同 NT=8/FMA 两批）。
