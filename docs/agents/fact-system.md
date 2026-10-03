# 事实系统入门（写给接手工单的 agent）

> **为什么有这套东西**：模型会**自信地错**。不是胡说，是"旧话照抄"——一个数字抄在 6 处、
> 改了一处其余 5 处继续对外宣称旧值；一句已被实测推翻的断言在更正后仍留在同一文件里。
> 这套系统的全部目的只有一个：**让"现在如此"必须能被一条命令证明，且被推翻时能被自动抓到。**
> 你不用背任何一条规矩——它们都有闸门盯着，违反会被拦。你只需要知道**拦住你的时候该怎么办**。

---

## §1 四个马上要用的动作

### ① 你想写一个数字（比如"导出 734 个"）

**别写数字，写键名。** 测出来的数字**只在一个地方生产**：`build/FACTS.json`，
渲染进 `HANDOFF.md` 文末的 `AUTO:FACTS` 块。正文引用它的写法是键名（例如
`build/FACTS.json` 的 `exported_functions`）。`HANDOFF.md` 里**手抄数字**会被闸门拦
（`.githooks/check-facts.py` 的"裸数字"规则）。

- 每条事实自带 **`cmd`（复跑命令）与 `source`（出处）** —— 那才是这条数字的证明。
- 看某个键的值与复跑方式：`python3 build/facts.py show <键名>`。

### ② 你重测了数字，然后被 FATAL 了 —— **那是设计行为，不是故障**

`python3 build/facts.py` 重测全部事实并写回。它有**两道守卫**，都会 FATAL：

| 守卫 | 什么时候拦 | 你该做什么 |
|---|---|---|
| **掉条**（键没了） | 某个输入不在（例：站点上没有 `threads/`）| 把输入准备好；确实要删就 `--allow-drop` 并把掉的键记进 HISTORY |
| **改口**（值换了） | 量出的值和台账不一样 | **逐条确认是实测出来的**，然后 `--accept-changes`；若只是量错了，先修输入 |

为什么改口要拦：闸门只对少数几个 sha 回盘核对，其余条目的旧值一旦被覆盖，
**再也查不到它变过**。所以它把 `旧值 → 新值` 打出来，等人逐条确认。

⚠️ **改完数字 / 写了被翻案的断言会让闸门变红——那是设计行为。改文档，别关闸门。**

### ③ 你想下结论

**断言有三种，各有去处**：

- **实测**：写进活状态（`HANDOFF.md`），旁边带复跑命令。
- **推断**：写进 `build/113/NOTES-*.md`，**并注明哪个实验能结案它**。
  写不出结案实验的推断 = 猜想，**不许**留在活状态。
- **被推翻**：登记进 `build/lib/retractions.json`（那里已有 10+ 条前车之鉴）。
  `.githooks/check-retractions.py` 会在它**重新出现**时报错。

判据怎么写：**`—— rc=0 ⇒ 结论A；rc=7 ⇒ 结论B`** 这种**两种可区分结论**的形状。
只描述做法、不描述判据的句子证伪不了任何事。

### ④ 你发现一个问题还没答案

开成工单：`.scratch/open-questions/issues/NN-<slug>.md`（一个文件一张单），
头部必须有 `**Settling:**` 行（格式见 `docs/agents/issue-tracker.md`）。
**写不出结算件的悬案是合法的**：写 `不存在 —— 本工单第一交付物就是造它`，**别编假路径**。
结案后 `Status:` 置 `resolved` 并追加 `## Answer`，**别删文件**——历史要留。

---

## §2 提交前的固定动作（每批）

```bash
python3 .githooks/update-readme.py        # 先刷新（**再** git add —— 顺序错了 pre-push 会判陈旧）
python3 .githooks/update-handoff.py       # HANDOFF 的 AUTO:STATE 机器块
python3 build/facts.py --render-doc HANDOFF.md   # 台账 → 事实块（改了数字就要刷）
sh build/gates-selftest.sh                # ★ 每个闸门先证明自己"会红"
python3 .githooks/check-handoff.py && python3 .githooks/check-consistency.py \
  && python3 .githooks/check-wants.py && python3 .githooks/check-whitelist.py \
  && python3 .githooks/check-retractions.py && python3 .githooks/check-facts.py
git add -A && git commit …                # pre-commit 会把上面全部再跑一遍
```

**白名单坑**：新增文件必须同步 `!路径` 进 `.gitignore`（本仓默认拒绝一切），
否则 `check-whitelist.py` 直接拒。**先刷机器块、再 `git add`** —— 顺序反了 pre-push 判陈旧（踩过）。

---

## §3 本仓最容易救你命的三句话

