# maintaince.md · 方向与地图

本文件**只指明方向**。测出来的现状由**事实系统本身**承载（`build/FACTS.json` 台账 +
`STATE.md` 末尾的机器块，每提交复跑证真）；硬规矩由 `AGENTS.md` 承载（每次会话自动载入）。
本文件不抄数字、不抄流程 —— 抄了就会漂；工具自己会说话（闸门会明说未启用，改口会要求
`--accept-changes`，测龄会打印在重测输出里），听它们比读本文件的任何细节都可靠。

## 这个项目是什么

GNU Octave 11.3.0 → WebAssembly 的**全量浏览器运行时**（纯客户端计算，无服务端执行端点）：
浏览器验收套件、带复跑命令的事实台账、每道先证明自己会红的闸门群——
上游全量 fork/submodule 接入。可交付物 = 三格站点（base/w64/w64-base —— threads 档已删，HISTORY §5.108）+
嵌入接口层（UI 方开工包）。
活跃开发前端 = **IllegalPerformance 分支**（Rust 补丁线——本仓唯一允许改 Octave 树
补丁的线，用户拍板解除且不回主线）。

## 地图（真值在哪里）

- **现在是什么**（活状态）：`STATE.md` —— 正文只写现状、数字一律引用台账键；
  末尾两个机器块（事实 `AUTO:FACTS` + 闸门名录 `AUTO:GATES`）由
  `python3 zreflect/facts.py --render-doc STATE.md` 渲染，每提交重算。
- **测出来的数字**（唯一产地）：`build/FACTS.json`（源）+ `STATE.md` 的 AUTO 块（渲染）。
- **事实系统**：**机制** = `zreflect/`（vendored 上游 **Einfacht** 重构版：gate 平台 /
  发现式名录 / 旋钮登记 / world 闸门 / 复跑 / 陈旧 / 悬案 / 三语 README）；
  **本仓数据层** = `zreflect/measure_octave.py`（数据 vs 机制分离）；
  旋钮的唯一可复现来源 = `reflect-hooks/Einfacht.env`；钩子挂 `reflect-hooks`。
- **给 agent 的硬规矩**：`AGENTS.md`（路径铁律 / 三条不可违背 / 验收底线 / 批次收尾）。
- **历史与事故**：`HISTORY.md`（append-only，`§5.x`）。
- **悬案**：`.scratch/open-questions/issues/NN-*.md`（每条挂可执行结算件）。
- **机制/推断**：`build/113/NOTES-*.md`（jspi/threads[历史档案]/webgl/wasm64/hotpath/libm/plugins/upstream/precompile）。
- **上游**：`upstream/`（18 submodule，5 fork 的 wasm 补丁分支）+ `build/upstream-lock.json`
  （无 git 上游的 URL+sha256）+ `build/113/NOTES-upstream.md`（升级 SOP）；
  **额外内容 `shelf/`**（第 19 个 submodule，`Octave-Extra-Content` 独立仓（private）：包档案 + 供给配方，
  每包一文件；pin 由 submodule commit 承载、字节由 sha256 承载）。
- **两个"插件"别读混**（术语权威定义见 `CONTEXT.md`）：**部件插件**（构建期，换链进来的
  库/旗标，影响全站产物）= `build/113/NOTES-plugins.md` + `build/plugins.json` +
  `plugin-check.py`；**Forge 按需插件**（运行期，用到才拉的包）= `build/113/NOTES-forge-ondemand.md`
  + `bridge/assets-loader.js` 的 `catalog()`/`install()` + `build/forge/__forge_install__.m`。
  ⚠️ `build/plugins.json` 里没有、也不该有 Forge 包。
- **C 库配方**：`build/CLIBS.md`；**术语**：`CONTEXT.md`；**部署**：`DEPLOY.md`。
- **给 agent 的方法学**：`docs/agents/`（memory / fact-system / issue-tracker / upstream-issues）。

## 方向

