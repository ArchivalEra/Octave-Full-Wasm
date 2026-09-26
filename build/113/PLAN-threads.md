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

**现在的状态（2026-09-25 晚更新）**：第一批三件**已做完并全绿**（分支 `Slay`；**8761 全程未动** = `45d288b1…`）：

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
