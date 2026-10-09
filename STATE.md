# STATE · 活状态

正文只写「现在是什么」，**数字一律引用 `build/FACTS.json` 的键**（或看文末机器块）。
方向与地图在 `maintaince.md`；硬规矩在 `AGENTS.md`；历史在 `HISTORY.md`（append-only）。

## 现在是什么（2026-10-09）

- **事实系统 = 重构版 Einfacht（2026-10-09 采纳）**：机制在 `zreflect/`（vendored 上游
  Phase 1–5：gate 平台 / registry 发现式名录 / knobs 登记 / guard / world 闸门），
  本仓数据层 = `zreflect/measure_octave.py`（数据 vs 机制分离），旋钮载体 =
  `reflect-hooks/Einfacht.env`，钩子挂 `reflect-hooks`。`build/facts.py` 降为兼容壳。
  退役 5 道被平台取代的旧 checker；悬案工单按新契约规范化。提交 `20e45c0`。
- **issue #5 已修并三线同步（2026-10-09）**：三线图形装饰命令（title/xlabel/grid/legend/
  axis/hold/subplot/bar）曾全崩（外部宿主写 0 输出 figure 桩覆盖核心 m）。修法 = 引擎侧
  `bridge/octave-core.js` 图形核心 m 树守卫（快照 + eval 前还原退化桩 + rehash）+
  `octave-page.js` embed 资产链修复。三线：IP `f3a4851` / master `f6ec52a` /
  wasm32-final `87b6c8b`；8761 已发运（`3a80fe3`）。验收 `accept-gfx-isolation` 四格 6/6。
  UI 侧只提不改：<https://github.com/ArchivalEra/Octave-UI/issues/1>。
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
- **Rust 补丁线（工单 63）**：**候选③ sort 已在 w64 落地 ADOPT**——nightly
  build-std 编 wasm64 库（rustc 无 wasm64-emscripten target；评审 E0–E5 全绿）+
  Array-base.cc 弱符号缝（fork `octave_pin`）+ RUST_SORT 旋钮（纯链接期，摘除 =
  旋钮关）。w64 端到端 A/B = asc **0.491** / desc 0.487（2.0×，`w64_rustsort_ab_*`）；
  全量 PROBES=1 等效 1358/0；端到端逐位抽查双站一致（IEEE 红线）。
- **rust-sort 已发运（2026-10-07）**：8761 的 w64 档 = f6fec91f（rust_sort+mimalloc+
  e2-rsimd+wasm64），`promote-w64-lane.sh` 发运，全量 PROBES=1 1358/0 + IEEE 754 评估
  通过（§5.97）+ 对撞 2.2×。**master 线 = 中庸 wasm64**（wasm64-NEXT，无 rust 缝，fork
  pin a5a7208）已改名推送（CI 部署仓库 site/）。三线独立：wasm32-final（冻结）/ 
  wasm64-NEXT / IllegalPerformance——换线四步规则见 `maintaince.md`。isui.ren 部署
  集成已抹除（929fc63/9d89fd0，部署改手工按 DEPLOY.md）。Einfacht #13（reflection
  world 反哺）已建档。
  **专属站 = site-illegalperf(8868) / -baseline(8869)**（装配入口
  `build/113/site-illegalperf.sh`）；候选产物 sha = `w64_rustsort_cand_sha`；
  **发运 = 产品决定**（翻表默认 + lane_expect + promote）。候选④ elem_xpow
  前置 G6 延迟断言。
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
> 本区块由 `zreflect/facts.py --render-doc` 从 `FACTS.json` 渲染，**不要手改**（pre-commit 会重算并 `git add`）。
> 正文里的「测出来的数字」只在这里生产：要引用就写 `[[键名]]`，不要手抄数字。

