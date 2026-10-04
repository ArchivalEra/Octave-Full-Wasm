# NOTES · libm 部件 spike（wasm64-NEXT 工单 60）

> 推断/机制的落点。活状态只写实测；本文件记录**为什么**。
> 结算件 = `build/113/bench-libm-spike.sh`（+ `test/fixtures/libm-spike/{bench.c,shim.c,driver.mjs}`）。

## 实测（2026-10-04，两轮一致）

**spike A（零新依赖）**：把 emscripten 自带 musl 的 exp/log/pow/sin/cos/__rem_pio2 用
`-O3 -fno-math-errno -ffp-contract=fast -mrelaxed-simd` 重编成覆盖对象（wasm64 车道，
`--allow-multiple-definition` 下显式对象先于 libc = 第一定义胜出），同进程同窗对拍：

| 函数 | 基线 (ms)¹ | 覆盖 (ms) | 比值 | 精度 maxrel（对照 host Math.*） |
|---|---|---|---|---|
| sin | 23.0 | 23.0–23.2 | 0.998–1.010 | 1.60e-16（与基线**逐位一致**） |
| exp | 22.7 | 22.7–22.8 | 1.003–1.004 | 2.13e-16（逐位一致） |
| log | 24.9–25.6 | 25.5–25.6 | 1.003–1.025 | 2.21e-16（逐位一致） |
| pow | 38.1–38.6 | 35.8–36.6 | 0.941–0.949 | 0（逐位一致） |

① 2²⁰ 元素 × 8 reps，5 次取中位；3 轮交错再取中位。
**geomean = 0.991（两轮同值）⇒ SPIKE_VERDICT: REJECT**（门槛 ≥1.5 = 热点压降 ≥1/3 的操作化）。

## 机制：为什么标量换 libm 在 wasm 上没有 headroom

1. **wasm 没有标量 FMA**：`f64x2.relaxed_madd` 是 **v128 专用**指令（实测覆盖对象
   `exp.o` 里 `fd 87 02` 字节 = **0 条**——`-ffp-contract=fast` 在标量代码上无事可做）。
   多项式求值是 Horner 依赖链，标量上只能 mul+add 分开（4+4 周期）。**向量化的 madd
   才可能省一半链长 ⇒ 批量求值是前提**——这正是工单 58"批量 libm = 集成项目"的机制根源。
2. **musl 标量已在地板上**：基线实测 sin/exp ≈ **2.7 ns/调用**（≈10 周期 @ 本机频点）、
   log 3.0、pow 4.6。1.5× 门槛意味着 1.8 ns/调用——对 1 ULP 级正确实现（区间归约 +
   多项式链）不可达。
3. `-fno-math-errno` / `-O3`：结果逐位不变、速度不变（errno 分支不在热路径，分支预测免费）。

## 剩余路线都在插件契约之外（按用户的硬边界）

- **v128 批量求值**（SIMD libm，SLEEF 风格）+ **Octave 元素循环批量调用**（改调用点）或
  整树重向量化（改 Octave 对象层）——都动 Octave 树，违反"极其不想脱离 Octave 树"。
- SLEEF 标量 u10（spike B）不再单测：同为标量实现，同受"无标量 FMA"上限约束，
  而门槛要 1.5×；musl 已在地板 ⇒ 无判别力。

## 结论（负判决，与 faer/PGO 同款归档）

**链接期 libm 替换轴否决。** 元素级数学热点（exp_inline/log_inline/sin+cos+__rem_pio2/pow）
的改善路径只剩"改 Octave 树"一类，不属于插件系统可达范围。**插件可换部件空间就此实测封口**：
分配器（mimalloc，已发运）是最后一块，libm 是第二块也是最后一块候选的实测否决。
