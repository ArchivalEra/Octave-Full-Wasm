# HANDOFF · Octave-Full-Wasm（给 AI 的接续说明 · **瘦身版**）

> **唯一目的：抗上下文压缩**。新会话只读这一份 + 几个指向文件就能接着干。
>
> **文档分层**（别混）：
> · **本文 = 活状态**（现在是什么 / 下一步）；活状态断言必须与产物一致，`check-handoff.py` 会拦。
> · **`build/113/PLAN-arch.md` = 当前工作令**（A0–A4 架构深化 + F1–F4 事实系统的批次、判据、回退点）。
> · **`HISTORY.md` = 历史**（append-only，`§5.x`/`§9`/`§10`；正文里单写的这些编号都指它）。
> · **`CONTEXT.md` = 术语表**（17 条术语 + 一行可复跑的证据）—— **看不懂黑话就读它**。
> · 分类坑：`build/CLIBS.md`（C 库）、`build/113/NOTES-jspi.md`、`build/113/NOTES-threads.md`、
>   `build/113/NOTES-webgl.md`；翻案台账 `build/lib/retractions.json`；事实台账 `build/FACTS.json`。
> **⚠️ 本文瘦身前的 1034 行全文在 `git show 76176bb:HANDOFF.md`**（删掉的表格/清单都在那儿）。

---

## 0. 现在是什么（2026-10-02）

- ★ **2026-10-02 当日批次**（摘要；细节见 §1d/§1e）：① **NT=8 已上站**（`w64` = 台账
  `w64_wasm_sha`；曾一度判"NT=8 打破 dlopen"，真因是**容器脚本漂移 `-flto`**，已翻案并修复
  —— 见 §1d）；② **事实系统第三档 `witness`**（贵事实的便宜见证，工单 42，见 §1e）；
  ③ 修掉 4 套**就绪反模式**套件（NT=8 下会挂死：`bench-core`/`bench-dgemm`/
  `probe-heap-ceiling`/`probe-want-matcher`）。
- **8761 = 现役「四格」站点**（工单 30，2026-10-01 上线）：根目录基础档 + `threads/` + **`w64/`** +
  **`w64-base/`**，档清单 `lanes.js` = `[base,threads,w64,w64-base]`，**带头服务**（`build/serve-coi.py`）
  ⇒ 页面按「能力 ∩ 清单」选 **`w64`**（memory64 + pthread）。**三层 SHA 都核过**：四档的磁盘/HTTP
  逐档一致、页面层自证 4/0（页面实例化的正是 `w64/octave.wasm`，且 == `w64/` 身份证记的 sha）。
  **`base`/`threads` 两档逐字节未变**（`wasm_sha` / `threads_wasm_sha` 都没动）⇒ 这是一次**只加两档**的批次。
  sha / 体积 / 回归数字都在文末 `AUTO:STATE`；其他实测事实在 `AUTO:FACTS`（源 = `build/FACTS.json`，
  每条带复跑命令）。正文只写**台账的键名**（F2 的规矩，闸门会拦手抄）。
- ★ **四格的发运入口是 `build/promote-w64-lane.sh`**（工单 30）：`--dry-run`/`--verify`/`--selftest`
  （自证 7/0，已进 `gates-selftest`）。它**拒收** base/threads 被动过的站点（**反向断言**：本批只许新增两档），
  且**不能**用 `promote-webgl.sh` 代替 —— 后者会从容器 `m2fc-threads-out` 重推线程档，而那份已漂到
  `c2899a71…`（现役是台账 `threads_wasm_sha` 那条）。
- ★ **四格的选择规则与反证（都钉了断言）**：带头 + memory64 ⇒ `w64`；带头但**无 memory64** ⇒ `threads`
  （**真 Chromium 125（`mem64=false`）实测**：`lane=threads`、页面照常 ready，`w64-logs/floor-8761-old-chromium.log`）；
  不带头 ⇒ `w64-base`（有 memory64）/ `base`；**显式强选不满足前提的档必须响亮失败**（`probe-lane` Cell 6/7）。
  **引擎矩阵已上键**（`floor_matrix_engines` / `floor_matrix_pass` / `floor_matrix_fail`）：Chromium 154、
  **Firefox**、**WebKit** 三台都落 `w64` 且 JSPI 门开；Chromium 125 落 `threads`。日志 `w64-logs/floor-8761-*.log`。
- ★★ **`w64` 的两个"想当然"实测都不成立**（2026-10-01，工单 31；已登记翻案 **R-013**）：
  · **不比 wasm32 快**：同题中位数 matmul 慢 1.17–1.20×、lu 慢 1.18–1.34×、解释器循环慢 1.72×
    （台账 `w64_matmul500_s` / `w64_lu800_s` 对 `lane_matmul500_s`）；四档里最快的是 `threads`
    （OpenBLAS 内核：BLAS 快 1.7–2.0×，`threads/base` 见 `w64-logs/speed-*.log`）。
  · **也没有更大的堆**：四档 wasm 内存上限**都是 2 GiB**，逐块分配实测**存活上限同为 1.49 GiB**
    （台账 `mem_live_ceiling_gib` / `w64_big_heap`）。`w64_mem_5g_bytes` 那 5 GiB 是**引擎能力**
    （直接构造 `WebAssembly.Memory`），产物从没申请超过 2 GiB ⇒ 要兑现得显式抬 `MAXIMUM_MEMORY` 重链。
  · 仪器（都可复跑）：`test/browser/bench-lanes.mjs`（四档竞速）、`test/browser/probe-heap-ceiling.mjs`
    （堆上限 + `W64_BIG_HEAP` 判据行）。
- **B6（双档 + COI）已收尾并上线**（branch `threads` 已合并到主干工作流；工作令 = `PLAN-threads.md` §6）：
  · **三套矩阵全绿**：线程档（8768 带头 + `PROBES=1`）、基础档（8770 不带头）、**8761 部署态**
    （带头 ⇒ 页面跑线程档）各跑一遍，逐套日志留档在 `sweep-logs/`；**套件数与 PASS 一律看台账**
    （`accept_suites` / `accept_pass`，口径 = 最近一次全绿扫描；逐档当时的数字见 `HISTORY` §5.64）；
  · 首跑暴露的**七条红**逐条查清并修好（真因与判据见 `NOTES-threads.md` 的四段机制 + `PLAN-threads.md`
    §6 的坑 10–13）：清单只改 URL 不改 sha、车道清单照抄 install 前缀、pthread `.oct` 引用
    `__cxa_guard_*`、slicot 少链 `common.oct.o`、选档只传给第一个上下文（worker / 第二实例）；
  · 产物：`threads_verdict` / `threads_shared_memory` / `threads_pthread_glue` / `threads_v128` /
    `threads_blas_dir` / `threads_wasm_sha`（都在 `AUTO:FACTS` 里，别背数字）；
  · `.oct` 两档分好：`oct_lane_tls_init` / `oct_lane_files` / `oct_lane_octdir_files`，基础档同条数
    （`oct_base_files` / `octdir_base_files`）；
  · **`test/browser/probe-lane.mjs` 全绿**（PASS 数见 `build/FACTS.json` 的 `probe_lane_pass`，
    FAIL = `probe_lane_fail` 必须为 0）：带头选线程档 + `caps.sharedMemory === true`、
    不带头落基础档照常 ready、`?lane=base` 覆盖生效、**没 COI 强选线程档硬失败**。
- **线程档的两条已知边界（都钉了断言，改回去会红）**：
  · **worker 宿主自动落基础档**（`?worker=1` 或缺省的手搓 `new Worker`）：线程产物在
    DedicatedWorker 里当主宿主**起不来**（`Module.eval_string is not a function`，实测）；
    显式 `?lane=threads&worker=1` 仍选线程档并**硬失败**（不静默降级）。
  · **同页多实例是支持的**（13/0），但**前提是每个实例都拿到页面的选档计划** —— 少传一个就是
    "线程胶水 + 基础产物"的错配（`eval_string` 缺席）。
- ★ **现役线程档 = E2（OpenBLAS，`USE_THREAD=0` 的交付形态）**，2026-09-28 上线：
  `threads/` 那份产物**就是 OpenBLAS**（BLAS 来源见台账 `threads_blas_dir`，收益见
  `e2_matmul500_ratio` / `e2_lu800_ratio`）。
  ⚠️ **别把「E2 上线」读成「数学已并行化」**：上线的是**单线程**形态 —— 收益来自 OpenBLAS 的内核，
  不是多线程；**线程版仍不可用**（`e2_threaded_oct_rc`），"为什么"未结案 ⇒ 工单 02。
  **基础档本次一字未换**（`wasm_sha` 逐字节未变，promote 的 §1b 判据核过）⇒ 这是一次
  **只换线程档**的换产物。