1. **Rust 补丁线（IllegalPerformance，当前前端）**：Rust 内核 = **源缝插件**
   （Array-base.cc 弱符号缝 + RUST_SORT 链接期旋钮，摘除 = 旋钮关）→ 差分门（G2）+
   变异自证（G2b）+ hotpath A/B。**候选③ sort 已在 w64 落地 ADOPT——端到端 2.0×**
   （nightly build-std wasm64 库；`w64_rustsort_ab_*` 台账键；全量 PROBES=1 1358/0
   等效；端到端逐位抽查双站一致；工单 63），**发运 = 产品决定**。专属站 =
   site-illegalperf/-baseline（装配入口 build/113/site-illegalperf.sh）。
   **缝空间已封口**：libm（IEEE 逐位红线）、fill/fft（带宽绑定）、**候选④ xpow 驱动层
   （实测 driver_only 仅 2.1% ⇒ 排除，G6 仪器已建）** ⇒ 无已知上升空间。
2. **上游更新线**：SOP 已通（工单 62 结案——供给树 rebuild 恢复可复现）。**emcc 6.0.10
   探针判决：编译器红利 ≈ 0（geomean 1.001），旗标矩阵全绿——升级不立项**，重启时机 =
   Octave/emsdk 新版发布 → fork merge → 重编 → 验收（`emcc6_probe_geomean` 台账键哨兵）。
3. **Forge 按需拉取插件线**（`OctaveAssets.catalog()`/`install()`；设计与分叉裁决 =
   `build/113/NOTES-forge-ondemand.md`，工单 64）：客户端**用到才拉包**（没用到 = 0 字节），
   站点货架 = `build/forge-catalog.py` 从 `shelf/` submodule 生成（版本按 **fork 的 Octave
   版本**过滤、字节 sha 逐条核）。v1 = 纯 `.m` 包（全部 10 个货架包）；**v2**（T8）= 含编译件
   的包：宿主预编 `.oct` + 客户端 dlopen 拉取。验收 = `test/browser/accept-forge-ondemand.mjs`。
4. **部署与 UI 线**（人的动作）：票 38 页面资产上站（`promote-pages.sh`）、票 12 真机手测
   （等生产部署）、E6 图形线（embed 页 GL 纹理边界）。
