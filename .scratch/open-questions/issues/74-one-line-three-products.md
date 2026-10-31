# 74 · 三线合一：一条线出三种产物（可执行 spec）

**Status:** ready-for-agent
**Settling:** `bash build/113/check-one-line-three-products.sh`
rc=0 ⇒ 一条线上三个模式各能 `explain` 出**可区分的参数组**，且关键差异（MEMORY64 / MALLOC /
RUST_SORT / 目标架构）与三线裁决一致；许可边界（free 产物不链 librustsort.a）有机器判据
rc=1 ⇒ 有断言不成立（逐条点名）
rc=2 ⇒ 读不到（fail-closed）
**结算件不存在 —— 本工单第一交付物就是造它**

---

## Problem Statement

三条分支（`IllegalPerformance` / `master` / `wasm32-final`）**不是同一份东西的三个译本**，
是**三代不同的结构**，各自独立演化：

| | IP | master | wasm32-final |
|---|---|---|---|
| 机制层 | `zreflect/` 29 件 | **`.githooks/` 17 件** | **`.githooks/` 13 件** |
| 活状态文档 | `STATE.md` 1422 行 | `STATE.md` 188 行 | **`HANDOFF.md`** |
| `core.hooksPath` | `reflect-hooks`（存在） | 同值但**目录不存在** | 同左 |

（`core.hooksPath` 指向不存在目录 = **那两条分支的钩子从未跑过**。）

代价实测：
- master 有 **28** 个 IP 没有的提交，w32 有 **19** 个；逐条核完发现 **46/47 是"同一修复在两处各做一遍"**
  （`main.cc` 的 `omp` stub、`check-oct-imports.py` 位域、`relink.sh` 的 `LANE_TAG`、
  `build-libs.sh` 的工具链指纹 —— 文件在 IP 上**逐字节相同**）。
- 只有 **1 个真缺口**：`6f97172` 把 emcc 6.x 的 OpenMP 假阳口径固化进
  `configure-113-full.sh`（`ac_cv_func_omp_get_num_threads=no` 等三条）。IP 没有这段，
  而 IP 的 `.oct` **从未在 6.0.12 下重编过**（17 个里 16 个是 5.0.7 时代）⇒ 没踩到而已。
  一旦重编：`__glpk__.oct` 变 1494B 空桩（0 个 `glp_` 符号）而**构建全绿**。

⇒ 三条线的维护成本是三份，收益是零 —— 差异本来就能用**构建参数**表达。

## Solution

**一条主干，三个产物。**

`build/113/relink.sh` 的 `mode_table` 已经就是"模式 → 环境变量组"，实测两模式的参数差异
（`explain` 输出 diff）：

| 参数 | `product`（wasm32） | `w64`（wasm64） |
|---|---|---|
| `MEMORY64` | 0 | 1 |
| `MALLOC` | （空） | `mimalloc` |
| `RUST_SORT` | 0 | **1** |
| `MAXIMUM_MEMORY` | 2GB | 8GB |
| `KEEP_LIST` | `keep.txt` | `keep-w64.txt` |
| `OCTS_SCAN_DIRS` | `/src/octs-site` | `/src/octs-6012-w64` |

⇒ **三个产物 = `product`（wasm32）/ `w64`（wasm64）/ `w64` + `RUST_SORT=1`（IP）**。
前两个已经能出；第三个只差 `RUST_SORT` 这一个旋钮（**它已经是默认值**：`w64` → `RUST_SORT=1`）。

### ★ 许可边界：靠**产物级隔离**，不是分支隔离

`f4bf15b`（rust-sort 缝）在 **`upstream/octave` 子模块**里，不是本仓主干文件。non-free 的
字节只进入**链了 `librustsort.a` 的产物**。

判据（本工单的核心断言）：
- `product` 产物**不得**含 `octave_rust_sort_f64` 导出（free 产物）
- `w64` + `RUST_SORT=1` 产物**必须**含（non-free 产物）
- `relink.sh` 的 `mode_table` 对 `product` 硬写 `RUST_SORT=${RUST_SORT:-0}`（**默认 0**，
  且取补丁 = 旋钮置空 ⇒ 树对象零改动）

这样"free 仓里躺着 non-free 代码"的问题不存在：仓里只有**开关**和**缝**，
non-free 的实现只在产物里、且可关。

### 落地步骤

1. **回拿唯一真缺口**：`6f97172` 的 OpenMP 口径 → `configure-113-full.sh`（**已做**，见下）
2. **把另两条分支的机制层统一**（它们没有 `zreflect/`）：
   - master：`.githooks/` 迁到 `zreflect/` + `reflect-hooks/`，写自己的 `Einfacht.env`
     （`REFLECT_DOC=STATE.md`，无 zh/de README），手工插 `AUTO:GATES` 标记
   - w32：同上，但 `REFLECT_DOC=**HANDOFF.md**`（它没有 `STATE.md`）+ 12 处数字分流
3. **删两条分支的引用**（本地/origin/mirror 三处），**不删 git 对象**（AGENTS 铁律）
4. **改名**：`IllegalPerformance` → `master`（用户自己做）

## User Stories

1. 作为维护者，我希望**只有一个地方要改**，而不是同一个修复在三条分支各做一遍
2. 作为维护者，我希望三个产物从**同一次提交**构建出来，这样"三条线"不再可能互相漂移
3. 作为维护者，我希望 `relink.sh explain <mode>` 是**唯一的参数文档**（不手抄命令）
4. 作为许可审查者，我希望 free 产物**机器可证地**不含 non-free 符号
5. 作为许可审查者，我希望 non-free 部件的**唯一产地**是上游子模块的 pin + 本仓的开关，
   而不是散落的分支
