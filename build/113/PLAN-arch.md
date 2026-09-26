# PLAN-arch.md · 架构深化（D1–D6，branch `Slay`）

> **这是什么**：一次三轮拷问（grilling）之后的**冻结结果**。每条决策都带依据与**复跑方式**，
> **不要再重新论证**；要改就改本文件，并在 §1 对应条目上写清"为什么翻面"。
> 原始只读扫描报告在 `/tmp`（会消失，**别引用它**）—— 它的事实已并入 §4 附录。
>
> **与 `PLAN-threads.md` 的分工**：那条线管**并行度**（SIMD / 线程 / Worker / 嵌入契约）；
> 这条线管**把规矩从人的记忆搬进代码**（构建入口、产物身份证、宿主去重、测试契约、术语）。
> 两条线**共享同一个产物**（8761 现役 `1ed3e528…`）。
>
> **起因**：用户一句"我咋听不懂呢，说明程序里有屎"。诊断结论是：
> 关键规矩（哪些开关必须一起拧 / 这个产物带什么能力 / 探针怎么跑 / 黑话什么意思）
> **只存在于文档叙述与人的记忆里**，不在代码里。

---

## §0.5 现在的状态与下一步顺序

**现在的状态（2026-09-26，本文件立）**：

- 8761 = `1ed3e528…`（SIMD 版），**本计划全程不动它** —— 除 A2 那次显式 promote。
- 已完成：C4（SIMD 落地）/ C6（多实例嵌入契约）/ B5（解释器进 Worker + worker 内真渲染）。
- **A0 已落地（2026-09-26）**，A1 起尚未动代码。§0 "当场就错" 的五条里，四条已经自己消失了
  （见 §4.1 的复核记录），**只剩 `bridge/index.html` 的 demo 错误路径一条**，它随 A2 一起清。

**下一步顺序（按此执行，不改）**：

```
✅ A0 · 收尾 + 立三列闸门（零风险，不 promote）—— 已落地，反向断言已实测
✅ A0b · 同步 matrix-android.html 到三处 + 给它配探针 —— 已落地，8761/8768 各 8/0
✅ A1 · D1 + D2（构建侧：relink.sh + octave.build.json）—— 已落地，**逐字节复现 1ed3e528**，
       反向断言 11/11（不 promote，站点零改动）
A2 · D3 + D4（页面侧：octave-core.js + Capabilities；★ 带 promote 上 8761）
A3 · D5（测试清单 + sweep/harness 搬进仓库）
A4 · D6（CONTEXT.md 术语表 + 证据行）
B6 · 线程版构建 —— ⛔ **本轮明确移出待办**（见 §2 B6：要人拍板翻闸门③，且线程档在 Pages 上跑不起来）
```

---

## §1 冻结的决策（三轮拷问的结论，逐条带依据）

### 1.1 D1 · 重链入口 `build/113/relink.sh`

**问题（实测）**：`link-web.sh` 读 **22 个环境变量**（复跑方式见 §4.2）。其中：
只有 2 个"值写错会当场报错"（`GL_BACKEND` 只认 `webgl`、`MAIN_MODULE_LEVEL` 只认 1/2），
**所有"漏写"都是静默**（唯一例外是默认目录不存在）。而 `link-web.sh` 的**六组产物自检
全部在"开了才查"的分支里**（`:553` JSPI / `:588` GL / `:610` M2 保活 / `:632` FreeType /
`:647` IDBFS / `:661` fontconfig —— 复跑见 §4.3），漏一个开关 ⇒ 自检**整块跳过**、构建全绿。
全仓**没有任何脚本**封装这条命令：`recover.sh:57`、`recover-113.sh:41` 只是**打印**
那条 20 个前缀的命令让人手抄。

**冻结的接口**：

| 项 | 决定 |
|---|---|
| 对外接口 | **只有** `<模式>` + `--out <目录>` + `--diag`；**没有 `KEY=VAL` 逃生门** |
| 模式表 | v1 就 **3 个**：`product` / `scalar` / `m1`（见 1.7 的基线链） |
| 22 个变量 | **模式推出全部 22 个**（能力的 7 个 + 管道的 15 个），**一律不可手设** |
| 子命令 | `relink.sh link <模式>`（默认，快）/ `relink.sh rebuild <模式>`（显式，慢，要 `--yes-rebuild`） |
| 出厂自检 | **拿模式声明的能力去核对 D2 清单的实测段**；任一条声明没有实测背书 ⇒ **exit 非零且不写清单** |
| 文档 | `relink.sh --explain <模式>` 打出 22 个变量 —— **散在 8 份文档里的 12 条配方删掉**（删除测试） |
| 低层工具 | `link-web.sh` 的 22 个变量**保持原样当内部工具**，六组 grep 自检**不重写**（它们是好诊断） |

> **✅ 实现状态（2026-09-26，A1 已落地）**：见 §2 A1 —— 交付 `relink.sh` +
> `write-build-manifest.py` + `check-build-manifest.py` + `test-manifest-check.py`，
> **逐字节复现 `1ed3e528…`**、反向断言 **11/11**、新增 `--selfcheck` 把"22 个变量全覆盖"
> 变成一条静态可测契约（反向实测能红）。

