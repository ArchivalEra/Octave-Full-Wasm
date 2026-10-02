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

## 进度（2026-10-02 夜间批：侦察完成，基建就位，首战未竟 —— 本票保持 open）

**侦察结论（改变打法的三条）**：
1. **`ARCH_WASM` 从未被任何 Makefile 定义**（`grep Makefile.system` 零命中）⇒ intrin.h 的
   wasm 守卫是上游死代码 ⇒ 这就是 level-1 v128=0 的**真根因**（ticket 01 的"内核标量"证据成立，
   但机制 = 宏没点亮，不是 wasm 内核缺失）。
2. `intrin_wasm.h` 完整存在（30 个 v_ 函数、V_SIMD_F64=1、v_muladd_f64…）—— 后端现成。
3. **`-DARCH_WASM` 通路不可行**：会泄漏进 getarch 的宿主编译 ⇒ ARCH 探测变空 ⇒
   `Makefile.$(ARCH)` 直接炸（实测两轮）。⇒ 正解 = **src 阶段后改 WORKDIR 的 intrin.h 守卫**
   （内核编译行本就有 -msimd128；getarch 不受影响）—— 已实现为
   `build-e2-lane.sh` 的 `E2_ARCH_WASM_INTRIN=1` 旋钮（含 sum.c 守卫）。

**首战未竟（如实）**：旋钮生效（WORKDIR intrin.h 确认替换）+ 预处理确认分支激活
（dot.c 展开 46 个 wasm_f64x2）**但产物与未点亮版逐字节相同**（归档 sha 均为 6c483538…）——
疑似 make/ccache 层的对象重放。**下一会话第一步：`CCACHE_DISABLE=1`（或 ccache -C）干净重建**，
若仍逐字节相同，则 make 层取证（make -d 追踪 dot.c 的重编判据）。
（另：`.o` 成员上 `llvm-objdump | grep -c v128` **不是有效量法** —— 已知 SIMD 的 dgemm.o 也量出 0；
有效量法 = relink 后对完整 octave.wasm 计数，即台账 `w64_v128` 的口径。）

**CCACHE_DISABLE=1 干净重建（build4）：仍逐字节相同（6c483538…）⇒ ccache 论死**。
四轮构建 + 预处理证据互相矛盾（守卫确认替换 / -E 展开 46 个 f64x2 / 产物不变）——
剩余嫌疑：① dot.c 的 `#include "../simd/intrin.h"` 被**别的 intrin.h 遮蔽**（编译 cwd 与 -I 顺序）；
② dot.c 的 SIMD 分支内有**更内层的守卫**未过；③ emcc 对 builtin 的吸收。
下一会话判别法：在 SIMD 分支内加 `#warning PROBE-SIMD-BRANCH-ACTIVE`，用 make.log 原编译行
（改 `-c dot.c` → `-c kernel/generic/dot.c`，**从 TOP 目录跑** —— VPATH 解析源文件；
脚本用 python3 写成 /tmp/probe.sh 避开 sh -c 引号地狱，本夜两轮探针都死在这一步，技法已明）。
一次编译即知分支是否真编入：warning 出现 ⇒ 分支在编译、查 codegen；不出现 ⇒ 查 include 遮蔽。

**基建清单（本夜已落）**：`E2_CC_EXTRA` / `E2_NUM_THREADS` / `E2_ARCH_WASM_INTRIN` 三旋钮 +
bench-lanes 两段式就绪（工单 40）+ NT=8 基线数字（matmul 0.004/1000 0.025/lu 0.014）。