6. 作为维护者，我希望删分支时**历史不丢**（对象保留，只是引用没了）
7. 作为维护者，我希望合并后三条分支的历史仍可 `git log <old-branch>` 追溯
8. 作为审查者，我希望看到"三个产物的参数差异表"作为判据，而不是口头说"能出"
9. 作为维护者，我希望 OpenMP 假阳口径**在主干上就有**，这样任何一条产物重编 `.oct` 都不会踩
10. 作为下游（课程站等），我希望 wasm32 产物仍然从同一个 repo 发（Release 不变）
11. 作为维护者，我希望合并**可回滚**：一个 `git revert` + 恢复分支引用即回到三线
12. 作为审查者，我希望结算件能证明"三组参数真的可区分"（不是三个名字指同一组）

## Implementation Decisions

- **主干 = `wasm32-final` 的接替者是 `product` 模式，不是分支。** 三个产物是三个
  **mode**，不是三个 branch。这是本工单的核心模型变化。
- **`mode_table` 是唯一产地**：新增/删除产物必须改表，`explain` 自动跟着变。
  **不许**在别处手抄参数（本仓已有 `check-lanes-single-source.py` 逐条对账四个消费方）。
- **OpenMP 口径**已经回拿进 `configure-113-full.sh`（三条 `ac_cv_*` export），
  并注明"原本只在 w32 上，IP 因 `.oct` 未重编而没踩到"。
- **机制层迁移**：master/w32 的 `.githooks/` **保留不删**（它们是各自的历史证据），
  但 `core.hooksPath` 改指 `reflect-hooks`，并在其 `AGENTS.md` 里写清"钩子已换层"。
  ⚠️ 若直接删 `.githooks/`，`git log` 里那些钩子的历史就断在一个看不见的文件上。
- **`Einfacht.env` 三份各写**（`REFLECT_DOC` 不同：`STATE.md` / `STATE.md` / `HANDOFF.md`）。
  **不许复制 IP 那份**（会让闸门查不存在的文件）。
- **删分支 = 删引用**：`git branch -d` 本地 + `git push origin --delete` + mirror 同。
  **不 `git gc`、不删对象**（AGENTS：不删 git 对象不改历史）。

## Testing Decisions

**测试缝 = `build/113/check-one-line-three-products.sh`（新增），它验的是"参数组可区分"这条最高缝。**

四条断言（每条都必须能红）：

| # | 断言 | 怎么证明它会红 |
|---|---|---|
| ① | 三个模式都能 `explain` 出**非空**参数组 | 把某模式的 `out_default` 删掉 ⇒ `explain` 空 ⇒ 红 |
| ② | 三组参数**互不相同**（不是三个名字同一组） | 把 `w64` 的 `MEMORY64` 改成 0 ⇒ 与 product 同 ⇒ 红 |
| ③ | 关键差异与三线裁决一致（`MEMORY64` 0/1、`MALLOC` 空/mimalloc、`RUST_SORT` 0/1） | 把 `RUST_SORT` 硬写成 1 ⇒ product 也 non-free ⇒ 红 |
| ④ | **许可边界**：`product` 默认 `RUST_SORT=0`（free），`w64` 默认 1（non-free） | 交换两个默认值 ⇒ 红 |

**prior art**：`build/113/check-lanes-single-source.py --selftest`（15 条，逐消费方对账）是
同形状的"单源 vs 多消费者"闸门；`check-lane-purity.py --selftest`（10 条）是"死档必须被拒"。

**升级前后对照**：三个模式的 `explain` 输出 diff 存进工单（不是 README）。

## Out of Scope

- **不改 `upstream/octave` 的 pin**（`f4bf15b` 已含 rust-sort 缝）。
- **不重编任何产物**（本工单只动"谁能出什么"的定义，构建是另一批）。
- **不改 `site/` 的三份镜像布局**（那是 UI 的 `sync-lanes.sh` 的事；已发给内容仓的信里
  记了 617 MiB 重复的归属）。
- **不修 T3 找到的 11 类"文档数字与事实不符"** —— 那些归工单 73 §遗留。
- 不删 git 对象、不 force-push。

## Further Notes

**用户点令原文**：「合一的话 T3 就没意义了」+「IP做主干但是等会删掉另外两个分支，
然后我会改成master为名字」+「确定能在一条线上出三种产物就好」。

**"能出三种产物"的实测证据**（本工单已验）：
```
$ bash build/113/relink.sh explain product | diff - <(bash build/113/relink.sh explain w64)
  MEMORY64      0 → 1
  MALLOC        （空） → mimalloc
  RUST_SORT     0 → 1
  MAXIMUM_MEMORY 2GB → 8GB
  KEEP_LIST     keep.txt → keep-w64.txt
  OCTS_SCAN_DIRS /src/octs-site → /src/octs-6012-w64
```
⇒ 参数已齐备。差的是"第三个产物"的正式化（`w64+RUST_SORT=1` 起个名字，或者就叫 `w64`
的默认态 —— 它**已经**是默认 `RUST_SORT=1`）。

**诚实边界**：合一会让 git 历史变成"一条线 + 两条孤儿分支"。`git log <old-branch>` 仍然
可查（对象在），但 `git branch -a` 上看不到了。这是有意的（用户点令删分支），
要在 `HISTORY.md` 记清楚"分支引用已删、对象保留、原始 sha 记在此处"。
