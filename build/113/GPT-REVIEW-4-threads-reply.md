# 第四轮评审复核（我方实测回执）· 浏览器内线程化 + 教材站嵌入

> 对象：外部评审第四轮（C1–C7 判定表 + Q1–Q12 + 六实验顺序建议）。
> 本文只记**证据与结论**：每条主张标注「采信 / 修正 / 待实测」，能实测的都写复跑方式。
> 复跑环境：Chromium **152.0.7977.82**（/usr/bin/chromium）；探针
> `test/browser/probe-iframe-coi.mjs`，跑法
> `/mnt/hdd/octave-wasm-build/harness/run.sh test/browser/probe-iframe-coi.mjs`。
> 工作分支 `Slay`（自 main b98fbc3）。

---

## 一、一句话结论

**GPT 的 Q10 判定成立，我方原判断（C7 可行）被实测推翻**：未 COI 的顶层里，iframe 自己带
COOP/COEP **完全无效**（同源、跨源都一样），`allow="cross-origin-isolated"` 也不起作用。
⇒ **C7（自有 origin 跨源 iframe）在当前 host contract 下否决**。

但实测同时暴露一条**评审没列到的可行路径**（记为 **C8**）：
**宿主顶层用 `credentialless` 隔离 ⇒ 宿主变 COI ⇒ PreTeXt 生成的同源 iframe 继承 COI ⇒
iframe 内 SAB/线程可用，而且 credentialless 不拦 CDN**（同一条无 CORP 跨源脚本：require-corp 下
被 `ERR_BLOCKED_BY_RESPONSE` 拦掉，credentialless 下正常加载）。
⇒ 「教材站嵌入 + 线程」在 Chromium/Firefox 上有路；Safari 仍是"线程 vs CDN"二选一 ⇒ 走 SIMD 降级。

---

## 二、实测矩阵（原文照抄）

### 阶段 1 · iframe COI 九格

| 格 | top.COI | frame | frame.COI | frame 里 SAB | frame 内 worker 里 SAB |
|---|---|---|---|---|---|
| h1 顶层 plain + **同源** iframe 自带 COOP/COEP | false | 在 | **false** | undefined | throw:ReferenceError |
| h3 同上 + `allow="cross-origin-isolated"` | false | 在 | **false** | undefined | throw:ReferenceError |
| h2 顶层 plain + **跨源** iframe 自带 COOP/COEP | false | 在 | **false** | undefined | throw:ReferenceError |
| h3 同上 + `allow=` | false | 在 | **false** | undefined | throw:ReferenceError |
| h5 顶层 **credentialless** + 同源 iframe | true | 在 | **true** | ✓ ok | ✓ ok |
| h4 顶层 **require-corp** + 同源 iframe | true | 在 | **true** | ✓ ok | ✓ ok |
| h3 同 h4 + `allow=` | true | 在 | true | ✓ ok | ✓ ok |
| 顶层 require-corp + 跨源 iframe **带 CORP** | true | 在 | **true** | ✓ ok | ✓ ok |
| h6 顶层 require-corp + 跨源 iframe **无 CORP** | true | 被拦 | false | undefined | worker-error |

假设判定 **6 PASS / 0 FAIL**（H1/H2/H3/H4/H5/H6 全中，判据写在探针头部，可翻面）。

要点：
1. **iframe 自带头不能造出"COI 孤岛"**——同源与跨源都不行 ⇒ 祖先约束是真的（Q10 = 成立）。
2. `allow="cross-origin-isolated"` **无效果**（也没有任何 console 告警，说明该委派键在这里未被采纳）。
3. COI 是**继承式**的：顶层一旦隔离（require-corp 或 credentialless 都算），同源 iframe 自动 COI。
4. require-corp 顶层里，跨源 iframe **必须带 `Cross-Origin-Resource-Policy`**（否则拿不到 COI）。

### 阶段 2 · 宿主被隔离后它的"CDN"还活不活

| 顶层模式 | 拉一个「跨源、无 CORP、无 crossorigin」的脚本 |
|---|---|
| `require-corp` | ✗ 被拦（`net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep`） |
| `credentialless` | ✓ 成功 |
| 无隔离（对照） | ✓ 成功 |

