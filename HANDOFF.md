# HANDOFF · Octave-Full-Wasm（给 AI 的接续说明 · **指路牌版**）

> **唯一目的：抗上下文压缩**。2026-10-04 起按新记忆架构运行（规约 = `docs/agents/memory.md`）：
> **本文只做三件事 —— 现在是什么 / 下一步 / 指针表**；**记忆主力 = 事实系统**（文末两个 AUTO 块，
> 源 = `build/FACTS.json`），**规则 = `AGENTS.md`**（每次会话自动载入，本文不再重复抄）。
> 上一版（612 行）全文：`git show ce4f4d7:HANDOFF.md`；更早 1034 行版：`git show 76176bb:HANDOFF.md`。

## 0. 现在是什么（2026-10-04）

- **现役 8761 = 四格站点**（根目录 base + `threads/` + `w64/` + `w64-base/`；w64 档 =
  relaxed-simd FMA 版）。各档 sha 看文末 AUTO 块与 `build/FACTS.json` 的 `w64_wasm_sha`；
  最近一次全绿回归 = `build/FACTS.json` 的 `accept_suites` / `accept_pass`。
  发运入口与批次收尾动作 = `AGENTS.md`（本文件不再抄）。
- **当前活跃工作 = 分支 `wasm64-NEXT`**（性能极限冲刺）：工单 54–59 已结 —— hotpath 热点仪器、
  全负载扫描（分配器锁税 24–44%）、dlsync 补丁修复、**mimalloc 已出厂（工单 59：模式表旋钮 +
  产物探针 + 全量全绿；候选 = `build/FACTS.json` 的 `w64_cand_wasm_sha`，loop 轴 −22%）**、
  部件盘点（**部件空间基本到边**，下一块 = libm）。实验产物只进实验站，**8761 一字未动**。
  过程详单 = `HISTORY.md` §5.84/§5.86 + `build/113/NOTES-hotpath.md`；热点事实 =
  `build/FACTS.json` 的 `hotpath_top` / `hotpath_instrument_ok`（witness 档，提交时逐字复跑）。
- **拍板（2026-10-04）：三工单立项** —— **59** mimalloc 出厂批（✅ 已结案：全量 43 套全绿，
  候选可发运，**发运决策待用户**）、**60** libm 部件插件 spike（量"不改 Octave 调用点"的收益
  上限）、**61** 部件插件系统（换部件 = 一行声明，构建期替换 × 事实系统接线；Rust 优化件与
  第三方组件由此接入）。**用户两条硬约束：极其不想脱离 Octave 树**（原③ Octave 源码优化挂起，
  61 的契约写死"Octave 源码零改动"）+ **换部件不需要繁琐动作**（声明驱动，不许手设散装变量）。
- **工单台账**：未结 = 60 / 61（ready-for-agent）+ 人的动作：**工单 59 的发运决策**
  （候选全绿，走 `build/promote-w64-lane.sh`）、票 12 真机手测（等生产部署）、
  票 38 页面资产上站（走 `build/promote-pages.sh`）、E6 图形线（embed 页 GL 纹理边界）。

## 1. 下一步（按此顺序）

1. **发运决策（工单 59 的产品决定，待用户拍板）**：mimalloc 候选已全绿
   （`build/FACTS.json` 键组 `w64_cand_*`；全量与现役逐数一致，含 `accept-dldfcn`；
   loop 轴 −22%）。发运 ⇒ `build/promote-w64-lane.sh` → 8761 全量复扫 + 台账重测；
   不发 ⇒ 候选留档（零成本）。每批照 `AGENTS.md` 的批次收尾走；★ 换产物的批次进件前
   必须跑一次 `PROBES=1` 全量（本候选已跑：`sweep-logs/20261004-140751`）。
2. **工单 60（libm 插件 spike）**：先造结算件（`bench-libm-spike.sh` 单向量微基准），
   量插件边界内上限；≥1/3 热点压降才注册插件，否则如实否决。
3. **工单 61（部件插件契约）**：设计稿 + `plugin-check` 闸门（吸收 59 的旋钮经验：
   MALLOC 就是"模式表声明 + declared 标签 + 产物探针"的样板）。
4. 外部依赖到位时：票 38 上站 / 票 12 真机手测（清单 = `docs/manual-test-checklist.md`）。

