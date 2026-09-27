# Issue tracker: Local Markdown

Issues and specs for this repo live as markdown files in `.scratch/`.

> **本仓的特殊之处**：`.scratch/` 在别的项目里是"临时草稿"，在**本仓是承重目录** ——
> 悬案的归宿就在这里，它是活状态的一部分，不是草稿。因此它进了白名单
> （`!.scratch/open-questions/issues/*`），其余 `.scratch/` 分支仍然被拒绝。

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`, never a single combined tickets file
- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## 本仓追加的字段：`Settling:`

本仓的"悬案"（未结案）与普通工单有一个区别：**一条悬案必须挂一个可跑的结算件**，
否则它不是一个可工作的悬案，而是一句猜想。因此每张悬案工单在头部多一行：

```
**Settling:** <可执行的路径或命令> —— rc=<值> ⇒ <结论A>；rc=<值> ⇒ <结论B>
```

规则（与 `AGENTS.md` 的事实纪律同源）：

- `Settling:` 写**仓库内的相对路径**（探针脚本、闸门、或一条能直接跑的命令），不写"见 NOTES"。
- 两种结论必须给出**不同的退出码/可区分的输出**，否则它证伪不了任何东西。
- **结算件还不存在的悬案，是合法工单** —— 那这张工单的第一个交付物就是造它。
  这种情况写 `**Settling:** 不存在 —— 本工单的第一交付物`，别编一个假路径。
- 结案后：把结论写进 `build/113/NOTES-*.md`（若是推断）或台账（若量到了数），
  再把这行改成指向结论；工单 `Status:` 置 `resolved`。**别删工单**——历史要留。

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `.scratch/<effort>/map.md` (the Notes / Decisions-so-far / Fog body).
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `.scratch/<effort>/issues/` for files that are open, unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.
