# 42: 事实系统第三档 **`witness`（贵事实的便宜见证）** + 反哺上游 Einfacht

**What to build:** `-flto` 事故暴露了事实系统的一个**结构性盲区**（HISTORY §5.77/§5.78）：
`replay=False` 的**贵事实**（浏览器基准、构建产物）只有两档 —— 要么每次真跑（贵到不能进
pre-commit），要么**永不复查**。于是"产物没变、但产出它的工具变了"（容器 `link-web.sh`
被塞进 `-flto`）能一路走到**全量浏览器回归**才炸（`accept-dldfcn` 71/0 → 44/27）。

**本单交付**（两条，用户 2026-10-02 点令"先升级，再把提升点提 issue 给上游，PR 不好"）：
1. **本仓落地第三档**：`fact(..., witness=<便宜命令>, witness_expect=<期望 stdout>)` ——
   与 `replay` **正交**，贵事实照样挂见证、每提交必跑；复跑闸门执行它并要求 stdout 逐字相等。
2. **反哺上游** `ArchivalEra/Einfacht`：把这条机制缺口 + 本仓的落地形状提成 issue（不 PR，
   因为各消费方的事实系统版本不统一，PR 不好合）。

**Blocked by:** None

**Status:** resolved（2026-10-02：机制落地 + 首个实例 + 上游 issue 已提）

**Settling:** `python3 build/facts.py --selftest && python3 .githooks/check-facts-replay.py --selftest`
—— 全 PASS（含见证档三条反向断言）⇒ 机制生效；任一 fail ⇒ 没落地。
首个实例的实跑见证：`python3 build/113/witness-build-provenance.py w64` ⇒ `match`
（漂移时 `DRIFT: …`）。

## Answer

（2026-10-02 结案。）

**① 机制（本仓）**：
- `build/facts.py` 的 `fact()` 增 `witness` / `witness_expect` 两参（形状契约：同给或同不给，
  只给一个当场报错）。落进台账为 `{"witness":…, "witness_expect":…}`。
- `.githooks/check-facts-replay.py` 增**见证档**：对每条挂 `witness` 的事实（**不论
  `replay`**）逐字执行、要求 stdout == `witness_expect`；零值守卫同步修正（"只有 witness
  事实、没有 replay 事实"不再被误报为"全豁免"）。自证 **13 PASS / 0 fail**（新增 5 条）。
- **首个实例**：`build/113/witness-build-provenance.py`（新，带 `--selftest` 3/0）——
  断言**部署件 w64 由仓库现役 `build/113/link-web.sh` 构建**（读 `site/w64/octave.build.json`
  的 `tool.script_sha256` vs 仓库脚本 sha）。台账事实 `w64_build_tool_match`（值 `match`，
  `replay=False`，挂见证）。它**便宜、只读、无副作用**，正是"把无害探针织进项目深处"的形状。
- 已登记进 `build/gates-selftest.sh`（闸门自证名单）。

**② 上游 issue**：`ArchivalEra/Einfacht` 第 5 张反哺（见本仓 `docs/agents/upstream-issues.md`
留档）。体例照 #1–#4：背景 + 带 file:line/复跑命令的证据 + 建议；**不做 PR**。

**诚实边界**：`witness` 默认只查**活跃迭代、每批重链的车道**（本仓 = w64）—— 四档记录的
构建脚本 sha 本就各不相同（base `0eaa1f0e` / threads `44be7ec2` / w64 `63d8e7d7` /
w64-base `a04488c9`，因建造时间不同），把旧档也硬查会得到永久假红（噪声 ⇒ 最后被整闸关掉）。
调用方（台账）显式传车道名，不猜。
