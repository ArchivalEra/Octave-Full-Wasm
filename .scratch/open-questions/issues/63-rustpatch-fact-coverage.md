# 63: **rustpatch 流水线的事实覆盖矩阵**——grill 的每个问题变成闸门，覆盖即规格

**What to build:** 用户裁定：只要 Rust 补丁全流程能被 Einfacht 事实检测**完全覆盖**，grilling 取消——
grill 从"覆盖矩阵"开始。本单 = 把"人会怎么 grill"逐条事实化，缺口 = 新仪器的规格。

**Blocked by:** None

**Status:** ready-for-agent

**Settling:** 不存在 —— 本工单的第一交付物（覆盖矩阵中"新建"两列的两个仪器：
① 数值差分门 + **变异自证** ② quit 延迟上界断言；随附 rustpatch.py 骨架）。

## 覆盖矩阵（grill 问题 → 仪器 → 事实键）

| # | grill 的问题（人本来要问的） | 仪器（Einfacht 档位） | 事实键 | 状态 |
|---|---|---|---|---|
| G1 | 这个符号真的可覆盖吗？（模板内联会吃掉它） | nm T 级导出核验（fail-closed：非 T ⇒ 拒绝）| `rust_patch_<n>_symbol` | **新建**（工单 59 mi_version 同款机制） |
| G2 | Rust 版数值等价吗？（NaN/稳定性/复杂分支） | **数值差分门**：同输入新旧逐位对比；输入域 = 网格+边界+随机+NaN/Inf | `rust_patch_<n>_numerics`（witness 每提交真跑） | **新建** |
| G2b | **差分门自己能抓错吗？**（覆盖度的元事实） | **变异自证**：往 Rust 实现注入变异（>= 改 >）⇒ 差分门必须红 | 差分门的 --selftest | **新建**（F1"会红"延伸到语义等价） |
| G3 | 真的更快吗？ | hotpath 同负载同窗交错 ≥3 轮 | `rust_patch_<n>_speedup`（replay=False） | 已有（hotpath 仪器 + §5.79 方法论） |
| G4 | 补丁还在产品里吗？（发运后漂移） | 产物探针 `octave_rustpatch_<n>_version` + witness + plugin-check 登记 | `rust_patch_<n>_present` | 已有机制（工单 59 五件套同款） |
| G5 | Rust 工具链钉住了吗？ | build-inputs.json 不变式（rustc 通道/目标/wasm32 vs wasm64） | `rust_patch_toolchain_ok` | **新建**（声明式一行） |
| G6 | Ctrl-C 响应性还在吗？（quit 块级化的语义代价） | **延迟上界断言**：注入 quit 请求 → 测到响应的最大元素数 | `rust_patch_<n>_quit_latency` | **新建**（把"可接受吗"变成数字上界） |
| G7 | 哪个热点值得做？ | hotpath 归因（fill 91% / sort 85-89% / …） | `hotpath_top` 等 | 已有 |
| G8 | spike 门槛（≥2×） | 判据先行写进工单 + 结果键 | `rust_patch_<n>_spike_ratio` | 判据已声明（fill spike） |
| G9 | 发运与否 | 产品决定（用户保留） | — | 本来就在人手里 |

**结论：G1–G8 全部可事实化 ⇒ grilling 取消成立**。前提 = 先造 4 件新仪器
（G1 符号核验、G2+G2b 差分门+变异自证、G5 不变式行、G6 延迟断言），全部是
"仪器先于补丁"——第一块 Rust 补丁落地之前，这四个键必须已经能红。

## 实施顺序（grill 的替身）

1. **G5 一行不变式**（最便宜，先落）。
2. **G2+G2b 差分门 + 变异自证**（核心仪器；先在 fill spike 上打样——它同时是
   候选② 的判决）。
3. **G1 符号核验**（nm T 级；fill spike 顺路验证"模板内联是否吃掉符号"）。
4. **G6 延迟断言**（elem_xpow 候选④ 的前置）。
5. 全绿后：rustpatch.py 骨架（候选①）把这些键的**生产**收编成一条深缝。

## 硬边界

- wasm32 先行（rustc 1.98 只有 wasm32-unknown-emscripten；wasm64 tier-3）⇒
  第一批补丁打 base/threads 车道，w64 线等 nightly/上游。
- 变异自证至少 3 类：比较符变异 / 边界变异（n-1）/ 抛错路径变异——
  对应"该红的必须红"三档。
