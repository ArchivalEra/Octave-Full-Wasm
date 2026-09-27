# PLAN-threads.md · 浏览器内线程化 + 教材站嵌入（branch `Slay`）

> **接续先读**：本文件 §0.5（现在的状态与下一步顺序）。依据两份外部评审
> （`GPT-REVIEW-4-threads.md` 提问、`GPT-REVIEW-4-threads-reply.md` 复核）与
> **我方实测探针** `test/browser/probe-iframe-coi.mjs`。
> 本计划与 `PLAN-jspi.md`（已收口）**并列**：那条线管"可挂起入口/交互原语"，这条线管
> "并行度（SIMD / 线程 / Worker）与嵌入契约"。**产物（8761）在两线之间是同一个**。

---

## §0 依据（全部实测或逐字引用，不复述）

1. **嵌入契约（读官方 XSL 得出）**：教材站生成器把 `<interactive platform="javascript">` 渲染成
   **同源 iframe**，指向它现造的最小 HTML 页；作者的 JS 由 `@source`（路径相对 external 目录）注入，
   内联 `<script>` 在其后执行；iframe **不带 `allow`/`sandbox`**。
2. **Q10 实测（6 PASS / 0 FAIL）**：未 COI 的顶层里，iframe 自带 COOP/COEP **无效**（同源跨源皆然），
   `allow="cross-origin-isolated"` 无效 ⇒ **C7 否决**。
3. **C8 实测**（★ 2026-09-26 用两个新探针扩到三引擎，措辞按实测收窄）：
   引擎层 credentialless **Chromium ✓ / Firefox ✓ / WebKit ✗**（`probe-coep-engines.mjs` 6/0）；
   但**经 coi-serviceworker**（`probe-coi-sw.mjs` 7/2）只有 **Chromium** 拿到"COI + CDN 兼得"，
   Firefox/WebKit 装 SW 后 COI ✓ 而 CDN ✗；Firefox 两层矛盾 = **开放问题**（待查）。
4. **性能路线（引外部评审，待我方实验证实）**：OpenBLAS 官方 WASM 配置是 `WASM128_GENERIC` + 默认
   SIMD128 + **`USE_THREAD=0`**；Pyodide 历史 DGEMM 2–3×（单线程无 SIMD）；`dynamic linking + pthreads`
   已文档化但仍标 **experimental**（`MAIN_MODULE + -pthread` 有告警）。
5. **现状（本仓实测）**：refblas + f2c 纯标量；无 pthread/SAB/SIMD；`--disable-threads`；
   宿主层按单例设计（固定 DOM id / 固定 window 全局 / 资源 URL 基准分裂）。

---

## §0.5 现在的状态与下一步顺序

**现在的状态（2026-09-25 晚）**：第一批三件**已做完并全绿**（分支 `Slay`；**当时 8761 全程未动** = `45d288b1…`。
⚠️ 2026-09-26 起 8761 已是 `1ed3e528…`（C4/A2 两次 promote）——**别把这一行当现役**）：

| 已做 | 结果 | 数据在哪 |
|---|---|---|
| Q10 iframe COI 九格 | **6/0**，C7 否决、**C8** 成立（credentialless ⇒ 同源 iframe 继承 COI 且不拦 CDN） | `probe-iframe-coi.mjs` + reply 文档 |
| **Q4** JSPI × DedicatedWorker | **6/0**（100 次挂起/恢复、tick=100、反向抛 SuspendError） | `NOTES-threads.md` §B1 |
| **E3** pthread × dlopen | **6/0**（100 轮无死锁，2 个 pthread 存活） | `NOTES-threads.md` §B2 |
| **E1** `-msimd128` | **绿**（512² 1.62×、1024² 1.75×、2000² 1.31×；数值 97/0；v128 4752 vs 0） | `NOTES-threads.md` §B3 |

**下一步顺序**：

