# STATE · 活状态

正文只写「现在是什么」，**数字一律引用 `build/FACTS.json` 的键**（或看文末机器块）。
方向与地图在 `maintaince.md`；硬规矩在 `AGENTS.md`；历史在 `HISTORY.md`（append-only）。

## 现在是什么（2026-10-14）

- **★ 三仓统一「额外内容」接口设计已判决（2026-10-14，用户点令「大一统」）**：
  `build/113/NOTES-extra-content-seam.md` —— **缝在「记录」上，不在「方法」上**：
  一种记录（`form`=投送形态 / `content`=内容构成，两轴各自命名，收编今天 `kind`/`kinds` 的同名两义）
  + 能力层（Pyodide/clang）作 `form:"tree"` 的**普通条目折进同一张依赖图**
  + 宿主返回 **Verdict 四态值**（ok/failed/not-found/cannot-know 不可塌陷）
  + **端口产地**在 `build/extra-content/`（schema + 纯 stdlib 校验器 + golden/bad 夹具，
  生产者自证不需宿主在场）+ 一条协商规则（未知轴默认 fail-closed）。
  方法 = design-it-twice 四子代理（极简/最大灵活/常见调用者/端口-适配器）独立出方案 → 判决取
  「极简骨架 + 常见调用者返回值 + 端口产地 + 一条协商规则」。**修的是三条实测缺陷**：
  `kind`/`kinds` 同名两义（实测取值 4 种 vs 2 种）、`forge-catalog.py:37` import 生产者内部、
  版本解析三份副本（复跑见该文 §7）。**未落实现** —— 增量五步在 §5，每步独立验收。

- **★ Pyodide 是否性能承重件 —— 定论（用户点令三边实测，2026-10-14）**：
  同一份 `bench-sympy.py`（15 个 CAS op，同 sympy 1.14.0、同 ground types）三边跑：
  **原生 CPython（uv）= 1×** / **浏览器 Pyodide = [[sympy_perf_pyodide_over_native]]×** /
  原生 Octave+`symbolic`（**持久** popen2 IPC）= **7.54×**。
  ⇒ **明确答案：是承重件，但只承"≈2×"这个量级，不是数量级**；而且**浏览器档比
  原生 Octave+symbolic 还快 3.69×**（后者每 op 要过管道做变量编组）。
  冷启动另一笔账 = **[[sympy_perf_cold_start_ms]] ms**（懒加载，不进开机路径）。
  ⇒ 判据满足"性能接近"（若问"要不要为它重写引擎"：不要，2× 不改变架构选择）。
  复跑 `sh test/fixtures/sympy-perf/run-perf.sh`；读数 `w64-logs/sympy-perf-*.json`。

- **★ 追加之问：预编译 `.pyc` 还能快多少（2026-10-14）**：**收益集中在"每个会话的头几秒"，
  稳态一点不变**。四段口径实测（`compare-pyc.py`）：
  ① `import sympy` **2.71 s → 0.37 s（[[sympy_pyc_import_speedup_pyodide]]×）**；
  ② 每 op **首次调用**几何均值 **[[sympy_pyc_cold_geo_speedup]]×**（惰性子模块加载）；
  ③ **稳态 [[sympy_pyc_steady_geo_ratio]]×（≈不变，对照）**；④ 同会话二次 import 2.73 → 0.28 s。
  ★ **④ 的含义最值钱**：源码档**二次 import 仍要 2.73 s** ⇒ **浏览器里没有隐式字节码缓存**
  （原生 CPython 会写 `__pycache__`，浏览器 site-packages 只读 ⇒ **每次冷启动重编 472 个模块**）
  ⇒ `.pyc` 轮子的本质 ≠ "把执行变快"，而是"**把每次冷启动的固定成本砍掉 85%**"。
  代价仍是字节 [[sympy_pyc_bytes_ratio]]×（见 §1.3c）。

- **★ 缺口①"符号计算"的路线前提已实测通过（2026-10-14）**：浏览器里 **Pyodide + SymPy
  真算对** —— `test/browser/probe-pyodide-sympy.mjs` **5/0**：COI 模式 `diff(sin(x),x)`
  = **`cos(x)`**（SymPy 1.14.0 / Pyodide 314.0.7）；**无 COI**（发不了 COOP/COEP 的宿主）
  **同样算对**（⇒ 基础档用户也有份）；反向断言（拿掉 SymPy 轮子）**响亮失败**。
  **为什么必须引 Python**（实测）：`symbolic` 包是**纯 `.m`**（0 个 `.cc`）但功能全经
  `python_ipc_driver` 起 Python —— 而本构建 wasm 里 `pyexec`/`pyeval`/`pycall` 字节数
  **全 = 0**、`system`/`popen` 无 shell（webshim 清晰报错）⇒ 包原样跑不了。
  **用户的 Transcrypt 之问有两半，实测答案**：① **静态编译成 JS 不可行**（官方 README
  第 45 行 *"No eval and exec of Python code"* × SymPy 实测 `eval(` **340** / `exec(` **61**
  处）；② **预编译字节码（`.pyc`）可行且现在完全没做**（实测 `.pyc` 计数：pyodide
  stdlib = 0、sympy/mpmath 轮子 = 0）⇒ **A/B = [[sympy_pyc_speedup]]×**
  （`import sympy` [[sympy_import_ms_source]]→[[sympy_import_ms_pyc]] ms，
  源码编译 472→[[sympy_pyc_compile_calls]] 次），代价 = 字节 **[[sympy_pyc_bytes_ratio]]×**
  （6.55→21.47 MB，gzip 后仍 3.29×）。
  台账键：`sympy_pyodide_{ok,diff,nocoi_ok,break_fails_loud}` / `sympy_import_ms_{source,pyc}` /
  `sympy_pyc_{speedup,compile_calls,bytes_ratio}` / `sympy_assets_bytes`。

- **★ 补缺口的工作令已落档（2026-10-14）**：`build/113/PLAN-matlab-gaps.md` ——
  三条缺口（符号计算 / 库厚度 / 计划内三件）各带实测现状 + 复跑命令 + 验收与反向断言。
  库厚度实测：货架 12 包 vs 上游索引 **144 个包全兼容 11.3.0**（纯候选 **102** 个）；
  计划内三件在本仓**只剩接口/验收角色**（前端与 OM 均已交独立仓）。

- **★ WebGPU 在 Worker 里可用且真算对（2026-10-14，推翻我自己的假结论）**。实测
  （8761 页面 + 真 Worker，`probe-webgpu-capability.mjs` **8/0**）：
  主线程 `device=OK`（vendor=nvidia）；**Worker 内**（DOM-free）`adapter/device=OK`；
  **真跑 compute shader**：`[1,1,1,1] × 2` 读回 **`[2,2,2,2]`**；Worker 内
  `OffscreenCanvas + webgl2` 可用；硬件接口 **WebSerial/USB/HID 三个全在**。
  ⇒ **"算力放 Worker + GPU 加速 + 页面出图"这条链路成立**，且 **WebGPU 不挑厂商**
  （NVIDIA/AMD/Intel/Apple 同一套 API）—— 与 CUDA（私有栈、手机没有）**正好相反**。

  ⚠️ **这条曾被测错，教训进档**：我最初在**无头浏览器 + `about:blank`** 上探
  `navigator.gpu` 得到 `undefined`，据此写下"这台机器/我们的场景**没有 WebGPU**"
  ⇒ **两处都错**。真因：**`about:blank` 不是安全上下文**（`isSecureContext=false`），
  而 `http://127.0.0.1` 是 ⇒ `navigator.gpu` 才存在。**与有头无头无关、与 WebGPU 支持无关**
  —— 是**探测条件本身**错了。⇒ 探针已把"先 `goto` 真页面、再探"写成代码。
  台账键：`webgpu_main_device` / `webgpu_worker_device` / `webgpu_worker_compute_ok` /
  `webgpu_worker_webgl2` / `hw_apis_available` / `webgpu_vendor`。