**为什么"管道变量也不可手设"**：22 个变量里只有 7 个是能力轴（`WITH_JSPI` / `WITH_FREETYPE` /
`WITH_FONTCONFIG` / `GL_LIBS` / `EXTRA_LDFLAGS` / `MAIN_MODULE_LEVEL` / `P5_TOOLKIT`），
其余 15 个是管道（`M_SRC` / `PRELOAD_AT` / `FORGE_SRC` / `KEEP_LIST` / `EXPORT_IF_DEFINED` /
`EXPORTED_FUNCS` / `GL_BACKEND` / `LIB_FUNCS` / `P5_GLPROBE` / `P5_TRACE` / `DIAG_*` ×3 /
`OCT_SCAN_DIRS` / `BASELINE_WASM`）。管道变量照样漏一个就静默退化（`OCT_SCAN_DIRS` 漏了
`:613` 直接**跳过保活闸门**），所以它们也必须由模式推出来。

### 1.2 D2 · 产物身份证 `octave.build.json`

**问题（实测）**：产物"带什么能力"今天只能**猜** —— 全仓 **15 处**靠 grep/parse 三件套
推断"这是哪个产物"（`link-web.sh` 自己 8 处、3 个 `.githooks`、3 个 test 套件；
复跑见 §4.4）。而且**"用的哪个 BLAS"根本没有判据**（只能拿 v128 计数当代理）。
worker 模式**连 sha 自证都没有**（页面算，worker 不算）。

**冻结的形状**：

| 项 | 决定 |
|---|---|
| 谁写 | **`link-web.sh` 在 `:671` 之后写**（紧挨 `== 产物:` 那段之前）—— 手跑也产清单 |
| 谁核 | `relink.sh` 拿模式声明核对实测段；任一条不符 ⇒ exit 非零 + **不写清单** |
| 两段 | `declared`（模式声明的**能力布尔**，不是旗标转抄） + `measured`（构建真的量到的） |
| 内容 | **只放构建能量到的东西**：`simd.v128`、三件套 sha256、`link-web.sh` 自己的 sha、`jspi.entry`（`eval_wait` 在不在）、`gl4es`、字体系列名、`idbfs`、`blas.archives[]{name,sha256}`、emcc 版本、时间戳 |
| 不放 | **传进去的旗标组** —— 旗标转抄一遍就是又一份会漂的拷贝 |
| 入库 | **入 `site/`**（它是入库的逐字节镜像）⇒ `site/octave.build.json` 也进 git、进 dist 包 |
| 硬不变式 | **清单 sha 必须等于产物 sha** —— 所有读者的第一条断言 |
| 硬不变式 2 | **没有清单的产物 = 不可部署** —— promote / parity / check-boot / worker 自证全部要求清单存在 |

> **✅ 实现状态（2026-09-26，A1 已落地）**：见 §2 A1。两点与设计稿的差异：① 第二类不变式改成
> "**`verdict == "ok"` 才可部署**"（判不过时**写** `verdict:"rejected"` + mismatches，而不是
> 不写文件 —— 效果一样但留证据）；② **`octave.js` 的 sha 与输出目录名绑定**（里面嵌了
> `PACKAGE_NAME="/src/websrc/<OUT>/octave.data"`），所以"这是哪个构建"的锚点用 **wasm** sha。

### 1.3 D3 · 一内核两适配器 `bridge/octave-core.js`

**问题（实测）**：`bridge/index.html` 与 `bridge/octave-worker.js` 是同一件事的两份实现，
**已经漂了 7 处以上**（逐条见 §4.5）。最典型：取点写内存一个用 `inst.mem` 一个用模块级
`wasmMemory`；页面有 sha 自证 / JSPI 能力门 / 800ms 写回三点，worker **三样都没有**；
`stdin` 一个 TTY 模拟一个直接 `return null`；`pkgfix` 同步那句 eval 字符串两边**不一样**。
还有个**第三个宿主** `site/matrix-android.html` 又抄了一遍 JSPI 门（见 1.7）。

**冻结的缝（什么穿过它、什么留下）**：

- **内核 `octave-core.js` 拥有**：Module 配置 / 启动链 / 资产组（CORE 8 个 + HELP 7 个 + pkgfix+webshims）/
  `eval_async` 包装（`promising(_eval_wait)`）/ 取点三原语覆写 / IDBFS 挂载 / **`Capabilities`**。
- **宿主提供 ~7 件**：stdout 汇、stderr 汇、画布工厂、点击来源、stdin 来源、资产 base、模式。
- **批处理策略留在宿主侧、明确不统一**：页面 200ms + rAF/throttle 与 worker 8KB/16ms
  各自对自己那个汇是对的（DOM 强制布局 vs `postMessage` 成本），统一反而错。
- **形态**：IIFE + `global.createOctaveCore(...)`，与既有 `createOctaveAssets` 同型
  （worker 要用 `importScripts`，ES module 在这里没收益）。
- **`window.*` 别名不动**：默认实例保留全部别名（77+ 套断言依赖它）。
- **行为零变化是硬要求**：`octave-core.js` 是**搬运**不是重写；**任何需要改断言的差异都算行为变化**，
  停下来先报告，不许顺手"修"。

### 1.3/1.4 状态（2026-09-26）

> **✅ A2 已落地**：见 §2 A2 —— 交付 `bridge/octave-core.js`，两个宿主变薄适配器；
> 逐行核出的漂移是 **10 处**（计划里写 7 处，已更正）、缝是 **9 件**（计划里写 7 件）。
> 另外 `Capabilities` 有了探针 `test/browser/probe-caps.mjs`（12 项，含"身份证 404 也要降级"的反证）。

### 1.4 D4 · `Capabilities`（★ 折进 D3，不独立成批）

