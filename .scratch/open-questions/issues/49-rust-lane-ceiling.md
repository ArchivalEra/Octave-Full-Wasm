# 49: **Rust 车道天花板测试**：faer-wasm32 单线程 vs OpenBLAS-wasm —— 负判决，车道结案

**What to build:** 用户对性能不满意（结算表：纯解释器 0.67×、大矩阵 0.38×），提议"接口不变、
引入 Rust 或 Zed 优化（哪怕背离原生树）"。逐条判定后（Zed/GPUI 编不进 wasm ⇒ 劝退；纯解释器
差距只能靠重写解释器 ⇒ 反对），唯一可行 Rust 路 = **换 BLAS 层为 faer**。按本仓"先测量再定"
纪律：不集成、不动接口，先跑**纯微基准**拿天花板数字——数字不过关就不立项。

**Blocked by:** None

**Status:** resolved（2026-10-03：**faer 车道负判决** —— 单线程内核输 1.6×，理想 8 线程缩放
后仍全面落后现役 OpenBLAS-wasm64；Rust 车道结案）

**Settling:** crate 在仓 `build/113/faer-bench/`（Cargo.toml + src/lib.rs，faer 0.22.6，纯
cdylib 无 bindgen）。复现三步：
```sh
# ① 装 rust（一次性，仓库外）：RUSTUP_HOME=/mnt/hdd/crossbuild-tools/rust/rustup \
#      CARGO_HOME=/mnt/hdd/crossbuild-tools/rust/cargo sh /tmp/rustup-init.sh -y
#    + rustup target add wasm32-unknown-unknown
# ② 编译：cd build/113/faer-bench && cargo build --release --target wasm32-unknown-unknown
# ③ 起 8866（faer-bench/page 里有现成 index.html + wasm 需重拷）跑
#    test/browser/run.sh /tmp/run-faer-bench.mjs —— 或看本单 Answer 里已归档的数字。
```
⇒ faer500 < 21 ms（OpenBLAS-1t 参照）且 faer1000/8 < 25 ms ⇒ 车道复活；
≥ 上两者（实测 34.0 / 273.1）⇒ 维持负判决。

## Answer

（2026-10-03 结案。同机同日，best-of-iters，wasm32 单线程。）

| n×n | faer-1t（wasm32） | naive-1t（wasm32 下界） | **OpenBLAS-8t（wasm64 现役）** | OpenBLAS-1t（wasm32，e2-single） |
|---|---|---|---|---|
| 500² | **34.0 ms** | 79.4 ms | **3.0–4.0 ms** | 21 ms |
| 1000² | **273.1 ms** | 642.4 ms | **25–28 ms** | — |
| 2000² | **2107.9 ms** | （太慢未跑） | **199–203 ms** | — |

（faer 侧 GFLOPS：500²≈7.4、1000²≈7.3——faer 自己的 blocking 是有效的，比 naive 快 2.3×；
**OpenBLAS-1t ≈ 11.9 GFLOPS 仍领先 1.6×**，且那还是含 Octave 派发开销的口径。）

**判决（三层）**：
1. **内核质量**：同车道同条件（wasm32 + 单线程）下 faer 输 OpenBLAS **1.6×**——blocked SIMD
   内核不是 faer 的短板，是 wasm SIMD128 上 OpenBLAS 已经很强（这也再次坐实票 39：手写内核
   打不过 OpenBLAS 的自动向量化产物）。
2. **理想缩放**：即使 rayon 8 线程**完美线性**（实际不可能），faer-8t ≈ 4.3 / 34 / 264 ms
   ——对现役 OpenBLAS-8t 的 3.0–4.0 / 25–28 / 199–203 **仍然全面落后**。
3. **车道终局**：faer-wasm64 平价追不追都到不了现役水平 ⇒ **Rust 换 BLAS 车道负判决结案**；
   "背离原生树"的剩余选项只剩"重写解释器"（= 放弃 43 套验收的正确性资产，票 46 判过反对）。

**工程过程中的三个坑（都记进构建脚本/工单）**：
- faer→rand→getrandom 0.2.x 在 wasm32-unknown-unknown 需要 `features=["js"]`；
- `std::time::Instant` 在 wasm32-unknown-unknown **未实现**（panic）⇒ 显式导入
  `env.now_ms`（JS 侧 `performance.now()`）；
- wasm 模块带 import 时 `new WebAssembly.Instance(mod, imports)` 要按
  `WebAssembly.Module.imports` 的 kind 逐个供（function/global/memory/table）。

**终局**：性能线在"接口不变"前提下**所有**已知优化路径均已实测清空——可配置旋钮（票 44/05/06）、
手写内核（票 39）、线程轴（票 44）、Rust BLAS（本单）、DOM sink（票 48，−99% 插入）。
剩下的差距 = 平台税（wasm SIMD128 vs AVX-512、解释器 AOT vs JIT），归档。