1. **"能编过 ≠ 能用了"**。碰运行期行为必须在**浏览器里**实测；构建成功 + 产物自检绿**不算**功能验收。
2. **"跑验收前先验产物 SHA"**：磁盘 / HTTP / 页面实例化三层
   （`build/check-deploy-sha.sh` + `test/browser/probe-artifact-sha.mjs`）。
   "改完程序用老产物跑"在这个仓踩过很多次，每次都是 SHA 一查就现形。
3. **"探测/自检不许放在开机路径上"**：坏产物会让整页卡死，连带所有浏览器验收全挂。

---

## §4 现状：哪些数字已经有键、哪些还没有

- **有键的**（`python3 build/facts.py show` 能看）：现役 wasm32 双档的全部数字——
  基础档（`wasm_sha` / `wasm_v128` / `exported_functions` / `accept_suites` / `accept_pass` …）、
  线程档（`threads_*` 那组）、E2 两组（`e2_single_*` / `e2_threaded_*`）、
  探针（`probe_lane_pass` / `probe_lane_fail`）、`env_vars`。
- **w64 车道也已上键**（2026-09-28 补，10 条）：`w64_verdict` / `w64_wasm64` /
  `w64_shared_memory` / `w64_exported_functions` / `w64_v128` / `w64_i64_insns` /
  `w64_oct_files` / `w64_oct_wasm64` / `w64_wasm_sha` / `w64_wasm_bytes`。
  它们的**生产者**是 `build/113/build-w64-lane.sh` 的 `facts` 阶段（写两份日志）+ 宿主侧
  `docker cp` 产物到 `w64-artifacts/`；`python3 build/facts.py show w64_wasm64` 能查。
  ⇒ **Q3 那几个内存上限还没上键**（它们来自一次浏览器实测，不是产物），仍是散文。
- ⚠️ **教训（值得照着做）**：上键之前，w64 的数字只活在 `NOTES-wasm64.md` 与工单 Answer 的
  散文里 —— 而那份产物**后来又被重编过一次**，散文里的数字（734 / 4,189,800 / 44）
  **当场过期**，没有任何东西报警。**上了键，改口守卫就会拦**（那正是它存在的理由）。

**⚠️ 已知缺口（如实记）**：悬案台账（`.scratch/open-questions/issues/`）目前**没有**本仓闸门盯着
——检查器在归档仓 `zcode-reflect` 里，没接进本仓的 `gates-selftest.sh` 名单。
所以"工单格式对不对"现在靠自觉。要收紧就把那个检查器搬进来登记。

---

## §5 三个机器块的分工（**别手改它们**）

| 块 | 谁生成 | 装什么 |
|---|---|---|
| `HANDOFF.md` 的 `AUTO:FACTS` | `build/facts.py --render-doc` | 测出来的数字（唯一产地） |
| `HANDOFF.md` 的 `AUTO:STATE` | `.githooks/update-handoff.py` | 部署件 sha/体积、最近一次全绿回归 |
| `README.md` 的 `AUTO:FILES` | `.githooks/update-readme.py` | 文件清单 |

**文档分层**（闸门只查活状态）：`HANDOFF.md` = 活状态（断言必须与产物一致）；
`build/113/PLAN-*.md` = 带日期的批次记录（允许"当时如此"）；`HISTORY.md` = append-only 历史
（**不在扫描范围**，里面的原文保留是对的）；`build/113/NOTES-*.md` = 机制与推断。

---

## §6 指路（真要看时再打开）

| 想知道什么 | 看哪里 |
|---|---|
| 纪律全文（五条事实纪律 + 三条不可违背） | `AGENTS.md` |
| 术语（"闸门"在这仓至少指 6 种东西，这里拆成具名术语） | `CONTEXT.md` |
| 你的工作令 | `.scratch/open-questions/issues/18-wasm64-final-integration.md` |
| `Settling:` 行怎么写 | `docs/agents/issue-tracker.md` |
| 什么话不能说 | `build/lib/retractions.json` |
| 你这份需求的来龙去脉 | `build/113/PLAN-wasm64.md` |

## 复跑契约（Einfacht #4 ④⑤ 移植，2026-10-02）

- 台账每条事实默认 `replay=True`：`.githooks/check-facts-replay.py` 会**逐字执行** cmd 并要求
  stdout（去首尾空白）== 值。写不出这种 cmd 的（重活：浏览器/容器/构建/基准；派生/散文式），
  在 `build/facts.py` 的 `_no_replay` 名单里**显式** `replay=False` —— 有名单、有明说，不静默。
- **每跑必变的量**（随机填充、时间戳类）：存**一次实测采样** + 在 note 里写明它怎么变
  （消费侧 stable 逐字判 / 不稳定档结构判），**不许裸存** —— 裸存 = 永远红 = 噪音 = 整闸被关。
  值会变 ≠ 不能进台账，得先声明它怎么变。
- 跨语言消费方（CI、编译型语言的测试进程）读值一律走 `python3 build/facts.py --get KEY`
  （只打印值本身），**不要自己解析 FACTS.json**。