5. **Einfacht 反哺（暗线，持续推进）**：三插件已并（#11 check_pins/check_locks、
   #12 check_ab）；**可执行闸门脚本必须显式 `__main__` 入口**（#12 并后抓到的缺口）。
   提 issue/PR 前先做现有档位对照表；覆盖不到或配置繁琐 ⇒ 自行迭代再提 PR。
   ★ **#20（2026-10-18，三线裁决大拆除的实战反哺）**：三条「两套产地并存」——
   ① 根 `gates-selftest.sh`（声明式）与 `build/gates-selftest.sh`（手写 46 条）**都跑**、
   职责重叠；② `REFLECT_*` 的代码默认值把写操作导向**被 gitignore 掩盖**的位置
   （裸跑 `facts.py` 写根 `FACTS.json`，而钩子读 `build/FACTS.json` ⇒ 重测静默不生效）；
   ③ 档位/车道存在性散在 `plugins.json` / `manifest.json` / `check-build-manifest.py` 三处，
   **漏改 manifest 的 inputs ⇒ 核心闸门 probe-lane 被 sweep 永久跳过而报全绿**。
   共同形状：**"必须一致"的东西只要有一个产地没被闸门看着，它漂的时候表现是
   "跳过/默认值/没报错"，不是红**。
   ★ **#20 追加评论（同日）**：② 从"会写错地方"升级为**"路径根本不设防"**——
   (a) 写盘**不检查**目标是否被 gitignore 掩盖、**不提示**"用的是默认路径"；
   (b) 另一使用方"裸跑没写盘"的自查结论**对但原因不是防护**（先 `--render-doc`
   会因读失败早退），换个执行顺序就写出 60604 字节野文件（本仓实测）；
   (c) **`_load_or_die` 的 FATAL 提示"先在仓库根跑一遍量测"本身就在教人踩坑** ——
   那正是写出野文件的动作。⇒ 提示文本也是"默认值产地"的一部分。
   ★ **上游裁决已回（同日）**：② **已修**（上游 `c29a33b` 盲写守卫 `write_target_problems`
   + 载体分叉警告 + 提示改写）⇒ **本仓已移植**（vendored `guard.py`/`facts.py`），
   反向验证：裸跑 rc=2、零字节写出；guard 自证 16→**20/0**。
   **① 终局 = B**（不是上游建议的 A）：实测 46 条里 **45 条在 `build/`/`.githooks/`**
   （上游发现式只扫 `zreflect/*.py`），且 **12 条是 shell 脚本**（无法落 Python 的 `GATE` 声明）
   ⇒ A 的代价是 45 文件搬迁 + 33 个改造 + 12 个永久例外。B = 保留两份台但**锁死分工**：
   `build/gates-selftest.sh` 新增「两份台交集必须为空」自证（已跑通 + 反向验证会红）。
   **③ 留本仓**：`critical` 套件被跳过 ⇒ rc≠0（与 C2「off 不是通过」同纪律）+ `lanes.json` 单源。
   ★ **整层升级（2026-10-18，内容仓 mail/039 待办③，取代摘件）**：机制层已升上游 `45ca586`
   ——7 个实质差异文件（facts/guard/knobs/render/check_locks/check_questions/check_facts_replay）
   整层替换、**与上游逐字节同源**；本地补丁退役（自制 measure 分派 → `REFLECT_MEASURE_MODULE`
   旋钮）；保留数据层 `measure_octave.py` + `mail-read.py` + `build/facts.py` 壳（补旋钮，
   与守卫互补）。验收六项全绿（反测 rc=2 零字节 / 壳 163 条 / 两台 / registry / 值零变化 /
   逐字节同源）。**compile:true + diagnostics 已落地（2026-10-18）**：`compileExtension` +
   分段懒加载（sysroot 19.7 MB / clang 45.8 MB / **lld 31.8 MB 首链才拉**，用户点令）+
   `diagnostics` 日志流；验收 `accept-compile-extension` **11/0**（双站）；供给 =
   `provision-llvm-wasm.sh`（13 资产逐件 sha）。**已知边界**：现编产物可识别（`exist=3`）
   但跨边界调用失败，同站随站预编 7.2 产物正常 ⇒ typeinfo 导出面（工单 65 缺口 2 扩大版，
   归重链批）。设计稿 §11 含五条机械知识。
6. **性能边界（实测封口项，勿重开）**：插件可达部件空间（BLAS/分配器即全部）、
   libm 标量替换（wasm 无标量 FMA）、fill 热点（带宽绑定）、faer/PGO/LTO/链接旗标/NT>8、
   工单 62 ABI 分叉（根因 = f77-fcn.h 未收编手改，已收编 fork `a5a7208`；供给树
   rebuild 可复现：1 条容忍 mismatch + wasm-opt 绿）——
   全部有数字判决，见 HISTORY 与 NOTES。

## 三线模型（2026-10-17 用户点令纠偏，终版）

**最终只有三条线**，横跨所有与 Octave-UI 对接的仓库：

| 线 | 产物 | 用户可达性 / 许可 |
|---|---|---|
| **wasm32** | wasm32 单线程（无 `-pthread`） | **无 COI 要求**（一石二鸟：避开 wasm64 问题 + 免 `SharedArrayBuffer` 门槛）⇒ 任何浏览器 |
| **master** | wasm64 **多线程** | **COI + 新浏览器内核**是踏入条件（Safari 一年前已支持 wasm64）。**不存在"单线程 wasm64"产品线**——`w64-base` 只是站点回退格 |
| **IllegalPerformance** | wasm64 多线程 + Rust 补丁 | **non-free**（"脱离开源社区"）；主线榨干之前不开 |

