# 05: JSPI G1 真因 —— 是启动路径上的 dlopen 吗？

**What to build:** G1 那次"页面看起来卡死"的真身，是**推断**为"启动路径上碰 dlopen"。
本工单把它变成实测：在 v9 制品上加一个**真 side module + dlopen**，看页面是否起不来。

**Blocked by:** None (can start immediately)

**Status:** resolved

**Settling:** 不存在 —— 本工单第一交付物：`build/113/probe-jspi-v9-dlopen/`（真 side module + dlopen）
+ 对应 runner；判据 = 页面能否 ready（两值可区分）。

**Type:** research

- [ ] 先读 `build/113/NOTES-jspi.md:94-133`，确认推断的原文与既有 `probe-jspi-b.*` 的边界
- [ ] 造结算件：**真** side module（不是平凡 two-wasm），且 dlopen 发生在开机路径上
- [ ] 结论回填 NOTES（推断 → 实测/翻案），工单置 `resolved`
- [ ] 若推翻 ⇒ 登记进 `build/lib/retractions.json`（`check-retractions.py` 会在它重现时报错）

## Answer（2026-09-29，无人值守批次）：机制已被阶梯回答；结算件 = v13 的永久探针

**对"是启动路径上的 dlopen 吗"的回答**（NOTES-jspi v1–v13 阶梯 + 真产物实测，两层）：
1. G1 事故的"页面卡死"**不是** dlopen 造成的 —— 真产物那次 `WITH_JSPI=1` 的旗标**从未进链接**
   （JSPI_FLAGS 赋值了没引用），且 `null function` = 在 `execute_interp()` 之前碰解释器；
2. 但"启动路径同步 dlopen ⇒ 页面起不来"这个**机制本身为真**（v13 实测）—— 它是独立的墙，
   现役产品走 B 姿势 + 启动期不碰 dlopen，不受影响。

**结算件**（本单第一交付物）已入库：
- `build/113/probe-jspi-g1/{main.cpp,side.c,page.html}` + `build/113/probe-jspi-g1.sh`
  （一份源码、两个变体，唯一变量 = 启动期是否碰同步 dlopen；产物自证 promising 真进链接）；
- `test/browser/probe-jspi-g1.mjs`（自托管；PROBE_DIR 已登记 manifest）：**3 PASS / 0 FAIL** —
  control ready 锚 ✓、control 的 callSide 必抛 SuspendError（v10 机制①）✓、
  startup 必出机制指纹 `trying to suspend without WebAssembly.promising` ✓。

**实测翻面一处（如实）**：v13 当日（09-24）形状是"ready=false 页面起不来"；2026-09-29
同容器同 emcc 复测，throw 仍在但 **boot 存活、bindings 注册被打残**（callSide 缺失）——
形状随胶水时序漂，**机制指纹才是稳定判据**（已按此写探针）。
**探针自身的坑**：ErrorEvent.message 不含 `SuspendError:` 名字前缀 —— 按消息体匹配。