**问题（实测）**：**20 处**能力探测，同一个问题问 2–3 遍且写法不同（WebGL 三种探法：
`index.html:725` / `:765` / `octave-worker.js:242`；`Suspending` 三种形态：`index.html:170` /
`:352` / `worker.js:130`；`crypto.subtle` 两种否定式）。

**决定**：`Capabilities` **就是内核开机后的返回值**（引擎能力 ∩ 查询参数 ∩ D2 清单），
页面/worker **只读它、开机后永不再探测**。⇒ D4 的独立投入 ≈ 0。
`Capabilities` 里明确包含：引擎（Suspending/promising、OffscreenCanvas、WebGL2、`crypto.subtle`、
`crossOriginIsolated`/SAB）、产物（读清单：`jspi.entry`/`simd`/`gl4es`/fonts/idbfs）、
查询参数（`base`/`home`/`worker`/`bench`/`tk`）、模式（`single`/`worker`/将来 `threads`）。

### 1.5 D5 · 测试清单 `test/browser/manifest.json`

**问题（实测）**：81 个 `.mjs`（43 `accept-` / 36 `probe-` / 2 `bench-`），
**17 个不产 sweep 能解析的汇总行**（复跑见 §4.6）；`sweep.sh` **在仓库外**
（`/mnt/hdd/octave-wasm-build/sweep.sh`）⇒ **测试契约的真正定义在仓库外**。

**冻结的决定**：

| 项 | 决定 |
|---|---|
| 清单 | 进仓：`test/browser/manifest.json`（类别 / 是否自托管 / 是否要 URL / 是否要额外引擎 / 超时 / `summary`） |
| sweep | 搬进仓 `build/sweep.sh` **并读清单**；仓库外那份留 **两行 shim**（`cd` + `exec`）保旧肌肉记忆 |
| runner | `test/browser/run.sh`（原 `harness/run.sh`，7 行）；外部依赖**收敛成一个 env var**（默认值 = 现在的路径） |
| 17 个 | 先标 `summary:false, manual:true`，**不改写**（改写它们是另一件事） |
| `bench-*` | **单列一类**（现在 `PROBES=1` 会把它一起扫进来，而文档没提） |
| `recover.sh:125` | 那段 printf 重新生成 `run.sh` 的代码改为引用仓库里那份 |
| 留外的 | `node_modules`（playwright-core 1.63.0）与 `sweep-logs/` —— 不进仓 |

### 1.6 D6 · `CONTEXT.md` 术语表 + 证据行

**问题（实测）**："闸门"在仓库里有 **6 种**互不相同的含义（提交前六项 / 三道机制门 /
机制探针 / 一致性闸门 / 保活闸门 / 运行时能力门，逐条见 §4.7）。全仓**无 `CONTEXT.md`、
无 ADR 目录**（已复核）。

**冻结的决定**：

- `CONTEXT.md` **v1 术语名单（13 条）**：口径 / 闸门（拆成**机制门**·**提交前六项检查**·
  **运行时能力门**三个具名术语）/ A 姿势·B 姿势 / D9 门槛 / M1·M2 / side module / 桥 / P5 /
  `PROBES=1` / 白名单 / 活状态·`AUTO:STATE` / 快回环 / 保活闸门。
- **每条后挂一行可复跑的证据**，**优先读清单字段**（D2 落地后：`octave.build.json:simd.v128`
  取代"反汇编数 v128"），其次 `file:line` 或一条命令。
- **代码零改名**（产物目录名的改名已由 D1 的模式名顺带完成）。
- **不建 ADR 目录**：用 `CONTEXT.md` 里一节"决定 + 可证伪的证据 + 什么情况下翻转"。
- **顺序约束**：D6 **必须排在 D2 之后**（证据行要指向清单字段）。
- 轻闸门：`check-consistency.py` 加一条"术语证据行引用的路径必须存在"。

### 1.7 跨候选的硬约束（这四条是三轮里最贵的结论）

1. **基线链是结构，不是文档里的路径字符串**：今天存在自相矛盾 —— 文档基准配方写
   `BASELINE_WASM=/src/websrc/out/octave.wasm`（**M1**），而现役实际用的是
   `BASELINE_WASM=/src/websrc/m2fc-jspb-out/octave.wasm`（**M2 去 SIMD**）。
   ⇒ 冻结为**模式链** `m1 → scalar → product`，每一级拿上一级的产物当基线
   （`m1` 没有基线，沿用现有的"警告并跳过"）。这样 `product` 的基线就是 `scalar`，
   **与今天实际在跑的一致**，且"基线是哪个产物"第一次成为结构。
2. **★ 已落地（A0）——"仓库镜像"闸门**：仓库 `site/` 与 `bridge/` 是**手工同步**的
   （`grep -rn 'site/index.html' --include='*.sh' --include='*.py' .` = **0 命中**，复跑见 §4.8），
   而旧版 `check-site-parity.sh` **只比 8761 vs 8768** ⇒ 重构页面后忘记同步仓库 `site/`，
   **闸门全绿而入库镜像已过期**。⇒ `check-site-parity.sh` 已扩成**三列**
   （A=8761 / B=8768 / C=仓库 `site/`，可用 `SITE_A/B/C` 覆盖）。
   **实现上的一个修正**：第三列比的是**部署件清单**
   （`octave.{wasm,js,data}` + `index.html` + `assets-loader.js` + `VERSION` + `assets/manifest.json`）
   **而不是全量文件清单** —— 因为"全量清单"会被站点上的历史遗留文件（8768 有
   `octave.js.orig`/`wtest.*`）与非部署件的漂移（`matrix-android.html`）天天弄红，
   而"一个总在红的闸门等于没有闸门"（`check-site-parity.sh` 原话）。
   ⇒ **不需要豁免名单**；非部署件的三方内容差异单独一节**只报不算**。
   反向断言已实测：把仓库 `site/index.html` 改一个字节 ⇒ 第三列变红、`--strict` exit 1；
   还原后逐字节回到绿（见 §2 A0）。
