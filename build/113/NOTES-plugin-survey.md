# 探查 · scilab / pathsim / pyblocksim 作为浏览器 wasm 插件的可能（2026-10-13）

> **性质**：初步探查（用户点令："做完上述之后初步探查下…不过那就是其他的 wasm 项目了"）。
> **边界**：这三个**都不进本仓**——它们是**独立的 wasm 项目**。本文件的用途只有一个：
> 给"要不要开这三个项目、按什么顺序"一个**有依据的初步判断**。
> 数字/事实都注了复跑方式；**推断**逐条标"推断"。
>
> ★ **2026-10-13 重写 §0–§2**（用户挑战："pathsim 那种小玩意真能和 Xcos 碰瓷吗？
> 我们硬生生把 Octave 从 500MB 压到 8MB"）。**用户是对的，我第一版把三者并列成
> "选哪个 Python 项目"是错的框法**——真正的选项是"**在我们已有的引擎上做块图**"
> （见 §0.5），Python 那三个只是"买别人的引擎"的次优解。重写后的结论在下面。

---

## §0 一句话结论（重写）

**最好的路不是 pathsim，是"用我们自己的引擎做块图前端"。** 实测：本仓已发运的 wasm
**已经具备 Simulink 式仿真的全部数值底座**（§0.5 五条实测全过）。缺的只有**前端编辑器**
（一个 JS 图编辑器），而那**恰恰是可以独立于 Octave 做的事**。

| 方案 | 引擎 | 前端 | 体积 | 判断 |
|---|---|---|---|---|
| **★ 自建块图（新仓库）** | **复用我们的 Octave wasm**（已具备） | 新写（litegraph/rete 之类） | 复用现有 ~10 MB 首包 | **首选**（§0.5 实测支持） |
| pathsim | Pyodide + Python 栈 | 自带（Python 内） | **Pyodide 运行时 + 科学栈，几十 MB** | 次选：**另起一个更重的运行时** |
| pyblocksim | 同上 + sympy/ipydex/symbtools | 自带 | 更重 | 再次 |
| scilab | Scilab C++/Java 整树 | Xcos（Java/Swing，**上不了浏览器**） | 464 MB 源码 | 不做（§3） |

**为什么"自建"优于"用 pathsim"（用户点破的那点）**：
- pathsim 是一个 **Python 库**，要在浏览器跑就得引 **Pyodide**——那是**另一个完整运行时**
  （CPython wasm + numpy/scipy/matplotlib wheel），首包量级**远大于**我们辛苦压出来的 10 MB。
  用户那句"我们硬生生把 Octave 从 500MB 压到 8MB"的**分量**正在这里：**我们已经有引擎了，
  没必要再为块图引一个更重的引擎**。
- pathsim 是"**纯 Python 实现**的仿真框架"（小、能跑），但它的**数值能力远不如 Octave**：
  没有 ode15s（刚性）、没有 control 包（LQR/place/zpk）、没有 signal 包。**碰不了 Xcos 的瓷**
  ——而**我们的引擎能**（§0.5）。

---

## §0.5 ★ 实测：我们的引擎**已经**具备块图后端（2026-10-13，8761）

块图仿真（Simulink/Xcos 范式）需要什么？**建模 + 求解 + 控制器设计**。实测本仓现役 wasm
（`pkg load control` 后）：

| 块图需要的能力 | 实测（8761） | 结果 |
|---|---|---|
| 状态空间建模 + 阶跃响应 | `sys=ss([-1 0;0 -2],[1;1],[1 0],0); [y,t]=step(sys,0:0.1:2)` | **len=21, yend=0.8647** ✓ |
| 传递函数 + 仿真 | `G=1/(s^2+0.5*s+1); [y,t]=step(G,0:0.1:5)` | **yend=1.0366** ✓ |
| **非线性 ODE（块图核心）** | `ode45(@(t,x)[x(2);-0.5*x(2)-sin(x(1))], [0 10],[1;0])` | **69 步, xend=-0.0819** ✓ |
| **刚性 ODE** | `ode15s(@(t,y)-1000*(y-cos(t))-sin(t), [0 1], 1)` | **20 步, yend=0.5403** ✓ |
| 控制器设计（LQR） | `lqr([0 1;-1 -1],[0;1],eye(2),1)` | **K=[0.414 0.682]** ✓ |
| 零极点/根轨迹 | `zpkdata((s+3)/(s^2+2*s+2))` | **2 极点 1 零点** ✓ |

