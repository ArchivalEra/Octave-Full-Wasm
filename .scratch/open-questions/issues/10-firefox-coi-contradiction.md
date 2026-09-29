# 10: Firefox 双层 COI 矛盾（COI ✓ 但 CDN ✗）

**What to build:** Firefox 上出现"跨源隔离成立、但跨源 CDN 脚本仍被拦"的组合。
`probe-coi-sw.mjs` 已经**观察到** 7/2 这个结果，但**没有靶实验**区分两种解释。

**Blocked by:** None (can start immediately)

**Status:** resolved

**Settling:** `test/browser/probe-coi-sw.mjs` 加一档「同源但走 CDN 路径」的对照 —— rc=0 ⇒ 假设 A（拦截发生在 CDN 层）；rc=7 ⇒ 假设 B（作用域问题）；两者必须只有一种成立
缺的是**能区分假设**的那一格：加一档"同源但走 CDN 路径"的对照，两值的差必须能指向唯一解释。

**Type:** research

- [ ] 先读 `build/113/NOTES-threads.md:622-643` 与 `build/113/PLAN-threads.md:21,100`（E8）
- [ ] 把"观察"扩成"能区分假设的对照"，并写清两值的含义
- [ ] 结论回填 NOTES；若推翻旧措辞 ⇒ 登记进 `build/lib/retractions.json`
- [ ] ⚠️ WebKit 的依赖修正见 `NOTES-threads.md`，别踩同一个坑

## Answer（2026-09-29，无人值守批次）：假设 A 成立（3/3 引擎），假设 B 排除

`probe-coi-sw.mjs` 加了**同源判别格**（同一份 lib.js 摆两种形态：跨源无 CORP / 同源）：
- **同源 lib 在三个引擎（chromium/firefox/webkit）的默认模式全部加载** ⇒ 假设 B
  （"SW 的 COEP 作用域错杀同源子资源"）**排除**；
- Firefox 的"COI ✓ 但 CDN ✗"完全由 **require-corp 对跨源+无 CORP 的语义**解释 —— 它拦的
  是"跨源"而不是"CDN"，同源资产不受影响 ⇒ **宿主站用自己的同源资产就没有这个问题**。
- 判别结论行：`假设 A 命中 3 引擎；假设 B 命中 0 引擎`。
- 顺带如实记：credentialless 档在 firefox/webkit 仍拦 CDN（2 FAIL）—— 这是**引擎对
  `COEP: credentialless` 的支持缺口**（工单里 7/2 时代就存在的已知形状，非回归），
  也是产品侧坚持 require-corp + 同源资产的原因。
