# 反哺上游：Einfacht（事实系统）

> 本目录留档**提给上游** `github.com/ArchivalEra/Einfacht` 的 issue 正文。
> 为什么提 issue 不提 PR：事实系统是 vendored 的**机制本体**，各消费方版本不统一 ⇒
> PR 不好合、也容易把机制与策略搅在一起（上游 #1–#4 的既有惯例）。
> ⚠ 下面这份是**留档副本**；正式提交走 `gh issue create -R ArchivalEra/Einfacht`。

---

## 背景

我们仓 [Octave-Full-Wasm](https://github.com/ArchivalEra/Octave-Full-Wasm)（GNU Octave 11.3.0 → WebAssembly，纯客户端）已经把 `zreflect/` 这套搬进来跑了多个真实批次：**43 套浏览器验收 / 1084 PASS、85 条事实台账、每条带复跑命令、翻案台账、六道闸门 + 闸门自证**。前四张反哺（#1–#4）我们全落地了，`--get` / `--accept-changes` / 测龄 / replay 闸门都在用。

这轮是**一次真实事故**逼出来的机制缺口。事故本身不新鲜（同事前一天刚在 #3/#4 里说过"同一件知识写在几处会走散"），但它暴露的是事实系统**结构上**缺一档 —— 我们把它补上了，写成 issue 供你们取舍。

---

## 缺口：`replay` 只有两档，而"贵事实"落在**永不复查**那一档

现在的 `replay` 语义是二值：

- `replay=True` —— `cmd` **逐字执行**、stdout == 值。**便宜、每次提交真跑**。
- `replay=False` —— **显式豁免**。留给"需要构建产物 / 浏览器 / 基准机"的贵事实。

问题出在第二档：`replay=False` 事实上等于**永不复查**。而"贵"恰恰是**最需要**便宜复查的
地方 —— 一条浏览器基准（跑 5 分钟）你不可能进 pre-commit，但它的**来源**（由哪个工具、
哪份输入产出）是可以**便宜地**核的。

结果：一条"**产物没变、但产出它的工具变了**"能一路蒙混过关，直到最贵的端到端回归才炸。

---

## 事故取证（可复跑，全在公开仓）

**现象**：我们把一个线程数从 4 调到 8 的重链产物发运到验收站点后，全量浏览器回归里
**唯一压 `dlopen` 的那套**从 **71/0 掉到 44/27**（首个崩溃 `table index is out of bounds`，
之后 wasm 实例被带死）。数值套件全绿 —— 只在这一个面炸。

**真因不是线程数**，是**构建脚本来源漂移**：

- 产物的身份证 `octave.build.json` 里有一条 `tool.script_sha256`（记的是**构建它的**
  `link-web.sh` 的 sha）。那次记的是 `2382ed34…`；
- 而仓库里现役的 `link-web.sh` 是 `63d8e7d7…` —— **不一致**；
- 容器里那份 `/src/bin/link-web.sh` 与仓库 `diff` **只有一行**：`EXC_FLAGS` 多了个 `-flto`
  —— 是上一批 **LTO 性能实验的残留**（`git log` 显示仓库版**从未**含 `-flto`）。
- 该数组同时喂 `main.cc` 编译**与最终链接行** ⇒ whole-program `metadce` 剥掉了**只有
  `dlopen` 才用到**的符号 ⇒ 崩在 dlopen 面。

**判别实验（把它坐实）**：另有一份 LTO 实验产物（`-flto`、但**线程数正常**），跑同一套
⇒ **同样 44/27**。⇒ 元凶是 `-flto`，不是线程数。

**关键点**：`tool.script_sha256` 这条"来源"事实**我们记了**，但**没有任何机制去核对它**。
它躺在产物里，谁都没比过。

---

## 建议：第三档 `witness`（贵事实的便宜见证）

给 `fact()` 加一对可选参数：

```python
fact(value, cmd, source, ...,
     replay=False,                 # 贵：值本身不逐字复跑（现状）
     witness="<便宜命令>",          # 新：便宜、无害、只读的命令
     witness_expect="<期望 stdout>")  # 新：witness 的 stdout 必须逐字等于它
```

语义：
- `witness` 与 `replay` **正交** —— `replay=False` 的贵事实照样挂见证，**每次提交真跑**；
- 见证的是**上下文/来源**（"产出它的工具/输入就是我以为的那个"），**不是值本身**；
- 判据同 `cmd` 的裸值契约：`stdout.strip() == witness_expect`；
- 形状契约：`witness` 与 `witness_expect` **必须同时给**（只给一个 ⇒ 断言残缺，采集器当场报错）；
- **零值守卫要跟着调**：现在"`replay=True` 的条数 = 0 ⇒ 报（全豁免不是通过）"这条，
  在"台账只挂了 witness 事实"时会**误报** —— 守卫应改为"`replay=True` 为 0 **且** 无
  `witness` 才报"。

### 我们仓的落地形状（可直接抄）

- `zreflect` 侧的改动：`facts.py` 的 `fact()` 增两参 + 渲染进台账；`check_facts_replay.py`
  增一个**见证档**（遍历 `witness` 事实、执行、比对），零值守卫同步；自证加 3–5 条
  （见证过 / 见证不过 / 见证命令 rc≠0 / 形状残缺 / "只有 witness 事实不报"）。
- **首个实例**（新文件 `build/113/witness-build-provenance.py`，带 `--selftest`）：
  ```
  python3 build/113/witness-build-provenance.py w64
  #   ⇒ match                                   （部署件由仓库现役 link-web.sh 构建）
  #   ⇒ DRIFT: lane=w64 artifact=<sha16> repo=<sha16>   （来源漂移 ⇒ 见证失败）
  ```
  它读部署件身份证的 `tool.script_sha256`，与仓库现役脚本的 sha 比 —— **零依赖、只读、
  毫秒级**。这条见证若早存在，上述事故会在**提交时**就被抓住，根本不用等浏览器回归。

---

## 一个诚实的边界（供你们设计时参考）

"产物由**现役**工具构建"这条不变式，只在**活跃迭代、每批重链**的产物上成立。我们仓有四个
产物档，它们的 `tool.script_sha256` **本就各不相同**（建造时间不同、脚本改过多次），
把旧档也硬查会得到**永久假红**（噪声 ⇒ 最后被整闸 `REFLECT_REPLAY=off` 糊掉，那才是真无人看管）。

所以我们的见证**由调用方（台账）显式指定车道名**，不猜哪档活跃。这条没有加进机制本身 ——
它是**策略**，留给各仓。但 `witness` 的**存在**（"贵事实也能有便宜复查"）是**机制**，
我们认为是这套系统目前缺的一档。

---

## 我们不做 PR 的理由

同意你们在 #1–#4 里的取舍：这套系统是**机制本体**（`zreflect/`），而各消费方 vendored 的
版本不统一 ⇒ PR 不好合、也容易把机制和策略搅在一起。所以按你们已有的"反哺 issue"惯例提，
附**可复跑的取证**与**我们落地的形状**，由你们决定要不要吸收。

复跑方式（我们仓，公开）：
- 见证脚本：`Octave-Full-Wasm` 的 `build/113/witness-build-provenance.py`（含 `--selftest`）；
- 闸门自证：`python3 .githooks/check-facts-replay.py --selftest`（13 PASS / 0 fail）；
- 事故全记录：`HISTORY.md` §5.77 / §5.78，工单 `41-nt8-dlopen-regression`。

---

# 反哺 #7（2026-10-03）：**新插件提案 —— 声明式不变量闸门**

> 上游 issue：<https://github.com/ArchivalEra/Einfacht/issues/7>
> 形状 = `zreflect/check_invariants.py`（通用引擎）+ `<repo>/invariants.json`（纯数据规格）
> + 挂成一条 **`witness` 档事实**（不是外挂工具）。是我们 #6 ② 原则「输入要有便宜的落点」的实例。

**规格**（数据不是代码）：`{"checks":[{path, must_contain:[…], must_not_contain:[…], why}]}`。
**引擎**：只读文件、不构建不碰容器 ⇒ 进 pre-commit；判据 stdout 裸值 `ok` / `DRIFT: …`；
零值守卫（空清单/缺 path/读不到 ⇒ 都报）；`--selftest` 三类齐全。**未配 ⇒ 明说未启用退 0**。

**本仓落地**（工单 53）：`build/build-inputs.json`（6 条）+ `build/113/witness-build-inputs.py`
（自证 5/0）+ 事实键 `w64_build_recipe_ok`（挂 witness），与产物侧 `w64_build_tool_match` 互补：
`recipe_ok` 管**事前**（仓库配方有被证伪片段/缺必需旗标），`tool_match` 管**事后**（产物不是
现役脚本造的）。六条检查项全部来自真实事故：`-flto` 漂移、`-fwasm-exceptions` 不对称、
`ALLOW_TABLE_GROWTH=1`（dlopen 表增长）、`E2_RELAXED_FMA` 接线、`-sMEMORY64=1`。

**与 `calibrate`（#6 ①）正交**：一个守**量测仪器**，一个守**仓库文件本身**（输入）。

**⚠ 已知边界（不藏）**：grep 型不变式**分不清注释与代码**（`ALLOW_TABLE_GROWTH=1` 在注释
与 `SFLAGS=(…)` 里都出现 ⇒ 只有注释也通过）。契约名不许暗示语义；能锚定就锚定；要更强保证
的用 `calibrate`（量产物）或 `witness`（量来源）。**声明式检查的强度上限 = 它匹配的文本形态。**


---

# 记录：#9 提了即撤（2026-10-04）—— 先核对已收编档位，再提新缺口

> issue：<https://github.com/ArchivalEra/Einfacht/issues/9>（已 close，not planned）
> 提问前没先核对 #5–#8 的现有档位，被用户当场拦下。自查结论：
> **机制层不缺** —— 产物侧便宜核验 = #5 `witness` 档（挂部署件/候选件的只读复查命令）；
> 「先证明仪器看得见 X」= #6 ① `calibrate`；#7 的边界一节**早已写明**这个分工
> （"要更强保证的，那是 calibrate 或 witness 的活"）。

本条的真实增量只有**使用层**两件，降级回本仓留档（不占上游 issue）：

1. **linker 技巧**：被换部件的独有符号（mimalloc 的 `mi_version`，dlmalloc 没有，`llvm-nm`
   可验证）+ `--export-if-defined` ⇒ strip 过的产物仍可从**导出段**量出"旋钮生效了没"；
2. **双向漂移断言**（声明了但产物没有 ⇒ 拒；产物有但没声明 ⇒ 拒）—— 判定器的**策略**，各仓自查。

两条已在本仓落地：`write-build-manifest.py --exports`（witness 出口，四态实测：mimalloc /
default / unknown / 缺文件）、`check-build-manifest.py` 的 malloc 双向规则；
`w64_cand_malloc` 挂 witness 档每提交复查。

**反哺流程的教训（写给下一个自己）**：提 issue 前先做"现有档位对照表"——
#5 witness / #6 calibrate+instruments / #7 invariants / #8 envfile 各管哪层，
新需求先问"哪一层、是不是已有档位换了个用法"。

---

# 反哺 #10（2026-10-04）：进程/端口活性的开工预检（doctor）

> 上游 issue：<https://github.com/ArchivalEra/Einfacht/issues/10>
> **先对照过档位再提的**（#9 的教训）：#7 管输入文本、#8 管配置载体——都不管**活物**。

- **缺口**：git/闸门/witness 全管文件与产物；服务进程、容器、端口占用不在任何机制管辖内
  ⇒ "文件不变量全绿"与"环境可用"是两个命题。两次实测事故：机器重启杀掉容器 + 8761 服务
  （文件层全真、底线实际不可用，白跑一轮基准才现形，§5.86）；实验端口被别的 dev server 占用
  ⇒ 探测误判"产物起不来"（§5.83）。
- **建议形状**：声明式 doctor（spec 数据：http/docker/port-free 三种 kind + why 必填），
  挂**开工/跑套件前**（不挂 pre-commit——查的是会死的东西，频率错）；两类断言：
  必须活着 + 必须空着；stdout 裸值 `ok` / `DOWN: <哪条>`；每条带超时（探针失败模式与被探测物解耦）。


---

# 反哺 #13（2026-10-07）：**多线仓库里验证闸门读的是「恰好部署的那个世界」—— 缺一个声明式验证对象（reflection world）**

> 上游 issue：<https://github.com/ArchivalEra/Einfacht/issues/13>
> 透镜 = codebase-design（深模块的 interface 藏了 ambient input；缝存在但是四条平行半缝）。

**三次真实事故（同日，公开仓可复跑）**：① cherry-pick 到 `wasm64-NEXT` 后 `plugin-check` 红
——NEXT 登记表 vs IP 部署站点错位；② master 提交同形状；③ NEXT 重编产物混入 rust_sort
——共享容器跑了别的线的 relink.sh/link-web.sh。同族小事故：`hotpath read_facts` 取"最新
日志"把 `hotpath_top` 静默指到 profiler 噪声。

**缺口**：闸门是深模块（run→ok/DRIFT），但 interface 藏了"我在验证哪个世界"——解析方式
四种并存（`OCTAVE_SITE` / `OCTAVE_WASM_BASE` / `W64_ARTIFACTS` / 硬编码容器名 + 最新日志），
换线时没有任何东西强迫闸门与"本线世界"对齐。

**建议形状**：声明式验证对象（world.json，数据不是代码）——每条线声明 site/artifacts/
container/fork_pin_ref + `active` 字段；闸门从 world 清单解析验证对象（替代四个 ambient
旋钮）；换线脚本跑完**写出** world 声明，闸门核对声明 vs 环境（容器印章/站点 sha/脚本
sha 三对账）；零值守卫 + --selftest 三类。

**诚实边界**：单线仓不受益；跨引擎可复现性（relaxed_madd）是正交议题不混；"哪条线算
当前"是人的决定（active 字段），机器只核对声明一致。
