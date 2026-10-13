# 实验 · OpenModelica 能不能在浏览器里跑（2026-10-13）

> **性质**：一次性可行性实验（用户点令"先做那个实验"）。**可丢弃**。
> 目的是回答一个问题：**"Modelica/Simscape 那一块（本仓零覆盖）在浏览器里到底成不成立"**，
> 以便决定"要不要为它开一个新仓库"。
> 数字/事实都注了复跑方式；**推断**逐条标。

---

## §0 结论：**成功，且比预期强得多**

**在真浏览器里实测：一个完整的 Modelica 模型跑通了全链路**——
`parse → 生成 C → 浏览器内编译成 wasm → 仿真 → 出图`，三条曲线是真结果。
**证据**：`build/113/evidence-omc-web-demo.png`（截图，2026-10-13 16:29 实拍）。

⇒ **"Modelica 上浏览器"这件事，已经有可运行的实现**（第三方 `omc-web`），
**不是"要我们从零趟一条路"**。这直接改变了新仓库的成本估算：
不是"从零移植 OpenModelica"，而是"**复用/借鉴一个已跑通的配方**"。

---

## §1 实验怎么做的（最省力路径：先测现成的，不先自己 build）

**关键发现**：`EthanJamesLew/omc-web` 是一个**完整、pin 死、有在线演示**的
OpenModelica→wasm 移植。既然它**部署在 GitHub Pages 上**，那"Modelica 能不能在浏览器跑"
这个问题**根本不用 build 就能回答**——直接测它的演示站。

复跑（本实验的实际动作）：
```bash
# ① 演示站可达
curl -sI -L https://ethanjameslew.github.io/omc-web/omc.wasm   # → 200, content-length 21344548
# ② 真浏览器打开、点 run、等结果、截图
#    （playwright-core + /usr/bin/chromium，脚本一次性，不入库）
```

---

## §2 实测结果（截图逐项读出来的数字）

演示站跑的是它自带的 `BouncingBall.mo`（经典弹跳球）。**四个阶段全绿**：

| 阶段 | 耗时 | 产物 | 大小 |
|---|---|---|---|
| parse modelica | 381 ms | `BouncingBall.mo` | 425 B |
| generate C | 28 ms | `BouncingBall_c.zip` | 57.7 KB |
| **compile to wasm** | **49.57 s** | `BouncingBall.wasm` | **1.18 MB** |
| simulate | 50 ms | `BouncingBall_res.mat` | 14.3 KB |

**总计 4/4 complete，50.02 s**；结果：**350 samples、13 events、3 variables**。

**出图**：三条曲线（`h` 高度衰减、`v` 速度、`der(h)` 导数），是**真仿真结果**，不是占位。

### 关键机制确认（这条最重要）
「compile to wasm」那一步的原文是：
> `emcc + wasm-ld · 02 · ENV=web,worker`

⇒ **它在我们熟悉的同一条路上**：把 C 代码在**浏览器内**用 **emcc + wasm-ld** 编成 wasm，
跑在 worker 里。这与本仓的"**浏览器内 Clang**"是**同类机制**（omc-web 用的是
`jprendes/emception`——clang+lld 编成的 wasm）。**不是**服务端编译。

---

## §3 我们这一侧的环境（真要自己 build 时的现状）

宿主实测（复跑：`command -v` + `--version`）：

| 工具 | 版本 | 够不够 |
|---|---|---|
| rustc / cargo | 1.98.1 | ✓（OM 有 Rust 重写目标） |
| cmake / ninja | 4.3.4 / 1.13.2 | ✓ |
| rustup targets | 有 `wasm32-unknown-unknown`、`wasm32-unknown-emscripten` | ✓ |
| **缺** | `wasm32-wasip1` / `wasm32-wasip2` | **要补**（OM 的 fmi 驱动要 wasip1） |
| docker `o113` | emcc 6.0.12 / cmake 3.28 / **无 rust** | 容器里没有 Rust |

⇒ 若要**自己 build omc-web 那套**，它的配方要求 **emsdk 3.1.74 + 3.1.24**（两个版本）
——**与本仓现役的 6.0.12 不同**，要么用它的 docker（`omc-web/docker/Dockerfile`），
要么再装一套 emsdk。**这是"自己 build"的主要成本项。**

