# 63: **rustpatch 流水线的事实覆盖矩阵**——grill 的每个问题变成闸门，覆盖即规格

**What to build:** 用户裁定：只要 Rust 补丁全流程能被 Einfacht 事实检测**完全覆盖**，grilling 取消——
grill 从"覆盖矩阵"开始。本单 = 把"人会怎么 grill"逐条事实化，缺口 = 新仪器的规格。

**Blocked by:** None

**Status:** ready-for-agent

**Settling:** `sh test/fixtures/rustfill-spike/run-spike.sh`（G2 差分门 + G2b 变异自证）—— rc=0 ⇒ 仪器合格且当轮候选判决成立；rc≠0 ⇒ 门没红，先修门。
已建成：32 输入域逐位一致 + 31/31 变异被抓）——rc=0 ⇒ 仪器合格且当轮候选判决成立；
G6 延迟断言仍缺（候选④前置）。

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


## 进展（2026-10-04）

- **G2 + G2b 建成并自证合格**：`test/fixtures/rustfill-spike/`（fill.rs no_std Rust +
  fill.cpp 基线 + driver.mjs 差分/变异/计时 + run-spike.sh 编排）。
  差分门 = 32 输入域（网格+边界）逐位对比；变异自证 = **源码级边界变异**（最后元素不写）
  31/31 被抓（n=0 不可观测，如实不计——第一版断言把 n=0 算漏检，是断言的错不是门的错，
  已修）。顺带修了 driver 自身的两个仪器 bug：JS 数组当指针传、计时段循环内泄漏
  _malloc 撞内存顶。
- **候选②（idx fill）实测否决**：2^24 填充 base(C++) 9.0–9.5ms vs cand(Rust) 9.8–10.2ms，
  比值 1.07–1.09 两轮 ⇒ 远不到 2× 门槛。**机制：该热点是内存带宽绑定**
  （134MB/9.0ms ≈ 14GB/s ≈ 本机带宽顶）——91% 的"热点"其实是"负载本身就是填充"，
  换任何实现语言都拿不到。`rust_fill_spike_ratio` 台账键（116 条）。
- **G1 教训顺带入账**：本 spike 用新符号（octave_fill_f64）而非覆盖旧符号——
  G1 的"模板内联吃符号"问题留给候选③（octave_sort）验证。
- 剩余仪器：G6 延迟断言（候选④前置）；G5 rust 不变式行（rustpatch.py 落地时收编）。
- 下一个真候选 = **③ octave_sort<double>**（树补丁改调用点方案）。

## 候选③ spike 判决（2026-10-04）：**ADOPT——内核 4× 加速**

- **G1 落定**：Array-d.cc:47 `#include "oct-sort.cc"` ⇒ 模板定义进消费 TU、零导出符号
  ⇒ 符号覆盖死路，**树补丁改调用点是唯一路径**（Array-base.cc 宏体 `lsort.sort (v, kl)`）。
- **G2 语义镜像**：`test/fixtures/rustsort-spike/`——spike 镜像宏 stride==1 分支
  （NaN 分区 + 内核 + reverse/rotate），base=真 octave_sort<double>（timsort），
  cand=Rust stable sort（driftsort 谱系）。**22 域逐位一致**
  （随机×5种子 × n∈{1,17,1e3,1e5} × asc/desc + 20k 重复值 + desc 顺序断言）。
- **G2b 变异自证**：恒等排序变异 4/4 被抓（恒等排序在未排序输入上必被差分抓住）。
- **G8 计时**（2M 随机 doubles，交错 3 轮 × 重随机化）：
  timsort **352ms** vs Rust **87ms** = **比值 0.249（4× 加速）**，两跑一致（0.247/0.249）。
  门槛 ≥1.15× ⇒ **ADOPT**。
- **benchmark 方法学坑（新）**：排完序的数组再排 = timsort O(n) 快路径（430→4.7ms）——
  min-of-3 采样若不在每次计时前重随机化，量到的是快路径假象。与 ±30% 方差同族的
  第二条基准纪律：**排序基准每次计时前必须重随机化**。
- **下一步（树补丁打样）**：Array-base.cc 宏体 `lsort.sort (v, kl)` 处加
  `if constexpr (std::is_same_v<T,double>)` 分派到 `octave_rust_sort_f64`（Rust crate
  进车道构建），增量 relink → 实验站全量 → hotpath sort 负载 A/B。


