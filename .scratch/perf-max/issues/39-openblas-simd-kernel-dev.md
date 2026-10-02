# 39: **OpenBLAS wasm SIMD 内核开发**（票 04 拆分：L1/L2/L3 —— 真 C + wasm intrinsic 开发）

**What to build:** 票 04 的 L1/L2/L3 是**真内核开发**（写 C + wasm_simd128 intrinsic），按票 04
自己的条款拆出本票，逐族立项实施：

- **L1 · level-1/2 内核 SIMD 化**（预期 2–4×【推断】）：现状 level-1（daxpy/dcopy/dscal/ddot/dasum）
  **v128=0 全标量**【实测，票 01】。落点 = 容器 OpenBLAS 树 `kernel/wasm/`（TARGET=WASM128_GENERIC
  的 KERNEL 文件指定用哪些内核文件）；照 x86 SSE 内核的形状写 wasm_simd128 版本，逐内核替换。
- **L2 · GEMM 微内核加宽**（预期再 1.3–2×【推断】）：`kernel/wasm/gemmkernel_wasm128.c`
  的 DGEMM_UNROLL=2×2 tile 加宽（4×4 / 8×4，AVX 形状移植）。
- **L3 · 复数内核**（预期 2–3×【猜想】）：C/Z GEMM 现为 generic 标量，照 S/D 的 SIMD 版写。

**方法论（每族内核的固定动作）**：
1. 先在**容器外**用原生 clang 编译同一份内核 C（`-msimd128`）验证数值（对 netlib 参考实现 diff）；
2. 容器内 `build-e2-lane.sh`（新 WORKDIR/OUTLIB）→ relink → `bench-lanes` → 数值回归四套；
3. **逐内核小步提交**：一个内核一族 bench 数字，红了回退单文件（架构断言 + 保活核对是安全网）；
4. 与 L6（线程数）正交，注意跨变量干扰：内核实验期间线程数固定 4。

**Blocked by:** 01（已结）

**Status:** ready-for-agent

**Settling:** 不存在 —— 第一交付物 = 产地 `build/113/bench-lanes.mjs` 的同题对比
（L1 第一族内核的 w64 档 bench vs 现役 `w64_ob_matmul500_s` / `w64_ob_lu800_s`，≥1 项 ≥1.3× 且
数值回归 0 FAIL ⇒ 该族结案；全部三族做完 ⇒ 本票结案）