---

## §4 omc-web 的配方（pin 死的，可复现）

`omc-web/versions.lock`（原文）：

| 键 | 值 | 说明 |
|---|---|---|
| `emsdk_compiler` | **3.1.74** | 编 omc.wasm + sim-runtime 库 |
| `emsdk_emception` | **3.1.24** | 供 emception 的 sysroot `.a`（emception 的 LLVM-16 wasm-ld 只链 3.1.24 时代对象） |
| `OpenModelica_sha` | `55e1ec10…` | 上游 OM（nightly SHA） |
| `OMCompiler-3rdParty_sha` | `41c701f2…` | |
| `OMBootstrapping_sha` | `65b97238…` | **预生成的 MetaModelica→C**（必须与 OM SHA 同动） |
| `emception_tag` | `5ff1975a…` | `jprendes/emception`（浏览器内 clang+lld） |
| `MSL_version` / `MSL_sha` | **4.0.0** / `6626538a…` | Modelica 标准库（boot 子集 + full 懒加载） |

构建单元（`projects/`）：`omc-wasm`、`sim-runtime`、`emception-bundle`；
外加 `runtime-fs`（headers.zip + sysroot.zip）、`msl`（`msl-boot.zip` + `msl-full.zip`）、`web/`。
顶层 `Makefile` 有 `submodules-check`（校验每个 submodule HEAD == lock，CI 会因漂移失败）
——**这套纪律与我们本仓的"pin 见证"是同一形状**。

---

## §5 如实记：omc-web 的限制（不能只看成功）

README 原文与 `TODO.md` 实测：

| 限制 | 原文/证据 |
|---|---|
| 求解器窄 | README："Only Euler and Runge Kutta solvers are functioning" |
| 内存吃紧 | README："Requires a lot of browser memory (issue with static site approach)" |
| 演示站有个 404 | console 里一条 `404`（非致命，页面照跑） |
| **编译慢** | 实测 49.57 s（单模型）——这是**浏览器内编译**的固有代价，不是 bug |
| **上游 wasm-jit 本身更窄** | OM 官方 README：wasm-jit *"only 1 dense linear solver, a Newton non-linear solver, Euler, and dassl"* |
| 上游仍在进行 | OM `TODO.md` 记着 wasm-jit 事件循环正确性缺口（无 guard 的 bouncing ball 会穿地） |

⚠️ **注意**：omc-web 走的是"**生成 C → 浏览器内 emcc 编 wasm**"（用 emception），
**不是** OM 官方的 `wasm-jit`（那是另一条路）。两条路**求解器覆盖都窄**。
⇒ 对本仓的意义：**"能跑"已证；"跑得宽"尚未**。

---

## §6 结论与建议（给决策用）

1. **可行性：成立**（§0/§2 实测）。"Modelica 上浏览器"不再是未知。
2. **不必从零**：`omc-web` 是**完整可复现配方 + 在线演示**，新仓库可**借鉴其结构**
   （尤其是 `versions.lock` + `submodules-check` 那套 pin 纪律，与本仓同形）。
3. **成本主要在"自己 build"**：要 **emsdk 3.1.74/3.1.24**（与本仓 6.0.12 不同）+ 一套
   OpenModelica 编译链。**这是新仓库的第一笔真实投入**。
4. **能力边界要提前认**：求解器窄（Euler/RK/dassl）、内存吃紧、编译慢。
   ⇒ 新仓库的**定位**应是"**方程级物理建模的教学/探索环境**"，**不是**"工业级 Simscape 替代"。
5. **与"块图仓库"的关系**：MSL 有 `Blocks` 库 ⇒ 若 OM wasm 可用，它**原则上也能覆盖因果块图**。
   ⇒ 这支持了上一轮的判断：**"块图仓库"的设计要等 OM 这条线清楚之后再定**，
   否则可能白做一套后端。

**下一步（待用户定）**：要么(a) 在新仓库里照 omc-web 配方 build 一套自己的 OM wasm；
要么(b) 先做"块图前端"（后端已证存在）；要么(c) 两个并行。