- ★ **wasm64 已建成并集成**（工单 14/17/18 全 `resolved`，2026-09-28，**branch `wasm64`**）：
  · **可行性三问全绿**：Q1 引擎支持（本机 Chromium 默认支持 memory64）、Q2 `.oct`
    （`w64_oct_wasm64` / `w64_oct_files`，且 `dlopen OK, f()=42`）、Q3 **引擎级 >4 GiB 确凿**（
    ⚠️ 但**产物没配** —— 四档的 wasm 内存上限都是 2 GiB，见工单 31 / 翻案 R-013）、
    （上限已上键：`w64_mem_5g_bytes` / `w64_mem_8g_bytes` / `w64_mem_shared_5g_bytes`；
    探针 = `test/browser/probe-wasm64-mem.mjs`，自托管两页、不依赖任何产物，FAIL 数 = `w64_mem_probe_fail`）；
  · **全量重编成**（`/usr/local-w64` + `/src/deps-w64`，影子 `/src/libwork/lane-shim-w64`
    注入 `-pthread -sMEMORY64=1`）；产物事实看台账 **`w64_*` 组**（10 条，含复跑命令）；
  · **两轴选档**（`bridge/lane.js`：COI × memory64）⇒ 最多四格；**`site-w64` 上四档物理齐备**：
    `base`(wasm32 单线程) / `threads`(wasm32+pthread) / **`w64`(memory64+pthread，目标形态)** /
    **`w64-base`(memory64 单线程，回退)**；
  · **验绿**：四格站点（**8768 先验 → 8761 上线**）全量回归全绿（套件数 / PASS 看台账
    `accept_suites` / `accept_pass`）；四格矩阵探针 PASS 数 = 台账 `probe_lane_pass` / FAIL = `probe_lane_fail`
    （含"缺 COI 强选 w64 硬失败"与"引擎无 memory64 强选 w64 硬失败"两条反证）；
  · ★ **2026-10-01 工单 30 结案：四格已上线 8761**（此前长期只在独立端口 8848 验）。
    上线过程见下条与 `build/113/NOTES-wasm64.md` 的「四格上线」节。
- **车道影子是本轮的关键机制**（`build/113/lane-shim.sh`）：给"没地方传编译旗标"的 farm 脚本
  用 PATH 影子注入旗标。B6 用它注 `-pthread`，wasm64 用它注 `-pthread -sMEMORY64=1`。
  ⚠️ `relink.sh link threads` 以前**依赖操作员手工把影子挂上 PATH**（否则 `main.o` 不带 atomics，
  报一个离根因很远的错）⇒ 已**搬进入口**：入口自己挂，缺了就点名 FATAL（工单级教训见 HISTORY §5.67）。
- ⚠️ **读 `AUTO:STATE` / `accept_*` 时注意口径**：那两个"最近一次全绿回归"取的是**最新的全绿扫描目录**。
  2026-10-01 起它指的是 **8761 自己的**那次（URL 列写着 8761）；四格站点的 PASS 数含探针/基准，
  表头那对数字**只数 `accept-*`**（探针另计，写在括号里 —— 口径见 `handoff_facts.sweep_facts`）。
  ★ 当天修掉一个让它们**互相冒充**的缺陷：`sweep.sh` 的记簿文件 `.inputs-error.log` 被当成
  "缺汇总行的套件" ⇒ 全绿的 `PROBES=1` 扫描被判不干净 ⇒ AUTO:STATE 静默退回旧扫描。现已改 `.txt`
  且消费侧跳过点文件（判据：`handoff_facts.sweep_facts()` 在 8761 那轮上必须 `clean=True`）。
- **F4 输入契约已接线**（2026-09-28 修）：`sweep_select.py --inputs-for` + `sweep.sh` 的
  `env $INPUTS`。**不接这一步，探针会退回它自己的内部默认** —— 实测差点骗过复核（把另一个站点的
  17 PASS 当成目标站点的）。⇒ 要跑**四格**选档探针：`SITE_DIR=<四格站点目录> PROBES=1 sh build/sweep.sh
  <URL> probe-lane`（环境变量覆盖优先于清单里声明的默认值；8761 那轮就是这么跑的，日志里
  `dir=/mnt/hdd/octave-wasm-build/site` 是证据）。
- 现役 farm（`/usr/local`、`/src/deps`）**一字未动**；四条车道 prefix 分开：
  `/usr/local`+`/src/deps`（base）、`-threads`（B6）、`-w64`（wasm64）—— **这是硬要求**。
- ★ **2026-09-30 无人值守批次**（用户令：持续立工单并解决）：**17 张工单结案**
  （01–06、08–11、14–18 `resolved`；13 `wontfix`——OSMesa 已退役，测量对象不存在）。
  关键落地：
  · 选档**第三轴**（工单 23）：`gen-lanes.sh` 生成站点**档清单** `lanes.js`，`lane.js` 取
    「能力 ∩ 清单」⇒ 同一份页面资产可服务"四格站 / 双档站 / 只有 base 的站"；
    实测 8761/8768 **20/0**、8848 **33/0**（`probe-lane`）；宿主侧纯函数自检
    `build/113/lane-pick-selftest.mjs` **9/0**（已进 `gates-selftest`，闸门 29 个全绿）；
  · **页面资产批有了受管辖入口**（工单 20）：`build/promote-pages.sh`
    （`--dry-run`/`--verify`/`--selftest`）—— 它第一次 dry-run 就抓出 `octave-core.js`/`lane.js`
    两处**此前无人发现的漂移**；
  · 工单 16 结案：线程版卡点定位到**`.oct` 的动态装载段**（非 BLAS 算术、非线程数）；工单 19
    （用户令：USE_THREAD=1 那 6.7× 要）已立，机制候选已锁到 OpenBLAS 的**热自旋**
    （`YIELDING` = 8 个 `nop`；`THREAD_TIMEOUT` 默认 28 ⇒ 池线程基本不停）挡住
    Emscripten 共享内存增长的**安全点**，而 `dlopen` 正需要增长。
- 事实系统：`build/FACTS.json`（源）+ `AUTO:FACTS`（渲染）+ 翻案台账
  `build/lib/retractions.json`（R-009/R-010）+ **`docs/agents/fact-system.md`**（给接手工单的 agent 的入门）。

## 1. 下一步（按此顺序）

**⚡ 状态（2026-10-01，工单 30 收尾）**：
- **工单台账：32 张 → resolved 30、wontfix 1、open 1**（★ 2026-10-02 口径刷新：27 已随
  wasm32 冻结结案；**41 NT=8 dlopen 回归**与 **42 事实系统 witness** 本批结案；
  **唯一 open = 票 12 真机手测** —— 依赖生产部署先行，用户与网站管理员在谈，部署落地前
  无可推进面；清单已入库 `docs/manual-test-checklist.md`）。
- **本日结案：30（w64 四格上线 8761）** —— 见 §1a（已完成的判据逐条列在里面）。
  顺带修掉四个真缺陷（都带自证，详见 §1a）：`check-build-manifest.py` 的 `--out-dir` 位置参数
  解析、`check-site-parity.sh` 只核 threads 档（w64 整档不在闸门里）、`probe-browser-floor.mjs`
  的选档判据分辨不出 w64/threads、`sweep.sh` 的记簿 `.log` 让全绿扫描被误判不干净。
- 验收底线全程未退化：8761 开机自检 1.3s、四档部署件 SHA 磁盘/HTTP/页面三层、parity 三处一致、
  8761 全量 `PROBES=1` 全绿（数字看台账 `accept_suites` / `accept_pass`）。

## 1a. ✅ 已完成：**工单 30 —— w64（四格）上线 8761**（2026-10-01）

用户 2026-09-30 拍板，2026-10-01 执行完毕。逐条判据与实测：

1. **8768 先验**：四格发到实验车道 → `PROBES=1` 全量全绿，`probe-lane` 是四格版的 PASS 数
   （逐轮原始数字当历史读：`HISTORY.md` §5.70；活状态口径见台账 `probe_lane_pass` / `probe_lane_fail`）。
2. **promote → 8761 开机自检**：1.3 s 就绪；带头页面 `__octaveLanes = [base,threads,w64,w64-base]`
   且**选中 `w64`**（`probe-lane` 的日志里 `dir=/mnt/hdd/octave-wasm-build/site` 是"跑的就是 8761 那份"的证据）。
3. **SHA 三层**：`base` / `threads` 两档 sha **逐字节未变**（`wasm_sha` / `threads_wasm_sha`），
   只**新增** `w64`（`w64_wasm_sha`）与 `w64-base`（`w64_base_wasm_sha`）；四档的磁盘/HTTP 逐档一致；
   页面层自证 4/0（`probe-artifact-sha`：页面实例化的字节 == `w64/` 身份证记的 sha）。
4. **8761 全量 + `PROBES=1`**：全绿（台账 `accept_suites` / `accept_pass`，探针另计），`probe_lane_pass` 已是四格版。
5. `site/`（仓库镜像）→ `make-dist.sh`（四档包内 sha 与部署件逐档相同）→ `parity --strict` 三处一致
   → 六道闸门 → 提交推送。
   ★ **交付包也起过并验过**（不只是字节相同）：包自带 `serve.py` 起来 ⇒ 开机 1.1 s、包内的四格选档
   `dist_lane_probe_pass` / `dist_lane_probe_fail`（日志 `w64-logs/dist-probe-lane.log`、`dist-e2e.log`）。
6. **反向断言（真引擎，不只模拟）**：本机 **Chromium 125**（`mem64=false`）在 8761 上
   `lane=threads`、页面 ready、D9 门关 —— 日志 `w64-logs/floor-8761-old-chromium.log`；
   现代 Chromium 同一条判据期望 `w64`（`w64-logs/floor-8761-chromium.log`）。
   **引擎矩阵**（`floor_matrix_*`）：Chromium 154 / Firefox / WebKit 三台落 `w64`，Chromium 125 落 `threads`。

## 1b. ⭐ 已建成、实测、**已 promote 到 8761**：`w64` + 线程版 OpenBLAS（工单 33，2026-10-02）

