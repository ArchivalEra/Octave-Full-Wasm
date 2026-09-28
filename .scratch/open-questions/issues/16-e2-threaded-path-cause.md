# 16: 线程版代码路径本身 —— `USE_THREAD=1` 的 OpenBLAS 到底在哪一段改变了行为

**What to build:** 工单 02 已把问题收窄到确定的一支：卡点**不是**线程数
（设成 1 线程仍不返回，见 R-010）。本工单找的是**那一支里的具体位置**。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Settling:** `test/browser/probe-e2-threads.mjs` —— rc=0 ⇒ 该段不是卡点（继续下一段）；rc=7 ⇒ 该段就是卡点（把栈/日志钉在那一格里）
—— 扩成"**逐段二分**"的形状：`rc=0` ⇒ 该段不是卡点（继续下一段）；`rc=7` ⇒ 该段就是卡点
（把栈/日志钉在那一格里）。当前它的两格都返回 `hung`，所以本单第一交付物是**加第三格**。

**Type:** research

**候选形状（都要实测，不许当结论 —— 这是 R-010 的教训）**：
1. `USE_THREAD=1` 编出来的**条件编译分支**与 `=0` 不同（代码路径本身，与运行时线程数无关）；
2. `blas_server` 的**启动期副作用**（构造/初始化时机）在 side-module 装载语境下出问题；
3. 与 `.oct` 的 **dylink 符号解析**之间的交互（主模块导出面变了？诊断档导出 735 vs 线上 725）。

**手里的工具**：工单 01 的 `DIAG_EXPORTS`（可继续加符号）、`--diag` 的 name 段/断言/sourcemap、
诊断档产物 `85e64295…`、以及 `probe-e2-threads.mjs` 的硬超时框架
（**注意**：挂死的是 wasm 主线程 ⇒ 拿不到 wasm 栈；要栈得另配仪器，那本身可能是一张新单）。

- [ ] 先读 `NOTES-threads.md` 的 E2 节（结案实验① 与 ②）+ `retractions.json` 的 R-010
- [ ] 加第三格做**分段二分**，每一格都给出确定性的"是不是卡点"
- [ ] 结论回填 NOTES（实测/推断分开），`Status:` 置 `resolved`
