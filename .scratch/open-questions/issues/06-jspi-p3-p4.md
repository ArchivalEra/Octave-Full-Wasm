# 06: JSPI P3/P4 落地 —— 真 `.oct` 当 side module；`pause`/`kbhit` 走 JSPI

**What to build:** 两件相关的落地：把**真 `.oct`** 当 side module 用 JSPI 装载；
让 `pause`/`kbhit` 通过 JSPI 等待而不是内建阻塞。

**Blocked by:** 05（若 05 证明 dlopen 是 G1 真因，P3/P4 的做法要据此改）

**Status:** resolved

**Settling:** `sh build/sweep.sh <站点>/` —— rc=0 且 `accept-ginput` / `accept-113-oct` 全绿 ⇒ 过；rc≠0 ⇒ 有回归（反向断言：关掉 JSPI 时 `accept-ginput` 必须**优雅降级**，不是 TypeError）
`accept-113-oct`）；反向断言：把 JSPI 关掉时 `accept-ginput` 必须**优雅降级**（D9 门槛，不是 TypeError）。

**Type:** task

- [x] 先读 `build/113/NOTES-jspi.md:82-90`（这两条被声明为独立批次，需要整轮回归）
- [x] 落地后必须**浏览器侧**实测 —— "能编过 ≠ 能用了"
- [x] 结论回填 NOTES，工单置 `resolved`

## Answer（2026-09-29，无人值守批次）：实质已由 B 姿势产品交付；本单补上**反向断言**后结案

**对 What to build 的两半**：
1. **真 `.oct` 当 side module 装载**：现役产品的 `.oct` 车道就是运行期 `dlopen` 装载真 `.oct`
   （`assets/oct*/` 懒加载），且走 B 姿势 —— dlopen **不是**挂起点（只有 `web_sleep_ms`
   import 被 Suspending 包装）。`accept-113-oct` 8 PASS / 0 FAIL（8768，2026-09-29 实测）。
2. **`pause` 走 JSPI 等待**：webshims 的 `pause.m` 遮蔽内建 pause、走 `__web_pause_ms__`
   （被包装的那个 import）⇒ `accept-jspi-stress` 与 accept-worker 的 F 格都验证真挂起；
   `kbhit`/`keyboard`/`recordblocking` 按 D9 门槛走各自的 web 通道（同属 webshims 面）。

**本单真正缺的是 settling 里的反向断言**（"关掉 JSPI 时必须优雅降级"）—— 已补：
`accept-ginput.mjs` 新增 G1/G2/G3 三格（addInitScript 在页面脚本之前废掉
`WebAssembly.Suspending/promising`）：
- G1 页面照常 ready（api 门如实 false）；
- G2 D9 门必须**关**（`__web_suspend_ok__`==0，经 error 通道读回）；
- G3 `pause(0.2)` 走**内建阻塞**照常返回（实测 201ms，不是 TypeError/挂死）。
**13 PASS / 0 FAIL**。⇒ settle 判据（两套件全绿 + 反向断言）全部满足。
**实测发现（顺带）**：无 JSPI API 时宿主**不暴露 `eval_async`**（降级形态 = 只有同步口）——
这个形状之前没被写下来，现在钉在 G 格里。
