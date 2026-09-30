# 16: 线程版代码路径本身 —— `USE_THREAD=1` 的 OpenBLAS 到底在哪一段改变了行为

**What to build:** 工单 02 已把问题收窄到确定的一支：卡点**不是**线程数
（设成 1 线程仍不返回，见 R-010）。本工单找的是**那一支里的具体位置**。

**Blocked by:** None (can start immediately)

**Status:** resolved

**Settling:** `test/browser/probe-e2-threads.mjs` —— rc=0 ⇒ 该段不是卡点（继续下一段）；rc=7 ⇒ 该段就是卡点（把栈/日志钉在那一格里）
—— 扩成"**逐段二分**"的形状：`rc=0` ⇒ 该段不是卡点（继续下一段）；`rc=7` ⇒ 该段就是卡点
（把栈/日志钉在那一格里）。**2026-09-29 已扩成四格 C/E/F/D + A/B**：`CELLS=C,E,F,D sh test/browser/run.sh test/browser/probe-e2-threads.mjs <诊断站URL>`（诊断站 = site-e2diag / 8792）。当前它的 A/B 两格都返回 `hung`，所以本单第一交付物是**加第三格**。

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

## Answer（2026-09-29，无人值守批次）：定位到 **`.oct` 动态装载段**（非 BLAS 算术、非线程数）

**六格阶梯**（`CELLS=C,E,F,D` + A/B，8792 = USE_THREAD=1 诊断站，9 PASS / 0 FAIL）：

| 格 | 内容 | 结果 |
|---|---|---|
| **C** | `.oct` 在 ⇒ `miniprobe(1)` 要 dlopen | **挂死 >90s** |
| E | 纯 `error()`（无 dlopen） | 返回（`last_error=boom`） |
| **F** | 同一句 `miniprobe(1)`，**不装夹具**（不 dlopen） | 返回（`'miniprobe' undefined near line 1`） |
| D | 纯 dgemm（无 dlopen） | 返回 |
| A | 裸跑 | 挂死 >300s |
| B | 先 set_num_threads(1) | **仍挂死**（与 R-010 一致） |

⇒ 结论：**在 USE_THREAD=1 的 OpenBLAS 产物上，装载 `.oct` 会挂死**；C/F 同码不同夹具是决定性判别，
D/E 排除了"BLAS 算术"与"error 路径"两条候选。

**边界（如实）**：这不是交付缺口 —— 现役线程档用 `USE_THREAD=0`（`threads_blas_dir`），
`.oct` 装载正常（`accept-113-oct` 8/0）。本单交付的是**"要拿 6.7× 该修哪一段"的定位**。
**判据坑**：Octave 错不会让 `eval_string` 抛 JS 异常 ⇒ 必须读 `last_error_message()`（第一版假红三条）。
