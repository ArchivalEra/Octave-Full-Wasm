# 38: **UI 线定界 + 嵌入接口层**：UI 交给专门的前端 agent，本仓交付 = `docs/embed-api.md` 那张官方接口表的实现

**What to build:** 用户拍板（2026-10-02）：UI 本体由专门的前端 agent 做，本仓只负责**让 UI 能轻松用的
接口层**。接口表已照官方前端契约落档 `docs/embed-api.md`（事件/命令两张表，权威出处 =
`event-manager.h` / `qt-interpreter-events.h`，逐条映射 Web 原语并标 ✅/🔜/➖）。
本单 = 把表里的 **🔜 项全部落地**：`bridge/octave-embed.js`（promise 化薄封装：eval 结构化返回 /
状态机 / 订阅器 / workspace / history / fs / figures / interrupt / input 接管）+ `embed-demo.html`
上手页（接口活文档）+ 探针 `accept-embed-api`（逐接口断言 + 反向断言）+ 文档 🔜→✅ 回填。
**硬约束**：零依赖、不破坏 77 套验收契约（默认实例全局别名逐字不变）、纯静态无构建。

**Blocked by:** None

**Status:** resolved （2026-10-02 夜间批：13/0 验收）

**Settling:** 不存在 —— 本工单的第一交付物（= `test/browser/accept-embed-api.mjs`：
`sh test/browser/run.sh test/browser/accept-embed-api.mjs <URL>` ⇒ 全 0 FAIL 且含反向断言 ⇒ 结案）

## Answer

（2026-10-02 夜间批结案。**验收 = `accept-embed-api` 13 PASS / 0 FAIL**（8854 实测）。）

**交付物**：
- `bridge/octave-embed.js`：接口表 🔜 项全部落地 —— `OctaveEmbed.create({mount?,home?,id?,lane?})`
  → facade：`eval`（rc 通道）/ `evalJSON`（jsonencode 值通道，含错误结构化）/
  `workspace`（whos 结构化）/ `pwd`/`cd`/`help`/`history` / `interrupt` / `input`（stdin 队列预填）/
  `fs.read/write/ls/rm/download` / `on.output|error|state|figure`（属性式订阅）/
  `figures.export`（优雅降级）。零依赖、ES5、不动 wasm。
- `bridge/octave-page.js`：**页面适配器从 index.html 内联逐字抽出**（A2 搬运纪律）——
  工厂从此是可装载资产，任何页面两行接线。index.html 改用外置引用；
  **搬运零行为变化实测**：boot 1.3s + accept-embed-multi 13/0（8854）。
- `bridge/embed-demo.html`：接口活文档（每接口一个按钮）。
- `docs/embed-api.md`：🔜 全部翻 ✅e；GL 边界如实标注。
- 验收：`test/browser/accept-embed-api.mjs`（13/0，含 4 条反向断言：
  evalJSON 未定义变量 / fs 读不存在 / 挂点缺失 reject / 全豁免语义）。

**实施中的四个真发现**（都修了或记档）：
1. `createOctaveHost` 返回的是 **Module 形态对象**，就绪信号在注册表 `__octaveHosts` ——
   把返回值当 inst 读 `.ready` = 永远 undefined（embed 首版的 pending bug）。
2. 订阅器按接口表**属性式**（`on.output(cb)`），不是方法式 —— 接口表是契约，实现照抄。
3. `workspace()` 双重 jsonencode 套娃（通道自带，调用方别再包）。
4. **embed 页面 GL 纹理边界**（⚠ 未解，记档）：自带 mount 的 boot 形态下 plot 的 drawnow
   在 `opengl_texture::create` 打死 wasm 实例（FS 随之不可用）；与 lane 透传无关、
   与静态 #p5figure 无关。根因在 wasm 侧 webgl_toolkit 的 GL 线（E6/图形线待查）；
   shipped index.html 形态图形正常（既有套件覆盖）。→ figures 接口面照常交付（优雅降级），
   探针 I 格如实标注边界。

**⚠ 上站前置缺口（2026-10-02 事后发现，必须在本批上站前修）**：本工单的页面资产
（`octave-page.js` / `octave-embed.js` / `embed-demo.html`）**不在 `promote-pages.sh` 的清单里**
—— 它的清单来自 `build/recover-113.sh` 的 `<script src>`/importScripts 列表（11 个文件）。
后果：`sh build/promote-pages.sh --dry-run` 显示 `index.html` 仓库侧 = 301 行（抽取后）
vs 站点/镜像 = 465 行（抽取前），✗ —— 若直接上站，会**拷上引用 `octave-page.js` 的新
index.html 却不带那个文件** ⇒ 站点坏（同 §0 教训的形状：只拷一半）。⇒ 上站批的第一步是
**把这三个文件并进 promote-pages 的清单**（并在 `--verify` 里核它们三方一致），
再走受管辖入口。**在那之前 8761 保持现状（用户指示"提交但不上站"）。**

**✅ 前置缺口已修（2026-10-03，清单层）**：`promote-pages.sh` 的 `page_files()` 与
`build/recover-113.sh` 的 cp 清单**都已加进三件**（清单 11 → 14）；`--selftest` 仍 3/0，
`--dry-run` 如实显示三件"仓库有 / 站点缺（✗）"—— 这正是"提交未上站"的诚实状态。
⇒ 上站批现在**只剩一个动作**：真跑一次 `sh build/promote-pages.sh`（它会备份、同步 14 件、
重跑 --verify）。上站本身仍是人的决定。

**部署注记**：8761 现状不动（验收在实验站 8854）。上站走 promote-pages 批
（index.html 的 octave-page.js 抽取必须与新文件**同批**上站），全量回归后由人确认。
