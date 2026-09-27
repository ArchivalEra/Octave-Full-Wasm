# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, or
- **`CONTEXT-MAP.md`** at the repo root if it exists: it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in. In multi-context repos, also check `src/<context>/docs/adr/` for context-scoped decisions.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

> **本仓现状**（写成状态，别当承诺）：`CONTEXT.md` 存在（约 17 条术语，每条一行可复跑的证据）；
> **`docs/adr/` 尚不存在**。所以技能现在只需读 `CONTEXT.md`，`docs/adr/` 那一步**静默跳过**。

## File structure

Single-context repo (most repos):

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

Multi-context repo (presence of `CONTEXT-MAP.md` at the root):

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← system-wide decisions
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← context-specific decisions
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

**本仓 = 单上下文**（根一个 `CONTEXT.md`）。判断依据：没有 `CONTEXT-MAP.md`，
也没有 `pnpm-workspace.yaml` / 多包 `packages/*`。

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

> 本仓有**一条本地的语言纪律**（`CONTEXT.md` 开头那段）：代码/DOM 名字不改；
> "闸门"这类多义词在术语表里**拆成具名术语**（提交前六项检查 / 机制门①②③ / 运行时能力门 /
> 保活闸门 / 三列一致性闸门），旧写法保留为别名。写工单标题时用**具名**那个，别单写"闸门"。

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_

## 本仓的第三个来源：`build/lib/retractions.json`

`docs/adr/` 是"我们决定了 X"。`build/lib/retractions.json` 是**"我们曾经断言 X，它被推翻了"** ——
两者是不同的东西，别混。

在提出任何针对本仓事实系统的改动前，**先读 `build/lib/retractions.json`**：
里面每条都是"已经查清并且**被推翻**"的断言，`.githooks/check-retractions.py` 会在它重新出现时报错。
`HISTORY.md` 是 append-only 的历史（**不在扫描范围内**，里面的原文保留是对的）。