- **与 MATLAB 的差距盘点（2026-10-14，用户点令：clang + Octave + OM 之后还剩多少）**：
  三根轴 —— ① 语言/矩阵**基本齐**（`datatypes` 补上 `table`/`string`/`duration`）；
  ② Simulink **数值面全有**（实测 `ss`+`step` len=21、`tf`、`ode45` 69步、**刚性 `ode15s`**、
  **`ode15i` DAE V₅=0.9931 vs 理论 0.9933**、`lqr` K=[0.414 0.682]、`zpkdata`），**只缺前端**；
  ③ Simscape 协议面+参考实现已查证（OM 官方 wasm CMake 目标 + `sendExpression`↔`omc_eval`），
  **产品未 build**。
  **用户砍掉的三条不是差距而是"不要/更好"**（2026-10-14 用户裁定）：
  · **CUDA** —— 私有栈 + 手机没有 ⇒ 不进开源项目；**WebGPU 才是那条路**（已实测可用）；
  · **App Designer / 硬件支持包** —— 网页自带 UI 框架；硬件反而是**网页原生 API**
    （实测 serial/usb/hid 三件全在）⇒ 比 MATLAB 的"装驱动+daemon"**更轻**；
  · **pthread 分档** —— 不是"缺线程"，是**给无 COI 环境留的活路**（比 MATLAB 更宽容）。
  **真正剩下的差距**：**符号计算**（`sym`=0，硬缺口）、**库的厚度**（长度问题，
  靠**额外内容**（货架按需装 + 浏览器内 clang 自编 `.oct`；见 CONTEXT.md 的"额外内容"）长）、**用户计划内三件**（Simulink 前端 /
  OM 自产 `omc.wasm` / `.mat` 端到端）。

- **8761 货架补装（2026-10-14）**：装配产物停在 10 包，而 `shelf` submodule 早已 pin 到
  **12 包**（含 `datatypes`/`cgi`）⇒ 重新装配 + `check-forge-catalog` gate 复跑 ok。
  **形状（本仓反复踩）**：改了源码/子模块 ≠ 装配产物跟上。台账键
  `forge_catalog_packs`（10→12）/ `forge_catalog_shelf_commit`（`a6ab1a8…`→`980e093…`）。

## 现在是什么（2026-10-13）

- **★ 额外内容的杀手用例实测 + 工单 66 已修（2026-10-13）**：从货架装 Forge 的 **`datatypes`** 包
  ⇒ **现代 MATLAB 类型当场可用** —— `table([1;2;3],{'a';'b';'c'})` 得 `class=table`
  （height 3 / width 2）、`string(42)` 得 `"42"`、`duration` 类存在、落盘 79 文件。
  **边界如实记**：`datetime()` 要编译件（`__datetime__.oct`）⇒ v2，v1 装不了。
  同批修好**工单 66**：未实现的 MATLAB 名字（`table`/`string`/`contains`…）以前报
  `system: unable to start subprocess for 'makeinfo …'`（误导），现在报 Octave 的**原话**
  *"belongs to the 'datatypes' package … seems not to be installed"*（**直接点名装哪个包**）。
  根因：`upstream/.../__unimplemented__.m:549` 生成提示后调 `__makeinfo__` 渲染，而它是
  `system("makeinfo …")`、本构建无 shell ⇒ 渲染抛错盖掉了那句有用的话。修法 =
  `build/webshims/__makeinfo__.m`（无 makeinfo 时**剥 texinfo 标记**给可读文本）+
  `__webshim_strip_texinfo__.m`（纯函数）。**已发运 8761**（`M_ASSETS=webshims`），
  结算件 `test/browser/probe-unimplemented-msg.mjs` **6/0**；四个 pkg 套件复验全绿
  （pkgview 17/0、pkg 16/0、forge-ondemand 15/0、catalog-load 27/0）。
- **两份文档（2026-10-13）**：`build/113/REQUIREMENTS-store-and-matlab.md`（额外内容拉取接口契约
  + 贴近 MATLAB 的 C1–C4 + UI 师傅交接清单）、`build/113/NOTES-plugin-survey.md`
  （scilab/pathsim/pyblocksim 探查：**pathsim 首选**，MIT + 依赖仅 numpy/scipy/matplotlib
  且 Pyodide 全有；pyblocksim 次选，GPL + 多 2 个非标准依赖；**scilab 不做**，464 MB C++ 且
  语言不兼容 MATLAB）。
- **纠正一个错前提（2026-10-13）**：`NOTES-forge-ondemand.md` §1 原写"12 MB 对每个用户
  强制下载"——**实测推翻**：开机 `assets/pkg/*.js` 传输 = **0.00 MB**（包懒加载），
  且 gzip 后 bundle（statistics 0.92 MB）比货架 tarball（1.44 MB）**更小**。
  ⇒ 货架价值 = **广度**（能装的包 12 → 142，上游兼容数）+ 交付件体积，**不是**每用户带宽。
  原文已更正（保留旧文作对照）。
- **货架扩到 12 包**（submodule `shelf`，已推 origin）：新增 `cgi`（纯 `.m`，证明
  "**从未预打包的包也能装**"）与 `datatypes`（杀手用例）。

## 现在是什么（2026-10-12）

- **T4 落地：`pkg load <货架上的包>` 现在真能从货架装（2026-10-12，A+B 的第一块）**。
  设计稿 §9① 的"A 收尾"已完成：`build/webshims/pkg.m` 改为**先问来源**（随站 ⇒ `load`；
  货架 ⇒ `install`），并把"装完了没有"变成**可判的终态**（成功/失败/查无/问不到四态分开）。
  配套：`build/pkgfix/{__webpackage_source__,__webshelf_names__}.m`（纯函数，宿主可测）+
  加载器账本新增四字段（`catalog_state`/`catalog_packs`/`catalog_miss`/`install_error`）。
  **结案实验** = `test/browser/accept-catalog-load.mjs`（含"真下载 tarball + 真算 `csaps`
  与宿主 Octave 逐位一致"），跑在 `build/113/prep-catalog-accept-site.sh` 造的副本上
  （把 `splines` 从随站清单摘掉、只留货架 ⇒ 否则测的还是老路 = 假绿）。
  **三条实测教训（已写进代码注释，别改回去）**：
  ① 货架目录**必须开机读**（`bridge/octave-core.js`）—— 让 `pkg.m` 现读就得挂起，
     而**同步入口**（页面队列外的 `eval_string`）挂起会抛 `SuspendError`，那个抛错在
     Octave 侧 try/catch **抓不住**（直接穿到 JS）⇒ 打错个包名就把调用方炸掉
     （`accept-pkg` 当场变 CRASH，实测抓到）。
  ② `miss`（两个名单都没有）**不许由 shim 报错** —— 包可能已在本会话磁盘上，
     该不该报错只有核心 `pkg` 能判（shim 抢答 = 假失败）。
  ③ 装载失败是**终态**（原因落账本）⇒ `.m` 侧立刻报错；老实现只有"等满 60 秒"一条路。
  顺带修：`promote-pages.sh` 新增 `M_ASSETS` 旋钮（m 胶水批必须重生成**车道清单**；
  空 = 老行为）+ 一条反向断言（陈旧车道清单 ⇒ 必须红）。