| 键 | 值 | 测于 | 复跑命令 |
|---|---|---|---|
| `accept_pass` | **1083** | 2026-10-09T17:32:34+0800 | `同上，把每个套件的 PASS 相加` |
| `accept_suites` | **44** | 2026-10-09T17:32:34+0800 | `数 /mnt/hdd/octave-wasm-build/sweep-logs/20261009-171138 里带汇总行的套件（且 0 FAIL）` |
| `build_json_sha` | `d953d7a7929754be…` | 2026-10-09T17:32:34+0800 | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.build.json | cut -d' ' -f1` |
| `data_sha` | `f250530ae5abe378…` | 2026-10-09T17:32:34+0800 | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.data | cut -d' ' -f1` |
| `dist_lane_probe_fail` | **0** | 2026-10-09T17:32:35+0800 | `同上` |
| `dist_lane_probe_pass` | **33** | 2026-10-09T17:32:35+0800 | `cd <dist 包目录> && python3 serve.py 8788；再 SITE_DIR=<dist 包目录> sh build/sweep.sh http://127.0.0.1:8788/ probe-lane > w64-logs/dist-probe-lane.log` |
| `e2_lu800_ratio` | **1.4** | 2026-10-09T17:32:34+0800 | `上面两行的比值（车道 / E2）` |
| `e2_lu800_s` | **0.043** | 2026-10-09T17:32:34+0800 | `同 E2 那一行` |
| `e2_matmul500_ratio` | **1.9** | 2026-10-09T17:32:34+0800 | `上面两行的比值（车道 / E2）` |
| `e2_matmul500_s` | **0.021** | 2026-10-09T17:32:34+0800 | `E2 单线程站点跑 bench-core.mjs（见 NOTES 的 A/B 表）` |
| `e2_single_verdict` | **ok** | 2026-10-09T17:32:34+0800 | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/e2-artifacts/single/octave.build.json）` |
| `e2_single_wasm_bytes` | **29495868** | 2026-10-09T17:32:34+0800 | `stat -c %s /mnt/hdd/octave-wasm-build/e2-artifacts/single/octave.wasm` |
| `e2_single_wasm_sha` | `e570905ecc8927bf…` | 2026-10-09T17:32:34+0800 | `sha256sum /mnt/hdd/octave-wasm-build/e2-artifacts/single/octave.wasm | cut -d' ' -f1` |
| `e2_threaded_lu800_s` | **0.02** | 2026-10-09T17:32:34+0800 | `同上` |
| `e2_threaded_matmul500_ratio` | **6.7** | 2026-10-09T17:32:34+0800 | `车道 / 线程版（派生）` |
| `e2_threaded_matmul500_s` | **0.006** | 2026-10-09T17:32:34+0800 | `E2 线程版站点跑 bench-core.mjs（该轮 300s 超时收尾，只到前几项）` |
| `e2_threaded_oct_rc` | **124** | 2026-10-09T17:32:34+0800 | `timeout 600 sh test/browser/run.sh ...accept-113-oct.mjs <E2 线程版站点>; echo $?` |
| `e2_threaded_verdict` | **ok** | 2026-10-09T17:32:34+0800 | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/e2-artifacts/threaded/octave.build.json）` |
| `e2_threaded_wasm_bytes` | **29908917** | 2026-10-09T17:32:34+0800 | `stat -c %s /mnt/hdd/octave-wasm-build/e2-artifacts/threaded/octave.wasm` |
| `e2_threaded_wasm_sha` | `bce7e4cc252d6481…` | 2026-10-09T17:32:34+0800 | `sha256sum /mnt/hdd/octave-wasm-build/e2-artifacts/threaded/octave.wasm | cut -d' ' -f1` |
| `emcc6_probe_geomean` | **1.001** | 2026-10-09T17:32:35+0800 | `sh test/fixtures/emcc6-probe/run-probe.sh 1（读 w64-logs/emcc6-probe.log 的 geomean 行）` |
| `env_vars` | **33** | 2026-10-09T17:32:34+0800 | `grep -oE '\$\{[A-Za-z0-9_]+:[-+]' /mnt/hdd/zcode-projects/Octave-Full-Wasm/build/113/link-web.sh | sort -u（去掉位置参数）` |
| `exported_functions` | **710** | 2026-10-09T17:32:34+0800 | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.exported_functions` |
| `floor_matrix_engines` | **4** | 2026-10-09T17:32:35+0800 | `数 w64-logs/floor-*.log 里 `· ① 页面 ready` 判据行的引擎名（去重）` |
| `floor_matrix_fail` | **0** | 2026-10-09T17:32:35+0800 | `同上` |
| `floor_matrix_pass` | **16** | 2026-10-09T17:32:35+0800 | `同上（各日志结尾的 `=== N PASS / M FAIL ===` 求和）` |
| `fonts_count` | **8** | 2026-10-09T17:32:34+0800 | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.fonts` |
| `hotpath_fft_blktrans_pct` | **19.1** | 2026-10-09T17:32:34+0800 | `python3 build/113/hotpath.py profile 'x=(1:2e6)/1e6; tic; for k=1:10, y=fft(x); end' --lane w64` |
| `hotpath_instrument_ok` | **ok** | 2026-10-09T17:32:34+0800 | `python3 build/113/hotpath.py calibrate` |
| `hotpath_top` | **exp_inline 23.6%** | 2026-10-09T17:32:34+0800 | `读 /mnt/hdd/octave-wasm-build/hotpath-logs/20261005-142643/report.json 的 hotspots[0]（重活 ⇒ 不逐字复跑）` |
| `hotpath_xpow_driver_pct` | **39.5** | 2026-10-09T17:32:34+0800 | `同上（elem_xpow + do_rc_map）` |
| `hotpath_xpow_libm_pct` | **48.9** | 2026-10-09T17:32:34+0800 | `python3 build/113/hotpath.py profile 'x=(1:2e6)/1e6+0.1; tic; for k=1:20, y=sqrt(x)+x.^0.7; end' --lane w64（读 w64-logs/hotpath-final3.log）` |
| `ip_vs_next_sort_ip_ms` | **0.105** | 2026-10-09T17:32:34+0800 | `sh test/browser/run.sh test/browser/bench-lanes.mjs <8761> w64（读 w64-logs/bench-IP-vs-NEXT.log）` |
| `ip_vs_next_sort_next_ms` | **0.237** | 2026-10-09T17:32:34+0800 | `同（<8869>）` |
| `ip_vs_next_sort_ratio` | **0.443** | 2026-10-09T17:32:34+0800 | `派生：IP ÷ NEXT` |
| `js_sha` | `caac68bf62015859…` | 2026-10-09T17:32:34+0800 | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.js | cut -d' ' -f1` |
| `jspi_entry` | **True** | 2026-10-09T17:32:34+0800 | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.jspi_entry` |
| `lane_lu800_s` | **0.06** | 2026-10-09T17:32:34+0800 | `同车道那一行` |
| `lane_matmul500_s` | **0.04** | 2026-10-09T17:32:34+0800 | `现役车道站点跑同一个 bench-core.mjs` |
| `libm_spike_geomean` | **0.964** | 2026-10-09T17:32:35+0800 | `sh build/113/bench-libm-spike.sh 8（读 w64-logs/libm-spike-verdict.txt 的 geomean 行）` |
| `locale_contract_lanes` | **4** | 2026-10-09T17:32:34+0800 | `for l in w64 base threads w64-base; do sh test/browser/run.sh test/browser/probe-locale.mjs "http://127.0.0.1:8761/?lane=$l"; done （读 w64-logs/locale-all-lanes.log 的 '8 PASS / 0 FAIL' 计数）` |
| `matrix_page_sha` | `54a7e1c261a2df2f…` | 2026-10-09T17:32:34+0800 | `sha256sum /mnt/hdd/octave-wasm-build/site/matrix-android.html | cut -d' ' -f1` |
| `mem_live_ceiling_gib` | **7.45** | 2026-10-09T17:32:35+0800 | `HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/probe-heap-ceiling.mjs http://127.0.0.1:8761/ > w64-logs/heap-ceiling.log` |
| `native_netlib_loop1e6_s` | **0.500141** | 2026-10-09T17:32:35+0800 | `sh build/113/bench-native.sh` |
| `native_netlib_lu1500_s` | **0.25765** | 2026-10-09T17:32:35+0800 | `sh build/113/bench-native.sh` |
| `native_netlib_lu800_s` | **0.04076** | 2026-10-09T17:32:35+0800 | `sh build/113/bench-native.sh` |
| `native_netlib_matmul1000_s` | **0.196202** | 2026-10-09T17:32:35+0800 | `sh build/113/bench-native.sh` |
| `native_netlib_matmul500_s` | **0.027249** | 2026-10-09T17:32:35+0800 | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` |
| `native_openblas_lu1500_s` | **0.040473** | 2026-10-09T17:32:35+0800 | `sh build/113/bench-native.sh` |
| `native_openblas_lu800_s` | **0.026146** | 2026-10-09T17:32:35+0800 | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` |
| `native_openblas_matmul1000_s` | **0.009586** | 2026-10-09T17:32:35+0800 | `sh build/113/bench-native.sh` |
| `native_openblas_matmul1024_s` | **0.008517** | 2026-10-09T17:32:35+0800 | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` |
| `native_openblas_matmul2000_s` | **0.050018** | 2026-10-09T17:32:35+0800 | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` |
| `native_openblas_matmul500_s` | **0.003212** | 2026-10-09T17:32:35+0800 | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` |
| `native_openblas_threads` | **24** | 2026-10-09T17:32:35+0800 | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` |
| `oct_base_files` | **16** | 2026-10-09T17:32:34+0800 | `find /mnt/hdd/octave-wasm-build/site/assets/oct -name '*.oct' | wc -l` |
| `oct_lane_files` | **16** | 2026-10-09T17:32:34+0800 | `find /mnt/hdd/octave-wasm-build/site/assets/oct-threads -name '*.oct' | wc -l` |
| `oct_lane_octdir_files` | **28** | 2026-10-09T17:32:34+0800 | `find /mnt/hdd/octave-wasm-build/site/assets/octdir-threads -name '*.oct' | wc -l` |
| `oct_lane_tls_init` | **44** | 2026-10-09T17:32:34+0800 | `python3 build/113/check-oct-lane.py <站点>/assets/oct-threads <站点>/assets/octdir-threads --base <站点>/assets/oct <站点>/assets/octdir` |
| `octave_pin` | **f4bf15b792bf** | 2026-10-09T17:32:35+0800 | `git -C upstream/octave rev-parse --short=12 HEAD` |
| `octdir_base_files` | **28** | 2026-10-09T17:32:34+0800 | `find /mnt/hdd/octave-wasm-build/site/assets/octdir -name '*.oct' | wc -l` |
| `probe_lane_fail` | **0** | 2026-10-09T17:32:34+0800 | `同上（脚本结尾的 `=== N PASS / M FAIL ===`）` |
| `probe_lane_pass` | **33** | 2026-10-09T17:32:34+0800 | `SITE_DIR=<站点> sh test/browser/run.sh test/browser/probe-lane.mjs > /mnt/hdd/octave-wasm-build/probe-lane.log` |
| `rust_fill_spike_ratio` | **1.094** | 2026-10-09T17:32:34+0800 | `sh test/fixtures/rustfill-spike/run-spike.sh（读 w64-logs/rustfill-spike.log 的比值行）` |
| `rust_sort_spike_base_ms` | **352.0** | 2026-10-09T17:32:34+0800 | `sh test/fixtures/rustsort-spike/run-spike.sh（读 w64-logs/rustsort-spike.log）` |
| `rust_sort_spike_cand_ms` | **87.0** | 2026-10-09T17:32:34+0800 | `同上` |
| `rust_sort_spike_ratio` | **0.249** | 2026-10-09T17:32:34+0800 | `派生：cand ÷ base` |
| `threads_blas_dir` | **/src/work/e2-openblas-lib-s** | 2026-10-09T17:32:34+0800 | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 inputs.blas.resolved_dir` |
| `threads_exported_functions` | **725** | 2026-10-09T17:32:34+0800 | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 measured.exported_functions` |
| `threads_pthread_glue` | **54** | 2026-10-09T17:32:34+0800 | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 measured.threads.pthread_glue` |
| `threads_shared_memory` | **True** | 2026-10-09T17:32:34+0800 | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 measured.threads.shared_memory` |
| `threads_v128` | **4926** | 2026-10-09T17:32:34+0800 | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 measured.simd.v128` |
| `threads_verdict` | **ok** | 2026-10-09T17:32:34+0800 | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 verdict` |
| `threads_wasm_bytes` | **29495868** | 2026-10-09T17:32:34+0800 | `stat -c%s /mnt/hdd/octave-wasm-build/site/threads/octave.wasm` |
| `threads_wasm_sha` | `e570905ecc8927bf…` | 2026-10-09T17:32:34+0800 | `sha256sum /mnt/hdd/octave-wasm-build/site/threads/octave.wasm | cut -d' ' -f1` |
| `upstream_submodule_count` | **18** | 2026-10-09T17:32:35+0800 | `git submodule status | wc -l` |
| `w64_base_shared_memory` | **False** | 2026-10-09T17:32:35+0800 | `读 /mnt/hdd/octave-wasm-build/w64-base-artifacts 的 measured.threads.shared_memory` |
| `w64_base_verdict` | **ok** | 2026-10-09T17:32:35+0800 | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/w64-base-artifacts/octave.build.json）` |
| `w64_base_wasm64` | **True** | 2026-10-09T17:32:35+0800 | `读 /mnt/hdd/octave-wasm-build/w64-base-artifacts 的 measured.wasm64` |
| `w64_base_wasm_bytes` | **29935634** | 2026-10-09T17:32:35+0800 | `stat -c %s /mnt/hdd/octave-wasm-build/w64-base-artifacts/octave.wasm` |
| `w64_base_wasm_sha` | `091c350054111b96…` | 2026-10-09T17:32:35+0800 | `sha256sum /mnt/hdd/octave-wasm-build/w64-base-artifacts/octave.wasm | cut -d' ' -f1` |
| `w64_big_heap` | **True** | 2026-10-09T17:32:35+0800 | `同上（探针结尾的 `W64_BIG_HEAP=` 行）` |
| `w64_build_recipe_ok` | **ok** | 2026-10-09T17:32:34+0800 | `python3 build/113/witness-build-inputs.py` |
| `w64_build_tool_match` | **match** | 2026-10-09T17:32:34+0800 | `<重链 w64 后：python3 build/113/witness-build-provenance.py w64>` |
| `w64_cand_exported_functions` | **751** | 2026-10-09T17:32:34+0800 | `读 /mnt/hdd/octave-wasm-build/w64-artifacts-mimalloc 的 measured.exported_functions` |
| `w64_cand_loop1e6_s` | **0.574** | 2026-10-09T17:32:35+0800 | `同上（loop 1e6）` |
| `w64_cand_lu800_s` | **0.014** | 2026-10-09T17:32:35+0800 | `同上（lu 800）` |
| `w64_cand_malloc` | **mimalloc** | 2026-10-09T17:32:34+0800 | `读 /mnt/hdd/octave-wasm-build/w64-artifacts-mimalloc 的 declared.malloc / measured.malloc` |
| `w64_cand_matmul500_s` | **0.005** | 2026-10-09T17:32:35+0800 | `<交错 3 轮取中位：HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/bench-lanes.mjs http://127.0.0.1:8861/ w64（×3 ⇒ w64-logs/bench-mi2-r1..3.log）>` |
| `w64_cand_verdict` | **ok** | 2026-10-09T17:32:34+0800 | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/w64-artifacts-mimalloc/octave.build.json）` |
| `w64_cand_vs_ship_lu800` | **1.0** | 2026-10-09T17:32:35+0800 | `派生：同上（lu 800）` |
| `w64_cand_vs_ship_matmul500` | **1.25** | 2026-10-09T17:32:35+0800 | `派生：w64-logs/bench-mi2-r1..3.log 的中位 ÷ bench-ship2-r1..3.log 的中位` |
| `w64_cand_wasm_bytes` | **30984954** | 2026-10-09T17:32:34+0800 | `stat -c %s /mnt/hdd/octave-wasm-build/w64-artifacts-mimalloc/octave.wasm` |
| `w64_cand_wasm_sha` | `01fb52fc3b5dde30…` | 2026-10-09T17:32:34+0800 | `sha256sum /mnt/hdd/octave-wasm-build/w64-artifacts-mimalloc/octave.wasm | cut -d' ' -f1` |
| `w64_exported_functions` | **752** | 2026-10-09T17:32:34+0800 | `读 /mnt/hdd/octave-wasm-build/w64-artifacts 的 measured.exported_functions` |
| `w64_i64_insns` | **4175689** | 2026-10-09T17:32:35+0800 | `llvm-objdump -d <w64>/octave.wasm | grep -c i64（由 build/113/build-w64-lane.sh facts 写出，容器内跑）` |
| `w64_lu800_s` | **0.079** | 2026-10-09T17:32:35+0800 | `HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/bench-lanes.mjs http://127.0.0.1:8761/ w64 > w64-logs/speed-w64.log` |
| `w64_malloc` | **mimalloc** | 2026-10-09T17:32:34+0800 | `读 /mnt/hdd/octave-wasm-build/w64-artifacts 的 declared.malloc / measured.malloc` |
| `w64_matmul500_s` | **0.048** | 2026-10-09T17:32:35+0800 | `HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/bench-lanes.mjs http://127.0.0.1:8761/ w64 > w64-logs/speed-w64.log` |
| `w64_mem_5g_bytes` | **5242880000** | 2026-10-09T17:32:35+0800 | `sh test/browser/run.sh test/browser/probe-wasm64-mem.mjs > /mnt/hdd/octave-wasm-build/w64-logs/mem-probe.log` |
| `w64_mem_8g_bytes` | **8589934592** | 2026-10-09T17:32:35+0800 | `sh test/browser/run.sh test/browser/probe-wasm64-mem.mjs > /mnt/hdd/octave-wasm-build/w64-logs/mem-probe.log` |
| `w64_mem_probe_fail` | **0** | 2026-10-09T17:32:35+0800 | `同上（脚本结尾的 `=== N PASS / M FAIL ===`）` |
| `w64_mem_shared_5g_bytes` | **5242880000** | 2026-10-09T17:32:35+0800 | `sh test/browser/run.sh test/browser/probe-wasm64-mem.mjs > /mnt/hdd/octave-wasm-build/w64-logs/mem-probe.log` |
| `w64_ob_lib_wasm32_members` | **0** | 2026-10-09T17:32:35+0800 | `同上` |
| `w64_ob_lib_wasm64_members` | **1557** | 2026-10-09T17:32:35+0800 | `E2_LANE=w64 docker exec o113 bash /src/bin/build-e2-lane.sh src patch build > w64-logs/e2-w64-build.log（读那行架构断言）` |
| `w64_ob_lu800_s` | **0.014** | 2026-10-09T17:32:35+0800 | `同上（8761 现役那轮）` |
| `w64_ob_matmul1000_native_ratio` | **0.38** | 2026-10-09T17:32:35+0800 | `派生：native-baseline.json 的 openblas24.matmul1000 ÷ bench-ob-w64.log 的 matmul 1000` |
| `w64_ob_matmul500_native_ratio` | **1.07** | 2026-10-09T17:32:35+0800 | `派生：w64-logs/native-baseline.json 的 openblas24.matmul500 ÷ w64-logs/bench-ob-w64.log 的 matmul 500` |
| `w64_ob_matmul500_s` | **0.003** | 2026-10-09T17:32:35+0800 | `HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/bench-lanes.mjs http://127.0.0.1:8761/ w64 > w64-logs/bench-ob-w64.log` |
| `w64_ob_matmul500_speedup` | **15.3** | 2026-10-09T17:32:35+0800 | `派生：w64-logs/bench-ship-w64.log 的 matmul 500 ÷ w64-logs/bench-ob-w64.log 的同项` |
| `w64_ob_matmul500_vs_netlib` | **9.1** | 2026-10-09T17:32:35+0800 | `派生：w64-logs/native-baseline.json 的 netlib.matmul500 ÷ w64-logs/bench-ob-w64.log 的 matmul 500` |
| `w64_oct_files` | **46** | 2026-10-09T17:32:35+0800 | `同上（文件名：oct-wasm64.txt 的第二个数）` |
| `w64_oct_wasm64` | **46** | 2026-10-09T17:32:35+0800 | `bash build-w64-lane.sh facts（容器内；用 /emsdk/upstream/bin/llvm-readobj 逐个量）` |
| `w64_relaxed_madd` | **81** | 2026-10-09T17:32:34+0800 | `<重活：产物 + test/fixtures/relaxed_madd_min.wasm 各数 fd 87 02>` |
| `w64_rustsort_ab_asc_ms` | **165** | 2026-10-09T17:32:34+0800 | `bash build/113/sort-ab.sh /mnt/hdd/octave-wasm-build/site-illegalperf /mnt/hdd/octave-wasm-build/site-illegalperf-baseline 3（读 w64-logs/rust-sort-ab.log）` |
| `w64_rustsort_ab_asc_ratio` | **0.506** | 2026-10-09T17:32:34+0800 | `派生：候选 ÷ 对照（asc 中位）` |
| `w64_rustsort_ab_desc_ratio` | **0.551** | 2026-10-09T17:32:34+0800 | `派生：候选 ÷ 对照（desc 中位）` |
| `w64_rustsort_base_ab_ms` | **326** | 2026-10-09T17:32:34+0800 | `同上` |
| `w64_rustsort_cand_sha` | `f6fec91fc7a0f4b8…` | 2026-10-09T17:32:35+0800 | `sha256sum /mnt/hdd/octave-wasm-build/artifacts-w64-rust-on/octave.wasm | cut -d' ' -f1` |
| `w64_shared_memory` | **True** | 2026-10-09T17:32:34+0800 | `读 /mnt/hdd/octave-wasm-build/w64-artifacts 的 measured.threads.shared_memory` |
| `w64_v128` | **6582** | 2026-10-09T17:32:34+0800 | `读 /mnt/hdd/octave-wasm-build/w64-artifacts 的 measured.simd.v128` |
| `w64_verdict` | **ok** | 2026-10-09T17:32:34+0800 | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/w64-artifacts/octave.build.json）` |
| `w64_vs_netlib_loop1e6` | **0.67** | 2026-10-09T17:32:35+0800 | `派生：native-baseline.json 的 netlib.loop1e6 ÷ bench-ob-w64.log 的 loop 1e6` |
| `w64_vs_netlib_lu1500` | **3.8** | 2026-10-09T17:32:35+0800 | `派生：native-baseline.json 的 netlib.lu1500 ÷ bench-ob-w64.log 的 lu 1500` |
| `w64_vs_netlib_matmul1000` | **7.8** | 2026-10-09T17:32:35+0800 | `派生：native-baseline.json 的 netlib.matmul1000 ÷ bench-ob-w64.log 的 matmul 1000` |
| `w64_wasm64` | **True** | 2026-10-09T17:32:34+0800 | `读 /mnt/hdd/octave-wasm-build/w64-artifacts 的 measured.wasm64` |
| `w64_wasm_bytes` | **31003790** | 2026-10-09T17:32:34+0800 | `stat -c %s /mnt/hdd/octave-wasm-build/w64-artifacts/octave.wasm` |
| `w64_wasm_sha` | `f6fec91fc7a0f4b8…` | 2026-10-09T17:32:34+0800 | `sha256sum /mnt/hdd/octave-wasm-build/w64-artifacts/octave.wasm | cut -d' ' -f1` |
| `wasm_bytes` | **29632229** | 2026-10-09T17:32:34+0800 | `stat -c%s /mnt/hdd/octave-wasm-build/site/octave.wasm` |
| `wasm_sha` | `1ed3e528561e4475…` | 2026-10-09T17:32:34+0800 | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.wasm | cut -d' ' -f1` |
| `wasm_v128` | **4752** | 2026-10-09T17:32:34+0800 | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.simd.v128` |
| `xpow_driver_spike_pct` | **2.1** | 2026-10-09T17:32:34+0800 | `bash test/fixtures/xpow-spike/run-spike.sh（读 w64-logs/xpow-spike.log）` |
| `xpow_driver_spike_ratio` | **0.988** | 2026-10-09T17:32:34+0800 | `同上（cand/base）` |

133 条事实。
<!-- /AUTO:FACTS -->

<!-- AUTO:GATES -->
> 本区块由 `zreflect/facts.py --render-doc` 从发现式名录（zreflect/registry.py 的声明行）渲染，**不要手改**。

| 闸门 | 它挡住什么 | 消费的旋钮 |
|---|---|---|
| `check_ab.py`（A/B 闸门） | A/B 同旗标不变式（非 allow 轴差异 = 混淆变量，A/B 作废） | `REFLECT_AB` |
| `check_envfile.py`（env 文件闸门） | 守钩子的 REFLECT_* 载体（旋钮 typo / 指向缺失 / 空值） | `REFLECT_ENV_FILE` |
| `check_facts.py`（事实闸门） | 块一致性 / 裸数字 / 坏引用 | `REFLECT_FACTS`, `REFLECT_DOC`, `REFLECT_NAKED_MIN` |
| `check_facts_replay.py`（复跑闸门） | 台账 cmd 逐字复跑（裸值契约：stdout 必须等于值） | `REFLECT_FACTS`, `REFLECT_REPLAY`, `REFLECT_REPLAY_TIMEOUT` |
| `check_instruments.py`（仪器生命周期闸门） | 恒常检测（first_seen）+ 被证伪量法登记 | `REFLECT_INSTRUMENTS`, `REFLECT_INSTRUMENT_DAYS`, `REFLECT_FACTS` |
| `check_invariants.py`（不变量闸门） | 声明式不变量：仓库文件必须/不得含某片段（grep 级） | `REFLECT_INVARIANTS` |
| `check_locks.py`（锁定源闸门） | 锁定源清单（URL + 文件 + sha256 的内容指纹） | — |
| `check_pins.py`（pin 闸门） | 派生树 pin 一致性（stamp commit / dirty / 版本串对读） | `REFLECT_PINS` |
| `check_questions.py`（悬案闸门） | 未结案的问题必须挂一个能跑的结算件 | `REFLECT_QUESTIONS` |
| `check_readme_sync.py`（三语 README 闸门） | 语言版本是同一条断言的三份拷贝：结构互链 + 每次推送同批 | `REFLECT_READMES` |
| `check_retractions.py`（翻案重现检测） | 被推翻的断言不许悄悄回来当现状 | `REFLECT_RETRACTIONS`, `REFLECT_DOCS`, `REFLECT_HISTORY_SECS` |
| `check_stale.py`（陈旧断言检测） | sha 出处 / 退役名 / 测龄 | `REFLECT_DOCS`, `REFLECT_FACTS`, `REFLECT_HISTORY_SECS`, `REFLECT_RETIRED`, `REFLECT_STALE_DAYS` |
| `check_world.py`（world 闸门） | 声明式验证对象：多线仓库共享验证环境的世界对账 | `REFLECT_WORLD`, `REFLECT_WORLD_LINE` |

13 道闸门（发现式名录派生 —— 手写清单会漂，加闸门 = 落一个声明行，这里自动长出来）。
<!-- /AUTO:GATES -->

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
| 仓库 | 分支 `IllegalPerformance`（**HEAD 的 sha 与日期以 `git log -1` 为准，不写死在这里**） | |
<!-- /AUTO:STATE -->