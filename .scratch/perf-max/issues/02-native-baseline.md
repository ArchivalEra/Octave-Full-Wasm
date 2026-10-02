**Type:** task
**Status:** open

## Question

**原生基线不存在，仪表盘无从谈起。** 在本机测原生 Octave（版本尽量对齐 11.3.0）的线代基准：
matmul 500²/1024²/2000²、lu(800) —— 与 `bench-lanes.mjs` / `bench-core.mjs` 同题同口径，
产出每题秒数与 GFLOPS，落成**可复跑脚本** + 台账键（`native_matmul500_s` 等，
走 `--accept-changes` 逐条）。原生侧用的 BLAS 与线程数必须如实记录，否则占比没有意义
（Q1=c 的仪表盘口径：占比是刻度，不是终点）。