**分档的唯二依据 = 用户能否使用 + 是否 non-free。与性能无关**（"极限性能"是构建旋钮，不是分档依据）。
站点曾是四格（base/threads/w64/w64-base）选档矩阵；**threads 格已于 2026-10-17 删除**（HISTORY §5.108），现役站点 = 三格（base/w64/w64-base），站点只是展示层——**试验场绑定三个分支**（wasm32-final / master / IllegalPerformance）。

## 分支模型（三线独立，2026-10-07 定稿）

三条**独立可持续维护**的产线，每条都能独立吃 fork 更新、构建、验收、发运：

| 分支 | fork pin（upstream/octave） | 定位 |
|---|---|---|
| `wasm32-final` | —（冻结） | wasm32 归档线；不做新活，需要时按同法接 fork |
| `IllegalPerformance` | `f4bf15b`（+ rust-sort 源缝） | **non-free 线**（Rust 补丁 = 脱离开源社区）：8761 现役（rust-sort 2.2×、IEEE 已评估）。**主线榨干性能之前不开 IP 线** |

> **`wasm64-NEXT` 已删**（2026-10-17，用户点令——"很久以前就让并入主线，我以为你删了"）：
> 实测 `git rev-list master..wasm64-NEXT` = **0** 个独有提交（完全被 master 包含）⇒ 本地/origin/mirror
> 三处分支引用已删，`bc3865f` 仍为 master 祖先（**历史完好，对象未删**）。原 NEXT 定位（中庸 wasm64）
> 由 **master 线**承接——三线模型见上节。

**换线规则（共享容器 o113 的代价，必须遵守）**：容器里的**树、构建脚本、印章**都跟着
分支走——切分支后必须 ① `git submodule update upstream/octave` ② `sh build/provision-upstream.sh
--only octave` ③ `docker cp` 该分支的 `relink.sh`/`link-web.sh` 进容器 ④ **闸门与推送的
站点口径**：`OCTAVE_WASM_BASE` 指向**本线**的站点（IP 线 = 默认 `…/site`；master 线 = 仓库 `site/`，即
`OCTAVE_WASM_BASE=$PWD`）——plugin-check/check-facts/witness 读的都是它，不指本线 =
在别的线的部署上跑闸门（实测三次：拣选红、master 提交红、重编产物混入
rust_sort）。〔NEXT 线已删（2026-10-17）——它指向的 `next-base/site` 符链亦随之作废。〕⑤ **钩子目录**：`core.hooksPath` 是**仓库全局**的，而 IP 线（Einfacht 重构后）
用 `reflect-hooks/`、master 与 wasm32-final 仍用 `.githooks/` ⇒ 切到后两线必须
`git config core.hooksPath .githooks`，切回 IP 线改回 `reflect-hooks`（否则拿**别的线**的
钩子跑本线的提交/推送——实测一次：master 推送被 IP 的 reflect-hooks 三语闸门误拦）。
五步少一步 = 在别的线的状态上构建、验收或跑钩子。

**fork 更新 SOP（每条线相同）**：上游发版 → `upstream/octave` fork 分支 merge 上游 tag
→ 该线 bump pin（master = 无缝 lineage；IP = 缝随分支携带）→ provision → rebuild → 全量
→ 发运。IP 上新增的内核缝 = fork 上的独立提交，其他线**不继承**（各线 pin 各自的 fork 点）。

## 开工与提交的顺序## 开工与提交的顺序

1. 开工前（要跑套件 / 基准）：`sudo -E $(which python3) build/lib/doctor.py` ——
   `DOWN: <哪条>` 就修环境，别带病开跑。
2. 改完：`sh build/gates-selftest.sh` 全绿再提交（装了钩子则 pre-commit 自动做；
   pre-push 复核机器块新鲜度）。**禁 `--no-verify`**。
3. 推送后：持久盘镜像同步。**8761 只由受管辖入口改**（批次收尾细则 = `AGENTS.md`）。
