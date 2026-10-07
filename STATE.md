# STATE · 活状态

正文只写「现在是什么」，**数字一律引用 `build/FACTS.json` 的键**（或看文末机器块）。
方向与地图在 `maintaince.md`；硬规矩在 `AGENTS.md`；历史在 `HISTORY.md`（append-only）。

## 现在是什么（2026-10-05）

- **现役 8761 = 四格站点**（根目录 base + `threads/` + `w64/` + `w64-base/`；w64 档 =
  relaxed-simd FMA **+ mimalloc** 版，工单 59 已发运）。各档 sha 看文末 AUTO 块与
  `build/FACTS.json` 的 `w64_wasm_sha`；最近一次全绿回归 = `accept_suites` / `accept_pass`。
  发运入口与批次收尾 = `AGENTS.md`。
- **上游架构已接入**（`upstream/` 18 个浅 submodule + `build/upstream-lock.json`）：
  5 fork 的 wasm 补丁分支（octave `wasm/11.3.0` @ `build/FACTS.json` 的 `octave_pin`、
  openblas `wasm-e2`、gl4es `wasm`、rapidjson `wasm/1.1.0`；suitesparse 对官方 tag 零差异）
  + 13 直连 tag。供给 = `build/provision-upstream.sh`；一致性 = `witness-upstream-pin.py`
  （容器树 == pin，每提交核对）。升级 SOP = `build/113/NOTES-upstream.md`。
- **性能线结论**：插件可达部件空间实测封口——现役两插件（e2-openblas / mimalloc）即全部；
  libm 标量替换负判决（wasm 无标量 FMA，`build/113/NOTES-libm.md`）；热点余下部分全在
  Octave 自身源码（`build/113/NOTES-hotpath.md`）。
- **Rust 补丁线（工单 63）**：事实覆盖矩阵定稿（grill 九问全部事实化）；G2 差分门 +
  G2b 变异自证建成自证合格；候选② idx fill 否决（带宽绑定）；**候选③ sort 内核
  ADOPT——Rust driftsort 4× 于 octave_sort timsort**（`rust_sort_spike_ratio`=0.249，
  语义差分 22 域逐位一致）。**下一步 = 树补丁打样**（Array-base.cc 宏体分派 +
  增量 relink + sort 负载 A/B）。
- **工单 62 已结案（2026-10-05）**：ccache 假说被 equiv2 对照推翻（R-014）；真根因 =
  `f77-fcn.h` 未收编手改（`F77_CHAR_ARG_LEN_TYPE` wasm64→int），已按处方收编 fork
  `wasm/11.3.0`（octave_pin 指新提交）；equiv3 确认供给树 rebuild 可复现——1 条容忍
  mismatch + wasm-opt 绿 + `verdict=ok`。**上游升级 SOP 解锁**（emcc6 仍不立项）。
  供给树是 pin 管辖物，改动只有 fork commit 一条路（过程插曲见 HISTORY §5.89）。
- **8761 在 promote 之前一字未动**；FMA 版备份 =
  `/mnt/hdd/octave-wasm-build/w64-artifacts-fma-backup-20261004/`。
- **人的动作**（外部依赖）：票 38 页面资产上站（`build/promote-pages.sh`）、票 12 真机手测
  （清单 `docs/manual-test-checklist.md`）、E6 图形线（embed 页 GL 纹理边界）。
- **Einfacht 反哺（暗线持续推进）**：PR #11（check_pins + check_locks）**已并**（76ff1f5）；
  **PR #12（check_ab，A/B 同旗标）已并**（dfd8af8）——上游并后抓到我一处真 bug
  （check_ab 缺 `__main__` 入口 ⇒ 直接跑静默退 0）并修之（ef14f67），已同步本地
  main 并验证全绿；本仓 tools 教训：**所有可执行闸门脚本必须显式 __main__ 入口**。
  量法登记 3 条（含被证伪的排序基准法）。

## 附 · 机器维护的区块（**自动生成，别手改**）

### 实测事实台账（**活状态文档里数字的唯一产地**）

<!-- AUTO:FACTS -->
> 本区块由 `build/facts.py --render-doc HANDOFF.md` 从 `build/FACTS.json` 渲染，**不要手改**（pre-commit 会重算并 `git add`）。
> **活状态文档里的「测出来的数字」只在这里生产**：正文要引用就写 `build/FACTS.json` 的键名（例如 `wasm_v128`），别手抄数字。
> `.githooks/check-facts.py` 三条规则：块必须与台账一致 / 正文不许出现裸数字 / 引用的键必须存在。

