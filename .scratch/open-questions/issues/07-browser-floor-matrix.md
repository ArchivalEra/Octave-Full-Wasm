# 07: 浏览器下限矩阵（< Chromium 137）

**What to build:** 引擎矩阵现在只覆盖"有 JSPI"的那一档。低于 Chromium 137 的版本走什么路径、
是不是优雅降级，没有实测矩阵。

**Blocked by:** None (can start immediately)

**Status:** resolved

**Settling:** 不存在 —— 本工单第一交付物就是造它：`test/browser/probe-browser-floor.mjs`（对缺 JSPI API 的引擎 rc=2 ⇒ 按约定优雅降级；rc=其他 ⇒ 判定失效；今天那只是注释里的约定）
（这是已有的约定，见 `NOTES-jspi.md:87-89`）；矩阵每一格都要有明确期望值，缺格即红。

**Type:** research

- [ ] 先读 `build/113/NOTES-jspi.md:87-89` 核对既有约定
- [ ] 把"缺 API ⇒ rc=2"从注释变成**测试**（当前只是文档里的约定）
- [ ] 补上 < 137 的格子（需要装对应版本的浏览器 —— 装到 `/mnt/hdd/crossbuild-tools/pw-browsers/`）
- [ ] 结论回填 NOTES，工单置 `resolved`

## 进度（2026-09-29，无人值守批次）：探针已造好并在 3 引擎跑绿，"低于下限"侧仍待旧引擎

- `test/browser/probe-browser-floor.mjs` 已入库：引擎 × {ready, evalOk, jspiApi, suspendOk,
  mem64, coi, lane} 矩阵，四条红绿判据（ready / eval / **D9 门与 jspiApi 一致** / lane 与 COI 一致）。
- 实测（8761）：**chromium 152、pw-firefox 154.3、webkit 2359 全绿 12 PASS**——三引擎
  jspiApi=true 且 suspendOk=1（D9 门开）、mem64=true、带头选 threads。webkit 2359 竟全能力 ✓。
- **N/A 如实记**：系统 firefox 140esr 起不来（playwright juggler 与 ESR 不匹配——环境缺件，
  不是产品红）；**<137 老 Chromium 本机没有** ⇒ "低于下限必须优雅降级"那一侧的格子还空着。
- **探针自身的实测教训**：`eval_string` 返回 **rc 不是表达式值**（第一版把 rc=0 当成
  "D9 门关着"，3 引擎假红）——值走 printf + `#output` 标记读回。
- 本单**保持 ready-for-human**：差的是旧引擎构建（<137 chromium / 能被 playwright 驱动的
  <153 firefox），不是判据。

## Answer（2026-09-30）：探针 + 两侧格子都到位；只剩两个**没有构建可用**的引擎格如实留空

- 交付物：`test/browser/probe-browser-floor.mjs`（引擎 × {ready, evalOk, jspiApi, suspendOk, mem64, coi, lane}）
  + 四条判据（ready / eval / **D9 门与 jspiApi 一致** / lane 与 COI 一致）+ 一条反证（版本没降下来必须红）。
- **下限之上**（实测）：chromium 152、pw-firefox 154.3、webkit 2359 ⇒ **12 PASS / 0 FAIL**（三引擎 jspiApi=true、D9 门开）。
- **下限之下**（2026-09-30 补测，工单 24）：**Chromium 125** ⇒ 4 PASS / 0 FAIL
  —— ready ✓、`jspiApi=false` 且 D9 门**关**✓ ⇒ **"低于下限必须优雅降级"有真实数据点**。
- 仍空着的格：Firefox <153 与 Safari <27 的旧构建本机没有（如实留空，**不算通过**）。
  它们要的不是判据而是构建 —— 判据这一侧已经齐了。