3. **★ 结论被新证据推翻：`site/matrix-android.html` **不删**（决定权交回人）**。
   原判是"手写、无生成器、零测试、会进 dist ⇒ 删掉"，但侦察给出两条反证：
   ① `DEPLOY.md:13` 明确写着它的用途 ——"浏览器矩阵自测页（自动跑能力门并把结果写进 DOM，
   供截图/无头读取）"，即**给手机/无头用的矩阵页**，不是垃圾；
   ② 三处里 **8768 那份是新的**（41386 B，sha `5d2dca7f…`），8761 与仓库是旧的那份
   （33947 B，sha `f6eaf0e3…`）—— 也就是"仓库里的副本落后于实验车道"。
   ⇒ **不擅自删**（删掉等于替人决定"手机自测页不再需要"）。
   **★ 2026-09-26 用户拍板：同步到 8761 + 仓库**，已执行并实测：
   ① 先在**它现在的位置**（8768）用新写的探针 `test/browser/probe-matrix-android.mjs` 验
   **8 PASS / 0 FAIL**（2.8s 跑到终点，能力门报 `smoke=pass`、`eval_async=function`）；
   ② 再把 8768 那份 `cp` 到 8761 与仓库 ⇒ 三份同 sha `5d2dca7f…`，三列闸门 `--strict` 绿、
   非部署件那节从"内容不同"变成"（无）"；
   ③ **在 8761 上重跑同一探针：8 PASS / 0 FAIL**，`check-boot.sh` 绿（1.7s），
   部署件 `octave.wasm` 仍是 `1ed3e528…`（这次只动了一个静态页，产品三件一个字节没变）。
   ④ 顺带把这个**以前零覆盖**的页面变成有探针的：它的漂移就是这么发生的。
   ⚠️ 探针里那条 favicon 噪声**不写死豁免**，而是当场用 Node 侧 `fetch('/favicon.ico')` 测一次 ——
   实测（差分测试）普通 `index.html` 也产生**完全相同**的那条 404，所以它是浏览器自发请求；
   站点哪天补上 favicon，豁免自动消失。在页面里 fetch 会把自己的 404 混进被测量窗口（踩过）。
4. **promote 政策**：A1/A3/A4 **不 promote**（A1 是纯构建侧，站点一个字节都不动；
   A3/A4 是工具与文档）；**只有 A2 带 promote 上 8761**，走完整仪式。

---

## §2 批次与判据（每批：目的 / 改什么 / 红绿判据 / 回退点）

> 通用纪律：每批六道闸门 + `Slay` 上提交（**不 force-push / 禁 `--no-verify`**）；
> **8761 在 promote 之前一动不动**；跑验收前先验产物 SHA（`check-deploy-sha.sh` +
> `probe-artifact-sha.mjs`）；重活 `setsid nohup … &` + ≤3 分钟轮询。

### A0 · 收尾 + 立三列闸门（✅ **已落地 2026-09-26**，零风险，不 promote）

- **实际改了什么**：
  ① `check-site-parity.sh` 扩成**三列**（A=8761 / B=8768 / C=仓库 `site/`）+ 新增一节
  【非部署件的内容差异（只报不算）】+ 名字集合差异报告；
  ② 仓库根 `DEPLOY.md` **进白名单**（`.gitignore` 加 `!DEPLOY.md`）**并修掉它的两处死话**；
  ③ **没有**删 `matrix-android.html`（依据见 §1.7.3 —— 新证据推翻了原判）；
  ④ 顺带把 `AGENTS.md` 首行的"当前工作令"从 `PLAN-jspi.md` 改成 `PLAN-arch.md`。
- **★ 原计划里两处被侦察推翻的判断（记下来，防止再犯）**：
  · 原判"仓库根 `DEPLOY.md` 是孤儿 stub，删掉"。**错**：它是 41 行、2270 B 的**实质文档**
  （`site/` 目录说明 + 三条部署前自检 + Pages 步骤 + 更新流程），且覆盖了 `dist/DEPLOY.md`
  **没有**的内容（`matrix-android` / `check-boot.sh` / `rsync` / `check-site-parity` 四个词
  在 dist 版里 0 命中）—— 而 AGENTS.md:47 正是按名字引用它 ⇒ 这是**又一个"承重文件不在
  git 里"**（同一类 bug，§0① 那个）。正确动作是**收进白名单 + 修死话**，不是删。
  · 原判"三列闸门要登记 `matrix-android` 进遗留豁免名单"。**不需要**：第三列比的是**部署件
  清单**而不是全量文件清单，天然不会因为它变红（见 §1.7.2 的"实现上的一个修正"）。
- **红绿判据（绿，已实测）**：三列 parity `--strict` → **0 差异**（三处部署件 + 49 条清单条目
  全部一致）；报告节如实打出两处**只报**项（8768 的 3 个遗留文件、`matrix-android.html` 三方
  内容不同）。
- **反向断言（已实测，必须能红）**：往仓库 `site/index.html` 追加一个字节 ⇒
  `C=14cd3b33…` ≠ A/B `d6c1490c…` ⇒ 报告模式说"1 处差异"、`--strict` **exit 1**；
  `cp` 还原后 `git diff` 无输出、`--strict` 回到 **exit 0**。
