# 02: E2 线程版在 dlopen 的 `.oct` 路径上不返回 —— 定位"为什么"

**What to build:** 把"线程版 OpenBLAS 在这条路上不返回"从**一句散文**变成**一个能跑的二分**。
已知终点：`accept-113-oct` 在 E2 线程版站点上跑满 600 s 未完成（`rc=124`），而**同一条链接**的
单线程变体同套件数秒级通过、车道基线 83 s。未知的是**为什么**：是"多线程唤醒"，还是
"线程版代码路径本身"。

**Blocked by:** 01（需要诊断/导出口子）

**Status:** ready-for-agent

**Settling:** 新建 `test/browser/probe-e2-threads.mjs` 两格（裸 `.oct` 路径 / 先 `set_num_threads(1)`）—— rc=0 ⇒ 定位在「多线程唤醒」；rc=7 ⇒ 定位在「线程版代码路径本身」
自托管带头服务 + 每格独立超时 + 末行 `=== N PASS / M FAIL ===`）。
两格：① 裸跑 dlopen 的 `.oct` 路径；② 同路径但先注入 `openblas_set_num_threads(1)`。
`rc=0` ⇒ 定位在多线程唤醒；`rc=7` ⇒ 定位在线程版代码路径本身。

**Type:** research

**⚠️ 今天的硬事实（实测，决定了这张工单的第一步）**：三个产物（E2 线程版 / E2 单线程 / 现役车道）
导出表各 **725 条，`blas|num_threads` 命中 0** ⇒ 页面侧**够不到**这个旋钮。
`openblas_set_num_threads` 全仓唯一被调用的地方是 `build/113/probe-blas-threads/main.c` ——
那是**自带 OpenBLAS 的独立探针**，不是 Octave 页面，同一条装载路径不成立。
所以**本工单的第一个交付物是"让页面够得到它"**（重链 + 导出口子），不是写探针。

- [ ] 第一步：给 E2 线程版产物导出该符号（用 01 的口子），并**从产物里读出来**证明它导出了
- [ ] 第二步：`probe-e2-threads.mjs` 两格都能跑出**不同**的 rc
- [ ] 第三步：结论回填 `build/113/NOTES-threads.md` 的 E2 节（推断 → 实测），工单置 `resolved`
- [ ] 若证明不可行 ⇒ 把结论写进 NOTES 并说明代价，**不要**删这张工单
