**Type:** research
**Status:** open
**Settling:** 本票的交付物即结算件 —— 杠杆清单 v1 落在本票 Answer（每条带复跑命令）

## Question

四车道现役 OpenBLAS / 链接链路到底编的什么内核、什么线程配置、链接侧还有哪些没用上的优化
—— **性能杠杆清单 v1**。逐杠杆给出：现状值（带复跑命令）、可改值、预期收益量级
（标注【实测】/【推断】/【猜想】）、改法落点（脚本:变量）、风险与回归成本。
至少覆盖：

1. OpenBLAS 各车道构建配方与**实际内核**：`build/113/build-e2-lane.sh`（`E2_LANE`）、
   容器内 OpenBLAS 树的 Makefile.config（TARGET / CORE / NUM_THREADS / 内核集 / SIMD）；
   外部评审提的 **WASM128_GENERIC** 是什么、我们用没用（OpenBLAS 源码树在容器/`/tmp/opencode`）。
2. 线程配置：NUM_THREADS 与浏览器 hardwareConcurrency 的关系、Emscripten pthread 池
   （PTHREAD_POOL_SIZE）、OpenBLAS 热自旋参数（工单 19 已 resolved 的机制结论：
   `YIELDING` / `THREAD_TIMEOUT`，读 `.scratch/open-questions/issues/19-openblas-internal-threads.md`）。
3. 链接侧：`build/113/link-web.sh` / `relink.sh` 的优化旗标现状（-O 档、wasm-opt、
   LTO 有没有用），emcc 5.0.7 还有哪些性能相关旗标没上。
4. 参照数字：`build/FACTS.json` 的 `w64_ob_*` / `e2_threaded_*` / `wasm_v128` 组（只读）。

调查对象：仓库 + docker 容器 `o113`（**只读**检查；必要时 `sudo docker start o113`）。
**不改任何仓库/容器文件，不 commit，不用 sleep。**