- **回退点**：`git revert` 这一次提交即可 —— 站点零改动（8761/8768 一个字节没动），
  `DEPLOY.md` 从 git 消失后仍是磁盘上那份（内容已修好）。

### A0b · 同步 `matrix-android.html` 到三处（✅ **已落地 2026-09-26**，用户拍板）

- **为什么**：A0 侦察发现三处不一致（8768 是 C6 版 700 行、8761 与仓库是 C6 前 575 行），
  而**没有任何测试会因此变红** —— 这个页面零覆盖地漂了一个版本。用户选"同步"（而不是退役），
  因为 HANDOFF 里"真手机人工过一遍交互"这一步还没做，而它正是给真机/无头读结果用的。
- **改了什么**：① 新增探针 `test/browser/probe-matrix-android.mjs`（8 项：页面跑到终点 /
  结果行形状 / `smoke=pass` / `Suspending`·`promising`·`eval_async` 是 function /
  无未解释错误 / **反证**：不存在的页面必须 404 且不产结果）；
  ② 8768 那份 `cp` 到 8761 与仓库 `site/`（三份同 sha `5d2dca7f…`）。
- **红绿判据（绿，已实测）**：8768 上 **8/0** → 同步 → 8761 上 **8/0**；
  三列闸门 `--strict` 绿且【非部署件的内容差异】变成"（无）"；
  `check-boot.sh http://127.0.0.1:8761/` **BOOT OK 1.7s**；部署件 `octave.wasm` 仍 `1ed3e528…`。
- **回退点**：旧版（sha `f6eaf0e3…`，33947 B）在**上一个提交 `98a5293`** 里：
  `git checkout 98a5293 -- site/matrix-android.html` 取回旧版，再
  `cp site/matrix-android.html /mnt/hdd/octave-wasm-build/site/` 让 8761 回到旧版
  （8768 上那份一直是新的，不用动）。

### A1 · D1 + D2（构建侧，不 promote）—— ✅ **已落地 2026-09-26**

- **实际交付的三个文件**（都在 `build/113/`，`link-web.sh` 只动尾部一处）：
  · `relink.sh` —— 唯一入口：模式表（product/scalar/m1）推出**全部 22 个变量**；
    子命令 `link` / `verify` / `rebuild` / `explain` / `--list` / `--selfcheck`；`--diag` 正交修饰。
  · `write-build-manifest.py` —— 量测并写 `$OUT/octave.build.json`（link-web.sh 尾部自动调）；
  · `check-build-manifest.py` —— 拿模式声明核对实测，写 `verdict`（fail-closed 的判定方）；
  · `test-manifest-check.py` —— 上面那个判定器的**反向断言套件**（11 条）。
- **红绿判据（已实测）**：`relink.sh link product --out /src/websrc/a1-verify-product`
  在 **60 秒内**跑完，六组自检全绿（JSPI 胶水 Suspending=0 + `eval_wait` 在 / gl4es 54 处 /
  保活闸门拿 `scalar` 基线查了 45 个 `.oct`、导出 710 个名字 / 字体 8 个 / IDBFS / fontconfig），
  然后 `verdict=ok`。**三件套复现**：
  | 文件 | 新产物 | 现役 `m2fc-simd-out` | 结论 |
  |---|---|---|---|
  | `octave.wasm` | `1ed3e528561e4475…` | `1ed3e528561e4475…` | **逐字节相同** |
  | `octave.data` | `f250530ae5abe378…` | `f250530ae5abe378…` | **逐字节相同** |
  | `octave.js` | `a91e5a47efd10d70…` | `caac68bf62015859…` | 差 12 字节 ⇒ 见下 |
- **★ 新事实（要记住）：`octave.js` 里嵌了输出目录的绝对路径**
  （`PACKAGE_NAME="/src/websrc/<OUT>/octave.data"`）。所以 js 的 sha **与产物目录名绑定**，
  而 `octave.wasm` / `octave.data` **与路径无关**。决定性验证：把新 js 里的
  `/src/websrc/a1-verify-product` 换成 `/src/websrc/m2fc-simd-out` 之后，
  sha256 = `caac68bf62015859…`，**与现役逐字节相等** ⇒ 除了那个路径**没有别的差异**。
  ⇒ 推论：①"这份产物是哪个构建"的锚点应当用 **wasm sha**（`check-deploy-sha.sh` 与
  `probe-artifact-sha.mjs` 用的正是它，所以现有闸门不受影响）；② 换目录重建会得到不同的
  js sha，别把它当成"产物变了"。
- **"能编过 ≠ 能用了"的收口（浏览器侧实测）**：把 A1 产出的三件套覆盖进一份站点副本
  （同盘硬链接建副本 + 替换三件套，避免 63MB 全量拷贝），在 **8772** 起静态服务后实测：
  `check-boot.sh` **BOOT OK 0.9s**；`probe-artifact-sha.mjs` **3/3**
  （页面实例化的字节 = HTTP 层字节 = 期望的 `1ed3e528…`）；
  两个真套件 **`accept-113-boot` 10 PASS / 0 FAIL**、**`accept-113-libs` 17 PASS / 0 FAIL**。
  ⇒ 新入口产出的产物不只是"字节相同"，**浏览器里真的能用**。
  （测试目录已清理、8772 已关；8761/8768 全程未动，收尾复测仍 200。）
