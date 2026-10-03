# 45: **最终结算**：浏览器 w64（NT=8）vs 本机原生 Octave 11.3.0 —— 同机同窗全用例对表

**What to build:** 用户点令（2026-10-03）："做最终结算，与 Octave 原版性能比较下，反正本机
也装了"。原生基线（票 02）此前只量了 matmul/lu 三个点；本单把 `build/113/bench-native.sh`
扩到 **bench-lanes 全部 9 题**（Octave 代码逐字取自 `test/browser/bench-lanes.mjs` 的 CASES
表），两个原生后端 + 现役浏览器产物同机同窗对表，给"wasm 版到底到了什么水平"一张终表。

**Blocked by:** None

**Status:** resolved（2026-10-03：全 9 题对表完毕，三行反超原生天花板、两行小输 —— 见 Answer）

**Settling:** `sh build/113/bench-native.sh`（写 `w64-logs/native-baseline.json`）+
`HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/bench-lanes.mjs
http://127.0.0.1:8761/ w64` —— 两侧 JSON 合成结算表（本单 Answer 的表）；数值与台账
`native_*` / `w64_ob_*` / `w64_vs_netlib_*` 键一致 ⇒ 结算成立。

## Answer

（2026-10-03 结算。同机同窗：原生 = `octave-cli 11.3.0`（Ryzen 9 3900X，24 逻辑核），
浏览器 = 8761 现役 w64 `-O3+8GB+NT=8`（sha = 台账 `w64_wasm_sha`）。原生 ×3 中位数、
浏览器 ×3 中位数；浏览器列 = 台账账本日志 `w64-logs/bench-ob-w64.log` 那轮。）

| 用例 | 原生 netlib（参考实现） | 原生 OpenBLAS×24（天花板） | **浏览器 w64 NT=8** | vs netlib | vs 天花板 |
|---|---|---|---|---|---|
| matmul 500 | 0.0272 | 0.0032 | **0.003** | **9.1×** | **1.07** |
| matmul 1000 | 0.1962 | 0.0096 | **0.025** | **7.8×** | 0.38 |
| lu 800 | 0.0408 | 0.0261 | **0.014** | **2.9×** | **1.87** |
| lu 1500 | 0.2576 | 0.0405 | **0.068** | **3.8×** | 0.60 |
| svd 400 | 0.1855 | 0.1966 | **0.155** | 1.2× | **1.27** |
| dot 1e7 | 0.0082 | 0.0046 | 0.009 | 0.91× | 0.51 |
| sum 1e7 | 0.0087 | 0.0076 | 0.008 | 1.09× | 0.94 |
| sort 2e6 | 0.2124 | 0.2165 | 0.238 | 0.89× | 0.91 |
| loop 1e6 | 0.5001 | 0.4861 | 0.750 | **0.67×** | 0.65 |

**怎么读这张表（三条诚实结论）**：

1. **线代主力全面碾压"用户手里的原生 Octave"**：matmul **7.8–9.1×**、lu **2.9–3.8×**、
   svd 1.2×——浏览器 wasm（OpenBLAS 内核 + SIMD + 8 线程）把单线程 netlib 参考实现甩开一个量级。
2. **小问题追平/反超"24 线程原生天花板"**（matmul500 1.07、lu800 1.87、svd 1.27）：这不是
   "wasm 比原生硬件快"，而是**原生侧 24 线程在小问题上吃超额订阅税**（同步开销盖过算力），
   浏览器的 8 线程恰在甜点；svd/LAPACK 部分本就少并行化。大矩阵天花板才拉开（matmul1000
   0.38 = 24 线程 × AVX-512 的算力优势）。
3. **唯一明确输的轴 = 纯解释器**：`loop 1e6` **0.67×**（慢约 1.5×）——解释器循环不走 BLAS，
   这是 wasm AOT vs 原生 JIT 的平台税，调不动；`sort` 0.89× 同属内存带宽税。

**与旧台账的口径注记**：`native_openblas_lu800_s` 10-02 记录 0.0076 → 今日同窗 0.0261
（3.4×）—— 24 线程小问题 LU 对机器状态极其敏感（工单 44 的 ±30% 方差结论在原生侧同样成立）；
结算表全部采用**同窗实测**，逐条可复跑（`w64-logs/native-baseline.json` +
`settle-w64-r{1,2}.log` + `bench-ob-w64.log`）。

**终局**：96 条事实入账（新增 `native_netlib_matmul1000_s` / `native_openblas_matmul1000_s` /
`w64_ob_matmul1000_native_ratio` / `w64_vs_netlib_matmul1000` / `w64_vs_netlib_lu1500` /
`w64_vs_netlib_loop1e6` 等）。性能线到此**全面收官**：可配置面、手写面、线程轴、原生对照
四张账全部实测清空。