用户点名的形态（"当然是 w64+thread 啊"）**已经建出来、跑起来、并已发运**：
发运入口 `W64_OUT=/src/websrc/w64-ob-out5 sh build/promote-w64-lane.sh <8761站点>`（只换 `w64/` 一档），
产物 sha = 台账 `w64_wasm_sha`（**当时的值**；2026-10-02 已被 -O3+8GB 版取代，见 §1c 票 08）；
8761 开机 1.3 s、四档磁盘/HTTP SHA 逐档核过、
四格选档 33/0；全量回归全绿（accept 口径见台账 `accept_suites` / `accept_pass`；
PROBES=1 完整扫描含探针全过，`sweep-logs/20261002-094142`，见 §1c）。

- 产物：memory64 + pthread + `USE_THREAD=1` 的 OpenBLAS + idle-exit 补丁 ⇒ `verdict=ok`，
  `declared` 三条齐（`threads`/`wasm64`/`e2_openblas`），烘死路径 `-w64`；装机**开机 1.3 s**、
  四格选档 `probe-lane` **33/0**；残留 mismatch 1（与 wasm32 那份相同）。
- **速度**（台账 `w64_ob_matmul500_s` / `w64_ob_lu800_s` / `w64_ob_matmul500_speedup`）：
  matmul 500² **0.007 s**、lu(800) **0.019 s** —— 比现役 `w64`（refblas）快 **6.6×**，
  且比 wasm32 的 OpenBLAS 档（`e2_matmul500_s`）**还快** ⇒ i64 的代价远小于线程收益。
- 堆上限**没变**（`mem_live_ceiling_gib` / `W64_BIG_HEAP=no`）：要"又大又快"，"大"那一半仍要工单 31 第二半。
- **发运已完成**（2026-10-02）：`base`/`threads`/`w64-base` 三档 sha 逐字节未动，只有 `w64/` 换成
  本形态；发运脚本自带"只许新增/台账对齐"守卫全过。

## 1c. ✅ 收尾完成（2026-10-02，w64+线程版 OpenBLAS 批次到此关闭）

- **8761 全量 `PROBES=1`（r5）全绿**：accept 口径 = 台账 `accept_suites` / `accept_pass`（0 FAIL），
  探针/基准另计、0 FAIL（`sweep-logs/20261002-094142`）。
  前三轮：r1 被会话重启杀掉、r2 死于服务掉线、r4 在 probe-jspi 起头处被静默回收（后台任务随
  会话上下文回收 ⇒ **sweep 必须用受管后台任务跑**，完成有通知）。r4 曾报的两红
  （engine-parity / browser-floor 的 Firefox 格）已定案为 **sweep 窗口期资源竞争**，非产物回归：
  单跑 engine-parity **22/0**、browser-floor **8/0**（同 8761、同产物），r5 全量里也全绿。
- 收尾序列全过：台账重测（**数值零改口**，accept-* 求和 = 1084 PASS / 43 套；FACTS.json 仅时间戳重盖）
  → `site/` 同步（只 `w64/` 一档三件变化）→ make-dist（四档包内 sha 逐档 SAME）
  → parity `--strict` 三处完全一致（siteWebGL 的 `w64/` 已同步到现役）
  → 文档订正（README/DEPLOY 的 `w64` 档：线程版 OpenBLAS、最快交付形态、堆仍 2 GiB）。
- origin 推送已恢复（gh 重新认证），本批提交已推 origin。
- **下一阶段 = wayfinder 图「w64 极限性能」**（`.scratch/perf-max/map.md`）：票 01（杠杆清单）、
  02（原生基线）、03（>2 GiB 大堆 —— **8GB 版存活 7.45 GiB、`W64_BIG_HEAP=yes`，已建成未 promote**）、
  04-L4（-O3 转正车道默认）、07（**用户拍板：单王 w64；wasm32 线冻结于 `wasm32-final` 分支**，
  工单 27 同结）已结；frontier = 04-L1/L2（内核开发）/ 05（线程调优）/ 06（链接旗标）；
- **★ 2026-10-02 票 08：`-O3 + 8GB` 合体版曾发运 8761**（sha `3b0d5e2f…` 是当时的现值；**已被 §1d 的
  NT=8 版取代**，那是当时的值）：8854 先验 + 8761 r6
  **双全绿**（accept 口径见台账 `accept_suites` / `accept_pass`；PROBES=1 含探针 0 FAIL）、
  SHA 三层、四格 33/0；台账 `w64_big_heap`=yes、
  `mem_live_ceiling_gib`=7.45；DEPLOY/README 已订正；旧 2GB 产物备份
  `w64-artifacts-2g-backup-20261002/`。图的前半（01/02/03/04-L4/07/08）全部到达；
  **夜间批（无人值守）收尾**：05 结（**NT=4 = 甜点**；NT=8 死锁 ⇒ 工单 40）、06 结（链接侧
  三杠杆零采纳 —— 现役 -O2 = emcc 5.0.7 甜点）、04 结（L4 已转正；L5 翻案不采纳 —— OpenBLAS
  内置 LAPACK 是 f2c 标量而现役 lapack-simd 本是 SIMD 版；L1/L2/L3 拆 **票 39**）。
  **夜间第二批（38/40/39）**：**38 结**（`bridge/octave-embed.js` 嵌入接口层 + `octave-page.js`
  逐字抽取 + embed-demo 上手页 + accept-embed-api 13/0；⚠ embed 页面 GL 纹理边界记档）；
  **40 结**（NT=8 "死锁" = bench-lanes boot 中途轮询 feval 的调用方反模式 × 建池窗口竞态，
  两段式就绪修复后 **NT=8 性能 2.0–2.2× 显形** —— 票 05 翻面）；39 进行中（ARCH_WASM 死代码
  = level-1 标量真根因；`E2_ARCH_WASM_INTRIN` 旋钮就位；CCACHE_DISABLE 干净重建验证中；
  量法订正：.o 成员上数向量指令无效）。**图剩余 = 39（内核开发，下一会话续）+ 票 38 的
  GL 纹理边界（图形线）+ NT=8 上站（人拍板 —— 见 §1d：尝试后**回归、已回滚**）**。

## 1d. ✅ NT=8 已上站（2026-10-02）—— 回归真因 = **容器脚本漂移 `-flto`**，NT=8 **洗清**

- **现役 8761 `w64` = 干净 NT=8**（sha = 台账 `w64_wasm_sha`）：`-O3 + 8GB + NT=8`。
  速度（台账 `w64_ob_matmul500_s` / `w64_ob_lu800_s`）：matmul 500² **0.004 s**、
  lu(800) **0.013 s**；堆存活 `mem_live_ceiling_gib`（7.45 GiB）。开机 1.5 s、四格选档 33/0、
  SHA 三层（页面自证实例化该 sha）。
- **一度判"NT=8 打破 dlopen"是错误归因**（HISTORY §5.77），已翻案（§5.78）：首次发运的全量
  `PROBES=1` 抓出 `accept-dldfcn` **71/0 → 44/27**；**真因不是 NUM_THREADS**，而是**容器
  `/src/bin/link-web.sh` 漂移**（票 06 LTO 实验残留的 `-flto`）污染了那次链接 ——
  NT=8 产物记录的 `tool.script_sha256` = `2382ed34…`（当时容器里那份），与 **LTO 实验产物逐字节同值、导出数
  同为 733**（洁净版 `63d8e7d7…` / 732）；`git log` 证明仓库版**从未**含 `-flto`。
  **判别实验**：`-flto` 产物（非 NT8）跑 dldfcn **同样 44/27** ⇒ 元凶是 `-flto`。
- **修复**：`docker cp` 洁净 `link-web.sh` 回容器 → 重链 NT=8（**不带 `--diag`** —— 带它会因
  胶水形状不同让 dlsync 补丁 fail-closed）→ 8858 复验 `accept-dldfcn` **71/0**、数值四套 79/0、
  大堆 `W64_BIG_HEAP=yes`、bench 2.0–2.2× 收益保住 → 重发运 8761（三档未动）→ 全量 `PROBES=1`
  **0 FAIL**（`accept-dldfcn` 71/0）。取证链见 **工单 41**、HISTORY §5.78。
- **★ 2026-10-03 复跑完整全量（NT=8 现役 + 修复后的测试架子）：全绿、0 FAIL** ——
  accept 口径 = 台账 `accept_suites` / `accept_pass`（源 = `sweep-logs/20261003-074606`），
  与 NT=4 轮**持平**；全量合计（含探针/基准）看该目录的合计行。
  bench 段（昨晚挂死的现场）全部正常：`bench-dgemm` 3 秒完成（昨晚挂死被杀）、
  `bench-core` 与 `bench-lanes` 照常出 JSON；页面自证 sha = 台账 `w64_wasm_sha`。
- **连带修掉一个真缺陷**：`bench-core` / `bench-dgemm` / `probe-heap-ceiling` /
  `probe-want-matcher` 4 套仍用**旧就绪反模式**（boot 中途轮询 `feval`）⇒ 在 NT=8 下**挂死**
  （工单 40 只修了其余套件）。已统一为两段式（先等 `__octaveReady` 再碰 feval）；复跑
  bench-dgemm 不再挂、出正常中位数。
- **`accept-embed-api` 在 8761 上的红不是回归**：票 38 新套件、需站点部署 `embed-demo.html`
  等资产（用户指示"提交但不上站"）⇒ 已在 `test/browser/manifest.json` 声明输入使其**跳过**。
