# 46: **pre-ready eval 守卫**：解释器未就绪时 eval/feval 必须快速抛错，不许挂死

**What to build:** 票 40 的残留尖角（当时记档"加固票候选"）：boot 中途调解释器入口，
NT=4 干净抛错、**NT=8 上主线程卡死在 wasm 里**——页内 setTimeout 停摆，任何 JS 层
catch/超时都救不了，embed 门面（`octave-embed.js` 的 try/catch→rc=-1）同样被穿透。
用户令"继续"后（2026-10-03）作为台账上最后一张非人工候选落地。

**Blocked by:** None

**Status:** resolved （2026-10-03：守卫进 wasm + 探针 probe-preready-guard 5/0 + 无守卫反面对照
红 + 已发运 8761，sha = 台账 `w64_wasm_sha`）

**Settling:** test/browser/probe-preready-guard.mjs —— HARNESS=<harness> 跑：rc=0 ⇒ 结算件成立、结论见 Answer；rc≠0 ⇒ 先修结算件。
test/browser/probe-preready-guard.mjs <URL>` ⇒ `=== 5 PASS / 0 FAIL ===` ⇒ 守卫生效；
⑤ 格（quit 后 eval_string 应抛 "not ready"）报 `null function` ⇒ 无守卫（旧产物）。

## Answer

（2026-10-03 结案。）

**① 修法（`build/main.cc`，+25 行）**：
- `static std::atomic<bool> g_interp_ready{false}`；`execute_interp()` 尾部 `return 0` 前
  置位（与页面 `__octaveReady` 语义严格对齐）；`quit_interp()` 销毁解释器后复位。
- `require_interp_ready()`：两个 eval 入口（`feval` / `eval_string`，`eval_wait` 经
  `eval_string` 同覆盖）先查旗标；未就绪 ⇒ `emscripten::val::global("Error").new_(msg).throw_()`
  —— 抛**真 JS Error**，消息逐字到 JS（不依赖 embind 的异常映射）。

**② 探针（`test/browser/probe-preready-guard.mjs`，5/0）**——形状 = 票 40 调用方本尊
（boot 中 tight 轮询 feval）+ 一个**确定性断言**：
- ⑤ **旗标关的黑盒等价态**：`quit_interp()` 销毁解释器并复位旗标 ⇒ 再调 `eval_string`：
  - 守卫在（`4eda3a79…`）⇒ 快速抛 **"octave interpreter not ready: await __octaveReady
    before eval/feval"**（精确消息，PASS）；
  - 守卫缺（旧产物 `f2269106…` 反面对照）⇒ 抛老式 **`null function`**（FAIL）——
  同一代码路径（旗标 false ⇒ 边界抛错），boot 窗口保护与它同源。
- ② 调用方形状回归：boot 期 tight 轮询（1ms）**从不挂死**、首次成功 727ms、无异型错误。
- **诚实注记**：启动早期"旗标关"的缝隙在外部轮询下**踩不进**（首试 778ms 已在
  execute_interp 之后；两轮共 0 次 notReady）——守卫对 boot 窗口的保护由 ⑤ 的同源路径 +
  二进制证据（守卫串 `octave interpreter not ready` 在新产物出现 1 次、旧产物 0 次）背书。
- 教训：探针第一版用 `__octaveReady !== true` 判"pre-ready"——页面从不把它置 false，
  `!== true` 恒真 ⇒ 自欺"已进窗口"（实测 2 版探针才改对）。

**③ 发运**：`w64-ob-readyguard-out`（sha = 台账 `w64_wasm_sha`，735 导出）⇒ 备份
`w64-artifacts-pre-guard-backup-20261003/` ⇒ promote-w64-lane（三档未动）⇒ boot 1.1s、
四格 33/0、SHA 三层、全量 `PROBES=1` 绿。**速度持平**（守卫只在旗标关时多一次原子读）。
