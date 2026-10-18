# NOTES-pkg-precompile · 包预编译批（三线口径）

> 批次目标（用户点令 2026-10-17）：「各种包的预编译……原生编译尽量做到**极限性能极限体积**，
> **wasm32 和 64 分版本**」。三线模型纠偏后（AGENTS.md）：分档 = 用户可达性 + 许可线，
> 与性能无关 ⇒ 产物只编**两份**：
>
> | 份 | 旗标 | 服务哪条线 |
> |---|---|---|
> | **wasm32** | 无 `-pthread`、无 MEMORY64 | wasm32 线（无 COI 全兼容） |
> | **wasm64** | `-pthread -sMEMORY64=1 -fno-threadsafe-statics` | master / IP 线 |
>
> 现役站点四格（base/threads/w64/w64-base）中 base 用 wasm32 份；threads 是
> wasm32+atomics（历史形态，见 §3）；w64/w64-base 用 wasm64 份。

## §1 为什么要重编（ABI 赌博的账）

现役 `site/assets/octdir{,-threads,-w64}/` 的 **28 个 `.oct`**（control 9 / geometry 1 /
miscellaneous 2 / optim 5 / statistics 7 / struct 4）是 **Octave 7.2 时代**编的
（容器 `build-pkg-oct.sh` 头注原文：「site113 里的 27 个 .oct 是 7.2 编的……跨大版本
用旧 .oct 是 ABI 赌博」）。11.3.0 宿主上它们**装载能过、调用大多能跑**
（`accept-113-pkgoct` 27/0），但那是运气不是判据——本仓已有
「`__ode15__`/gzip 两个 trap 都是装载能过、调用才炸」的先例（HISTORY §10.6）。

## §2 旋钮 A/B 量化（optim 包 5 模块 × 2 档 × 5 配方，2026-10-17 实测）

**方法**：同一源码（`forge/optim-1.6.3`），容器内按各档安装头（11.3.0）编
O2 / O3 / O2+lto / O3+lto 四配方；另对 O2 基线做 `wasm-opt -O3` 后处理对照
（flags：`--enable-exception-handling [--enable-threads --enable-memory64]
--enable-bulk-memory[-opt]`——不带 feature flags 会 validator 拒收，实测两轮）。
性能 = 真浏览器（8768 w64 档 / 8769 `?lane=base`）`bfgsmin`/`numgradient` 真跑
（9–11 次取中位）；体积 = `.oct` 字节 + gzip。复跑件：
`/mnt/hdd/octave-wasm-build/ab-optim/`（产物）+ harness `_ab-bench-final.mjs` /
`_ab-bench-w32.mjs`（计时）。

| 配方 | w64 中位 | w32 中位 | 体积 vs O2 | 判决 |
|---|---|---|---|---|
| **O2（基线）** | 0.062 s | 0.136 s | — | ✅ **全量配方** |
| O3 | 0.060 s（-3%，噪声内） | 0.133 s（-2%，噪声内） | **+11%** | ❌ 体积代价无性能回报 |
| O2+lto | **dlopen 炸** | **dlopen 炸** | -0.2% | ❌ **§5.78 判例当场重现** |
| O3+lto | 炸 | 炸 | +13% | ❌ 同上 |
| O2 + wasm-opt -O3 | 0.061 s | 0.134 s | -0.6% | ❌ 无收益不抵后处理步 |

**LTO 的失败形态**（两档同）：装载后首调
`TypeError: Cannot read properties of undefined (reading 'value')`——与 §5.78 的
`table index is out of bounds` 同族（LTO whole-program 剥掉**只有 dlopen 才用到**的
支撑符号）。**结构性冲突，非旋钮可调** ⇒ LTO 对 `.oct` side module 永久出局。
（注意与主模块侧的票 06 结论一致：「边际不采纳」。）

**"极限性能/体积"的诚实结论**：在 .oct side module 这一层，**旋钮空间实测为零收益**
——O2 已是最优平衡点。真正的性能杠杆在主模块/BLAS 层（早已做过：relaxed-simd FMA、
OpenBLAS-e2、rust-sort——见台账），不在包编译层。

## §3 架构界实测（三线模型的浏览器侧再验证）

- 8769 无 COI + 浏览器支持 memory64 ⇒ `lane.js` 自动选 **w64-base**（wasm64 宿主）⇒
  wasm32 `.oct` 被 emscripten 加载器**响亮拒绝**：`incorrect architecture (wasm32 vs
  wasm64)`——架构界（楚河汉界）在预编译件上工作正常，与 R10/install() 判据同一机制。
- 要测 wasm32 份必须 `?lane=base` 显式选档（四格站 base 档 = wasm32 宿主）。

## §4 已知边界（如实记，不是本批引入）

`__bfgsmin` **直调**（`__bfgsmin("f", {…})`，cell 传参）在 11.3.0 头编出的模块上
`RuntimeError: function signature mismatch`；**`.m` 包装 `bfgsmin(...)` 完全正常**
（accept-113-pkgoct 的判据就是它，27/0）。7.2 编的老模块同路径也炸（同页实测）⇒
这是 **optim 源码对 octave_value_list 的用法与 11.3.0 调用约定的既有边界**，
不是编译配方问题。结案实验：`.m` 包装路径全绿即视为可用；直调面**不作承诺**。

## §5 全量重编与发运

配方 = 现役 `build-pkg-oct.sh`（-O2、11.3.0 头、写死模块表）× 两档：
w32（`/src/work/octave-install` + 无旗标影子）、w64（`/src/work/octave-install-w64`
+ `-pthread -sMEMORY64=1 -fno-threadsafe-statics` 影子，`build-w64-lane.sh` 同款）。
threads 档复用 w32 产物 + atomics 影子重编（`build-oct-lane.sh` 既有线）。