- **非UI面收官定界（2026-10-02 用户确认"真正收官"）**：工程面**零未结工单**（台账 32 张：
  resolved 30、wontfix 1、open 1）；剩余全是人的动作/外部依赖：① **票 12** 真机手测 ——
  **依赖生产部署先行**（无 CDN 链路真机测不作数；用户与网站管理员在谈）；② **38 页面资产
  上站**（走 `promote-pages.sh`，等部署口径；**前置缺口：promote-pages 清单不含工单 38 的
  三个新文件**，见票 38 补记）；③ 图形线 **E6**（embed 页 GL 纹理边界）—— 另一张图。
- **UI 线定界（2026-10-02 用户拍板）**：UI 本体交给专门的前端 agent；本仓交付 = **嵌入接口层**。
  接口表已照官方前端契约落档 **`docs/embed-api.md`**（事件/命令两张表；权威出处 =
  `event-manager.h` / `qt-interpreter-events.h`，逐条映射 Web 原语并标 ✅/🔜/➖）；
  工单 **38**（ready-for-agent）= 把 🔜 项落地：`bridge/octave-embed.js` + `embed-demo.html`
  上手页 + 探针 `accept-embed-api`。硬约束：零依赖、77 套验收契约逐字不变。

## 1e. ✅ 事实系统第三档 **`witness`（贵事实的便宜见证）**（2026-10-02，工单 42）

**用户点令**："升级事实系统，把无害探针更深入项目之中（通用、不为本项目专属），再把提升点
提 issue 给上游（各项目版本不统一，PR 不好）"。**`-flto` 事故正是这条缺口的实例**：事实系统
只有两档 —— `replay=True`（便宜、每提交真跑）/ `replay=False`（贵、**永不复查**）；构建产物
类全在后一档 ⇒ "产出它的工具漂移了"没有任何便宜机制能抓。

- **落地**：`build/facts.py` 的 `fact()` 增 `witness` / `witness_expect`（形状契约：同给或同
  不给，只给一个当场报错）；`.githooks/check-facts-replay.py` 增**见证档**（对挂 `witness` 的
  事实**不论 `replay`** 逐字执行、要求 stdout 逐字相等），自证 **13 PASS / 0 fail**（含 5 条反向）。
- **首个实例**：`build/113/witness-build-provenance.py <车道>`（带 `--selftest` 3/0）——
  断言**部署件由仓库现役 `link-web.sh` 构建**（读部署件 `tool.script_sha256` vs 仓库脚本 sha）；
  台账键 `w64_build_tool_match`。**正反都验过**：正常 `match`；把身份证改成漂移 sha ⇒
  **立即报"见证失败（来源漂移）"** ⇒ `-flto` 那种事故现在**提交时**就被抓，不用等浏览器回归。
- **上游 issue**：`ArchivalEra/Einfacht` 第 5 张反哺（留档 `docs/agents/upstream-issues.md`），
  照 #1–#4 体例（背景 + file:line/复跑证据 + 建议），**不做 PR**。
- ⚠ **边界**：见证只对**活跃迭代、每批重链的产物**断言（本仓 w64）；旧档构建 sha 本就不同，
  硬查 = 永久假红。策略留在各仓，机制（贵事实也能有便宜复查）才上收。

## 1f. ✅ 2026-10-03 上午批：新闸门 + 承重文件盲区修复 + promote-pages 缺口

- **★ 抓到承重文件盲区实例**：`.githooks/check-facts-replay.py`（**复跑闸门，工单 37 的交付物**）
  **从未入库** —— 被 `.gitignore` 白名单挡住且从未 `git add`，本地跑的一直是盘上那份。
  `gates-selftest` 对"闸门不存在"本有零值守卫（新克隆/CI 会红），但本地文件一直在 ⇒ 从未触发。
  已放行入库（连同新闸门）。**操作纪律（工单 43）**：新增闸门三件事一次做完 ——
  ① 文件 ② `gates-selftest.sh` 登记 ③ **`.gitignore` 白名单行**；缺第三件 =
  本地全绿、仓库里那道闸不存在。
- **新闸门 `check-readiness-pattern.py`**（工单 43）：凡含 feval 就绪轮询的套件必须两段式
  （先 `__octaveReady` 再 feval）—— NT=8 下旧写法会撞 OpenBLAS 建池窗口**挂死**
  （2026-10-02 全量在 bench-dgemm 挂死即此）。自证 6/0、真仓 94 个 .mjs 反模式 0 个、
  闸门自证 **33/33**。
- **promote-pages 前置缺口已修**（工单 38 记录的那条）：embed 三件（`octave-page.js` /
  `octave-embed.js` / `embed-demo.html`）进清单（`page_files()` 11 → 14，`recover-113.sh`
  cp 清单同步）；`--selftest` 3/0、`--dry-run` 如实显示三件"仓库有/站点缺"（提交未上站的
  诚实状态）。⇒ 将来 38 上站批只剩真跑一次 `sh build/promote-pages.sh`（上站仍是人的决定）。

## 1g. ✅ 2026-10-03 下午批：NT 曲线补测（工单 44）—— "NT=8 = 性能极限"定案

- 用户问"NT=8 是真正的性能极限了吧"⇒ 指出 NT=12/16 是唯一未实测的轴（"不试"的决定建立在
  已翻案的死锁理论上）并拍板补测。NT=12（`13033042…`）/ NT=16（`55d1e8d3…`）建成，dldfcn
  各 **71/0**（可行）。
- **交错 3×3 同窗配对实测：全部不快于 NT=8**（matmul1000 中位 0.029 vs 0.027、lu1500
  0.070 vs 0.065、matmul500 0.005 vs 0.003）⇒ **曲线峰在 8**，现役 NT=8 不动。
- **★ 方法论**：本机单轮 bench 方差 ≈ ±30%（NT=12 首轮曾"快 24%"，复跑即消失）——
  性能判决必须交错 ≥3 轮（详见工单 44 / HISTORY §5.79）。

## 1h. ✅ 2026-10-03 傍晚批：**最终结算 vs 本机原生 Octave**（工单 45）—— 性能线收官

- `bench-native.sh` 扩到 **bench-lanes 全部 9 题**（Octave 代码逐字同 CASES 表），原生两后端
  （netlib 参考 / OpenBLAS×24 天花板）与现役浏览器 w64 同机同窗对表。**全表 = 工单 45 的
  Answer**；台账新增 6 键（`native_netlib_matmul1000_s` 等 + 4 个派生比值）。
- **三条结论**：① 线代主力碾压"用户手里的原生 Octave"（matmul **7.8–9.1×**、lu **2.9–3.8×**）；
  ② 小问题**追平/反超 24 线程原生天花板**（matmul500 1.07、lu800 1.87、svd 1.27 —— 原生
  超额订阅税；大矩阵天花板才拉开，matmul1000 0.38）；③ 唯一明确输的轴 = **纯解释器**
  （loop 0.67×，平台税调不动）。
- **性能线全面收官**：可配置面（线程/链接/编译档）、手写面（SIMD 内核）、线程轴、原生对照
  四张账全部实测清空。

## 1i. ✅ 2026-10-03 晚批：**pre-ready eval 守卫**（工单 46）—— 票 40 残留尖角清零

- main.cc：`g_interp_ready` 原子旗标（execute_interp 尾置位 / quit_interp 复位）；
  `feval`/`eval_string` 未就绪即抛**真 JS Error**（`val::throw_`，消息逐字到 JS）——
  embed 门面的 try/catch 从此接得住（此前 NT=8 挂死穿透一切 catch）。
- 探针 `probe-preready-guard.mjs` **5/0**：调用方形状回归（boot 期 tight 轮询不挂死）+
  确定性断言（quit 后必抛 "not ready"；无守卫反面对照抛 `null function` ⇒ 探针能区分两个
  世界）。教训（两版探针自欺）见工单 46 / HISTORY §5.81。
- 发运：现役 `w64` = 台账 `w64_wasm_sha`（守卫版，735 导出），速度持平；备份
  `w64-artifacts-pre-guard-backup-20261003/`。**台账非人工候选清零** ——
  剩余全部是人的动作/外部依赖（票 12、38 上站、E6 图形线）。
- **工单 48（2026-10-03）：`octave-page.js` 重写为 TypeScript**（`bridge/octave-page.ts`
  → 编译产物，`sh build/build-embed-ts.sh`）：拆三道类型化的缝（CoreHooks 契约 / 可替换
  OutputSink / 输入捕获）；输出改**合并刷新**（DOM 插入 27000→167，-99%）。实测结论：
  **DOM 不是瓶颈**（compute 2.4s vs DOM 几十 ms）、**不该挪 wasm**（只会多边界穿越）。
  三套 embed 验收全绿（14/14、13/0、13/0）；8761 现役不受影响（用旧内联版，不 promote）。
  详单见工单 48 / docs/embed-api.md §5。
- **工单 49（2026-10-03）：Rust 车道天花板测试——faer 负判决**。faer-1t-wasm32 vs
  OpenBLAS-1t-wasm32 同条件：matmul500 34.0 vs 21 ms（输 1.6×）；理想 8 线程缩放仍全面
  落后现役（4.3/34/264 vs 3.0–4.0/25–28/199–203）⇒ **Rust 换 BLAS 车道结案**；Zed/GPUI
  编不进 wasm；重写解释器=放弃验收资产（反对）。crate 入库 `build/113/faer-bench/`。
  **"接口不变"前提下所有已知优化路径实测清空**。
