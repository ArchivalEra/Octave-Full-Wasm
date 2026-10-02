# 38: **UI 线定界 + 嵌入接口层**：UI 交给专门的前端 agent，本仓交付 = `docs/embed-api.md` 那张官方接口表的实现

**What to build:** 用户拍板（2026-10-02）：UI 本体由专门的前端 agent 做，本仓只负责**让 UI 能轻松用的
接口层**。接口表已照官方前端契约落档 `docs/embed-api.md`（事件/命令两张表，权威出处 =
`event-manager.h` / `qt-interpreter-events.h`，逐条映射 Web 原语并标 ✅/🔜/➖）。
本单 = 把表里的 **🔜 项全部落地**：`bridge/octave-embed.js`（promise 化薄封装：eval 结构化返回 /
状态机 / 订阅器 / workspace / history / fs / figures / interrupt / input 接管）+ `embed-demo.html`
上手页（接口活文档）+ 探针 `accept-embed-api`（逐接口断言 + 反向断言）+ 文档 🔜→✅ 回填。
**硬约束**：零依赖、不破坏 77 套验收契约（默认实例全局别名逐字不变）、纯静态无构建。

**Blocked by:** None

**Status:** ready-for-agent

**Settling:** 不存在 —— 本工单的第一交付物（= `test/browser/accept-embed-api.mjs`：
`sh test/browser/run.sh test/browser/accept-embed-api.mjs <URL>` ⇒ 全 0 FAIL 且含反向断言 ⇒ 结案）