1. ~~**C4 落地决策**~~ **→ 已 promote 到 8761（2026-09-25 15:54，`1ed3e528…`）**，
   但**验证没跑完就被关机叫停**：8768 已 41/1047/0、8761 开机自检 OK、8761 跑到 42 套真 FAIL=0；
   **待补**：8761 完整 `PROBES=1` 汇总行、`make-dist.sh` + 核 sha、`check-site-parity --strict`、
   清理 `site-simd`/8771。回退快照 `site-baseline-45d288b1/`。详见 `NOTES-threads.md`「C4 落地」节。
2. **E4 探针 ✅ / C3 落地 = B5**：
   - E4 探针已绿（worker 里 dlopen 两种 FS 来源 + 挂起穿透 dlopen）；
   - **B5 phase 1 ✅ 已落地**（`?worker=1`，accept-worker **11/0**，8761 全量 **80 套/1216/0**）：
     解释器搬进 DedicatedWorker，主线程只剩 DOM 与转发 —— 判据对：worker 里 1400² 计算期间
     页面 tick=435，而单页模式 tick=0。
   - **B5 phase 2 ✅ 已达成（2026-09-26，且不需要重链）**：worker 里**真渲染后端**跑起来了 ——
     `graphics_toolkit()='webgl'`、无 GL 回落信号、OffscreenCanvas 上确有 WebGL2 上下文、图上屏。
     做法只是让 worker 的 DOM shim 交出一个**真 `OffscreenCanvas`**（机制：胶水只要一个能
     `getContext('webgl2')` 的对象）；原计划的"改 `webgl_toolkit.cc` + 重链"**确认不必要**。
     ⇒ **C3（解释器搬 Worker）在功能上完成**：主线程不冻 + 真渲染 + 交互原语 + 资产 + JSPI 都在。
3. ✅ **E6 · C6 去单例嵌入契约（页面层）已落地**（2026-09-26）：工厂化 mount/base/实例命名空间/
   IDBFS 命名空间；判据全过（accept-embed-multi **13/0**：同页 2 实例交替 eval 100 次 0 串扰；
   8768 全量 **42 套/1060/0** 41 套 accept **零改动**；8761 全量 **77 套/1205/0**）。
   **已知边界**：非默认实例无图形上屏 + 四个队列桥/stdin/Ctrl-C 仍是默认实例单例
   ⇒ wasm 侧（canvas 契约 + publish_png 分派 + 队列桥随迁）与**下一次重链**合并。
4. **E2 · OpenBLAS SIMD 1T**：触发条件（E1 红或提速 <1.5×）**不成立** ⇒ 维持"可选增强"。
5. **C2/C8**（★ 2026-09-26 范围改判 + 实测收窄）：**目标是一方单页完整 Octave 站**。
   **实测补充**：我方站在 `require-corp` 下开机 OK（0.9 s）且 5 个代表性套件全绿；
   **require-corp 是唯一三引擎都能拿 COI 的档**（WebKit 不支持 credentialless）⇒ 自家站直接用它；
   代价一条：COI 后**跨源网络访问**要满足 CORP/CORS（产品"取外部 URL"类功能受影响，B6 验收要测）。——
   之前"宿主站不能改头/不能弃 CDN"的约束**作废**（教材嵌入将来走"拆 CLI 定制 UI"的便宜路子，
   不做宿主站嵌入）。⇒ C8 = **自家站开 COI**：coi-serviceworker（已在 `build/embed/`）+ 我们
   全部资产同源 ⇒ require-corp **什么都拦不到**，且实测三引擎都拿到 COI
   （webkit 走 require-corp：`coi=true`，`probe-coi-sw.mjs`/`probe-coep-engines.mjs`）。
   **外部依赖清零，B6 解锁**；唯一前置 = E3（已绿）+ 线程版构建（OpenBLAS-pthread，见 B6）。

---

## §1 批次（每批按仓库固定动作收尾）