| 键 | 值 | 复跑命令 | 测于 |
|---|---|---|---|
| `accept_pass` | **1084**（最近一次**全绿**扫描的 PASS 合计） | `同上，把每个套件的 PASS 相加` | 2026-10-05T10:19:08+0800 |
| `accept_suites` | **43** | `数 /mnt/hdd/octave-wasm-build/sweep-logs/20261004-163145 里带汇总行的套件（且 0 FAIL）` | 2026-10-05T10:19:08+0800 |
| `build_json_sha` | `d953d7a7929754be…` | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.build.json \| cut -d' ' -f1` | 2026-10-05T10:19:08+0800 |
| `data_sha` | `f250530ae5abe378…` | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.data \| cut -d' ' -f1` | 2026-10-05T10:19:08+0800 |
| `dist_lane_probe_fail` | **0** | `同上` | 2026-10-05T10:19:08+0800 |
| `dist_lane_probe_pass` | **33**（交付包**内部**的四格选档通过数（不只是字节相同）） | `cd <dist 包目录> && python3 serve.py 8788；再 SITE_DIR=<dist 包目录> sh build/sweep.sh http://127.0.0.1:8788/ probe-lane > w64-logs/dist-probe-lane.log` | 2026-10-05T10:19:08+0800 |
| `e2_lu800_ratio` | **1.4** | `上面两行的比值（车道 / E2）` | 2026-10-05T10:19:08+0800 |
| `e2_lu800_s` | **0.043** | `同 E2 那一行` | 2026-10-05T10:19:08+0800 |
| `e2_matmul500_ratio` | **1.9** | `上面两行的比值（车道 / E2）` | 2026-10-05T10:19:08+0800 |
| `e2_matmul500_s` | **0.021** | `E2 单线程站点跑 bench-core.mjs（见 NOTES 的 A/B 表）` | 2026-10-05T10:19:08+0800 |
| `e2_single_verdict` | **ok** | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/e2-artifacts/single/octave.build.json）` | 2026-10-05T10:19:08+0800 |
| `e2_single_wasm_bytes` | **29495868** | `stat -c %s /mnt/hdd/octave-wasm-build/e2-artifacts/single/octave.wasm` | 2026-10-05T10:19:08+0800 |
| `e2_single_wasm_sha` | `e570905ecc8927bf…` | `sha256sum /mnt/hdd/octave-wasm-build/e2-artifacts/single/octave.wasm \| cut -d' ' -f1` | 2026-10-05T10:19:08+0800 |
| `e2_threaded_lu800_s` | **0.02** | `同上` | 2026-10-05T10:19:08+0800 |
| `e2_threaded_matmul500_ratio` | **6.7** | `车道 / 线程版（派生）` | 2026-10-05T10:19:08+0800 |
| `e2_threaded_matmul500_s` | **0.006** | `E2 线程版站点跑 bench-core.mjs（该轮 300s 超时收尾，只到前几项）` | 2026-10-05T10:19:08+0800 |
| `e2_threaded_oct_rc` | **124** | `timeout 600 sh test/browser/run.sh ...accept-113-oct.mjs <E2 线程版站点>; echo $?` | 2026-10-05T10:19:08+0800 |
| `e2_threaded_verdict` | **ok** | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/e2-artifacts/threaded/octave.build.json）` | 2026-10-05T10:19:08+0800 |
| `e2_threaded_wasm_bytes` | **29908917** | `stat -c %s /mnt/hdd/octave-wasm-build/e2-artifacts/threaded/octave.wasm` | 2026-10-05T10:19:08+0800 |
| `e2_threaded_wasm_sha` | `bce7e4cc252d6481…` | `sha256sum /mnt/hdd/octave-wasm-build/e2-artifacts/threaded/octave.wasm \| cut -d' ' -f1` | 2026-10-05T10:19:08+0800 |
| `emcc6_probe_geomean` | **1.001**（emcc 6.0.10/5.0.7 每调用几何均值（<1 = 6 更快）；实测 ≈1.00 ⇒ 工具链升级无编译器红利） | `sh test/fixtures/emcc6-probe/run-probe.sh 1（读 w64-logs/emcc6-probe.log 的 geomean 行）` | 2026-10-05T10:19:08+0800 |
| `env_vars` | **32** | `grep -oE '\$\{[A-Za-z0-9_]+:[-+]' /mnt/hdd/zcode-projects/Octave-Full-Wasm/build/113/link-web.sh \| sort -u（去掉位置参数）` | 2026-10-05T10:19:08+0800 |
| `exported_functions` | **710**（M2 保活集大小（M1 约 44987）） | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.exported_functions` | 2026-10-05T10:19:08+0800 |
| `floor_matrix_engines` | **4**（跑过的引擎：Chromium 154 / Chromium 125 / Firefox / WebKit（2026-10-01 实测）） | `数 w64-logs/floor-*.log 里 `· ① 页面 ready` 判据行的引擎名（去重）` | 2026-10-05T10:19:08+0800 |
| `floor_matrix_fail` | **0**（必须 0；含「无 memory64 的引擎必须落 threads」这条反向断言） | `同上` | 2026-10-05T10:19:08+0800 |
| `floor_matrix_pass` | **16** | `同上（各日志结尾的 `=== N PASS / M FAIL ===` 求和）` | 2026-10-05T10:19:08+0800 |
| `fonts_count` | **8** | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.fonts` | 2026-10-05T10:19:08+0800 |
| `hotpath_instrument_ok` | **ok**（仪器健康（I2）：符号版有名字、strip 版只有索引 —— 先用已知热夹具证明仪器看得见名字，再信任热点数字（照 calibrate 档的规矩）。） | `python3 build/113/hotpath.py calibrate` | 2026-10-05T10:19:08+0800 |
| `hotpath_top` | **long long octave::idx_vector::fill<double>(double const&, long long, double*) const 91.0%**（仪器热点的 top（lane=w64 kind=cpu 采样 1959 个；未归因 0.0%）） | `读 /mnt/hdd/octave-wasm-build/hotpath-logs/20261003-233918/report.json 的 hotspots[0]（重活 ⇒ 不逐字复跑）` | 2026-10-05T10:19:08+0800 |
| `js_sha` | `caac68bf62015859…` | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.js \| cut -d' ' -f1` | 2026-10-05T10:19:08+0800 |
| `jspi_entry` | 是（B 姿势的可挂起入口在不在） | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.jspi_entry` | 2026-10-05T10:19:08+0800 |
| `lane_lu800_s` | **0.06** | `同车道那一行` | 2026-10-05T10:19:08+0800 |
| `lane_matmul500_s` | **0.04** | `现役车道站点跑同一个 bench-core.mjs` | 2026-10-05T10:19:08+0800 |
| `libm_spike_geomean` | **0.964**（链接期标量 libm 替换（同源重编覆盖）的每调用几何均值；≥1.5 才值得注册插件 —— 实测 <1.0 ⇒ 负判决（wasm 无标量 FMA，见 NOTES-libm.md）） | `sh build/113/bench-libm-spike.sh 8（读 w64-logs/libm-spike-verdict.txt 的 geomean 行）` | 2026-10-05T10:19:08+0800 |
| `matrix_page_sha` | `54a7e1c261a2df2f…` | `sha256sum /mnt/hdd/octave-wasm-build/site/matrix-android.html \| cut -d' ' -f1` | 2026-10-05T10:19:08+0800 |
| `mem_live_ceiling_gib` | **7.45**（逐块 0.75 GiB 吃到 OOM 的**存活上限**（四档实测同为 1.49 GiB）） | `HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/probe-heap-ceiling.mjs http://127.0.0.1:8761/ > w64-logs/heap-ceiling.log` | 2026-10-05T10:19:08+0800 |
| `native_netlib_loop1e6_s` | **0.500141**（netlib 参考实现的 loop1e6（用户手里的原生 Octave；机器空闲时跑，重活 ⇒ replay 豁免）） | `sh build/113/bench-native.sh` | 2026-10-05T10:19:08+0800 |
| `native_netlib_lu1500_s` | **0.25765**（netlib 参考实现的 lu1500（用户手里的原生 Octave；机器空闲时跑，重活 ⇒ replay 豁免）） | `sh build/113/bench-native.sh` | 2026-10-05T10:19:08+0800 |
| `native_netlib_lu800_s` | **0.04076**（netlib 参考实现的 lu800（用户手里的原生 Octave；机器空闲时跑，重活 ⇒ replay 豁免）） | `sh build/113/bench-native.sh` | 2026-10-05T10:19:08+0800 |
| `native_netlib_matmul1000_s` | **0.196202**（netlib 参考实现的 matmul1000（用户手里的原生 Octave；机器空闲时跑，重活 ⇒ replay 豁免）） | `sh build/113/bench-native.sh` | 2026-10-05T10:19:08+0800 |
| `native_netlib_matmul500_s` | **0.027249**（系统默认 BLAS（netlib 参考实现，单线程）的 matmul 500² —— 用户手里的原生 Octave） | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` | 2026-10-05T10:19:08+0800 |
| `native_openblas_lu1500_s` | **0.040473**（原生天花板（OpenBLAS 0.3.34 pthread）的 lu1500 中位数；机器空闲时跑，重活 ⇒ replay 豁免） | `sh build/113/bench-native.sh` | 2026-10-05T10:19:08+0800 |
| `native_openblas_lu800_s` | **0.026146**（原生天花板（OpenBLAS 0.3.34 pthread）的 lu800 中位数） | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` | 2026-10-05T10:19:08+0800 |
| `native_openblas_matmul1000_s` | **0.009586**（原生天花板（OpenBLAS 0.3.34 pthread）的 matmul1000 中位数；机器空闲时跑，重活 ⇒ replay 豁免） | `sh build/113/bench-native.sh` | 2026-10-05T10:19:08+0800 |
| `native_openblas_matmul1024_s` | **0.008517**（原生天花板（OpenBLAS 0.3.34 pthread）的 matmul1024 中位数） | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` | 2026-10-05T10:19:08+0800 |
| `native_openblas_matmul2000_s` | **0.050018**（原生天花板（OpenBLAS 0.3.34 pthread）的 matmul2000 中位数） | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` | 2026-10-05T10:19:08+0800 |
| `native_openblas_matmul500_s` | **0.003212**（原生天花板（OpenBLAS 0.3.34 pthread）的 matmul500 中位数） | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` | 2026-10-05T10:19:08+0800 |
| `native_openblas_threads` | **24**（天花板后端的线程数（占比口径的一部分，必须如实记录）） | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` | 2026-10-05T10:19:08+0800 |
| `oct_base_files` | **16**（基础档 `assets/oct/` 条数） | `find /mnt/hdd/octave-wasm-build/site/assets/oct -name '*.oct' \| wc -l` | 2026-10-05T10:19:08+0800 |
| `oct_lane_files` | **16**（线程档 `assets/oct-threads/` 条数） | `find /mnt/hdd/octave-wasm-build/site/assets/oct-threads -name '*.oct' \| wc -l` | 2026-10-05T10:19:08+0800 |
| `oct_lane_octdir_files` | **28**（线程档 `assets/octdir-threads/` 条数） | `find /mnt/hdd/octave-wasm-build/site/assets/octdir-threads -name '*.oct' \| wc -l` | 2026-10-05T10:19:08+0800 |
| `oct_lane_tls_init` | **44**（每个都必须有（没有在线程档里 dlopen 会 tlsInitFunc 不是函数）；分母见 oct_lane_files + oct_lane_octdir_files） | `python3 build/113/check-oct-lane.py <站点>/assets/oct-threads <站点>/assets/octdir-threads --base <站点>/assets/oct <站点>/assets/octdir` | 2026-10-05T10:19:08+0800 |
| `octave_pin` | **a5a720825e9e**（Octave wasm 分支（tarball 生成件 + 平台补丁）的 pin） | `git -C upstream/octave rev-parse --short=12 HEAD` | 2026-10-05T10:19:08+0800 |
| `octdir_base_files` | **28**（基础档 `assets/octdir/` 条数） | `find /mnt/hdd/octave-wasm-build/site/assets/octdir -name '*.oct' \| wc -l` | 2026-10-05T10:19:08+0800 |
| `probe_lane_fail` | **0** | `同上（脚本结尾的 `=== N PASS / M FAIL ===`）` | 2026-10-05T10:19:08+0800 |
| `probe_lane_pass` | **33**（选档探针的 PASS 数（FAIL 必须 0）；站点四格/双档不同 ⇒ 看 cmd 的 SITE_DIR） | `SITE_DIR=<站点> sh test/browser/run.sh test/browser/probe-lane.mjs > /mnt/hdd/octave-wasm-build/probe-lane.log` | 2026-10-05T10:19:08+0800 |
| `rust_fill_spike_ratio` | **1.094**（Rust slice::fill / C++ 标量 fill 的 2^24 填充比值（<1 = Rust 快）；实测 >1 ⇒ 候选②否决——带宽绑定热点换语言无益） | `sh test/fixtures/rustfill-spike/run-spike.sh（读 w64-logs/rustfill-spike.log 的比值行）` | 2026-10-05T10:19:08+0800 |
| `rust_sort_spike_base_ms` | **352.0**（octave_sort<double>（timsort）2M 随机 doubles 排序） | `sh test/fixtures/rustsort-spike/run-spike.sh（读 w64-logs/rustsort-spike.log）` | 2026-10-05T10:19:08+0800 |
| `rust_sort_spike_cand_ms` | **87.0**（Rust driftsort（stable）同负载） | `同上` | 2026-10-05T10:19:08+0800 |
| `rust_sort_spike_ratio` | **0.249**（内核比值（<0.867 = ≥1.15× 加速门槛）；实测 0.247 = 4× ⇒ ADOPT） | `派生：cand ÷ base` | 2026-10-05T10:19:08+0800 |
| `threads_blas_dir` | **/src/work/e2-openblas-lib-s**（**必须含 `-threads`**（判据见 check-build-manifest.lane_blas_problem）） | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 inputs.blas.resolved_dir` | 2026-10-05T10:19:08+0800 |
| `threads_exported_functions` | **725** | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 measured.exported_functions` | 2026-10-05T10:19:08+0800 |
| `threads_pthread_glue` | **54**（基础档实测是 0） | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 measured.threads.pthread_glue` | 2026-10-05T10:19:08+0800 |
| `threads_shared_memory` | 是（wasm 内存段的 shared 位；线程档的硬身份） | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 measured.threads.shared_memory` | 2026-10-05T10:19:08+0800 |
| `threads_v128` | **4926**（线程档也带 SIMD（两轴不互斥）） | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 measured.simd.v128` | 2026-10-05T10:19:08+0800 |
| `threads_verdict` | **ok**（只有 ok 才可部署（fail-closed）） | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 verdict` | 2026-10-05T10:19:08+0800 |
| `threads_wasm_bytes` | **29495868** | `stat -c%s /mnt/hdd/octave-wasm-build/site/threads/octave.wasm` | 2026-10-05T10:19:08+0800 |
| `threads_wasm_sha` | `e570905ecc8927bf…` | `sha256sum /mnt/hdd/octave-wasm-build/site/threads/octave.wasm \| cut -d' ' -f1` | 2026-10-05T10:19:08+0800 |
| `upstream_submodule_count` | **18** | `git submodule status \| wc -l` | 2026-10-05T10:19:08+0800 |
| `w64_base_shared_memory` | 否（单线程回退档：**不**是 shared（这是它与 w64 的分界）） | `读 /mnt/hdd/octave-wasm-build/w64-base-artifacts 的 measured.threads.shared_memory` | 2026-10-05T10:19:08+0800 |
| `w64_base_verdict` | **ok** | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/w64-base-artifacts/octave.build.json）` | 2026-10-05T10:19:08+0800 |
| `w64_base_wasm64` | 是（回退档也必须是真 64 位（否则它回退的是**另一个 ABI**，不是同一档）） | `读 /mnt/hdd/octave-wasm-build/w64-base-artifacts 的 measured.wasm64` | 2026-10-05T10:19:08+0800 |
| `w64_base_wasm_bytes` | **29935634** | `stat -c %s /mnt/hdd/octave-wasm-build/w64-base-artifacts/octave.wasm` | 2026-10-05T10:19:08+0800 |
| `w64_base_wasm_sha` | `091c350054111b96…` | `sha256sum /mnt/hdd/octave-wasm-build/w64-base-artifacts/octave.wasm \| cut -d' ' -f1` | 2026-10-05T10:19:08+0800 |
| `w64_big_heap` | 是（工单 31 的结算判据：抬了 MAXIMUM_MEMORY 之后必须变 yes） | `同上（探针结尾的 `W64_BIG_HEAP=` 行）` | 2026-10-05T10:19:08+0800 |
| `w64_build_recipe_ok` | **ok**（构建**输入**的不变式（配方层）：link-web.sh 无 -flto / 含 -fwasm-exceptions；w64 车道含 -sMEMORY64=1。把「输入」也当事实，由同一批复跑闸门核对 ——由同一批复跑闸门每提交核对。） | `python3 build/113/witness-build-inputs.py` | 2026-10-05T10:19:08+0800 |
| `w64_build_tool_match` | **match**（贵事实的便宜见证：部署件记录的构建脚本 sha 必须 == 仓库现役脚本。做不到就 DRIFT（来源漂移）。注意**旧档**（base/threads/w64-base）建造时间不同、记录 sha 各异 ⇒ 只对活跃迭代并每批重链的 w64 档断言。） | `<重链 w64 后：python3 build/113/witness-build-provenance.py w64>` | 2026-10-05T10:19:08+0800 |
| `w64_cand_exported_functions` | **751** | `读 /mnt/hdd/octave-wasm-build/w64-artifacts-mimalloc 的 measured.exported_functions` | 2026-10-05T10:19:08+0800 |
| `w64_cand_loop1e6_s` | **0.574**（候选的纯解释器轴（分配器不该动它 —— 诚实记录，防「把好数字全记在头上」）） | `同上（loop 1e6）` | 2026-10-05T10:19:08+0800 |
| `w64_cand_lu800_s` | **0.014**（候选（mimalloc）产品级 lu(800)） | `同上（lu 800）` | 2026-10-05T10:19:08+0800 |
| `w64_cand_malloc` | **mimalloc**（分配器（产物探针 = 导出段里的 mi_version；工单 59；mimalloc 工单 57 实测 −27%）。★ witness = #5 档对**产物**的便宜复查（Einfacht #9 提了即撤：机制不缺，witness/calibrate 现有档位已覆盖）——每提交重读候选产物导出段，旋钮没生效/产物被换 ⇒ 见证红。） | `读 /mnt/hdd/octave-wasm-build/w64-artifacts-mimalloc 的 declared.malloc / measured.malloc` | 2026-10-05T10:19:08+0800 |
| `w64_cand_matmul500_s` | **0.005**（候选（mimalloc，工单 59）产品级 matmul 500²；与现役的同窗配对见 w64_cand_vs_ship_*） | `<交错 3 轮取中位：HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/bench-lanes.mjs http://127.0.0.1:8861/ w64（×3 ⇒ w64-logs/bench-mi2-r1..3.log）>` | 2026-10-05T10:19:08+0800 |
| `w64_cand_verdict` | **ok**（候选产物：verdict=ok + 全量验收全绿 ⇒ 可发运（发运=产品决定）） | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/w64-artifacts-mimalloc/octave.build.json）` | 2026-10-05T10:19:08+0800 |
| `w64_cand_vs_ship_lu800` | **1.0**（候选/现役 的 lu800 比值） | `派生：同上（lu 800）` | 2026-10-05T10:19:08+0800 |
| `w64_cand_vs_ship_matmul500` | **1.25**（候选/现役 的 matmul500 比值（<1 = 候选更快；同窗配对，不是跨窗对比）） | `派生：w64-logs/bench-mi2-r1..3.log 的中位 ÷ bench-ship2-r1..3.log 的中位` | 2026-10-05T10:19:08+0800 |
| `w64_cand_wasm_bytes` | **30984954** | `stat -c %s /mnt/hdd/octave-wasm-build/w64-artifacts-mimalloc/octave.wasm` | 2026-10-05T10:19:08+0800 |
| `w64_cand_wasm_sha` | `01fb52fc3b5dde30…` | `sha256sum /mnt/hdd/octave-wasm-build/w64-artifacts-mimalloc/octave.wasm \| cut -d' ' -f1` | 2026-10-05T10:19:08+0800 |
| `w64_exported_functions` | **751** | `读 /mnt/hdd/octave-wasm-build/w64-artifacts 的 measured.exported_functions` | 2026-10-05T10:19:08+0800 |
| `w64_i64_insns` | **4175689**（64 位的指令层证据（wasm32 版为 0）） | `llvm-objdump -d <w64>/octave.wasm \| grep -c i64（由 build/113/build-w64-lane.sh facts 写出，容器内跑）` | 2026-10-05T10:19:08+0800 |
| `w64_lu800_s` | **0.079**（w64 档 lu(800)：比 base 慢约 1.3×） | `HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/bench-lanes.mjs http://127.0.0.1:8761/ w64 > w64-logs/speed-w64.log` | 2026-10-05T10:19:08+0800 |
| `w64_malloc` | **mimalloc**（现役 w64 的分配器（工单 59 起 = mimalloc，由 relink.sh w64 模式表声明）） | `读 /mnt/hdd/octave-wasm-build/w64-artifacts 的 declared.malloc / measured.malloc` | 2026-10-05T10:19:08+0800 |
| `w64_matmul500_s` | **0.048**（w64 档矩阵乘 500²：比 base 慢约 1.2×（i64 指针/索引的代价）） | `HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/bench-lanes.mjs http://127.0.0.1:8761/ w64 > w64-logs/speed-w64.log` | 2026-10-05T10:19:08+0800 |
| `w64_mem_5g_bytes` | **5242880000**（单线程 memory64 分配 80000 页（非 COI 页，buffer 是 ArrayBuffer）） | `sh test/browser/run.sh test/browser/probe-wasm64-mem.mjs > /mnt/hdd/octave-wasm-build/w64-logs/mem-probe.log` | 2026-10-05T10:19:08+0800 |
| `w64_mem_8g_bytes` | **8589934592**（单线程 memory64 分配 131072 页） | `sh test/browser/run.sh test/browser/probe-wasm64-mem.mjs > /mnt/hdd/octave-wasm-build/w64-logs/mem-probe.log` | 2026-10-05T10:19:08+0800 |
| `w64_mem_probe_fail` | **0**（内存探针 FAIL 数（必须 0；含 wasm32 上限 / index 陷阱 / BigInt 三条反证）） | `同上（脚本结尾的 `=== N PASS / M FAIL ===`）` | 2026-10-05T10:19:08+0800 |
| `w64_mem_shared_5g_bytes` | **5242880000**（COI 页 shared memory64 分配 80000 页（buffer 是 SharedArrayBuffer）） | `sh test/browser/run.sh test/browser/probe-wasm64-mem.mjs > /mnt/hdd/octave-wasm-build/w64-logs/mem-probe.log` | 2026-10-05T10:19:08+0800 |
| `w64_ob_lib_wasm32_members` | **0**（必须是 0（side module 的指针宽度必须与主模块一致）） | `同上` | 2026-10-05T10:19:08+0800 |
| `w64_ob_lib_wasm64_members` | **1557**（w64 车道线程版 OpenBLAS 归档里 wasm64 成员数） | `E2_LANE=w64 docker exec o113 bash /src/bin/build-e2-lane.sh src patch build > w64-logs/e2-w64-build.log（读那行架构断言）` | 2026-10-05T10:19:08+0800 |
| `w64_ob_lu800_s` | **0.014**（现役 w64（线程版 OpenBLAS NT=8）的 lu(800) 中位数） | `同上（8761 现役那轮）` | 2026-10-05T10:19:08+0800 |
| `w64_ob_matmul1000_native_ratio` | **0.38**（浏览器 w64 matmul1000 占原生天花板的比值（大矩阵是最吃线程的刻度）） | `派生：native-baseline.json 的 openblas24.matmul1000 ÷ bench-ob-w64.log 的 matmul 1000` | 2026-10-05T10:19:08+0800 |
| `w64_ob_matmul500_native_ratio` | **1.07**（浏览器 w64 占原生天花板的比值（占比仪表盘的表头）） | `派生：w64-logs/native-baseline.json 的 openblas24.matmul500 ÷ w64-logs/bench-ob-w64.log 的 matmul 500` | 2026-10-05T10:19:08+0800 |
| `w64_ob_matmul500_s` | **0.003**（现役 w64（线程版 OpenBLAS NT=8，2026-10-02 上站）的矩阵乘 500² 中位数） | `HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/bench-lanes.mjs http://127.0.0.1:8761/ w64 > w64-logs/bench-ob-w64.log` | 2026-10-05T10:19:08+0800 |
| `w64_ob_matmul500_speedup` | **15.3**（OpenBLAS 版相对 refblas 版 w64 的加速倍数（历史对照：refblas 的现役地位已由 2026-10-02 NT=8 批取代）） | `派生：w64-logs/bench-ship-w64.log 的 matmul 500 ÷ w64-logs/bench-ob-w64.log 的同项` | 2026-10-05T10:19:08+0800 |
| `w64_ob_matmul500_vs_netlib` | **9.1**（浏览器 w64 相对『系统默认 BLAS 的原生 Octave』的倍数） | `派生：w64-logs/native-baseline.json 的 netlib.matmul500 ÷ w64-logs/bench-ob-w64.log 的 matmul 500` | 2026-10-05T10:19:08+0800 |
| `w64_oct_files` | **46**（车道 `.oct` 总数） | `同上（文件名：oct-wasm64.txt 的第二个数）` | 2026-10-05T10:19:08+0800 |
| `w64_oct_wasm64` | **46**（`.oct` 车道里 wasm64 的个数（side module 的指针宽度必须与主模块一致）） | `bash build-w64-lane.sh facts（容器内；用 /emsdk/upstream/bin/llvm-readobj 逐个量）` | 2026-10-05T10:19:08+0800 |
| `w64_relaxed_madd` | **47**（relaxed-simd FMA 指令数（工单 52）。⚠ 量法本身有生命周期：`grep relaxed_madd` 是**被证伪的量法**（见 build/instruments.json）——本键的 cmd 已避开它（字节级）。calibrate= 用已知含它的样本自证。） | `<重活：产物 + test/fixtures/relaxed_madd_min.wasm 各数 fd 87 02>` | 2026-10-05T10:19:08+0800 |
| `w64_shared_memory` | 是（目标形态 = memory64 **+ 多线程**（shared 是这个轴的硬身份）） | `读 /mnt/hdd/octave-wasm-build/w64-artifacts 的 measured.threads.shared_memory` | 2026-10-05T10:19:08+0800 |
| `w64_v128` | **6582** | `读 /mnt/hdd/octave-wasm-build/w64-artifacts 的 measured.simd.v128` | 2026-10-05T10:19:08+0800 |
| `w64_verdict` | **ok**（只有 ok 才可部署（fail-closed）） | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/w64-artifacts/octave.build.json）` | 2026-10-05T10:19:08+0800 |
| `w64_vs_netlib_loop1e6` | **0.67**（浏览器解释器循环相对原生的比值（<1 = 浏览器慢 —— 纯解释器轴是唯一明确输的）） | `派生：native-baseline.json 的 netlib.loop1e6 ÷ bench-ob-w64.log 的 loop 1e6` | 2026-10-05T10:19:08+0800 |
| `w64_vs_netlib_lu1500` | **3.8**（浏览器 w64 lu1500 相对『用户手里的原生 Octave』的倍数） | `派生：native-baseline.json 的 netlib.lu1500 ÷ bench-ob-w64.log 的 lu 1500` | 2026-10-05T10:19:08+0800 |
| `w64_vs_netlib_matmul1000` | **7.8**（浏览器 w64 matmul1000 相对『用户手里的原生 Octave』的倍数） | `派生：native-baseline.json 的 netlib.matmul1000 ÷ bench-ob-w64.log 的 matmul 1000` | 2026-10-05T10:19:08+0800 |
| `w64_wasm64` | 是（wasm 内存段 limits flags bit2 = 1 ⇒ 真 64 位） | `读 /mnt/hdd/octave-wasm-build/w64-artifacts 的 measured.wasm64` | 2026-10-05T10:19:08+0800 |
| `w64_wasm_bytes` | **30984954** | `stat -c %s /mnt/hdd/octave-wasm-build/w64-artifacts/octave.wasm` | 2026-10-05T10:19:08+0800 |
| `w64_wasm_sha` | `01fb52fc3b5dde30…` | `sha256sum /mnt/hdd/octave-wasm-build/w64-artifacts/octave.wasm \| cut -d' ' -f1` | 2026-10-05T10:19:08+0800 |
| `wasm_bytes` | **29632229** | `stat -c%s /mnt/hdd/octave-wasm-build/site/octave.wasm` | 2026-10-05T10:19:08+0800 |
| `wasm_sha` | `1ed3e528561e4475…` | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.wasm \| cut -d' ' -f1` | 2026-10-05T10:19:08+0800 |
| `wasm_v128` | **4752**（SIMD 判据；非 SIMD 那版是 0） | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.simd.v128` | 2026-10-05T10:19:08+0800 |

台账生成时间 `2026-10-05T10:19:08+0800`；每条的值/出处/复跑命令都在 `build/FACTS.json` 里。
<!-- /AUTO:FACTS -->

### 部署状态

<!-- AUTO:STATE -->
> 本区块由 `.githooks/update-state.py` 重算，**不要手改**（pre-commit 会刷新并 `git add`；pre-push 会 `--check`）。

| 项 | 值 |
|---|---|
| `octave.wasm` | 29,632,229 B raw / 7,083,341 B gz | sha256 `1ed3e528561e4475…` |
| `octave.js` | 462,821 B raw / 89,652 B gz | sha256 `caac68bf62015859…` |
| `octave.data` | 9,712,174 B raw / 3,155,047 B gz | sha256 `f250530ae5abe378…` |
| 三大件 gzip 合计 | **10,328,040 B** | |
| 资产条目 | 49 | |
| 最近一次**全绿**回归 | `20261005-155430` · **6 套 / 107 PASS / 0 FAIL** | http://127.0.0.1:8761/ |
| 交付包 | `octave-full-wasm-site-20261005` · tar.zst 91,292,261 B · `548ba554359c58c8…` | 包内 wasm （**与部署件同 sha** ✓） |
| 仓库 | 分支 `main`（**HEAD 的 sha 与日期以 `git log -1` 为准，不写死在这里**） | |
<!-- /AUTO:STATE -->