- **工单 51（2026-10-03）：PGO 不可行判定 + 优化方向清单终态**。PGO：emcc 5.0.7 的
  wasm32-emscripten **缺 profile 运行时**（链接器 `symbol not found: llvm_profile_write_file`
  硬错误 + emsdk 全目录无 libclang_rt.profile* 为证）⇒ 探针三步可复现；LTO 维持票 06 否决；
  懒加载 LAPACK 量化后不立项（收益首屏 -20% vs "主→side 静态调用面"大手术——emscripten
  dylink 只支持 side→main）。**八条优化方向全部有数字判决**（本单 Answer 的终态表）。
- **工单 52（2026-10-03）：relaxed-simd FMA 内核发运**（"极限太远"后的最后一颗螺丝）。
  SIMD128 无 f64 FMA ⇒ 内核补丁 `mul+add ⇒ relaxed_madd`（+ `-mrelaxed-simd`，**必须改源码**
  ——LLVM 不收缩显式 intrinsic）。**交错 3 轮：matmul1000 −13%、lu1500 −10%**；数值 79/0 +
  dldfcn 71/0；三引擎全支持且 relaxed-simd 先于 memory64 ⇒ **无需新 lane 回退轴**。
  已发运 8761（台账 `w64_wasm_sha`）。⚠ 仪器教训：`grep relaxed_madd` 恒 0（objdump 打
  `<unknown>`）⇒ 用字节级 `fd 87 02`（→ Einfacht #6）。