- **客户端自编 `.oct`（A+B）设计已定稿（2026-10-12）**：`build/113/NOTES-client-compile-design.md`。
  **决定性实测**：COI 页面（`COEP: require-corp`）里跨域 fetch GitHub Release ⇒
  `TypeError: Failed to fetch` ⇒ **工具链字节必须同源托管**（逃生口全排查过：非 COI 页可跨域
  但要放弃 w64 档、SW 未装、让上游加 CORP 不能当前提）。**但"不维护插件库"仍成立**：
  我们**不持有任何字节的权威** —— 工具链 = 上游 Release（`URL+sha256` 进
  `upstream-lock.json`，`check_locks.py` 接手）；包 = 上游 Forge tarball（货架 submodule
  commit 承载）；头 = Octave 树派生（`upstream-pins.json` 承载）。站点副本是 **provision
  产物**（可删可重建）= 缓存，不是维护对象。
  接缝：A 只补一个洞（`pkg.m` 先问 catalog）；B 只加**一个方法**
  `OctaveAssets.compileExtension()`。**设计验证**：真包源码直编成功 ——
  `miscellaneous/src/cell2cell.cc` + 合成 `config.h` + 788 真头 ⇒ 13446 B 真 `.oct`
  ⇒ `addpath` 后 `exist=3` 且 `cell2cell({1,2},1)=1×1`、`(,2)=1×2` **语义正确**。
  ⚠️ 关键发现：`config.h`（25 宏）**不在 tarball 里**、是 `build-pkg-oct.sh` 合成的
  ⇒ 客户端要复现的核心知识 = 这 25 个宏，**必须是数据**（跟 catalog 走），不是硬编码。
- **上游闭环（2026-10-12）**：给 `ArchivalEra/LLVM-wasm` 提了 issue #1（发布包只装 wasm32
  档 sysroot ⇒ 编出的 wasm64 模块进不了下游宿主）；**对方已修**（v0.1.1：两档 sysroot 都发 +
  缺档硬拒绝），我方**独立复验通过**（反向断言生效 / 两档都能编 / wasm64 产物进真宿主
  `dlopen OK`）。留档：`build/113/ISSUE-for-LLVM-wasm.md` + `ISSUE-1-verify-comment.md`。
- **车道架构纯度闸门（用户点令：一线一架构）**：新增 `build/113/check-lane-purity.py`
  （判据①宿主②车道 `.oct`③站点**本档专属**目录；fail-closed + 零值守卫；自证 6 条），
  已接进 `promote-w64-lane.sh` 第 5 步自检并**三线各推一份**。
  实测：8761 w64 ✓ / master w64 ✓ / wasm32 ✓ 三处同档。

- **三线 6.0.12 全部跑通并推送（2026-10-11→12）**：三条线各自在 emsdk 6.0.12 下重编、
  浏览器侧验收、推送 —— **local = origin = mirror 三处一致**：
  | 线 | 产物（verdict=ok） | 浏览器侧验收 | 分支头（三处一致） |
  |---|---|---|---|
  | IllegalPerformance（8761 现役） | w64 `8c535553…` / w64-base `f7139099…` | 全量 PROBES=1 全绿（唯一红 probe-octc-spike=环境性） | `860307f` |
  | master（wasm64-NEXT） | w64 `1ff6a111…` | 数值六套 107/0 + IEEE 逐位一致 + gfx-render 14/0 | `ea3d02d` |
  | wasm32-final（冻结线） | product `f1c0d21b…` | 数值六套全 0 FAIL + IEEE 逐位一致 + 宽套件大幅转绿 | `c09e6d0` |
  **两条验收纪律（本日实测踩到，别重犯）**：
  ① **验某一线必须让页面真跑它** —— 带 COI 的四格站会让页面静默选 `w64/`（在别的线产物上
  跑本线验收）；单档站（删 `threads/ w64/ w64-base/ lanes.js` + `--no-coi`）才可信。
  ② **源码修了 ≠ 站点跑的是修过的** —— `site/assets/m/*.js` 是打好的 bundle 快照；
  判据 = 用 `build/assets.py bundle-m` 重生成比 sha，且**挂载点必须逐字读
  `build/assets-meta.json` 的 `mount`**（`pkgfix` 挂 `m/pkg` 不是默认 —— 我按默认猜过，已纠正）。
- **两条冻结线的已知边界（非回归）**：Forge 按需拉取（`OctaveAssets.catalog/install`）只在
  本线落地（`ef912a1` 起），master 与 wasm32-final 未移植 ⇒ 那两线 `accept-forge-ondemand`
  的 A0 必然红（两线实测同形）。
- **本批新踩的第三个 6.x 假阳（口径已搬进代码）**：emcc 6.x sysroot 有 `<omp.h>` 无
  libomp ⇒ configure 探到 `-fopenmp` 可用 ⇒ 后续库探测带它 ⇒ 要求 shared-memory ⇒
  glpk（无 atomics）链不过 ⇒ `HAVE_GLPK` undef ⇒ **`__glpk__.oct` 出厂即空桩**
  （1494B、0 个 glp_ 符号），而构建/链接/自检全绿。修法固化进
  `build/113/configure-113-full.sh`：`ac_cv_func_omp_get_num_threads=no`
  `ax_cv_c_openmp=none` `ax_cv_cxx_openmp=none`。
- **既存形态（非本批引入，如实记）**：`accept-gfx-isolation` 的 C/C2 反向断言在
  **8761 现役上同样红**（A/B 各 13/0 全过）⇒ 是图形守卫 `gfxGuard()` 报告通道的既存
  缺口，与本轮三线重编无关。
- **既存闪烁（非本批引入，如实记）**：`accept-embed-api` 在 **sweep 并发**下偶发 1 条红
  （B 的 `on.output` 订阅偶发收不到 marker），**单跑 4/4 全 13/0 绿**（本批复验 4 次），
  且在 8768 全量里也是 13/0。⇒ 并发负载下的时序竞态，与 T4 无关（本批没碰 embed 通道）。


- **emsdk 6.0.12 已发运 8761（2026-10-11，落地批闭环）**：w64 两档 =
  治理化重链产物（`LANE_TAG` 旋钮，`verdict=ok`），sha 看台账
  `w64_wasm_sha`/`w64_base_wasm_sha`。发运链：farm 补库（freetype 2.14.3 离线
  供给 + fontconfig/gl2ps）→ 树全配方重编（+ omp 缓存变量 + **rust-sort seam 回补**
  ——试点树供错了源，缺 pin f4bf15b 的 Array-base.cc 缝 ⇒ sort 慢 2.2×）→
  `E2_OPENBLAS` 重链（试点漏 ⇒ BLAS 慢 8×）→ 独立站全量全绿 →
  promote 8768（全量全绿）→ promote 8761（全量 `PROBES=1` 除环境性探针外全绿，
  唯一红与 8772 同为 probe-octc-spike）→ 三层 SHA ✓ → dist 包内 sha == 部署件 ✓ →
  parity 三处一致 ✓。IEEE 双站逐位一致；BLAS/sort 基准
  持平。机制与复跑命令全在 `build/113/NOTES-emsdk-upgrade.md`（§7.5 keep-list
  跨版本重生成、§7.6 `<omp.h>` 无实现、§8.7 落地批全记录）。
  **遗留**：master 线/wasm32-final 未重编（§8.7 如实留单）。
