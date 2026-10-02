**Type:** task
**Status:** resolved（2026-10-02 夜间批：NT=4 为甜点；NT=8 死锁立工单 40）
**Blocked by:** 01

## Question

**线程数与调度调优**（票 01 杠杆 **L6/L8/L9**）：NUM_THREADS 对 hardwareConcurrency 的匹配
（现状 MAX_CPU_NUMBER=4 + 池=4）、运行时旋钮 `set_num_threads` 的导出（L8）、
OpenBLAS 热自旋/空闲解散参数（L9，工单 19 的 `YIELDING` / `THREAD_TIMEOUT` 机制）在浏览器环境的
实测影响。逐配置 bench（同一套仪器、同一台机器），产出"线程数–性能"曲线与推荐配置（带复跑命令）。

## Answer

（2026-10-02 夜间批结案。曲线数据 + 一条新机制发现。）

**NT=8（L6）**：重编成功（`E2_NUM_THREADS=8` 旋钮，WORKDIR `OpenBLAS-e2-w64-nt8`，merged3 在位，
sha `a69170ec…`、`verdict=ok`、boot 1.0–1.2 s、数值回归四套全绿 oct 8/0 libs 17/0 ode15 29/0 slicot 25/0）
—— 但 **bench 零输出挂死**：卡在第一个 promising `feval`，**与池大小无关**
（pool=8 / pool=12 都挂；boot 前的 OpenBLAS 建池正常）。⇒ 不是资源饿死，是
OpenBLAS 8 线程 × JSPI 调度的交互死锁 ⇒ **单独立悬案工单 40**（可修性待查）。
NT=16 不再重复（同一机制，预期同样挂）。

**结论**：
- **NT=4 = 当前架构的甜点**（现役；性能与可用性的唯一同时解）。
- L8（`set_num_threads` 运行时旋钮导出）：未做 —— 被 40 号死锁挡住（能设也不能开到 >4），
  并入工单 40 解锁后的后续。
- L9（`THREAD_TIMEOUT` 变体）：未做 —— 影响池生命周期不影响并行度，预期收益微小；
  留给 40 号解锁后一起。
- **对照数据（现役 NT=4，本夜同窗实测）**：matmul 500² = 台账 `w64_ob_matmul500_s`（0.006–0.007 s）、
  lu 800 = `w64_ob_lu800_s`（0.016–0.018 s）、matmul 1000 0.048–0.056、lu 1500 0.092–0.096、
  svd 400 0.147–0.176、loop 1e6 0.715–0.754（跨轮方差带，`w64-logs/lto-ab-bench.log` + 各实验轮）。