## 2. 指针表（哪类知识住哪；规约 = `docs/agents/memory.md`）

| 要找什么 | 去哪 |
|---|---|
| 铁律 / 闸门 / 批次收尾 / 硬坑 / 操作纪律 | `AGENTS.md`（自动载入；唯一权威，本文不重复） |
| 测出来的数字 | 文末 AUTO:FACTS / AUTO:STATE（机器块）；源 = `build/FACTS.json`（正文只写键引用） |
| 批次过程 / 事故 / 翻案 | `HISTORY.md` §5.x（append-only） |
| 未结案的问题 | `.scratch/open-questions/issues/NN-*.md`（本地 tracker；规约 `docs/agents/issue-tracker.md`） |
| 机制推断 / 为什么 | `build/113/NOTES-{jspi,threads,webgl,wasm64,hotpath}.md` |
| 被推翻的断言 | `build/lib/retractions.json`（重现即红） |
| 术语 | `CONTEXT.md` |
| 事实系统 / 记忆架构 | `docs/agents/fact-system.md` / `docs/agents/memory.md` |
| 嵌入接口（UI 方开工包） | `docs/embed-api.md`；真机手测清单 = `docs/manual-test-checklist.md` |
| 当前工作令 | `build/113/PLAN-arch.md` §0.5 |

---

## 附 · 机器维护的区块（**自动生成，别手改**）

### 实测事实台账（**活状态文档里数字的唯一产地**）

<!-- AUTO:FACTS -->
> 本区块由 `build/facts.py --render-doc HANDOFF.md` 从 `build/FACTS.json` 渲染，**不要手改**（pre-commit 会重算并 `git add`）。
> **活状态文档里的「测出来的数字」只在这里生产**：正文要引用就写 `build/FACTS.json` 的键名（例如 `wasm_v128`），别手抄数字。
> `.githooks/check-facts.py` 三条规则：块必须与台账一致 / 正文不许出现裸数字 / 引用的键必须存在。

