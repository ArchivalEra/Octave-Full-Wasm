# 40: **NT>4 的 OpenBLAS × JSPI feval 死锁**：NUM_THREADS=8 产物开机正常、第一个 promising feval 永不返回

**What to build:** 票 05 的实测发现（2026-10-02 夜）：`E2_NUM_THREADS=8` 重编的 w64 产物
（sha `a69170ec…`，`verdict=ok`）—— boot 1.0–1.2 s 正常、数值回归四套全绿（oct/libs/ode15/slicot），
但 `bench-lanes.mjs` **零输出挂死**：卡在启动等待 `Module.feval('strcat',…)`（JSPI promising 入口的
第二次调用）永不返回。**池大小无关**（pool=8 与 pool=12 都挂）；NT=4 现役无此问题。
机制候选：OpenBLAS 8 条 server 线程与 Emscripten worker 池/JSPI 挂起调度的交互
（对照工单 19 的热自旋机制；BOOT 阶段 OpenBLAS 建池后占满/干扰了 promising 恢复路径）。

**本单要做的：**
1. 定位死锁点（console/worker 侧取证：第几个 worker、卡在哪个 wait）；
2. 判定可修性（OpenBLAS 侧参数 / 胶水侧 / 或如实记"架构不可行"）；
3. 修复 ⇒ NT=8/16 曲线才有意义（perf-max 票 05 的数据依赖它）。

**Blocked by:** None

**Status:** resolved （2026-10-02 夜间批：死锁=调用方反模式×建池窗口竞态；调用方已修，NT=8 解锁）

**Settling:** test/browser/bench-lanes.mjs —— HARNESS=<harness> 跑：rc=0 ⇒ 结算件成立、结论见 Answer；rc≠0 ⇒ 先修结算件。
<NT=8 实验站>/ w64` —— 出 `SPEED_JSON` ⇒ 死锁已解；零输出超时 ⇒ 仍死锁。
（NT=8 产物与实验站都在：容器 `/src/websrc/w64-ob-nt8-out`、`w64-nt8-artifacts/`；复现链见
`w64-logs/relink-w64-nt8*.log`。）

## Answer

（2026-10-02 夜间批结案：**死锁定位 = 调用方反模式，不是 OpenBLAS NT=8 本身**。）

**取证链**（逐步隔离法：每步一个全新 page，崩溃互不牵连）：
- bench-lanes 的就绪循环**从 t=0 就轮询 `feval('strcat')`**（不等 `__octaveReady`）——
  这是 AGENTS 红线（"execute_interp 之前不许碰解释器"）的**自动化反模式**。
- NT=4 产物：boot 中途调用**干净抛错**（null function）⇒ 循环继续等 ⇒ 从未暴露。
- NT=8 产物：boot 中途的调用撞上 **OpenBLAS 建池窗口** ⇒ 主线程卡死在 wasm 里
  （页内 setTimeout 都不再触发；与池大小无关：8/8、8/12 都挂）。
- **就绪后调用**：NT=8 四步全绿（evalstr plain / evalstr strcat / feval builtin / feval strcat，
  每步独立 page，`w64-logs/step-check.log`）⇒ NT=8 本身健康。

**修复**（`test/browser/bench-lanes.mjs`）：就绪判定两段式 —— 先等 `__octaveReady`
（300s 上限），再探 feval。**修复后 NT=8 性能立刻显形**（同脚本同窗 A/B）：
matmul 500² **2.0×**、matmul 1000 **2.2×**、lu 800 1.3×、lu 1500 1.5×（NT=8 0.004/0.025/0.014/0.061
vs NT=4 0.008/0.056/0.018/0.091）—— 占原生天花板 ~60%（台账 `w64_ob_matmul500_native_ratio` 口径）。

**连带翻面**：票 05 的"NT=4 = 甜点"结论**作废**（甜点被调用方反模式挡住）—— 已在该票补记。
**遗留尖角**（防御性加固候选，不阻塞）：boot 中途调用在 NT=8 上"卡死"而非"快速抛错"——
胶水侧可在 pre-ready 状态把 eval 入口做成快速抛错（加固票候选）。
**NT=8 + pool=8 上站**：新发运候选（`w64-ob-nt8-out`，sha `a69170ec…`，数值四套全绿），
promote 由人拍板（模式表需同步 w64 档 NT=8 + 池 8）。
**【上站尝试失败、已回滚 2026-10-02】**用户拍板后发运，全量抓出**确定性回归**：
`accept-dldfcn` **71/0 → 44/27**（8858 独立站单跑复现 ⇒ 非资源竞争；首个崩溃
`table index is out of bounds` 后实例带死）。机制 = 工单 16 的"热自旋池线程挡住 dlopen 所需
共享内存/表增长安全点"，NT=8 池线程翻倍 ⇒ 显形，NT=4 从不暴露 ⇒ **本票的 NT=8 性能结论保留、
但 NT=8 不可交付**。已回滚 8761 → NT=4（`3b0d5e2f…`），dldfcn 复跑 71/0。
**⚠ 本票新发现**：候选当初只验"数值四套"，**漏了 dlopen 面** ⇒ 立新工单
（`41-nt8-dlopen-regression`）追"池策略/安全点"，并固化教训"上站候选必须过全量"。
**遗留尖角已落地（2026-10-03，工单 46）**：pre-ready feval 现在是快速 JS Error
（"not ready"），不再挂死 —— 探针 `probe-preready-guard.mjs`（5/0，含无守卫反面对照）；
随守卫产物发运 8761。