**结算件**：`test/browser/probe-blockdiag-backend.mjs`（**6/0**，rc=0）。复跑：
`sh test/browser/run.sh test/browser/probe-blockdiag-backend.mjs http://127.0.0.1:8761/`。

⚠️ **一个实测坑（写进探针注释）**：`ode15s` 依赖 **`__ode15__.oct`（SUNDIALS）**，而它是
**懒加载资产** —— **不先 `OctaveAssets.load('__ode15__')`，`ode15s` 会静默返回空**，
看起来像"引擎不支持刚性求解器"。第一版探针就栽在这（误报缺口），加上前置装载后 6/0。
⇒ 块图前端用刚性求解器前**必须先确保该资产已装**。

⇒ **结论**：块图的"后端"（数值）**已经有了**；缺的是**前端**（图编辑器 + 连线 + 求解编排）。
而前端是**纯 JS**、**不需要碰 wasm** ⇒ **它可以是一个独立仓库**，通过我们已定义的
嵌入接口（`bridge/octave-embed.js`，工单 38）调引擎。

---

## §1 pathsim（`pathsim/pathsim`）—— **降级为次选**

**事实**（复跑：`curl -s https://api.github.com/repos/pathsim/pathsim`）：

| 字段 | 值 |
|---|---|
| 描述 | "A Python native dynamical system simulation framework in the block diagram paradigm" |
| 语言 | Python |
| **许可** | **MIT**（`spdx_id`） |
| 规模 | 21228 KB（约 21 MB 源码树） |
| stars | 503 |
| 活跃 | `pushed_at` 2026-10-12 |

**依赖**（复跑：GitHub API 读 `pyproject.toml@master`）：
```toml
requires-python = ">=3.8"
dependencies = ["numpy>=1.15", "matplotlib>=3.1", "scipy>=1.2"]
```

**依赖是干净的**（Pyodide 全有）——**但这不是决定性的**。决定性的两条（§0）：
① 引 Pyodide = **引第二个运行时**（比我们的 10 MB 重）；② pathsim 的数值面**不如 Octave**
（无 ode15s/control/signal）⇒ 做出来的块图**能力弱于**我们引擎能支撑的。
⇒ **它仍是"想快速要个玩具块图"的最省事选项**（MIT、依赖干净），但**不是"和 Xcos 碰瓷"的选项**。

**与 MATLAB 的关系**：pathsim 是**框图**范式，**不是** MATLAB 语言兼容层。

---

## §2 pyblocksim（`TUD-RST/pyblocksim`）—— 仍为次选之后

**事实**：Python / **GPL-3.0** / 761 KB / stars 16 / `pushed_at` 2026-04-16。

**依赖**（`requirements.txt`）：`sympy` `scipy` `ipydex` `symbtools` `matplotlib`。
`sympy`/`scipy`/`matplotlib` 在 Pyodide 有；**`ipydex`/`symbtools` 不在** ⇒ 要自编两个。
⇒ 比 pathsim 便宜不了，且 **GPL 传染**要留意。**与 pathsim 同一条（引第二个运行时）的缺点。**

⚠️ 名字纠正：`pyblocksim/pyblocksim` 在 GitHub **不存在**（404）；真实项目是
**`TUD-RST/pyblocksim`**（复跑：`api.github.com/search/repositories?q=pyblocksim`）。

---

## §3 scilab（`scilab/scilab`）—— 仍不做，但**理由要修正**

**事实**（复跑：`curl -s https://api.github.com/repos/scilab/scilab`）：

| 字段 | 值 |
|---|---|
| 描述 | "Read only copy of https://gitlab.com/scilab/scilab" |
| 语言构成 | **Scilab 22.8M / C++ 14.8M / C 11.0M / Java 10.8M** / Fortran 6.4M … |
| 规模 | **464 MB 源码** |
| 许可 | 无根 LICENSE（GPL 系/待核） |
| 官方源 | gitlab.com/scilab/scilab（GitHub 是只读镜像） |

**★ 理由修正**（第一版说"语言不兼容 MATLAB"——对，但**不是**最硬的理由）：
最硬的是 **Xcos 的前端是 Java/Swing**（`xcos/src` 下 **262 个 `.java`**）⇒ **浏览器无 JVM**，
**Xcos 本体上不了 wasm**。证据：**FOSSEE 的 `xcos_on_cloud`（MIT，JS 3.2 MB）正是为此
用 JS 重写了 Xcos 前端**（复跑：`gh api repos/FOSSEE/xcos_on_cloud/languages`）——
连 Scilab 社区自己都走"**只搬后端、前端 JS 重写**"这条路。
⇒ 那还不如**直接用我们自己的引擎**做前端（§0.5：我们引擎的能力 ≥ Scilab 的数值后端）。

