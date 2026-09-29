# 04: UMFPACK 稀疏 `lu` 的整页陷阱

**What to build:** 稀疏 `lu` 会打挂整页（不是报错，是整页）——找出触发条件与最小复现，
以及它与 7.2 相比是否是能力回归。

**Blocked by:** None (can start immediately)

**Status:** resolved

**Settling:** 不存在 —— 本工单第一交付物：最小复现 + `SKIP=` 二分脚本，能稳定复现"整页挂"
且能在缩到最小后给出确定性的通过/失败。

**Type:** research

- [x] 先读 `build/113/NOTES-umfpack.md:29-31,60-74`，确认悬案仍在（读时点 = 修复后：悬案本体已被 52489ab 解答）
- [x] 最小复现：3 输出稀疏 `lu` 的 4 行 .m（见 repro 脚本头；1/2 输出不走数值分解所以不炸）
- [x] 判定：**不是能力回归** —— 修复后 3 输出可用（17/17），当前现役产物上实测 LU-OK
- [x] 结论回填 NOTES，工单置 `resolved`

## Answer（2026-09-29，无人值守批次）：根因 52489ab 已解；本单补上**可复现的结算件**

**结算件** = `build/113/repro-umfpack-trap.sh` + `test/browser/probe-umfpack-trap.mjs`，两面判决：

1. **修复侧**：现役站点跑最小复现（3 输出稀疏 lu）⇒ **`=== LU-OK rc=0`** —— 不再是 7.2 回归。
2. **陷阱侧**（`--rebuild-broken`）：把 SuiteSparse 的 `UMFPACK_CONFIG`/`CHOLMOD_CONFIG`
   **去掉 `-DNBLAS/-DNSUPERNODAL`** 重编到一次性 prefix，作为唯一差别链一份坏变体：
   **Binaryen（wasm-opt）当场拒收** —— `[parse exception: popping from empty stack (at 0:7204125)]`
   ⇒ 链不出产物。这与 09-22 的"链得过、运行时整页 trap"是**同一腐坏**（f2c 隐藏长度 vs
   标准 BLAS 约定），只是现在的 emcc/Binaryen 在出厂前就把它拦了 —— 复现成立（rc=0）。

**复现器自身的两处坑（修掉了，记下来免得再撞）**：
- `test/browser/run.sh` **没有执行位** ⇒ 脚本里必须 `sh "$RUN"`，直接执行=Permission denied
  且被管道吞掉（第一版表现为"探针无输出"）；
- 给 `relink.sh link` 手设 `EXTRA_LDFLAGS` 会被 `apply_mode` **重置**（口径表是唯一来源）
  ⇒ 坏库根本进不了链接（第一版的坏变体 sha 与正常 rebuild 一模一样）。
  变体链接要走 probe-wasm64-link 的正道：`relink.sh exports` 推出环境后**直接驱动
  link-web.sh**，EXTRA_LDFLAGS 才能活着进链接行。