| 批 | 内容 | 触碰产物 | 收尾 |
|---|---|---|---|
| **B1** | C6 去单例嵌入契约（页面层重构，产物不变） | bridge/*、webjslib.js | 8768 sweep → promote → 8761 全量 + PROBES=1 |
| **B2** | E1 SIMD 基准（探针车道，独立输出目录，**不 promote**） | 新 `build/113/probe-threads/` | 只出基准数据 + 记 HISTORY |
| **B3** | E2 OpenBLAS SIMD 1T（配方切换） | configure/link 配方 | 数值回归 + 8761 验收 |
| **B4** | E4/E3 探针（Worker / pthread×dlopen） | 探针车道 | 红绿结论 + 记 HISTORY |
| **B5** | C3 真落地（Worker 化；图形走 OffscreenCanvas→PNG→postMessage） | bridge/、webgl_toolkit.cc、测试垫片 | 全量回归（72 套件需 Worker RPC 垫片） |
| **B6** | C8/C2 条件开启。★ **实测改判（2026-09-26，`probe-threads-coi.mjs` 3/0）**：线程版产物**硬依赖 COI**（无 COI 时 `DataCloneError: SharedArrayBuffer transfer requires self.crossOriginIsolated`）⇒ **必须双档产物 + 加载期选档**（C1 的门 = **产物选择器**，不是开关） | 线程版构建（configure `--disable-threads` 要改）+ 链接旗标 + coi-serviceworker（build/embed/）+ 加载期选档 | 两档矩阵实测（带/不带 COI 各跑一遍） |

---

## §2 红绿判据（可直接抄成 CI/Playwright）

| # | 实验 | 绿 | 红 |
|---|---|---|---|
| E1 | C4 SIMD（仅差 `-msimd128`） | ✅ **已做：512² 1.62× / 1024² 1.75× / 2000² 1.31×，数值 97/0** | — |
| E2 | OpenBLAS SIMD 1T | `B/A ≥ 1.5×` | `B/A < 1.2×` |
| E3 | pthread × dlopen | ✅ **已做：6/0（100 轮无死锁）** | — |
| E4 | Worker + JSPI + dlopen + preload FS | 100/100 无 hang，主线程仍响应 | 依赖 window/document，或 dlopen 回退网络 |
| E5 | Q10 iframe COI 九格 | ✅ 已跑通 6/0 | 任一格与表不符 |
| E6 | C6 双实例 | 0 串扰 / 0 404 / 0 全局覆盖 | 任一实例改动另一实例状态 |
| E7 | C8 宿主 credentialless | 稳定 `crossOriginIsolated=true` + CDN 无失败 | 任一基线持续 reload / 资源被拦 |
| E8 | coi-serviceworker 真装（三引擎 × 三模式） | ✅ **已跑：7/2**；引擎能力 6/0；**Firefox 的 SW 路径待查** | — |
| Q4 | JSPI × Worker | ✅ **已做：6/0（100 次挂起恢复）** | — |

**线程分档判据**：`crossOriginIsolated===true && typeof SharedArrayBuffer==='function'` 才启用 pthread；
否则单线程 + SIMD（优雅降级，不许整站死）。

---

## §3 纪律（沿用 AGENTS 全部铁律，本线新增）

1. **不许把"嵌入模式"与"线程"绑死**：嵌入模式 = C6 + C4 + C3（全绿底线）；线程是可选档。
2. **Safari 无 credentialless** ⇒ 嵌入模式下 Safari 只能单线程 + SIMD；不得为此抬全站下限。
3. **同源 iframe 会与书站共用同一个 IndexedDB 库** ⇒ IDBFS 持久路径必须**按实例命名空间化**
   （否则不同页面/不同实例互相覆盖 `/home/user`）。
4. **C8 的前提是宿主愿意装 service worker**；宿主不同意 ⇒ 嵌入模式无线程，只剩 C4/C3。
5. 探针不进开机路径；跑验收不并行干重活；重活用 `setsid nohup` + 短轮询。

---

## §4 明确不做

- **C7**（自有 origin 跨源 iframe 取 COI）——实测否决：祖先约束 + 无 `allow` ⇒ 前提不满足。
- **C5**（解释器内部真并行）——无可零共享并发的安全路径（评审与我方一致）。
- **为了 pthread 去承担 C7 的嵌入复杂度**（评审原话）；**倍数相乘式收益宣称**。
- Asyncify（与 wasm EH 互斥，已证伪）；JS 注入异常硬取消；全站硬门（沿用 PLAN-jspi 红线）。


---

## §5 B6 线程版构建 · kickoff 配方（2026-09-26 备好，**待令执行**）

> 为什么不无人值守直接跑：它会**翻掉一条项目刻意立过的闸门**（闸门③"不引入 COI/SharedArrayBuffer 需求"），
> 而 `build/113/patch-ax-pthread.sh` 与 `configure-113-full.sh` 的 `--disable-threads` 正是为那条闸门存在的；
> 当年还踩过 gnulib 自造 `pthread.h` 与 sysroot 撞 `typedef redefinition` 的雷（见 patch 脚本头注释）。
> 加上它要**全量重编**（对象层 atomic/TLS 全变）+ 重链 + 双档产物 ⇒ 是一次数小时、并改变产品形态的动作。
> 判据、备份、回退都已备好；用户点头即可按下面顺序执行。

### ★ 外部咨询回音已处理（2026-09-26，见 NOTES「B5 加固 + E2 根因线索」）
- **A 节自解决**（worker 内真 OffscreenCanvas，无需重链）；**B 节**：两个独立裁判（V8 + WABT）证明
  **产物非法而非 binaryen 的锅**，根因线索指向 OpenBLAS 的 fp128（`long double`）软例程路径；
- **C 节采纳 4 条**（重入防护 / 背压 / terminate 结算 / 重启），`accept-worker` 16 PASS/0 FAIL。

### 前提（都已实测，不需要再证）
- 线程版产物在**无 COI**时硬失败（`DataCloneError: … SharedArrayBuffer transfer requires
  self.crossOriginIsolated`）⇒ **双档产物 + 加载期选档**（`probe-threads-coi.mjs` 3/0）。
- 我方站在 `require-corp` 下开机 OK（0.9 s）+ 5 套代表套件全绿；**require-corp 是三引擎唯一通用档**
  （WebKit 不支持 credentialless）⇒ 自家站注 require-corp（或 `build/embed/coi-serviceworker*.js` 走 require-corp）。
- pthread × dlopen 无死锁（E3 6/0）；worker 里 JSPI/dlopen 都成立（Q4/E4）。

### 步骤（每步都有红/绿）
1. **备份**：容器里 `cp -a /src/work/octave-113.0/config.h /src/libwork/config.h.pre-threads`
   （项目既有惯例：切配置前备份 config.h）；另记当前 `librefblas.a/liblapack.a` 的 sha。
2. **配置线程版**：跳过 `patch-ax-pthread.sh`、去掉 `--disable-threads`（用 `--enable-threads`）重新 configure。
   - 绿：configure 通过且 `grep -c pthread /src/work/octave-113.0/config.h` > 0；
   - 红（预期可能）：gnulib `pthread.h` `typedef redefinition` ⇒ 参照 patch 脚本头注释的思路
     （把"有没有 pthread.h"与"要不要线程模型"解耦）再 patch 生成物。
3. **全量重编**：`setsid nohup make -j12 > /tmp/threads-build.log`（数小时；完成后 tail 汇总）。
   - 红：任何 `-pthread` 与 f2c 产物/gl4es/toolkit 的 ABI 冲突 ⇒ 逐个记录，别硬改。
4. **重链**：`link-web.sh` + `-pthread -sSHARED_MEMORY`（经 `EXTRA_LDFLAGS` 注入链接行；
   注意对象层已带 `-pthread`）→ 独立目录 `/src/websrc/m2fc-threads-out`。
   - 绿：产物自检全绿 + `llvm-objdump -d | grep -c v128 ≥ 4752` + 胶水里有 pthread worker；
   - 红：`--check-features` 报特性不兼容、或 binaryen 再报 parse exception（与 E2 同族问题）。
5. **双档 + 选档**：页面按 `self.crossOriginIsolated === true && typeof SharedArrayBuffer === 'function'`
   选线程版；否则选现役非线程版；把 `probe-threads-coi` 那句失败文本作为"选错档"的清晰报错。
6. **验收（两档矩阵）**：
   - 带头（COI，require-corp）：两站点全量 `PROBES=1` 全绿 + 线程版真跑起来（`__webThreadsOk__` 真值）；
   - 不带头：线程版**不被选中**、站点照常（非线程档）；
   - 三个引擎各跑一遍 `probe-browser-matrix` 风格的能力探测。
7. **回退**：`cp -a /src/libwork/config.h.pre-threads /src/work/octave-113.0/config.h` + 重编回非线程档
   （或直接丢弃线程产物目录；**8761 在 promote 之前不动**）。

### 明确不做（红线沿用）
- 不为线程去改宿主的响应头/`allow`（范围改判后我们只服务自家站点）；
- 不让线程档成为**唯一**产物（必须双档，且默认档保持"在任何静态托管上都能跑"）。

---

## §6 依赖链 atomics 重编（branch `threads`，2026-09-27 起）—— **B6 的真正主体**

> **用户拍板**（2026-09-27）："就开新分支做这个吧"。起因是 B6 的实测结论：线程档**不是**"重编 Octave"
> 就能成的 —— `-pthread` 要求链上**每个对象**都声明 `atomics`，而现役 farm **全部**缺（扫描表见
> `PLAN-arch.md` §2 B6 的 2026-09-27 节）；并且 `build/113/NOTES-threads.md` 的 B5 实验证明
> **`.oct` 车道（49 条资产）也必须按 `-pthread` 重编**（非线程档的 side module 连 dlopen 都过不去：
> `TypeError: tlsInitFunc is not a function`）。

### 车道机制（**唯一口径**，别再手拼旗标）

```sh
LANE_FLAGS=-pthread            # 编译期：给每个对象打 atomics 特征
PREFIX=/usr/local-threads      # 数学核（libf2c/refblas/lapack/pcre2-8）
DEPS=/src/deps-threads         # 表驱动依赖（build-libs.sh 那一族）
```
**现役 farm（`/usr/local`、`/src/deps`）一字不动** —— 8761 那条线要照常能链、能回归。
两档 prefix 分开是硬要求，不是风格问题。

### 库 → 脚本 → 车道 prefix（逐个脚本加 `LANE_FLAGS`，都已实测过归属）

| 库 | 脚本 | 车道 prefix |
|---|---|---|
| libf2c / refblas / lapack / pcre2-8 | `build/113/build-deps.sh`（**已加** `LANE_FLAGS`，冒烟过） | `/usr/local-threads` |
| SIMD refblas/lapack | `build/113/build-blas-simd.sh` / `rebuild-pic-blas.sh` | `/src/deps-threads/lapack-simd` |
| zlibbz2 / glpk / fftw(3,3f) / qhull / sndfile / rapidjson / hdf5 / suitesparse / arpack / qrupdate | `build/113/build-libs.sh` | `/src/deps-threads` |
| freetype / fontconfig / expat | `build/113/build-freetype.sh` + `build-fontconfig.sh` | `/src/deps-threads` |
| gl2ps | `build/113/build-gl2ps.sh` | `/src/deps-threads` |
| gl4es（`libGL.a`）+ GLU | `build/113/build-glu-webgl.sh`（+ `patch-gl4es.sh`） | `/src/deps-threads` |
| `.oct` 车道：核心 dldfcn + 13 个包 + slicot | `build/113/build-oct.sh` / `build-pkg-oct.sh` / `build_dldfcn.sh` | `/src/libwork/octs-threads` |
| Octave 本体 | `build/113/configure-113-full.sh`（`WITH_THREADS=1` + `D=`/`DEPS=` 指向车道） | `/src/websrc/m2fc-threads-out` |

### `.oct` 车道的确切清单（2026-09-27 从现役站点清单 + 各脚本注释反查，**不是猜的**）

现役站点 `assets/manifest.json` 里 `kind:oct` 共 **16 条**，来源三分：

| 批次 | 模块 | 源 | 额外旗标 |
|---|---|---|---|
| 树内 dldfcn（10） | `__delaunayn__` `__glpk__` `__voronoi__` `audioread` `convhulln` `fftw` `gzip` `__init_fltk__` `__init_gnuplot__` | `libinterp/dldfcn/*.cc` | — |
| `--cc` 批（6） | `webio` / `__init_web__` / `__web_pause_ms__` / `__fltk_uigetfile__` / `webimage-oct` / `webnet-oct` | `websrc/{webio.cc, web_graphics_toolkit.cc, webpause.cc, webfilepick.cc, webimage.cc, webnet.cc}` | — |
| 特殊（1） | `__ode15__` | `build/113/build-ode15.sh` | `OCT_DEFS`（HAVE_SUNDIALS…）+ `OCT_LIBS="-L$SUNDIALS/lib -lsundials_ida"` ⇒ **sundials 也要车道版** |
| 包（`build-pkg-oct.sh all`） | 13 个包 → `octdir/<包>/`，其中 `control/__control_slicot_functions__.oct` | Forge 包源码 | `OCT_INCS` + `OCT_LIBS=slicotlibrary.a` ⇒ **slicot 也要车道版**（该脚本自己建 slicot） |

判据（.oct 车道）：① 文件名清单与现役站点 16 条**逐字一致**（漏一个 = 功能静默缺失）；
② **每个 `.oct` 都带 `atomics`**（`atomics_scan.py` 直接扫 `.oct` 字节即可 —— 它是 wasm side module）；
③ 载入验证：线程档站点里 `__glpk__`/`convhulln`/`control` 等资产真的 load 成功（accept 套件 + `probe-lane`）。

### 树与安装 prefix（`.oct` 车道要用**线程档的**头与库）

线程档的 Octave 要配到**独立 prefix**（`configure-113-full.sh <src> /src/work/octave-install-threads`），
`make install` 也进那里 ⇒ ① 车道 `.oct` 编的是线程档的头（`OCTAVE_USE_THREADS`/`HAVE_PTHREAD` 一致）；
② **不动**现役 `/src/work/octave-install`。

### 顺序与判据（**每步都要量**，不许"链过了就算"）

1. **数学核**（`build-deps.sh all`）→ 判据：`atomics_scan.py` 对 4 个 `.a` 报 **0 缺**；
   符号自检（`dgemm_`/`dgesv_`/`dlamch_`/`pcre2_compile_8`）照旧绿。
2. **表驱动依赖**（`build-libs.sh`）→ 同判据（逐库原子扫 + 该库自带符号自检）。
3. **图形/字体**（freetype/fontconfig/expat/gl2ps/gl4es）→ 同判据。
4. **`.oct` 车道** → 判据：每个 `.oct` **能载入 shared-memory 主模块**（B5 实验的反向：这次应该过），
   用 `probe-threads.mjs` 的形态先验一条，再用 `accept-113-libs` 等套件验。
5. **Octave** → `relink.sh link threads`：`verdict=ok`（身份证 `threads` 轴双向判定）+ 导出面与
   product 基线对齐（保活闸门）+ 六组产物自检。
6. **双档上线**（机制已就绪，见 `PLAN-arch.md` §2 B6 的 2026-09-27 节）：8768 先跑 `probe-lane`
   （带头选线程档 / 不带头落基础档 / 选错档硬失败）+ 两档 `PROBES=1` 全量 → 再 promote 8761。

### ★ 已踩到的**三个静默陷阱**（2026-09-27 实测；共同点：构建 rc=0、脚本自检也过，产物却是旧的）

**判据只能是产物**：`atomics_scan.py` 逐成员扫字节。构建脚本的符号自检**验不出**"对象带不带 atomics"，
所以这三个坑每一个都能一路绿到链接期（甚至到"看着像线程档"）。

| # | 陷阱 | 现场 | 修法 |
|---|---|---|---|
| 1 | **`make` 认为无事可做** | 影子只改编译器、不改 `Makefile` ⇒ config.status 发现生成的 Makefile 逐字节相同就不重写 ⇒ make 按 mtime 判定目标都是新的 ⇒ **一个对象都不重编**（glpk/qhull/sndfile/suitesparse 重跑后仍 100% 缺） | 车道用**独立 WORK**（`/src/libwork-threads`）⇒ 源码树重新解包、重新 configure |
| 2 | **显式旗标串绕过影子** | `emcmake`/`emconfigure` 把编译器**钉成绝对路径**（toolchain 文件 / emconfigure 的 `CC`）⇒ 影子的 PATH 包装对脚本自己写的 `CFLAGS=`/`-DCMAKE_C_FLAGS=` 无效（qhull/sndfile/expat/fontconfig 实测） | 给这些脚本的显式旗标串拼 `$LANE_FLAGS`（`build-libs.sh` 7 处 / `build-fontconfig.sh` / `build-sundials.sh`） |
| 3 | **`if [ ! -s $PREFIX/lib/xxx.a ]` 式跳过** | expat 的构建块在"prefix 里已有产物"时**直接跳过** ⇒ 上一轮非 atomics 那份原样留着（重跑后仍 3/3 缺） | 车道 prefix 在旗标变化后**先清再编**；本轮清掉了 `/src/deps-threads/expat` |

**通用结论**：车道的构建**不许复用任何"已有"状态** —— 源码树、构建目录、输出 prefix 三者都要是车道专属的，
且每建完一批就用 `atomics_scan` 复核一遍。

### ★ 第六个坑：**含空格的多词旗标被当成一个参数**（同一天实测）

车道 SIMD BLAS 第一次跑：`SIMD_FLAG="-msimd128 -pthread"` —— 而脚本把它当 **一个** 参数传下去
（`sh -c '...' _ {} "$SIMD_FLAG"` 里是 `"$1"`）⇒ `emf77` 收到单个含空格的 token ⇒ **149 个 BLAS 文件
全部被拒编**（失败清单就是证据）。修法：**别在单值口子里塞多词旗标** —— `SIMD_FLAG` 保持 `-msimd128`，
`-pthread` 交给影子（PATH 包装）注入。一般规律：**"单值变量"只放单值；多词旗标走影子或专门的
数组口子**。

### ★ 第五个坑：`DEPS=/usr/local` 也是写死的（同一天实测）

`link-web.sh:36` 的 `DEPS=/usr/local`（早期四件 libf2c/refblas/lapack/pcre2-8 的 prefix）**写死**，
而它是**硬赋值**、不是 `${DEPS:-…}` ⇒ `relink.sh --selfcheck`（只认 `${VAR:-…}` 形态）**看不见它**，
模式表也就管不到。修法：改成 `${DEPS:-/usr/local}` 并进模式表（threads = `/usr/local-threads`）
⇒ 覆盖数 25 → **26** 个变量。

### ★ 车道还需要一份"**线程 + SIMD**"的 BLAS

`threads` 模式的 `EXTRA_LDFLAGS` 原指 `/src/deps/lapack-simd/lib`（**基础档**的 SIMD BLAS）。
车道要自己那份（SIMD 与 atomics 是两件事，都得有）：

```sh
SIMD_FLAG="-msimd128 -pthread" PREFIX=/src/deps-threads/lapack-simd \
  WORK=/src/libwork-threads bash build/113/build-blas-simd.sh
```
（`build-blas-simd.sh` 的 `SIMD_FLAG` 正好是个现成口子 —— 把 `-pthread` 拼进去即可，
**零改脚本**；判据仍是 `atomics_scan` 该 prefix 下全 0 缺。）

### ★ 第四个坑：**依赖库路径写死**（2026-09-27 实测）

`link-web.sh` 与 `configure-113-full.sh` 里有一批**写死的 `/src/deps/...`**（gl2ps、那 9 个 `-L`、
freetype/fontconfig/expat）。实测：即使 configure 传了 `D=/src/deps-threads`，**树的链接照样去拉
基础档的 `libfontconfig.a`**（`wasm-ld` 当场拒：`--shared-memory is disallowed by fccache.o`）。

修法：`link-web.sh` 引入 `DEPS_ROOT="${DEPS_ROOT:-/src/deps}"` 并把 21 处写死路径改成它；
`configure-113-full.sh` 的 freetype/fontconfig/expat 改用已有的 `$D`；`relink.sh` 四个模式都填
`DEPS_ROOT`（`--selfcheck` 覆盖数 22 → **25** 个变量，自动强制"每个模式都覆盖"）。
**不必重编树**：头的**内容**与档无关（同版本），只有链接期的**库**路径要紧。

### ★ `make install` 走不通 ⇒ 车道头这样造（2026-09-27 实测）

树内 `.oct` 的坏目标（`/usr/bin/install: omitting directory 'libinterp/dldfcn/.libs/'`）会把整条
`install` 堵死（`-k` 也过不去；`make -C liboctave install` 更是"没有这个目标"），
而 `.oct` 车道要的 `include/octave-X/octave/` 正是 install 产的。**基线 install 里其实没有 `config.h`**
（实测 787 个文件里没有它）⇒ 车道的头 = **基线头树 + 线程档的 `config.h`**：

```sh
cp -a /src/work/octave-install/include /src/work/octave-install-threads/
cp /src/work/octave-11.3.0/config.h \
   /src/work/octave-install-threads/include/octave-11.3.0/octave/config.h
# 判据：HAVE_PTHREAD / USE_POSIX_THREADS / HAVE_PTHREAD_MUTEX_RECURSIVE = 1、AVOID_ANY_THREADS 是 undef
```

### 陷阱 1 的细节（原记录）

影子包装（`lane-shim.sh`）改的是**编译器**，不改任何 `Makefile` ⇒ autotools 的 `config.status`
发现生成的 `Makefile` 与上次**逐字节相同**就不重写它 ⇒ `make` 看 mtime 判定目标文件都是新的
⇒ **一个对象都不重编**，产物照旧是非 atomics 的。实测现场：`glpk`/`qhull`/`sndfile`/`suitesparse`
（7/9 个 archive）重跑一遍仍然 **100% 缺 atomics**，而"看起来"构建是成功的（rc=0、符号自检也过）。

**判据只能看产物**：`atomics_scan.py` 逐成员扫字节（这也是它存在的理由 —— 构建脚本的自检只验符号，
验不出"对象是不是带 atomics 的"）。

**修法**：车道用**独立的 WORK 目录**（`WORK=/src/libwork-threads`）。`unpack` 那种
"目录在就不重新解包"的写法会把旧构建树带过来，独立 WORK 一次性解决，顺带不污染现役构建树。

### 红与回退

- 任一步 `atomics_scan` 有残留 ⇒ 该库没真重编（旗标没进某条编译路径）⇒ 修脚本，别绕。
- 链接期 `--shared-memory is disallowed by X` ⇒ X 所属库还没重编（**这条错误就是路线图**）。
- 任何一步失败：丢弃该车道 prefix + 丢弃 `/src/websrc/m2fc-threads-out`；**8761 / `site/` 一动不动**。

### 明确不做

- 不动现役 farm 的 prefix（两档并存，不覆盖）。
- 不为线程档降低产品能力面（若某库实在编不出，先记档再问，别悄悄丢功能 —— 这正是 GLPK/QHULL
  那次的教训：configure **静默**关掉功能，只有扫描才看得见）。
