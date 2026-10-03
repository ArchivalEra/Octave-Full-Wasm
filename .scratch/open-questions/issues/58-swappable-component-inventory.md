# 58: **可替换部件清单**（wasm64-NEXT 工单 58）—— 分配器之后，部件空间基本到边

**What to build:** 用户判断："等找到更多可替换部件再一起注册 + 跑全量"。本单 = 用工单 54 的
仪器**再探**，系统盘点 **Octave 链的库级部件**哪些是热点、哪些可换（对工单 57 的"下一个
mimalloc"的追问）。

**Blocked by:** None

**Status:** resolved（2026-10-03：盘点完 15 个库组件轴；**下一个部件 = libm**（重活）；
其余热点是 **Octave 自身源码**，不是部件）

**Settling:** `python3 build/113/hotpath-scan-libs.py`（库组件扫描批，15 轴）；
原始数据 `hotpath-logs/libs-<ts>/scan.json`。

## Answer（盘点结果）

**① 已采纳的部件**：**分配器**（`-sMALLOC=mimalloc`，工单 57，−27%）。

**② 评估过、但**不是**热点的库部件**（它们底下很快，Octave 包装层才慢）：

| 部件 | 结论（实测） |
|---|---|
| **fftw** | fft 热点是 Octave 的 `rec_permute_helper::blk_trans`（19%），**不是 fftw 内核** |
| **qhull** | convhulln 未进 top（我的 setup 用了 `sin(大数组)` **污染了归因**——见边界） |
| **arpack** | eigs 热点是底下 **BLAS**（`dgemv_t/n` 53%）——arpack 本身不是瓶颈 |
| **suitesparse / 稀疏** | 稀疏热点是 **Octave 自己的** `operator*(SparseMatrix…)` 31% + `octave_sort` 24% |
| glpk / sundials / hdf5 / zlib / expat / freetype / fontconfig / gl2ps | 未在任何负载进 top（未单独压测，如实） |

**③ 下一个真部件候选 = `libm`（超越函数）**——**但重**：
元素级数学（`sin`/`cos`/`exp`/`log`/`pow`/`x.^0.7`）的热点是 **musl libm 的标量函数**：
`exp_inline` 23.8% / `log_inline` 10.2% / `sin`+`cos`+`__rem_pio2`（sin-cos 里 51%）/ `pow` 14.9%。
**wasm SIMD128 没有向量超越函数** ⇒ 换它 = **自带一个 SIMD 批量 libm**（SLEEF 风格）**并**让
Octave 的元素循环批量调用它——是**集成项目**，不是链接旗标。（且 `-msimd128` 已在，LLVM
不会把 libm 调用向量化。）**价值**：所有元素级数学负载受益（教学里很常见）；**成本**：高。

**④ 其余热点全是 Octave 自身源码**（**不是部件**，换不了）：
`octave_sort`（merge sort，`sort` 的 85%）、`rec_permute_helper`（fft 包装）、`do_rc_map`
（实数/复数映射）、`idx_vector::fill`（索引赋值 91%）、`elem_xpow`、`convert_index`。
⇒ 要动它们 = **改 Octave 源码**，与"换部件"是两类工作。

**⑤ 诚实结论**：**部件空间基本到边**——分配器是最后一块好摘的果子；再往下要么是 **libm 集成
项目**（重），要么是 **Octave 源码级优化**（另一类）。这也**否证**了"再扫一批就能找到下一个
mimalloc"的期望（如实说，不粉饰）。

### 边界（如实）

- `qhull-conv` 与 `fft` 的 setup 用了 `sin(大数组)`/`rand`，**污染了归因**（工单 58 修了 `rand`
  但 `sin` 仍在 qhull 的 setup 里）⇒ qhull 那行**不可用**，需重测（未做）。
- 未单独压测 glpk/hdf5/sundials/zlib 等（负载没起热点，但不等于"不慢"）。
- 采样是 PC 级 self-time；`ArrayRep`/`polymorphic_allocator`（std::pmr）跨负载出现 —— 那是
  **分配层**，已被工单 57 的分配器杠杆覆盖。