- **反向断言（已实测）**：`test-manifest-check.py` **11 PASS / 0 fail** ——
  基准（原样重判 ⇒ ok）+ 9 条逐规则反证（`jspi_entry`/`gl4es`/`main_module`/`idbfs`/
  `fontconfig`/`fonts`/`simd.v128`/`jspi_glue_suspending`/清单文件 sha 配对）
  + 1 条**未知声明键必须拒**（拼错键名不许静默放过）。
  另有跨模式反证：拿 `scalar` 的声明（`simd:false`）去判一件真 SIMD 产物 ⇒
  `✗ simd: 声明=false 实测={"v128": 4752}`、`verdict=rejected`、exit 3。
- **`--selfcheck`（D1 的可测契约，静态、不需容器）**：link-web.sh 读的每个环境变量都必须由
  模式表推出，且模式表里不许有 link-web.sh 不读的变量，三个模式的变量集合必须一致。
  正向绿（22 个全覆盖）；反向实测：临时加一个 `${ZZZ_NOT_IN_TABLE:-}` ⇒ 报红、rc=1。
- **三处对计划的诚实修正**（都记在这儿，防止下次照旧话做）：
  ① **fail-closed 的落点从"不写清单"改成"写 `verdict:"rejected"` + mismatches"** ——
     效果一样（读取方只认 `verdict=="ok"`），但**留下证据**，比"文件不见了"好查得多。
  ② **基线链是"结构优先 + 如实记录"，不是硬引用**：模式表里 `BASELINE_WASM` 是路径
     （product → `/src/websrc/m2fc-jspb-out/octave.wasm`，即 scalar 的产物；scalar →
     `/src/websrc/out/octave.wasm`，即 m1 那类产物），`pick_baseline` 会在"下一级模式自己的
     产物存在"时优先用它。**没做成硬引用**的理由：那会强制先重建 m1（36MB 的 M1 链接）才能
     链接 product，而 `BASELINE_WASM` **只喂保活闸门、不进链接行**（`grep -n BASELINE_WASM
     link-web.sh` 只有 `:622` 一处）⇒ 它**不改变产物字节**。但"基线是哪个产物"不再靠记：
     基线路径与 sha256 都进了清单的 `inputs.baseline_wasm`（本次实测
     `45d288b1c6c1855e…` —— 正是那个去 SIMD 的基线）。
  ③ **`rebuild` 的执行路径尚未实测**（要走 configure + `make clean` + 全量 make，数小时）：
     已实现且打印它将要跑的每一条命令、要 `--yes-rebuild` 确认，第一次真用是 B6。
- **回退点**：删掉那四个新文件 + `git checkout 98a5293 -- build/113/link-web.sh`；
  产物与两个站点**零改动**（本次只写了一个新目录 `/src/websrc/a1-verify-product`）。

### A2 · D3 + D4 + §0⑤（★ 唯一带 promote 的批次）—— 已落地，结果见文末一行

**实际交付**：新增 `bridge/octave-core.js`（内核，440 行）；`bridge/index.html` 782 → 432 行、
`bridge/octave-worker.js` 283 → 233 行，两者变成薄适配器。`octave-core.js` 进了三处拷贝清单
（`promote-webgl.sh` 的清单 + **点名校验**、`recover.sh`、`recover-113.sh` —— 顺带把后者一直
缺的 `queue.js`/`p5canvas.js`/`octave-worker.js` 补齐）。

- ★ **漂移不是 7 处，逐行核出来是 10 处**（我原先写少了 3 处，这里更正）：
  ① `print/printErr` 落点（页面 console+上屏 / worker 合并）② `instantiateWasm` 里页面有
  sha 自证、worker 用模块级 `wasmMemory` ③ 取点原语（页面按实例且 guard `inst.mem`，worker
  ​无 guard）④ `stdin`（TTY 模拟 vs 直接 EOF）⑤ `eval_async` 包装（页面有幂等检查 + try/catch，
  worker 都没有）⑥ IDBFS（页面有 `webSync` + 800ms 去抖写回，worker 只有读回）⑦ 启动链
  （页面逐步 `console.warn`；**`pkgfix` 那句 eval 字符串两边不一样**）⑧ **JSPI 能力门 worker
  完全没有** ⑨ 资产清单（CORE 8 + HELP 7）抄了两份 ⑩ `execute_interp()` 与 JSPI 包装的**顺序相反**。
- ★ **缝是 9 件**（不是 7 件）：`base` / `print` / `printErr` / `note` / `stdinLine` / `clicks`
  （队列**对象**，宿主拥有）/ `doc` / `assets`（装载器工厂）/ `onReady`；外加 `state`（宿主自己的
  实例记录，内核直接写 `armed/ready/mem` —— 页面的 pointerdown 扇出读的就是它）。
- **搬运时抓到的两个真问题**（都会在浏览器里表现为**静默失效**，与"能编过≠能用了"同族）：
  ① **`BASE` 必须活取值**：worker 的 `BASE` 由 `opts` 消息在 `createOctaveCore` **之后**才设，
  捕获成值 ⇒ `?worker=1&base=…` 静默失效。改成传函数（`baseOf()`）+ 把清单读取挪进 `boot()`。
  ② 我自己写的 `var J`（JSPI 门状态）落在 `boot()` 里 ⇒ 返回对象上的 `jspi()` 读不到
  （ReferenceError）⇒ 提到外层作用域。
- **"看着可以顺手改、但我没改"的三处**（行为一字不改的代价）：`[idbfs] 已读回` 保持**无条件**
  打印（`accept-idbfs.mjs:59` 断言控制台里有它——查过了才敢碰）；`[assets] 可用资产` 同样保持
  无条件（曾想加 `trace` 开关，查过没有套件读它，但没必要动行为）；默认实例**复用**
  `window.OctaveAssets` 而不是新建（否则测试读的与 boot 链用的不是同一份状态 —— 原注释记着这条）。