---

## §7 复跑命令（本实验每个数字的出处）

```bash
# 演示站与产物（HTTP 头）
curl -sI -L https://ethanjameslew.github.io/omc-web/omc.wasm   # 200, 21344548

# 配方
gh api repos/EthanJamesLew/omc-web/contents/versions.lock --jq .content | base64 -d
gh api repos/EthanJamesLew/omc-web/contents/Makefile      --jq .content | base64 -d | head -40

# 上游 wasm 能力（官方 README）
gh api "repos/OpenModelica/OpenModelica/contents/OMCompiler/Compiler/OpenModelica.rs/README.md" \
  --jq .content | base64 -d | head -40

# 本机工具链
for t in rustc cargo cmake ninja; do $t --version; done
rustup target list --installed
```

**证据**：`build/113/evidence-omc-web-demo.png`（本目录，截图，2026-10-13 16:29）。

---

## §8 ★ 关键判定（2026-10-13）：OM 是"独立站"还是"能同页"？—— 实测回答

> 用户点令："要搞清楚 OM 到底应该作为一个独立网站（不能作为 Octave 的补集），还是可以放在
> 这个页面内；**如果不能放这个页面内，那就不是我们靠近 MATLAB 级别完整度的步骤**。"
> 这是决定性的问题。**实测回答：能同页，而且同页是有意义的**（不是硬塞）。

### 8.1 先分清"同页"有两种，别混

| | 含义 | 代价 | 判断 |
|---|---|---|---|
| **(a) 物理同页** | 同一个 HTML 里同时有 Octave wasm 和 OM wasm，各自一块 UI | 两个引擎的内存/体积叠加 | **可行**（浏览器能装多个 wasm 实例） |
| **(b) 语义互通** | 两个引擎能**交换数据/结果**，形成一个工作流 | 要一个**共同的数据格式** | **可行且已验证**（见 8.3） |

用户问的"能不能放这个页面内"，关键是 **(b)**——只 (a) 的话就是"两个 tab 并排"，不叫补集。

### 8.2 实测：两个引擎的能力**互补**（这才是"同页"成立的理由）

我用本仓 8761 实测了 Simscape 式建模需要的 **DAE（微分代数方程）** 能力：

| DAE 类型 | 例子 | 本仓 Octave 实测 |
|---|---|---|
| **index-1（Mass 矩阵）** | `M=[1 0;0 0]` + `ode15s(...,odeset('Mass',M))` | **✓ OK**（n=47，解对） |
| **index-1（全隐式）** | `ode15i`：RC 电路 `C·dV/dt=(Vin−V)/R` | **✓ OK**（V(5)=0.9931，理论 0.9933） |
| **index-1（多节点）** | `ode15i`：双节点 RC 网络 | **✓ OK**（V2(5)=0.9593） |
| **index-3（约束系统）** | `ode15i`：约束摆（5 元：x,y,vx,vy,λ） | **✗ `IDASolve failed`** |

**这条边界正是问题的核心**：
- Octave 的 `ode15i`/`ode15s` **能解 index-1 DAE**（工程上大量问题落在这类）；
- **index-3**（带位置约束的机械系统——Simscape/Modelica 最常见的形态之一）**需要"指标约简"**，
  那是**符号处理**（Pantelides 之类），而 **Octave 没有这层**（它是数值语言）。
- **指标约简恰恰是 OpenModelica 编译器的核心工作**。

⇒ **两个引擎不是重复，是互补**：OM 把 index-3 的方程**符号化降指标**成 index-1，
而 **Octave 正好能解 index-1**。这就是"同页"的**语义理由**。

### 8.3 实测：两引擎有**共同的数据格式** —— `.mat`

集成需要"握手格式"。**实测本仓 Octave 能读写 `.mat`**：

| 测试 | 结果 |
|---|---|
| `save('-v7')` + `load` | **✓ OK**（A(2,2)=4） |
| `save('-v4')` + `load` | **✓ OK** |
| `save`（默认）+ `load` | **✓ OK**（trace=15） |
| MAT4 文件头可读 | **✓** |

