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
