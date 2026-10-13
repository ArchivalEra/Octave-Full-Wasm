# 探查 · scilab / pathsim / pyblocksim 作为浏览器 wasm 插件的可能（2026-10-13）

> **性质**：初步探查（用户点令："做完上述之后初步探查下…不过那就是其他的 wasm 项目了"）。
> **边界**：这三个**都不进本仓**——它们是**独立的 wasm 项目**。本文件的用途只有一个：
> 给"要不要开这三个项目、按什么顺序"一个**有依据的初步判断**。
> 数字/事实都注了复跑方式；**推断**逐条标"推断"。

---

## §0 一句话结论

| 项目 | 语言/许可 | 上浏览器的路径 | 初步判断 |
|---|---|---|---|
| **pathsim** | Python / **MIT** | Pyodide（依赖仅 numpy+scipy+matplotlib，**三者 Pyodide 全有**） | **最值得做**，且工作量最小 |
| **pyblocksim** | Python / **GPL-3.0** | Pyodide（依赖 sympy+scipy+ipydex+symbtools） | 次选；许可要留意（GPL 传染） |
| **scilab** | C++ / Scilab（GPL 系） | 自建 Emscripten 工具链（**巨型 C++ 工程**） | **最贵**，除非有强理由，否则不做 |

**共同点**：三者都是"**框图仿真**"（Simulink 范式的替代品）——这正是本仓（Octave）
**没有**的那块：Octave 能算，但没有块图建模环境。所以它们与本仓是**互补**，不是竞争。

---

## §1 pathsim（`pathsim/pathsim`）

**事实**（复跑：`curl -s https://api.github.com/repos/pathsim/pathsim`）：

| 字段 | 值 |
|---|---|
| 描述 | "A Python native dynamical system simulation framework in the block diagram paradigm" |
| 语言 | Python |
| **许可** | **MIT**（`spdx_id`） |
| 规模 | 21228 KB（约 21 MB 源码树） |
| stars | 503 |
| 活跃 | `pushed_at` 2026-10-12（**昨天还在动**） |
| 主页 | https://pathsim.org |

**依赖**（复跑：GitHub API 读 `pyproject.toml@master`）：
```toml
requires-python = ">=3.8"
dependencies = ["numpy>=1.15", "matplotlib>=3.1", "scipy>=1.2"]
```
可选 extras：`rf=[scikit-rf]`、`fmi=[FMPy]`、`test=[pytest…]`（**可选项，不装也能跑核心**）。

**上浏览器的关键判据**：依赖只有 **numpy / scipy / matplotlib** ——
三者**全部在 Pyodide 官方包清单里**（复跑：`curl -s https://pyodide.org/en/stable/usage/packages-in-pyodide.html | grep -oiE ">(numpy|scipy|matplotlib)<"` ⇒ 三个都命中）。

**推断（标"推断"）**：路径 = `Pyodide + numpy/scipy/matplotlib wheel` ⇒
`pathsim` 纯 Python 逻辑大概率**不改代码**就能跑；工作量集中在
① 把 Pyodide 嵌进页面（有现成范式）；② matplotlib 的 canvas 后端（Pyodide 侧有 `matplotlib-pyodide`）。
**要结案需要做的实验**：在 Pyodide 里 `pip install pathsim` 后跑它仓库 `examples/` 的一个最小框图，
看是否 import 即用（不猜）。

**与 MATLAB 的关系**：pathsim 是**框图**范式（Simulink 式），补的是本仓缺的那一半；
**不是** MATLAB 语言兼容层。

---

## §2 pyblocksim（`TUD-RST/pyblocksim`）

**事实**（复跑：`curl -s https://api.github.com/repos/TUD-RST/pyblocksim`）：

| 字段 | 值 |
|---|---|
| 描述 | "python packages for block based simulation of dynamical systems in continous time (inspired by simulink)" |
| 语言 | Python |
| **许可** | **GPL-3.0** ⚠️ |
| 规模 | 761 KB（小） |
| stars | 16 |
| 活跃 | `pushed_at` 2026-04-16（约半年前） |

**依赖**（复跑：API 读 `requirements.txt`）：
```
sympy>=1.0
scipy>=1.0
ipydex>=0.1.2
matplotlib
symbtools
```
**上浏览器的关键判据**：`sympy` / `scipy` / `matplotlib` 在 Pyodide 有；
但 **`ipydex` 与 `symbtools` 不在**（复跑：Pyodide 清单里 grep 不到）⇒ 需要**自己编这两个**，
或确认 pathsim 是否真依赖它们（`ipydex` 看名字是 index/DE 求解，可能是核心）。

**推断（标"推断"）**：比 pathsim 便宜不了——**多两个非标准依赖要自己上 wasm**，
且**许可 GPL-3.0**（若与本仓 AGPL 站点混用，要留意传染边界）。
⇒ **除非有具体理由选它，否则 pathsim（MIT + 零非标准依赖）更划算。**

