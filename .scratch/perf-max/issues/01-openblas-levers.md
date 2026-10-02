**Type:** research
**Status:** resolved
**Settling:** 本票的交付物即结算件 —— 杠杆清单 v1 落在本票 Answer（每条带复跑命令）；完整版 `/mnt/hdd/octave-wasm-build/w64-logs/research-openblas-levers.md`

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

## Answer

（research 子代理 2026-10-02 完成；全程只读；完整报告 = `/mnt/hdd/octave-wasm-build/w64-logs/research-openblas-levers.md`，
含每条的复跑命令与产物身份证交叉验证。）

**三个关键查证（都推翻了图绘制时的默认假设）**：
1. **WASM128_GENERIC 已经在用**【实测】：make 命令行 `TARGET=WASM128_GENERIC`（`build/113/build-e2-lane.sh:132`），
   且是 OpenBLAS 0.3.34 **上游自带**（干净树 `TargetList.txt:159` + `kernel/wasm/`），不是本仓补丁。
   ⇒ "外部评审路线没用上"这个前提**不成立**。
2. 两条 E2 配方都是 `USE_THREAD=1 NO_LAPACK=1 NUM_THREADS=4 E2PREFIX=ob_` + `-msimd128 -O2`（make.log 实锤）；
   w64 多 `-sMEMORY64=1`。**现役 threads 档的 BLAS 其实是单线程** OpenBLAS（`e2-openblas-lib-s`）；
   w64 档已是线程版（`e2-openblas-lib-w64`，台账 `w64_ob_matmul500_speedup`）。
3. level-1/2 内核（daxpy/copy/scal/dot/asum）**v128=0**【实测】⇒ SIMD 只在 GEMM 微内核里，level-1/2 全标量。

**杠杆清单 v1**（L# = 报告编号；预期收益的置信级别照抄报告）：

| # | 杠杆 | 现状 | 可改 | 预期 | 落点 |
|---|---|---|---|---|---|
| L7 | threads 档换线程版库 | e2-openblas-lib-s（1.9×） | `E2_OPENBLAS=idleexit`（钩子已在） | **6.7×**【实测】 | relink.sh:188 |
| L4 | OpenBLAS 编译档 | `-O2`（level-1 零向量化） | CC 加 `-O3` | 1.2–2×【推断】 | build-e2-lane.sh:132 |
| L6 | 线程数 | MAX_CPU_NUMBER=4 + 池=4 | 两侧同抬 8/16 | 大矩阵近线性【推断】 | build-e2-lane.sh:134 + relink.sh:189/225 |
| L1 | level-1/2 内核 SIMD | v128=0【实测】 | 写 wasm_simd128 内核 | 2–4×【推断】 | 容器 kernel/wasm/ + KERNEL 文件 |
| L2 | GEMM 微内核 | DGEMM_UNROLL=2×2 | 加宽 tile | 再 1.3–2×【推断】 | kernel/wasm/gemmkernel_wasm128.c |
| L3 | 复数内核 | C/Z GEMM=generic 标量 | 照 S/D 写 SIMD | 2–3×【猜想】 | 同 L1 |
| L5 | LAPACK | f2c 版（NO_LAPACK=1） | 去掉 NO_LAPACK（-DC_LAPACK 已通） | lu 类 1.2–2×【推断】 | build-e2-lane.sh:132 |
| L11 | 内存上限 | 默认 2GB→存活 1.49GiB | w64 加 `-sMAXIMUM_MEMORY=4GB` | 解锁规模 | link-web.sh SFLAGS |
| L10 | 链接优化 | -O2；无 LTO；wasm-opt 隐式跑 | -O3 / -flto（LTO×MAIN_MODULE 未验证【猜想】） | 个位数%【猜想】 | link-web.sh:429 |
| L9 | 池生命周期 | THREAD_TIMEOUT 31≈1.5s 空闲解散 | 调数值（权衡首调延迟） | 非提速【推断】 | patch-openblas-idle-exit.py:54 |
| L8 | 运行时旋钮 | set_num_threads 仅 --diag 导出 | 并进 EXPORT_IF_DEFINED | 解锁动态调参【推断】 | relink.sh 模式表 |
| L12 | 初始内存 | INITIAL_MEMORY=128MB | 抬到典型用量减增长暂停 | 小【推断】 | link-web.sh:193 |

**建议立项顺序**：L7（零代码，部署决定）→ L4 → L6 → L1+L2（收益最大工作量最大）→ L11 → L10（LTO 先做兼容性最小实验）→ 其余。
