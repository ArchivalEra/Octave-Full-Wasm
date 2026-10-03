# NOTES · hotpath 热点扫描（wasm64-NEXT 工单 55）

> 本文件是**推断**的落点（本仓纪律：活状态只写实测；推断写进 NOTES 并注明**哪个实验能结案**）。
> 仪器 = `build/113/hotpath.py`（工单 54）；扫描批 = `build/113/hotpath-scan.py`；
> 原始数据 = `hotpath-logs/<ts>/scan.json` 与 `report.json`；站点 = `hotpath-stations/w64-sym`
> （w64 diag 符号产物，**不是活站点**）。

## 实测：跨轴扫描（w64 车道，符号构建，自我校准 trusted=true）

| 负载 | samples | top 热点（self%） | alloc+锁 合计 |
|---|---|---|---|
| matmul/`dot` | 6720 | **dgemm_kernel 89%** · inner_thread 3% | **0%** |
| `sort` | 3166 | octave_sort::sort 35% · merge_lo 34% · merge_hi 20% | 0% |
| `string-find` | 2059 | **mx_el_eq(charNDArray) 88%** | 2% |
| `index-gather` | 178 | randmt 25% · rand_uniform 23% · idx_vector 11% | 0% |
| `string-cat` | 635 | idx_vector::assign 13% · dlmalloc 11% · Array<char> 10% | ~21% |
| `loop`（for/while） | 12596 | dlmalloc 11% · __pthread_mutex_trylock_owner 9% · tree_binary_expression 8% | **26%** |
| `func-handle` | 7488 | dlmalloc 16% · **__pthread_mutex_trylock_owner 12%** · dlfree 9% | **41%** |
| `struct-array` | 12769 | dlmalloc 16% · **锁 16%** · dlfree 12% | **~44%** |
| `cell-array` | 2214 | **锁 15%** · dlmalloc 12% · dlfree 11% | ~40% |
| `sprintf-loop` | 1017 | dlmalloc 10% · 锁 8% · dlfree 6% | 24% |
| `mem-alloc` | — | **挂死**（wasm 上分配 churn 极慢；已停，未取数） | — |

## 观察（实测，非推断）

1. **计算密集负载（BLAS/算法）~100% 落在内核自身**：dgemm 89%、sort 89%（sort+merge 三函数）、
   字符串比较 88% —— 这些是"该热的地方热"，**无可动的平台税**（与票 39/44/52 的结论一致）。
2. **对象/分配密集负载有一块共同的、跨负载复现的成本**：`dlmalloc` + `dlfree` +
   **`__pthread_mutex_trylock_owner`/`unlock`**，在 struct/cell/func-handle/loop/sprintf 上
   合计 **24–44%**，且**锁单独就占 8–16%**。

## 推断（**待结案**，不许当结论用）

> `__pthread_mutex_trylock_owner` 的高占比 = **线程安全分配器（dlmalloc 的 arena 锁）在
> 单线程分配路径上的税**。Octave 的分配几乎全在主线程；锁多半**无竞争**，但在 wasm 上
> "取锁"本身（`memory.atomic` 读改写 + owner 检查）不是零成本。

**⚠ 反面可能（必须排除）**：
- 这些符号可能是**采样归因的假象**（`trylock_owner` 是被内联/尾调用点的近邻，PC 归因会把它
  算到旁边函数上）；
- 也可能是**真竞争**（若 BLAS 池线程在别的负载里活跃）：但 `dot/matmul`（池线程最活跃）里
  锁 = **0%** ⇒ 竞争说不成立，反而支持"单线程路径税"。

**结案实验（两条，任一可判）**：
1. **车道对照**：把**同一批分配密集负载**在 **`w64-base`（单线程 memory64，无 pthread）**
   上扫一遍（`hotpath.symbols('w64-base')` 建站）。
   - 若 `w64-base` 的 alloc+锁 合计 **≈0** 且**墙钟更快** ⇒ 推断成立，锁是线程档付的税；
   - 若 `w64-base` 也有同样高占比 ⇒ 是 dlmalloc 本身（不是锁），换分配器才是路。
2. **换分配器**：`relink.sh` 侧试 `-sMALLOC=emmalloc`（或 mimalloc）在 w64 上重启扫描，
   比 alloc+锁 合计与墙钟。若锁消失且墙钟降 ⇒ 可动的杠杆存在。

**若成立，价值**：分配密集负载（REPL 交互、脚本、结构体/元胞、字符串构造 —— 教学与日常的
主流场景）**能省下这块税**；而它**不是**"重写解释器"，是**链接期一个分配器选择**。

## 边界（如实）

- 采样是 PC 级 self-time；`trylock_owner` 归因需上面两条实验证伪"归因假象"可能。
- 负载是我手写的（非 Octave 官方 benchmark），只用于**找共同形状**，不是基准分数。
- `mem-alloc` 与一次 `recursion` 负载把仪器挂死（wasm 上分配/深递归极慢）——
  `probe-hotpath.mjs` 已加片段超时 + 扫描器加了逐负载 `timeout`；`mem-alloc` 仍未取到数。

