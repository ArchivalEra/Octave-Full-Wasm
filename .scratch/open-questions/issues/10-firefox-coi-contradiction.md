# 10: Firefox 双层 COI 矛盾（COI ✓ 但 CDN ✗）

**What to build:** Firefox 上出现"跨源隔离成立、但跨源 CDN 脚本仍被拦"的组合。
`probe-coi-sw.mjs` 已经**观察到** 7/2 这个结果，但**没有靶实验**区分两种解释。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Settling:** `test/browser/probe-coi-sw.mjs` 加一档「同源但走 CDN 路径」的对照 —— rc=0 ⇒ 假设 A（拦截发生在 CDN 层）；rc=7 ⇒ 假设 B（作用域问题）；两者必须只有一种成立
缺的是**能区分假设**的那一格：加一档"同源但走 CDN 路径"的对照，两值的差必须能指向唯一解释。

**Type:** research

- [ ] 先读 `build/113/NOTES-threads.md:622-643` 与 `build/113/PLAN-threads.md:21,100`（E8）
- [ ] 把"观察"扩成"能区分假设的对照"，并写清两值的含义
- [ ] 结论回填 NOTES；若推翻旧措辞 ⇒ 登记进 `build/lib/retractions.json`
- [ ] ⚠️ WebKit 的依赖修正见 `NOTES-threads.md`，别踩同一个坑
