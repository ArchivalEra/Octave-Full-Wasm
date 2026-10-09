# 54: **hotpath 性能热点仪器**（wasm64-NEXT 第一件）—— 把"片段"变成"带名字的热点表"

**What to build:** 用户的 wasm64-NEXT 计划第一步：**热点扫描得先有仪器**。今天产物是
`--strip-debug` 的（反汇编里函数名全是 `<>`）⇒ 采样只给函数**索引**、没有归因 ⇒ "扫了等于没扫"；
且 PGO 已死（工具链缺运行时）⇒ 这是**测量**仪器、不是优化器输入。故先造仪器，且**它本身必须
进事实系统**（不是外挂工具 —— 脱离事实系统的 build-doctor 会自带"我以为的状态"）。

**Blocked by:** None

**Status:** resolved （2026-10-03：仪器建成 + 端到端实测 + 接进事实系统；首个答案
`dgemm_kernel 89.1%`）

**Settling:** `python3 build/113/hotpath.py --selftest` ⇒ 7 PASS / 0 fail；
`python3 build/113/hotpath.py profile 'A=rand(1200); tic; for k=1:25, B=A*A; end' --lane w64`
⇒ 打印带名字的热点表；`python3 .githooks/check-facts-replay.py` ⇒ 含
`✓ witness hotpath_instrument_ok：ok`。

## Answer

（2026-10-03 结案。）

**① 关键发现（spike，省了一轮瞎设计）**：**符号构建不需要新做** —— `relink.sh link <mode>
--diag` 早已给你 name 段（`DIAG_NAMES=1` ⇒ `--profiling-funcs`）+ 源码映射
（`DIAG_SOURCEMAP=1` ⇒ `-g -gsource-map`）。所以设计里"配置符号构建"这一整块是**虚胖**，
`hotpath` 只把它当一个旗标用。⇒ 建模块前先打的这个 spike 值了。

**② spike 的双向证据**（`test/fixtures/hotpath-known-hot{,-stripped}.wasm`）：
| | 同一热函数 |
|---|---|
| 符号版 | `name="burn"` 73.8% + 26.0% |
| strip 版 | `name="wasm-function[1]"` 75.1% + 24.6% |
⇒ 仪器**能区分"有符号/无符号"** —— 这正是 `calibrate` 档要断言的。

**③ 模块（`build/113/hotpath.py`，自证 7/0）** —— 混合了三个候选设计最强的部分：
- **三条 fail-closed 不变量**（都来自真实事故）：**I1 只写实验站**（路径落进 site/8761 ⇒ 拒，
  用户点名的纪律）；**I2 先校准再信任**（夹具：符号版有名字 / strip 版只有索引，不过 ⇒ 事实写红）；
  **I3 名字或拒绝**（产物缺 name 段 ⇒ `UnnamedArtifact`，索引结果不许伪装成归因）。
- **Kind 协议**（内部缝）：一种测量 = 一个 adapter（`collect`/`symbolize`/`drafts`），首个 `cpu`。
  加"边界成本/内存/多车道对比" = 加 adapter，脊柱不动。
- **日志当缝**（外部缝）：`sample()` 写 `report.json`；`read_facts(log_dir)` 是**纯函数** ——
  `facts.py` 像读别的探针日志那样读它。可审计的逻辑是纯的，抖动全隔离在浏览器那一步。

**④ 端到端实测**（真实 w64 diag 产物，matmul 负载）：
```
89.1%  dgemm_kernel
 3.2%  inner_thread_931
 1.7%  Array<double, std::__2::pmr::polymorphic_allocator<double>>::ArrayRep::ArrayRep(long long)
 1.2%  exec_blas    1.1% dgemm_oncopy    0.8% dgemm_beta
（trusted=true, unnamed_pct=0, samples=6720）
```
**首个答案就印证了 FMA 打的是对的地方**（`dgemm_kernel` 独占 89%）—— 这类结论以前只能靠猜。

**⑤ 进事实系统**（不是外挂）：台账新增两键 —— `hotpath_top`（值 + `replay=False`，
从 log 读）与 `hotpath_instrument_ok`（挂 **witness** 档，复跑闸门实测
`✓ witness hotpath_instrument_ok：ok`）。台账 **100 条**；闸门自证 **36/36**。

**⑥ 已知边界（如实）**：采样是 **PC 级 self-time 归因**，给到"哪个 wasm 函数热"，**不给**
Octave 调用点/行号（除非 sourcemap 且引擎认）；内联的被调方因 `--profiling-funcs` 只命名存活
函数而消失；采样百分比跨轮有方差；`probe-hotpath` 标 manual（由 `hotpath.py` 编排，不进 sweep）。

**下一步**（本计划的继续）：用这台仪器扫**非 matmul** 的负载（解释器循环/索引/字符串/GC），
看剩余差距里有没有可动的 —— 期望低（平台税为主），但这是"把最后一个未知数变已知"。
