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
A1 · D1 + D2（构建侧：relink.sh + octave.build.json，不 promote）
A2 · D3 + D4（页面侧：octave-core.js + Capabilities；★ 带 promote 上 8761）
A3 · D5（测试清单 + sweep/harness 搬进仓库）
A4 · D6（CONTEXT.md 术语表 + 证据行）
B6 · 线程版构建 —— **仍然搁置，等用户一声令下**（不是遗漏，是刻意）
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
   ⇒ **不擅自删**（删掉等于替人决定"手机自测页不再需要"）。当前状态：三列闸门把它列在
   【非部署件的内容差异】里**只报**；要不要同步、要不要退役，**等人拍板**。
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

### A1 · D1 + D2（构建侧，不 promote）

- **改什么**：新增 `build/113/relink.sh` + 模式表（`product`/`scalar`/`m1`，`--out`/`--diag`/`--explain`）；
  `link-web.sh` 尾部（`:671` 之后）加"量测 + 写 `octave.build.json`"。
- **判据①（绿，最硬的一条）**：`relink.sh link product` 必须**逐字节复现 `1ed3e528…`**。
  > 为什么这条判据成立：重链**已被证明是逐字节可复现的** —— `m2fc-out` / `m2fc-idbfs-out` /
  > `m2fc-idbfs2-out` / `m2fc-fonts-out` / `m2fc-jspioff-out` **五个目录 sha 完全相同**
  > （`4faaa96d…`），`out` / `out-webgl` / `out-webgl4` 同理（复跑见 §4.10）。
  > ⇒ 只要模式表**漏掉任一个变量**，sha 必变。这一条一次性证明"22 个变量全被包住"。
- **判据②（反向，必须红）**：让 `product` 的某个声明能力不可能满足（例：把 SIMD 的
  `-L` 指向一个空目录 ⇒ 实测 `simd.v128=0`）⇒ **必须 exit 非零且不写清单**；
  **不写清单即不可部署**（1.2 的硬不变式 2）。
- **判据③**：`--explain product` 打出的 22 个变量与现役重链口径**逐一人工对照**一次
  （对照之后，它就成了唯一的文档）。
- **回退点**：删 `relink.sh`、还原 `link-web.sh` 那一处；产物目录与两个站点**零改动**。

### A2 · D3 + D4 + §0⑤ + matrix-android 三处删除（★ 带 promote）

- **改什么**：抽 `bridge/octave-core.js`；`bridge/index.html` 与 `bridge/octave-worker.js`
  变**薄适配器**；`Capabilities` 由内核返回；删 `bridge/index.html` 的 demo 错误路径
  （`:428` `eval_string('strcat(...)')`、`:429` `feval("error",["foo"],0)`、`:431`
  `console.log(last_error_message())`）与三个死函数（`chk`/`callModule`/`disp`）；
  `matrix-android.html` 从仓库 `site/` 与两个站点删除并撤豁免；仓库 `site/` 与 `bridge/` 同步。
  > **死函数可删的依据**：全仓 grep 过 —— 没有任何 test/script 依赖这五个标识符
  > （`grep -rn 'execute_interp' test/ .githooks/` = 0；`'foo'`/`"foo"` 在
  > `test/browser/*.mjs` = 0；`chk`/`callModule` = 0；JS 那个 `disp` = 0 次调用）。
  > 要保留的是 `#output` 这个 DOM 元素（`accept-worker.mjs` 等三套在用）。
- **红绿判据（绿）**：`sh build/glue-selftest.sh`（91 项）→ **8768 全量**
  （含 `PROBES=1`）→ promote → `sh build/check-boot.sh` → **SHA 三层**
  （`check-deploy-sha.sh` + `probe-artifact-sha.mjs`）→ 8761 全量 → `check-site-parity.sh --strict` 三列。
- **反向断言（必须能红）**：① 保留现有 G0 反证 —— 未包 `promising` 的入口碰挂起点必须抛
  `SuspendError`；② `Capabilities` 在**没有 `eval_wait` 的产物**上必须报 `jspi.entry=false`
  **而不抛**（降级路径）；③ worker 里把 `OffscreenCanvas` 换成假对象 ⇒ 必须**明确报错或降级**，
  不许静默出空白图。
