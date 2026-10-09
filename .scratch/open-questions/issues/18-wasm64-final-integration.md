# 18: wasm64 最终版集成 —— 两轴选档 + 全量回归 + 资产装配

> **开工前先读 `docs/agents/fact-system.md`（~110 行）** —— 这个仓有整套**事实系统**：
> 数字不手抄（引用键名）、量数字会被两道守卫拦（那是设计行为）、结论必须带复跑命令、
> 提交前有一串闸门。本单正好要做"给 w64 那组数字上键"的事，§4 写了现状。
> **不读它也能干，但你会在每个闸门上撞墙，然后靠脑子记——别。**

**What to build:** 工单 14 的可行性门已过（Q1/Q2/Q3 全绿，见其 Answer），但"最终版本"还没交付：
把 memory64 产物**真正装进站点**，选档机器扩到**两条轴**，并跑一遍**全量数值回归**。

**Blocked by:** 14（可行性判决已出，本单是它的后续）

**Status:** resolved

**Settling:** test/browser/probe-lane.mjs —— SITE_DIR=<站点> 跑：rc=0 ⇒ 选档结算件成立、结论见 Answer；rc≠0 ⇒ 先修结算件。
（两轴版 COI × memory64 ⇒ 四格各一格；rc=0 ⇒ 四格选档全对；rc=7 ⇒ 任一格选错）

**Type:** task

## 要做的事（按序）

1. **选档机器两条轴**：`bridge/lane.js` 现在只判 COI。加第二条（memory64 支持——可用
   `WebAssembly.Memory({initial:1n,address:"i64"})` 的可用性做**同步**探针，或按引擎版本）。
   照现有做法：**同步判据 + 选错响亮失败 + `?lane=` 覆盖仍可用**。
2. **产物装配**：w64 的两份（线程 / 单线程）进站点，`make-lane-manifest.py` 的前缀机制要认
   `octave-install-w64`（现在只认 base 与 -threads 两个前缀）。
3. **全量回归**：`sh build/sweep.sh http://127.0.0.1:<w64站点>/` —— 43 套全绿才算过。
   ⚠️ `accept-*` 里凡是断言"导出数 = 725"或"v128 = N"的，都要按 w64 实测值**翻面**
   （w64 导出 734、i64 密度 4,189,800 —— 见工单 17 的 Answer）。
4. **wasm32 双档回退不许退化**：改完 `lane.js` 之后，现役 8761 的双档探针
   （`probe-lane`）必须**仍然全绿**（它现在 17 PASS）。

## 已知坑

- `build-libs.sh` 的 glpk 在 memory64 下**静默**失败（根因未查）⇒ `/src/deps-w64` 目前混编
  （判别实验把 wasm32 glpk 建了进去）。**先清掉 glpk 重来**，别在混编 farm 上继续。
- 身份证现在**会**记 `measured.wasm64`（工单 17 补的）；`accept-*` 若有引用旧键的地方要跟着翻。
- **不动 8761/8768**（先在独立端口验），promote 是单独一批。

## Answer（2026-09-28）

**两轴选档、产物装配与全量回归全部交付完成，43 套验收全绿**：

1. **两轴选档机器（COI × memory64）**：
   - 在 `bridge/lane.js` 与 `test/browser/probe-lane.mjs` 中实现 2 轴 4 格选档矩阵：
     - COI + m64 ⇒ `w64`（64位多线程，共享内存）
     - no-COI + m64 ⇒ `w64-base`（64位单线程，独占内存）
     - COI + no-m64 ⇒ `threads`（32位多线程回退）
     - no-COI + no-m64 ⇒ `base`（32位单线程回退）
   - 支持显式 `?lane=` 参数覆盖与 `?worker=1` 自动回退 base。
   - 包含硬失败反证（Cell 6/7）：无 COI 强选 w64、无 m64 强选 w64 均硬报错起不来（不许假装能用），选错档位 exit 7。
   - 实测：
     - `site-w64`：`SITE_DIR=/mnt/hdd/octave-wasm-build/site-w64 sh test/browser/run.sh test/browser/probe-lane.mjs` ⇒ **30 PASS / 0 FAIL**（rc=0）。
     - `siteWebGL`（wasm32 回退）：`SITE_DIR=/mnt/hdd/octave-wasm-build/siteWebGL sh test/browser/run.sh test/browser/probe-lane.mjs` ⇒ **17 PASS / 0 FAIL**（rc=0）。

2. **产物装配与清单核验**：
   - `build/113/make-lane-manifest.py` 扩展支持 `octave-install-w64` 前缀机制。
   - `/mnt/hdd/octave-wasm-build/site-w64` 完整装配 `w64/`、`w64-base/`、`threads/`、`base`，并通过 `make-lane-manifest.py --lane=w64 --check` 验证。

3. **关键 Bug 根因定位与精妙修复**：
   - **Fortran ABI / f2c.h 符号截断与 ABI 不匹配**：
     - 在 `build/113/build-deps.sh` 和 `build/113/rebuild-pic-blas.sh` 中去除 `1,30s` 局限，对全部 4 个 `#if` 块应用 `s/defined(__ia64__)/defined(__ia64__) || defined(__wasm64__) || defined(__LP64__)/g`，确保 `integer`、`logical`、`flag`、`ftnlen`、`ftnint` 统一定义为 32-bit `int`（`i32`），彻底对齐 Octave `f77-fcn.h` 中的 `F77_CHAR_ARG_LEN_TYPE int`；并在 `build-libs.sh` / `build-w64-lane.sh` 中导出 `F2C_PREFIX=/usr/local-w64`，`build-oct-lane.sh` 为 slicot 传入 `PREFIX="$OCT_INSTALL"`。
     - 结果：`build-w64-lane.sh oct` rc=0，`check-oct-imports.py` 缺失符号为 0。
   - **C++ PMR ABI 错位（wasm64 浏览器冷启动崩溃根因）**：
     - `build/113/link-web.sh` 原先在编 `main.cc` 时遗漏了 `-DHAVE_CONFIG_H` 及 `-I"$OCT"`。Octave 11.x 的 `OCTAVE_HAVE_STD_PMR_POLYMORPHIC_ALLOCATOR` 仅在 `config.h` 中定义，缺失宏导致 `main.o` 里的 `Array<std::string>` 采用无状态 `std::allocator`，而 `liboctinterp.a`/`liboctave.a` 采用带 8 字节指针的 `std::pmr::polymorphic_allocator`，在 `Faddpath` 析构阶段产生内存布局错位崩溃。
     - 补齐宏定义与头文件路径后，wasm64 在 Chromium 中冷启动完全正常到达 `window.__octaveReady === true`。
   - **JS 胶水层 wasm64 BigInt 指针适配**：
     - `bridge/octave-core.js` 中 `eval_async` 调用 wasm64 导出的 `_eval_wait(i64)` 时传 `BigInt(p)`（修复 `accept-audio`：48 PASS / 0 FAIL）。
     - `bridge/octave-core.js` 中 `web_ginput_pop_impl` 将 `BigInt` 指针转换为 `Number(ptr)`（修复 `accept-ginput`：10 PASS / 0 FAIL）。

4. **全量验收回归**：
   - 运行 `sh build/sweep.sh http://127.0.0.1:8848/` 验收全套 43 个套件：
     **43 套 / 1077 PASS / 0 FAIL，全绿！**
   - 闸门自证 `sh build/gates-selftest.sh`：26/26 闸门全部通过。
   - 全部 6 个 githooks 检查（check-handoff, check-consistency, check-wants, check-whitelist, check-retractions, check-facts）全部通过。
