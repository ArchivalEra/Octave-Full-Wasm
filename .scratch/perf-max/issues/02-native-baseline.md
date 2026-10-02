**Type:** task
**Status:** resolved（2026-10-02）
**原始 JSON** = `/mnt/hdd/octave-wasm-build/w64-logs/native-baseline.json`

## Question

**原生基线不存在，仪表盘无从谈起。** 在本机测原生 Octave（版本尽量对齐 11.3.0）的线代基准：
matmul 500²/1024²/2000²、lu(800) —— 与 `bench-lanes.mjs` / `bench-core.mjs` 同题同口径，
产出每题秒数与 GFLOPS，落成**可复跑脚本** + 台账键（`native_matmul500_s` 等，
走 `--accept-changes` 逐条）。原生侧用的 BLAS 与线程数必须如实记录，否则占比没有意义
（Q1=c 的仪表盘口径：占比是刻度，不是终点）。

## Answer

（2026-10-02 本会话结案；台账键 `native_*` 组 + 派生 `w64_ob_matmul500_native_ratio` / `w64_ob_matmul500_vs_netlib`；
原始 JSON = `/mnt/hdd/octave-wasm-build/w64-logs/native-baseline.json`（含 CPU/版本/两后端全量数字）；
复跑 = `sh build/113/bench-native.sh`（**机器空闲**；同题同口径抄 `bench-core.mjs` 的线代子集，×3 中位数））

**环境（如实记录）**：Debian sid，AMD Ryzen 9 3900X（12C24T，AVX2），Octave **11.3.0**（与 wasm 同版本）。
- 系统默认 BLAS = **netlib 参考实现**（`libblas.so.3 → blas/libblas.so.3.12.1`，单线程）。
- 为造"天花板"装了 `libopenblas0-pthread`（**0.3.34，与 wasm 里的 OpenBLAS 同版本族**）。
  ⚠️ 事故与处置：装包时 Debian alternatives **自动**把 `libblas.so.3`/`liblapack.so.3` 切到了 openblas
  （优先级 100 > netlib 的 10）—— 首轮基准的"净 netlib"行因此作废（跑出了物理上不可能的 258 GFLOPS）。
  已 `update-alternatives --set` **手动钉回 netlib**（blas+lapack 两个都钉回）；
  openblas 只通过 `LD_PRELOAD` 参与基准，**系统默认不被改变**。

**两后端（中位数）**：netlib（用户手里的原生 Octave）matmul500 = `native_netlib_matmul500_s`；
openblas24（天花板，24 线程）matmul500/1024/2000、lu800 = `native_openblas_matmul500_s` /
`native_openblas_matmul1024_s` / `native_openblas_matmul2000_s` / `native_openblas_lu800_s`，
线程数 = `native_openblas_threads`（GFLOPS 细节在 JSON）。

**仪表盘第一版**（键，别抄数）：浏览器 w64（线程版 OpenBLAS）占原生天花板的比值 =
`w64_ob_matmul500_native_ratio`；相对"用户手里默认 BLAS 的原生 Octave"的倍数 =
`w64_ob_matmul500_vs_netlib` —— **浏览器形态已经比默认原生 Octave 快数倍，天花板还剩约 3 倍余量**。
