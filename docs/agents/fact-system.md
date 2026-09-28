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
