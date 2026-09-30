# 19: 让 `USE_THREAD=1` 的 OpenBLAS 产物**能用**（拿那 6.7× 内部多线程）

**What to build:** 现役线程档交付的是 OpenBLAS **`USE_THREAD=0`**（`threads_blas_dir` =
`/src/work/e2-openblas-lib-s`，收益 matmul ≈1.9×）。**`USE_THREAD=1` 那份有 ≈6.7×**
（台账 `e2_threaded_matmul500_ratio`）但**不可用**：装载 `.oct` 挂死（工单 16 定位）。
**用户指令（2026-09-29）：内部多线程要，不是可选项。** 本单 = 把那份产物修到可用。

**Blocked by:** None（工单 16 的定位已交付：`CELLS=C,E,F,D` 阶梯，见 NOTES-threads「工单 16 结案」）

**Status:** ready-for-agent

**Settling:** 两值可分辨 —— 修好后
`CELLS=C,A PROBE_... sh test/browser/run.sh test/browser/probe-e2-threads.mjs <threaded产物站点>`：
格 C（只 dlopen）**返回**（干净报 "must be square"）⇒ A（裸跑）也返回 ⇒ rc=0 ⇒ 修好；
格 C 仍挂 ⇒ 未修（当前实测形状）。**反向断言**：现役 `USE_THREAD=0` 站点上格 C 必须**本来就返回**
（不许把"把线程关掉"当成修好）—— 且 `e2_matmul500_ratio` 必须仍 ≈1.9×（不能悄悄退回车道）。

**Type:** task

## 已知事实（2026-09-29，全部可复跑）

| 事实 | 复跑 |
|---|---|
| 墙 = 在 `USE_THREAD=1` 主模块上**装载 `.oct`（dlopen）挂死**，>90s、100% CPU 忙等形状 | `CELLS=C sh test/browser/run.sh test/browser/probe-e2-threads.mjs http://127.0.0.1:8792/` |
| **不是** BLAS 算术：同站点纯 `rand(300)*rand(300)` 返回 | 同上 `CELLS=D` |
| **不是** error 路径：纯 `error('boom')` 返回 | 同上 `CELLS=E` |
| **不是**线程数：先 `openblas_set_num_threads(1)` 仍挂 | 同上 `CELLS=B` |
| `.oct` 文件**两端逐字节相同**（`413eb730…`）⇒ 差别在主模块 | `sha256sum site-e2diag/threads/minioct.oct site/threads/minioct.oct` |
| 现役 `USE_THREAD=0` 站点上同一句**正常**（`accept-113-oct` 8/0） | `sh test/browser/run.sh test/browser/accept-113-oct.mjs http://127.0.0.1:8768/` |

## 待验假设（按可能性排序，**每条都写了判别实验**）

1. **★ 自旋的 worker 线程卡住共享内存增长**（最强候选；**已找到源码级旁证**）。
   **源码证据**（容器内 `sed -n '415,430p' /src/work/OpenBLAS-e2/driver/others/blas_server.c`）：
   worker 的无活等待是一个 `while(!tscq...) { YIELDING; ... }` 热循环，而
   `YIELDING` 的定义是 `__asm__ __volatile__("nop;...nop;")`（`common.h:382`）——
   **在 wasm 里不是真让出**（`sched_yield` 语义缺失），于是池线程持续自旋（实测 100% CPU 形状吻合）。
   机制：Emscripten 的 `-pthread` 共享内存在 `ALLOW_MEMORY_GROWTH` 下**要所有线程到安全点**才能
   增长；而 OpenBLAS `USE_THREAD=1` 的池线程用**自旋同步**（wasm 里 `sched_yield` 近似空转）
   ⇒ 永远到不了安全点 ⇒ 需要增长的 `dlopen` **永不完成**，且 CPU 100%（线程在自旋）。
   这也解释了"设成 1 线程仍挂"（池已建）。
   **判别实验（便宜、决定性）**：在 threaded 站点上**不碰 dlopen**、只强制内存增长
   （`a = zeros(1, 200e6); a(end)=1;`）—— 挂 ⇒ 假设成立（墙是"增长"而不是"装载"）；
   返回 ⇒ 假设否掉，看第 2 条。
2. **dlopen 自身在 shared-memory 下的锁**（dylink 互斥 + TLS 槽分配）与 OpenBLAS 初始化互锁。
   **判别**：把 `PTHREAD_POOL_SIZE` 加大/改 `PTHREAD_POOL_SIZE_STRICT`，看挂点是否移动。
3. **OpenBLAS 的 `pthread_create` 在主线程上做 `Atomics.wait`**（等 worker 可用）而 worker 起不来。
   **判别**：`-sPTHREAD_POOL_SIZE=0`（动态建线程）vs 固定池，两种产物的挂点对比。

## 修法方向（等 1/2/3 定案再选，别先写代码）

- 若第 1 条成立：让 OpenBLAS 的同步**可被打断**（`OPENBLAS_THREAD_TIMEOUT`/自旋次数，
  或改用 `USE_SIMPLE_THREADED_LEVEL3`/`USE_OPENMP=0` 的 park 型同步），或在 boot 期间
  **预增长内存**到目标值（把增长从 dlopen 那一刻挪走）。
- 若第 2 条成立：把 `.oct` 装载**挪到 boot 早期**（任何 BLAS 调用之前），或改内存增长策略。
- 若第 3 条成立：固定池 + `PTHREAD_POOL_SIZE_STRICT=2` 早建池，让 `pthread_create` 不再阻塞。

## 硬坑（照抄）

- **不许覆盖现役**：新产物落独立 prefix/目录（`e2-openblas-lib` 那份是实验档）。
- 一次只动一个轴（本单不夹带 E2 之外的活）。长任务后台 + 完成通知，**禁止 `sleep`**。
- 判据必须**两值可分辨**（修好/未修好），且必须带**反向断言**（见 Settling）。