## 候选③ w64 落地判决（2026-10-05）：**ADOPT——w64 端到端 2.0×**

- **路线变更（用户裁定）**：IllegalPerformance = wasm64-NEXT 线的延伸，8G 大堆性能
  必须用上 ⇒ 靶子从 wasm32 车道改为 **w64 直上**。外部评审（需求书
  /mnt/hdd/octave-wasm-build/rust-wasm64-requirements.md）判定：rustc 无
  wasm64-emscripten target ⇒ 走 **nightly build-std（core+alloc）+
  wasm64-unknown-unknown + 显式 +atomics,+bulk-memory,+mutable-globals**。
- **评审实验 E0–E5 全绿**：E1 cargo build-std 11s 过（rustc 直编不认 -Z build-std）；
  E2 库体检（未定义恰好 = 宿主 libc 系 abort/malloc/free/realloc/posix_memalign/mem*，
  无 unwind/probestack；胶水 = panic_handler→abort + global_allocator 转发）；
  E3 混链 shared-memory 成功且端到端真跑；E4 **弱符号判空可靠（ghost=0）** ⇒
  缝保持链接期旋钮；E5 严格链接（ERROR_ON_UNDEFINED_SYMBOLS=1）+ map 证明
  "链接绿=符号在"。
- **w64 候选**：`rebuild w64` + RUST_SORT=1 + e2-w64 + mimalloc（全现役口径）
  = verdict=ok，mismatch 1 条（zdotu_，容忍）；同树旋钮关对照 verdict=ok。
- **验收**：全量 PROBES=1（COI/w64 档）= 1357 PASS / 1 FAIL——唯一红是装配脚本
  漏拷身份证（probe-artifact-sha ③a 档内自洽），修后双站 4/0 ⇒ 等效 1358/0。
  **端到端逐位抽查**（固定 twister 种子，2 万元素 asc/desc，%.17g 回读）：
  候选/对照 sha 逐位一致 PASS——IEEE 红线在产物级闭合。
- **A/B（`w64_rustsort_ab_*` 台账键）**：asc 中位 185 vs 377ms = **0.491（2.0×）**；
  desc 0.487（2.1×）；3 轮交错、冷启动 = 重随机化（instruments.json 排序纪律）。
  与内核 spike 4× 的差 = rand + 解释器开销（候选绝对值与 87ms 内核 + rand 预测吻合）。
- **站点归属（用户指令）**：本线专属站 = site-illegalperf(8868 候选)/
  -baseline(8869 对照)，装配入口 `build/113/site-illegalperf.sh`
  （谱系标记 SITE-ILLEGALPERF.json；只动 w64 槽）。8761 一字未动。
- **正典源** = build/113/rust/src/lib.rs（no_std + 胶水；wasm32 rustc 直编 /
  wasm64 build-std 双路同源；G2 门消费同一份）。工具链钉版 = E7 后翻
  rust-toolchain.toml。
- 下一步：发运（模式表默认值翻 1 + lane_expect + promote = **产品决定**）；
  候选④ elem_xpow 前置 G6 延迟断言；可替换件空间审计（libm 被 IEEE 逐位红线
  + 无 SLEEF wasm 后端实质封口；fill 带宽绑定）。


## 候选④（xpow 驱动层）：**排除** + G6 仪器建成（2026-10-05 收口）

- G6 覆盖矩阵里标「新建」的两件（**G6 延迟断言**、**候选④裁决**）本批落地：
  仪器 = `test/fixtures/xpow-spike/`（复跑 `bash test/fixtures/xpow-spike/run-spike.sh`）。
- **G6 仪器**：`xpow_cand_batched(..., quit_flag, every)` 每 `every` 元素查一次 quit，
  返回看到标志时的索引 = 延迟上界；实测 every∈{1,64,256,1024,4096} → E-1（契约成立）。
  今后任何块级化内核 == 先过 G6 == 才谈 ADOPT。
- **候选④判决：排除**。端到端 cand/base = 0.951/0.988/1.002（噪声内）；**driver_only
  探针 = 2.1%**（`xpow_driver_spike_pct`）—— 驱动层（octave_quit + 逐元素索引）的绝对
  天花板仅 ~2% ≪ 1.15× 门槛。**§5.91 的 39.5% 是 profiler 把内联 libm 记在 C++ 帧上的
  归因假象**，非可回收成本。
- ⇒ **IllegalPerformance 无已知上升空间**（复跑件：`w64-logs/xpow-spike.log`）。
