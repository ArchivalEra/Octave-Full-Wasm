# 59: **mimalloc 出厂批**：进受管辖模式表 + 全量验收 + 发运决策（工单 57 的发运前三步）

**What to build:** 工单 57 已证 mimalloc 成立（同旗标交错 3 轮：墙钟 **−27%**、pthread 锁
**10.3%→0%**、体积 +0.2%、数值 79/0 + dldfcn 71/0），但那份候选产物是**手驱动**
（`declared=null`）⇒ 按合同**不可发布**。本单把候选走完"出厂三步"，到"可发运候选"为止；
**发运本身是产品决定**（同 NT=8 / FMA 两批的分工）。

**Blocked by:** None

**Status:** ready-for-agent

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
