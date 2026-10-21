# Octave-Full-Wasm

[English](README.md) · [中文](README.zh.md) · [Deutsch](README.de.md)

GNU Octave 11.3.0 编译为 WebAssembly —— 一个完整的数值计算环境（解释器、BLAS/LAPACK、
绘图、约 500 个包）**完全跑在你的浏览器里**：纯客户端计算，**没有任何服务端执行**。

**现役产线：`w64` 车道（WebAssembly memory64 + 线程 + relaxed-FMA OpenBLAS + mimalloc
+ Rust `sort` 内核）**，与其他车道共用同一套网页 UI。所有数值结果均为 IEEE 754
binary64 —— 并经下文显式审计。

工具链：Emscripten **6.0.12**（三线全部重编并发运；冻结的 `wasm32-final`
三线 6.0.12 的落地记录见 `build/113/NOTES-emsdk-upgrade.md` §8.8。
逐线验收分诊见 `build/113/NOTES-emsdk-upgrade.md` §8.9。

三线**已全部推送且同步**（local = origin = mirror），每条都在 Emscripten 6.0.12 下重编并完成浏览器侧验收。

与网页版 clang+lld 工具链（[LLVM-wasm](https://github.com/ArchivalEra/LLVM-wasm)）的下游接入复核见 `.scratch/open-questions/issues/65-clang-wasm-toolchain-host-integration.md`。

给网页版 clang+lld 工具链的宿主侧接入报告见 `build/113/ISSUE-for-LLVM-wasm.md`（已用该仓自己的悬案闸门验过）。

对外已提 issue：[LLVM-wasm#1](https://github.com/ArchivalEra/LLVM-wasm/issues/1)（发布包缺 wasm64 档 sysroot）。

[LLVM-wasm#1](https://github.com/ArchivalEra/LLVM-wasm/issues/1) 修复的**下游独立复验**已在真产物上通过（v0.1.1：两档 sysroot 齐发、缺档硬拒绝；wasm64 产物在我们真宿主里 dlopen 成功）。

**浏览器内编 `.oct` 已端到端打通**：浏览器侧 clang+lld 工具链编出真 Octave `.oct`（喂 788 个真头文件），`addpath` 后真宿主 `exist=3` 并跑出结果（`minitest([10 20 30]) = 11 21 31`）。见 `build/113/NOTES-client-compile.md`。

客户端自编 `.oct` 的 A+B 设计已落档：`build/113/NOTES-client-compile-design.md` —— 复用既有 fork 管线承载 pin（**无需维护插件库**），并用**真包源码**（`cell2cell.cc`）在浏览器内编出并正确调用作为验证。

台账现已记录三线 6.0.12 状态（`lane6012_*`）与本轮客户端自编/上游闭环的工作。

`pkg load <名>` 现在会**先判来源**再点火：随站资产走 `OctaveAssets.load`，货架（Forge catalog）包走 `OctaveAssets.install`（同源 tarball + sha256 + 引擎内建 gunzip/untar）。**已发运 8761 并浏览器实测**（真下载 tarball + `csaps` 与宿主 Octave 逐位一致）。见 `build/113/NOTES-forge-ondemand.md` §10（T4）与验收套件 `test/browser/accept-catalog-load.mjs`（27/0，含 4 条反向断言）。

从货架装 Forge 的 `datatypes` 包 ⇒ **现代 MATLAB 类型当场可用**：`table([1;2;3],{'a';'b';'c'})` 得 `class=table`（height 3、width 2），`string(42)` 得 `"42"`。未实现的 MATLAB 名字现在报 Octave 的原话（"belongs to the 'datatypes' package … not installed"），而不再是 `makeinfo` 子进程错误。见 `build/113/REQUIREMENTS-store-and-matlab.md`。（`help sin`/`help ode45`/`lookfor` 未受影响；三个 help 套件的断言已翻面为"`__makeinfo__` 指向受管辖的 webshims 降级覆写"。）

本引擎**已经**具备 Simulink 式**块图**后端所需的全部数值能力 —— 状态空间/传函块、`ode45`、**刚性 `ode15s`**、LQR、`zpkdata`（探针 `test/browser/probe-blockdiag-backend.mjs`，6/0）。⇒ 块图前端可以建在**本引擎**上（另开一个 JS 仓库），**不必**引 Pyodide 那样的第二个运行时。见 `build/113/NOTES-plugin-survey.md`。

该探查也写了本引擎**够不到**的那块：MATLAB 有三根轴（语言 / Simulink / Simscape），我们覆盖前两根 —— **非因果物理建模（Simscape）在本仓零覆盖**，而 **OpenModelica** 是那块最现实的答案（它的 wasm 路径**在官方主仓里**、有 Rust 重写、**已发货浏览器 FMI 仿真器**；AGPLv3/OSMC-PL）。见该文 §8。

**迁徙：货架仓 → 额外内容仓（private，2026-10-14）**：原 `Octave-Forge-Shelf`（public）升格为**`Octave-Extra-Content`（private）** —— 本仓的 `shelf/` submodule 指向它。除原货架档案外，新增`recipes/`（LLVM-wasm 工具链与 Pyodide/SymPy 运行时的**供给配方**：URL + sha256 + 预算）与 `port/`（内容清单端口副本）。**org 判决落地为③去中间商**：本仓 = 核心宿主/消费适配器，额外内容仓 = 生产适配器，UI 各立契约。⚠️ **private 的后果如实记**：宿主是 public ⇒**外部克隆者无法 init `shelf/`**（只是能力减一，不影响构建；门按 SKIP 容忍）。原 public 仓 `Octave-Forge-Shelf` 已**归档**（只读；删除需 `delete_repo` 权限而 token 没有 ⇒ 等一次交互式 `gh auth refresh`），旧本地克隆已删。见 `build/113/NOTES-extra-content-seam.md` §8。（**pin 推进记录**：额外内容仓首笔 `980e093` → 升格 `7eee94d` → 白名单 `.gitignore` `af7508c`；后两笔均只动文档/gitignore，`packages/`+`tools/` 与 `980e093` **逐字节相同** ⇒ 功能零差异、站点无需重装配。）（**知识转移 2026-10-14**：向额外内容仓送 `docs/{FORK-PIPELINE,FACT-SYSTEM,LANES-AND-MEMORY-MODEL}.md` 三份经验集（按它的生产适配器角色裁剪、每条附复跑命令与真实报错原话）；向 OM 仓送内存架构与分支线那份（含『上游零 wasm64 支持』下三线仍成立的处理）。)（**交接 2026-10-14**：额外内容仓已克隆到 `/mnt/hdd/zcode-projects/Octave-Extra-Content`（`gh repo clone` 取远程权威状态），交接前当场验证：工具自证 14/0、12 包、三份 docs 到位；README 补「接手先读」四步。）（**跨 agent 通信 + 一处漂移修复 2026-10-14**：额外内容仓建 `mail/` 通道并发出首封（问职责边界三问：接缝 §8.1 写「内容契约 = 内容仓 ↔ UI」而管理者口头说「不管 UI 对接」，两者冲突需确认）；同时修掉宿主自己的一处文档漂移 —— `PLAN`/`REQUIREMENTS` 里「加 `needs` 新轴」与接缝 §2 判决（能力层 = `form:"tree"` 普通条目 + 依赖边、不加新字段）冲突，已翻面并登记翻案 `R-015`。）（**跨 agent 往来结案 2026-10-14**：内容仓回信认「以仓库为准」并接内容契约；其抛出的『端口产地』分歧经裁决 = **归宿主**（接缝 §4 与 §8.1 曾自相矛盾，已收窄 §8.1 并登记翻案 R-016）；另补一条**归属≠投送**——内容仓 private / UI 仓 public ⇒ UI 无法直读内容仓，内容语义归内容仓、投送走宿主站点。）（**端口落地 2026-10-14**：接缝 §5 第①步 —— `build/extra-content/` 落地 schema + 校验器 + golden×3 + bad×5 + 闸门 `check-content-port`（41 个闸门全绿）；端到端实测发现内容仓 `--emit` 缺 `producer` 字段、且出上游绝对 URL（`--site` 正确报红 = 两段式的意义），已写信告知。）（**接缝 §5 第②③步完成 2026-10-14**：②catalog 升 schema 2（`form`/`content` 两轴，`kinds` 留兼容视图；闸门加 R5）；③`install()` 返回**四态 Verdict**（ok/failed/not-found/cannot-know 不可塌陷）+ `planOnly` 零下载。验收：新套件 `accept-install-verdict` **12/0**（四态 + 两条关键反向 + 零下载审计），回归 `accept-forge-ondemand` 15/0、`accept-catalog-load` 27/0 不变 ⇒ 向后兼容。顺带修掉两个潜伏真 bug：`catalog()` 的**双拼 base**（base 非空才暴露）与 planOnly 的未声明变量。）（**端口三裁决 + 收口定义确认 2026-10-14**：内容仓上报三个端口缺口，宿主（端口产地）裁决 —— ①能力层 `content` 留空（不扩枚举，加反向断言）；②加 `consumer` 可选轴（`octave`/`omc`，缺省 octave）；③`pin` 建议前缀形态（`release:`/`commit:`/`submodule:`）。并确认「收口方」= 记录的生产侧聚合点，**不是**运行期端点。校验器自证 22/0。）（**清理 2026-10-14**：删掉陈旧的 `.opencode/goal-state.md`（2026-09-20 的 harness 遗留，其 checklist 4 项已全完成、已被 STATE/FACTS 取代）；`PLAN-*.md` 与 `.scratch/perf-max/` 经核**属承重**（前者被 CONTEXT/AGENTS/README 引用，后者已完结且被活代码注释当出处）⇒ 保留。判据：不是'看着旧就删'，而是'它指向的东西还在不在'。）（**接缝 §5 进度**：①②③ 已落地并进 STATE；**余下 ④ 能力层进图（Pyodide 供给 + `form:"tree"` 条目 ⇒ `install('symbolic')` 走通）与 ⑤ 工具链合流 —— 未做**。）（**★★ 符号计算真跑通 2026-10-15**：`symbolic` 包**零补丁**接上浏览器 Pyodide —— 它的 `python_ipc_system` 后端调全局名 `system`（包内无 `private/system.m`）⇒ 落到本仓 webshim ⇒ 转页面桥同步调 Pyodide。`diff(sin(x),x)` ⇒ **`cos(x)`**、`double(sym(3)/2)` ⇒ `1.5`；验收 `accept-symbolic-seam` **9/0**（含两反向）。决定性实测 `probe-pyodide-sync` **4/0**：wasm 里的 C 同步调运行期，**不必 JSPI/Asyncify/Atomics**。四处宿主侧改动，**零重链零重编**。）（**已发运 8761，2026-10-15**：`accept-symbolic-seam` 在**生产站** 9/0；sweep 并发复验 51 套 / 1195 PASS / 0 FAIL。⇒ 浏览器版 Octave 现在能真做符号计算。）（**台账已更新 2026-10-15**：168 条事实；本批 +4 键（符号接缝 9/0、同步探针 4/0、冷启动 2177 ms）；全量 `accept_pass`/`accept_suites` 随新 sweep 更新（1195 / 51）。）（**接缝 §5 第④⑤步完成 2026-10-15**：④**能力层进图** —— `provision-pyodide.sh` 三件资产供给（PyPI 官方字节 + 改写托管 lock 的 sha）+ 装配器产 `form:"tree"` 条目并入**同一张 packs** + `symbolic` 靠 `deps` 边指向它（§2 判决：**不加 `needs` 字段**）；新套件 `accept-capability-layer` **12/0**（含装载序列拓扑 `[pyodide, symbolic]` 与两条反向）。⑤**工具链表收口** —— 装配器 `--upstream` 读生产者表、**复用产地的校验器**：合格并入（实测 13 条）、不合格**拒收+点名**（LLVM 真表 19 条问题 ⇒ 站点不被污染）。余下是 LLVM 自修表（内容仓推广方的活）。）（**端口裁决②批 2026-10-15**：内容仓 `mail/009` 提三个待确认 + 一处独立发现，宿主（端口产地）裁决 —— ① **`license` 保持自由字符串/对象**（不收紧 SPDX 枚举：真实产物逐文件混合，clang/lld = Apache-2.0 WITH LLVM-exception、glue js = MIT OR NCSA、driver = AGPL；枚举会逼生产者说谎或拆条），校验器**只查类型**、明说「写对了没」**没有机器判据**；② 「能力层 = 普通条目」的**「普通」不限条数**（= 它不特殊，不是物理上只能一条）—— LLVM 的 clang 工具链出 **13 条**合法（逐文件许可三档 + 逐文件 sha 让两档 sysroot 复用可见）；③ `--upstream` 用 LLVM **修后**的真表重跑（sha `8bbafa5f…`，`release/content-list.json` ≡ `release/out/` 逐字节同，生产者态/站点态**双 `ok`**、13 条；`v0.1.2` 经 `gh release list` 实测**已真发布**）并入干净。附件裁决：`size` 口径**由 `form` 决定** —— 单文件 = 该文件字节，`form:"tree"` = 整树预算（现役 pyodide：22,013,349 = 整目录，`url` 指树里主 wasm 9,598,218 —— **不是同一个对象、都是有意的**）；`size` 不参与 fail-closed。★ 并入 LLVM 暴露宿主**自己门里两处债**（已修）：站点闸门对非货架条目跑货架口径（R2/R4）⇒ **26 条假红** ⇒ 改为**按 `url` 前缀分域**（货架包走 R2–R5；能力层/生产者表走 **R7**）；旧 R6 要求能力层**必需** consumer 与裁决②「可选」**自相矛盾** ⇒ **翻面**。新增 `--upstream-bytes`（把生产者表的字节 stage 进站点、逐件核 sha）；隔离站端到端：并入 LLVM 真表 + stage ⇒ 站点闸门 **`ok`**（catalog 26 条）、未 stage 时 **13 条 R7b 全红**。校验器自证 26/0、端口闸门 6/0、站点闸门 20/0、装配器 19/0。）（**mail 边界立规 2026-10-15，用户点令「各家只读自己的 mail」**：起因是一次**越界实测** —— 本仓去 `LLVM-wasm/mail/` 与 `OpenModelica-Full-Wasm/mail/` 找「写给我的信」，而那两封是**内容仓发给 LLVM 和 OM** 的私人往来。**根因 = 本仓曾是四仓里唯一没有 `mail/` 的** ⇒ 写给我的信无处可投、只能落回发信仓 ⇒ 逼得收信方去翻**发信仓**的目录。**修法**：① 补 `Octave-Full-Wasm/mail/`（收件箱）+ 迁入 5 封**确实写给本仓**的历史信（保留原编号）；② **三条边界**（投递落点 = 收信方的 `mail/` / **只读自己仓的 `mail/`** / 本仓收件箱 `**To:**` 必须指名 host）；③ 新闸门 `.githooks/check-mail-boundary.py`（守**收信侧**不变量，自证 **5/0**；反向：一封 `To:` 别的仓 ⇒ 必红）。已登记进闸门自证台（**43 个闸门**）+ pre-commit + 白名单。**闸门当场抓住我自己写错落点的 `013`**（`To: extra-content` 写进了本仓箱）⇒ 已移到内容仓。规则详版 = `mail/README.md`，铁律 = `AGENTS.md`，术语 = `CONTEXT.md`。）（**依赖边去硬编码 2026-10-15，回应内容仓 `mail/011`/`014`**：内容仓在**数据**里出了能力层边（`shelf/packages/symbolic.json` 的 `depends:["pyodide"]`）⇒ 本仓**删掉装配器里按包名硬编码**的那段（"加内容=加一行数据、不改代码"）。**前置**：边只在新 pin 里 ⇒ **删硬编码 + bump `shelf/` pin `f6d38c9`→`922736a` 同批做**（否则从旧 pin 读到空 `depends` ⇒ `install('symbolic')` 静默断）。**两条自证翻面**（改断言不改检查器）⇒ `forge-catalog.py --selftest` 19→20/0。**补 R9 完整闭合**（`check-forge-catalog.py` 自证 20→24/0，三档：表内闭合 / 合法缺席（已知能力层名）/ typo 必红）；**采纳内容仓裁决**：`symbolic→pyodide` = **硬依赖**（站点没供能力层 ⇒ install 响亮失败）。**三处 catalog rebake**（8761/8768/镜像，逐处文件级 sha 快照证明唯一变化 = `forge-catalog.json`）；端到端 `accept-symbolic-seam` **9/0**。**同时更正一处假声明**：`pre-push` 注释曾称 CI 兜底（`.github/workflows/readme-sync.yml`）**从未存在、且 `.github/` 整体未被 git 跟踪** ⇒ 已改成实话（判据只有本地一道）。）（**架构界「楚河汉界」2026-10-16，用户点令**：**要 dlopen 进宿主的东西必须与宿主档同架构**。**实测修正**：这条界**不是**「w64 档只收 wasm64 内容」——反例 **Pyodide 是 wasm32 却在 w64 档跑通**（`accept-symbolic-seam` 9/0）⇒ 三档语义：纯 `.m` 无架构概念／含 `.oct` 必须同档／能力层（自带运行时）不带。**判据派生不手写**（`build/113/oct-arch.py` 读 `.oct` 的 `dylink.0` TARGET_FEATURES 子节，纯 stdlib；**不看目录名推**）。落地四处：端口 schema 加 `arch` + 校验器三档正反（自证 26→**33/0**）、装配器从包内字节派生、站点闸门 **R10**（自证 20→**27/0**，两条反向）、客户端 `install()` 不符 ⇒ `cause='arch-mismatch'` 响亮拒绝。验收 `accept-arch-boundary` **5/0**（在**隔离站点副本**上跑，**不碰 8761**）；闸门自证台 44→**45**。）（**内容三属性 2026-10-16，用户点令「一个内容应该有三个属性」**：`OctaveAssets.statusOf(name)` 统一返回 **`fromSource`（是否从源码构建）/ `compatible`（是否兼容本宿主）/ `installed`（是否已安装）** —— 三条**各自独立、全部派生**（不手写、不加目录字段）：`fromSource` = `content` 含 `src`（现役 8 包为 true）、`compatible` = 架构界 `arch` vs 宿主档、`installed` = 会话态；查无此内容 ⇒ **`null`**（不编假状态）。**验收 `accept-content-attributes` 11/0**（含 ★ S4：同一条 arch 不符事实下 `compatible=false` 且 `install` 拒绝——两属性答同一件事；★ S5 正反两向证 `fromSource` 有判别力）。**顺带修两个真 bug**：随站条目的 `kind`（投送形态）曾被当 `content`（内容构成）冒充；`installed` 只查两个键 ⇒ 随站包永远显示「没装」。）（**「额外内容市场」架构判决 2026-10-16，design-it-twice**（判决书 `build/113/NOTES-market-design.md`）：四子代理独立出方案 ⇒ **四方案共识**：① 不加「版本属性」—— 口语诉求翻译成「**三属性按版本求值**」；② 取得方式（clang 现编 vs 下载预编译）**不属记录**（是候选×宿主×站点的函数）；③ 缝仍在「记录」上；④ 不存储「每版本一个 compatible 布尔」（会漂）。**判决**取「条目内 `versions[]`（未 stage ⇒ `compatible: null` **不编**）+ `ways` 派生字段 + `statusOf` 搬进 async `browse`」。★ **四子代理独立推翻了我给的「真例」**：`statistics 1.7.3` 声明 `kinds:['m','oct']` 而真字节**0 个 `.oct`**（13 个 src），`verified.tarball_sha` 记的还是 1.7.7 的 ⇒ **它从未被探过**（全库 52 条版本记录里 **38 条 `kinds` 为空**）⇒ 真缺陷更硬：**逐版本声明已经漂了**。**四条实测缺陷**（工单 68）：N1 宿主给自己开后门（装配产物从不过端口校验器）、N2 R4 只有单向（伪造 claim-vs-bytes 矛盾 ⇒ 旧闸门放行）、N5 见上、N6 同一事实两出口两答案（装 symbolic ⇒ `layers:[] bytes:0` 是字面量，而 `statusOf` 答 `'none-needed'`）。**本批落地第 0/1 步**（零客户端改动）：R11（宿主自产目录也过产地校验器）+ R4 双向 + `derive_arch` 守卫；自证 27→**30/0**；三站 `--check` 仍 `ok`。）（**角色共识再确认 2026-10-16，用户原话**：「内容仓负责推广标准，然后作为 OCTAVE 核心的我们做好适配」—— 非新判决，是对既有分工的再确认：内容仓=推广（推宿主定稿的标准）+收口；本仓=端口产地+消费适配；实盘已运转。已落两仓 STATE。）（**三属性已上站 8761**（**已上站 8761**（`promote-pages.sh`，四处一致、三大件未动）+ 真站点 `accept-content-attributes` **11/0**。★ **上站时抓到受管辖入口自身一处自建以来的缺陷**：`promote-pages.sh` 的 `--verify` 比**四处**而真同步只写**两处**（漏 8768）⇒ 任何真同步后 verify 都不可能绿（`git log -S` 证据：自工具诞生起即如此）；已修并加自证用例 ①b（真跑后**断言 8768 也被写上**）⇒ 自证 4→**5/0**。）（**悬案收口三件 2026-10-16**：① **工单 65**（clang-wasm 接入缺口）**结算件已造**（`test/browser/probe-toolchain-gap.mjs`）—— **缺口 1（TLS 入口）已修并端到端复验**：驱动现在**拒绝**单 tar 编 wasm64（"Refusing rather than linking a module without the TLS init entry"），用 per-arch sysroot 编出的模块在 8761 w64 上 **`dlopen=OK` 且 `probe_f(22)==22`**；**缺口 2（基本类型 typeinfo `_ZTIi`）仍开** ⇒ 工单 65 = `needs-info`（归属待邻仓）。② **工单 66 结案**：未实现函数不再报 `makeinfo` 子进程错，结算件复跑 **6/0**。③ **新工单 67**：`pre-push` 注释称的 CI（`readme-sync.yml`）**全历史从未存在、`.github/` 整体未被 git 跟踪**⇒ 注释已改成实话；立 CI = 工单 67。顺带：`probe-octc-spike`（已结案实验）登记进 manifest ⇒ `PROBES=1` 不再记 12 条假红。）（**018 回信收口 2026-10-16**：内容仓七件事逐条复核**全过**——N5 它修完（52/52 版本真字节重探、空 kinds 38→0、`--emit` 过我校验器 ok、arch 副本 0→5 处同步、抽查 4/4）；它裁 versions 轴「出+只出已 stage」、三属性「现名确认」。**我兑现**：`versions[]` 轴进端口 schema（三条不变量：非空不重/顶层标量=某候选逐字/staged 必带派生轴、withheld 不许编；校验器自证 33→**41/0**；golden/versions.json 示范；现役三处仍 ok）+ **N6 修复上站**（`install()` 三字段真算；`accept-content-attributes` **11→14/0**，真站点 8761：装 symbolic ⇒ `layers=[pyodide 22MB]`、`bytes=22289801`，与 `statusOf` 同判据）。**工单 68 结案**（四缺陷全收口）。）（**versions 全链闭环 2026-10-16**：内容仓 `020` 落了 `--probe` 逐版探 + `--emit` 出 `versions[]`，附样件（sha `b55a73db…`）。**三层对账全过**：① 校验器（生产者态 ok）② 装配+站点闸门（catalog 带 52 条真候选）③ 浏览器（8761 上 `catalog()` 真给出候选，不变量② 真）。★ **对账抓出一处宿主缺口**：货架路径 `resolve()` 从不消费档案的 `versions` ⇒ 候选集进不了 catalog；已修（staged = 字节真在缓存/站点，不在 ⇒ withheld）。**staged 语义裁**：装配态由宿主、生产者态由内容仓，两态各自如实。三站 rebake（纯增量键，`accept-symbolic-seam` 9/0 不变）；全量 **96 套 / 1552 PASS / 1 FAIL**（那 1 = 工单 65 缺口 2 的**如实红**）。）（**022 收口 2026-10-16**：内容仓纠正我「optim 的 query-URL 今天用不上」的误判——它**今天就在表里**。判 **(a)**（url 是重取入口，不改它仓 emit）+ 宿主侧加**逐条推名的 fallback**（`byte_name_candidates`，判序按「末段像不像归档名」）+ withheld 候选带 `upstream_url`。★ **端到端 stage 真表又抓两处宿主真缺陷**：① `join(site, 绝对URL)` 造出 `site/https:/github.com/…` **假目录树**（验证查同一表达式 ⇒ **看起来成功**）；② 条目级同源改写只做在货架路径、`--upstream` 路径漏了。**都修** + `size` 按站内字节补真值。自证 20→**28/0**（两旧断言翻面）；真表上游路径 ⇒ 端口校验器 `ok` + 站点闸门 `ok`；现役三站 `--check` 仍 `ok`。）（**工单 65 裁决 2026-10-17，LLVM mail/026 归属答复**：**第三种情况**成立——`_ZTIi` 两边都无定义（宿主 `_ZTI*` 全是 Octave 类 / 11,663 个 `.oct` 零命中 / emcc 官方路径同样导入）⇒ 判定权归 ABI 属主（本仓）。**判 A**（支持基本类型 throw）：`_ZTIv/b/c/i/f/l/d` 定义在宿主 sysroot `libc++abi-mt-legacyexcept.a`（D 段实测）；keep-list 已导 `__cxa_*` 同族。**本批落零风险半**：gen-keep-list 显式追加 7 条（生成器永远不自己长——无任何 `.oct` 导入它们）+ 容器现役 keep 同步补 + `--selftest` ⇒ 闸门台 45→**46**；**重链留独立批**（无真实用例不急 ⇒ 工单 65 = `ready-for-human`，重链与否是产品决定）。**024/025**：UI 契约闭环（内容仓推广 + UI `CONTEXT.md` §五接纳；UI 确认读**本仓装配的** `forge-catalog.json`）;回信 LLVM `mail/010` 落它仓工作树。）（**三线模型终版 2026-10-17 用户点令纠偏**：最终只有**三条线**横跨所有对接仓——**wasm32**（32 单线程无 COI，一石二鸟）、**master**（64 多线程；不存在单线程 wasm64 产品线，`w64-base` 只是回退格）、**IllegalPerformance**（non-free：Rust 补丁=脱离开源社区；主线榨干前不开）。**分档唯二依据 = 用户能否使用 + 是否 non-free，与性能无关**（Safari 一年前已支持 wasm64 ⇒ COI+新内核是踏入 master 的条件）。已落 AGENTS.md/maintaince.md。）（**UI 四问落地 2026-10-17**：UI 报的「全英文界面冒中文报错」**产地在本仓 assets-loader**——已修：**15 处 throw 全带 `err.code`**（闭集词表：FS_NOT_READY/ARCH_MISMATCH/…）+ **install() 四态分类从正则改读 code**（消息改字不再影响分类；正则保留兼容，`.m` 侧不受影响）+ `message` 保持中文。**已上站**：8761 实测 `err.code=NOT_IN_ANY_LIST` PASS；回归 10/0 不变。Q2（版本描述）归内容仓裁（建议拆分文件 desc_url 变体）；Q3/Q4 宿主口径已答（默认路径已是「预编译优先按档自动」；LLVM 前置=planOnly 规划拦截而非即时报错；`compile:true` 是未实现槽位）。LLVM `028` 收执复核过（check-ztii-regression 4 PASS + 双编号）+ 它点名的**手抄数字教训本仓也中了一处**（给它的 011 信里），已修。）（STATE 机器块随批次刷新。）（合并收敛 mirror 侧 amend 分叉：README 冲突取 HEAD 侧字节数。）（全量 `PROBES=1` 96 套/1551 PASS/0 FAIL；`probe-toolchain-gap` 夹具曾因机器重启丢 /tmp ⇒ 重造后 **1 PASS/1 FAIL**（缺口 2 如实红 = 裁决 A 未重链的预期形状）。台账 172 条重测完毕。）（**透传批 2026-10-17，内容仓 029/030 兑现**：`description`/`links` 进端口 schema 正式键（`$defs/link` 瘦身口径）+ 校验器自证 41→**46/0**；装配器 `resolve()` 从档案 `upstream.*` 摊平进站点目录（**缺省空值不省键**）+ `--upstream` 透传与 `_site_fixups` 结构修补 ⇒ 自证 28→**32/0**；站点闸门新增 **R12**（透传键与货架档案逐字对账，缺键必报）⇒ 自证 30→**34/0**；三站 rebake（shelf pin `922736a`→`285af2f`）三层全绿。**客户端 `browse()` 落地**（市场判决书 §5 第 5 步）：async 正门返回 Entry[]（三属性 + `versions[]` 逐候选 + description/links + `state/why`），**statusOf 与它共用 `_browseEntry` 一条产地**（N6 教训不重犯）；`_byCode` 补全 **14 码全表**（内容仓 030 点名的 7 码缺口）。验收：新套件 `accept-market-browse` **17/0**（含 B7/B8/B9 三条反向 + B10 零字节请求）；既有五套零回归（双站）；**已 promote-pages 上站**，8761 BOOT OK + browse 17/0；全量 54 套 / 1231 PASS / 0 FAIL。回信内容仓 `mail/030`（它仓）—— UI 的「卡片数据」饭已端上。）（**pyodide 补标 role:'language-bridge' 2026-10-20（内容仓 mail/053 抓的漏标）**：收执信里逮出唯一漏标条目——pyodide 既无 role 也无 kind，而其余条目全部自描述。现补 `role:"language-bridge"`（Q1 词表第三个值首用；kind 缺省——不是 engine、不编 .oct）。「零硬编码名字判断」纪律在全部 15 条上补齐：13 个货架包标 package、llvm-wasm 标 toolchain、pyodide 标 language-bridge。验收：三站 rebake + 站点闸门绿 ×3；pyodide 路径五套零红（symbolic-seam 9/0 到 content-attributes 14/0——install('symbolic') 先 pyodide 后 symbolic 的闭包未被碰坏）；闸门 48/48；parity 一致。）
（**引擎条目上表 2026-10-20（mail/051 兑现）**：内容仓干完了它那半（emit role 的提交 7dfe77e），于是 shelf pin 推进、装配器给全部包条目出 role（13/13 role:"package"——与生产者 emit 同款显式自描述）。llvm-wasm 条目本身升 **kind:"engine" + role:"toolchain"**，arch = **lane 值**（w64——索引键非版本轴；从站点部署的 lanes.js 读，不手抄）。三处判据同步配套：端口校验器的 engine lane 词表补站点档名（base/w64）；R10 字节对账闸门对 engine 豁免（clang.wasm 不在 assets/oct*/ 下是设计形状非漂移）；loader 的 arch 硬闸门对 kind:'engine' 豁免——实测翻出：w64 vs wasm64 是两个词表，字面比对必假红；楚河汉界管的是"要 dlopen 进宿主的 .oct"，引擎是 compile-worker 的编译现场输入，不在那个语义里。install('llvm-wasm') 现在直接由 role 字段判 NOT_INSTALLABLE（name 兜底退役）。回归九套零红（arch-boundary A2 翻面：engine 的 lane 值 arch 合法携带）、闸门 48/48、三站 rebake、parity 一致。）
（**kind/role schema + llvm-wasm 装载事故修复 2026-10-20（mail/047/048/049）**：三封信三件结。① 契约事故——包管理器点装载 llvm-wasm 报「未知的能力层」，文案误导（不是未知，是不归 install 管）：installLayer 拒绝拆成 NOT_INSTALLABLE（工具链 ⇒ 「由下载管理（DownloadStore）+ 编译 Worker 使用——不走装载」，读新 role 字段、表未升级时按 name 兜底）与 LAYER_NOT_IMPLEMENTED（真未实现的语言桥）——方案 B 裁决（执行域错配）。② mail/047 + 049 Q1 schema 提单：entry 加 kind（src/pre/engine；engine 条目 arch = lane 值——arch 是索引键不是版本轴）与 role（package 缺省/toolchain/language-bridge——form 是形态不是角色，事故根因）；逐件 sha 仍产物自证，校验器自证 52→57/0；consumer 注释钉死数组+包含语义。③ mail/048 勘误：mail/030 宣称与现役表不符（tree 条目整键缺失）——按 C-2 改宣称不改装配器：能力层不是包，「键不在 ⇒ 无描述」≡「键空」。install 六套回归零红、闸门 48/48。）
（**音频播放链修复 2026-10-19（内容仓 mail/045 钓鱼执法）**：`sound([0.1 0.2], 8000)` 曾报 `'__player_audioplayer__' undefined` —— 播放链全断，而 .m 面在场让 which 类断言假绿。三层修复：① 缺件 `audiodevinfo.oct`（__player_*/__recorder_* 全在这一个模块）从未进车道构建的 TREE_MODS —— 补进并两档重编；无 PortAudio 时 C++ 层响亮失败（err_disabled_feature），真播放由懒加载的 webaudio m-bundle 接管。② 开机清单加 audiodevinfo + **38 个 aliases**（Octave 按文件名找 .oct，兄弟函数靠符号链接——webio 先例）；__web_pause_ms__ 的 5 个 aliases 修掉同模块名悬空（sound→pause→__web_suspend_ok__ 链曾因此断）。③ sync-js 第三态修复：sha 未变的条目被完全跳过 ⇒ meta 修正（aliases/note）在既有条目上永不生效——两产地分叉。断言翻面：accept-audio 46→50/0（含 mail/045 回归钉）；t6 33/0；t7 40/0。双站验收：SOUND_OK=1（sound 真阻塞 0.2s、AudioContext 真创建）、零回归、parity 一致。mail/044 同批：mail/read/ gitignore 洞补上（6 封归档信入库）+ 投 UI 两封信补投 antigravity 侧（host- 前缀）。）
（**w64-base 死档化 2026-10-19（二次三线裁决）**：用户点令——master 线不允许在无 COI 的浏览器上跑；wasm32 是无 COI 环境下的唯一线；master 必须开启多线程；IP 是脱离官方树的 master 延伸——`w64-base`"回退格"整格废除，与 threads 同待遇。站点只剩**两格**（base / w64）：无 COI（哪怕浏览器有 memory64）⇒ **base**。七个产地全线拔除（lanes.json 单源进 DEAD_LANES、lane.js 的 FILES/order/覆盖正则、gen-lanes、check-lane-purity、relink 模式表 + 死档点名 FATAL、promote-w64-lane 拒收任何 w64-base 残留），台账 w64_base_* 5 键掉档，probe-lane 矩阵两格化（新增 `?lane=w64-base` 死档 URL 断言），六个测试套件的死分支清理。验收：两格站 probe-lane 33/0；单源对账 OK（2 活档 / 2 死档 / 4 消费方）；双站 promote --verify 全绿；闸门 48/48；双站全量全绿（bench/probe 的零星红为网络抖动，单跑全过）。）
（**工单 65 裁决 A 重链落地 2026-10-19**：w64 / w64-base 产物按 `-6012` 车道全套重建（w64 `c994bdad…`、w64-base `35ef50dc…`，verdict=ok），结算探针 **rc=2 → rc=0** —— 带 `throw 42` 的 side module 现在 dlopen 成功且真调用。途中修掉两个真根因：其一，7 条基本类型 typeinfo 的保活需要**强引用**（`-Wl,-u,_ZTIi` 与 `--export-if-defined` 成对，rust_sort 先例）—— keep 清单的 export-if-defined 单独拦不住 MAIN_MODULE=2 的 DCE 删除无人引用的归档成员；其二 —— **一次推断翻案** —— C2c 的 "Invalid resizing" 边界**不是** typeinfo 同族：真根因是 wasm32 与 wasm64 头树在 `octave/mxtypes.h` 分叉（`mwSize/mwIndex` 为 `int32_t` vs `int64_t`），而 octinc 此前只打包 wasm32 树 ⇒ 浏览器现编 `.oct` 的索引宽度错位。octinc 现按**目标档**供两份头（附"两份必须真分叉"断言），C2c/C8e 从"如实记边界"翻成**硬绿**（`cell2cell({1,2},1)=1x1`、`partint(4)` 不变式成立）。双站全量 `PROBES=1` 全绿（96 套 / 1576 PASS / 0 FAIL），promote verify 全绿，SHA 三层 4/0，dist 重建。）
（**LLVM-wasm pin v0.1.3 2026-10-19**：工具链 pin 从 `v0.1.1` 升到 `v0.1.3` —— 它的 manifest 自带 `driver/compile-core.mjs`（14 条），并附 `release/check-published.mjs` 四对账，其中 `--freshness` 层把 bundle 的 driver 集合与 repo HEAD **逐字节**比对（正是抓「整个包一致地旧」的那层；生产者确认 v0.1.2 内部是 13/13/13 自洽的，所以内部一致性检查抓不到它）。我方独立复验：bundle sha256 与声明值相符；当时从生产者工作树补拷 `compile-core.mjs` 的**兜底按承诺退役**（退出条件写在 `mail/013` 里）—— provision 改为正向断言 bundle manifest 必须列它（反向验证已做：删掉那项 ⇒ 响亮失败）。`accept-compile-extension` 在新 pin 下复跑 16/0。）
（**llvm-wasm 能力层进表 2026-10-19**：clang 工具链早已上站（`assets/llvm/`）却**不在 `forge-catalog.json`** 里 —— 于是裁决⑤（"源码包装载需要先下载 LLVM"）没有数据源。装配器现在按 **pyodide 先例**产出一个**能力层条目**（从站点实际存在的字节合成：`form:"tree"`、`content:[]`、`url` 指树里主件、`size` = 整树预算、版本从工具链 manifest 读），而不是把生产者的 14 行文件表原样并进来——两条实测理由：14 行会散成 14 个 pack（不是"一个能力层"），且其 `assets/llvm-wasm/` 前缀与站点真实的 `assets/llvm/` 分叉，导致字节 stage 与目录 url 两处口径打架（实测出现过"stage 了 14 件"与"14 条 R7b 报缺"同时为真）。目录现为 15 条 = 13 货架包 + 2 能力层。`accept-market-browse` 的 B3c 也修正为按 `detail.form` 排除能力层而非硬编码包名（第一版仍红——`form` 在 `detail` 下、不在 Entry 顶层）。装配器自证加正反两例后 37/0。）
（**多 TU 编译 + 交互升级 2026-10-18**：v1 只编主 TU ⇒ `miscellaneous` 的 `partint` 模块从未存在。v2 按容器模块表编全：`build-pkg-oct.sh` 那张手写表落成**数据** `build/pkg-module-table.json`（对账器 `check-pkg-module-table.py` 自证 12/0；真仓 6 包 / 27 模块一致），客户端优先读站点副本、扫 DEFUN 只作兜底 —— 因为"含 DEFUN 就该编"是错的（实测：`sample.cc` 在 11.3.0 头下编不过，而容器表本来就不列它）。产物名取**源 basename** 不取第一个 DEFUN（证据：现役 `partint.oct` 同时导出 `Gpartcnt` 与 `Gpartint`）。编排抽成**深模块** `bridge/multi-tu.mjs`，两个 adapter：浏览器 worker 与**本地台** `test/local/compile-local.mjs` —— 后者把一轮验证从**约 8 分钟压到 8~14 秒**，且失败拿到完整 stderr 而非一句 `Aborted()`。`accept-compile-extension` **16/0**（原 11/0）。另落两件 Einfacht #20③ 承诺：`critical` 套件名单（范围内被跳过 ⇒ `sweep.sh` 必 rc≠0）与 `build/lanes.json` 档知识单源声明（对账器 15/0，当场抓出一处真缺口：`LANE_EXPECT` 缺 `IllegalPerformance`）。）（**包预编译批 2026-10-18**：现役 28 个仍用 Octave 7.2 头编的 Forge `.oct` 全部按 11.3.0 重编，按三线口径**只出两份** —— `wasm32`（无 `-pthread`，服务 base 格）与 `wasm64`（`-pthread -sMEMORY64=1`，服务 w64 档）（**发布模型定稿 2026-10-18**：一个包以 **artifact = `(name, version, arch)`** 为单位发布 —— 不是一堆文件，也**不是第二个版本号**：版本是上游事实（`optim 1.6.3`），架构是构建矩阵的索引键，所以不存在 `optim-1.6.3-wasm32` 这种伪版本。站点目录现已带 `artifacts[]`（逐架构、逐文件 sha256、派生 arch + `octave`/`toolchain`/`recipe` 溯源）（**mail 工作流 2026-10-18**：收件箱分未读区（`mail/`）与已读区（`mail/read/`）（**上游反哺 2026-10-18**：三线拆除里冒出三处「同一事实两个产地」，已上报 [Einfacht #20](https://github.com/ArchivalEra/Einfacht/issues/20)：① 两套 `gates-selftest.sh` 并存（上游声明式 + 本仓手写 46 条），pre-commit 两个都跑；② `REFLECT_*` 的代码默认值把台账写到被 gitignore 掩盖的位置，裸跑重测报成功而钩子读的是另一个文件；③ 档位知识散在三张登记表，漏改一处就让核心闸门 `probe-lane` 被 sweep 静默跳过，而 summary 仍报 0 FAIL。）（**收件箱 2026-10-18**：内容仓 `033` 双收执——发版模型（`artifacts[]` 归宿主装配、架构不做版本轴）与 `read/` 采纳，并认下「零值守卫 vs 合法清空」是它提案的漏项。回信附上游编号 [#20](https://github.com/ArchivalEra/Einfacht/issues/20)：它认的「输入消失」病根与本仓「核心闸门被静默跳过」同族。）（**上游追加 2026-10-18**：#20 补了评论，把缺口 ② 从「会写错地方」升级为「写路径根本不设防」—— 台账写盘既不检查目标是否被 gitignore 掩盖、也不提示用的是默认路径；而 `_load_or_die` 的提示「先在仓库根跑一遍量测」恰恰在教人踩坑（那正是产出野文件的动作）。另一使用方「没写盘」的自查结论正确，但只靠执行顺序、没有任何防护。）（**架构变化：下载与装载分离 2026-10-18**：按用户点令（市场提供源码包/预编译包两选项、装载在另一界面、已安装改已下载），内容仓定稿 `DownloadStore` 规格——把 `install()` 的链在「sha 核验之后、untar 之前」切开，已核验字节 + manifest 落 OPFS。缝仍在**记录**上（不在方法上）（**上游 #20 裁决 2026-10-18**：缺口 ② **上游已修**（`c29a33b` 盲写守卫——台账目标被 `.gitignore` 覆盖时拒写、rc=2、零字节写出），本仓已移植进 vendored 副本并反向验证，守卫自证 16→20。缺口 ① 的上游建议（退役手写台、全部落 `GATE` 声明）（**Einfacht 整层升级 2026-10-18**：vendored 机制层与上游 `45ca586` **逐字节同源** —— 7 个实质差异文件整层替换（facts/guard/knobs/render/check_locks/check_questions/check_facts_replay），本地补丁全部退役（自制 measure 分派改为上游 `REFLECT_MEASURE_MODULE` 旋钮，回落带响亮警告）（**浏览器内自编 .oct 落地 2026-10-18**：`OctaveAssets.compileExtension(name)` 现在能把包的 `src/*.cc` 在浏览器里编成真 `.oct`，返回 Verdict + **实时 `diagnostics` 日志流**。按用户点令工具链**分段懒加载**：sysroot（19.7 MB）与 clang（45.8 MB）在 init 拉，**lld（31.8 MB）推迟到首次链接** —— 首编峰值 66 MB 原始而非 81 MB。自建 `compile-worker.mjs` 做分阶段，编排仍 import 生产者的 `driver/compile-core.mjs`。验收 `accept-compile-extension` 双站 **11/0**。**已知边界如实记**：产物可识别（`exist=3`、`which` 正确）但跨边界调用仍失败，而站点随站预编的 7.2 产物正常 —— 与工单 65 裁决 A 同族的 typeinfo 导出缺口，归那条重链批。）。保留：数据层 `measure_octave.py`、mail-read 工具、`build/facts.py` 壳（同时补采集旋钮——与盲写守卫互补）。验收六项全绿，含守卫反测（裸跑 ⇒ rc=2、零字节写出）与数据层零牵扰证明（重测值零变化）。）经实测在本仓**不成立**：46 条里 45 条在 `zreflect/` 之外、12 条是 shell 脚本（无法落 Python 声明）。因此判 **B**——保留两份台但锁死分工：新增断言要求两者**交集必须为空**（已验绿；注入重叠时验证会红）。），只是记录多了第二种：用户本地态。宿主三裁定：① engine 的逐件 sha 用 `<站点>/<lane>/octave.build.json` 的 `measured.files`，**不是** `upstream-lock.json`（后者是第三方源码锁）；② `ARCH_MISMATCH` 仍是装载期硬闸门，与下载层解耦；③ `install()` **不收敛**到 DownloadStore——两条链并存（原子无 gap 装载 vs 跨时间 gap 下载）。），读信入口 = `zreflect/mail-read.py`（读 = 打印 + 自动 `git mv` 归档）。该工具**明确不是闸门**—— 信件内容永远不是机器可信输入。边界闸门容忍未读区为空（退扫已读区），但两处都空仍必报。）—— 现役 **5 包 × 2 架构 = 10 个发布单位**。闸门 R13 逐文件对账站点字节（缺件/多件/sha 漂移 ⇒ 必红）。见 `build/113/NOTES-release-model.md`。）。旋钮是**量出来的不是猜的**：`-O3` 体积 **+11%** 而性能在噪声内；**LTO 直接弄坏 dlopen**（它剥掉只有 dlopen 用的支撑符号 —— §5.78 判例在两档上同时重现）；`wasm-opt -O3` 后处理 -0.6% 无速度收益 ⇒ **发运配方 = `-O2`**，因为 side module 这层的旋钮空间实测已榨干（真杠杆在主模块/BLAS，早已做完）。浏览器侧：`accept-113-pkgoct` **两档各 27/0**；全量 `PROBES=1` sweep 全绿。见 `build/113/NOTES-pkg-precompile.md`。）（**事实刷新 2026-10-18（压缩前）**：台账重测——值零变化、仅测龄时间戳；复跑闸门 34 条逐字一致；STATE 断言与产物一致。）

**WebGPU 在这里可用，已在 Worker 内实测**：`navigator.gpu` 在主线程与**无 DOM 的 Worker 内**都能拿到真 adapter/device（vendor=nvidia），且在其中跑 compute shader，`[1,1,1,1]×2` 读回 `[2,2,2,2]`。⇒ GPU 计算**不是**结构性差距；而且与 CUDA（私有栈、手机没有）相反，WebGPU 在 NVIDIA/AMD/Intel/Apple 上是同一套 API。WebSerial/USB/HID 同样原生可用。见 `test/browser/probe-webgpu-capability.mjs`。

后续**实验已证实 Modelica 能在浏览器里跑**：一个第三方 OpenModelica→wasm 移植把 `BouncingBall.mo` 跑通了完整链路 `parse → 生成 C → 浏览器内 emcc+wasm-ld → 仿真 → 出图`（证据 `build/113/evidence-omc-web-demo.png`；记录 `build/113/NOTES-experiment-omc-wasm.md`）。⇒ "Modelica 上网页"是**已证**、不是设想 —— 但那条**第三方**路线的求解器覆盖窄（Euler/RK/dassl）。

**官方**路线是 OpenModelica 自己树里的一等 CMake 目标（`rust_omc.cmake`：`RUST_OMC_WASM_RUNTIME`、`wasm32-wasip1` 交叉编、`omc.wasm`、产物交接）—— 与本仓自己的管线**同形**（上游 submodule + pin + 交叉编 + 同源托管）。⇒ 它是**照我们编 Octave 的方式编**，不是抄第三方配方（见 §11）。

而且它能与本站**同页**（实测，非假设）：本引擎能解 **index-1 DAE**（`ode15i`、`Mass` 矩阵；RC 电路得 V(5)=0.9931，理论 0.9933），但**解不了 index-3**（约束摆失败）—— 而**指标约简正是 OpenModelica 编译器干的活**。两个引擎都能读写 `.mat`（omc-web 的仿真就是 dump MAT4）。⇒ 这个组合复刻的正是 Simscape↔MATLAB 的分工：OM 建模、Octave 分析，中间用 `.mat`（见实验记录 §8）。

这也定了仓库规划：**不需要**单独开"块图仓库"—— MSL 的 `Blocks` 已提供因果块图库、OMEdit 已有 Qt-for-WebAssembly 图形编辑器 ⇒ OpenModelica 是**平级上游**（AGPLv3/OSMC-PL 许可相符），即与 Octave 并列的**第 20 条 submodule**，为同一页面供货第二个引擎档。见 §9。

MATLAB 语义那块的桥，**在接口层面也已经存在**：OM 的脚本 API（`sendExpression`，其官方 `OMMatlab` MATLAB 客户端经 ZeroMQ 用它）在浏览器里以 **`omc_eval`** 暴露 —— 同一套命令协议、不同的传输层。所以要补的只是一个 Octave 侧的 `omc_*` 函数族（拼脚本 → 调 `omc_eval` → 读回 `.mat`）；OMMatlab 本体在浏览器跑不了（它需要本地进程 socket）。见 §10。

**符号计算 —— 路线前提已实测（不是推断）**：本构建 `sym` = 0，而 Forge 的 `symbolic` 包是**纯 `.m`**（0 个 `.cc`）却全靠 Python/SymPy 干活；本构建 wasm 里 `pyexec`/`pyeval`/`pycall` 字节数**全 = 0**、也无 shell。⇒ 包原样跑不了，唯一出路是浏览器里有一个真 Python 运行时。实测：**Pyodide + SymPy 可用** —— `diff(sin(x),x)` 恰好返回 `cos(x)`，**COI Worker 与无 COOP/COEP 两种模式都算对**（基础档用户也有份），并带"响亮失败"反向断言（`test/browser/probe-pyodide-sympy.mjs`，5/0）。关于"预编译 Python"之问：**静态编译成 JS（Transcrypt 那类）不可行**，不是慢几倍（Transcrypt 官方 README 原文 *"No eval and exec of Python code"*；SymPy 实测有 **340** 处 `eval(` / **61** 处 `exec(`）。**预编译字节码（`.pyc`）可行且现在完全没做**；实测 A/B = **7.26×**（`import sympy` 2757→380 ms，编译 472→0 次），代价 = 轮子字节 3.28×。见 `build/113/PLAN-matlab-gaps.md`。

**定论：Pyodide 是不是性能承重件**（三边实测，同一份基准、同 SymPy 1.14.0、同 ground types）：原生 CPython（uv 3.14）= 1.00×；**浏览器 Pyodide = 2.04×**（15 个 CAS op 的几何均值，逐项 1.6–3.2×）；原生 Octave+`symbolic`（持久 IPC）= 7.54× —— 浏览器档反而**比它快 3.69×**（`symbolic` 每步都要过管道编组变量）。冷启动 = Pyodide 装载 + 装 sympy 包 ≈ 2.3 s（可懒加载，不进开机路径）。⇒ **≈2× 不是数量级变化，不改变架构选择**。复跑：`sh test/fixtures/sympy-perf/run-perf.sh`。

**追问：预编译 `.pyc` 到底快多少**（四段口径 —— 只看 `import` 会答错）：`import sympy` **2.71 s → 0.37 s（7.40×）**；每个 op 的**首次调用**几何均值 **1.29×**（SymPy 是惰性导入子模块的）；**稳态 0.99× —— 如预期不变**（这条对照说明预编译不是万能药）。最关键是第四个数：源码档**同会话二次 import 仍要 2.73 s**，即**浏览器里没有隐式字节码缓存**（原生 CPython 会写 `__pycache__`，而浏览器里 site-packages 只读）⇒ 每次冷启动都要重编那 472 个模块。⇒ `.pyc` 轮子买到的其实是**一件事**：**每次会话的启动固定成本降约 85%**，代价是 3.28× 字节。见 `test/fixtures/sympy-perf/compare-pyc.py`。

**符号计算在「额外内容」里的归属**：`symbolic` 包本身是**普通货架条目**，而 Pyodide 运行时（约 27 MB）是**基础设施、不是货架条目** —— 与 clang 工具链同一类：同源托管、`upstream-lock.json` 钉 URL+sha256、可重建的供给产物，由多个包共用。而且货架现有的 `kinds` 字段**对它说了谎**：实测 `detect_kinds('symbolic-3.2.2.tar.gz')` 返回 `['m']`，与真·开箱即用的 `cgi` 判得一模一样 —— 而它的 `DESCRIPTION` 明写 `SystemRequirements: python, sympy, mpmath` ⇒ 装上之后跑不动。⇒ 货架加新轴（`needs: ["pyodide"]`）；规模实测：144 个上游包里**只有 2 个**需要（`symbolic`、`pythonic`）。商店式界面里这一条要显示「按需拉取约 27 MB 运行时」。见 `REQUIREMENTS-store-and-matlab.md` §A4b。

**三仓统一「额外内容」接口（2026-10-14 判决）**：Octave-Full-Wasm 与 LLVM-wasm、货架仓之间定了一条接缝 —— **缝在「记录」上，不在「方法」上**：一种记录（`form`=投送形态、`content`=内容构成，两轴各自命名，收编今天 `kind`/`kinds` 的同名两义）+ 能力层（Pyodide/clang）作 `form:"tree"` 的**普通条目折进同一张依赖图** + 宿主返回**四态值**（ok/failed/not-found/cannot-know，不可塌陷成布尔 —— 把 T4 那次「读不到≠不存在」的实测教训钉成类型级不变量）+ 端口产地 `build/extra-content/`（schema + 纯 stdlib 校验器 + golden/bad 夹具，生产者自证不需要宿主在场）。设计 = `build/113/NOTES-extra-content-seam.md`（含三条实测缺陷与增量五步）。

**组织形式判决（2026-10-14，用户点令「你选」）**：额外内容的后端整合**仍由本仓承担**，非核心内容（包/运行时/工具链的元数据与供给配方）归**额外内容仓**的 agent；**UI 仓立两条契约** —— 与本仓（引擎 / `docs/embed-api.md` / 四态 `install` 返回）、与额外内容仓（内容治理 / 端口）。**不取「中间商仓」**（整合知识在本仓：lane/COI/promote/闸门/embed 的 Qt 派生 —— 中间商要么重学要么成门面）；**不取「纯标准推广」**（标准是活动不是结构，无 owner 必漂）。★ **运行期仍只有一个同源端点**：两条契约是两条对话对象，不是两个跨域端点（COEP 实测拦跨域，内容表由本仓装配进站点）。细则 = `build/113/NOTES-extra-content-seam.md` §8。

**框法（用户点令 2026-10-14）："插件市场 / 商店"只是「额外内容」的一种 UI 形态，不是概念本身。**无论它们叫什么名字，最终都只是这个 Octave 网页版的能力拓展 —— 概念层统一叫**额外内容**（权威定义见 `CONTEXT.md`）：随站资产 / 货架包 / **共享能力层**（工具链、Pyodide 运行时）/ 构建期部件插件。"货架"是它的元数据载体，"按需拉取"是它的获取机制。⇒ 写能力时用"额外内容"，只有写界面时才用"商店"。


**一线一架构**（用户点令 2026-10-12）：`master` 线产物 wasm64、只编 wasm64；wasm32 线产物 wasm32、只编 wasm32。判据 = `build/113/check-lane-purity.py`（宿主 / 车道 `.oct` / 本档专属站点目录三处同档）。

站点资产包**逐批审计**：用 `build/<名>/` 源重生成 `site/assets/m/*.js` 并比 sha（挂载点逐字读 `build/assets-meta.json`，**不许猜**）。
归档线已重编但不上站）。

三条线现已在**同一工具链（Emscripten 6.0.12）**下重编并完成浏览器侧验收，
含冻结的 `wasm32-final` 归档线。

---

## 性能（2026-10-07 实测：原生 5 轮 / wasm 3 轮交错中位）

![五方性能对比](docs/charts/perf-5way.svg)

| 负载（秒） | 原生 ref-BLAS | 原生 OpenBLAS ×24 | wasm32-final | wasm64-NEXT | **IllegalPerformance** |
|---|---|---|---|---|---|
| dot 1e7 | 0.0082 | **0.0048** | 0.0080 | 0.0100 | 0.0110 |
| matmul 500 | 0.0257 | **0.0029** | 0.0220 | 0.0040 | 0.0050 |
| matmul 1000 | 0.1971 | **0.0089** | 0.1600 | 0.0230 | 0.0240 |
| lu 800 | 0.0415 | **0.0147** | 0.0340 | 0.0140 | 0.0150 |
| lu 1500 | 0.2598 | **0.0636** | 0.2180 | 0.0620 | 0.0720 |
| svd 400 | 0.1650 | 0.2243 | 0.1740 | **0.1550** | 0.1870 |
| sum 1e7 | 0.0086 | **0.0076** | 0.0080 | 0.0080 | 0.0090 |
| **sort 2e6** | 0.2111 | 0.2020 | 0.2280 | 0.2400 | **0.1110** |
| loop 1e6 | **0.4934** | 0.5226 | 0.6220 | 0.5780 | 0.5890 |

![IllegalPerformance 相对各基线的加速比](docs/charts/perf-speedup-IP.svg)

**IllegalPerformance 的实际比值**（基线时间 ÷ IP 时间；9 项几何平均）：

- **对原生 Octave（默认 ref-BLAS）= 1.96×**（纯 BLAS 轴 **3.16×**）
- **对 wasm32-final（冻结的 wasm32 线）= 1.86×**（matmul 1000 单项 **6.7×**）
- **对 wasm64-NEXT = 0.99×**——全面平价，唯一实质优势 = **sort 2.16×**
- **对原生 OpenBLAS ×24 = 0.80×**——原生多线程天花板在纯 BLAS 上仍领先 1.25×，
  但 **sort（1.82×）与 svd（1.20×）IP 反超**

## IEEE 754 投产评估

24 字段电池（`test/fixtures/ieee754/battery.m`）跑 **6 个配置**（4 条 wasm 车道 +
原生 ref-BLAS + 原生 OpenBLAS ×24）：

- **23/24 字段处处逐位一致**：round-half-to-even 舍入、±0 位模式、规范 NaN、
  Inf/除法、次正规数、eps 边界、定种子 `rand`（MT19937 原生↔wasm 逐位同）、
  `sin`/`pow`/除法（musl vs glibc 抽样逐位同）。
- 唯一差异 = **dgemm 求和顺序 vs 分步未折叠参考**（最大 6.6 ulp）——**原生 OpenBLAS
  也有**（10000 元素中 3522 个，4.99e-16）。每个加/乘都正确舍入，只是顺序不同
  ⇒ IEEE 合规。
- `relaxed_madd`（81 处，OpenBLAS rsimd 内核）：WebAssembly 允许 fused *或* unfused
  求值——**两种都是 IEEE 754 合规结果**。披露：w64 的 BLAS 结果**跨浏览器引擎**
  可能在末位有差异（与原生 OpenBLAS 跨 CPU 微架构同类）；逐元素数学不受影响
  （0 发散）。

**判决：wasm32-final 与 IllegalPerformance 线均准予投产。**
复跑：`test/fixtures/ieee754/battery.m`，日志在 `w64-logs/ieee-*.log`。

## IllegalPerformance 线发了什么

- **rust-sort** —— `sort` 的 Rust（driftsort）内核，以**源缝**接入：弱符号 +
  链接期旋钮（`RUST_SORT`）；摘除 = 重链不带库，树对象零改动。差分门：22 域逐位
  一致 + 4/4 变异被抓；**sort 2e6 = 对 wasm64-NEXT 2.16×、对原生 OpenBLAS 1.82×**。
- **G6 延迟仪器** —— 块级内核的批量 quit 检查延迟上界（候选④ xpow 驱动层实测
  ≤2.1% 被**排除**）。
- 封口审计：libm（IEEE 锁死）、fill/fft（带宽绑定）、xpow 驱动层（≤2.1%）——
  **无已知剩余上升空间**（复跑件在 `w64-logs/`）。

## 架构

同一解释器的四条部署**车道**，按浏览器能力自动选档（`lanes.js`）：
`base`（wasm32 单线程 —— wasm32 线**永远单线程**）→ `w64`（memory64 多线程）/ `w64-base`（回退格）。
★ 三线裁决 2026-10-17：`threads` 档（wasm32+atomics 多线程）是畸形档，**已整档删除**（HISTORY §5.108）——试验场绑定三分支（wasm32-final / master / IllegalPerformance），站点只是展示层。原链条：
`w64`（memory64 + 线程 + FMA + mimalloc + rust-sort）/ `w64-base`。
不带 COI 头服务会**静默**落到 `base` 档——见[部署工单](https://github.com/ArchivalEra/Octave-Full-Wasm/issues/2)。

可替换部件（BLAS、分配器、Rust 内核）是**带契约的插件**：模式表旋钮 → declared 标签
→ 产物探针 → 双向闸门（`plugin-check.py`）→ 事实台账条目。Octave 上游更新走
**fork/submodule 管线**：`upstream/octave`（分支 `wasm/11.3.0`）是我们的 fork——
合并上游 → 重编 → 跑车道 SOP（`build/113/NOTES-upstream.md`）；pin/见证闸门
（`witness-upstream-pin.py`）每次提交断言容器树 == fork pin。

## 运行

```sh
python3 build/serve-coi.py --dir /mnt/hdd/octave-wasm-build/site --port 8761
# 打开 http://127.0.0.1:8761/   （COI 头是硬要求 —— 见 issue #2）
```

本仓**不含 CI 自动部署**——部署为手工操作，按 [DEPLOY.md](DEPLOY.md)。
部署硬要求 + 验收程序：[DEPLOY.md](DEPLOY.md) 与
[issue #2](https://github.com/ArchivalEra/Octave-Full-Wasm/issues/2)。UI 接入：
[Embed API](docs/embed-api.md) 与 [issue #1](https://github.com/ArchivalEra/Octave-Full-Wasm/issues/1)。

## 分支（三条独立可持续维护的线）

| 分支 | fork pin（`upstream/octave`） | 定位 |
|---|---|---|
| `wasm32-final` | —（冻结） | wasm32 归档线 |
| ~~`wasm64-NEXT`~~ | ~~`a5a7208`~~ | **2026-10-17 已删**（用户点令——早已并入 master；实测对 master 独有提交 = 0；本地/origin/mirror 三处分支引用已删，历史经 master 保留）。原定位（中庸 wasm64）由 **master 线**承接（三线模型） |
| `IllegalPerformance` | `f4bf15b`（+ rust-sort 源缝） | 激进 wasm64 线——**2026-10-07 已发运**（8761 w64 = `f6fec91f`，IEEE 已评估，对本线基线 sort 2.16×） |

三条线经**同一条 fork 管线**吃上游 Octave 更新（`upstream/octave` 分支
`wasm/11.3.0`）；各线 pin 各自的 fork 提交。共享构建容器里换线 = submodule update +
重供给 + 部署该线的 `relink.sh`/`link-web.sh` + `OCTAVE_WASM_BASE` 指该线站点 +
`core.hooksPath` 指该线的钩子（IP 线 = `reflect-hooks/`，另两线 = `.githooks/`）
（见 `maintaince.md`）。

## 仓库地图

- `STATE.md` —— 活状态；`build/FACTS.json` —— 实测数字台账（每键带复跑命令）
- `zreflect/` —— 事实系统（**2026-10-09 采纳 Einfacht 重构版**：闸门平台 / 发现式名录 / 旋钮登记 / world 闸门）；`zreflect/measure_octave.py` 是本仓数据层，`reflect-hooks/Einfacht.env` 是旋钮载体
- `HISTORY.md` —— 逐批 append-only 记录（上文全部证据在 §5.77–§5.107）
- `maintaince.md` —— 方向地图；`docs/embed-api.md` —— 嵌入契约；`DEPLOY.md` —— 部署
- **Octave-Forge 按需拉取**（v1 已跑通 2026-10-09、**已发运 2026-10-10** 至 8761/8768/仓库 `site/`）：`OctaveAssets.catalog()` 读站点货架、`OctaveAssets.install(name)` 在**被要求时才**下载+校验+安装（含依赖闭包）——**没用到的包 = 0 字节**。货架 = `shelf/` submodule（只含元数据，每包一文件）；站点目录 = `build/forge-catalog.py`（闸门 `build/113/check-forge-catalog.py`）；设计稿 = `build/113/NOTES-forge-ondemand.md`；验收 = `test/browser/accept-forge-ondemand.mjs`（v1 = 纯 `.m` 包；`.oct` 加速件 = v2）
- `build/113/` —— 车道构建配方 + 闸门；`test/browser/` —— 验收 harness（`SWEEP_JOBS=4` 可并行；最近一次全绿轮 = 台账 `accept_suites` / `accept_pass`）
- 图形（2026-10-09 起**引擎权威**）：`bridge/octave-core.js` 保护核心 `m/plot` 树不受宿主影子桩污染（快照 + 还原 + 删新建），`p5canvas.js`/`queue.js` 经 `window.__octaveHosts` 解析模块 ⇒ embed 形态下图能上屏；验收 = `accept-gfx-isolation` + `accept-gfx-render`
- worker 模式（`?worker=1`，2026-10-10 修复）：回归后页面看似卡死（`octaveUiAppend` 被抽走后 worker 分支仍调它）⇒ 修好后每次输出合批不再抛错；验收 = `accept-worker`
- `.scratch/open-questions/issues/` —— 本地工单 tracker
- `docs/agents/upstream-issues.md` — 反哺上游 [Einfacht](https://github.com/ArchivalEra/Einfacht) 的 issue 留档；`docs/agents/ui-issue-interface-change.md` — 给 UI 仓的接口/行为变化告知留档

仓库跟踪文件清单（路径 + 字节数）由钩子维护在 [README.md 的 AUTO:FILES 区块](README.md)。

## 钩子

本仓用白名单 `.gitignore`（默认拒绝，逐项放行）+ git hooks：

- `pre-commit`：重算 README 的 AUTO 区块、校验白名单，跑事实/一致性/插件/仪器闸门
  与**三语 README 同步闸门**（`check_readme_sync.py`，移植自
  [Einfacht](https://github.com/ArchivalEra/Einfacht)）：三份语言 README 必须存在、
  非空、互链。
- `pre-push`：README 新鲜度 + 三语闸门的**推送集模式**——任何触碰一份语言 README 的
  推送必须三份同批更新。
- 安装：`bash .githooks/install.sh`（设 `core.hooksPath`）。

## 许可

**AGPL-3.0-or-later**（全文见 [`LICENSE`](LICENSE)）。对外分发的 wasm 二进制静态链接
GPLv3 的 Octave、GPLv2+ 的 FFTW、LGPL 的 libsndfile 及若干 BSD/permissive 组件——
这种混合**没有 AGPL-3.0 以外的选择**。

本程序是自由软件：你可以按自由软件基金会发布的 GNU Affero 通用公共许可证
（第 3 版，或你选择的任何更新版本）的条款再分发和/或修改它。本程序分发时希望它有用，
但**不提供任何担保**；也不提供适销性或特定用途适用性的默示担保。

按 AGPL-3.0 第 13 条（网络交互条款），通过计算机网络使用本程序的用户有权获得对应
源码：**本仓即该源码**；构建可在 `o113` 容器内完整复现（配方见 `build/CLIBS.md`）。
逐组件许可与版权：[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)。