- **断电恢复（2026-10-11）**：容器 o113 与三处站点服务被杀（§5.86 同款），
  已 `docker start` + `serve-coi.py` 重启，doctor 复验 **ok**、8761 BOOT OK；
  git 无损失（断电时被掐断的那次提交内容原样落在暂存区，已补提交）。

- **Forge 按需拉取插件系统 v1 已跑通并**发运**（2026-10-09/10，issue 64）**：客户端**用到才拉**——
  `OctaveAssets.catalog()` 读站点货架（**0 包下载**）、`OctaveAssets.install(name)` 拉包 + 依赖闭包
  + sha256 校验 + 委托引擎内建 `gunzip`/`untar` 解包 + 按 `pkg install` 布局落盘。
  **货架 = 独立仓 `Octave-Forge-Shelf`**（submodule；只含元数据，每包一文件）
  ⇒ pin 由 submodule commit 承载、字节由 sha256 承载 ⇒ **能力与包数解耦**（加包 = 加一个文件）。
  站点目录 = `build/forge-catalog.py`（Octave 版本**从 fork 的 configure.ac 读**）；
  验收 = `test/browser/accept-forge-ondemand.mjs` **15/15**（含 3 条反向断言 + 按需性双向证据）；
  台账键 `forge_shelf_packs` / `forge_catalog_packs` 等 6 条。**v1 覆盖全部 10 个货架包**
  （`.m` 部分；`src/` 是可选加速件）。**已发运 8768/8761/仓库 `site/`**（装配件与已验收快照
  逐字节对拍）；新闸门 `build/113/check-forge-catalog.py`（目录↔货架↔镜像字节，自证 9 条，
  挂 pre-commit）。**v2（含编译件包的 `.oct` 按需）未做**，设计稿 §10 留单。

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
- **worker 模式（`?worker=1`）曾整条坏，已修（2026-10-10）**：`bridge/index.html` 的 worker
  分支调 `octaveUiAppend`，而那函数在 `9239cae`（抽页面适配器）时被删除 ⇒ 第一次输出合批抛
  `ReferenceError` 且缓冲清空在其**后** ⇒ **每条 `OctaveWorker.eval` 永不 settle**（页面看似
  卡死）。修法 = 分支内定义 `appendOutput` + `flushUi` 先清后写。实测 `accept-worker`
  **21/0**、`probe-engine-parity` **22/0**（修前两者分别挂到 425s/NO-SUMMARY）。**随本批发运。**
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
| `accept_pass` | **1161** | 2026-10-14T12:42:49+0800 | `同上，把每个套件的 PASS 相加` |
| `accept_suites` | **48** | 2026-10-14T12:42:49+0800 | `数 /mnt/hdd/octave-wasm-build/sweep-logs/20261013-094057 里带汇总行的套件（且 0 FAIL）` |
| `build_json_sha` | `d953d7a7929754be…` | 2026-10-14T12:42:49+0800 | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.build.json | cut -d' ' -f1` |
| `data_sha` | `f250530ae5abe378…` | 2026-10-14T12:42:49+0800 | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.data | cut -d' ' -f1` |
| `dist_lane_probe_fail` | **0** | 2026-10-14T12:42:49+0800 | `同上` |
| `dist_lane_probe_pass` | **33** | 2026-10-14T12:42:49+0800 | `cd <dist 包目录> && python3 serve.py 8788；再 SITE_DIR=<dist 包目录> sh build/sweep.sh http://127.0.0.1:8788/ probe-lane > w64-logs/dist-probe-lane.log` |
| `e2_lu800_ratio` | **1.4** | 2026-10-14T12:42:49+0800 | `上面两行的比值（车道 / E2）` |
| `e2_lu800_s` | **0.043** | 2026-10-14T12:42:49+0800 | `同 E2 那一行` |
| `e2_matmul500_ratio` | **1.9** | 2026-10-14T12:42:49+0800 | `上面两行的比值（车道 / E2）` |
| `e2_matmul500_s` | **0.021** | 2026-10-14T12:42:49+0800 | `E2 单线程站点跑 bench-core.mjs（见 NOTES 的 A/B 表）` |
| `e2_single_verdict` | **ok** | 2026-10-14T12:42:49+0800 | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/e2-artifacts/single/octave.build.json）` |
| `e2_single_wasm_bytes` | **29495868** | 2026-10-14T12:42:49+0800 | `stat -c %s /mnt/hdd/octave-wasm-build/e2-artifacts/single/octave.wasm` |
| `e2_single_wasm_sha` | `e570905ecc8927bf…` | 2026-10-14T12:42:49+0800 | `sha256sum /mnt/hdd/octave-wasm-build/e2-artifacts/single/octave.wasm | cut -d' ' -f1` |
| `e2_threaded_lu800_s` | **0.02** | 2026-10-14T12:42:49+0800 | `同上` |
| `e2_threaded_matmul500_ratio` | **6.7** | 2026-10-14T12:42:49+0800 | `车道 / 线程版（派生）` |
| `e2_threaded_matmul500_s` | **0.006** | 2026-10-14T12:42:49+0800 | `E2 线程版站点跑 bench-core.mjs（该轮 300s 超时收尾，只到前几项）` |
| `e2_threaded_oct_rc` | **124** | 2026-10-14T12:42:49+0800 | `timeout 600 sh test/browser/run.sh ...accept-113-oct.mjs <E2 线程版站点>; echo $?` |
| `e2_threaded_verdict` | **ok** | 2026-10-14T12:42:49+0800 | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/e2-artifacts/threaded/octave.build.json）` |
| `e2_threaded_wasm_bytes` | **29908917** | 2026-10-14T12:42:49+0800 | `stat -c %s /mnt/hdd/octave-wasm-build/e2-artifacts/threaded/octave.wasm` |
| `e2_threaded_wasm_sha` | `bce7e4cc252d6481…` | 2026-10-14T12:42:49+0800 | `sha256sum /mnt/hdd/octave-wasm-build/e2-artifacts/threaded/octave.wasm | cut -d' ' -f1` |
| `emcc6_probe_geomean` | **1.001** | 2026-10-14T12:42:49+0800 | `sh test/fixtures/emcc6-probe/run-probe.sh 1（读 w64-logs/emcc6-probe.log 的 geomean 行）` |
| `env_vars` | **33** | 2026-10-14T12:42:49+0800 | `grep -oE '\$\{[A-Za-z0-9_]+:[-+]' /mnt/hdd/zcode-projects/Octave-Full-Wasm/build/113/link-web.sh | sort -u（去掉位置参数）` |
| `exported_functions` | **710** | 2026-10-14T12:42:49+0800 | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.exported_functions` |
| `floor_matrix_engines` | **4** | 2026-10-14T12:42:49+0800 | `数 w64-logs/floor-*.log 里 `· ① 页面 ready` 判据行的引擎名（去重）` |
| `floor_matrix_fail` | **0** | 2026-10-14T12:42:49+0800 | `同上` |
| `floor_matrix_pass` | **16** | 2026-10-14T12:42:49+0800 | `同上（各日志结尾的 `=== N PASS / M FAIL ===` 求和）` |
| `fonts_count` | **8** | 2026-10-14T12:42:49+0800 | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.fonts` |
| `forge_catalog_oct_packs` | **0** | 2026-10-14T12:42:49+0800 | `python3 -c "import json;print(len([p for p in json.load(open('/mnt/hdd/octave-wasm-build/site/assets/forge-catalog.json'))['packs'] if 'oct' in (p.get('kinds') or [])]))"` |
| `forge_catalog_octave` | **11.3.0** | 2026-10-14T12:42:49+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/site/assets/forge-catalog.json'))['octave'])"` |
| `forge_catalog_packs` | **12** | 2026-10-14T12:42:49+0800 | `python3 -c "import json;print(len(json.load(open('/mnt/hdd/octave-wasm-build/site/assets/forge-catalog.json'))['packs']))"` |
| `forge_catalog_shelf_commit` | **980e0933dd90** | 2026-10-14T12:42:49+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/site/assets/forge-catalog.json'))['shelf_commit'])" | cut -c1-12` |
| `forge_shelf_packs` | **12** | 2026-10-14T12:42:49+0800 | `ls shelf/packages/*.json | wc -l` |
| `forge_shelf_verified` | **12** | 2026-10-14T12:42:49+0800 | `grep -l '"verified": {' shelf/packages/*.json | wc -l` |
| `hotpath_fft_blktrans_pct` | **19.1** | 2026-10-14T12:42:49+0800 | `python3 build/113/hotpath.py profile 'x=(1:2e6)/1e6; tic; for k=1:10, y=fft(x); end' --lane w64` |
| `hotpath_instrument_ok` | **ok** | 2026-10-14T12:42:49+0800 | `python3 build/113/hotpath.py calibrate` |
| `hotpath_top` | **exp_inline 23.6%** | 2026-10-14T12:42:49+0800 | `读 /mnt/hdd/octave-wasm-build/hotpath-logs/20261005-142643/report.json 的 hotspots[0]（重活 ⇒ 不逐字复跑）` |
| `hotpath_xpow_driver_pct` | **39.5** | 2026-10-14T12:42:49+0800 | `同上（elem_xpow + do_rc_map）` |
| `hotpath_xpow_libm_pct` | **48.9** | 2026-10-14T12:42:49+0800 | `python3 build/113/hotpath.py profile 'x=(1:2e6)/1e6+0.1; tic; for k=1:20, y=sqrt(x)+x.^0.7; end' --lane w64（读 w64-logs/hotpath-final3.log）` |
| `hw_apis_available` | **3** | 2026-10-14T12:42:49+0800 | `python3 -c "import json;d=json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-webgpu-capability.json'))['hw'];print(sum(1 for k in ('serial','usb','hid') if d.get(k)))"` |
| `ip_vs_next_sort_ip_ms` | **0.105** | 2026-10-14T12:42:49+0800 | `sh test/browser/run.sh test/browser/bench-lanes.mjs <8761> w64（读 w64-logs/bench-IP-vs-NEXT.log）` |
| `ip_vs_next_sort_next_ms` | **0.237** | 2026-10-14T12:42:49+0800 | `同（<8869>）` |
| `ip_vs_next_sort_ratio` | **0.443** | 2026-10-14T12:42:49+0800 | `派生：IP ÷ NEXT` |
| `js_sha` | `caac68bf62015859…` | 2026-10-14T12:42:49+0800 | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.js | cut -d' ' -f1` |
| `jspi_entry` | **True** | 2026-10-14T12:42:49+0800 | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.jspi_entry` |
| `lane6012_ip_verdict` | **ok** | 2026-10-14T12:42:49+0800 | `cat /mnt/hdd/octave-wasm-build/w64-logs/lane6012-ip.verdict` |
| `lane6012_master_verdict` | **ok** | 2026-10-14T12:42:49+0800 | `cat /mnt/hdd/octave-wasm-build/w64-logs/lane6012-master.verdict` |
| `lane6012_ok_lines` | **3** | 2026-10-14T12:42:49+0800 | `grep -l '^ok$' /mnt/hdd/octave-wasm-build/w64-logs/lane6012-*.verdict | wc -l` |
| `lane6012_wasm32_verdict` | **ok** | 2026-10-14T12:42:49+0800 | `cat /mnt/hdd/octave-wasm-build/w64-logs/lane6012-wasm32.verdict` |
| `lane_lu800_s` | **0.06** | 2026-10-14T12:42:49+0800 | `同车道那一行` |
| `lane_matmul500_s` | **0.04** | 2026-10-14T12:42:49+0800 | `现役车道站点跑同一个 bench-core.mjs` |
| `libm_spike_geomean` | **0.964** | 2026-10-14T12:42:49+0800 | `sh build/113/bench-libm-spike.sh 8（读 w64-logs/libm-spike-verdict.txt 的 geomean 行）` |
| `locale_contract_lanes` | **4** | 2026-10-14T12:42:49+0800 | `for l in w64 base threads w64-base; do sh test/browser/run.sh test/browser/probe-locale.mjs "http://127.0.0.1:8761/?lane=$l"; done （读 w64-logs/locale-all-lanes.log 的 '8 PASS / 0 FAIL' 计数）` |
| `matrix_page_sha` | `54a7e1c261a2df2f…` | 2026-10-14T12:42:49+0800 | `sha256sum /mnt/hdd/octave-wasm-build/site/matrix-android.html | cut -d' ' -f1` |
| `mem_live_ceiling_gib` | **7.45** | 2026-10-14T12:42:49+0800 | `HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/probe-heap-ceiling.mjs http://127.0.0.1:8761/ > w64-logs/heap-ceiling.log` |
| `native_netlib_loop1e6_s` | **0.500141** | 2026-10-14T12:42:49+0800 | `sh build/113/bench-native.sh` |
| `native_netlib_lu1500_s` | **0.25765** | 2026-10-14T12:42:49+0800 | `sh build/113/bench-native.sh` |
| `native_netlib_lu800_s` | **0.04076** | 2026-10-14T12:42:49+0800 | `sh build/113/bench-native.sh` |
| `native_netlib_matmul1000_s` | **0.196202** | 2026-10-14T12:42:49+0800 | `sh build/113/bench-native.sh` |
| `native_netlib_matmul500_s` | **0.027249** | 2026-10-14T12:42:49+0800 | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` |
| `native_openblas_lu1500_s` | **0.040473** | 2026-10-14T12:42:49+0800 | `sh build/113/bench-native.sh` |
| `native_openblas_lu800_s` | **0.026146** | 2026-10-14T12:42:49+0800 | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` |
| `native_openblas_matmul1000_s` | **0.009586** | 2026-10-14T12:42:49+0800 | `sh build/113/bench-native.sh` |
| `native_openblas_matmul1024_s` | **0.008517** | 2026-10-14T12:42:49+0800 | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` |
| `native_openblas_matmul2000_s` | **0.050018** | 2026-10-14T12:42:49+0800 | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` |
| `native_openblas_matmul500_s` | **0.003212** | 2026-10-14T12:42:49+0800 | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` |
| `native_openblas_threads` | **24** | 2026-10-14T12:42:49+0800 | `sh build/113/bench-native.sh（机器空闲时跑；写 w64-logs/native-baseline.json）` |
| `oct_base_files` | **16** | 2026-10-14T12:42:49+0800 | `find /mnt/hdd/octave-wasm-build/site/assets/oct -name '*.oct' | wc -l` |
| `oct_lane_files` | **16** | 2026-10-14T12:42:49+0800 | `find /mnt/hdd/octave-wasm-build/site/assets/oct-threads -name '*.oct' | wc -l` |
| `oct_lane_octdir_files` | **28** | 2026-10-14T12:42:49+0800 | `find /mnt/hdd/octave-wasm-build/site/assets/octdir-threads -name '*.oct' | wc -l` |
| `oct_lane_tls_init` | **44** | 2026-10-14T12:42:49+0800 | `python3 build/113/check-oct-lane.py <站点>/assets/oct-threads <站点>/assets/octdir-threads --base <站点>/assets/oct <站点>/assets/octdir` |
| `octave_pin` | **f4bf15b792bf** | 2026-10-14T12:42:49+0800 | `git -C upstream/octave rev-parse --short=12 HEAD` |
| `octdir_base_files` | **28** | 2026-10-14T12:42:49+0800 | `find /mnt/hdd/octave-wasm-build/site/assets/octdir -name '*.oct' | wc -l` |
| `probe_lane_fail` | **0** | 2026-10-14T12:42:49+0800 | `同上（脚本结尾的 `=== N PASS / M FAIL ===`）` |
| `probe_lane_pass` | **33** | 2026-10-14T12:42:49+0800 | `SITE_DIR=<站点> sh test/browser/run.sh test/browser/probe-lane.mjs > /mnt/hdd/octave-wasm-build/probe-lane.log` |
| `rust_fill_spike_ratio` | **1.094** | 2026-10-14T12:42:49+0800 | `sh test/fixtures/rustfill-spike/run-spike.sh（读 w64-logs/rustfill-spike.log 的比值行）` |
| `rust_sort_spike_base_ms` | **352.0** | 2026-10-14T12:42:49+0800 | `sh test/fixtures/rustsort-spike/run-spike.sh（读 w64-logs/rustsort-spike.log）` |
| `rust_sort_spike_cand_ms` | **87.0** | 2026-10-14T12:42:49+0800 | `同上` |
| `rust_sort_spike_ratio` | **0.249** | 2026-10-14T12:42:49+0800 | `派生：cand ÷ base` |
| `sympy_assets_bytes` | **6757104** | 2026-10-14T12:42:49+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-pyodide-sympy.json'))['bytes']['disk']['coreTar'])"` |
| `sympy_import_ms_pyc` | **380** | 2026-10-14T12:42:49+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/sympy-pyc-ab.json'))['summary']['importB_ms'])"` |
| `sympy_import_ms_source` | **2757** | 2026-10-14T12:42:49+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/sympy-pyc-ab.json'))['summary']['importA_ms'])"` |
| `sympy_perf_cold_start_ms` | **2276** | 2026-10-14T12:42:49+0800 | `python3 -c "import json;d=json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/sympy-perf-pyodide.json'))['timings'];print(round(d['load']+d['pkg']))"` |
| `sympy_perf_pyodide_over_native` | **2.01** | 2026-10-14T12:42:49+0800 | `python3 test/fixtures/sympy-perf/compare.py（读最后一行 JSON 的 geo）` |
| `sympy_pyc_bytes_ratio` | **3.28** | 2026-10-14T12:42:49+0800 | `python3 -c "import json;d=json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/sympy-pyc-ab.json'))['summary']['bytes'];print(round(d['B']/d['A'],2))"` |
| `sympy_pyc_cold_geo_speedup` | **1.29** | 2026-10-14T12:42:49+0800 | `python3 test/fixtures/sympy-perf/compare-pyc.py（读 cold_geo_speedup）` |
| `sympy_pyc_compile_calls` | **0** | 2026-10-14T12:42:49+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/sympy-pyc-ab.json'))['summary']['sourceToCode']['B'])"` |
| `sympy_pyc_import_speedup_pyodide` | **7.4** | 2026-10-14T12:42:49+0800 | `python3 test/fixtures/sympy-perf/compare-pyc.py（读末行 JSON 的 import_s.speedup）` |
| `sympy_pyc_speedup` | **7.26** | 2026-10-14T12:42:49+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/sympy-pyc-ab.json'))['summary']['speedup'])"` |
| `sympy_pyc_steady_geo_ratio` | **0.99** | 2026-10-14T12:42:49+0800 | `python3 test/fixtures/sympy-perf/compare-pyc.py（读 steady_geo_ratio）` |
| `sympy_pyodide_break_fails_loud` | **True** | 2026-10-14T12:42:49+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-pyodide-sympy.json'))['modes'][2]['result']['ok'])"` |
| `sympy_pyodide_diff` | **cos(x)** | 2026-10-14T12:42:49+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-pyodide-sympy.json'))['modes'][0]['result']['diff'])"` |
| `sympy_pyodide_nocoi_ok` | **True** | 2026-10-14T12:42:49+0800 | `python3 -c "import json;d=json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-pyodide-sympy.json'))['modes'];print(d[1]['result']['ok'], d[1]['result']['diff'])"` |
| `sympy_pyodide_ok` | **True** | 2026-10-14T12:42:49+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-pyodide-sympy.json'))['modes'][0]['result']['ok'])"` |
| `threads_blas_dir` | **/src/work/e2-openblas-lib-s** | 2026-10-14T12:42:49+0800 | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 inputs.blas.resolved_dir` |
| `threads_exported_functions` | **725** | 2026-10-14T12:42:49+0800 | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 measured.exported_functions` |
| `threads_pthread_glue` | **54** | 2026-10-14T12:42:49+0800 | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 measured.threads.pthread_glue` |
| `threads_shared_memory` | **True** | 2026-10-14T12:42:49+0800 | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 measured.threads.shared_memory` |
| `threads_v128` | **4926** | 2026-10-14T12:42:49+0800 | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 measured.simd.v128` |
| `threads_verdict` | **ok** | 2026-10-14T12:42:49+0800 | `读 /mnt/hdd/octave-wasm-build/site/threads/octave.build.json 的 verdict` |
| `threads_wasm_bytes` | **29495868** | 2026-10-14T12:42:49+0800 | `stat -c%s /mnt/hdd/octave-wasm-build/site/threads/octave.wasm` |
| `threads_wasm_sha` | `e570905ecc8927bf…` | 2026-10-14T12:42:49+0800 | `sha256sum /mnt/hdd/octave-wasm-build/site/threads/octave.wasm | cut -d' ' -f1` |
| `upstream_submodule_count` | **19** | 2026-10-14T12:42:49+0800 | `git submodule status | wc -l` |
| `w64_base_shared_memory` | **False** | 2026-10-14T12:42:49+0800 | `读 /mnt/hdd/octave-wasm-build/w64-base-artifacts 的 measured.threads.shared_memory` |
| `w64_base_verdict` | **ok** | 2026-10-14T12:42:49+0800 | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/w64-base-artifacts/octave.build.json）` |
| `w64_base_wasm64` | **True** | 2026-10-14T12:42:49+0800 | `读 /mnt/hdd/octave-wasm-build/w64-base-artifacts 的 measured.wasm64` |
| `w64_base_wasm_bytes` | **29970457** | 2026-10-14T12:42:49+0800 | `stat -c %s /mnt/hdd/octave-wasm-build/w64-base-artifacts/octave.wasm` |
| `w64_base_wasm_sha` | `f71390990d8f1428…` | 2026-10-14T12:42:49+0800 | `sha256sum /mnt/hdd/octave-wasm-build/w64-base-artifacts/octave.wasm | cut -d' ' -f1` |
| `w64_big_heap` | **True** | 2026-10-14T12:42:49+0800 | `同上（探针结尾的 `W64_BIG_HEAP=` 行）` |
| `w64_build_recipe_ok` | **ok** | 2026-10-14T12:42:49+0800 | `python3 build/113/witness-build-inputs.py` |
| `w64_build_tool_match` | **match** | 2026-10-14T12:42:49+0800 | `<重链 w64 后：python3 build/113/witness-build-provenance.py w64>` |
| `w64_cand_exported_functions` | **751** | 2026-10-14T12:42:49+0800 | `读 /mnt/hdd/octave-wasm-build/w64-artifacts-mimalloc 的 measured.exported_functions` |
| `w64_cand_loop1e6_s` | **0.574** | 2026-10-14T12:42:49+0800 | `同上（loop 1e6）` |
| `w64_cand_lu800_s` | **0.014** | 2026-10-14T12:42:49+0800 | `同上（lu 800）` |
| `w64_cand_malloc` | **mimalloc** | 2026-10-14T12:42:49+0800 | `读 /mnt/hdd/octave-wasm-build/w64-artifacts-mimalloc 的 declared.malloc / measured.malloc` |
| `w64_cand_matmul500_s` | **0.005** | 2026-10-14T12:42:49+0800 | `<交错 3 轮取中位：HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/bench-lanes.mjs http://127.0.0.1:8861/ w64（×3 ⇒ w64-logs/bench-mi2-r1..3.log）>` |
| `w64_cand_verdict` | **ok** | 2026-10-14T12:42:49+0800 | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/w64-artifacts-mimalloc/octave.build.json）` |
| `w64_cand_vs_ship_lu800` | **1.0** | 2026-10-14T12:42:49+0800 | `派生：同上（lu 800）` |
| `w64_cand_vs_ship_matmul500` | **1.25** | 2026-10-14T12:42:49+0800 | `派生：w64-logs/bench-mi2-r1..3.log 的中位 ÷ bench-ship2-r1..3.log 的中位` |
| `w64_cand_wasm_bytes` | **30984954** | 2026-10-14T12:42:49+0800 | `stat -c %s /mnt/hdd/octave-wasm-build/w64-artifacts-mimalloc/octave.wasm` |
| `w64_cand_wasm_sha` | `01fb52fc3b5dde30…` | 2026-10-14T12:42:49+0800 | `sha256sum /mnt/hdd/octave-wasm-build/w64-artifacts-mimalloc/octave.wasm | cut -d' ' -f1` |
| `w64_exported_functions` | **750** | 2026-10-14T12:42:49+0800 | `读 /mnt/hdd/octave-wasm-build/w64-artifacts 的 measured.exported_functions` |
| `w64_i64_insns` | **4175689** | 2026-10-14T12:42:49+0800 | `llvm-objdump -d <w64>/octave.wasm | grep -c i64（由 build/113/build-w64-lane.sh facts 写出，容器内跑）` |
| `w64_lu800_s` | **0.079** | 2026-10-14T12:42:49+0800 | `HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/bench-lanes.mjs http://127.0.0.1:8761/ w64 > w64-logs/speed-w64.log` |
| `w64_malloc` | **mimalloc** | 2026-10-14T12:42:49+0800 | `读 /mnt/hdd/octave-wasm-build/w64-artifacts 的 declared.malloc / measured.malloc` |
| `w64_matmul500_s` | **0.048** | 2026-10-14T12:42:49+0800 | `HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/bench-lanes.mjs http://127.0.0.1:8761/ w64 > w64-logs/speed-w64.log` |
| `w64_mem_5g_bytes` | **5242880000** | 2026-10-14T12:42:49+0800 | `sh test/browser/run.sh test/browser/probe-wasm64-mem.mjs > /mnt/hdd/octave-wasm-build/w64-logs/mem-probe.log` |
| `w64_mem_8g_bytes` | **8589934592** | 2026-10-14T12:42:49+0800 | `sh test/browser/run.sh test/browser/probe-wasm64-mem.mjs > /mnt/hdd/octave-wasm-build/w64-logs/mem-probe.log` |
| `w64_mem_probe_fail` | **0** | 2026-10-14T12:42:49+0800 | `同上（脚本结尾的 `=== N PASS / M FAIL ===`）` |
| `w64_mem_shared_5g_bytes` | **5242880000** | 2026-10-14T12:42:49+0800 | `sh test/browser/run.sh test/browser/probe-wasm64-mem.mjs > /mnt/hdd/octave-wasm-build/w64-logs/mem-probe.log` |
| `w64_ob_lib_wasm32_members` | **0** | 2026-10-14T12:42:49+0800 | `同上` |
| `w64_ob_lib_wasm64_members` | **1557** | 2026-10-14T12:42:49+0800 | `E2_LANE=w64 docker exec o113 bash /src/bin/build-e2-lane.sh src patch build > w64-logs/e2-w64-build.log（读那行架构断言）` |
| `w64_ob_lu800_s` | **0.014** | 2026-10-14T12:42:49+0800 | `同上（8761 现役那轮）` |
| `w64_ob_matmul1000_native_ratio` | **0.38** | 2026-10-14T12:42:49+0800 | `派生：native-baseline.json 的 openblas24.matmul1000 ÷ bench-ob-w64.log 的 matmul 1000` |
| `w64_ob_matmul500_native_ratio` | **1.07** | 2026-10-14T12:42:49+0800 | `派生：w64-logs/native-baseline.json 的 openblas24.matmul500 ÷ w64-logs/bench-ob-w64.log 的 matmul 500` |
| `w64_ob_matmul500_s` | **0.003** | 2026-10-14T12:42:49+0800 | `HARNESS=/mnt/hdd/octave-wasm-build/harness sh test/browser/run.sh test/browser/bench-lanes.mjs http://127.0.0.1:8761/ w64 > w64-logs/bench-ob-w64.log` |
| `w64_ob_matmul500_speedup` | **15.3** | 2026-10-14T12:42:49+0800 | `派生：w64-logs/bench-ship-w64.log 的 matmul 500 ÷ w64-logs/bench-ob-w64.log 的同项` |
| `w64_ob_matmul500_vs_netlib` | **9.1** | 2026-10-14T12:42:49+0800 | `派生：w64-logs/native-baseline.json 的 netlib.matmul500 ÷ w64-logs/bench-ob-w64.log 的 matmul 500` |
| `w64_oct_files` | **46** | 2026-10-14T12:42:49+0800 | `同上（文件名：oct-wasm64.txt 的第二个数）` |
| `w64_oct_wasm64` | **46** | 2026-10-14T12:42:49+0800 | `bash build-w64-lane.sh facts（容器内；用 /emsdk/upstream/bin/llvm-readobj 逐个量）` |
| `w64_relaxed_madd` | **6** | 2026-10-14T12:42:49+0800 | `<重活：产物 + test/fixtures/relaxed_madd_min.wasm 各数 fd 87 02>` |
| `w64_rustsort_ab_asc_ms` | **165** | 2026-10-14T12:42:49+0800 | `bash build/113/sort-ab.sh /mnt/hdd/octave-wasm-build/site-illegalperf /mnt/hdd/octave-wasm-build/site-illegalperf-baseline 3（读 w64-logs/rust-sort-ab.log）` |
| `w64_rustsort_ab_asc_ratio` | **0.506** | 2026-10-14T12:42:49+0800 | `派生：候选 ÷ 对照（asc 中位）` |
| `w64_rustsort_ab_desc_ratio` | **0.551** | 2026-10-14T12:42:49+0800 | `派生：候选 ÷ 对照（desc 中位）` |
| `w64_rustsort_base_ab_ms` | **326** | 2026-10-14T12:42:49+0800 | `同上` |
| `w64_rustsort_cand_sha` | `f6fec91fc7a0f4b8…` | 2026-10-14T12:42:49+0800 | `sha256sum /mnt/hdd/octave-wasm-build/artifacts-w64-rust-on/octave.wasm | cut -d' ' -f1` |
| `w64_shared_memory` | **True** | 2026-10-14T12:42:49+0800 | `读 /mnt/hdd/octave-wasm-build/w64-artifacts 的 measured.threads.shared_memory` |
| `w64_v128` | **6295** | 2026-10-14T12:42:49+0800 | `读 /mnt/hdd/octave-wasm-build/w64-artifacts 的 measured.simd.v128` |
| `w64_verdict` | **ok** | 2026-10-14T12:42:49+0800 | `python3 build/facts.py（读 /mnt/hdd/octave-wasm-build/w64-artifacts/octave.build.json）` |
| `w64_vs_netlib_loop1e6` | **0.67** | 2026-10-14T12:42:49+0800 | `派生：native-baseline.json 的 netlib.loop1e6 ÷ bench-ob-w64.log 的 loop 1e6` |
| `w64_vs_netlib_lu1500` | **3.8** | 2026-10-14T12:42:49+0800 | `派生：native-baseline.json 的 netlib.lu1500 ÷ bench-ob-w64.log 的 lu 1500` |
| `w64_vs_netlib_matmul1000` | **7.8** | 2026-10-14T12:42:49+0800 | `派生：native-baseline.json 的 netlib.matmul1000 ÷ bench-ob-w64.log 的 matmul 1000` |
| `w64_wasm64` | **True** | 2026-10-14T12:42:49+0800 | `读 /mnt/hdd/octave-wasm-build/w64-artifacts 的 measured.wasm64` |
| `w64_wasm_bytes` | **31246703** | 2026-10-14T12:42:49+0800 | `stat -c %s /mnt/hdd/octave-wasm-build/w64-artifacts/octave.wasm` |
| `w64_wasm_sha` | `8c535553a2140ae4…` | 2026-10-14T12:42:49+0800 | `sha256sum /mnt/hdd/octave-wasm-build/w64-artifacts/octave.wasm | cut -d' ' -f1` |
| `wasm_bytes` | **29632229** | 2026-10-14T12:42:49+0800 | `stat -c%s /mnt/hdd/octave-wasm-build/site/octave.wasm` |
| `wasm_sha` | `1ed3e528561e4475…` | 2026-10-14T12:42:49+0800 | `sha256sum /mnt/hdd/octave-wasm-build/site/octave.wasm | cut -d' ' -f1` |
| `wasm_v128` | **4752** | 2026-10-14T12:42:49+0800 | `读 /mnt/hdd/octave-wasm-build/site/octave.build.json 的 measured.simd.v128` |
| `webgpu_main_device` | **OK** | 2026-10-14T12:42:49+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-webgpu-capability.json'))['main']['device'])"` |
| `webgpu_vendor` | **nvidia** | 2026-10-14T12:42:49+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-webgpu-capability.json'))['main']['vendor'])"` |
| `webgpu_worker_compute_ok` | **True** | 2026-10-14T12:42:49+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-webgpu-capability.json'))['worker']['computeOK'])"` |
| `webgpu_worker_device` | **OK** | 2026-10-14T12:42:49+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-webgpu-capability.json'))['worker']['device'])"` |
| `webgpu_worker_webgl2` | **True** | 2026-10-14T12:42:49+0800 | `python3 -c "import json;print(json.load(open('/mnt/hdd/octave-wasm-build/w64-logs/probe-webgpu-capability.json'))['worker']['webgl2'])"` |
| `xpow_driver_spike_pct` | **2.1** | 2026-10-14T12:42:49+0800 | `bash test/fixtures/xpow-spike/run-spike.sh（读 w64-logs/xpow-spike.log）` |
| `xpow_driver_spike_ratio` | **0.988** | 2026-10-14T12:42:49+0800 | `同上（cand/base）` |