⚠️ 注意：`pyblocksim/pyblocksim`（用户原话里的名字）在 GitHub **不存在**（404）；
真实项目是 **`TUD-RST/pyblocksim`**（复跑：`api.github.com/search/repositories?q=pyblocksim`）。
另有一个同名区块链项目 `KoushikP04/PyBlockSim`，**与本议题无关**。

---

## §3 scilab（`scilab/scilab`）

**事实**（复跑：`curl -s https://api.github.com/repos/scilab/scilab`）：

| 字段 | 值 |
|---|---|
| 描述 | "Read only copy of https://gitlab.com/scilab/scilab" |
| 语言 | **Scilab + C++** |
| **许可** | **无 `spdx_id`**（仓里无根 LICENSE；Scilab 上游是 GPL 系/自有许可混合，**要逐一核**） |
| 规模 | **464426 KB ≈ 464 MB**（本仓 Octave 树的量级） |
| stars | 399 |
| 官方源 | **gitlab.com/scilab/scilab**（GitHub 是只读镜像） |

**上浏览器的判据**：Scilab 是**完整解释器 + 巨型 C++ 运行时 + Java/GUI（Xcos 块图）**，
且**已有原生 Xcos**（块图编辑器，正是 pathsim/pyblocksim 那块）。

**推断（标"推断"）**：
- 工程量 ≈ **再做一个本仓**（甚至更多：它带 Java/Swing GUI）；
- 收益：Scilab **语言不兼容 MATLAB**（是另一门语言），对本仓"贴近 MATLAB"的目标**零贡献**；
  它的块图（Xcos）已被两个 Python 项目以**轻得多**的方式覆盖；
- **许可**：GPL 系 + 无明确 spdx ⇒ 上站前要法律核（本仓 AGPL 与之混用要谨慎）。
⇒ **建议：不做**（除非用户有"要 Scilab 语言"的具体理由——那是一个独立产品的决策，不是本仓的插件）。

---

## §4 三者对比（决策表）

| | pathsim | pyblocksim | scilab |
|---|---|---|---|
| 许可 | **MIT**（最宽松） | GPL-3.0 | GPL 系/待核 |
| 语言 | Python | Python | Scilab/C++/Java |
| 上 wasm 的依赖 | numpy+scipy+matplotlib（**全有现成 wheel**） | +sympy+ipydex+symbtools（**2 个要自编**） | 自建整个工具链 |
| 源码规模 | 21 MB | 0.76 MB | **464 MB** |
| 活跃度 | **高**（昨天还在动） | 中（半年前） | 中 |
| 补的缺口 | 框图仿真（Simulink 式） | 同 | 同 + 自带 Xcos |
| 对本仓"贴近 MATLAB"的贡献 | 间接（补范式，不补语言） | 同 | **无**（另一门语言） |
| **初步判断** | **首选** | 次选 | **不做** |

---

## §5 建议（若真要开这三个项目）

1. **先做 pathsim 的最小可行性实验**（半天级）：Pyodide 里装 pathsim，跑它 examples 里一个框图。
   **结案判据**：`import pathsim` 成功 + 一个框图积分出结果。**通过才谈项目化。**
2. **pyblocksim 先别碰**，除非 pathsim 那条路证明"Pyodide + 科学栈"在本站形态下不可行，
   而 pyblocksim 有 pathsim 没有的能力。
3. **scilab 不建议做**（§3 的三条理由）。
4. 三者**都不进本仓**：它们是独立的 wasm 项目（用户原话"那就是其他的 wasm 项目了"），
   本仓只出**判断依据**（本文件）。

⚠️ **一个必须提前说的边界**：本仓铁律是"**纯客户端计算**"。
Pyodide 路线同样是纯客户端（Python 也跑在 wasm 里）⇒ **不违反**。
但 **Pyodide 首包很大**（Python 运行时 + 科学栈 wheel，几十 MB 量级）——
与本仓"首包 11.6 MB"的成绩**不在一个量级**，做之前要量清楚（**推断**：这是 pathsim 路线
最大的实际风险，不是技术可行性）。

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

# ② pathsim 依赖
curl -s "https://api.github.com/repos/pathsim/pathsim/contents/pyproject.toml?ref=master" \
  | python3 -c "import json,sys,base64;print(base64.b64decode(json.load(sys.stdin)['content']).decode())" | grep -A2 dependencies

# ③ Pyodide 科学栈
curl -s https://pyodide.org/en/stable/usage/packages-in-pyodide.html | grep -oiE ">(numpy|scipy|matplotlib|sympy)<"

# ④ 名字纠正（pyblocksim 的真实 owner）
curl -s "https://api.github.com/search/repositories?q=pyblocksim" | python3 -c "
import json,sys
for r in json.load(sys.stdin).get('items',[])[:3]: print(r['full_name'],'|',r.get('language'))"
```