## ✅ 结案实验 ① 完成：推断**证实**（2026-10-03）

对照车道 `w64-base`（memory64 **单线程**）的符号站建成（`nodes 56` 那个 dlsync bug 修掉后仍撞
第二个自检，改**手工组站**绕开：`docker cp /src/websrc/hotpath-w64-base-sym/*` → 组四格 → 带 name 段）。
**同一 `func-handle` 负载**，两条车道都带符号归因：

| 车道 | 墙钟 | alloc+锁 合计 | **其中 pthread 锁** |
|---|---|---|---|
| `w64`（memory64 **+pthread**） | **1270 ms** | **41%** | **16%**（dlmalloc 16% / dlfree 9%） |
| `w64-base`（memory64 **单线程**） | **822 ms** | **20.7%** | **0.0%** |

**两条结论**：
1. ✅ **推断证实**：`__pthread_mutex_*` 是**线程档特有的**（16% → **0%**）。
   ⇒ 它是**线程安全分配器在单线程分配路径上的税**（无竞争也付：matmul 里 BLAS 线程忙、不分配
   ⇒ 锁 0%；这个负载主线程猛分配 ⇒ 锁 16%）。
2. ⚠ **`dlmalloc`/`dlfree` 本身（~20%）两档都在** —— 那是**分配器的活**，不是锁；
   要动它得**换分配器**（emmalloc / mimalloc），与"去掉锁"是**两个杠杆**。

**连带的墙钟**：这个**单线程分配密集**负载上，线程档比单线程档**慢 35%**（1270 vs 822 ms）——
线程档在这类负载上没有任何并行收益，却付了锁税。（⚠ 35% > 16% 采样占比 ⇒ 还含别的线程档开销，
**不许把 35% 全归给锁**；16% 那个是**实测归因**。）

## ✅ 工单 57：分配器杠杆 —— **mimalloc 成立（−27% 墙钟）**（2026-10-03）

用 `relink.sh exports w64` 拿模式表 env → 手驱动 `link-web.sh`（实验产物，不发布），
**同旗标 `DIAG_NAMES=1`** 建两版：dlmalloc vs **`-sMALLOC=mimalloc`**（`EXTRA_LDFLAGS` 追加）。
同一 `func-handle` 负载，**交错 3 轮**：

| 分配器 | 墙钟（3 轮） | 中位 | alloc | **pthread 锁** | wasm 体积 |
|---|---|---|---|---|---|
| dlmalloc | 1003 / 1016 / 1047 ms | 1016 | 30.6% | **10.3%** | 33.97 MB |
| **mimalloc** | 740 / 748 / 718 ms | **740** | 21.3% | **0.0%** | 34.04 MB（**+0.2%**） |

**结论**：mimalloc **−27% 墙钟**，且 **pthread 锁 10.3% → 0%**（per-thread heap ⇒ 主线程分配
不吃全局 arena 锁）。**数值验收全绿**（accept 四套 79/0 + dldfcn **71/0**）⇒ 不是"快而错"。
**体积代价 +0.2%**（可忽略）。

### ⚠ 一个被抓到的混淆变量（仪器纪律的实例，必须记）

第一版 A/B 报 **−39%**：dlmalloc 基线来自 `relink --diag`（**全套** NAMES+ASSERT+SOURCEMAP），
mimalloc 那次只设了 `DIAG_NAMES=1` ⇒ **`DIAG_ASSERT` 的运行期断言**让基线虚慢。
⇒ 用**同旗标**重建 dlmalloc 基线（`DIAG_NAMES=1` only）后，真实差是 **−27%**（更保守、更可信）。
**教训**：**A/B 必须同构建旗标**——这是 `-flto`/`--diag` 那一族的同一个坑（"两处旗标不对称"）。
→ 值得做成**不变量**（A/B 两件产物的 `octave.build.json.declared` 必须相同）——下一批候选。

### 待办（发运前）

- **`-sMALLOC=mimalloc` 进受管辖模式表**（`relink.sh` 的 w64 模式），走出厂核对（本次是手驱动、
  `declared=null` ⇒ 不可发布）。
- **全量验收**（含 `accept-dldfcn` + 探针）在 mimalloc 产物上跑一遍（本次只跑了数值四套 + dldfcn）。
- **发运决策是产品决定**（同 NT=8/FMA 那两批）——本批只到"实测成立 + 候选产物"。

### 边界（如实）

- 对比是 **--diag** 形态（两版同旗标）⇒ 绝对墙钟偏大；**相对差（−27%）**可信，绝对数不必外推。
- 单负载（`func-handle`）取墙钟中位；`struct-array`/`loop-for` 也复跑确认**锁 0%**（未逐一定墙钟）。
- mimalloc 动运行期内存管理 ⇒ 除数值四套 + dldfcn 外，**发运前必须过全量**（未做）。


