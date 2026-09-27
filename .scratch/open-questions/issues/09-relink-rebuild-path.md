# 09: `relink.sh rebuild` 路径实测

**What to build:** `relink.sh` 的 `rebuild` 子命令**从未被跑过**。一条没跑过的路径 = 一条不知道会不会红的路径。

**Blocked by:** None (can start immediately)

**Status:** ready-for-human

**Settling:** 跑一次真实的 `rebuild`（configure + clean + 数小时 make），判据 =
`verdict=="ok"` 且产物 sha 与不 rebuild 时一致/可解释；若它与 `link` 的产物**不一致**，
那本身就是发现（说明 rebuild 路径已经腐烂）。

**Type:** task

**⚠️ 代价诚实**：这条要一整轮重配 + 数小时构建，所以它不该被顺手塞进别的批次 ——
它自己就是一批，且**要占住容器**（别与浏览器验收并行，本仓实测过并发会让套件假崩）。

- [ ] 先读 `build/113/PLAN-arch.md:336` 确认原文
- [ ] 跑 `rebuild` 并留全日志（不是 `tail`，要整份）
- [ ] 结论回填 NOTES，工单置 `resolved`