164 条事实。
<!-- /AUTO:FACTS -->

<!-- AUTO:GATES -->
> 本区块由 `zreflect/facts.py --render-doc` 从发现式名录（zreflect/registry.py 的声明行）渲染，**不要手改**。
> 执行面（hooks / CI）读 `registry --run <相位>` —— 相位是声明字段（`runs_at`），不是文件名。

| 闸门 | 相位 | 它挡住什么 | 消费的旋钮 |
|---|---|---|---|
| `check_ab.py`（A/B 闸门） | commit | A/B 同旗标不变式（非 allow 轴差异 = 混淆变量，A/B 作废） | `REFLECT_AB` |
| `check_envfile.py`（env 文件闸门） | commit | 守钩子的 REFLECT_* 载体（旋钮 typo / 指向缺失 / 空值） | `REFLECT_ENV_FILE` |
| `check_facts.py`（事实闸门） | commit | 块一致性 / 裸数字 / 坏引用 | `REFLECT_FACTS`, `REFLECT_DOC`, `REFLECT_NAKED_MIN` |
| `check_facts_replay.py`（复跑闸门） | commit | 台账 cmd 逐字复跑（裸值契约：stdout 必须等于值） | `REFLECT_FACTS`, `REFLECT_REPLAY`, `REFLECT_REPLAY_TIMEOUT` |
| `check_instruments.py`（仪器生命周期闸门） | commit | 恒常检测（first_seen）+ 被证伪量法登记 | `REFLECT_INSTRUMENTS`, `REFLECT_INSTRUMENT_DAYS`, `REFLECT_FACTS` |
| `check_invariants.py`（不变量闸门） | commit | 声明式不变量：仓库文件必须/不得含某片段（grep 级） | `REFLECT_INVARIANTS` |
| `check_locks.py`（锁定源闸门） | commit | 锁定源清单（URL + 文件 + sha256 的内容指纹） | `REFLECT_LOCKS` |
| `check_pins.py`（pin 闸门） | commit | 派生树 pin 一致性（stamp commit / dirty / 版本串对读） | `REFLECT_PINS` |
| `check_questions.py`（悬案闸门） | commit | 未结案的问题必须挂一个能跑的结算件 | `REFLECT_QUESTIONS` |
| `check_readme_sync.py`（三语 README 闸门） | commit | 语言版本是同一条断言的三份拷贝：结构互链 + 每次推送同批 | `REFLECT_READMES` |
| `check_retractions.py`（翻案重现检测） | commit | 被推翻的断言不许悄悄回来当现状 | `REFLECT_RETRACTIONS`, `REFLECT_DOCS`, `REFLECT_HISTORY_SECS` |
| `check_stale.py`（陈旧断言检测） | commit | sha 出处 / 退役名 / 测龄 | `REFLECT_DOCS`, `REFLECT_FACTS`, `REFLECT_HISTORY_SECS`, `REFLECT_RETIRED`, `REFLECT_STALE_DAYS` |
| `check_world.py`（world 闸门） | commit | 声明式验证对象：多线仓库共享验证环境的世界对账 | `REFLECT_WORLD`, `REFLECT_WORLD_LINE` |
| `doctor.py`（开工预检 doctor） | start-of-work | 进程 / 端口活性（查会死的东西 ⇒ runs_at=start-of-work，不进 pre-commit） | `REFLECT_DOCTOR`, `REFLECT_DOCTOR_TIMEOUT` |

14 道闸门（发现式名录派生 —— 手写清单会漂，加闸门 = 落一个声明行，这里自动长出来）。
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
| 资产条目 | 50 | |
| 最近一次**全绿**回归 | `20261012-123844` · **1 套 / 18 PASS / 0 FAIL** | http://127.0.0.1:8775/ |
| 交付包 | `octave-full-wasm-site-20261013` · tar.zst 91,174,916 B · `979d3cf0d085e165…` | 包内 wasm （**与部署件同 sha** ✓） |
| 仓库 | 分支 `IllegalPerformance`（**HEAD 的 sha 与日期以 `git log -1` 为准，不写死在这里**） | |
<!-- /AUTO:STATE -->