---

## §4 三者对比（决策表，重写）

| | **自建块图（新仓库）** | pathsim | pyblocksim | scilab |
|---|---|---|---|---|
| 引擎 | **我们的 Octave wasm**（已有） | Pyodide+Python | 同 + symbtools | Scilab C++/Java |
| 引擎体积 | **复用 ~10 MB 首包** | Pyodide 运行时（更重） | 更重 | 464 MB |
| 数值能力 | **ode15s+control+signal**（§0.5） | numpy/scipy（无 control 包） | +sympy | 强 |
| 前端 | **要写**（JS 图编辑器） | 自带 | 自带 | Xcos（Java，上不了浏览器） |
| 许可 | 我们的 | MIT | GPL-3.0 | GPL 系 |
| 与"贴近 MATLAB" | **同语言（Octave = MATLAB 语法）** | 另一门 Python API | 同 | 另一门语言 |
| **判断** | **首选** | 玩具级次选 | 再次 | 不做 |

---

## §5 建议（重写）

1. **开一个新仓库做块图前端**（用户点令："更希望开个新仓库然后你传授 fork 管线与维护经验"）。
   形态：**纯 JS 图编辑器 + 复用本仓 wasm 作后端**，通过 `octave-embed.js` 嵌入接口对接。
   **本仓**（Octave）与**新仓**（块图）边界清晰：本仓出引擎，新仓出前端与编排。
2. **pathsim 保留为"万一要个 Python 生态玩具"的备选**——不是主路（§1）。
3. **scilab 不做**（§3：Xcos 前端 Java，连社区自己都重写）。
4. 新仓库的**维护管线**直接沿用本仓这套（见 §7 的"可移植清单"）。

---

## §6 复跑命令（本文件每个数字的出处）

```bash
# ① 三个仓的事实（许可/语言/规模/活跃度）
for r in pathsim/pathsim TUD-RST/pyblocksim scilab/scilab; do
  echo "== $r"; curl -s "https://api.github.com/repos/$r" | python3 -c "
import json,sys; d=json.load(sys.stdin)
print(' language',d.get('language'),'| size',d.get('size'),'KB | stars',d.get('stargazers_count'))
print(' license',(d.get('license') or {}).get('spdx_id'),'| pushed',d.get('pushed_at'))"
done

# ② Xcos 的 Java 依赖（判据：上不了浏览器）
gh api "search/code?q=repo:scilab/scilab+path:scilab/modules/xcos/src+extension:java" --jq .total_count

# ③ 社区自己怎么做的（xcos_on_cloud = JS 重写前端）
gh api repos/FOSSEE/xcos_on_cloud/languages

# ④ 我们引擎的块图后端能力（§0.5）—— 在 8761 页面里逐条 eval：
#    ss/step、tf/step、ode45、lqr、zpkdata

# ⑤ Pyodide 科学栈
curl -s https://pyodide.org/en/stable/usage/packages-in-pyodide.html | grep -oiE ">(numpy|scipy|matplotlib|sympy)<"
```

---

## §7 可移植到新仓库的"本仓管线清单"（用户点令："传授 fork 管线与维护经验"）

| 机制 | 本仓位置 | 新仓要不要 |
|---|---|---|
| **上游 pin**（submodule + 每提交见证） | `build/upstream-pins.json` + `.githooks/witness-upstream-pin.py` | 要（若新仓有上游） |
| **lock**（URL+sha256，非 git 的字节） | `build/upstream-lock.json` + `zreflect/check_locks.py` | 要 |
| **事实系统**（数字唯一产地 + 复跑闸门） | `zreflect/`（vendored Einfacht）+ `build/FACTS.json` | **强烈建议**（本仓的核心资产） |
| **闸门自证**（每个闸门证明自己会红） | `build/gates-selftest.sh` + `zreflect/gate.py` | **强烈建议** |
| **车道路径铁律** | `build/113/check-lane-purity.py` | 视新仓形态 |
| **受管辖发运入口**（--dry-run/--verify/--selftest） | `build/promote-*.sh` | 要 |
| **三语 README 同批** | `reflect-hooks/pre-push` + `check_readme_sync.py` | 可选 |
| **悬案台账**（每条挂可跑结算件） | `.scratch/open-questions/issues/` | 建议 |

（详细的"fork 管线"本身 = 上游 submodule + 每提交 pin 见证 + lock 字节 + provision 供给；
本仓 `maintaince.md` 的"地图"一节是入口。）
