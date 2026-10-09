# 52: **relaxed-simd FMA 内核**：+13% / +10%，已发运（"极限太远"后的最后一颗螺丝）

**What to build:** 用户判断"大矩阵离极限太远"后，盘点全部已测路径（票 39 手写内核 / 44 线程 / 49
Rust / 06 链接旗标 / 51 PGO）均负。唯一未试的正规军杠杆 = **relaxed-simd**：SIMD128 基线
**没有 f64 FMA**，而 relaxed-simd 的 `f64x2.relaxed_madd` 在 x86 上映射硬件 `vfmadd`。
内核单线程 11.9 GFLOPS ≈ SIMD128 理论峰(~15.2) 的 78%——FMA 是剩下那 22% 的钥匙。

**Blocked by:** None

**Status:** resolved （2026-10-03：FMA 内核落地 + 实测 +13%/+10% + 数值全绿 + 已发运 8761）

**Settling:** `E2_RELAXED_FMA=1 E2_CC_EXTRA="-mrelaxed-simd" bash build-e2-lane.sh src patch —— rc=0 ⇒ 结算件成立、结论见该单 Answer；rc≠0 ⇒ 先修结算件（门没红＝没结案）。
build pack` + relink；字节级判据 `python3 -c "print(open('octave.wasm','rb').read()
.count(bytes([0xFD,0x87,0x02])))"`（`fd 87 02` = f64x2.relaxed_madd）应 > 40（现役 1）；
性能：交错 3 轮 `bench-lanes` matmul1000 应 < 0.026。

## Answer

（2026-10-03 结案。）

**① 机制（三件，缺一不可）**：
- **补丁** `build/113/patch-openblas-relaxed-fma.py`（+进 build-e2-lane.sh 的 PATCHES，
  `E2_RELAXED_FMA=1` 门控）：把内核内循环 `wasm_f64x2_add(acc, wasm_f64x2_mul(a,b))` 改写成
  `wasm_f64x2_relaxed_madd(a, b, acc)`。自证 6/0（含幂等与 fail-closed）。
- **编译前提** `E2_CC_EXTRA="-mrelaxed-simd"`（内在函数的 target feature）。
- **实测教训**：LLVM **不会**把显式 intrinsic 的 add(mul()) 收缩成 relaxed_madd
  （ffp-contract 只作用于源级表达式）——带 `-mrelaxed-simd` 但**不改源码**时产物里
  relaxed_madd=**0**。必须改源码。

**② 性能（交错 3 轮，同窗，w64）**：

| 用例 | FMA | 现役 | 提升 |
|---|---|---|---|
| matmul 500² | 0.003–0.005 | 0.004–0.005 | 持平 |
| **matmul 1000²** | **0.024**（三轮全同） | 0.027–0.028 | **−13%** |
| **lu 1500** | **0.065–0.069** | 0.071–0.080 | **−10%** |

**③ 可交付性（无需新 lane 回退轴）**：`probe-relaxed-simd.mjs` 实测 **Chromium 154 /
Firefox 155 / WebKit 全支持 relaxed-simd 与 memory64**。关键推论：**relaxed-simd 先于 memory64
进浏览器**（relaxed-simd wasm 特性 M92+/2021 起，memory64 晚得多）⇒ 任何支持 memory64 的引擎
必然支持 relaxed-simd ⇒ **w64 档已被 memory64 门控，无需加新回退轴**。
⚠ **语义边界**：relaxed_madd 的乘加舍入是实现定义（x86 = 融合 FMA，比 mul+add 少一次中间舍入）
——BLAS 语境可接受（x86 原生 OpenBLAS 全用 FMA）。**数值验收**：accept 四套 **79/0** +
dldfcn **71/0** ⇒ 无回归。

**④ 发运**：`w64` = `5b5bb981…`（备份 `w64-artifacts-pre-fma-backup-20261003/`）；promote 三档未动、
boot 1.3s、四格 33/0、SHA 三层；全量 `PROBES=1` 见 HANDOFF。

**⑤ 仪器教训（→ Einfacht #6）**：确认"产物里有没有 relaxed_madd"时，`llvm-objdump -d | grep
relaxed_madd` **恒为 0**（该 objdump 把这条指令打成 `<unknown>`）——我据此两次误判"FMA 没进产物"，
白跑一轮构建。正解 = 字节级计数（`fd 87 02`）或先校准仪器。**值会腐烂，量它的工具也会。**
