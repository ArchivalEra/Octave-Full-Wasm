# 05: JSPI G1 真因 —— 是启动路径上的 dlopen 吗？

**What to build:** G1 那次"页面看起来卡死"的真身，是**推断**为"启动路径上碰 dlopen"。
本工单把它变成实测：在 v9 制品上加一个**真 side module + dlopen**，看页面是否起不来。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Settling:** 不存在 —— 本工单第一交付物：`build/113/probe-jspi-v9-dlopen/`（真 side module + dlopen）
+ 对应 runner；判据 = 页面能否 ready（两值可区分）。

**Type:** research

- [ ] 先读 `build/113/NOTES-jspi.md:94-133`，确认推断的原文与既有 `probe-jspi-b.*` 的边界
- [ ] 造结算件：**真** side module（不是平凡 two-wasm），且 dlopen 发生在开机路径上
- [ ] 结论回填 NOTES（推断 → 实测/翻案），工单置 `resolved`
- [ ] 若推翻 ⇒ 登记进 `build/lib/retractions.json`（`check-retractions.py` 会在它重现时报错）