- **行为零变化的证据**：`octave-core.js` 只做**搬运**；**77+ 套断言一行都不改**。
  任何需要改断言的差异 ⇒ 停下来先报告（这是本批唯一的"翻面"判据）。
- **回退点**：`site/` 回 `site-baseline-45d288b1/` 或 `siteWebGL-preidbfs-bak-20260924/`；
  代码 `git revert`。**promote 之前 8761 一动不动。**

### A3 · D5（测试清单 + 搬迁）

- **改什么**：新增 `build/sweep.sh`、`test/browser/run.sh`、`test/browser/manifest.json`；
  仓库外 `sweep.sh` 留两行 shim；`recover.sh:125` 改引用；17 个文件标 `summary:false, manual:true`；
  `bench-*` 单列一类。
- **红绿判据（绿）**：仓库版与仓库外版对**同一 URL、同一次默认筛选**跑出来的结果**逐套一致**
  （同名日志、同样的 PASS/FAIL 计数）。
- **反向断言（必须红）**：① 请求一个 `manual:true` 的套 ⇒ 必须**明确跳过并计数**，不许静默漏跑；
  ② 请求一个不存在的套名 ⇒ 必须报错（不是"跑 0 个然后绿"）。
- **回退点**：shim 保证旧路径仍可用；回退 = 删新增文件。

### A4 · D6（术语表）

- **改什么**：新增 `CONTEXT.md`（13 条术语 + 证据行，优先读清单字段）；`AGENTS.md` 与
  `HANDOFF.md` 各加一行指针；`check-consistency.py` 加"证据行路径必须存在"的轻检查。
- **红绿判据（绿）**：闸门自动查证据行引用的路径全部存在。
- **反向断言（必须红）**：故意写一个不存在的路径 ⇒ 必须红。
- **回退点**：纯文档，`git revert`；**不 promote**。

### B6 · 线程版构建（**搁置，等令**）

- **不是遗漏**：它会**翻掉一条刻意立过的机制门**（闸门③"不引入 COI/SharedArrayBuffer 需求"），
  且要全量重编数小时 + 双产物。配方在 `build/113/PLAN-threads.md` §5。
- **D1 落地后它变便宜**：`threads` 就是模式表里多一行 + 一条声明。
- **已知硬前提（实测）**：线程版产物**硬依赖 COI** —— 没有 COI 时报
  `DataCloneError: … SharedArrayBuffer transfer requires self.crossOriginIsolated`
  ⇒ 它是**产物选择器**，不是可以运行时关掉的开关（**双产物**）。三个引擎里只有
  **require-corp** 是都支持的 COI 模式（WebKit 不支持 credentialless）。

---

## §3 明确不做（写下来是为了防"顺手做"）

1. **不重写** `link-web.sh` 的六组 grep 自检（它们是带注释的好诊断，重写有翻车风险；
   新模式级检查是**独立的第二层**）。
2. **不删**容器里那 45 个带 wasm 的产物目录（里面是 `site-baseline-45d288b1/`、
   `m2ft-out-bak-prefontec`、`out-nongl-bak` 这类**回退点**）。
3. **不给** `relink.sh` 留 `KEY=VAL` 逃生门（等于把静默退化请回来）。
4. **不在代码里改术语名**（`m2fc-simd-out` 这类名字由 D1 的模式名自然取代）。
5. **不建 ADR 目录**。
6. **不动 B6 的闸门**（等令）。
7. **不改写**那 17 个不产汇总行的探针（先标 `manual`）。

---

## §4 附录：事实与复跑命令（每条断言旁边就是复跑方式）

### 4.1 §0"当场就错"五条的复核（2026-09-26）