**而 omc-web 的仿真输出就是 `.mat`**（截图原文："dump **MAT4** trace"，
产物 `BouncingBall_res.mat` 14.3 KB）。
⇒ **两边用同一个交换格式**：OM 仿真 → `.mat` → Octave 读进来做后处理/画图/控制设计。
**这不是设想的桥，是两边现成都有的东西。**

### 8.4 结论（直接回答用户）

**OM 能放在这个页面内，而且是"语义互补"的放法，不是硬塞。**

1. **不是"独立网站"**：它不需要另一个域名/另一个站点。它可以作为**同一站点里的第二个引擎档**。
2. **不是"Octave 的插件"**（上一轮已纠正）：它是**平级的第二个引擎**，有自己的语言和包。
3. **同页的实质 = 一次 `.mat` 握手**：用户在 OM 档里做方程级物理建模 → 仿真出 `.mat`
   → 在 Octave 档里读进来做数值后处理。**两个引擎各干自己最擅长的**：
   - OM：符号化 + 指标约简 + 跨域物理库（MSL）
   - Octave：数值求解 + 控制/信号/统计工具箱 + 矩阵语言

4. **因此它是"靠近 MATLAB 完整度"的合法一步**：MATLAB 的 Simscape↔MATLAB 关系正是这样
   ——**Simscape 建模、MATLAB 分析**，两边同一个工作区。我们复刻的正是这个**分工**，
   只是用两个 wasm 引擎实现，中间用 `.mat` 而不是共享内存。

### 8.5 仍未决（诚实清单）

- **同页的技术成本**未实测：两个 wasm 同时驻留的内存/体积（OM 21.3 MB + emception + 我们
  29.6 MB）在低端机上是否可行 —— **未测**（omc-web 自己都承认"需要很多浏览器内存"）。
- **`.mat` 握手只验了"两边都能读写"**，**没验"OM 写的那个具体文件 Octave 能读"**
  （omc-web 用的是 MAT4；我们 v4 也通，但**端到端没连过**）。这是下一步该做的**真集成实验**。
- **OM wasm 我们自己还没 build 过**（只测了别人的演示）—— 仍是第 1 步的未知。

---

## §9 ★ 两个决策判定（2026-10-13，用户点令）：块图仓库会被吞吗？OM 是"同级别上游"吗？

> 用户原话："确认一下块图仓库的开发目标是否完全被 OM+Octave 吞噬，
> OM 是否作为与我们同级别的上游仓库给 Octave-UI 供货。"
> 这两个都是**能不能省一个仓库 / 能不能少一条线**的判断，必须用事实答。

### 9.1 块图仓库会被"OM + Octave"吞噬吗？—— **大部分会，但有一小块不会**

先看**块图的两种形态**（上一轮已提），现在有了实测可以判：

| 块图的能力 | 谁能提供 | 结论 |
|---|---|---|
| **因果块图库**（Continuous/Discrete/Logical/Math/Sources…） | **MSL.Blocks**（实测该目录有 17 个 `.mo` 库文件） | **OM 已提供** ⇒ 自研块图库**没必要** |
| **图形块图编辑器**（画块、连线、放元件） | **OMEdit**（实测有 `OMEditLIB/{Annotations,Modeling,Element}` 图形编辑源码；**且有 Qt-for-WebAssembly 构建目标**，含 `Widgets/Quick3D/Qml/OpenGL`） | **OM 已提供**（官方 IDE 的 wasm 版）⇒ 自研编辑器**没必要** |
| **因果求解**（信号流图的 ODE 求解） | 两边都有：OM（自带）/ 我们（ode45/ode15s 实测 6/0） | 不构成"要开新仓库"的理由 |
| ★ **"Octave 语法 + 块图"的结合** | **没人提供**：MSL.Blocks 是 **Modelica 语法**的块；OMEdit 编辑的是 `.mo` 文件 | **这才是唯一没被吞噬的那一小块** |

**⇒ 判定**：
- **"做一个通用块图环境"这个目标，被 OM 吞噬了**——OM 有块图库（MSL.Blocks）+ 图形编辑器
  （OMEdit wasm）+ 编译器 + 求解器，**一整套**。我们再自研一套块图，是**重复造轮子**。