### 第三档：`witness` —— 贵事实的便宜见证（2026-10-02，工单 42）

`replay=False` 的**贵事实**（浏览器基准、构建产物）此前只有两档：要么每次真跑（贵到进不了
pre-commit），要么**永不复查**。`-flto` 事故（HISTORY §5.78）正是踩这一档 —— "产物没变、
但产出它的工具变了"（容器 `link-web.sh` 被塞进 `-flto`）一路走到全量浏览器回归才炸。

⇒ `fact(..., witness=<便宜命令>, witness_expect=<期望 stdout>)`：**与 `replay` 正交**，
贵事实照样挂见证、**每提交必跑**；`check-facts-replay.py` 逐字执行它并要求 stdout 逐字相等。
见证的是**来源/上下文**，不是值本身。形状契约：两参**同时给或同时不给**。
首个实例：`build/113/witness-build-provenance.py <车道>`（"部署件由仓库现役 link-web.sh
构建"），台账键 `w64_build_tool_match`。

⚠ **只对活跃迭代、每批重链的产物断言**（本仓 = w64）：旧档的构建脚本 sha 本就不同，
硬查 = 永久假红 = 噪声 = 整闸被关。**策略留在各仓，机制（贵事实也能有便宜复查）才上收。**

### 第四档：`calibrate` —— 仪器校准（2026-10-03，Einfacht #6 ① 移植）

复跑契约抓"命令死了"（rc≠0），抓不到**仪器静默失真**：命令成功、值稳定、复跑永远"通过"，
而它量的根本不是想量的。本仓实例（工单 52）：`llvm-objdump -d | grep -c relaxed_madd` 在
emsdk 5.0.7 上**恒为 0**（该 objdump 对这条指令打印 `<unknown>`）—— 据此两次误判"FMA 没进产物"。

⇒ `fact(..., calibrate=<样本命令>, calibrate_expect=<样本已知输出>)`：声称"产物里有没有 X"
的 cmd 配一个**已知含 X 的样本**。与 `replay`/`witness` 正交、**每提交真跑**，
`check-facts-replay.py` 不符即报"**仪器失真**"（先用已知正样本证明仪器看得见，再计数）。
首个实例：`w64_relaxed_madd`（校准样本 `test/fixtures/relaxed_madd_min.wasm`，字节计数 `fd 87 02`）。

**配套：仪器生命周期闸门** `.githooks/check-instruments.py`（可插拔）：
- `FACTS_INSTRUMENT_DAYS=天` —— **恒常检测**：台账键 `first_seen` 超阈值 ⇒ 报
  "人工确认：这条 cmd 是在量，还是恒返回同一个数？"
- `FACTS_INSTRUMENTS=build/instruments.json` —— **量法登记位**：被证伪的**量法**像
  `retractions.json` 管"被推翻的断言"那样有登记；台账任何 cmd 含被证伪片段 ⇒ 报。
两旋钮未配 ⇒ 明说未启用、退 0。pre-commit 已显式启用（30 天 + `build/instruments.json`）。

### 第五档（同 `witness` 档）：**构建输入的不变式**（2026-10-03，工单 53；Einfacht #6 ②）

上游 #6 给 `collect.py` 原则表加了第 5 条：**「输入要有便宜的落点」**——产物生成后，它的输入
（源/工具/旗标/环境）必须有一条**不依赖重跑**的可读记录 + 一条便宜来源不变式，每提交核对。
本仓的实例化（**不是外挂工具，是事实**）：

- **声明式清单** `build/build-inputs.json`：`{path, must_contain, must_not_contain, why}`
  —— 数据不是代码，换配方只改数据。
- **见证** `build/113/witness-build-inputs.py`（自证 5/0）：只读配方文件、**不构建、不碰容器**，
  ⇒ 进 `witness` 档每提交真跑。判据 `ok` / `DRIFT: …`。
- **事实键** `w64_build_recipe_ok`（挂上述见证）+ 既有的 `w64_build_tool_match`
  （产物侧：部署件记的 `tool.script_sha256` == 仓库现役 `link-web.sh`）。
  ⚠ 两者互补：`tool_match` 抓"**产物**不是现役脚本造的"（事后）；`recipe_ok` 抓"**仓库配方**
  本身有被证伪片段 / 缺必需旗标"（事前）。发现的真实事故：`-flto` 漂移进 `link-web.sh`
  （工单 41/52）、w64 车道丢 `-sMEMORY64=1`（工单 52）。
- **为什么必须挂在事实系统上**：脱离它另起一个 `build-doctor`，就等于再造一个**自带
  "我以为的构建状态"** 的组件——那正是幻觉的温床。输入侧的不变式走同一批四档与同一批复跑
  闸门，才有"可复跑、可证伪、可登记"的资格。