| # | 原判 | 复核结果 |
|---|---|---|
| ① | 两个承重文件不在 git | **已修**：`git ls-files bridge/` 现在含 `p5canvas.js` 与 `octave-worker.js` |
| ② | `DEPLOY.md` 的产物 sha 是旧的 | **已修**（A0）：它**不是孤儿 stub，是一份实质文档**（41 行 / 2270 B：`site/` 目录说明 + 三条部署前自检 + Pages 步骤 + 更新流程），只因白名单没放行而**不在 git 里** —— 又一个"承重文件不在库里"。⇒ 加 `!DEPLOY.md` 进白名单 + 把 sha 改成 `1ed3e528…` |
| ③ | "权威重链命令"指针过期 | **已修**（A0）：同在那个文件的 `:16`，改成指向 `AGENTS.md`「事实纪律」第 2 条那条**完整口径**（§5.26 + `WITH_FONTCONFIG=1` + `WITH_JSPI=1` + SIMD 的 `EXTRA_LDFLAGS`）。`dist/DEPLOY.md`（真正发出去的那份，20510 B）本来就没有 sha 断言也没有该指针 |
| ④ | HANDOFF 写 glue-selftest "82 项" | **已修**（现为 91，`HANDOFF.md` §8 快回环段） |
| ⑤ | 每次开机跑 demo 错误路径 | **仍活着**：`bridge/index.html:429`（随 A2 清除） |

> **纪律教训**：原报告是快照，写完之后仓库又动过。**引用前先复核**。

### 4.2 `link-web.sh` 的 22 个环境变量

```sh
cd /mnt/hdd/zcode-projects/Octave-Full-Wasm
grep -oE '\$\{[A-Za-z0-9_]+:[-+]' build/113/link-web.sh | sed 's/\${//;s/:[-+]//' | sort -u
# → 23 个名字；其中 P5_OBJS 是脚本内数组、$1 是位置参数 ⇒ 环境变量 22 个
```
能力轴 7 个：`WITH_JSPI`(496) / `WITH_FREETYPE`(110) / `WITH_FONTCONFIG`(137) / `GL_LIBS`(222) /
`EXTRA_LDFLAGS`(526) / `MAIN_MODULE_LEVEL`(188) / `P5_TOOLKIT`(425)（括号内为首次出现的行号）。

### 4.3 六组自检全在"开了才查"的分支里

```sh
grep -nE '^if \[ "\$\{[A-Z_]+:-0\}" = "1" \]|^if \[ "\$MAIN_MODULE_LEVEL" = "2" \]' \
  build/113/link-web.sh
# → 553/588/610/632/647/661；只有 :575 的 @ftp 预载检查与 :673 的 ls -la 是无条件的
```

### 4.4 15 处"猜这是哪个产物"

`link-web.sh` 8 处（`:556`/`:562`/`:567`/`:575`/`:589`/`:593`/`:633`/`:648`）、
`promote-webgl.sh`（`:107`/`:117`/`:122`）、`check-deploy-sha.sh`（`:22`/`:36`）、
`check-site-parity.sh`（`:37`）、`.githooks/handoff_facts.py`（`:31`）、
`bridge/index.html`（`:210-219` 生产 sha）、`test/browser/probe-artifact-sha.mjs`（`:21`/`:28`/`:32`）。

### 4.5 两个宿主的 7 处漂移（D3 的依据）

```sh
cd /mnt/hdd/zcode-projects/Octave-Full-Wasm && diff <(sed -n '124,549p' bridge/index.html) bridge/octave-worker.js | head -60
```
1. `print`/`printErr`：页面双通道（`uiAppend` + `console.warn`）vs worker 合并进 `out`。
2. `stdin`：页面整段 TTY 模拟 + `window.prompt` 回落 vs worker `return null`（无条件 EOF）。
3. `instantiateWasm`：页面有 sha 自证（`index.html:216`）与 `inst.mem`；worker 用模块级 `wasmMemory`、**无自证**。
4. 取点 `pop`：页面 `if (inst.mem)` + 每次 `new Float64Array(inst.mem.buffer)`；worker 无 guard、用全局。
5. `eval_async` 包装：页面有 `typeof Module.eval_async !== 'function'` 幂等检查 + try/catch；worker 两者都没有。
6. IDBFS：页面有 `Module.webSync` + 800ms 去抖写回（`syncSoon`）；worker **只有读回**，无从写入。
7. `pkgfix` 同步那句 eval 字符串两边不同：页面带 `warning(...)` 文案，worker 是 `catch; end`。