- **§0⑤ 开机 demo 错误路径**：随工厂整段替换消失（`feval("error",…)`/`chk`/`callModule`/`disp`
  在 `bridge/index.html` 里 grep 计数全 0）。
- ★ **matrix-android 的改法比计划好**：不删，**给它配生成器** `build/113/gen-matrix-android.py`
  —— 尾块用 `MATRIX-TAIL-START/END` 定界，生成物 = **当前 `bridge/index.html` + 尾块**，幂等，
  自检"生成后 `<script src>` 集合与 index.html 一致"。A0b 记的"无生成器、手工同步"这个**漂移
  根因**就此消掉（以后改页面只要重跑生成器）。
- **判据与结果（全部实测）**：
  · `glue-selftest` **91/91** ✓
  · 8768 冒烟六套（正对我动过的每一处）：`accept-113-boot 10/0`、`accept-worker 16/0`、
    `accept-embed-multi 13/0`、`accept-idbfs 9/0`、`accept-input 9/0`、`accept-ginput 10/0` ✓
  · **8768 全量 43 套 / 1076 PASS / 0 FAIL**（`accept-worker` 恰好排在最后跑，正好覆盖了
    "给 worker 的 `diagnose` 加 `caps` 字段"那一改）
  · promote（`SRC_OUT=GL_OUT=/src/websrc/m2fc-simd-out`）自检绿、**BOOT OK 1.7s**、
    两侧 wasm sha 一致
  · **SHA 三层**：磁盘 / HTTP / 页面自证全 = `1ed3e528…` ✓
  · **8761 全量 43 套 / 1076 PASS / 0 FAIL**（与 8768 同一组数字）✓
  · **三列 parity `--strict` = 0 差异**（连 promote 里重新打包的 6 个资产都逐字节一致）
  · 新探针 `probe-caps` **12/0**（含反证：身份证 404 ⇒ 页面照常 ready、`artifact=null`、无报错）
  · **43 套断言一行没改** ⇒ 行为零变化这条硬要求成立。
- **回退点（A2 新增一个）**：`/mnt/hdd/octave-wasm-build/site-preA2-bak-20260926/`（promote 前
  的 8761 逐字节快照）；另有 `site-prewebgl-bak`（脚本自建）与 `site-baseline-45d288b1/`。
- **回退点**：`site/` 回 `site-baseline-45d288b1/` 或 `siteWebGL-preidbfs-bak-20260924/`；
  代码 `git revert`；`bridge/octave-core.js` 删掉即可回到"两份各写一遍"的旧形态。

### A3 · D5（测试清单 + 搬迁）—— ✅ **已落地 2026-09-26**

- **交付**：`build/sweep.sh`（**读清单**）、`test/browser/run.sh`（runner 进仓库）、
  `test/browser/manifest.json`（类别 / 超时 / 要不要汇总行 / 人工套件 / 缺环境变量）；
  仓库外的 `sweep.sh` 与 `harness/run.sh` 变成**两行兼容 shim**（`exec` 仓库那份）；
  `recover.sh` 不再 printf **生成一份实现**（只补 shim）—— 以前那份实现只在仓库外，仓库没有。
- ★ **计划里的"17 个不产汇总行"这个数字是错的**（逐条查过）：真实构成是
  **2 个 bench**（`bench-core`/`bench-dgemm`，本来就不打汇总）+
  **15 个真·不产汇总的探针**（打表格给人看）+
  **4 个"有自己的格式"**：`probe-browser-matrix`（`=== <URL>: N PASS / M FAIL ===` 带前缀）、
  `probe-coep-engines`（`... / N N/A`）、`probe-iframe-coi`（用 `结果：` 前缀）、
  `probe-coi-sw`（裸环境启动即失败，要 `PLAYWRIGHT_BROWSERS_PATH`）。
  ⇒ 处理：**前 3 个各补一行规范汇总**（保留它们给人看的那行；扫描取**末条** ⇒ 追加即生效），
  `probe-coi-sw` 标 `requires_env`（缺变量 ⇒ 跳过并计数，不是静默漏跑），
  `probe-gl4es-smoke`（**硬编码 8767 端口**）进人工名单。
- **验收（全部实测）**：
  · 默认选中 **恰好 43 套** accept（与原仓库外版行为一致，数字对得上）；
  · `PROBES=1` 选中 **66 套**、跳过 **17 套并逐条列名**（16 人工 + 1 缺环境变量）；
  · 正向：`sh build/sweep.sh <URL> 'accept-113-boot'` → `10 PASS / 0 FAIL`、**全绿**、rc=0；
  · 仓库外 shim 同样能跑（同一条命令走 `/mnt/hdd/octave-wasm-build/sweep.sh`）→ 10/0 全绿；
  · **反向①**：过滤器不匹配任何套件 ⇒ `FATAL ... 没有匹配到任何套件`、**exit 2**
    （不是"跑 0 个然后绿"）；
  · **反向②**：过滤器**只**匹配人工套件 ⇒ **明确跳过 + 计数 + 列名**、exit 0。
- **回退点**：删 `build/sweep.sh` / `test/browser/run.sh` / `test/browser/manifest.json` +
  恢复仓库外那两个脚本（内容与旧版都在本文件与 HISTORY 的记录里）。

### A4 · D6（术语表）—— ✅ **已落地 2026-09-26**