| 键 | 值 | 复跑命令 | 测于 |
|---|---|---|---|
| `accept_pass` | **1084**（最近一次**全绿**扫描的 PASS 合计） | `同上，把每个套件的 PASS 相加` | 2026-10-04T14:32:09+0800 |
| `accept_suites` | **43** | `数 /mnt/hdd/octave-wasm-build/sweep-logs/20261004-140751 里带汇总行的套件（且 0 FAIL）` | 2026-10-04T14:32:09+0800 |
| `build_json_sha` | `d953d7a7929754be…` | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.build.json \| cut -d' ' -f1` | 2026-10-04T14:32:09+0800 |
| `data_sha` | `f250530ae5abe378…` | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.data \| cut -d' ' -f1` | 2026-10-04T14:32:09+0800 |
| `dist_lane_probe_fail` | **0** | `同上` | 2026-10-04T14:32:10+0800 |
| `dist_lane_probe_pass` | **33**（交付包**内部**的四格选档通过数（不只是字节相同）） | `cd <dist 包目录> && python3 serve.py 8788；再 SITE_DIR=<dist 包目录> sh build/sweep.sh http://127.0.0.1:8788/ probe-lane > w64-logs/dist-probe-lane.log` | 2026-10-04T14:32:10+0800 |
| `e2_lu800_ratio` | **1.4** | `上面两行的比值（车道 / E2）` | 2026-10-04T14:32:10+0800 |
| `e2_lu800_s` | **0.043** | `同 E2 那一行` | 2026-10-04T14:32:10+0800 |
| `e2_matmul500_ratio` | **1.9** | `上面两行的比值（车道 / E2）` | 2026-10-04T14:32:10+0800 |
| `e2_matmul500_s` | **0.021** | `E2 单线程站点跑 bench-core.mjs（见 NOTES 的 A/B 表）` | 2026-10-04T14:32:10+0800 |
| `e2_single_verdict` | **ok** | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/e2-artifacts/single/octave.build.json）` | 2026-10-04T14:32:10+0800 |
| `e2_single_wasm_bytes` | **29495868** | `stat -c %s /mnt/hdd/octave-wasm-build/e2-artifacts/single/octave.wasm` | 2026-10-04T14:32:10+0800 |
| `e2_single_wasm_sha` | `e570905ecc8927bf…` | `sha256sum /mnt/hdd/octave-wasm-build/e2-artifacts/single/octave.wasm \| cut -d' ' -f1` | 2026-10-04T14:32:10+0800 |
| `e2_threaded_lu800_s` | **0.02** | `同上` | 2026-10-04T14:32:10+0800 |
| `e2_threaded_matmul500_ratio` | **6.7** | `车道 / 线程版（派生）` | 2026-10-04T14:32:10+0800 |
| `e2_threaded_matmul500_s` | **0.006** | `E2 线程版站点跑 bench-core.mjs（该轮 300s 超时收尾，只到前几项）` | 2026-10-04T14:32:10+0800 |
| `e2_threaded_oct_rc` | **124** | `timeout 600 sh test/browser/run.sh ...accept-113-oct.mjs <E2 线程版站点>; echo $?` | 2026-10-04T14:32:10+0800 |
| `e2_threaded_verdict` | **ok** | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/e2-artifacts/threaded/octave.build.json）` | 2026-10-04T14:32:10+0800 |
| `e2_threaded_wasm_bytes` | **29908917** | `stat -c %s /mnt/hdd/octave-wasm-build/e2-artifacts/threaded/octave.wasm` | 2026-10-04T14:32:10+0800 |
| `e2_threaded_wasm_sha` | `bce7e4cc252d6481…` | `sha256sum /mnt/hdd/octave-wasm-build/e2-artifacts/threaded/octave.wasm \| cut -d' ' -f1` | 2026-10-04T14:32:10+0800 |
| `env_vars` | **31** | `grep -oE '\$\{[A-Za-z0-9_]+:[-+]' /mnt/hdd/zcode-projects/Octave-Full-Wasm/build/113/link-web.sh \| sort -u（去掉位置参数）` | 2026-10-04T14:32:09+0800 |
| `exported_functions` | **710**（M2 保活集大小（M1 约 44987）） | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.exported_functions` | 2026-10-04T14:32:09+0800 |
| `floor_matrix_engines` | **4**（跑过的引擎：Chromium 154 / Chromium 125 / Firefox / WebKit（2026-10-01 实测）） | `数 w64-logs/floor-*.log 里 `· ① 页面 ready` 判据行的引擎名（去重）` | 2026-10-04T14:32:10+0800 |
| `floor_matrix_fail` | **0**（必须 0；含「无 memory64 的引擎必须落 threads」这条反向断言） | `同上` | 2026-10-04T14:32:10+0800 |
| `floor_matrix_pass` | **16** | `同上（各日志结尾的 `=== N PASS / M FAIL ===` 求和）` | 2026-10-04T14:32:10+0800 |
| `fonts_count` | **8** | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.fonts` | 2026-10-04T14:32:09+0800 |
| `hotpath_instrument_ok` | **ok**（仪器健康（I2）：符号版有名字、strip 版只有索引 —— 先用已知热夹具证明仪器看得见名字，再信任热点数字（照 calibrate 档的规矩）。） | `python3 build/113/hotpath.py calibrate` | 2026-10-04T14:32:10+0800 |
| `hotpath_top` | **long long octave::idx_vector::fill<double>(double const&, long long, double*) const 91.0%**（仪器热点的 top（lane=w64 kind=cpu 采样 1959 个；未归因 0.0%）） | `读 /mnt/hdd/octave-wasm-build/hotpath-logs/20261003-233918/report.json 的 hotspots[0]（重活 ⇒ 不逐字复跑）` | 2026-10-04T14:32:10+0800 |
| `js_sha` | `caac68bf62015859…` | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.js \| cut -d' ' -f1` | 2026-10-04T14:32:09+0800 |
| `jspi_entry` | 是（B 姿势的可挂起入口在不在） | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.jspi_entry` | 2026-10-04T14:32:09+0800 |
| `lane_lu800_s` | **0.06** | `同车道那一行` | 2026-10-04T14:32:10+0800 |
| `lane_matmul500_s` | **0.04** | `现役车道站点跑同一个 bench-core.mjs` | 2026-10-04T14:32:10+0800 |
| `matrix_page_sha` | `54a7e1c261a2df2f…` | `sha256sum /mnt/hdd/octave-wasm-build/site/matrix-android.html \| cut -d' ' -f1` | 2026-10-04T14:32:09+0800 |
| `mem_live_ceiling_gib` | **7.45**（逐块 0.75 GiB 吃到 OOM 的**存活上限**（四档实测同为 1.49 GiB）） | `HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/probe-heap-ceiling.mjs http://127.0.0.1:8761/ > w64-logs/heap-ceiling.log` | 2026-10-04T14:32:10+0800 |
| `native_netlib_loop1e6_s` | **0.500141**（netlib 参考实现的 loop1e6（用户手里的原生 Octave；机器空闲时跑，重活 ⇒ replay 豁免）） | `sh build/113/bench-native.sh` | 2026-10-04T14:32:10+0800 |
| `native_netlib_lu1500_s` | **0.25765**（netlib 参考实现的 lu1500（用户手里的原生 Octave；机器空闲时跑，重活 ⇒ replay 豁免）） | `sh build/113/bench-native.sh` | 2026-10-04T14:32:10+0800 |
| `native_netlib_lu800_s` | **0.04076**（netlib 参考实现的 lu800（用户手里的原生 Octave；机器空闲时跑，重活 ⇒ replay 豁免）） | `sh build/113/bench-native.sh` | 2026-10-04T14:32:10+0800 |
| `native_netlib_matmul1000_s` | **0.196202**（netlib 参考实现的 matmul1000（用户手里的原生 Octave；机器空闲时跑，重活 ⇒ replay 豁免）） | `sh build/113/bench-native.sh` | 2026-10-04T14:32:10+0800 |
| `native_netlib_matmul500_s` | **0.027249**（系统默认 BLAS（netlib 参考实现，单线程）的 matmul 500² —— 用户手里的原生 Octave） | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` | 2026-10-04T14:32:10+0800 |
| `native_openblas_lu1500_s` | **0.040473**（原生天花板（OpenBLAS 0.3.34 pthread）的 lu1500 中位数；机器空闲时跑，重活 ⇒ replay 豁免） | `sh build/113/bench-native.sh` | 2026-10-04T14:32:10+0800 |
| `native_openblas_lu800_s` | **0.026146**（原生天花板（OpenBLAS 0.3.34 pthread）的 lu800 中位数） | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` | 2026-10-04T14:32:10+0800 |
| `native_openblas_matmul1000_s` | **0.009586**（原生天花板（OpenBLAS 0.3.34 pthread）的 matmul1000 中位数；机器空闲时跑，重活 ⇒ replay 豁免） | `sh build/113/bench-native.sh` | 2026-10-04T14:32:10+0800 |
| `native_openblas_matmul1024_s` | **0.008517**（原生天花板（OpenBLAS 0.3.34 pthread）的 matmul1024 中位数） | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` | 2026-10-04T14:32:10+0800 |
| `native_openblas_matmul2000_s` | **0.050018**（原生天花板（OpenBLAS 0.3.34 pthread）的 matmul2000 中位数） | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` | 2026-10-04T14:32:10+0800 |
| `native_openblas_matmul500_s` | **0.003212**（原生天花板（OpenBLAS 0.3.34 pthread）的 matmul500 中位数） | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` | 2026-10-04T14:32:10+0800 |
| `native_openblas_threads` | **24**（天花板后端的线程数（占比口径的一部分，必须如实记录）） | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` | 2026-10-04T14:32:10+0800 |
| `oct_base_files` | **16**（基础档 `assets/oct/` 条数） | `find /mnt/hdd/octave-wasm-build/site/assets/oct -name '*.oct' \| wc -l` | 2026-10-04T14:32:09+0800 |
| `oct_lane_files` | **16**（线程档 `assets/oct-threads/` 条数） | `find /mnt/hdd/octave-wasm-build/site/assets/oct-threads -name '*.oct' \| wc -l` | 2026-10-04T14:32:09+0800 |
| `oct_lane_octdir_files` | **28**（线程档 `assets/octdir-threads/` 条数） | `find /mnt/hdd/octave-wasm-build/site/assets/octdir-threads -name '*.oct' \| wc -l` | 2026-10-04T14:32:09+0800 |
| `oct_lane_tls_init` | **44**（每个都必须有（没有在线程档里 dlopen 会 tlsInitFunc 不是函数）；分母见 oct_lane_files + oct_lane_octdir_files） | `python3 build/113/check-oct-lane.py <站点>/assets/oct-threads <站点>/assets/octdir-threads --base <站点>/assets/oct <站点>/assets/octdir` | 2026-10-04T14:32:09+0800 |
| `octdir_base_files` | **28**（基础档 `assets/octdir/` 条数） | `find /mnt/hdd/octave-wasm-build/site/assets/octdir -name '*.oct' \| wc -l` | 2026-10-04T14:32:09+0800 |
| `probe_lane_fail` | **0** | `同上（脚本结尾的 `=== N PASS / M FAIL ===`）` | 2026-10-04T14:32:10+0800 |
| `probe_lane_pass` | **33**（选档探针的 PASS 数（FAIL 必须 0）；站点四格/双档不同 ⇒ 看 cmd 的 SITE_DIR） | `SITE_DIR=<站点> sh test/browser/run.sh test/browser/probe-lane.mjs > /mnt/hdd/octave-wasm-build/probe-lane.log` | 2026-10-04T14:32:10+0800 |
| `threads_blas_dir` | **/src/work/e2-openblas-lib-s**（**必须含 `-threads`**（判据见 check-build-manifest.lane_blas_problem）） | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 inputs.blas.resolved_dir` | 2026-10-04T14:32:09+0800 |
| `threads_exported_functions` | **725** | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 measured.exported_functions` | 2026-10-04T14:32:09+0800 |
| `threads_pthread_glue` | **54**（基础档实测是 0） | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 measured.threads.pthread_glue` | 2026-10-04T14:32:09+0800 |
| `threads_shared_memory` | 是（wasm 内存段的 shared 位；线程档的硬身份） | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 measured.threads.shared_memory` | 2026-10-04T14:32:09+0800 |
| `threads_v128` | **4926**（线程档也带 SIMD（两轴不互斥）） | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 measured.simd.v128` | 2026-10-04T14:32:09+0800 |
| `threads_verdict` | **ok**（只有 ok 才可部署（fail-closed）） | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 verdict` | 2026-10-04T14:32:09+0800 |
| `threads_wasm_bytes` | **29495868** | `stat -c%s /mnt/hdd/octave-wasm-build/site/threads/octave.wasm` | 2026-10-04T14:32:09+0800 |
| `threads_wasm_sha` | `e570905ecc8927bf…` | `sha256sum /mnt/hdd/octave-wasm-build/site/threads/octave.wasm \| cut -d' ' -f1` | 2026-10-04T14:32:09+0800 |
| `w64_base_shared_memory` | 否（单线程回退档：**不**是 shared（这是它与 w64 的分界）） | `读 /mnt/hdd/octave-wasm-build/w64-base-artifacts 的 measured.threads.shared_memory` | 2026-10-04T14:32:10+0800 |
| `w64_base_verdict` | **ok** | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/w64-base-artifacts/octave.build.json）` | 2026-10-04T14:32:10+0800 |
| `w64_base_wasm64` | 是（回退档也必须是真 64 位（否则它回退的是**另一个 ABI**，不是同一档）） | `读 /mnt/hdd/octave-wasm-build/w64-base-artifacts 的 measured.wasm64` | 2026-10-04T14:32:10+0800 |
| `w64_base_wasm_bytes` | **29935634** | `stat -c %s /mnt/hdd/octave-wasm-build/w64-base-artifacts/octave.wasm` | 2026-10-04T14:32:10+0800 |
| `w64_base_wasm_sha` | `091c350054111b96…` | `sha256sum /mnt/hdd/octave-wasm-build/w64-base-artifacts/octave.wasm \| cut -d' ' -f1` | 2026-10-04T14:32:10+0800 |
| `w64_big_heap` | 是（工单 31 的结算判据：抬了 MAXIMUM_MEMORY 之后必须变 yes） | `同上（探针结尾的 `W64_BIG_HEAP=` 行）` | 2026-10-04T14:32:10+0800 |
| `w64_build_recipe_ok` | **ok**（构建**输入**的不变式（配方层）：link-web.sh 无 -flto / 含 -fwasm-exceptions；w64 车道含 -sMEMORY64=1。把「输入」也当事实，由同一批复跑闸门核对 ——由同一批复跑闸门每提交核对。） | `python3 build/113/witness-build-inputs.py` | 2026-10-04T14:32:10+0800 |
| `w64_build_tool_match` | **match**（贵事实的便宜见证：部署件记录的构建脚本 sha 必须 == 仓库现役脚本。做不到就 DRIFT（来源漂移）。注意**旧档**（base/threads/w64-base）建造时间不同、记录 sha 各异 ⇒ 只对活跃迭代并每批重链的 w64 档断言。） | `<重链 w64 后：python3 build/113/witness-build-provenance.py w64>` | 2026-10-04T14:32:10+0800 |
| `w64_cand_exported_functions` | **751** | `读 /mnt/hdd/octave-wasm-build/w64-artifacts-mimalloc 的 measured.exported_functions` | 2026-10-04T14:32:10+0800 |
| `w64_cand_loop1e6_s` | **0.574**（候选的纯解释器轴（分配器不该动它 —— 诚实记录，防「把好数字全记在头上」）） | `同上（loop 1e6）` | 2026-10-04T14:32:10+0800 |
| `w64_cand_lu800_s` | **0.014**（候选（mimalloc）产品级 lu(800)） | `同上（lu 800）` | 2026-10-04T14:32:10+0800 |
| `w64_cand_malloc` | **mimalloc**（分配器（产物探针 = 导出段里的 mi_version；工单 59；mimalloc 工单 57 实测 −27%）） | `读 /mnt/hdd/octave-wasm-build/w64-artifacts-mimalloc 的 declared.malloc / measured.malloc` | 2026-10-04T14:32:10+0800 |
| `w64_cand_matmul500_s` | **0.005**（候选（mimalloc，工单 59）产品级 matmul 500²；与现役的同窗配对见 w64_cand_vs_ship_*） | `<交错 3 轮取中位：HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/bench-lanes.mjs http://127.0.0.1:8861/ w64（×3 ⇒ w64-logs/bench-mi2-r1..3.log）>` | 2026-10-04T14:32:10+0800 |
| `w64_cand_verdict` | **ok**（候选产物：verdict=ok + 全量验收全绿 ⇒ 可发运（发运=产品决定）） | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/w64-artifacts-mimalloc/octave.build.json）` | 2026-10-04T14:32:10+0800 |
| `w64_cand_vs_ship_lu800` | **1.0**（候选/现役 的 lu800 比值） | `派生：同上（lu 800）` | 2026-10-04T14:32:10+0800 |
| `w64_cand_vs_ship_matmul500` | **1.25**（候选/现役 的 matmul500 比值（<1 = 候选更快；同窗配对，不是跨窗对比）） | `派生：w64-logs/bench-mi2-r1..3.log 的中位 ÷ bench-ship2-r1..3.log 的中位` | 2026-10-04T14:32:10+0800 |
| `w64_cand_wasm_bytes` | **30984954** | `stat -c %s /mnt/hdd/octave-wasm-build/w64-artifacts-mimalloc/octave.wasm` | 2026-10-04T14:32:10+0800 |
| `w64_cand_wasm_sha` | `01fb52fc3b5dde30…` | `sha256sum /mnt/hdd/octave-wasm-build/w64-artifacts-mimalloc/octave.wasm \| cut -d' ' -f1` | 2026-10-04T14:32:10+0800 |
| `w64_exported_functions` | **735** | `读 /mnt/hdd/octave-wasm-build/w64-artifacts 的 measured.exported_functions` | 2026-10-04T14:32:10+0800 |
| `w64_i64_insns` | **4175689**（64 位的指令层证据（wasm32 版为 0）） | `llvm-objdump -d <w64>/octave.wasm \| grep -c i64（由 build/113/build-w64-lane.sh facts 写出，容器内跑）` | 2026-10-04T14:32:10+0800 |
| `w64_lu800_s` | **0.079**（w64 档 lu(800)：比 base 慢约 1.3×） | `HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/bench-lanes.mjs http://127.0.0.1:8761/ w64 > w64-logs/speed-w64.log` | 2026-10-04T14:32:10+0800 |
| `w64_matmul500_s` | **0.048**（w64 档矩阵乘 500²：比 base 慢约 1.2×（i64 指针/索引的代价）） | `HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/bench-lanes.mjs http://127.0.0.1:8761/ w64 > w64-logs/speed-w64.log` | 2026-10-04T14:32:10+0800 |
| `w64_mem_5g_bytes` | **5242880000**（单线程 memory64 分配 80000 页（非 COI 页，buffer 是 ArrayBuffer）） | `sh test/browser/run.sh test/browser/probe-wasm64-mem.mjs > /mnt/hdd/octave-wasm-build/w64-logs/mem-probe.log` | 2026-10-04T14:32:10+0800 |
| `w64_mem_8g_bytes` | **8589934592**（单线程 memory64 分配 131072 页） | `sh test/browser/run.sh test/browser/probe-wasm64-mem.mjs > /mnt/hdd/octave-wasm-build/w64-logs/mem-probe.log` | 2026-10-04T14:32:10+0800 |
| `w64_mem_probe_fail` | **0**（内存探针 FAIL 数（必须 0；含 wasm32 上限 / index 陷阱 / BigInt 三条反证）） | `同上（脚本结尾的 `=== N PASS / M FAIL ===`）` | 2026-10-04T14:32:10+0800 |
| `w64_mem_shared_5g_bytes` | **5242880000**（COI 页 shared memory64 分配 80000 页（buffer 是 SharedArrayBuffer）） | `sh test/browser/run.sh test/browser/probe-wasm64-mem.mjs > /mnt/hdd/octave-wasm-build/w64-logs/mem-probe.log` | 2026-10-04T14:32:10+0800 |
| `w64_ob_lib_wasm32_members` | **0**（必须是 0（side module 的指针宽度必须与主模块一致）） | `同上` | 2026-10-04T14:32:10+0800 |
| `w64_ob_lib_wasm64_members` | **1557**（w64 车道线程版 OpenBLAS 归档里 wasm64 成员数） | `E2_LANE=w64 docker exec o113 bash /src/bin/build-e2-lane.sh src patch build > w64-logs/e2-w64-build.log（读那行架构断言）` | 2026-10-04T14:32:10+0800 |
| `w64_ob_lu800_s` | **0.014**（现役 w64（线程版 OpenBLAS NT=8）的 lu(800) 中位数） | `同上（8761 现役那轮）` | 2026-10-04T14:32:10+0800 |
| `w64_ob_matmul1000_native_ratio` | **0.38**（浏览器 w64 matmul1000 占原生天花板的比值（大矩阵是最吃线程的刻度）） | `派生：native-baseline.json 的 openblas24.matmul1000 ÷ bench-ob-w64.log 的 matmul 1000` | 2026-10-04T14:32:10+0800 |
| `w64_ob_matmul500_native_ratio` | **1.07**（浏览器 w64 占原生天花板的比值（占比仪表盘的表头）） | `派生：w64-logs/native-baseline.json 的 openblas24.matmul500 ÷ w64-logs/bench-ob-w64.log 的 matmul 500` | 2026-10-04T14:32:10+0800 |
| `w64_ob_matmul500_s` | **0.003**（现役 w64（线程版 OpenBLAS NT=8，2026-10-02 上站）的矩阵乘 500² 中位数） | `HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/bench-lanes.mjs http://127.0.0.1:8761/ w64 > w64-logs/bench-ob-w64.log` | 2026-10-04T14:32:10+0800 |
| `w64_ob_matmul500_speedup` | **15.3**（OpenBLAS 版相对 refblas 版 w64 的加速倍数（历史对照：refblas 的现役地位已由 2026-10-02 NT=8 批取代）） | `派生：w64-logs/bench-ship-w64.log 的 matmul 500 ÷ w64-logs/bench-ob-w64.log 的同项` | 2026-10-04T14:32:10+0800 |
| `w64_ob_matmul500_vs_netlib` | **9.1**（浏览器 w64 相对『系统默认 BLAS 的原生 Octave』的倍数） | `派生：w64-logs/native-baseline.json 的 netlib.matmul500 ÷ w64-logs/bench-ob-w64.log 的 matmul 500` | 2026-10-04T14:32:10+0800 |
| `w64_oct_files` | **46**（车道 `.oct` 总数） | `同上（文件名：oct-wasm64.txt 的第二个数）` | 2026-10-04T14:32:10+0800 |
| `w64_oct_wasm64` | **46**（`.oct` 车道里 wasm64 的个数（side module 的指针宽度必须与主模块一致）） | `bash build-w64-lane.sh facts（容器内；用 /emsdk/upstream/bin/llvm-readobj 逐个量）` | 2026-10-04T14:32:10+0800 |
| `w64_relaxed_madd` | **47**（relaxed-simd FMA 指令数（工单 52）。⚠ 量法本身有生命周期：`grep relaxed_madd` 是**被证伪的量法**（见 build/instruments.json）——本键的 cmd 已避开它（字节级）。calibrate= 用已知含它的样本自证。） | `<重活：产物 + test/fixtures/relaxed_madd_min.wasm 各数 fd 87 02>` | 2026-10-04T14:32:10+0800 |
| `w64_shared_memory` | 是（目标形态 = memory64 **+ 多线程**（shared 是这个轴的硬身份）） | `读 /mnt/hdd/octave-wasm-build/w64-artifacts 的 measured.threads.shared_memory` | 2026-10-04T14:32:10+0800 |
| `w64_v128` | **6582** | `读 /mnt/hdd/octave-wasm-build/w64-artifacts 的 measured.simd.v128` | 2026-10-04T14:32:10+0800 |
| `w64_verdict` | **ok**（只有 ok 才可部署（fail-closed）） | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/w64-artifacts/octave.build.json）` | 2026-10-04T14:32:10+0800 |
| `w64_vs_netlib_loop1e6` | **0.67**（浏览器解释器循环相对原生的比值（<1 = 浏览器慢 —— 纯解释器轴是唯一明确输的）） | `派生：native-baseline.json 的 netlib.loop1e6 ÷ bench-ob-w64.log 的 loop 1e6` | 2026-10-04T14:32:10+0800 |
| `w64_vs_netlib_lu1500` | **3.8**（浏览器 w64 lu1500 相对『用户手里的原生 Octave』的倍数） | `派生：native-baseline.json 的 netlib.lu1500 ÷ bench-ob-w64.log 的 lu 1500` | 2026-10-04T14:32:10+0800 |
| `w64_vs_netlib_matmul1000` | **7.8**（浏览器 w64 matmul1000 相对『用户手里的原生 Octave』的倍数） | `派生：native-baseline.json 的 netlib.matmul1000 ÷ bench-ob-w64.log 的 matmul 1000` | 2026-10-04T14:32:10+0800 |
| `w64_wasm64` | 是（wasm 内存段 limits flags bit2 = 1 ⇒ 真 64 位） | `读 /mnt/hdd/octave-wasm-build/w64-artifacts 的 measured.wasm64` | 2026-10-04T14:32:10+0800 |
| `w64_wasm_bytes` | **30916734** | `stat -c %s /mnt/hdd/octave-wasm-build/w64-artifacts/octave.wasm` | 2026-10-04T14:32:10+0800 |
| `w64_wasm_sha` | `5b5bb98122ba9860…` | `sha256sum /mnt/hdd/octave-wasm-build/w64-artifacts/octave.wasm \| cut -d' ' -f1` | 2026-10-04T14:32:10+0800 |
| `wasm_bytes` | **29632229** | `stat -c%s /mnt/hdd/octave-wasm-build/site/octave.wasm` | 2026-10-04T14:32:09+0800 |
| `wasm_sha` | `1ed3e528561e4475…` | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.wasm \| cut -d' ' -f1` | 2026-10-04T14:32:09+0800 |
| `wasm_v128` | **4752**（SIMD 判据；非 SIMD 那版是 0） | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.simd.v128` | 2026-10-04T14:32:09+0800 |

台账生成时间 `2026-10-04T14:32:10+0800`；每条的值/出处/复跑命令都在 `build/FACTS.json` 里。
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
| 最近一次**全绿**回归 | `20261004-140751` · **43 套 / 1,084 PASS / 0 FAIL**（同日 PROBES=1 另跑：探针 30 套 / 274 PASS、基准 3 套（按契约无汇总行）） | http://127.0.0.1:8861/ |
| 交付包 | `octave-full-wasm-site-20261003` · tar.zst 91,240,236 B · `c5065cd1c26bc968…` | 包内 wasm （**与部署件同 sha** ✓） |
| 仓库 | 分支 `wasm64-NEXT`（**HEAD 的 sha 与日期以 `git log -1` 为准，不写死在这里**） | |
<!-- /AUTO:STATE -->
