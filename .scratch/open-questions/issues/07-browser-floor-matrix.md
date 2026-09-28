# 07: 浏览器下限矩阵（< Chromium 137）

**What to build:** 引擎矩阵现在只覆盖"有 JSPI"的那一档。低于 Chromium 137 的版本走什么路径、
是不是优雅降级，没有实测矩阵。

**Blocked by:** None (can start immediately)

**Status:** ready-for-human

**Settling:** 不存在 —— 本工单第一交付物就是造它：`test/browser/probe-browser-floor.mjs`（对缺 JSPI API 的引擎 rc=2 ⇒ 按约定优雅降级；rc=其他 ⇒ 判定失效；今天那只是注释里的约定）
（这是已有的约定，见 `NOTES-jspi.md:87-89`）；矩阵每一格都要有明确期望值，缺格即红。

**Type:** research

- [ ] 先读 `build/113/NOTES-jspi.md:87-89` 核对既有约定
- [ ] 把"缺 API ⇒ rc=2"从注释变成**测试**（当前只是文档里的约定）
- [ ] 补上 < 137 的格子（需要装对应版本的浏览器 —— 装到 `/mnt/hdd/crossbuild-tools/pw-browsers/`）
- [ ] 结论回填 NOTES，工单置 `resolved`
