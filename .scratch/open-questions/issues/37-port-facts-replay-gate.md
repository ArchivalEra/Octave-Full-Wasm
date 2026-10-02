# 37: 移植 Einfacht 的**复跑闸门**（`check_facts_replay`）到本仓

**What to build:** Einfacht（事实系统上游，2026-10-01 已由维护者实现 issue #2 ①）新增了
**复跑闸门**：台账每条事实的 `cmd` **逐字执行**（bash+pipefail，cwd=仓库根），stdout 去空白后
必须**等于**台账值；rc≠0 / 超时（默认 10s）/ 没有 cmd ⇒ 全部报；`fact(..., replay=False)` 显式
豁免、`REFLECT_REPLAY=off` 整仓明说未启用；零值守卫三条（空台账 / 一条都没跑成 / 全豁免）。

**Blocked by:** None

**Status:** resolved（2026-10-02：随 Einfacht #4 移植一并落地）

**Settling:** `sh build/gates-selftest.sh` 全绿**且**新闸门 `check-facts-replay.py` 的
`--selftest` 至少含三类用例（裸值相符不报 / stdout 含值但不相等必须报 / 全豁免必须报）；
反向断言：把某条可复跑事实的 `cmd` 改坏（如 `sha256sum /nonexistent`）⇒ 本闸门必须红。

**Type:** task

## 为什么不能直接照抄（移植的**真实工作量**在这里）

上游判据要求 `cmd` 可执行且 stdout == 值；本仓台账 77 条里 **cmd 大多是散文**
（如「读 `/mnt/…/octave.build.json` 的 `measured.exported_functions`」）——
直接跑会**全部红**。所以移植 = 两条路选一：

1. **逐条改写**：把能写成可执行命令的（`sha256sum`/`stat`/`grep -c` 类 ≈ 20 条）改写成
   `stdout == 值` 的形态并标 `replay=True`；其余散文条目显式 `replay=False`（有名单、有明说）。
2. **默认关**：闸门进位但 `REFLECT_REPLAY=off` 起步，逐条迁移一条开一条（同 Einfacht
   的"明说未启用，不假装查过"先例）。

上游参考实现：`/mnt/hdd/octave-wasm-build/Einfacht/zreflect/check_facts_replay.py`
（含裸值契约、pipefail、超时、零值守卫三条与完整自证——照它抄语义，别抄路径）。

## 顺带（已随本次批次移植完成的其余三条，见 git log）

- ① `--accept-changes[=k1,k2]` 逐条放行（facts.py，自证 20/0）；
- ② `measured_at` 采集戳 + 渲染「测于」列（facts_block.py）；
- ④ 裸数字判据的**围栏/行内代码豁免**（check-facts.py，自证 16/0）；
- ③ 摘要行约定本仓早已统一（`=== N PASS / M fail ===`），无需改。

## Answer

（2026-10-02，随上游 Einfacht issue #4 的移植一并落地。）

- **`check_facts_replay` 已移植** = `.githooks/check-facts-replay.py`（本仓 Gate 平台形状）：
  replay=True 的 cmd 逐字执行（bash -o pipefail，超时 10s 可调），stdout 裸值契约 == 值；
  零值守卫三条（空台账 / 全豁免 / 整体死亡）；`FACTS_REPLAY=off` 整仓出口（明说未启用）。
  自证 8/0（含"两条全死 ⇒ 恰 3 个问题"的守卫精确压测 —— 第一版双重报告被自证抓出来修掉）。
- **首轮标注**：85 条 = 20 条逐字复跑（sha/stat/find 族，sha256sum 补了 `| cut -d' ' -f1`）+
  65 条显式 `replay=False`（`build/facts.py` 的 `_no_replay` 名单：浏览器/容器/构建/基准重活、
  派生比值、散文式复跑方式 —— 有名单、有明说）。实战：**20/20 逐字复现**。
- **同批移植（Einfacht #4）**：`facts.py --get KEY`（跨语言官方只读出口）；fact() 的 `replay`
  参数与 ⑤ 原则（每跑必变的量：采样+稳定性标记，不许裸存）；**CI gates job**
  （`.github/workflows/gates.yml` —— 跳过名单明说：依赖部署树的三道只在 pre-commit 跑）。
- ⑥（md_lines 块排除）：本仓台账无 md_lines 键，陷阱形状不存在 —— 如实记 N/A。
- ①（会话注入接线）：本仓没有 .zcode/inject-state 接线，不适用 —— Einfacht 本体仓的事。
