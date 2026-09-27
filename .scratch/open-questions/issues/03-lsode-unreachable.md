# 03: LSODE/ODEPACK `unreachable` 陷阱的位置

**What to build:** 把 LSODE 的 `unreachable` 陷阱从"知道它有、不知道在哪"变成
"知道是哪一行、以及触发它的最小条件"。

**Blocked by:** 01（需要符号化/诊断构建的口子）

**Status:** ready-for-agent

**Settling:** 不存在 —— **本工单的第一交付物就是造它**：一个符号化构建（`-g` + 诊断）
+ 最小复现脚本，跑出非零退出码并把栈指到具体位置。

**Type:** research

- [ ] 先读 `build/113/NOTES-lsode.md:77-86`，**确认这条悬案今天仍然存在**（可能已被别的工作顺手结掉）
- [ ] 造出可跑的结算件（符号化 `DIAG_NAMES`/`DIAG_ASSERT` 开关已存在，见同文件 :88 起）
- [ ] 结论回填 NOTES，工单置 `resolved`