⇒ 评审"credentialless 可缓解 CDN 问题"的判断**实测成立**；且**这正是 C8 能用线程的前提**。

---

## 三、逐条复核

| 评审主张 | 我方判定 | 依据 |
|---|---|---|
| **Q10/C7**：iframe 需整条 ancestor chain + Permissions Policy 委派 ⇒ C7 否决 | **采信（实测证实）** | 上表 h1/h2/h3 三行；`allow=` 无效 |
| **C1 嵌入场景 red**（SW 注头不能救 iframe） | **修正为"有条件"** | 阶段 2：credentialless 下 CDN 不被拦、宿主 COI 后同源 iframe 继承 COI ⇒ **C8 成立**（仅在宿主同意装 SW 且非 Safari 时） |
| **C2 历史否决过时**（官方已文档化 `dynamic linking + pthreads`，仍标 experimental；`MAIN_MODULE+-pthread` 会告警） | **采信** | 我方补：本项目 dlopen 全在解释器线程 ⇒ 第一版不让 pthread 线程碰 dlopen（Q3 亦如此建议） |
| **Q2**：shared memory 必须有 maximum；`ALLOW_MEMORY_GROWTH×pthreads` "especially tricky"；`GROWABLE_ARRAYBUFFERS` 需 Firefox 154 > 我方基线 153 | **采信** | 正式 pthread build 必须显式 `MAXIMUM_MEMORY`；不能把 GROWABLE_ARRAYBUFFERS 当必备 |
| **Q5**：OpenBLAS 官方 WASM 示例是 `USE_THREAD=0`，`WASM128_GENERIC` 默认 SIMD128；Pyodide 历史 DGEMM 2–3×（单线程无 SIMD） | **采信** | ⇒ **"OpenBLAS + SIMD + 单线程"是最便宜的高价值切口**（不需要 COI/SAB），优先级高于 pthread BLAS |
| **Q7**：不要把 refblas→SIMD→pthread 的倍数相乘；改测 `B/A`、`C/B`、`D/B` | **采信，已改** | 内部报告里那张"示意柱状图"本就标了"文献量级，待实测"；现按 B/A、C/B、D/B 做 gate |
| **Q3 + worker 侧 dlopen×FS 真坑**（side module 在 MEMFS/preload 里，worker 的 dlopen 可能看不到主线程 FS ⇒ 回退网络 GET） | **采信** | ⇒ C3 第一版**必须带真实 side module + 真实 preload FS**，不能只放最小 wasm |
| **Q8**：OffscreenCanvas 成熟；`transferControlToOffscreen` 一次性绑定、context 钉在创建它的 worker；我方 `PNG→FS→<img>` 路线天然适配；字体留 worker 无问题 | **采信** | 与我方现管线（webgl_toolkit.cc:514-557）一致，改动点只在"谁建 canvas + 怎么发布" |
| **Q11/Q12**：共享资源不共享解释器实例；lazy start + 上限 + 池 | **采信** | 补：同源 iframe 路线下**多个实例会共用同一个 IndexedDB 库** ⇒ IDBFS 持久路径必须按实例命名空间化（否则不同书的实例互相覆盖 `/home/user`） |
| **Q4**：JSPI `[Exposed=*]`，DedicatedWorker 上应有语义 | **待实测** | 半日探针待写（worker 内最小 `Suspending(fetch)` + 100 次挂起/恢复）；这是 C3 的最后一个未知数 |
| **C5 不投入** | **采信** | 与探针结论一致（无可零共享并发的安全路径） |
| **C4 四条底线全绿、应最先做** | **采信** | SIMD 不需要 COI/SAB/宿主改动 |

---

## 四、修正后的决策表