- **"在 Octave 语法里画块图"这个目标，没被吞噬**——因为 MSL.Blocks 的块是 **Modelica**
  语义（非因果方程、`.mo` 文本），不是"`ode45` + MATLAB 语法的因果块"。
  但**这一小块值不值得单开一个仓库？**——**存疑**（见 9.3）。

### 9.2 OM 是"与我们同级别的上游仓库"吗？—— **是，且证据充分**

"同级别上游"的判据（本仓已有 19 条 submodule 的成例）应该是：
**① 有独立的源；② 我们照配方 build 它、同源托管产物；③ 用 pin 机制锁住版本。**
OM 逐条满足：

| 判据 | OM 的实情 |
|---|---|
| ① 独立源 | `github.com/OpenModelica/OpenModelica`（402 MB，活跃：2026-10-12 还在动） |
| ② 我们 build + 同源托管 | omc-web 已给出**完整 pin 死的配方**（emsdk 3.1.74/3.1.24 + OM SHA + emception + MSL 4.0.0）；COEP 那堵墙要求**必须同源**，所以只能自己 build —— 与 Forge 包/emsdk 同形 |
| ③ pin 机制 | 本仓已有 `upstream-pins.json` + `upstream-lock.json` + `provision-upstream.sh` + `witness-upstream-pin.py`；OM 作为第 20 条 submodule 完全套用 |
| 许可 | **AGPLv3 / OSMC-PL 双选** —— 与本仓 AGPL-3.0 **兼容**（本仓 AGPL 重，这是加分不是障碍） |

**⇒ 判定**：**是**。OM 应当作为**第 20 条上游 submodule**，与本仓平级。
它不是"Octave 的一个插件"，而是**与 Octave 平级的第二个引擎上游**。

### 9.3 那到底开几个仓库？（把两个判定合起来）

```
上游层（各自的独立仓，本仓用 submodule + pin 锁）：
  ├─ upstream/octave        （已有）
  ├─ upstream/emsdk         （已有）
  ├─ … 18 条 …              （已有）
  └─ upstream/openmodelica  ← **新增：第 20 条**（OM 作为平级上游）
        ↓ 各自 build 出 wasm 产物，各自同源托管
供货层：
  └─ Octave-UI  ← 用户提到的"我们这一侧"，**一个页面供货两个引擎档**
       ├─ Octave 档（现役）
       └─ OM 档（新）  ← 通过 .mat 与 Octave 档握手（§8）
```

**⇒ 不需要"块图仓库"**（它的目标被 OM 吞了），**需要的是**：
1. **OM 作为第 20 条上游**（pin + provision + 自 build）；
2. **Octave-UI 侧加一个"OM 档"**（供货第二个引擎，UI 上与 Octave 档并列）。

⚠️ **一个诚实的保留**：9.1 表里最后一行（"Octave 语法 + 块图"）**理论上仍是个缺口**，
但它值不值得单开仓库，取决于**用户是否真的要"在 MATLAB 语法里画块图"**。
若答案是"用 Modelica 画块图就够了" ⇒ **零新仓库**；若"必须 MATLAB 语法" ⇒ 那一小块才单列。
**这个问题只有用户能答**，所以本判定**先按"被吞噬"记**，并把这个问号显式留下。

### 9.4 复跑命令

```bash
# MSL.Blocks 的库文件
gh api "repos/modelica/ModelicaStandardLibrary/contents/Modelica/Blocks" --jq '.[].name'
# OMEdit 图形编辑器源码
gh api "repos/OpenModelica/OpenModelica/contents/OMEdit/OMEditLIB" --jq '.[].name'
# OMEdit 的 Qt-wasm 目标（含 Widgets/Quick3D/OpenGL）
gh api "repos/OpenModelica/OpenModelica/contents/OMEdit/OMEditGUI/wasm/CMakeLists.txt" \
  --jq .content | base64 -d | head -30
# 本仓现有上游 submodule 数
git config --file .gitmodules --get-regexp path | wc -l
```
