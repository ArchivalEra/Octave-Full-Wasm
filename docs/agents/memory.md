# 记忆架构 · 小指路牌 + 事实系统主力（2026-10-04 起）

> 用户指令：「将记忆架构推向 **『小 maintenance 指明方向 + 事实系统记忆主力』** ——
> handoff 已经膨胀到难以维护，是时候拆分了。」本文件就是那次拆分的设计记录 + 现行规约。

## 问题

HANDOFF 曾两度膨胀（1034 行 → 2026-09-26 瘦身 → 又涨回 612 行）：批次叙述被当"活状态"
写进去，越写越长，而其中大半是"已完成" = 历史；规则/硬坑与 `AGENTS.md` 整节重复；
数字靠闸门拦着不让手抄，可维护成本仍全花在"把历史改写成现在"。

## 分层（每类知识只有一个家）

| 记忆类型 | 家 | 谁维护 | 闸门 |
|---|---|---|---|
| **方向 + 当前态** | `HANDOFF.md`（只许：现在是什么 / 下一步 / 指针表） | 人（每批收尾改 §0/§1） | `check-handoff.py`（陈旧断言 L1–L4）+ `check-facts.py`（键引用/块一致） |
| **数字（记忆主力）** | `build/FACTS.json`（源）→ HANDOFF 文末 `AUTO:FACTS`/`AUTO:STATE`（渲染） | 机器（`build/facts.py` / `update-handoff.py`，pre-commit 重算） | `check-facts.py` 规则 A–D |
| 规则 / 纪律 / 硬坑 | `AGENTS.md`（每次会话自动载入 ⇒ 唯一权威，HANDOFF 不重复） | 人 | `check-facts.py`（键引用） |
| 批次过程 / 事故 / 翻案 | `HISTORY.md`（append-only） | 人（**收尾当场写**，别攒） | 无（历史不查现状；§5/§9/§10 豁免） |
| 未结案的问题 | `.scratch/open-questions/issues/NN-*.md` | agent / 人 | issue-tracker 惯例（`docs/agents/issue-tracker.md`） |
| 机制 / 推断 | `build/113/NOTES-*.md`（须注明"哪个实验能结案"） | 人 | 无（推断不是实测，禁入活状态） |
| 被推翻的断言 | `build/lib/retractions.json` | 人 | `check-retractions.py`（重现即红） |
| 术语 | `CONTEXT.md` | 人 | `check-consistency.py`（证据行） |
| 会话注入 | `.githooks/handoff-context.py`（SessionStart hook：读 AUTO:STATE + 指路） | 机器 | 无 |

## HANDOFF 的写作规则（1–3 有闸门背书，4–5 是纪律）

1. **只写三节**：`§0 现在是什么` / `§1 下一步` / `§2 指针表` + 文末机器块。正文目标 ≤ ~60 行。
2. **批次叙述当场进 HISTORY**（批次收尾动作之一），HANDOFF 只留一行指针 + 键名。
3. **数字只写键引用**（`` `build/FACTS.json` 的 `键` `` 形态才会被 `check-facts.py` 核对存在性）；
   sha / 套件数这类易烂值**永不出现在正文**。
4. **规则 / 硬坑 / 批次收尾动作去 `AGENTS.md`**（它每次会话都载入 ⇒ HANDOFF 抄一份必然烂一份）。
5. 机器块（`AUTO:FACTS` / `AUTO:STATE`）由 pre-commit 重算，**别手改**。

## 为什么这样分层安全（接续能力不降）

- 新会话 = `AGENTS.md`（自动载入）+ HANDOFF 三节（≈60 行）+ 文末机器块 ⇒ "现在"全部在手；
  要细节按 §2 指针走一层（HISTORY / 工单 / NOTES）。
- `check-handoff.py` 的活状态断言闸门在新结构下照常工作：它只查"非 §5/§9/§10、非附"的段落，
  正文变短只会让 L1–L4 更容易查全；L1/L2 在正文无可查对象时本就有"覆盖说明"（F2 设计行为）。
- `check-facts.py` 规则 C（引用的键必须存在）保证"指路"不会指到不存在的键上。
- 历史全文可考古：瘦身前 612 行版 = `git show ce4f4d7:HANDOFF.md`；更早 1034 行版 =
  `git show 76176bb:HANDOFF.md`（2026-09-26 第一次瘦身）。