| | 嵌入模式（第三方教材站内） | 第一方 / 独立站 |
|---|---|---|
| 必做 | **C6** 去单例嵌入契约（mount + 资源 base + 实例命名空间 + IDBFS 命名空间） | 同左 |
| 性能第一刀 | **C4** `-msimd128`；随后 **OpenBLAS SIMD 单线程**（上游支持路线，零 COI） | 同左 |
| 主线程自由 | **C3** 解释器搬 DedicatedWorker（**不带 pthread**） | 同左 |
| 线程 | **C8**（可选，需宿主同意装 SW + 非 Safari）：宿主 credentialless ⇒ 同源 iframe 继承 COI ⇒ 开 pthread | **C2** OpenBLAS-pthread（自行控头，COOP+COEP 自定） |
| 否决 | **C7**（自有 origin 跨源 iframe：祖先约束 + 无 allow ⇒ 前提不满足） | — |
| 不进近期计划 | **C5** | — |

一句话：**嵌入场景用 Worker + SIMD；线程只在 COI 成立的环境里当可选增强**（与评审结论一致，C8 是它的
"宿主侧可落地版本"）。

---

## 五、交给实现团队的实验矩阵（红/绿可证伪）

执行纪律沿用本仓：全部在 8768 先验；失败即回退；8761 在 promote 前不动；探针不进开机路径。

| # | 实验 | 最小做法 | 绿 | 红 | 状态 |
|---|---|---|---|---|---|
| E1 | **C4 SIMD** | 同一份 refblas 源码，仅差 `-msimd128`，测 512²/1024²/2000² DGEMM | 数值过容差 **且** 至少一个主要尺寸中位数 **≥1.5×** | 全尺寸 <1.1× 或数值回归 | 待跑（需重编 BLAS + 重链） |
| E2 | **OpenBLAS SIMD 单线程** | 上游 `WASM128_GENERIC` + `USE_THREAD=0` | 对 refblas ≥1.5× | <1.2× | 待跑 |
| E3 | **C2 pthread × dlopen** | main `-pthread -sSHARED_MEMORY -sMAIN_MODULE=1` + side `-pthread -sSIDE_MODULE=1`；起 2 个 pthread 忙等，解释器线程 `dlopen/dlsym` ×100 | 三家基线 100/100 无 hang | 任一 deadlock/LinkError/abort | 待跑 |
| E4 | **C3 + JSPI + dlopen（不带 pthread）** | DedicatedWorker 里：JSPI + **真实 side module + 真实 preload FS** | 100 次循环无 hang，且主线程计算期间仍响应 UI | 任一依赖 `window/document`，或 worker 侧 dlopen 因 FS 不可见而回退网络 | 待跑 |
| E5 | **Q10 iframe COI** | 本文阶段 1 九格 | 已跑通 **6/0**；预期行为全部复现 | 任一格与表不符 | ✅ **已完成**（本文） |
| E6 | **C6 双实例** | 同页 2 实例：各自 mount、DOM id、资源 base、FS/IDBFS 命名空间、导出 API；交替 eval 100 次 | 0 串扰、0 404、0 全局覆盖 | 任一实例改动另一实例状态 | 待跑 |
| E7 | **宿主 credentialless 路（C8）** | 阶段 2 已在最小页验证；真实场景要在书站模板上验：SW scope、首访 reload、bfcache、硬刷新各 20 次 | 稳定拿到 `crossOriginIsolated=true` 且 CDN 无失败 | 任一基线浏览器持续 reload / 资源被拦 | 最小页 ✅；真书站待跑 |

**Q4（JSPI×Worker）红绿**：worker 内最小 wasm + `Suspending(fetch)`，100 次挂起/恢复；绿=100/100，
红=任一引擎无法 resume / worker 永久挂起。

---

## 六、仍未解决 / 需外部输入的

1. **宿主是否愿意装 service worker**（C8 的唯一前提）。若不愿意 ⇒ 线程在嵌入模式下彻底不可用，
   只剩 C4 的 SIMD 杠杆（此时 E1/E2 的优先级更高）。
2. **Safari 基线**：无 credentialless ⇒ require-corp 会拦 CDN、跨源 iframe 需 CORP ⇒ 嵌入模式在
   Safari 上必须走单线程。
3. **Q4 的实测值**（JSPI 在 DedicatedWorker 的实际可用性）——待写探针。
4. **C8 的副作用清单**（首访 reload、SW 缓存与资产指纹、credentialless 剥凭据对第三方脚本的影响）
   ——最小页只验证了"脚本能加载"，未验证"加载后行为等价"。
