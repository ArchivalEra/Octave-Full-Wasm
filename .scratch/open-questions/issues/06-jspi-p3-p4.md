# 06: JSPI P3/P4 落地 —— 真 `.oct` 当 side module；`pause`/`kbhit` 走 JSPI

**What to build:** 两件相关的落地：把**真 `.oct`** 当 side module 用 JSPI 装载；
让 `pause`/`kbhit` 通过 JSPI 等待而不是内建阻塞。

**Blocked by:** 05（若 05 证明 dlopen 是 G1 真因，P3/P4 的做法要据此改）

**Status:** ready-for-agent

**Settling:** `sh build/sweep.sh <站点>/` —— rc=0 且 `accept-ginput` / `accept-113-oct` 全绿 ⇒ 过；rc≠0 ⇒ 有回归（反向断言：关掉 JSPI 时 `accept-ginput` 必须**优雅降级**，不是 TypeError）
`accept-113-oct`）；反向断言：把 JSPI 关掉时 `accept-ginput` 必须**优雅降级**（D9 门槛，不是 TypeError）。

**Type:** task

- [ ] 先读 `build/113/NOTES-jspi.md:82-90`（这两条被声明为独立批次，需要整轮回归）
- [ ] 落地后必须**浏览器侧**实测 —— "能编过 ≠ 能用了"
- [ ] 结论回填 NOTES，工单置 `resolved`