### 4.6 17 个不产 sweep 汇总行的文件

```sh
cd /mnt/hdd/zcode-projects/Octave-Full-Wasm/test/browser
for f in *.mjs; do grep -qE 'PASS / .*FAIL|个模块：OK' "$f" || echo "$f"; done
```
（63 套产 `${pass} PASS / ${fail} FAIL`，1 套产 `个模块：OK`，其余 17 个 = 2 个 `bench-*` +
15 个 `probe-*`；`sweep.sh:60-68` 只认这两种格式。）

### 4.7 "闸门"的 6 种含义

```sh
cd /mnt/hdd/zcode-projects/Octave-Full-Wasm && grep -rn '闸门' --include='*.md' --include='*.sh' --include='*.py' . | grep -v '^./HISTORY.md' | wc -l
```
（1）提交前六项检查（`AGENTS.md:54`）；（2）三道机制门（`HISTORY.md:2753`）；（3）机制探针
（`HISTORY.md:1562`）；（4）两站点一致性（`check-site-parity.sh:2`）；（5）链接期保活
（`HISTORY.md:1314`）；（6）运行时能力门（`bridge/index.html:320`）。

### 4.8 仓库 `site/` 与 `bridge/` 是手工同步的

```sh
cd /mnt/hdd/zcode-projects/Octave-Full-Wasm
sha256sum bridge/index.html site/index.html
# → 两边都是 d6c1490cf38d54ceb7301565c64fbaf937dffa135b67e3cb9071d49047cfd194（现在恰好一致）
grep -rn 'site/index.html' --include='*.sh' --include='*.py' . | wc -l   # → 0（没有任何脚本做这件事）
```
唯一相关的是 `check-site-parity.sh:37`，它比的是 **8761 vs 8768**，不含仓库。

### 4.9 `matrix-android.html` 已经漂了（**不删**，等人拍板）

```sh
cd /mnt/hdd/zcode-projects/Octave-Full-Wasm
stat -c '%s %n' site/matrix-android.html /mnt/hdd/octave-wasm-build/site/matrix-android.html \
              /mnt/hdd/octave-wasm-build/siteWebGL/matrix-android.html
# → 33947 site/matrix-android.html
# → 33947 /mnt/hdd/octave-wasm-build/site/matrix-android.html      （8761，与仓库同 sha f6eaf0e3…）
# → 41386 /mnt/hdd/octave-wasm-build/siteWebGL/matrix-android.html （8768，更新的那份，5d2dca7f…）
grep -rn 'matrix-android' --include='*.sh' --include='*.mjs' --include='*.py' . | wc -l   # → 0（无生成器、无测试）
grep -n 'matrix-android' DEPLOY.md    # → :13 写明了它的用途："浏览器矩阵自测页（…供截图/无头读取）"
```
⇒ **它是给手机/无头用的矩阵自测页**，不是垃圾；而仓库/8761 那份**落后于 8768**。
删或同步都得人定 —— 现在只由三列闸门的【非部署件的内容差异】节**报出来**。

### 4.10 重链逐字节可复现（A1 判据①的底座）

```sh
docker exec o113 sha256sum /src/websrc/m2fc-out/octave.wasm /src/websrc/m2fc-idbfs-out/octave.wasm \
  /src/websrc/m2fc-fonts-out/octave.wasm /src/websrc/m2fc-jspioff-out/octave.wasm
# → 四个都是 4faaa96d583ed978226c7fa676600b43dc663c5a23a594f3c3be2d8f2e7ad563
docker exec o113 sha256sum /src/websrc/m2fc-simd-out/octave.wasm   # 现役：1ed3e528…
docker exec o113 sha256sum /src/websrc/m2fc-jspb-out/octave.wasm   # 去 SIMD 对照：45d288b1…
```
SIMD BLAS 归档（模式 `product` 的输入之一，清单要记它的 sha）：
```sh
docker exec o113 sha256sum /src/deps/lapack-simd/lib/librefblas.a /src/deps/lapack-simd/lib/liblapack.a
# → 6160358f…（679,866 B） / 708636e6…（9,884,660 B）
```
