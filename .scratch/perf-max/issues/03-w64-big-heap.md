**Type:** task
**Status:** resolved（2026-10-02）
**Settling:** `test/browser/probe-heap-ceiling.mjs` —— `W64_BIG_HEAP=yes` ⇒ 兑现；`no` ⇒ 未兑现

## Question

抬 `MAXIMUM_MEMORY` 让 w64 档兑现 **>2 GiB 实际可用堆**（收编工单 31 的第二半；票 01 杠杆 **L11**，
顺带可试 L12 初始内存）：relink w64 走模式表（若 `MAXIMUM_MEMORY` 不在表内，先改表：`explain` 落口径 +
`--selfcheck`，**不许手设环境变量**）→ `probe-heap-ceiling` 实测存活上限 → 数值回归无回归
→ 产物 `verdict=ok` 才算数。本票只构建+实测；promote 是终局票（08）的人工确认点。

## Answer

（2026-10-02 本会话结案。两轮重链都在受管辖入口内完成：
`MAXIMUM_MEMORY` 进了 relink.sh 模式表 —— 其余五模式显式 `2GB`（= 历史行为），`w64`/`w64-base` = **`8GB`**；
`link-web.sh` 新读 `${MAXIMUM_MEMORY:-2GB}`（默认= emscripten 默认，旧模式逐字节等价）；
`relink.sh --selfcheck` 绿 —— 且它当场抓过我第一次"公共块+w64分支重复发射"的错（设计行为）。）

**两轮实测**（重链口令 = `E2_OPENBLAS=/src/work/e2-openblas-lib-w64 bash relink.sh link w64 --out <新目录>`）：
- 4GB 版：`verdict=ok`、`maximum:65536n`、sha `a90057a0…`、开机 1.1 s、堆探针 6/0、
  w64 存活 **3.73 GiB**（对照 base/threads = 1.49 不变）。
  ⚠️ 但 `W64_BIG_HEAP=no`：判据是「存活 ≥4 GiB」，而 0.75 GiB 块网格在 4GB max 下结构性只能到 3.73
  —— **判据与旋钮错位**。不降判据迁就数字，改为抬上限。
- **8GB 版（本票交付物）**：`verdict=ok`、`maximum:131072n`、sha `a3d92990eeefef7a…`、开机 **1.1 s**、
  堆探针 **6/0**、块序列 [0.75…7.45] ⇒ w64 存活 **7.45 GiB** ⇒ **`W64_BIG_HEAP=yes`**（结算判据达成）；
  base/threads 对照仍 1.49 GiB（不变，证明确是上限产物的属性）。
- **数值回归全绿**（8853 实验站）：accept-113-oct **8/0**（`.oct` dlopen 的内存增长路径无恙）、
  libs **17/0**、ode15 **29/0**、slicot **25/0**；bench 与现役持平（matmul500 0.008 / lu800 0.020）；
  四格选档 **33/0**。
- 复跑：日志 `w64-logs/relink-w64-8g.log` / `heap-ceiling-8g.log`；产物副本
  `w64-8g-artifacts/`（容器内 `/src/websrc/w64-ob-8g-out`）；实验站 8853 = `site-w64-4g`。

**边界**：产物已建成实测、**未 promote**（8761 现役 `w64/` 仍是 2GB 版，台账 `mem_live_ceiling_gib` /
`w64_big_heap` 未改口）—— 发运是终局票 08 的人工确认点。共享 8GB 在三引擎上的表现留待
promote 前的引擎矩阵复核。
