**Type:** task
**Status:** claimed（2026-10-02，本会话）
**Blocked by:** 01

## Question

**OpenBLAS 内核/编译档实验**（票 01 杠杆 **L1/L2/L3/L4/L5**；原前提"WASM128_GENERIC 没用上"已被
01 号票实测**翻案** —— 它上游自带且已在用，真正的空白在下面这些）：
按 01 号票的清单改 OpenBLAS 构建，**w64 与 wasm32-threads 两条 E2 配方都跑**（载体决定缓发，
数据先齐）→ relink → `bench-lanes` 全题 → 数值回归全绿 → 与现役同题对比、按 02 的
原生基线报占比（02 未结就先报"相对现役倍数"）。产物 `verdict=ok` 才算数；
旗标类改动必须配一条**从产物读出来**的自检（防"赋值了但没被引用"静默失效）。
L1+L2+L3 是真内核开发、工作量大 —— 若一张票吃不下，在动手时按杠杆拆票（先 L4/L5 这种配方级便宜的）。

## 进度 · 第一刀 L4（编译档 -O2→-O3）✅（2026-10-02）

**做法**：`build-e2-lane.sh` 加 `COMMON_OPT` 通路（OpenBLAS 自带默认 -O2 的来源），
**本批已把车道默认定为 `-O3`**（`E2_COMMON_OPT` 可覆盖回退）；实验在**全新 WORKDIR/OUTLIB** 里做
（`OpenBLAS-e2-w64-o3` / `e2-openblas-lib-w64-o3`），好树不碰。

**两个新坑（都已修/固化）**：
1. stage_build 的"utest 无妨"豁免正则 `\.exe($| )` 匹配不了 make 前缀 `[Makefile:81: xxx.exe]`
   形态 ⇒ 自身假红。已修：`\.exe($| |\])`。
2. **包装对象是车道配方的一部分**：默认 `WRAPPERS`（裸 76 版）缺 23 个透传壳 ⇒ `lsame_` 无人定义
   ⇒ 链接落空自引用 ⇒ 页面 `RangeError: Maximum call stack size exceeded`（`_lsame_` 无限递归）。
   w64 默认已改指 **`e2-f77-wrappers-w64-merged3.o`**。附带记录：误 pack 过一次 threads 车道
   的 OUTLIB（默认 env、同输入确定性打包，应等价）—— threads 侧复链前先验开机+回归。

**实测**（8854 = site-w64-o3，relink 口令 `E2_OPENBLAS=/src/work/e2-openblas-lib-w64-o3 bash relink.sh link w64 --out /src/websrc/w64-ob-o3-out`）：
- `verdict=ok`（sha `3b0d5e2f…`）、开机 **1.2 s**；
- bench：matmul 500² **0.006 s**（现役 0.007 ⇒ ~1.2×）、matmul 1000 0.056、lu 800 **0.018**（~1.05×）、
  svd 400 0.176、loop 1e6 0.723（标量循环不动 —— 符合 Q4=a 口径）；
- 数值回归全绿：oct **8/0** / libs **17/0** / ode15 **29/0** / slicot **25/0**。
- 对照原生天花板（票 02）：matmul 500² 0.006 vs 原生 0.0024 ⇒ 占比 ~40%（台账键口径在 promote 后刷新）。

**结论**：L4 = 温和真实收益（~1.05–1.2×），已转正进车道默认配方；产物未 promote（票 08）。
**票未结**：L1/L2（level-1/2 内核 SIMD + GEMM 微内核加宽）是真开发、收益预期最大，待下一批；
L3（复数内核）与 L5（LAPACK）在其后。
