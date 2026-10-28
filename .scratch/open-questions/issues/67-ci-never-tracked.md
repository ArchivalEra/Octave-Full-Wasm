# 67 · CI 兜底从未入库：`.github/workflows/` 整体未被 git 跟踪（"注释承诺了不存在的闸门"）

**Status:** resolved

**结算（2026-10-26）**：`sh build/113/check-ci-bootstrap.sh` ⇒ **rc=0「已立」**（自证 4/0）。落地三件：
① `.gitignore` 放行 `!.github/workflows/*.yml` + 三份 workflow 入库（gates.yml /
readme-sync.yml / pages-deploy.yml）；② **gates.yml 判据集对账**（与
`registry --run commit` 的 ran/off 逐个核：check_questions/retractions/facts 上 CI，
check_facts_replay（要部署树）/check_stale（时间敏感）/witness-upstream-pin（docker）/
plugin-check（产物 declared）明说不跑，6 个未启用档同一条声明）；平台闸门在 CI 必须
`. reflect-hooks/Einfacht.env`（裸跑报"缺台账"= 输入没配，实测）；`git add -A` 让
check-whitelist 在 CI 查全跟踪集（与本地"只查暂存批"互补）；③ **readme-sync.yml 新建**
（pre-push §④ 同一条 --changed 判据 + 新分支/第一推同款口径），pre-push §④ 注释翻面
（"只有本地一道" → "本地 + CI 两道"，空头历史保留作训）。
**Settling:** `sh build/113/check-ci-bootstrap.sh` —— rc=0 ⇒ CI 兜底**已立**（`.github/` 已入库且白名单放行，且本地能复跑 CI 判据集）；rc=1 ⇒ **仍是空头**（`.github/` 未被跟踪 ⇒ CI 从未跑过；pre-push 注释必须保持"只有本地一道"的实话）；rc=2 ⇒ 半吊子（已入库但白名单/判据集有问题，逐条点名）；rc=3 ⇒ 环境问题（`git` 不在 / 读不到 `.gitignore`），不是结论。
**结算件已存在**（2026-10-16 造）：`build/113/check-ci-bootstrap.sh`（自证 **4/0**；**对本仓实跑 = rc=1「仍是空头」**，与 §背景 的实测一致）。

## 背景（2026-10-16 实测，由内容仓 `mail/014` 的投递实测**逼出来**）

本仓 `reflect-hooks/pre-push` 的注释原文写着：

> ⚠️ 诚实边界：`git push --no-verify` 能跳过本 hook —— git 的原生出口拦不住；
> **所以 CI（`.github/workflows/readme-sync.yml`）跑同一条判据。**

**这句是空头**，两处实测：

```
$ git log --all --oneline -- .github/workflows/readme-sync.yml
（空 —— 该文件全历史从未存在）

$ git ls-files .github/ | wc -l
0                     ← `.github/` 整体未被跟踪
$ git check-ignore .github/workflows/gates.yml
.gitignore:4:*        ← 白名单 `*` 默认拒绝、无 `.github/` 放行规则
```

⇒ **磁盘上有 `gates.yml` + `pages-deploy.yml`**（`find .github -type f` 实测），
**但都不在 git 里** ⇒ 别的克隆者/CI 根本看不到它们。于是：

- pre-push 声称的"CI 正面兜底"**不存在** ⇒ 三语 README 判据**只有本地一道**（`--no-verify` 可绕）；
- `gates.yml` 声称"闸门的 CI 落点（Einfacht issue #4 ②）" ⇒ 同样**从未在 CI 跑过**；
- `pages-deploy.yml`（Pages 手动部署）**同样不在库里**。

**这是 AGENTS.md 记过的"白名单盲区"的又一实例**（原文：*`check-whitelist.py` 只看**已暂存**的
文件 ⇒ 被 `.gitignore` 忽略且从未 `git add` 的文件它看不见（曾因此漏掉 4 个承重文件）*）。
本轮是**同款第三例**：不是忘了 `git add` 一个文件，而是**整个 `.github/` 从未能进库**
（白名单没放行目录），而**注释却按"它存在"写了三年**。

## 为什么它值得一张工单（不只是"补个 gitignore 行"）

1. **"注释承诺的不存在物"是最贵的一类漂移**：这条注释让 reviewer 以为"CI 兜住了"，
   于是本地 pre-push 被绕过时**没有任何第二道**。本仓 doctrine（AGENTS 事实纪律第 1 条）：
   **写不出复跑方式的句子 = 假话** —— 这句正是。
2. **修它要同时动三处**（缺一处就还是半吊子）：
   - `.gitignore` 加 `!.github/` + `!.github/workflows/*`（白名单放行）；
   - `gates.yml` 入库前要**核实它引用的判据在 CI runner 上真能跑**（它自己写着跳过名单，
     依赖部署树的那批在 runner 上不存在 —— 那份名单要与 `registry --run commit` 的
     `off` 集合对齐）；
   - `readme-sync.yml` **要么造出来**（跑 `check_readme_sync.py --changed` 的等价物）、
     **要么**把 pre-push 注释改成实话（"只有本地一道"）—— **本批已改注释（注明 CI 不存在）**，
     所以本工单的余下部分 = **真把 CI 立起来**（或明确决定"不立 CI，改注释"并结案）。
3. **判据可证伪**：`git ls-files .github/ | wc -l` > 0；且**反向**：把 `.github/` 从白名单
   去掉 ⇒ 那两个文件必须重新变 `!!`（证明放行规则真在起作用）。

## 事实（本轮实测，供接手）

| 事实 | 命令 | 结果 |
|---|---|---|
| `.github/` 未跟踪 | `git ls-files .github/ \| wc -l` | `0` |
| 被 `*` 拒绝 | `git check-ignore -v .github/workflows/gates.yml` | `.gitignore:4:*` |
| 磁盘上有两份 | `find .github -type f` | `gates.yml` / `pages-deploy.yml` |
| 声称的 CI 件不存在 | `git log --all -- .github/workflows/readme-sync.yml` | 空 |
| 别的分支有（但本线无） | `git ls-tree -r --name-only wasm64-NEXT -- .github/` | `workflows/deploy-heart.yml` |

## 诚实的边界

- **本批只改了注释**（把"CI 跑同一条判据"改成"只有本地一道 + 待办"），**没有**立 CI
  —— 立 CI 要动 `.gitignore`/白名单 + 核实 runner 可达的判据集，是**独立一批**（本工单）。
- **不追责历史**：这多半是某次"抹除 isui.ren 部署集成"（`git log --all -- .github` 里有
  `9d89fd0`/`929fc63`）时删除了 `.github` 的跟踪而**忘了**它还躺在磁盘上 ⇒ 白名单也不再有它。
  记事实，不记过。
