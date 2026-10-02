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

**Status:** ready-for-agent

**Settling:** `HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/bench-lanes.mjs
<NT=8 实验站>/ w64` —— 出 `SPEED_JSON` ⇒ 死锁已解；零输出超时 ⇒ 仍死锁。
（NT=8 产物与实验站都在：容器 `/src/websrc/w64-ob-nt8-out`、`w64-nt8-artifacts/`；复现链见
`w64-logs/relink-w64-nt8*.log`。）
