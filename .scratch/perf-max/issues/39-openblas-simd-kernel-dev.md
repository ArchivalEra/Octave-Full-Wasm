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
**分支探针已跑（本夜第三轮，判别完成）**：`#warning` 出现 + 探针对象 **12 个 v128**
（`/tmp/ddot_probe.o`，upstream objdump）⇒ **源码 + 旗标 + 守卫三要素齐备，SIMD codegen 真实发生**。
真正的墙 = **ar 层**：make 编译出的内核 ddot.o 编译后即从树上消失（只剩 interface/ddot.o，
v128=0），且归档逐字节同 nt8 ⇒ 内核对象在 ar 打包/清理环节被同名 interface 成员覆盖或删除。
下会话两条路（都不难）：
① `make -n` 全量追踪 ar 的输入清单，确认内核对象的打包名（OpenBLAS 可能改成员名）；
② 绕过归档：把 SIMD 内核对象**直接塞进链接**（EXTRA_LDFLAGS 加对象路径，配
   --allow-multiple-definition 的顺序语义，或改 E2 pack 阶段把 SIMD 对象挂为独立成员）。
（本夜探针技法已验证：python3 写 /tmp/probe.sh 避 sh -c 引号地狱 + TOP cwd + 全源路径 +
upstream objdump 数 v128。）

**基建清单（本夜已落）**：`E2_CC_EXTRA` / `E2_NUM_THREADS` / `E2_ARCH_WASM_INTRIN` 三旋钮 +
bench-lanes 两段式就绪（工单 40）+ NT=8 基线数字（matmul 0.004/1000 0.025/lu 0.014）。

## 进度补记（2026-10-02 晨：L1 dot 族判决 —— 机制成功、判据不可达、优先级重塑）

**机制全线打通**（四轮构建的矛盾最终定位）：构建读的是 **kernel/wasm/KERNEL 默认表**
（getarch 的 ARCH=wasm 决定 include 路径，KERNEL.WASM128_GENERIC 不被读）⇒
`E2_ARCH_WASM_INTRIN` 旋钮补上 默认表 DDOTKERNEL→generic/dot.c + intrin.h 守卫改写 +
全局 -msimd128（E2_CC_EXTRA）⇒ **产物 v128 6613 vs 基线 6602（+11，dot 内核真点亮）**、
编译行源路径确认 generic/dot.c、relink verdict=ok、新 sha `f4e92628…`。

**bench 判决（A/B ×2，`w64-logs/l1c-ab-bench3.log`）**：dot 1e7 —— r1 1.57× / r2 1.00×，
**不可复现，≥1.3× 判据不达成**。机理：1e7 向量的 dot = **内存带宽瓶颈**（SIMD 对
带宽受限操作帮助有限），且 Octave 的 dot() 未必路由到 BLAS ddot。其余 case 全持平
（GEMM 未动 ✓）。

**重塑**：L1（memory-bound 的 level-1）**不是值得手写内核的方向** —— 机制通了但天花板
是内存墙。**真杠杆 = L2（GEMM 微内核，compute-bound，2–4×【推断】仍在桌上）**；
本票保持 open，下一族直接打 L2（gemmkernel_wasm128.c 的 tile 加宽）。
NT=8 的 2.0–2.2× 已是本图最大的已落地收益（工单 40）。

## L2 第一刀判别（2026-10-02 深夜：DGEMMKERNEL→wasm128 = 空操作，L2 重构定性）

**发现**：构建实际读的默认表 `kernel/wasm/KERNEL` 里 **DGEMMKERNEL = generic/gemmkernel_2x2.c**
（标量源 + clang -O3 -msimd128 **自动向量化**）—— 手写的 `gemmkernel_wasm128.c` 从未被接上。
把 DGEMMKERNEL 改指 wasm128 后重建：**归档与改前逐字节相同**（2935c05d…，L1c 同）⇒
clang 对 2×2 简单循环的自动向量化**已经生成了与手写 intrinsics 相同的 SIMD 序列**。