- **★ 工单 47（2026-10-03 收官单）：Embed API 逐接口实测 14/14 PASS**（对照 Qt 官方接口，
  探针 `probe-embed-inventory.mjs`；accept 双套件同站 13/0 复验）——抓出并修掉
  `on.error` 死订阅（接口表 ✅e 但回调永不触发）；两条语义发现入 UI 单（embed 历史为空
  ⇒ UI 自维护命令历史；GL 边界 ⇒ v1 不在 embed 页画图）。**两张 gh issue 已提**：
  [#1 UI 开工包](https://github.com/ArchivalEra/Octave-Full-Wasm/issues/1)（14 行实测清单 +
  用法片段 + 四条必知边界）、[#2 部署工单](https://github.com/ArchivalEra/Octave-Full-Wasm/issues/2)
  （交付包 + COI/MIME 硬要求 + 五条验收程序）——等 UI 工作者与网站管理员各自开工。
- **守卫版全量 `PROBES=1` 全绿（0 FAIL）**：accept 口径 = 台账 `accept_suites` /
  `accept_pass`（源 = `sweep-logs/` 最新轮）；新探针 `probe-preready-guard` 自动入选
  **5 PASS / 0 FAIL**；parity 三处一致（siteWebGL 的 `w64/` 已同步到守卫版）；
  make-dist `octave-full-wasm-site-20261003`。

## 2. 铁律（违反会被拦或返工）

**路径**：仓库 `/mnt/hdd/zcode-projects/Octave-Full-Wasm`（**唯一**可改的 git 仓）；
构建容器 docker **`o113`**；第三方产物 `/mnt/hdd/octave-wasm-build/`；
不常用工具链/一次性浏览器下载 `/mnt/hdd/crossbuild-tools/`（playwright 浏览器在 `pw-browsers/`）；
**禁止**碰课程仓 `/mnt/hdd/zcode-projects/GONGCHENGSHUXUE20260917`。

**三条不可违背**：① **纯客户端计算**（Octave 恒跑在浏览器 wasm 内，禁止任何服务端执行端点）；
② 不 force-push / 不删 git 对象 / 不改历史；**禁用 `--no-verify`**；
③ **白名单仓库**：新增文件必须同步 `!路径` 进 `.gitignore`。

**验收底线**：`http://127.0.0.1:8761/` 永远是**最近一次通过浏览器实测**的构建；新实验失败不许让它
退化（回退：`cp site/octave.{wasm,js,data} siteWebGL/`，或站点备份目录）。

**事实纪律（5 条；F1–F3 之后已部分机器化）**：
1. 数值/行为**只认实测**，复跑方式写在断言旁边；写不出复跑方式的句子只能当历史。
2. **口径成组**：重配 = `WITH_OPENGL=1 WITH_GL2PS=1 WITH_FREETYPE=1 WITH_FONTCONFIG=1` **一整组**；
   重链口径由 `build/113/relink.sh` 的模式表推出（`explain <模式>` 打出来就是口径），
   `relink.sh --selfcheck` 保证"模式表覆盖 link-web.sh 读的每个变量"。
3. **"能编过 ≠ 能用了"**：碰运行期行为（GL / 字体 / 加载路径 / 资源）必须**浏览器侧**实测。
4. **断言要能证伪**：新契约至少配一条**反向**断言（该报错的必须报错）；行为变了就**翻面**
   （改断言，别改检查器）。
5. **断言有生命周期**：活状态只写**实测**；**推断**写进 `NOTES-*.md` 并注明"哪个实验能结案"；
   被推翻的断言登记进 `build/lib/retractions.json`。

## 3. 提交前（六道闸门 + 闸门自证 + 一致性闸门）

```bash
python3 .githooks/update-readme.py --check   # README 的 AUTO:FILES 新鲜
python3 .githooks/update-handoff.py          # HANDOFF 的 AUTO:STATE 机器块
python3 .githooks/check-handoff.py           # 活状态断言不得与产物矛盾（只查 HANDOFF）
python3 .githooks/check-consistency.py       # 挂载点/启动清单/页面依赖/CONTEXT 证据行
python3 .githooks/check-wants.py             # 断言可证伪性
python3 .githooks/check-whitelist.py         # 白名单覆盖
python3 .githooks/check-retractions.py       # 翻案重现检测（F3）
python3 .githooks/check-facts.py             # 事实闸门（F2）：块/裸数字/键/过期 四条规则
sh build/gates-selftest.sh                   # ★ 每个闸门必须都能证明自己"会红"（F1）
```
⚠️ **闸门有盲区**：`check-whitelist.py` 只看**已暂存**的文件 ⇒ 被忽略且从未 `git add` 的它看不见
（曾因此漏掉 4 个承重文件）。新增目录后主动看 `git status --short --ignored <目录>`。
⚠️ **改数字 / 写被翻案的断言会让 F2、F3 的闸门变红 —— 那是设计行为**（改文档，别关闸门）。

## 4. 硬坑（踩过的，别再来一次）

- ★ **禁止使用 `sleep`**（任何形式，含 `sleep 3 && …`）：ZCode 的前台预算会把普通长命令转后台
  救活，**只有 `sleep` 开头的会被直接杀掉**（等待反而把工作弄丢）。长任务用
  `run_in_background: true` 起（后台无超时）或 `setsid nohup … &`，靠**完成通知**或
  `tail -f --pid=<pid> <日志>` 收尾；已后台化的任务**绝不重跑**。输出只 `tail -n`/`grep`。
  **跑验收时别并行干重活**（并发压缩曾让套件假崩）。
- **测试用例从仓库原路径直跑**：`cd /mnt/hdd/octave-wasm-build/harness && sh run.sh <仓库里的 .mjs> <URL>`
  —— `import 'playwright-core'` 按**脚本所在目录**解析 ⇒ 必须由 runner 现拷一份（别自己留副本）。
- ★ **跑测试前先验产物 SHA**：`check-deploy-sha.sh` + `probe-artifact-sha.mjs`（磁盘 / HTTP / 页面自证三层）。
- **容器里的构建脚本是另一份拷贝**：改完仓库的 `link-web.sh` / `configure-113-full.sh` / `main.cc`
  必须 `docker cp` 进去（`link-web.sh` 自己会编 `main.cc`）。
- **别猜挂载点**：逐字读 `build/assets-meta.json`（`pkgfix`=`/usr/src/octave/m/pkg`、
  `plotbridge`=`/usr/src/octave/m/plotbridge`）；少写一层会把桥文件铺到 `m/` 根上。
- **探测/自检不许放在开机路径上**（坏产物会让整页卡死）；探测器要**按需触发 + 带超时**。
- **JSPI × dlopen 三条机制**（详见 `NOTES-jspi.md`）：链里有 dlopen ⇒ 上游入口可能挂起、不能同步调；
  **顺序即机制**；启动路径上碰 dlopen 会让页面起不来。**`Module.execute_interp()` 之前不许碰解释器**。
- **shell 陷阱**（本会话反复咬人，注释与各闸门里都有）：`pkill -f 'x'` **会匹配到自己这条命令行**
  （用 `'x[y]'` 括号技巧）；`rc=$?` 接在管道后拿的是最后一个命令的状态；`&&` 放在 `&` 前会把整条链
  后台化；`echo` 里的反引号会被当命令替换；`grep -c` 零命中**退出 1**；`grep -E` 里 `{` 是区间表达式；
  正则字符类漏数字（`[A-Z_]+` 匹配不到 `P5_OBJS`）；`-sENV=…` 不是 emcc 5.0.7 的设置项。
- 结论只认**产物**：`sha256sum`、`sweep-logs/<时间戳>/`、探针输出、`FACTS.json`；不认印象。

## 5. 批次收尾（固定动作）

`sh build/glue-selftest.sh`（91 项，宿主秒级）→ **8768 验绿**（`sh build/sweep.sh http://127.0.0.1:8768/`）
→ promote 8761（`build/promote-webgl.sh`；**M2 车道必须 `GL_OUT=$SRC_OUT`**）
   ★ **只改某一档/某一类的批次走各自的受管辖入口**（都不许手 `cp`）：页面资产批 =
   `build/promote-pages.sh`；**wasm64 车道批 = `build/promote-w64-lane.sh`**（它带"base/threads
   逐字节不许变"的反向断言，且**不能**用 promote-webgl 代替 —— 理由见 §0）。
→ `sh build/check-boot.sh http://127.0.0.1:8761/` → **部署件 SHA 三层**
（`check-deploy-sha.sh` + `probe-artifact-sha.mjs`；四格站点的第二参数见 AGENTS 那条）
→ **同步仓库 `site/`**
（`rsync -a --delete /mnt/hdd/octave-wasm-build/site/ site/`；`check-site-parity.sh --strict` 核三处一致
  —— 它按磁盘**动态**纳入 `threads`/`w64`/`w64-base` 三档，含两套车道 `.oct`）
→ **8761 全量**（`sh build/sweep.sh http://127.0.0.1:8761/`，每批再跑一次 `PROBES=1`）
→ `sh build/make-dist.sh`（核对**四档**包内 wasm 与部署件逐档同 sha）→ §3 的闸门组 → 提交。
**8761 在 promote 之前一动不动。**

---

## 附 · 机器维护的区块（**自动生成，别手改**）

### 实测事实台账（**活状态文档里数字的唯一产地**）

<!-- AUTO:FACTS -->
> 本区块由 `build/facts.py --render-doc HANDOFF.md` 从 `build/FACTS.json` 渲染，**不要手改**（pre-commit 会重算并 `git add`）。
> **活状态文档里的「测出来的数字」只在这里生产**：正文要引用就写 `build/FACTS.json` 的键名（例如 `wasm_v128`），别手抄数字。
> `.githooks/check-facts.py` 三条规则：块必须与台账一致 / 正文不许出现裸数字 / 引用的键必须存在。

| 键 | 值 | 复跑命令 | 测于 |
|---|---|---|---|
| `accept_pass` | **1084**（最近一次**全绿**扫描的 PASS 合计） | `同上，把每个套件的 PASS 相加` | 2026-10-03T23:06:41+0800 |
| `accept_suites` | **43** | `数 /mnt/hdd/octave-wasm-build/sweep-logs/20261003-205115 里带汇总行的套件（且 0 FAIL）` | 2026-10-03T23:06:41+0800 |
| `build_json_sha` | `d953d7a7929754be…` | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.build.json \| cut -d' ' -f1` | 2026-10-03T23:06:41+0800 |
| `data_sha` | `f250530ae5abe378…` | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.data \| cut -d' ' -f1` | 2026-10-03T23:06:41+0800 |
| `dist_lane_probe_fail` | **0** | `同上` | 2026-10-03T23:06:42+0800 |
| `dist_lane_probe_pass` | **33**（交付包**内部**的四格选档通过数（不只是字节相同）） | `cd <dist 包目录> && python3 serve.py 8788；再 SITE_DIR=<dist 包目录> sh build/sweep.sh http://127.0.0.1:8788/ probe-lane > w64-logs/dist-probe-lane.log` | 2026-10-03T23:06:42+0800 |
| `e2_lu800_ratio` | **1.4** | `上面两行的比值（车道 / E2）` | 2026-10-03T23:06:42+0800 |
| `e2_lu800_s` | **0.043** | `同 E2 那一行` | 2026-10-03T23:06:42+0800 |
| `e2_matmul500_ratio` | **1.9** | `上面两行的比值（车道 / E2）` | 2026-10-03T23:06:42+0800 |
| `e2_matmul500_s` | **0.021** | `E2 单线程站点跑 bench-core.mjs（见 NOTES 的 A/B 表）` | 2026-10-03T23:06:42+0800 |
| `e2_single_verdict` | **ok** | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/e2-artifacts/single/octave.build.json）` | 2026-10-03T23:06:42+0800 |
| `e2_single_wasm_bytes` | **29495868** | `stat -c %s /mnt/hdd/octave-wasm-build/e2-artifacts/single/octave.wasm` | 2026-10-03T23:06:42+0800 |
| `e2_single_wasm_sha` | `e570905ecc8927bf…` | `sha256sum /mnt/hdd/octave-wasm-build/e2-artifacts/single/octave.wasm \| cut -d' ' -f1` | 2026-10-03T23:06:42+0800 |
| `e2_threaded_lu800_s` | **0.02** | `同上` | 2026-10-03T23:06:42+0800 |
| `e2_threaded_matmul500_ratio` | **6.7** | `车道 / 线程版（派生）` | 2026-10-03T23:06:42+0800 |
| `e2_threaded_matmul500_s` | **0.006** | `E2 线程版站点跑 bench-core.mjs（该轮 300s 超时收尾，只到前几项）` | 2026-10-03T23:06:42+0800 |
| `e2_threaded_oct_rc` | **124** | `timeout 600 sh test/browser/run.sh ...accept-113-oct.mjs <E2 线程版站点>; echo $?` | 2026-10-03T23:06:42+0800 |
| `e2_threaded_verdict` | **ok** | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/e2-artifacts/threaded/octave.build.json）` | 2026-10-03T23:06:42+0800 |
| `e2_threaded_wasm_bytes` | **29908917** | `stat -c %s /mnt/hdd/octave-wasm-build/e2-artifacts/threaded/octave.wasm` | 2026-10-03T23:06:42+0800 |
| `e2_threaded_wasm_sha` | `bce7e4cc252d6481…` | `sha256sum /mnt/hdd/octave-wasm-build/e2-artifacts/threaded/octave.wasm \| cut -d' ' -f1` | 2026-10-03T23:06:42+0800 |
| `env_vars` | **30** | `grep -oE '\$\{[A-Za-z0-9_]+:[-+]' /mnt/hdd/zcode-projects/Octave-Full-Wasm/build/113/link-web.sh \| sort -u（去掉位置参数）` | 2026-10-03T23:06:41+0800 |
| `exported_functions` | **710**（M2 保活集大小（M1 约 44987）） | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.exported_functions` | 2026-10-03T23:06:41+0800 |
| `floor_matrix_engines` | **4**（跑过的引擎：Chromium 154 / Chromium 125 / Firefox / WebKit（2026-10-01 实测）） | `数 w64-logs/floor-*.log 里 `· ① 页面 ready` 判据行的引擎名（去重）` | 2026-10-03T23:06:42+0800 |
| `floor_matrix_fail` | **0**（必须 0；含「无 memory64 的引擎必须落 threads」这条反向断言） | `同上` | 2026-10-03T23:06:42+0800 |
| `floor_matrix_pass` | **16** | `同上（各日志结尾的 `=== N PASS / M FAIL ===` 求和）` | 2026-10-03T23:06:42+0800 |
| `fonts_count` | **8** | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.fonts` | 2026-10-03T23:06:41+0800 |
| `hotpath_instrument_ok` | **ok**（仪器健康（I2）：符号版有名字、strip 版只有索引 —— 先用已知热夹具证明仪器看得见名字，再信任热点数字（照 calibrate 档的规矩）。） | `python3 build/113/hotpath.py calibrate` | 2026-10-03T23:06:42+0800 |
| `hotpath_top` | **dlmalloc 15.7%**（仪器热点的 top（lane=w64 kind=cpu 采样 7488 个；未归因 0.0%）） | `读 /mnt/hdd/octave-wasm-build/hotpath-logs/20261003-223721/report.json 的 hotspots[0]（重活 ⇒ 不逐字复跑）` | 2026-10-03T23:06:42+0800 |
| `js_sha` | `caac68bf62015859…` | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.js \| cut -d' ' -f1` | 2026-10-03T23:06:41+0800 |
| `jspi_entry` | 是（B 姿势的可挂起入口在不在） | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.jspi_entry` | 2026-10-03T23:06:41+0800 |
| `lane_lu800_s` | **0.06** | `同车道那一行` | 2026-10-03T23:06:42+0800 |
| `lane_matmul500_s` | **0.04** | `现役车道站点跑同一个 bench-core.mjs` | 2026-10-03T23:06:42+0800 |
| `matrix_page_sha` | `54a7e1c261a2df2f…` | `sha256sum /mnt/hdd/octave-wasm-build/site/matrix-android.html \| cut -d' ' -f1` | 2026-10-03T23:06:41+0800 |
| `mem_live_ceiling_gib` | **7.45**（逐块 0.75 GiB 吃到 OOM 的**存活上限**（四档实测同为 1.49 GiB）） | `HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/probe-heap-ceiling.mjs http://127.0.0.1:8761/ > w64-logs/heap-ceiling.log` | 2026-10-03T23:06:42+0800 |
| `native_netlib_loop1e6_s` | **0.500141**（netlib 参考实现的 loop1e6（用户手里的原生 Octave；机器空闲时跑，重活 ⇒ replay 豁免）） | `sh build/113/bench-native.sh` | 2026-10-03T23:06:42+0800 |
| `native_netlib_lu1500_s` | **0.25765**（netlib 参考实现的 lu1500（用户手里的原生 Octave；机器空闲时跑，重活 ⇒ replay 豁免）） | `sh build/113/bench-native.sh` | 2026-10-03T23:06:42+0800 |
| `native_netlib_lu800_s` | **0.04076**（netlib 参考实现的 lu800（用户手里的原生 Octave；机器空闲时跑，重活 ⇒ replay 豁免）） | `sh build/113/bench-native.sh` | 2026-10-03T23:06:42+0800 |
| `native_netlib_matmul1000_s` | **0.196202**（netlib 参考实现的 matmul1000（用户手里的原生 Octave；机器空闲时跑，重活 ⇒ replay 豁免）） | `sh build/113/bench-native.sh` | 2026-10-03T23:06:42+0800 |
| `native_netlib_matmul500_s` | **0.027249**（系统默认 BLAS（netlib 参考实现，单线程）的 matmul 500² —— 用户手里的原生 Octave） | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` | 2026-10-03T23:06:42+0800 |
| `native_openblas_lu1500_s` | **0.040473**（原生天花板（OpenBLAS 0.3.34 pthread）的 lu1500 中位数；机器空闲时跑，重活 ⇒ replay 豁免） | `sh build/113/bench-native.sh` | 2026-10-03T23:06:42+0800 |
| `native_openblas_lu800_s` | **0.026146**（原生天花板（OpenBLAS 0.3.34 pthread）的 lu800 中位数） | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` | 2026-10-03T23:06:42+0800 |
| `native_openblas_matmul1000_s` | **0.009586**（原生天花板（OpenBLAS 0.3.34 pthread）的 matmul1000 中位数；机器空闲时跑，重活 ⇒ replay 豁免） | `sh build/113/bench-native.sh` | 2026-10-03T23:06:42+0800 |
| `native_openblas_matmul1024_s` | **0.008517**（原生天花板（OpenBLAS 0.3.34 pthread）的 matmul1024 中位数） | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` | 2026-10-03T23:06:42+0800 |
| `native_openblas_matmul2000_s` | **0.050018**（原生天花板（OpenBLAS 0.3.34 pthread）的 matmul2000 中位数） | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` | 2026-10-03T23:06:42+0800 |
| `native_openblas_matmul500_s` | **0.003212**（原生天花板（OpenBLAS 0.3.34 pthread）的 matmul500 中位数） | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` | 2026-10-03T23:06:42+0800 |
| `native_openblas_threads` | **24**（天花板后端的线程数（占比口径的一部分，必须如实记录）） | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` | 2026-10-03T23:06:42+0800 |
| `oct_base_files` | **16**（基础档 `assets/oct/` 条数） | `find /mnt/hdd/octave-wasm-build/site/assets/oct -name '*.oct' \| wc -l` | 2026-10-03T23:06:42+0800 |
| `oct_lane_files` | **16**（线程档 `assets/oct-threads/` 条数） | `find /mnt/hdd/octave-wasm-build/site/assets/oct-threads -name '*.oct' \| wc -l` | 2026-10-03T23:06:42+0800 |
| `oct_lane_octdir_files` | **28**（线程档 `assets/octdir-threads/` 条数） | `find /mnt/hdd/octave-wasm-build/site/assets/octdir-threads -name '*.oct' \| wc -l` | 2026-10-03T23:06:42+0800 |
| `oct_lane_tls_init` | **44**（每个都必须有（没有在线程档里 dlopen 会 tlsInitFunc 不是函数）；分母见 oct_lane_files + oct_lane_octdir_files） | `python3 build/113/check-oct-lane.py <站点>/assets/oct-threads <站点>/assets/octdir-threads --base <站点>/assets/oct <站点>/assets/octdir` | 2026-10-03T23:06:42+0800 |
| `octdir_base_files` | **28**（基础档 `assets/octdir/` 条数） | `find /mnt/hdd/octave-wasm-build/site/assets/octdir -name '*.oct' \| wc -l` | 2026-10-03T23:06:42+0800 |
| `probe_lane_fail` | **0** | `同上（脚本结尾的 `=== N PASS / M FAIL ===`）` | 2026-10-03T23:06:42+0800 |
| `probe_lane_pass` | **33**（选档探针的 PASS 数（FAIL 必须 0）；站点四格/双档不同 ⇒ 看 cmd 的 SITE_DIR） | `SITE_DIR=<站点> sh test/browser/run.sh test/browser/probe-lane.mjs > /mnt/hdd/octave-wasm-build/probe-lane.log` | 2026-10-03T23:06:42+0800 |
| `threads_blas_dir` | **/src/work/e2-openblas-lib-s**（**必须含 `-threads`**（判据见 check-build-manifest.lane_blas_problem）） | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 inputs.blas.resolved_dir` | 2026-10-03T23:06:41+0800 |
| `threads_exported_functions` | **725** | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 measured.exported_functions` | 2026-10-03T23:06:41+0800 |
| `threads_pthread_glue` | **54**（基础档实测是 0） | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 measured.threads.pthread_glue` | 2026-10-03T23:06:41+0800 |
| `threads_shared_memory` | 是（wasm 内存段的 shared 位；线程档的硬身份） | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 measured.threads.shared_memory` | 2026-10-03T23:06:41+0800 |
| `threads_v128` | **4926**（线程档也带 SIMD（两轴不互斥）） | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 measured.simd.v128` | 2026-10-03T23:06:41+0800 |
| `threads_verdict` | **ok**（只有 ok 才可部署（fail-closed）） | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 verdict` | 2026-10-03T23:06:41+0800 |
| `threads_wasm_bytes` | **29495868** | `stat -c%s /mnt/hdd/octave-wasm-build/site/threads/octave.wasm` | 2026-10-03T23:06:42+0800 |
| `threads_wasm_sha` | `e570905ecc8927bf…` | `sha256sum /mnt/hdd/octave-wasm-build/site/threads/octave.wasm \| cut -d' ' -f1` | 2026-10-03T23:06:42+0800 |
| `w64_base_shared_memory` | 否（单线程回退档：**不**是 shared（这是它与 w64 的分界）） | `读 /mnt/hdd/octave-wasm-build/w64-base-artifacts 的 measured.threads.shared_memory` | 2026-10-03T23:06:42+0800 |
| `w64_base_verdict` | **ok** | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/w64-base-artifacts/octave.build.json）` | 2026-10-03T23:06:42+0800 |
| `w64_base_wasm64` | 是（回退档也必须是真 64 位（否则它回退的是**另一个 ABI**，不是同一档）） | `读 /mnt/hdd/octave-wasm-build/w64-base-artifacts 的 measured.wasm64` | 2026-10-03T23:06:42+0800 |
| `w64_base_wasm_bytes` | **29935634** | `stat -c %s /mnt/hdd/octave-wasm-build/w64-base-artifacts/octave.wasm` | 2026-10-03T23:06:42+0800 |
| `w64_base_wasm_sha` | `091c350054111b96…` | `sha256sum /mnt/hdd/octave-wasm-build/w64-base-artifacts/octave.wasm \| cut -d' ' -f1` | 2026-10-03T23:06:42+0800 |
| `w64_big_heap` | 是（工单 31 的结算判据：抬了 MAXIMUM_MEMORY 之后必须变 yes） | `同上（探针结尾的 `W64_BIG_HEAP=` 行）` | 2026-10-03T23:06:42+0800 |
| `w64_build_recipe_ok` | **ok**（构建**输入**的不变式（配方层）：link-web.sh 无 -flto / 含 -fwasm-exceptions；w64 车道含 -sMEMORY64=1。把「输入」也当事实，由同一批复跑闸门核对 ——由同一批复跑闸门每提交核对。） | `python3 build/113/witness-build-inputs.py` | 2026-10-03T23:06:42+0800 |
| `w64_build_tool_match` | **match**（贵事实的便宜见证：部署件记录的构建脚本 sha 必须 == 仓库现役脚本。做不到就 DRIFT（来源漂移）。注意**旧档**（base/threads/w64-base）建造时间不同、记录 sha 各异 ⇒ 只对活跃迭代并每批重链的 w64 档断言。） | `<重链 w64 后：python3 build/113/witness-build-provenance.py w64>` | 2026-10-03T23:06:42+0800 |
| `w64_exported_functions` | **735** | `读 /mnt/hdd/octave-wasm-build/w64-artifacts 的 measured.exported_functions` | 2026-10-03T23:06:42+0800 |
| `w64_i64_insns` | **4175689**（64 位的指令层证据（wasm32 版为 0）） | `llvm-objdump -d <w64>/octave.wasm \| grep -c i64（由 build/113/build-w64-lane.sh facts 写出，容器内跑）` | 2026-10-03T23:06:42+0800 |
| `w64_lu800_s` | **0.079**（w64 档 lu(800)：比 base 慢约 1.3×） | `HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/bench-lanes.mjs http://127.0.0.1:8761/ w64 > w64-logs/speed-w64.log` | 2026-10-03T23:06:42+0800 |
| `w64_matmul500_s` | **0.048**（w64 档矩阵乘 500²：比 base 慢约 1.2×（i64 指针/索引的代价）） | `HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/bench-lanes.mjs http://127.0.0.1:8761/ w64 > w64-logs/speed-w64.log` | 2026-10-03T23:06:42+0800 |
| `w64_mem_5g_bytes` | **5242880000**（单线程 memory64 分配 80000 页（非 COI 页，buffer 是 ArrayBuffer）） | `sh test/browser/run.sh test/browser/probe-wasm64-mem.mjs > /mnt/hdd/octave-wasm-build/w64-logs/mem-probe.log` | 2026-10-03T23:06:42+0800 |
| `w64_mem_8g_bytes` | **8589934592**（单线程 memory64 分配 131072 页） | `sh test/browser/run.sh test/browser/probe-wasm64-mem.mjs > /mnt/hdd/octave-wasm-build/w64-logs/mem-probe.log` | 2026-10-03T23:06:42+0800 |
| `w64_mem_probe_fail` | **0**（内存探针 FAIL 数（必须 0；含 wasm32 上限 / index 陷阱 / BigInt 三条反证）） | `同上（脚本结尾的 `=== N PASS / M FAIL ===`）` | 2026-10-03T23:06:42+0800 |
| `w64_mem_shared_5g_bytes` | **5242880000**（COI 页 shared memory64 分配 80000 页（buffer 是 SharedArrayBuffer）） | `sh test/browser/run.sh test/browser/probe-wasm64-mem.mjs > /mnt/hdd/octave-wasm-build/w64-logs/mem-probe.log` | 2026-10-03T23:06:42+0800 |
| `w64_ob_lib_wasm32_members` | **0**（必须是 0（side module 的指针宽度必须与主模块一致）） | `同上` | 2026-10-03T23:06:42+0800 |
| `w64_ob_lib_wasm64_members` | **1557**（w64 车道线程版 OpenBLAS 归档里 wasm64 成员数） | `E2_LANE=w64 docker exec o113 bash /src/bin/build-e2-lane.sh src patch build > w64-logs/e2-w64-build.log（读那行架构断言）` | 2026-10-03T23:06:42+0800 |
| `w64_ob_lu800_s` | **0.014**（现役 w64（线程版 OpenBLAS NT=8）的 lu(800) 中位数） | `同上（8761 现役那轮）` | 2026-10-03T23:06:42+0800 |
| `w64_ob_matmul1000_native_ratio` | **0.38**（浏览器 w64 matmul1000 占原生天花板的比值（大矩阵是最吃线程的刻度）） | `派生：native-baseline.json 的 openblas24.matmul1000 ÷ bench-ob-w64.log 的 matmul 1000` | 2026-10-03T23:06:42+0800 |
| `w64_ob_matmul500_native_ratio` | **1.07**（浏览器 w64 占原生天花板的比值（占比仪表盘的表头）） | `派生：w64-logs/native-baseline.json 的 openblas24.matmul500 ÷ w64-logs/bench-ob-w64.log 的 matmul 500` | 2026-10-03T23:06:42+0800 |
| `w64_ob_matmul500_s` | **0.003**（现役 w64（线程版 OpenBLAS NT=8，2026-10-02 上站）的矩阵乘 500² 中位数） | `HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/bench-lanes.mjs http://127.0.0.1:8761/ w64 > w64-logs/bench-ob-w64.log` | 2026-10-03T23:06:42+0800 |
| `w64_ob_matmul500_speedup` | **15.3**（OpenBLAS 版相对 refblas 版 w64 的加速倍数（历史对照：refblas 的现役地位已由 2026-10-02 NT=8 批取代）） | `派生：w64-logs/bench-ship-w64.log 的 matmul 500 ÷ w64-logs/bench-ob-w64.log 的同项` | 2026-10-03T23:06:42+0800 |
| `w64_ob_matmul500_vs_netlib` | **9.1**（浏览器 w64 相对『系统默认 BLAS 的原生 Octave』的倍数） | `派生：w64-logs/native-baseline.json 的 netlib.matmul500 ÷ w64-logs/bench-ob-w64.log 的 matmul 500` | 2026-10-03T23:06:42+0800 |
| `w64_oct_files` | **46**（车道 `.oct` 总数） | `同上（文件名：oct-wasm64.txt 的第二个数）` | 2026-10-03T23:06:42+0800 |
| `w64_oct_wasm64` | **46**（`.oct` 车道里 wasm64 的个数（side module 的指针宽度必须与主模块一致）） | `bash build-w64-lane.sh facts（容器内；用 /emsdk/upstream/bin/llvm-readobj 逐个量）` | 2026-10-03T23:06:42+0800 |
| `w64_relaxed_madd` | **47**（relaxed-simd FMA 指令数（工单 52）。⚠ 量法本身有生命周期：`grep relaxed_madd` 是**被证伪的量法**（见 build/instruments.json）——本键的 cmd 已避开它（字节级）。calibrate= 用已知含它的样本自证。） | `<重活：产物 + test/fixtures/relaxed_madd_min.wasm 各数 fd 87 02>` | 2026-10-03T23:06:42+0800 |
| `w64_shared_memory` | 是（目标形态 = memory64 **+ 多线程**（shared 是这个轴的硬身份）） | `读 /mnt/hdd/octave-wasm-build/w64-artifacts 的 measured.threads.shared_memory` | 2026-10-03T23:06:42+0800 |
| `w64_v128` | **6582** | `读 /mnt/hdd/octave-wasm-build/w64-artifacts 的 measured.simd.v128` | 2026-10-03T23:06:42+0800 |
| `w64_verdict` | **ok**（只有 ok 才可部署（fail-closed）） | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/w64-artifacts/octave.build.json）` | 2026-10-03T23:06:42+0800 |
| `w64_vs_netlib_loop1e6` | **0.67**（浏览器解释器循环相对原生的比值（<1 = 浏览器慢 —— 纯解释器轴是唯一明确输的）） | `派生：native-baseline.json 的 netlib.loop1e6 ÷ bench-ob-w64.log 的 loop 1e6` | 2026-10-03T23:06:42+0800 |
| `w64_vs_netlib_lu1500` | **3.8**（浏览器 w64 lu1500 相对『用户手里的原生 Octave』的倍数） | `派生：native-baseline.json 的 netlib.lu1500 ÷ bench-ob-w64.log 的 lu 1500` | 2026-10-03T23:06:42+0800 |
| `w64_vs_netlib_matmul1000` | **7.8**（浏览器 w64 matmul1000 相对『用户手里的原生 Octave』的倍数） | `派生：native-baseline.json 的 netlib.matmul1000 ÷ bench-ob-w64.log 的 matmul 1000` | 2026-10-03T23:06:42+0800 |
| `w64_wasm64` | 是（wasm 内存段 limits flags bit2 = 1 ⇒ 真 64 位） | `读 /mnt/hdd/octave-wasm-build/w64-artifacts 的 measured.wasm64` | 2026-10-03T23:06:42+0800 |
| `w64_wasm_bytes` | **30916734** | `stat -c %s /mnt/hdd/octave-wasm-build/w64-artifacts/octave.wasm` | 2026-10-03T23:06:42+0800 |
| `w64_wasm_sha` | `5b5bb98122ba9860…` | `sha256sum /mnt/hdd/octave-wasm-build/w64-artifacts/octave.wasm \| cut -d' ' -f1` | 2026-10-03T23:06:42+0800 |
| `wasm_bytes` | **29632229** | `stat -c%s /mnt/hdd/octave-wasm-build/site/octave.wasm` | 2026-10-03T23:06:41+0800 |
| `wasm_sha` | `1ed3e528561e4475…` | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.wasm \| cut -d' ' -f1` | 2026-10-03T23:06:41+0800 |
| `wasm_v128` | **4752**（SIMD 判据；非 SIMD 那版是 0） | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.simd.v128` | 2026-10-03T23:06:41+0800 |

台账生成时间 `2026-10-03T23:06:42+0800`；每条的值/出处/复跑命令都在 `build/FACTS.json` 里。
<!-- /AUTO:FACTS -->

### 部署状态

<!-- AUTO:STATE -->
> 本区块由 `.githooks/update-handoff.py` 重算，**不要手改**（pre-commit 会刷新并 `git add`；pre-push 会 `--check`）。

| 项 | 值 |
|---|---|
| `octave.wasm` | 29,632,229 B raw / 7,083,341 B gz | sha256 `1ed3e528561e4475…` |
| `octave.js` | 462,821 B raw / 89,652 B gz | sha256 `caac68bf62015859…` |
| `octave.data` | 9,712,174 B raw / 3,155,047 B gz | sha256 `f250530ae5abe378…` |
| 三大件 gzip 合计 | **10,328,040 B** | |
| 资产条目 | 49 | |
| 最近一次**全绿**回归 | `20261003-205115` · **43 套 / 1,084 PASS / 0 FAIL**（同日 PROBES=1 另跑：探针 30 套 / 274 PASS、基准 3 套（按契约无汇总行）） | http://127.0.0.1:8761/ |
| 交付包 | `octave-full-wasm-site-20261003` · tar.zst 91,240,236 B · `c5065cd1c26bc968…` | 包内 wasm （**与部署件同 sha** ✓） |
| 仓库 | 分支 `wasm64-NEXT`（**HEAD 的 sha 与日期以 `git log -1` 为准，不写死在这里**） | |
<!-- /AUTO:STATE -->

## 1k. 🌿 `wasm64-NEXT` 分支（2026-10-03 起）：热点扫描 + 逐步靠近极限

- **分支纪律**：实验产物只进实验站（`hotpath-stations/`），**不碰 8761/8768、不 promote**；
  合并判据四条：① 全量全绿（含 `accept-dldfcn`）② `octave.build.json` 的 `declared` 不变
  ③ embed/geometry 的 v1 签名逐字未变（UI 开工即冻结 v1，扩展只增不改）④ 有实测数字。
- **工单 54 结案：`hotpath` 热点仪器**（`build/113/hotpath.py`，自证 7/0）。三条 fail-closed
  不变量（I1 只写实验站 / I2 先校准再信任 / I3 名字或拒绝）+ Kind 协议（内部缝）+
  日志当缝（`read_facts` 纯函数 → 事实系统）。**关键发现**：符号构建不需要新做 ——
  `relink --diag` 早给 name 段（`--profiling-funcs`）。首个答案 `dgemm_kernel 89.1%`
  （印证 FMA 打对了地方）。台账 **100 条**（`hotpath_top` + `hotpath_instrument_ok` 挂 witness）。
