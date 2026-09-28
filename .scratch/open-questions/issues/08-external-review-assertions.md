# 08: 外审 4 项补判据（MEMFS unlink / worker 崩溃快速失败 / 多 worker IDBFS）

**What to build:** 4 条外部复审提出的行为**功能已经实现、判据没写**。没判据 = 没人盯着，
所以本工单的交付物**不是功能，是断言**。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Settling:** 并入现有套件后 `sh build/sweep.sh <站点>/` —— rc=0 ⇒ 4 条判据都在且能绿；rc≠0 ⇒ 要么缺判据、要么行为已坏
反向断言必须有 —— 例：worker 崩溃时若不快速失败，断言必须红。

**Type:** task

- [ ] 先读 `build/113/NOTES-threads.md:554-557`（原文是"尚未写判据"）核对这 4 条
- [ ] 逐条写断言，并确认它是**能从产物/运行时读出来**的，不是"应该"
- [ ] 结论回填 NOTES，工单置 `resolved`
