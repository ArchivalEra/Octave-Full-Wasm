# 59: **mimalloc 出厂批**：进受管辖模式表 + 全量验收 + 发运决策（工单 57 的发运前三步）

**What to build:** 工单 57 已证 mimalloc 成立（同旗标交错 3 轮：墙钟 **−27%**、pthread 锁
**10.3%→0%**、体积 +0.2%、数值 79/0 + dldfcn 71/0），但那份候选产物是**手驱动**
（`declared=null`）⇒ 按合同**不可发布**。本单把候选走完"出厂三步"，到"可发运候选"为止；
**发运本身是产品决定**（同 NT=8 / FMA 两批的分工）。

**Blocked by:** None

**Status:** resolved（2026-10-04：出厂三步完成——模式表注册 + declared/measured 双向核对 +
全量 **43 套 / 1084 PASS / 0 FAIL**（含 dldfcn 71/0、probe-lane 33/0、页面自证 4/0）；
候选 sha = 台账 `w64_cand_wasm_sha`；**2026-10-04 用户拍板发运**：8761/8768 双站已换 mimalloc 版（守卫全绿、页面自证 4/0、
parity 三处一致；FMA 版备份 `w64-artifacts-fma-backup-20261004/`））

**Settling:** `bash build/113/relink.sh explain w64`（注册后输出**必须**列出 MALLOC 旋钮；
现在 `grep MALLOC relink.sh` 零命中 ⇒ 尚未注册，explain 不含即红）+ `PROBES=1 sh build/sweep.sh
<8768 实验站>` 全绿（含 `accept-dldfcn`）⇒ 候选可发运；任一红 ⇒ mimalloc 不出厂
（产物留 `hotpath-stations/w64-mimalloc` 做档案，8761 不动）。

## 任务

1. `-sMALLOC=mimalloc` 进 `build/113/relink.sh` 的 **w64 模式表**（模式表是唯一口径：
   `explain` 打出来的就是文档、`--selfcheck` 覆盖 link-web.sh 读的每个变量——
   **不许手设环境变量**，那是 HISTORY §5.46"赋值了但没被引用"那一族坑）。
2. 重链 ⇒ `octave.build.json` 的 `declared` 带分配器标签（新键，如 `w64_malloc=mimalloc`）
   ⇒ 产物自证绿（`verdict=="ok"` 才可部署）。
3. **全量验收**（43 套 + `PROBES=1`，含 `accept-dldfcn`）在 mimalloc 产物上跑 ——
   它动运行期内存管理，全量是硬门槛；只跑数值四套不算候选（2026-10-02 NT=8 事故的形状）。
4. 台账重测 + 新事实键（`python3 build/facts.py`）；A/B 复核仍须**同旗标**
   （工单 57 Answer 的 `--diag` 混淆变量教训）。
5. 发运决策呈用户：走 `build/promote-w64-lane.sh`（**不许手 cp**；它带"base/threads
   逐字节不许变"的反向断言）。

## 边界

- mimalloc 是 emscripten 内建 malloc 选项（`-sMALLOC=mimalloc`），**不引入第三方源码树**；
- 若注册后发现与 `-fwasm-exceptions` / dlopen 内存增长安全点冲突：如实记录、回退，
  冲突证据进 `NOTES-hotpath.md`；
- 本单是**工单 61（部件插件系统）的第一个出厂实例**——旋钮进模式表时按 61 的声明格式留注释，
  便于日后收编（但不阻塞：先出厂，后收编）。

## Answer

（2026-10-04 结案：出厂三步完成。发运 = 产品决定，已呈用户。）

**① 模式表注册**：`relink.sh` 的 w64 模式新增 `MALLOC=mimalloc`（其余模式空 = emcc 默认
dlmalloc，链接行零变化；同一变量只出现一行）。消费侧 link-web.sh 两行：非空 ⇒
`-sMALLOC=$MALLOC`；mimalloc ⇒ 追加 `-Wl,--export-if-defined=mi_version`。
`--selfcheck` 双向覆盖（模式表 30 变量 ↔ link-web 读取面）；自证 **18 PASS / 0 fail**
（新增两条：exports 双模式、declared 双向）。

**② 产物侧判据（§5.46 纪律的落点）**：`mi_version` 是 mimalloc 归档独有符号（llvm-nm 实测
T；dlmalloc 无）⇒ `--export-if-defined` 只在真链了 mimalloc 时产出该导出，**strip 过的
产物导出表还在** ⇒ `write-build-manifest.py` 从导出段量 `measured.malloc`；
`check-build-manifest.py` **双向**核对：声明 mimalloc 但量到 default ⇒ 拒；
产物有探针但模式没声明 ⇒ 拒（`malloc_drift_problem` 反向断言）。

**③ 候选产物**（`w64-artifacts-mimalloc/`）：verdict=ok、**12 项声明全有实测背书**
（新增 `"malloc": "mimalloc"`）；BLAS = FMA 版 OpenBLAS（e2-openblas-lib-w64-rsimd）；
体积 30,984,954 B（+0.2% vs 现役 30,916,734）；导出 735 → 751（mimalloc 面）。

**④ 全量验收**（实验站 8861，`sweep-logs/20261004-140751`）：**43 套 / 1084 PASS / 0 FAIL**
（与现役基线逐数一致）+ 探针 30 套 / 274 PASS / 0 FAIL；**accept-dldfcn 71/0**（dlopen 面
无损）、probe-lane 33/0、probe-artifact-sha 4/0（页面实例化的正是候选字节）。

**⑤ 产品级交错 3×3**（候选 8861 vs 现役 8761，同窗配对，非诊断产物；台账 `w64_cand_*`）：

| 负载 | 候选 | 现役 | 比值 |
|---|---|---|---|
| loop 1e6 | 0.574 | 0.737 | **0.78（−22%）** |
| lu 800 | 0.014 | 0.014 | 1.00 |
| matmul 1000 | 0.023 | 0.024 | 0.96 |
| matmul 500 | 0.005 | 0.004 | 1.25（4–5 ms 尺度，噪声内）|

解读：分配/解释器密集轴拿到真收益（与工单 57 诊断级 −27% 同向）；BLAS 密集轴不动
（dgemm 内核不分配，符合预期）。

**⑥ 输入见证**（build-inputs.json +2 条）：模式表的 `MALLOC=mimalloc` 行、link-web.sh 的
探针旗标——被删即 DRIFT（每提交真跑）。