**定性翻转**：L2 的增益**不可能来自"手写 SIMD"**（编译器已做）—— 只能来自**自动向量化
做不到的结构性重构**：寄存器分块加宽（2×2 → 4×2/8×4 tile，更多 f64x2 累加器、更低的
load/shuffle 比）。前提工作 = **读懂 pack 布局**（`kernel/generic/gemm_ncopy_2.c` 的
A'/B' 面板排布 —— 微内核里的 vb01/vb23 双加载与 shuffle 模式必须对照 packer 才能重构），
配套 = KERNEL 表的 DGEMM_UNROLL_M/N + ncopy/tcopy 换 _4 变体（`gemm_ncopy_4.c`/
`gemm_tcopy_4.c` 已在树上）+ 微内核 m 循环 4 宽化（8 个 f64x2 累加器，注意 wasm 寄存器
压力 —— 16 个活 v128 可能 spill，4×2=8+4+2=14 个活值是边界）。

**下一会话路径**：读 gemm_ncopy_2.c 定布局 → 写 4×2 微内核 + 换 UNROLL/ncopy/tcopy →
重建（旋钮全在）→ bench matmul（L2 正主）→ 回归四套 → ≥1.3× 则 L2 结案。

## L2 4×2 内核首战（2026-10-02 深夜：内核写完、可跑小用例、matmul 陷阱未解 —— 本票 open）

**已落地**：`build/113/gemmkernel_wasm128_4x2.c` = 完整微内核（4×2 SIMD 块 + 4×1 块 +
2×2/1×1 余量路径 + 余量感知边界 bm-i4）；`E2_ARCH_WASM_INTRIN` 旋钮扩展（4×2 文件覆盖 +
UNROLL_M=4/N=2 + ncopy/tcopy 换 _4 变体）；L2b 构建 relink `verdict=ok`
（sha `d4fbc6e6…`）、boot 1.5s、dot 1e7 0.007s、**回归 oct 8/0 libs 17/0 ode15 29/0**。

**未解**：bench 的 matmul 500 **第二/三轮之间标签页崩溃**（`memory access out of bounds`
复现于 eval 序列）—— 单次 eval_string matmul rc=0、ncopy_4 面板布局已核实与内核假设一致
（每 k 4 行连续）、回归套件小矩阵全绿 ⇒ 陷阱在**面板边界/特定形状**的组合里。

**两条收口路径（下一会话）**：
① **tcopy_4 嫌疑**：DGEMMOTCOPY 换的 tcopy_4 是为 UNROLL_N=4 设计的 —— UNROLL_N=2 下
   它的 2 列块布局可能与微内核的 vb 4-double 假设不符（B 面板末端越界）。判别 = 重建时
   DGEMMOTCOPY 回退 tcopy_2（保留 ncopy_4/UNROLL_M=4/4×2 内核）看 matmul 是否还崩；
② **陷阱定位**：eval 序列 + `-fsanitize` 级别的定位（wasm 无 ASAN ⇒ 用 EMMA/自建
   canary 或逐面板二分）。
另：4×1 块的 `vb = load(ptrbb)` 读 4 double 但 1 列面板每 k-pair 只有 2 double
⇒ **确认的越界读**（n 奇数边缘触发）—— 修法 = load64_zero + load64_lane 拼 2 列。

## L2c 补记（2026-10-02 深夜第二场：4×1 修复后 bench 仍挂 —— 机器二次重启，收兵）

- 4×1 块的越界读已修（load64_zero + load64_lane），relink `verdict=ok`
  （sha `a4916303…`）、boot 1.2s —— 但 **bench 仍零输出超时**（两段式就绪后
  依旧挂在 feval/首 case，`w64-logs/l2b-bench-diag.log`：dot 1e7 能跑 0.007s、
  matmul 500 第二轮把标签页打崩 = `memory access out of bounds` 复现）。
- 机器两次重启（用户："好像给我电脑干崩溃了"）—— 工作负载密度过高的实证。
  **收兵**：未竟状态全部记档，下一会话用需求书（`.scratch/perf-max/需求书-claude-gemm-review.md`，
  已写好待发）走外部复核 + 稳定环境下二分。
- 下一会话入口：① 需求书发 Claude；② matmul 陷阱二分（tcopy_4 回退 / 4×2 块逐段注释）；
  ③ 8761 已恢复（现役 -O3+8GB 完好）。
