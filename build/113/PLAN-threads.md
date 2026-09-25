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
3. **C8 实测**：顶层 `credentialless` ⇒ 同源 iframe 继承 `crossOriginIsolated=true`、SAB 可用；
   且 credentialless **不拦 CDN**（require-corp 下同一脚本被 `ERR_BLOCKED_BY_RESPONSE` 拦掉）。
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

1. **C4 落地决策**：把 SIMD BLAS 打进产品需要一次重链 + 全量回归 + promote（不改任何接口 ⇒ 可回退）。
   若做，**顺带合并 C6 的 wasm 侧改动**（canvas 契约 + `publish_png` 分派），省一次 29MB 链接。
2. **E4 · C3 真落地**：JSPI×Worker 已证（Q4）⇒ 只剩"worker 侧 dlopen × preload FS"未测；
   第一版必须带**真实 side module + 真实 preload FS**（不带 pthread）。
3. **E6 · C6 去单例嵌入契约**：页面层（mount/base/实例命名空间/**IDBFS 命名空间**）可独立先做，
   判据 = 同页 2 实例交替 eval 100 次 0 串扰 + 8768 上 41 套 accept 全绿不改。
4. **E2 · OpenBLAS SIMD 1T**：触发条件（E1 红或提速 <1.5×）**不成立** ⇒ 维持"可选增强"，
   排在 C4 落地与 C3 之后。
5. **C2/C8**：pthread BLAS 的前置未知数已清（E3），但仍只在 COI 成立的环境里开
   （第一方自控头，或宿主同意装 coi-serviceworker 的 credentialless 路径）。

---

## §1 批次（每批按仓库固定动作收尾）

| 批 | 内容 | 触碰产物 | 收尾 |
|---|---|---|---|
| **B1** | C6 去单例嵌入契约（页面层重构，产物不变） | bridge/*、webjslib.js | 8768 sweep → promote → 8761 全量 + PROBES=1 |
| **B2** | E1 SIMD 基准（探针车道，独立输出目录，**不 promote**） | 新 `build/113/probe-threads/` | 只出基准数据 + 记 HISTORY |
| **B3** | E2 OpenBLAS SIMD 1T（配方切换） | configure/link 配方 | 数值回归 + 8761 验收 |
| **B4** | E4/E3 探针（Worker / pthread×dlopen） | 探针车道 | 红绿结论 + 记 HISTORY |
| **B5** | C3 真落地（Worker 化；图形走 OffscreenCanvas→PNG→postMessage） | bridge/、webgl_toolkit.cc、测试垫片 | 全量回归（72 套件需 Worker RPC 垫片） |
| **B6** | C8/C2 条件开启（`__webThreadsOk__` 门 + 双档产物/同产物降级） | 链接旗标 + 页面 gate | 两档矩阵实测 |

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
