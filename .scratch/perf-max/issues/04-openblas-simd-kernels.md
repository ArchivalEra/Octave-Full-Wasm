**Type:** task
**Status:** open
**Blocked by:** 01

## Question

**OpenBLAS SIMD 内核实验**（外部评审路线 WASM128_GENERIC，我方零实验）：按 01 号票的
杠杆清单改 OpenBLAS 构建，**w64 与 wasm32-threads 两条 E2 配方都跑**（载体决定缓发，
数据先齐）→ relink → `bench-lanes` 全题 → 数值回归全绿 → 与现役同题对比、按 02 的
原生基线报占比（02 未结就先报"相对现役倍数"）。产物 `verdict=ok` 才算数；
旗标类改动必须配一条**从产物读出来**的自检（防"赋值了但没被引用"静默失效）。