- **交付 `CONTEXT.md`**：把"我咋听不懂"那句话当验收标准写的术语表 —— **17 个条目**
  （计划里说 13 条，实际写全了更多）。核心动作是**把多义词拆开**："闸门"在仓库里有 6 种含义，
  这里拆成五个具名术语（提交前六项检查 / 机制门①②③ / 运行时能力门 / 保活闸门 /
  三列一致性闸门），旧写法保留为**别名**。
- **每个术语一行 `证据：`**，**优先指向产物身份证的字段**（`site/octave.build.json` 的
  `measured.simd.v128` / `measured.jspi_entry` / `measured.exported_functions` / `verdict`），
  其次 `file:line`。另有"历史遗留名字"一节（`m2fc-simd-out` / `B 姿势` / `P5` / `webshims`…）
  说明它们**字面上会误导人的地方**。
- **轻闸门（可证伪）**：`check-consistency.py` 新增检查项 5 —— `CONTEXT.md` 里每个 `证据：`
  行中的**仓库路径必须存在**（防术语表退化成散文）。
  **反向实测**：把 `build/check-boot.sh` 改成 `build/check-boot-NOPE.sh` ⇒ 闸门红并点名该 token；
  还原 ⇒ 绿。
- **代码零改名** ✓；`AGENTS.md` 首屏加了一行指针（"黑话看不懂就读 `CONTEXT.md`"）。
- **回退点**：删 `CONTEXT.md` + 撤掉 `.gitignore` 里的 `!CONTEXT.md` + 撤掉检查项 5；
  纯文档，不影响站点与产物。

### B6 · 线程版构建 —— ⛔ 本轮仍不做，但**理由已更正**（2026-09-26 实测重估）

**先说更正**：本文件与 `HANDOFF.md` 在 2026-09-26 曾写过"线程档在 GitHub Pages 上跑不起来"。
**那句话是错的**（我误读了旧笔记里"只有 Chromium 能兼得 COI + CDN"的措辞 —— 被拦的是**跨源 CDN
脚本**，不是 COI 本身）。实测（`test/browser/probe-coi-sw.mjs`，三引擎 × 三档）：
`coi-serviceworker` 装上之后 **Chromium / Firefox / WebKit 三个引擎全部拿到
`crossOriginIsolated=true` + `SharedArrayBuffer`**（同源 iframe 也继承 COI）。被拦的只有
**跨源且无 CORP 的第三方脚本**（chromium 两档都放行，Firefox/WebKit 两档都拦；credentialless
定制在 Firefox 上也救不回来）。而**本站在页面上不引任何第三方 CDN**（`index.html` 的 script
全是同源本地文件）⇒ 这条限制对我们**没有影响**。

**"多线程 × Firefox"的实测（2026-09-26，用户点名要兼顾 Firefox）**：
- 有 COI（require-corp）时，**Firefox 与 Chromium 跑 pthread 产物完全平齐** ——
  同一个探针产物（`/mnt/hdd/octave-wasm-build/threads-probe/`，pthread + 运行期 dlopen）：
  chromium `{coi:true, sab:function, ok:100, missing:0, busy:47, runMs:28}`，
  firefox `{coi:true, sab:function, ok:100, missing:0, busy:42, runMs:23}`。
  ⇒ **多线程本身不歧视 Firefox**（Firefox 支持 SAB + wasm threads + pthread）。
- 无 COI 时两个引擎**同样**失败（`DataCloneError`；Firefox 的报错信息甚至更清楚）。
- Firefox 支持**两种** COI 模式（`require-corp` 与 `credentialless`，实测 `probe-coep-engines` 6/0）；
  WebKit 只有 `require-corp`。
- ⇒ **翻闸门③不会造成"Chromium 能用 / Firefox 不能用"的分裂**：两个引擎都要 COI，拿到就都能跑。
- **已配常驻回归网**：`test/browser/probe-engine-parity.mjs`（**22 项 / 0 FAIL**）——
  对 **chromium 与 firefox 各跑 9 条用户可见的轴**（ready / Capabilities / JSPI 真挂起 + 能力门 /
  纯计算 / 真渲染 / 字体 / 同步 XHR / Worker 模式真出图）+ 一条**反证**（删掉 JSPI API ⇒
  页面照常 ready、门如实 `api=false`、`pause` 仍以阻塞方式完成）。
  在此之前 **Firefox 只被 5 项矩阵探针扫到**，而 43 套 accept 全在 Chromium 上跑
  ⇒ "一次改动把 Firefox 弄坏"在日常回归里是**看不见的**；现在这条能看见。

**那本轮为什么仍不做**（理由从"Pages 不可用"换成下面两条）：
1. **收益有限而成本是长期的**：多线程只对少数重计算有用，而 SIMD 已落地
   （DGEMM 1.62×/1.75×/1.31×）—— 最便宜的那档收益已经拿到了。翻门换来的是
   **双产物 + 双份验收 + 要么装 service worker、要么要求宿主发 COOP/COEP**。
2. **它是产品取舍，不是技术障碍**：装 SW（三引擎都能 COI，但与"页面引跨源 CDN 资源"互斥）、
   还是要求宿主发头（更干净但要宿主配合）—— 这要人拍板，不该由执行方顺手定。
   配方与回退点已备好：`build/113/PLAN-threads.md` §5。

**要开工时的前置**：拍板"接受线程档需要 COI（装 SW 或宿主发头）"。
然后：`relink.sh` 模式表加一行 `threads` + 声明（D1 已让它变便宜）+ 全量重配重编数小时 + 双产物。
