# 22: `relink.sh` 里"22 个环境变量"是陈旧数字（台账实测 29）

**What to build:** `build/113/relink.sh` 有 **5 处**写死"全部 22 个变量 / 22 个环境变量"
（`:9`、`:14`、`:42`、`:91`、`:335`），而台账 `build/FACTS.json` 的 `env_vars` 实测是 **29**
（A1 加 `BUILD_MODE` 之后没同步）。这正是本仓事实系统 F2 要消灭的形状：**数字手抄在散文里**，
改一次要改多处，漏一处就是"文档说假话"。
讽刺的是：`facts.py:9` 与 `.githooks/check-facts.py:12` 的**存在理由**就是拿它当例子
（"同样一件事抄在 6 处"）—— 例子本身一直没修。

**Blocked by:** None

**Status:** resolved

**Settling:** `grep -c '22 个' build/113/relink.sh` ⇒ **0**（数字不再手抄）；
且 `bash build/113/relink.sh explain product | head -3` 仍能正常打印（措辞改成引用台账键）。
**反向断言**：新注释若写成"全部 N 个变量"，必须有一条可跑的取数方式
（`python3 build/facts.py show env_vars`）写在旁边 —— 写不出取数方式的数字不许留在文件里。

**Type:** task

## 为什么现在修（而不是"等有空"）

- 今天已经因为**同一类**问题踩过一次：glpk 判别实验的数字（44 个 `.oct` / 4,189,800 条 i64）
  在产物重编后全过期，NOTES 里靠"以台账为准"的顶部提示兜着；
- `relink.sh` 是**唯一重链入口**，它头部的话是操作员最先读到的 → 错数字传播代价最高。

## 交付标准

1. 5 处改成**不写条数**的措辞（"全部变量由模式表推出；条数见 `build/FACTS.json` 的 `env_vars`"）；
2. 若 `explain` 的打印文本里含该数字（`:335` 是 usage），一并去掉；
3. `bash build/113/relink.sh --selftest` 保持全绿（纯注释/文本改动不该影响行为）；
4. 结论回填本单 Answer。

## Answer（2026-09-30）

- `grep -c '22 个' build/113/relink.sh` ⇒ **0**（5 处全部改掉，措辞改为引用台账键
  `env_vars`，旁边写明取数命令 `python3 build/facts.py show env_vars`）；
- `bash build/113/relink.sh --selftest` ⇒ **8 PASS / 0 fail**（纯注释/文本改动，行为未变）；
- `facts.py` 与 `.githooks/check-facts.py` 里那条"存在理由"的例子已标注**该实例已修**
  （否则读者会照着去找 6 处，找的是历史）；
- 顺带：`relink.sh` 现已被 `docker cp` 进容器（`/src/bin/relink.sh`）。
